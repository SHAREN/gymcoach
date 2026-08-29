import { z } from 'zod';
import { db } from '@/lib/db';
import { databaseIdSchema } from '@/lib/schemas/database-id';
import { resolveMcpEntities } from '@/lib/mcp/entity-resolver';
import { analyzeMcpWorkoutConflicts } from '@/lib/mcp/workout-conflicts';
import {
  formatHistoricalWorkoutResult,
  historicalWorkoutImportSchema,
  importHistoricalWorkoutWithTx,
  rederiveHistoricalWorkoutGoals,
  type HistoricalWorkoutImportInput,
} from '@/lib/mcp/historical-workout-import';
import { asMcpIssue, McpOperationError } from '@/lib/mcp/operation-error';
import { learnMcpEntityAliases, type McpEntityAliasProposals } from '@/lib/mcp/entity-aliases';
import {
  captureOwnedSessionSnapshots,
  createWorkoutOperationAudit,
} from '@/lib/mcp/workout-operation-audit';

const dateTimeWithOffset = z.string().datetime({ offset: true });
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const historicalStart = z.union([dateTimeWithOffset, dateOnly]);
const aliasSchema = z.string().trim().min(1).max(160);
const entityRefSchema = z.union([
  z.object({ id: databaseIdSchema, alias: aliasSchema.optional() }).strict(),
  z.object({ name: aliasSchema }).strict(),
]);
const setLoadBasisSchema = z.enum(['TOTAL', 'PER_SIDE', 'PER_HAND', 'STACK_DISPLAY', 'PLATE_PER_SIDE']);
const equipmentRefSchema = z.union([entityRefSchema, z.null()]).optional();

export const historicalWorkoutDraftSchema = z
  .object({
    importId: z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
    startedAt: historicalStart,
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
                reps: z.number().int().min(1).max(100).nullable().optional(),
                loadBasis: setLoadBasisSchema.optional().default('TOTAL'),
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
      aliasProposals: resolved.aliasProposals,
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
      'Date-only sessions preserve DATE_ONLY precision; unknown reps remain null in MCP output and are not used as fabricated repetitions; loadBasis is persisted per set.',
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
            const written = await importHistoricalWorkoutWithTx(tx, userId, resolvedInputs[index]!);
            const previewRow = preview.workouts[index];
            if (previewRow && 'aliasProposals' in previewRow) {
              await learnMcpEntityAliases(
                tx,
                userId,
                previewRow.aliasProposals as McpEntityAliasProposals,
              );
            }
            results.push(written);
          } catch (error) {
            const issue = asMcpIssue(error);
            throw new McpOperationError(
              typeof issue.errorCode === 'string' ? issue.errorCode : 'BATCH_IMPORT_FAILED',
              typeof issue.message === 'string' ? issue.message : 'Historical workout batch failed.',
              { field: `workouts[${index}]`, details: { workoutIndex: index, issue } },
            );
          }
        }
        const createdSessionIds = results.filter((row) => row.created).map((row) => row.session.id);
        const createdSnapshots = await captureOwnedSessionSnapshots(tx, userId, createdSessionIds);
        const audit = await createWorkoutOperationAudit(tx, {
          userId,
          operation: 'import_historical_workouts',
          request: { importIds: resolvedInputs.map((input) => input.importId), atomic: true },
          result: { createdSessionIds },
          undoSnapshot: { version: 1, createdSessions: createdSnapshots, deletedSessions: [] },
        });
        return { written: results, audit };
      });
      await rederiveHistoricalWorkoutGoals(userId, written.written.flatMap((row) => row.exerciseIds));
      const results = written.written.map(formatHistoricalWorkoutResult);
      return {
        ok: true,
        status: 'IMPORTED',
        operationId: written.audit.operationId,
        operationCreatedAt: written.audit.createdAt,
        recoverable: results.some((row) => row.created),
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
      const written = await db.$transaction(async (tx) => {
        const row = await importHistoricalWorkoutWithTx(tx, userId, resolvedInputs[index]!);
        const previewRow = preview.workouts[index];
        if (previewRow && 'aliasProposals' in previewRow) {
          await learnMcpEntityAliases(
            tx,
            userId,
            previewRow.aliasProposals as McpEntityAliasProposals,
          );
        }
        return row;
      });
      await rederiveHistoricalWorkoutGoals(userId, written.exerciseIds);
      results.push({
        workoutIndex: index,
        ok: true,
        result: formatHistoricalWorkoutResult(written),
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

  const aliasProposals: McpEntityAliasProposals = {
    exercises: draft.exercises.flatMap((exercise) => {
      const exerciseId =
        'id' in exercise.exercise
          ? exercise.exercise.id
          : exerciseByQuery.get(exercise.exercise.name) ?? null;
      const alias = 'name' in exercise.exercise ? exercise.exercise.name : exercise.exercise.alias;
      return exerciseId && alias ? [{ exerciseId, alias }] : [];
    }),
    equipment: selectedGymId
      ? draft.exercises.flatMap((exercise) =>
          exercise.sets.flatMap((set) => {
            if (!set.equipment) return [];
            const equipmentId =
              'id' in set.equipment
                ? set.equipment.id
                : equipmentByQuery.get(set.equipment.name) ?? null;
            const alias = 'name' in set.equipment ? set.equipment.name : set.equipment.alias;
            return equipmentId && alias
              ? [{ gymId: selectedGymId, equipmentId, alias }]
              : [];
          }),
        )
      : [],
  };

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
        ...(set.reps !== undefined ? { reps: set.reps } : {}),
        loadBasis: set.loadBasis,
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
    aliasProposals,
    entities: {
      gym: baseResolution.gym,
      exercises: baseResolution.exercises,
      equipment: equipmentResolution?.equipment ?? [],
    },
  } as const;
}
