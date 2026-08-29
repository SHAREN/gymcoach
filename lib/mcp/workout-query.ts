import { db } from '@/lib/db';
import { resolveMcpEntities } from '@/lib/mcp/entity-resolver';
import type { Prisma } from '@/lib/prisma-client';

const HOUR_MS = 60 * 60 * 1000;
const STALE_OPEN_HOURS = 12;
const STALE_FINISHED_HOURS = 12;
const MULTI_DAY_HOURS = 24;

const workoutSessionInclude = {
  gym: { select: { id: true, name: true } },
  program: { select: { id: true, name: true } },
  workout: { select: { id: true, name: true } },
  exerciseMemberships: {
    orderBy: { ordinal: 'asc' as const },
    include: { exercise: { select: { id: true, name: true } } },
  },
  sets: {
    orderBy: [
      { completedAt: 'asc' as const },
      { setNumber: 'asc' as const },
      { id: 'asc' as const },
    ],
    include: {
      exercise: {
        select: {
          id: true,
          name: true,
          category: true,
          equipmentType: true,
        },
      },
      gymEquipment: {
        select: { id: true, name: true },
      },
    },
  },
} satisfies Prisma.SessionInclude;

export type McpWorkoutRow = Prisma.SessionGetPayload<{ include: typeof workoutSessionInclude }>;

export interface GetWorkoutsInput {
  gym?: string;
  gymId?: string;
  dates?: string[];
  from?: string;
  to?: string;
  limit?: number;
}

export async function getMcpWorkouts(userId: string, input: GetWorkoutsInput) {
  const gymResolution = input.gym || input.gymId
    ? await resolveMcpEntities(userId, { gym: input.gym, gymId: input.gymId })
    : null;
  if (gymResolution?.gym && gymResolution.gym.status !== 'RESOLVED') {
    return {
      status: 'NEEDS_RESOLUTION' as const,
      issues: gymResolution.issues,
      workouts: [],
    };
  }
  const resolvedGymId = gymResolution?.gym?.selected?.id ?? input.gymId ?? null;

  const dateRanges = (input.dates ?? []).map(dateOnlyUtcRange);
  const where: Prisma.SessionWhereInput = {
    userId,
    ...(resolvedGymId ? { gymId: resolvedGymId } : {}),
    ...(dateRanges.length > 0
      ? {
          OR: dateRanges.map((range) => ({
            startedAt: { gte: range.from, lt: range.to },
          })),
        }
      : {}),
    ...(input.from || input.to
      ? {
          startedAt: {
            ...(input.from ? { gte: new Date(input.from) } : {}),
            ...(input.to ? { lte: new Date(input.to) } : {}),
          },
        }
      : {}),
  };

  const rows = await db.session.findMany({
    where,
    orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
    take: Math.max(1, Math.min(input.limit ?? 100, 200)),
    include: workoutSessionInclude,
  });
  const workouts = rows.map((row) => serializeWorkout(row));
  const overlapBySession = buildOverlapMap(rows);

  return {
    status: 'READY' as const,
    gym: gymResolution?.gym?.selected ?? null,
    filters: {
      dates: input.dates ?? [],
      dateInterpretation:
        dateRanges.length > 0
          ? 'UTC calendar dates for existing timestamps. Date-only historical import will use explicit precision metadata in the follow-up API.'
          : null,
      from: input.from ?? null,
      to: input.to ?? null,
    },
    returned: workouts.length,
    workouts: workouts.map((workout) => ({
      ...workout,
      overlappingSessionIds: overlapBySession.get(workout.sessionId) ?? [],
    })),
  };
}

