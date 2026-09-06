import { db } from '@/lib/db';

export interface LastPerformance {
  exerciseId: string;
  sessionId: string;
  sessionStartedAt: Date;
  gymId: string | null;
  gymEquipmentId: string | null;
  equipmentName: string | null;
  sets: { weight: number; reps: number; rir: number | null }[];
  maxWeight: number;
  repsAtMaxWeight: number;
  cardio: { durationSec: number; distanceM: number; avgHr: number | null } | null;
}

export interface EquipmentPerformanceTarget {
  exerciseId: string;
  gymId: string | null;
  gymEquipmentId: string | null;
}

interface EquipmentTargetGym {
  id: string;
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
        gymId: gym?.id ?? null,
        gymEquipmentId: equipment.id,
      }));
    }
    return [{ exerciseId, gymId: gym?.id ?? null, gymEquipmentId: null }];
  });
}

export async function getLastPerformances(
  userId: string,
  exerciseIds: string[],
  excludeSessionId: string | null,
): Promise<Map<string, LastPerformance>> {
  if (exerciseIds.length === 0) return new Map();

  const result = new Map<string, LastPerformance>();
  await Promise.all(
    exerciseIds.map(async (exerciseId) => {
      const performance = await getLastPerformance(userId, { exerciseId }, excludeSessionId);
      if (performance) result.set(exerciseId, performance);
    }),
  );
  return result;
}

export async function getLastPerformancesForEquipmentTargets(
  userId: string,
  targets: EquipmentPerformanceTarget[],
  excludeSessionId: string | null,
): Promise<LastPerformance[]> {
  const uniqueTargets = [
    ...new Map(
      targets.map((target) => [
        [target.exerciseId, target.gymId ?? '', target.gymEquipmentId ?? ''].join('::'),
        target,
      ]),
    ).values(),
  ];

  const performances = await Promise.all(
    uniqueTargets.map((target) => getLastPerformance(userId, target, excludeSessionId)),
  );
  return performances.filter((performance): performance is LastPerformance => performance != null);
}

async function getLastPerformance(
  userId: string,
  target: { exerciseId: string; gymId?: string | null; gymEquipmentId?: string | null },
  excludeSessionId: string | null,
): Promise<LastPerformance | null> {
  const filtersEquipment = Object.prototype.hasOwnProperty.call(target, 'gymEquipmentId');
  const filtersGym = Object.prototype.hasOwnProperty.call(target, 'gymId');
  const lastSet = await db.set.findFirst({
    where: {
      exerciseId: target.exerciseId,
      isWarmup: false,
      ...(filtersEquipment ? { gymEquipmentId: target.gymEquipmentId ?? null } : {}),
      ...(excludeSessionId ? { sessionId: { not: excludeSessionId } } : {}),
      session: {
        userId,
        ...(filtersGym ? { gymId: target.gymId ?? null } : {}),
      },
    },
    orderBy: { completedAt: 'desc' },
    include: { session: { select: { startedAt: true, id: true, gymId: true } } },
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
    },
  });

  const sets = rows.map(({ weight, reps, rir }) => ({ weight, reps, rir }));
  const maxWeight = Math.max(...sets.map((set) => set.weight));
  const repsAtMaxWeight = Math.max(
    ...sets.filter((set) => set.weight === maxWeight).map((set) => set.reps),
  );

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
    gymId: lastSet.session.gymId,
    gymEquipmentId: lastSet.gymEquipmentId,
    equipmentName: lastSet.equipmentNameSnapshot,
    sets,
    maxWeight,
    repsAtMaxWeight,
    cardio,
  };
}
