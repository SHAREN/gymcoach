import { createHash } from 'node:crypto';
import { z } from 'zod';
import { db } from '@/lib/db';
import { resolveSetEquipmentSnapshot } from '@/lib/set-equipment';
import { rederiveGoalAchievement } from '@/lib/set-goal-sync';
import { databaseIdSchema } from '@/lib/schemas/database-id';
import type { Prisma } from '@/lib/prisma-client';
import { McpOperationError } from '@/lib/mcp/operation-error';

const dateTimeWithOffset = z
  .string()
  .datetime({ offset: true })
  .describe('ISO 8601 date-time with an explicit timezone offset.');
const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => isValidDateOnly(value), 'Invalid calendar date.')
  .describe('Calendar date YYYY-MM-DD when the historical source did not record a time.');
const historicalStart = z.union([dateTimeWithOffset, dateOnly]);
const setLoadBasisSchema = z.enum(['TOTAL', 'PER_SIDE', 'PER_HAND', 'STACK_DISPLAY', 'PLATE_PER_SIDE']);

const historicalRirSchema = z
  .number()
  .min(0)
  .max(5)
  .multipleOf(0.5)
  .nullable()
  .optional()
  .describe('Reported RIR from 0 to 5. Half-step values such as 0.5 are stored structurally.');

