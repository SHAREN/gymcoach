import type {
  BarbellDiameterFamily,
  EquipmentLoadType,
  Exercise,
  Gym,
  GymExerciseConfig,
  MuscleGroup,
  ProgramExercise,
} from '@/lib/prisma-client';
import { db } from '@/lib/db';
import {
  resolveEquipmentLoadProfile,
  type GymLoadConstraints,
} from '@/lib/gym-loads';
import {
  BASELINE_MUSCLE_VOLUME_DAYS,
  calculateReturnRecommendation,
  RECENT_MUSCLE_VOLUME_DAYS,
  RETURN_LONG_TERM_ANCHOR_SESSION_LIMIT,
  type ReturnHistorySession,
  type ReturnRecommendation,
  type ReturnTrainingHistory,
} from '@/lib/return-to-training';

type ProgramExerciseForReturn = Pick<
  ProgramExercise,
  'id' | 'exerciseId' | 'targetSets' | 'targetRepsMin' | 'targetRIR'
> & {
  exercise: Pick<Exercise, 'category' | 'equipmentType' | 'usesBodyweight' | 'muscleGroup'>;
};

type GymForReturn = Pick<Gym, 'dumbbellWeights' | 'plateWeights' | 'barWeights'> & {
  id?: Gym['id'];
  exerciseConfigs: Array<
    Pick<GymExerciseConfig, 'exerciseId' | 'isAvailable' | 'weightOptions'> & {
      preferredEquipmentId?: string | null;
    }
  >;
  equipment?: Array<{
    id: string;
    name: string;
    equipmentType: Exercise['equipmentType'];
    loadConfigurationKnown: boolean;
    loadType: EquipmentLoadType;
    weightOptions: number[];
    selectedLoadMultiplier: number;
    baseLoadKg: number;
    platePoolId: string | null;
    loadingSides: number;
    systemBarbellFamily: BarbellDiameterFamily | null;
    platePool: {
      id: string;
      name: string;
      plates: Array<{ weightKg: number; quantity: number | null }>;
    } | null;
    exerciseLinks: Array<{ exerciseId: string }>;
  }>;
};

interface ReturnRecommendationQuery {
  userId: string;
  programExercises: ProgramExerciseForReturn[];
  excludeSessionId: string | null;
  now: Date;
  bodyweight?: number | null;
  gym?: GymForReturn | null;
}

interface BoundedExerciseHistory {
  lastPerformedAt: Date | null;
  sessions: ReturnHistorySession[];
}

export interface EquipmentReturnRecommendation {
  gymId: string | null;
  gymEquipmentId: string | null;
  recommendation: ReturnRecommendation;
}

interface EquipmentTarget {
  gymId: string | null;
  gymEquipmentId: string | null;
}

// Detailed load anchors older than ten years are intentionally ignored. The
// latest-performance lookup remains unbounded and indexed, so an older real
// performance still activates return calibration; it simply falls back to a
// conservative load instead of mining an arbitrarily large history.
export const RETURN_HISTORY_LOOKBACK_DAYS = 3650;

