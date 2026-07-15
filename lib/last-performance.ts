import { db } from '@/lib/db';

export interface LastPerformance {
  exerciseId: string;
  // The most recent previous session for this exercise (excluding the current session).
  sessionId: string;
  sessionStartedAt: Date;
  gymEquipmentId: string | null;
  equipmentName: string | null;
  sets: {
    weight: number;
    reps: number;
    rir: number | null;
    isDropSet: boolean;
    gymEquipmentId: string | null;
    nominalResistanceKg: number | null;
  }[];
  // Best load of the session (handy for a quick display).
  maxWeight: number;
  // Reps at that max load (the highest rep count reached at maxWeight).
  repsAtMaxWeight: number;
  // Cardio totals for the session (issue #176): summed duration/distance and
  // an averaged heart rate across the session's cardio sets. Null for strength
  // exercises (no cardio sets), so the session UI can branch on `cardio`.
  cardio: { durationSec: number; distanceM: number; avgHr: number | null } | null;
}

export interface EquipmentPerformanceTarget {
  exerciseId: string;
  gymEquipmentId: string | null;
}

interface EquipmentTargetGym {
  equipment?: Array<{
    id: string;
    exerciseLinks: Array<{ exerciseId: string }>;
  }>;
}

export function buildEquipmentPerformanceTargets(
  exerciseIds: string[],
  gym: EquipmentTargetGym | null | undefined,
): EquipmentPerformanceTarget[] {
  return exerciseIds.flatMap<EquipmentPerformanceTarget>((exerciseId) => {
    const linkedEquipment =
      gym?.equipment?.filter((equipment) =>
        equipment.exerciseLinks.some((link) => link.exerciseId === exerciseId),
      ) ?? [];
    if (linkedEquipment.length > 0) {
      return linkedEquipment.map((equipment) => ({
        exerciseId,
        gymEquipmentId: equipment.id,
      }));
    }
    return [{ exerciseId, gymEquipmentId: null }];
  });
}

// Fetches the previous performances for a list of exerciseIds, excluding the
// current session. For each exercise, we take the most recent session that
// contains it, then pull up all of its non-warmup sets.
export async function getLastPerformances(
  userId: string,
  exerciseIds: string[],
  excludeSessionId: string | null,
): Promise<Map<string, LastPerformance>> {
  if (exerciseIds.length === 0) return new Map();

  const result = new Map<string, LastPerformance>();

  // For each exercise: find the most recent set (excluding the current session,
  // excluding warmups), get its sessionId, then all the sets of that session
  // for this exercise.
  await Promise.all(
    exerciseIds.map(async (exerciseId) => {
      const performance = await getLastPerformance(userId, { exerciseId }, excludeSessionId);
      if (performance) result.set(exerciseId, performance);
    }),
  );

  return result;
}

// Equipment-first workout screens need one independent previous performance
// for every selectable machine. Filtering only the rows after finding the
// latest exercise session is insufficient because a newer Cable B session
// would hide an older Cable A session. The equipment identity therefore
// participates in the initial findFirst query.
export async function getLastPerformancesForEquipmentTargets(
  userId: string,
  targets: EquipmentPerformanceTarget[],
  excludeSessionId: string | null,
): Promise<LastPerformance[]> {
  const uniqueTargets = [
    ...new Map(
      targets.map((target) => [`${target.exerciseId}\u0000${target.gymEquipmentId ?? ''}`, target]),
    ).values(),
  ];

  const performances = await Promise.all(
    uniqueTargets.map((target) => getLastPerformance(userId, target, excludeSessionId)),
  );
  return performances.filter((performance): performance is LastPerformance => performance != null);
}

async function getLastPerformance(
  userId: string,
  target: { exerciseId: string; gymEquipmentId?: string | null },
  excludeSessionId: string | null,
): Promise<LastPerformance | null> {
  const filtersEquipment = Object.prototype.hasOwnProperty.call(target, 'gymEquipmentId');
  const lastSet = await db.set.findFirst({
    where: {
      exerciseId: target.exerciseId,
      isWarmup: false,
      ...(filtersEquipment ? { gymEquipmentId: target.gymEquipmentId ?? null } : {}),
      ...(excludeSessionId ? { sessionId: { not: excludeSessionId } } : {}),
      session: { userId },
    },
    orderBy: { completedAt: 'desc' },
    include: { session: { select: { startedAt: true, id: true } } },
  });
  if (!lastSet) return null;

  const rows = await db.set.findMany({
    where: {
      sessionId: lastSet.sessionId,
      exerciseId: target.exerciseId,
      isWarmup: false,
      gymEquipmentId: lastSet.gymEquipmentId,
    },
    orderBy: { setNumber: 'asc' },
    select: {
      weight: true,
      reps: true,
      rir: true,
      durationSec: true,
      distanceM: true,
      avgHr: true,
      isDropSet: true,
      gymEquipmentId: true,
      nominalResistanceKg: true,
    },
  });

  const sets = rows.map(
    ({ weight, reps, rir, isDropSet, gymEquipmentId, nominalResistanceKg }) => ({
      weight,
      reps,
      rir,
      isDropSet,
      gymEquipmentId,
      nominalResistanceKg,
    }),
  );

  const maxWeight = Math.max(...sets.map((set) => set.weight));
  const repsAtMaxWeight = Math.max(
    ...sets.filter((set) => set.weight === maxWeight).map((set) => set.reps),
  );

  // Cardio totals (issue #176): a cardio set carries durationSec != null.
  // Sum duration/distance over the session's cardio sets and average the
  // heart rate across the sets that recorded one. Null when there are no
  // cardio sets (a strength exercise), so the UI branches cleanly.
  const cardioRows = rows.filter((row) => row.durationSec != null);
  let cardio: LastPerformance['cardio'] = null;
  if (cardioRows.length > 0) {
    const durationSec = cardioRows.reduce((acc, row) => acc + (row.durationSec ?? 0), 0);
    const distanceM = cardioRows.reduce((acc, row) => acc + (row.distanceM ?? 0), 0);
    const hrRows = cardioRows.filter((row) => row.avgHr != null);
    const avgHr =
      hrRows.length > 0
        ? Math.round(hrRows.reduce((acc, row) => acc + (row.avgHr ?? 0), 0) / hrRows.length)
        : null;
    cardio = { durationSec, distanceM, avgHr };
  }

  return {
    exerciseId: target.exerciseId,
    sessionId: lastSet.session.id,
    sessionStartedAt: lastSet.session.startedAt,
    gymEquipmentId: lastSet.gymEquipmentId,
    equipmentName: lastSet.equipmentNameSnapshot,
    sets,
    maxWeight,
    repsAtMaxWeight,
    cardio,
  };
}