export const historicalWorkoutImportSchema = z
  .object({
    importId: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
      .describe(
        'Stable caller-generated identifier for this historical workout. Reuse the same value on retries; a changed payload with the same importId is rejected.',
      ),
    startedAt: historicalStart,
    finishedAt: dateTimeWithOffset.optional(),
    gymId: databaseIdSchema.optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    sessionRpe: z.number().int().min(1).max(10).nullable().optional(),
    exercises: z
      .array(
        z.object({
          exerciseId: databaseIdSchema,
          sets: z
            .array(
              z.object({
                weightKg: z.number().min(0).max(5000),
                reps: z.number().int().min(1).max(100).nullable().optional(),
                loadBasis: setLoadBasisSchema.optional().default('TOTAL'),
                rir: historicalRirSchema,
                isWarmup: z.boolean().optional().default(false),
                isDropSet: z.boolean().optional().default(false),
                recoverySec: z.number().int().min(0).max(86_400).nullable().optional(),
                notes: z.string().trim().max(500).nullable().optional(),
                gymEquipmentId: databaseIdSchema.nullable().optional(),
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

export type HistoricalWorkoutImportInput = z.infer<typeof historicalWorkoutImportSchema>;

interface StoredExpectedSet {
  exerciseId: string;
  setNumber: number;
  weight: number;
  reps: number;
  repsKnown: boolean;
  loadBasis: 'TOTAL' | 'PER_SIDE' | 'PER_HAND' | 'STACK_DISPLAY' | 'PLATE_PER_SIDE';
  rir: number | null;
  isWarmup: boolean;
  isDropSet: boolean;
  recoverySec: number | null;
  notes: string | null;
  gymEquipmentId: string | null;
}

export async function importHistoricalWorkout(userId: string, rawInput: HistoricalWorkoutImportInput) {
  const written = await db.$transaction((tx) => importHistoricalWorkoutWithTx(tx, userId, rawInput));
  await rederiveHistoricalWorkoutGoals(userId, written.exerciseIds);
  return formatHistoricalWorkoutResult(written);
}

export async function importHistoricalWorkoutWithTx(
  tx: Prisma.TransactionClient,
  userId: string,
  rawInput: HistoricalWorkoutImportInput,
) {
  const input = historicalWorkoutImportSchema.parse(rawInput);
  const timePrecision = isDateOnly(input.startedAt) ? 'DATE_ONLY' : 'EXACT';
  const historicalDate = timePrecision === 'DATE_ONLY' ? dateOnlyAnchor(input.startedAt) : null;
  const startedAt = historicalDate ?? new Date(input.startedAt);
  if (timePrecision === 'DATE_ONLY' && input.finishedAt) {
    throw new McpOperationError(
      'FINISHED_TIME_WITH_DATE_ONLY_START',
      'finishedAt cannot be supplied when startedAt is date-only because that would mix unknown and exact time precision.',
      { field: 'finishedAt', input: input.finishedAt },
    );
  }
  const finishedAt = input.finishedAt ? new Date(input.finishedAt) : startedAt;
  if (finishedAt.getTime() < startedAt.getTime()) {
    throw new McpOperationError(
      'FINISHED_BEFORE_STARTED',
      'Historical workout finishedAt cannot be earlier than startedAt.',
      { field: 'finishedAt', input: input.finishedAt },
    );
  }
  const futureToleranceMs = 5 * 60_000;
  if (startedAt.getTime() > Date.now() + futureToleranceMs) {
    throw new McpOperationError('FUTURE_WORKOUT', 'Historical workout startedAt cannot be in the future.', {
      field: 'startedAt',
      input: input.startedAt,
    });
  }
  if (finishedAt.getTime() > Date.now() + futureToleranceMs) {
    throw new McpOperationError('FUTURE_WORKOUT', 'Historical workout finishedAt cannot be in the future.', {
      field: 'finishedAt',
      input: input.finishedAt,
    });
  }

  const exerciseIds = input.exercises.map((exercise) => exercise.exerciseId);
  if (new Set(exerciseIds).size !== exerciseIds.length) {
    throw new McpOperationError(
      'DUPLICATE_EXERCISE_IN_WORKOUT',
      'Each exercise may appear only once in a historical workout import.',
      { field: 'exercises' },
    );
  }
  const totalSets = input.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0);
  if (totalSets > 500) {
    throw new McpOperationError('TOO_MANY_SETS', 'Historical workout import is limited to 500 sets.', {
      field: 'exercises',
      details: { totalSets, maximum: 500 },
    });
  }
  if (
    !input.gymId &&
    input.exercises.some((exercise) => exercise.sets.some((set) => set.gymEquipmentId))
  ) {
    throw new McpOperationError(
      'GYM_REQUIRED_FOR_EQUIPMENT',
      'gymId is required when a historical set references physical gym equipment.',
      { field: 'gymId' },
    );
  }

  const [gym, ownedExercises] = await Promise.all([
    input.gymId
      ? tx.gym.findFirst({
          where: { id: input.gymId, userId },
          select: { id: true, name: true },
        })
      : Promise.resolve(null),
    tx.exercise.findMany({
      where: { userId, id: { in: exerciseIds } },
      select: { id: true, name: true, category: true },
    }),
  ]);
  if (input.gymId && !gym) {
    throw new McpOperationError('GYM_NOT_FOUND', 'Gym not found.', {
      field: 'gymId',
      input: input.gymId,
    });
  }
  if (ownedExercises.length !== exerciseIds.length) {
    const found = new Set(ownedExercises.map((exercise) => exercise.id));
    const missing = exerciseIds.filter((id) => !found.has(id));
    throw new McpOperationError(
      'EXERCISE_NOT_FOUND',
      'One or more exercises were not found in the trainee exercise catalog.',
      { field: 'exercises', details: { missingExerciseIds: missing } },
    );
  }
  if (ownedExercises.some((exercise) => exercise.category === 'CARDIO')) {
    throw new McpOperationError(
      'UNSUPPORTED_CARDIO',
      'import_historical_workout currently accepts strength exercises only.',
      { field: 'exercises' },
    );
  }

  const sessionId = stableHistoricalSessionId(userId, input.importId);
  const expectedSets = flattenExpectedSets(input);
  const existing = await tx.session.findUnique({
    where: { id: sessionId },
    include: { sets: true },
  });
  if (existing) {
    try {
      assertIdempotentHistoricalWorkout(existing, {
        userId,
        gymId: input.gymId ?? null,
        startedAt,
        finishedAt,
        historicalDate,
        timePrecision,
        notes: input.notes ?? null,
        sessionRpe: input.sessionRpe ?? null,
        sets: expectedSets,
      });
    } catch {
      throw new McpOperationError(
        'IMPORT_ID_CONFLICT',
        'Historical workout importId already exists with different data.',
        { field: 'importId', input: input.importId, details: { sessionId } },
      );
    }
    return buildWriteResult(existing, false, input, gym, ownedExercises, totalSets);
  }

  const createdSession = await tx.session.create({
    data: {
      id: sessionId,
      userId,
      gymId: input.gymId ?? null,
      startedAt,
      finishedAt,
      historicalDate,
      timePrecision,
      notes: input.notes ?? null,
      sessionRpe: input.sessionRpe ?? null,
    },
  });

  for (let exerciseIndex = 0; exerciseIndex < input.exercises.length; exerciseIndex += 1) {
    const exercise = input.exercises[exerciseIndex]!;
    for (let setIndex = 0; setIndex < exercise.sets.length; setIndex += 1) {
      const set = exercise.sets[setIndex]!;
      const normalized = normalizeHistoricalSet(set);
      let equipmentSnapshot;
      try {
        equipmentSnapshot = await resolveSetEquipmentSnapshot(tx, {
          userId,
          sessionGymId: input.gymId ?? null,
          exerciseId: exercise.exerciseId,
          gymEquipmentId: set.gymEquipmentId ?? null,
          selectedLoadKg: set.weightKg,
        });
      } catch (error) {
        throw new McpOperationError(
          'EQUIPMENT_NOT_FOUND_OR_INCOMPATIBLE',
          error instanceof Error ? error.message : 'Historical equipment reference is invalid.',
          {
            field: `exercises[${exerciseIndex}].sets[${setIndex}].gymEquipmentId`,
            input: set.gymEquipmentId ?? null,
          },
        );
      }
      await tx.set.create({
        data: {
          sessionId,
          exerciseId: exercise.exerciseId,
          setNumber: setIndex + 1,
          weight: set.weightKg,
          reps: set.reps ?? 0,
          repsKnown: set.reps != null,
          loadBasis: set.loadBasis,
          rir: normalized.rir,
          isWarmup: set.isWarmup ?? false,
          isDropSet: set.isDropSet ?? false,
          recoverySec: set.recoverySec ?? null,
          notes: normalized.notes,
          completedAt: finishedAt,
          ...equipmentSnapshot,
        },
      });
    }
  }
  return buildWriteResult(createdSession, true, input, gym, ownedExercises, totalSets);
}

export async function rederiveHistoricalWorkoutGoals(userId: string, exerciseIds: string[]) {
  for (const exerciseId of [...new Set(exerciseIds)]) {
    try {
      await rederiveGoalAchievement(userId, exerciseId);
    } catch (error) {
      console.error('[mcp] historical workout goal re-derivation failed:', error);
    }
  }
}

export function formatHistoricalWorkoutResult(
  written: Awaited<ReturnType<typeof importHistoricalWorkoutWithTx>>,
) {
  const exerciseNameById = new Map(written.ownedExercises.map((exercise) => [exercise.id, exercise.name]));
  return {
    ok: true,
    created: written.created,
    idempotentReplay: !written.created,
    importId: written.input.importId,
    sessionId: written.session.id,
    date: (written.session.historicalDate ?? written.session.startedAt).toISOString().slice(0, 10),
    timePrecision: written.session.timePrecision,
    gymId: written.session.gymId,
    gym: written.gym,
    startedAt: written.session.timePrecision === 'EXACT' ? written.session.startedAt.toISOString() : null,
    finishedAt:
      written.session.timePrecision === 'EXACT' ? written.session.finishedAt?.toISOString() ?? null : null,
    exerciseCount: written.input.exercises.length,
    setCount: written.totalSets,
    exercises: written.input.exercises.map((exercise) => ({
      exerciseId: exercise.exerciseId,
      exerciseName: exerciseNameById.get(exercise.exerciseId) ?? null,
      setCount: exercise.sets.length,
      sets: exercise.sets.map((set, index) => ({
        setNumber: index + 1,
        weightKg: set.weightKg,
        reps: set.reps ?? null,
        loadBasis: set.loadBasis,
        rir: set.rir ?? null,
        isWarmup: set.isWarmup ?? false,
        isDropSet: set.isDropSet ?? false,
        gymEquipmentId: set.gymEquipmentId ?? null,
        notes: set.notes ?? null,
      })),
    })),
    warnings: [],
  };
}

function buildWriteResult(
  session: {
    id: string;
    gymId: string | null;
    startedAt: Date;
    finishedAt: Date | null;
    historicalDate: Date | null;
    timePrecision: 'EXACT' | 'DATE_ONLY';
  },
  created: boolean,
  input: HistoricalWorkoutImportInput,
  gym: { id: string; name: string } | null,
  ownedExercises: Array<{ id: string; name: string; category: string }>,
  totalSets: number,
) {
  return {
    session,
    created,
    input,
    gym,
    ownedExercises,
    totalSets,
    exerciseIds: input.exercises.map((exercise) => exercise.exerciseId),
  };
}

function stableHistoricalSessionId(userId: string, importId: string) {
  const digest = createHash('sha256').update(`${userId}\0${importId}`).digest('hex').slice(0, 40);
  return `mcp_hist_${digest}`;
}

function normalizeHistoricalSet(
  set: HistoricalWorkoutImportInput['exercises'][number]['sets'][number],
) {
  return { rir: set.rir ?? null, notes: set.notes ?? null };
}

function flattenExpectedSets(input: HistoricalWorkoutImportInput): StoredExpectedSet[] {
  return input.exercises.flatMap((exercise) =>
    exercise.sets.map((set, index) => {
      const normalized = normalizeHistoricalSet(set);
      return {
        exerciseId: exercise.exerciseId,
        setNumber: index + 1,
        weight: set.weightKg,
        reps: set.reps ?? 0,
        repsKnown: set.reps != null,
        loadBasis: set.loadBasis,
        rir: normalized.rir,
        isWarmup: set.isWarmup ?? false,
        isDropSet: set.isDropSet ?? false,
        recoverySec: set.recoverySec ?? null,
        notes: normalized.notes,
        gymEquipmentId: set.gymEquipmentId ?? null,
      };
    }),
  );
}

function assertIdempotentHistoricalWorkout(
  existing: {
    userId: string;
    gymId: string | null;
    startedAt: Date;
    finishedAt: Date | null;
    historicalDate: Date | null;
    timePrecision: 'EXACT' | 'DATE_ONLY';
    notes: string | null;
    sessionRpe: number | null;
    sets: Array<{
      exerciseId: string;
      setNumber: number;
      weight: number;
      reps: number;
      repsKnown: boolean;
      loadBasis: 'TOTAL' | 'PER_SIDE' | 'PER_HAND' | 'STACK_DISPLAY' | 'PLATE_PER_SIDE';
      rir: number | null;
      isWarmup: boolean;
      isDropSet: boolean;
      recoverySec: number | null;
      notes: string | null;
      gymEquipmentId: string | null;
      equipmentLoadSnapshot: Prisma.JsonValue | null;
    }>;
  },
  expected: {
    userId: string;
    gymId: string | null;
    startedAt: Date;
    finishedAt: Date;
    historicalDate: Date | null;
    timePrecision: 'EXACT' | 'DATE_ONLY';
    notes: string | null;
    sessionRpe: number | null;
    sets: StoredExpectedSet[];
  },
) {
  const sameSession =
    existing.userId === expected.userId &&
    existing.gymId === expected.gymId &&
    existing.startedAt.getTime() === expected.startedAt.getTime() &&
    existing.finishedAt?.getTime() === expected.finishedAt.getTime() &&
    (existing.historicalDate?.getTime() ?? null) === (expected.historicalDate?.getTime() ?? null) &&
    existing.timePrecision === expected.timePrecision &&
    existing.notes === expected.notes &&
    existing.sessionRpe === expected.sessionRpe;
  if (!sameSession || existing.sets.length !== expected.sets.length) {
    throw new Error('Historical workout importId already exists with different data.');
  }

  const actualByKey = new Map(
    existing.sets.map((set) => [`${set.exerciseId}\0${set.setNumber}`, set] as const),
  );
  for (const expectedSet of expected.sets) {
    const actual = actualByKey.get(`${expectedSet.exerciseId}\0${expectedSet.setNumber}`);
    if (
      !actual ||
      Math.abs(actual.weight - expectedSet.weight) > 0.001 ||
      actual.reps !== expectedSet.reps ||
      actual.repsKnown !== expectedSet.repsKnown ||
      actual.loadBasis !== expectedSet.loadBasis ||
      actual.rir !== expectedSet.rir ||
      actual.isWarmup !== expectedSet.isWarmup ||
      actual.isDropSet !== expectedSet.isDropSet ||
      actual.recoverySec !== expectedSet.recoverySec ||
      actual.notes !== expectedSet.notes ||
      originalGymEquipmentId(actual) !== expectedSet.gymEquipmentId
    ) {
      throw new Error('Historical workout importId already exists with different data.');
    }
  }
}

function isDateOnly(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isValidDateOnly(value: string) {
  if (!isDateOnly(value)) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function dateOnlyAnchor(value: string) {
  if (!isValidDateOnly(value)) throw new Error('Invalid date-only value.');
  return new Date(value + 'T00:00:00.000Z');
}

function originalGymEquipmentId(set: {
  gymEquipmentId: string | null;
  equipmentLoadSnapshot: Prisma.JsonValue | null;
}) {
  if (set.gymEquipmentId) return set.gymEquipmentId;
  const snapshot = set.equipmentLoadSnapshot;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  return typeof snapshot.gymEquipmentId === 'string' ? snapshot.gymEquipmentId : null;
}