// Builds session-only return recommendations. Nothing is persisted to the
// program: the active runner applies these targets while this session is open.
export async function getReturnToTrainingRecommendations({
  userId,
  programExercises,
  excludeSessionId,
  now,
  bodyweight = null,
  gym = null,
}: ReturnRecommendationQuery): Promise<Record<string, ReturnRecommendation>> {
  if (programExercises.length === 0) return {};

  const exerciseIds = [...new Set(programExercises.map((item) => item.exerciseId))];
  const muscleGroups = [...new Set(programExercises.map((item) => item.exercise.muscleGroup))];
  const excludedSession = excludeSessionId ? { id: { not: excludeSessionId } } : {};
  const historyStart = new Date(now.getTime() - RETURN_HISTORY_LOOKBACK_DAYS * 86_400_000);
  const baselineStart = new Date(
    now.getTime() - (RECENT_MUSCLE_VOLUME_DAYS + BASELINE_MUSCLE_VOLUME_DAYS) * 86_400_000,
  );
  const recentStart = new Date(now.getTime() - RECENT_MUSCLE_VOLUME_DAYS * 86_400_000);

  const [exerciseEntries, muscleLatestEntries, volumeRows] = await Promise.all([
    Promise.all(
      exerciseIds.map(async (exerciseId) => {
        const workingSetFilter = {
          exerciseId,
          isWarmup: false,
          isDropSet: false,
          reps: { gt: 0 },
          weight: { gte: 0 },
          completedAt: { lt: now },
        } as const;

        // Both queries are bounded in what they return. The indexed latest-set
        // lookup preserves knowledge of arbitrarily old real exercise history,
        // while only the newest sessions needed by the anchor algorithm are
        // loaded with their sets.
        const [latestSet, sessions] = await Promise.all([
          db.set.findFirst({
            where: {
              ...workingSetFilter,
              session: { userId, finishedAt: { not: null }, ...excludedSession },
            },
            orderBy: { completedAt: 'desc' },
            select: { session: { select: { startedAt: true } } },
          }),
          db.session.findMany({
            where: {
              userId,
              finishedAt: { not: null },
              ...excludedSession,
              startedAt: { gte: historyStart, lt: now },
              sets: { some: workingSetFilter },
            },
            orderBy: { startedAt: 'desc' },
            take: RETURN_LONG_TERM_ANCHOR_SESSION_LIMIT,
            select: {
              id: true,
              startedAt: true,
              sets: {
                where: workingSetFilter,
                orderBy: { setNumber: 'asc' },
                select: {
                  setNumber: true,
                  weight: true,
                  reps: true,
                  rir: true,
                  isDropSet: true,
                },
              },
            },
          }),
        ]);

        const history: BoundedExerciseHistory = {
          lastPerformedAt: latestSet?.session.startedAt ?? null,
          sessions: sessions.map((session) => ({
            sessionId: session.id,
            performedAt: session.startedAt,
            sets: session.sets.map(({ weight, reps, rir, isDropSet }) => ({
              weight,
              reps,
              rir,
              isDropSet,
            })),
          })),
        };
        return [exerciseId, history] as const;
      }),
    ),
    Promise.all(
      muscleGroups.map(async (muscleGroup) => {
        const row = await db.set.findFirst({
          where: {
            isWarmup: false,
            isDropSet: false,
            reps: { gt: 0 },
            completedAt: { lt: now },
            session: { userId, finishedAt: { not: null }, ...excludedSession },
            exercise: { muscleGroup, category: { not: 'CARDIO' } },
          },
          orderBy: { completedAt: 'desc' },
          select: { session: { select: { startedAt: true } } },
        });
        return [muscleGroup, row?.session.startedAt ?? null] as const;
      }),
    ),
    db.set.findMany({
      where: {
        isWarmup: false,
        isDropSet: false,
        reps: { gt: 0 },
        completedAt: { gte: baselineStart, lt: now },
        session: { userId, finishedAt: { not: null }, ...excludedSession },
        exercise: {
          muscleGroup: { in: muscleGroups },
          category: { not: 'CARDIO' },
        },
      },
      select: {
        completedAt: true,
        exercise: { select: { muscleGroup: true } },
      },
    }),
  ]);

  const historiesByExercise = new Map<string, ReturnTrainingHistory>();
  const latestByMuscle = new Map<MuscleGroup, Date | null>(muscleLatestEntries);
  const recentSetsByMuscle = new Map<MuscleGroup, number>();
  const baselineSetsByMuscle = new Map<MuscleGroup, number>();

  for (const row of volumeRows) {
    const target = row.completedAt >= recentStart ? recentSetsByMuscle : baselineSetsByMuscle;
    const group = row.exercise.muscleGroup;
    target.set(group, (target.get(group) ?? 0) + 1);
  }

  const exerciseHistory = new Map<string, BoundedExerciseHistory>(exerciseEntries);
  for (const pe of programExercises) {
    if (historiesByExercise.has(pe.exerciseId)) continue;
    const history = exerciseHistory.get(pe.exerciseId) ?? { lastPerformedAt: null, sessions: [] };
    const baselineSets = baselineSetsByMuscle.get(pe.exercise.muscleGroup) ?? 0;
    historiesByExercise.set(pe.exerciseId, {
      exerciseLastPerformedAt: history.lastPerformedAt,
      muscleLastPerformedAt: latestByMuscle.get(pe.exercise.muscleGroup) ?? null,
      recentMuscleSets: recentSetsByMuscle.get(pe.exercise.muscleGroup) ?? 0,
      baselineMuscleSetsPer28Days:
        baselineSets * (RECENT_MUSCLE_VOLUME_DAYS / BASELINE_MUSCLE_VOLUME_DAYS),
      exerciseSessions: history.sessions,
    });
  }

  return Object.fromEntries(
    programExercises.map((pe) => [
      pe.id,
      calculateReturnRecommendation({
        programExercise: pe,
        history: historiesByExercise.get(pe.exerciseId)!,
        now,
        bodyweight,
        loadConstraints: loadConstraintsFor(pe, gym),
      }),
    ]),
  );
}

