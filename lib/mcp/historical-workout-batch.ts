import { z } from 'zod';
import { db } from '@/lib/db';
import { databaseIdSchema } from '@/lib/schemas/database-id';
import { resolveMcpEntities } from '@/lib/mcp/entity-resolver';
import { analyzeMcpWorkoutConflicts } from '@/lib/mcp/workout-conflicts';
import {
  formatHistoricalWorkoutResult,
  historicalWorkoutImportSchema,
  importHistoricalWorkout,
  importHistoricalWorkoutWithTx,
  rederiveHistoricalWorkoutGoals,
  type HistoricalWorkoutImportInput,
} from '@/lib/mcp/historical-workout-import';
import { asMcpIssue, McpOperationError } from '@/lib/mcp/operation-error';

const dateTimeWithOffset = z.string().datetime({ offset: true });
const entityRefSchema = z.union([
  z.object({ id: databaseIdSchema }).strict(),
  z.object({ name: z.string().trim().min(1).max(160) }).strict(),
]);
const equipmentRefSchema = z.union([entityRefSchema, z.null()]).optional();

export const historicalWorkoutDraftSchema = z
  .object({
    importId: z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
    startedAt: dateTimeWithOffset,
    finishedAt: dateTimeWithOffset.optional(),
    gym: entityRefSchema.optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    sessionRpe: z.number().int().min(1).max(10).nullable().optional(),
    exercises: z
      .array(
        z.object({
          exercise: entityRefSchema,
          sets: z
            .array(
              z.object({
                weightKg: z.number().min(0).max(5000),
                reps: z.number().int().min(1).max(100),
                rir: z.number().min(0).max(5).multipleOf(0.5).nullable().optional(),
                isWarmup: z.boolean().default(false),
                isDropSet: z.boolean().default(false),
                recoverySec: z.number().int().min(0).max(86_400).nullable().optional(),
                notes: z.string().trim().max(500).nullable().optional(),
                equipment: equipmentRefSchema,
              }),
            )
            .min(1)
            .max(50),
        }),
      )
      .min(1)
      .max(40),
  })
  .strict();

export type HistoricalWorkoutDraft = z.infer<typeof historicalWorkoutDraftSchema>;

export async function previewHistoricalWorkoutBatch(userId: string, rawDrafts: HistoricalWorkoutDraft[]) {
  const drafts = z.array(historicalWorkoutDraftSchema).min(1).max(50).parse(rawDrafts);
  const previews = [];
  const issues: Array<Record<string, unknown>> = [];
  const dates = new Set<string>();
  const gyms = new Set<string>();

  for (let index = 0; index < drafts.length; index += 1) {
    const draft = drafts[index]!;
    const resolved = await resolveHistoricalDraft(userId, draft);
    dates.add(draft.startedAt.slice(0, 10));
    if ('issue' in resolved) {
      issues.push({ workoutIndex: index, importId: draft.importId, ...resolved.issue });
      previews.push({ importId: draft.importId, status: 'NEEDS_RESOLUTION', issues: [resolved.issue] });
      continue;
    }
    if (resolved.input.gymId) gyms.add(resolved.input.gymId);
    const parsed = historicalWorkoutImportSchema.safeParse(resolved.input);
    if (!parsed.success) {
      const schemaIssues = parsed.error.issues.map((issue) => ({
        errorCode: 'INVALID_WORKOUT_DRAFT',
        field: issue.path.join('.'),
        message: issue.message,
      }));
      issues.push(...schemaIssues.map((issue) => ({ workoutIndex: index, importId: draft.importId, ...issue })));
      previews.push({ importId: draft.importId, status: 'NEEDS_RESOLUTION', issues: schemaIssues });
      continue;
    }
    previews.push({
      importId: draft.importId,
      status: 'READY',
      resolvedWorkout: resolved.input,
      resolvedEntities: resolved.entities,
      proposedChange: {
        action: 'CREATE_OR_IDEMPOTENT_REPLAY',
        date: resolved.input.startedAt.slice(0, 10),
        gymId: resolved.input.gymId ?? null,
        exerciseCount: resolved.input.exercises.length,
        setCount: resolved.input.exercises.reduce((sum, row) => sum + row.sets.length, 0),
      },
    });
  }

  const conflictAnalysis = dates.size
    ? await analyzeMcpWorkoutConflicts(userId, { dates: [...dates] })
    : null;

  return {
    status: issues.length === 0 ? 'READY' : 'NEEDS_RESOLUTION',
    workoutCount: drafts.length,
    resolvedGymCount: gyms.size,
    issues,
    workouts: previews,
    conflicts: conflictAnalysis?.status === 'READY' ? conflictAnalysis.findings : [],
    warnings: [
      'This preview does not write data.',
      'Date-only/no-time imports, unknown reps, loadBasis and rollback are planned follow-ups and are not silently invented here.',
    ],
  };
}