export function serializeWorkout(row: McpWorkoutRow, now = new Date()) {
  const durationMs = row.finishedAt
    ? row.finishedAt.getTime() - row.startedAt.getTime()
    : now.getTime() - row.startedAt.getTime();
  const durationHours = Math.max(0, durationMs / HOUR_MS);
  const stale = classifyStaleSession(row.startedAt, row.finishedAt, now);
  const grouped = new Map<
    string,
    {
      exerciseId: string;
      exerciseName: string;
      sets: McpWorkoutRow['sets'];
    }
  >();
  for (const set of row.sets) {
    const existing = grouped.get(set.exerciseId);
    if (existing) existing.sets.push(set);
    else {
      grouped.set(set.exerciseId, {
        exerciseId: set.exerciseId,
        exerciseName: set.exercise.name,
        sets: [set],
      });
    }
  }

  return {
    sessionId: row.id,
    gym: row.gym,
    program: row.program,
    workout: row.workout,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    durationMin: Math.round(durationHours * 60 * 10) / 10,
    sessionRpe: row.sessionRpe,
    notes: row.notes,
    exerciseCount: row.exerciseMemberships.length || grouped.size,
    setCount: row.sets.length,
    isStale: stale.isStale,
    staleClassification: stale.classification,
    staleReason: stale.reason,
    staleThresholds: {
      openHours: STALE_OPEN_HOURS,
      finishedHours: STALE_FINISHED_HOURS,
      multiDayHours: MULTI_DAY_HOURS,
      semantics:
        'Engineering data-quality heuristic for forgotten/corrupt sessions, not a training-duration safety rule.',
    },
    exerciseMemberships: row.exerciseMemberships.map((membership) => ({
      exerciseId: membership.exerciseId,
      exerciseName: membership.exercise.name,
      ordinal: membership.ordinal,
    })),
    exercises: [...grouped.values()].map((exercise) => ({
      exerciseId: exercise.exerciseId,
      exerciseName: exercise.exerciseName,
      sets: exercise.sets.map((set) => ({
        setId: set.id,
        setNumber: set.setNumber,
        weightKg: set.weight,
        reps: set.reps,
        rir: set.rir,
        isWarmup: set.isWarmup,
        isDropSet: set.isDropSet,
        recoverySec: set.recoverySec,
        notes: set.notes,
        completedAt: set.completedAt.toISOString(),
        equipment: set.gymEquipment
          ? { id: set.gymEquipment.id, name: set.gymEquipment.name }
          : set.equipmentNameSnapshot
            ? { id: set.gymEquipmentId, name: set.equipmentNameSnapshot }
            : null,
      })),
    })),
  };
}

export function classifyStaleSession(startedAt: Date, finishedAt: Date | null, now = new Date()) {
  const end = finishedAt ?? now;
  const hours = Math.max(0, (end.getTime() - startedAt.getTime()) / HOUR_MS);
  if (!finishedAt && hours >= STALE_OPEN_HOURS) {
    return {
      isStale: true,
      classification: 'STALE_OPEN_SESSION' as const,
      reason: `Session has remained open for ${round(hours, 1)} hours.`,
    };
  }
  if (finishedAt && hours >= MULTI_DAY_HOURS) {
    return {
      isStale: true,
      classification: 'STALE_MULTI_DAY_SESSION' as const,
      reason: `Session spans ${round(hours, 1)} hours across multiple days.`,
    };
  }
  if (finishedAt && hours >= STALE_FINISHED_HOURS) {
    return {
      isStale: true,
      classification: 'SUSPICIOUSLY_LONG_SESSION' as const,
      reason: `Session duration is ${round(hours, 1)} hours.`,
    };
  }
  return {
    isStale: false,
    classification: 'NORMAL_DURATION' as const,
    reason: null,
  };
}

function buildOverlapMap(rows: McpWorkoutRow[]) {
  const output = new Map<string, string[]>();
  for (let i = 0; i < rows.length; i += 1) {
    const left = rows[i]!;
    const leftEnd = left.finishedAt ?? left.startedAt;
    for (let j = i + 1; j < rows.length; j += 1) {
      const right = rows[j]!;
      const rightEnd = right.finishedAt ?? right.startedAt;
      if (left.startedAt < rightEnd && right.startedAt < leftEnd) {
        output.set(left.id, [...(output.get(left.id) ?? []), right.id]);
        output.set(right.id, [...(output.get(right.id) ?? []), left.id]);
      }
    }
  }
  return output;
}

function dateOnlyUtcRange(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Invalid date-only value: ${value}`);
  const from = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(from.getTime()) || from.toISOString().slice(0, 10) !== value) {
    throw new Error(`Invalid calendar date: ${value}`);
  }
  const to = new Date(from);
  to.setUTCDate(to.getUTCDate() + 1);
  return { from, to };
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