export async function getReturnToTrainingRecommendationsByEquipment({
  userId,
  programExercises,
  excludeSessionId,
  now,
  bodyweight = null,
  gym = null,
}: ReturnRecommendationQuery): Promise<Record<string, EquipmentReturnRecommendation[]>> {
  if (programExercises.length === 0) return {};

  const muscleGroups = [...new Set(programExercises.map((item) => item.exercise.muscleGroup))];
  const excludedSession = excludeSessionId ? { id: { not: excludeSessionId } } : {};
  const historyStart = new Date(now.getTime() - RETURN_HISTORY_LOOKBACK_DAYS * 86_400_000);
  const baselineStart = new Date(
    now.getTime() - (RECENT_MUSCLE_VOLUME_DAYS + BASELINE_MUSCLE_VOLUME_DAYS) * 86_400_000,
  );
  const recentStart = new Date(now.getTime() - RECENT_MUSCLE_VOLUME_DAYS * 86_400_000);

  const [muscleLatestEntries, volumeRows] = await Promise.all([
    Promise.all(
      muscleGroups.map(async (muscleGroup) => {
        const row = await db.set.findFirst({
          where: {
            isWarmup: false,
            isDropSet: false,
            reps: { gt: 0 },
            completedAt: { lt: now },
            session: { userId, finishedAt: { not: null }, ...excludedSession },
            exercise: { muscleGroup, category: { not: 'CARDIO' } },
          },
          orderBy: { completedAt: 'desc' },
          select: { session: { select: { startedAt: true } } },
        });
        return [muscleGroup, row?.session.startedAt ?? null] as const;
      }),
    ),
    db.set.findMany({
      where: {
        isWarmup: false,
        isDropSet: false,
        reps: { gt: 0 },
        completedAt: { gte: baselineStart, lt: now },
        session: { userId, finishedAt: { not: null }, ...excludedSession },
        exercise: {
          muscleGroup: { in: muscleGroups },
          category: { not: 'CARDIO' },
        },
      },
      select: {
        completedAt: true,
        exercise: { select: { muscleGroup: true } },
      },
    }),
  ]);

  const latestByMuscle = new Map<MuscleGroup, Date | null>(muscleLatestEntries);
  const recentSetsByMuscle = new Map<MuscleGroup, number>();
  const baselineSetsByMuscle = new Map<MuscleGroup, number>();
  for (const row of volumeRows) {
    const target = row.completedAt >= recentStart ? recentSetsByMuscle : baselineSetsByMuscle;
    const group = row.exercise.muscleGroup;
    target.set(group, (target.get(group) ?? 0) + 1);
  }

  const entries = await Promise.all(
    programExercises.map(async (pe) => {
      const workingSetFilter = {
        exerciseId: pe.exerciseId,
        isWarmup: false,
        isDropSet: false,
        reps: { gt: 0 },
        weight: { gte: 0 },
        completedAt: { lt: now },
      } as const;
      const targets = equipmentTargetsFor(pe, gym);
      const historyGymId = gym?.id ?? null;
      const [latestAnyEquipmentSet, recentExerciseSessions] = await Promise.all([
        db.set.findFirst({
          where: {
            ...workingSetFilter,
            session: {
              userId,
              gymId: historyGymId,
              finishedAt: { not: null },
              ...excludedSession,
            },
          },
          orderBy: { completedAt: 'desc' },
          select: { session: { select: { startedAt: true } } },
        }),
        db.session.findMany({
          where: {
            userId,
            gymId: historyGymId,
            finishedAt: { not: null },
            ...excludedSession,
            startedAt: { gte: historyStart, lt: now },
            sets: { some: workingSetFilter },
          },
          orderBy: { startedAt: 'desc' },
          take: RETURN_LONG_TERM_ANCHOR_SESSION_LIMIT,
          select: { id: true },
        }),
      ]);
      const recentExerciseSessionIds = new Set(recentExerciseSessions.map((item) => item.id));
      const baselineSets = baselineSetsByMuscle.get(pe.exercise.muscleGroup) ?? 0;

      const recommendations = await Promise.all(
        targets.map(async (target) => {
          const equipmentFilter = comparableEquipmentFilter(target.gymEquipmentId);
          const targetSessionFilter = {
            userId,
            gymId: target.gymId,
            finishedAt: { not: null },
            ...excludedSession,
          } as const;
          const [latestSet, sessions] = await Promise.all([
            db.set.findFirst({
              where: {
                ...workingSetFilter,
                ...equipmentFilter,
                session: targetSessionFilter,
              },
              orderBy: { completedAt: 'desc' },
              select: { session: { select: { startedAt: true } } },
            }),
            db.session.findMany({
              where: {
                ...targetSessionFilter,
                startedAt: { gte: historyStart, lt: now },
                sets: { some: { ...workingSetFilter, ...equipmentFilter } },
              },
              orderBy: { startedAt: 'desc' },
              take: RETURN_LONG_TERM_ANCHOR_SESSION_LIMIT,
              select: {
                id: true,
                startedAt: true,
                sets: {
                  where: { ...workingSetFilter, ...equipmentFilter },
                  orderBy: { setNumber: 'asc' },
                  select: {
                    weight: true,
                    reps: true,
                    rir: true,
                    isDropSet: true,
                  },
                },
              },
            }),
          ]);
          const comparableIds = new Set(sessions.map((session) => session.id));
          const nonComparableExerciseSessions = [...recentExerciseSessionIds].filter(
            (sessionId) => !comparableIds.has(sessionId),
          ).length;
          const history: ReturnTrainingHistory = {
            exerciseLastPerformedAt:
              latestSet?.session.startedAt ?? latestAnyEquipmentSet?.session.startedAt ?? null,
            muscleLastPerformedAt: latestByMuscle.get(pe.exercise.muscleGroup) ?? null,
            recentMuscleSets: recentSetsByMuscle.get(pe.exercise.muscleGroup) ?? 0,
            baselineMuscleSetsPer28Days:
              baselineSets * (RECENT_MUSCLE_VOLUME_DAYS / BASELINE_MUSCLE_VOLUME_DAYS),
            exerciseSessions: sessions.map((session) => ({
              sessionId: session.id,
              performedAt: session.startedAt,
              sets: session.sets.map(({ weight, reps, rir, isDropSet }) => ({
                weight,
                reps,
                rir,
                isDropSet,
              })),
            })),
            nonComparableExerciseSessions,
          };
          return {
            gymId: target.gymId,
            gymEquipmentId: target.gymEquipmentId,
            recommendation: calculateReturnRecommendation({
              programExercise: pe,
              history,
              now,
              bodyweight,
              loadConstraints: loadConstraintsForEquipment(pe, gym, target.gymEquipmentId),
            }),
          } satisfies EquipmentReturnRecommendation;
        }),
      );
      return [pe.id, recommendations] as const;
    }),
  );

  return Object.fromEntries(entries);
}