export async function importHistoricalWorkoutBatch(
  userId: string,
  rawDrafts: HistoricalWorkoutDraft[],
  atomic: boolean,
) {
  const preview = await previewHistoricalWorkoutBatch(userId, rawDrafts);
  if (preview.status !== 'READY') {
    return { ok: false, status: 'NEEDS_RESOLUTION', atomic, issues: preview.issues, preview };
  }
  const resolvedInputs = preview.workouts.map((row) => {
    if (row.status !== 'READY' || !('resolvedWorkout' in row)) {
      throw new Error('Internal preview/import mismatch.');
    }
    return row.resolvedWorkout as HistoricalWorkoutImportInput;
  });

  if (atomic) {
    try {
      const written = await db.$transaction(async (tx) => {
        const results = [];
        for (let index = 0; index < resolvedInputs.length; index += 1) {
          try {
            results.push(await importHistoricalWorkoutWithTx(tx, userId, resolvedInputs[index]!));
          } catch (error) {
            const issue = asMcpIssue(error);
            throw new McpOperationError(
              typeof issue.errorCode === 'string' ? issue.errorCode : 'BATCH_IMPORT_FAILED',
              typeof issue.message === 'string' ? issue.message : 'Historical workout batch failed.',
              { field: `workouts[${index}]`, details: { workoutIndex: index, issue } },
            );
          }
        }
        return results;
      });
      await rederiveHistoricalWorkoutGoals(userId, written.flatMap((row) => row.exerciseIds));
      const results = written.map(formatHistoricalWorkoutResult);
      return {
        ok: true,
        status: 'IMPORTED',
        atomic: true,
        imported: results.filter((row) => row.created).length,
        idempotentReplays: results.filter((row) => row.idempotentReplay).length,
        failed: 0,
        workouts: results,
        previewConflicts: preview.conflicts,
      };
    } catch (error) {
      return {
        ok: false,
        status: 'ROLLED_BACK',
        atomic: true,
        imported: 0,
        failed: 1,
        issues: [asMcpIssue(error)],
        previewConflicts: preview.conflicts,
      };
    }
  }

  const results = [];
  for (let index = 0; index < resolvedInputs.length; index += 1) {
    try {
      results.push({
        workoutIndex: index,
        ok: true,
        result: await importHistoricalWorkout(userId, resolvedInputs[index]!),
      });
    } catch (error) {
      results.push({ workoutIndex: index, ok: false, issue: asMcpIssue(error) });
    }
  }
  return {
    ok: results.every((row) => row.ok),
    status: results.every((row) => row.ok) ? 'IMPORTED' : 'PARTIAL',
    atomic: false,
    imported: results.filter((row) => row.ok && row.result?.created).length,
    failed: results.filter((row) => !row.ok).length,
    workouts: results,
    previewConflicts: preview.conflicts,
  };
}

async function resolveHistoricalDraft(userId: string, draft: HistoricalWorkoutDraft) {
  const gymName = draft.gym && 'name' in draft.gym ? draft.gym.name : undefined;
  const gymId = draft.gym && 'id' in draft.gym ? draft.gym.id : undefined;
  const exerciseNames = draft.exercises
    .filter((row) => 'name' in row.exercise)
    .map((row) => (row.exercise as { name: string }).name);
  const baseResolution = await resolveMcpEntities(userId, { gym: gymName, gymId, exercises: exerciseNames });
  if (baseResolution.issues.length) {
    return { issue: { errorCode: 'ENTITY_RESOLUTION_FAILED', issues: baseResolution.issues } } as const;
  }
  const selectedGymId = gymId ?? baseResolution.gym?.selected?.id;
  const exerciseByQuery = new Map(
    baseResolution.exercises.flatMap((row) =>
      row.selected ? [[row.query, row.selected.id] as const] : [],
    ),
  );

  const equipmentNames = draft.exercises.flatMap((exercise) =>
    exercise.sets.flatMap((set) =>
      set.equipment && 'name' in set.equipment ? [set.equipment.name] : [],
    ),
  );
  const equipmentResolution = equipmentNames.length
    ? await resolveMcpEntities(userId, { gymId: selectedGymId, equipment: [...new Set(equipmentNames)] })
    : null;
  if (equipmentResolution?.issues.length) {
    return { issue: { errorCode: 'EQUIPMENT_RESOLUTION_FAILED', issues: equipmentResolution.issues } } as const;
  }
  const equipmentByQuery = new Map(
    equipmentResolution?.equipment.flatMap((row) =>
      row.selected ? [[row.query, row.selected.id] as const] : [],
    ) ?? [],
  );

  const input: HistoricalWorkoutImportInput = {
    importId: draft.importId,
    startedAt: draft.startedAt,
    ...(draft.finishedAt ? { finishedAt: draft.finishedAt } : {}),
    ...(selectedGymId ? { gymId: selectedGymId } : {}),
    ...(draft.notes !== undefined ? { notes: draft.notes } : {}),
    ...(draft.sessionRpe !== undefined ? { sessionRpe: draft.sessionRpe } : {}),
    exercises: draft.exercises.map((exercise) => ({
      exerciseId:
        'id' in exercise.exercise
          ? exercise.exercise.id
          : exerciseByQuery.get(exercise.exercise.name) ?? '',
      sets: exercise.sets.map((set) => ({
        weightKg: set.weightKg,
        reps: set.reps,
        ...(set.rir !== undefined ? { rir: set.rir } : {}),
        isWarmup: set.isWarmup,
        isDropSet: set.isDropSet,
        ...(set.recoverySec !== undefined ? { recoverySec: set.recoverySec } : {}),
        ...(set.notes !== undefined ? { notes: set.notes } : {}),
        ...(set.equipment
          ? {
              gymEquipmentId:
                set.equipment === null
                  ? null
                  : 'id' in set.equipment
                    ? set.equipment.id
                    : equipmentByQuery.get(set.equipment.name) ?? null,
            }
          : {}),
      })),
    })),
  };
  return {
    input,
    entities: {
      gym: baseResolution.gym,
      exercises: baseResolution.exercises,
      equipment: equipmentResolution?.equipment ?? [],
    },
  } as const;
}
