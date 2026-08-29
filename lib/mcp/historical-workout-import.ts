import { createHash } from 'node:crypto';
import { z } from 'zod';
import { db } from '@/lib/db';
import { resolveSetEquipmentSnapshot } from '@/lib/set-equipment';
import { rederiveGoalAchievement } from '@/lib/set-goal-sync';
import { databaseIdSchema } from '@/lib/schemas/database-id';
import type { Prisma } from '@/lib/prisma-client';

const dateTimeWithOffset = z
  .string()
  .datetime({ offset: true })
  .describe('ISO 8601 date-time with an explicit timezone offset.');

const historicalRirSchema = z
  .number()
  .min(0)
  .max(5)
  .multipleOf(0.5)
  .nullable()
  .optional()
  .describe(
    'Reported RIR from 0 to 5. Half-step values are preserved in the set note because the current structured Set.rir column stores whole integers.',
  );

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
    startedAt: dateTimeWithOffset,
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
                reps: z.number().int().min(1).max(100),
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
  rir: number | null;
  isWarmup: boolean;
  isDropSet: boolean;
  recoverySec: number | null;
  notes: string | null;
  gymEquipmentId: string | null;
}

export async function importHistoricalWorkout(userId: string, rawInput: HistoricalWorkoutImportInput) {
  const input = historicalWorkoutImportSchema.parse(rawInput);
  const startedAt = new Date(input.startedAt);
  const finishedAt = input.finishedAt ? new Date(input.finishedAt) : startedAt;
  if (finishedAt.getTime() < startedAt.getTime()) {
    throw new Error('Historical workout finishedAt cannot be earlier than startedAt.');
  }
  const futureToleranceMs = 5 * 60_000;
  if (startedAt.getTime() > Date.now() + futureToleranceMs) {
    throw new Error('Historical workout startedAt cannot be in the future.');
  }
  if (finishedAt.getTime() > Date.now() + futureToleranceMs) {
    throw new Error('Historical workout finishedAt cannot be in the future.');
  }

  const exerciseIds = input.exercises.map((exercise) => exercise.exerciseId);
  if (new Set(exerciseIds).size !== exerciseIds.length) {
    throw new Error('Each exercise may appear only once in a historical workout import.');
  }
  const totalSets = input.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0);
  if (totalSets > 500) throw new Error('Historical workout import is limited to 500 sets.');
  if (
    !input.gymId &&
    input.exercises.some((exercise) => exercise.sets.some((set) => set.gymEquipmentId))
  ) {
    throw new Error('gymId is required when a historical set references physical gym equipment.');
  }

  const sessionId = stableHistoricalSessionId(userId, input.importId);
  const expectedSets = flattenExpectedSets(input);
  let created = false;

  const session = await db.$transaction(async (tx) => {
    const existing = await tx.session.findUnique({
      where: { id: sessionId },
      include: { sets: true },
    });
    if (existing) {
      assertIdempotentHistoricalWorkout(existing, {
        userId,
        gymId: input.gymId ?? null,
        startedAt,
        finishedAt,
        notes: input.notes ?? null,
        sessionRpe: input.sessionRpe ?? null,
        sets: expectedSets,
      });
      return existing;
    }

    if (input.gymId) {
      const gym = await tx.gym.findFirst({
        where: { id: input.gymId, userId },
        select: { id: true },
      });
      if (!gym) throw new Error('Gym not found.');
    }

    const ownedExercises = await tx.exercise.findMany({
      where: { userId, id: { in: exerciseIds } },
      select: { id: true, category: true },
    });
    if (ownedExercises.length !== exerciseIds.length) {
      throw new Error('One or more exercises were not found in the trainee exercise catalog.');
    }
    if (ownedExercises.some((exercise) => exercise.category === 'CARDIO')) {
      throw new Error('import_historical_workout currently accepts strength exercises only.');
    }

    const createdSession = await tx.session.create({
      data: {
        id: sessionId,
        userId,
        gymId: input.gymId ?? null,
        startedAt,
        finishedAt,
        notes: input.notes ?? null,
        sessionRpe: input.sessionRpe ?? null,
      },
    });

    for (const exercise of input.exercises) {
      for (let index = 0; index < exercise.sets.length; index++) {
        const set = exercise.sets[index]!;
        const normalized = normalizeHistoricalSet(set);
        const equipmentSnapshot = await resolveSetEquipmentSnapshot(tx, {
          userId,
          sessionGymId: input.gymId ?? null,
          exerciseId: exercise.exerciseId,
          gymEquipmentId: set.gymEquipmentId ?? null,
          selectedLoadKg: set.weightKg,
        });
        await tx.set.create({
          data: {
            sessionId,
            exerciseId: exercise.exerciseId,
            setNumber: index + 1,
            weight: set.weightKg,
            reps: set.reps,
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
    created = true;
    return createdSession;
  });

  for (const exerciseId of exerciseIds) {
    try {
      await rederiveGoalAchievement(userId, exerciseId);
    } catch (error) {
      console.error('[mcp] historical workout goal re-derivation failed:', error);
    }
  }

  const fractionalRirSets = input.exercises.reduce(
    (count, exercise) =>
      count + exercise.sets.filter((set) => set.rir != null && !Number.isInteger(set.rir)).length,
    0,
  );

  return {
    ok: true,
    created,
    idempotentReplay: !created,
    importId: input.importId,
    sessionId: session.id,
    gymId: session.gymId,
    startedAt: session.startedAt.toISOString(),
    finishedAt: session.finishedAt?.toISOString() ?? null,
    exerciseCount: input.exercises.length,
    setCount: totalSets,
    warnings:
      fractionalRirSets > 0
        ? [
            `${fractionalRirSets} fractional RIR value(s) were preserved verbatim in set notes; structured Set.rir remains null for those rows because the current database column stores whole integers.`,
          ]
        : [],
  };
}

function stableHistoricalSessionId(userId: string, importId: string) {
  const digest = createHash('sha256').update(`${userId}\0${importId}`).digest('hex').slice(0, 40);
  return `mcp_hist_${digest}`;
}

function normalizeHistoricalSet(
  set: HistoricalWorkoutImportInput['exercises'][number]['sets'][number],
) {
  const fractionalRir = set.rir != null && !Number.isInteger(set.rir) ? set.rir : null;
  const note = set.notes ?? null;
  if (fractionalRir == null) {
    return { rir: set.rir ?? null, notes: note };
  }
  const marker = `Reported RIR ${fractionalRir} (fractional value preserved by MCP import)`;
  return {
    rir: null,
    notes: note ? `${note}\n${marker}` : marker,
  };
}

function flattenExpectedSets(input: HistoricalWorkoutImportInput): StoredExpectedSet[] {
  return input.exercises.flatMap((exercise) =>
    exercise.sets.map((set, index) => {
      const normalized = normalizeHistoricalSet(set);
      return {
        exerciseId: exercise.exerciseId,
        setNumber: index + 1,
        weight: set.weightKg,
        reps: set.reps,
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
    notes: string | null;
    sessionRpe: number | null;
    sets: Array<{
      exerciseId: string;
      setNumber: number;
      weight: number;
      reps: number;
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

function originalGymEquipmentId(set: {
  gymEquipmentId: string | null;
  equipmentLoadSnapshot: Prisma.JsonValue | null;
}) {
  if (set.gymEquipmentId) return set.gymEquipmentId;
  const snapshot = set.equipmentLoadSnapshot;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  return typeof snapshot.gymEquipmentId === 'string' ? snapshot.gymEquipmentId : null;
}