function comparableEquipmentFilter(gymEquipmentId: string | null) {
  return gymEquipmentId
    ? { gymEquipmentId }
    : { gymEquipmentId: null, equipmentNameSnapshot: null };
}

function equipmentTargetsFor(
  pe: ProgramExerciseForReturn,
  gym: GymForReturn | null,
): EquipmentTarget[] {
  const gymId = gym?.id ?? null;
  const equipmentIds = (gym?.equipment ?? [])
    .filter((item) => item.exerciseLinks.some((link) => link.exerciseId === pe.exerciseId))
    .map((item) => item.id);
  // Gym equipment is optional in the clean upstream model. Keep an explicit
  // manual/no-equipment target even when physical items are linked.
  return [
    { gymId, gymEquipmentId: null },
    ...equipmentIds.map((gymEquipmentId) => ({ gymId, gymEquipmentId })),
  ];
}

function loadConstraintsForEquipment(
  pe: ProgramExerciseForReturn,
  gym: GymForReturn | null,
  gymEquipmentId: string | null,
): GymLoadConstraints | null {
  const base = loadConstraintsFor(pe, gym);
  if (!base || !gymEquipmentId || !gym) return base;
  const equipment = (gym.equipment ?? []).find(
    (item) =>
      item.id === gymEquipmentId &&
      item.exerciseLinks.some((link) => link.exerciseId === pe.exerciseId),
  );
  if (!equipment) return base;
  const resolved = resolveEquipmentLoadProfile({
    equipmentId: equipment.id,
    equipmentName: equipment.name,
    equipmentType: equipment.equipmentType,
    loadConfigurationKnown: equipment.loadConfigurationKnown,
    loadType: equipment.loadType,
    weightOptions: equipment.weightOptions,
    selectedLoadMultiplier: equipment.selectedLoadMultiplier,
    baseLoadKg: equipment.baseLoadKg,
    loadingSides: equipment.loadingSides,
    platePoolId: equipment.platePoolId,
    platePoolName: equipment.platePool?.name ?? null,
    plates: equipment.platePool?.plates ?? [],
  });
  return {
    ...base,
    equipmentType: pe.exercise.equipmentType,
    equipmentId: equipment.id,
    equipmentOptions: [resolved],
    weightOptions: resolved.attainableLoads,
  };
}

function loadConstraintsFor(
  pe: ProgramExerciseForReturn,
  gym: GymForReturn | null,
): GymLoadConstraints | null {
  if (!gym) return null;
  const config = gym.exerciseConfigs.find((item) => item.exerciseId === pe.exerciseId);
  return {
    equipmentType: pe.exercise.equipmentType,
    isAvailable: config?.isAvailable ?? true,
    dumbbellWeights: gym.dumbbellWeights,
    plateWeights: gym.plateWeights,
    barWeights: gym.barWeights,
    weightOptions: config?.weightOptions ?? [],
  };
}
