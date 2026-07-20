import type {
  Exercise,
  Gym,
  GymExerciseConfig,
  MuscleGroup,
  ProgramExercise,
} from '@/lib/prisma-client';
import { db } from '@/lib/db';
import {
  resolveExerciseInventory,
  type EquipmentLoadProfile,
  type GymLoadConstraints,
} from '@/lib/gym-loads';
import {
  BASELINE_MUSCLE_VOLUME_DAYS,
  calculateReturnRecommendation,
  RECENT_MUSCLE_VOLUME_DAYS,
  type ReturnHistorySession,
  type ReturnRecommendation,
  type ReturnTrainingHistory,
} from '@/lib/return-to-training';

type ProgramExerciseForReturn = Pick<
  ProgramExercise,
  'id' | 'exerciseId' | 'targetSets' | 'targetRepsMin' | 'targetRIR'
> & {
  exercise: Pick<
    Exercise,
    'name' | 'category' | 'equipmentType' | 'usesBodyweight' | 'muscleGroup'
  >;
};

type GymForReturn = Pick<Gym, 'dumbbellWeights' | 'plateWeights' | 'barWeights'> & {
  id?: Gym['id'];
  inventoryMode?: Gym['inventoryMode'];
  exerciseConfigs: Array<
    Pick<
      GymExerciseConfig,
      | 'exerciseId'
      | 'isAvailable'
      | 'weightOptions'
      | 'dumbbellWeights'
      | 'plateWeights'
      | 'barWeights'
    > & {
      preferredEquipmentId?: string | null;
      systemProfileSupported?: boolean | null;
    }
  >;
  equipment?: Array<{
    id: string;
    name: string;
    equipmentType: Exercise['equipmentType'];
    loadType: EquipmentLoadProfile['loadType'];
    weightOptions: number[];
    selectedLoadMultiplier: number;
    baseLoadKg: number;
    loadingSides: number;
    platePoolId: string | null;
    platePool: {
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

interface ExerciseHistoryRow {
  sessionId: string;
  setNumber: number;
  weight: number;
  reps: number;
  rir: number | null;
  isDropSet: boolean;
  gymEquipmentId: string | null;
  equipmentNameSnapshot: string | null;
  equipmentLoadSnapshot: unknown;
  completedAt: Date;
  session: { startedAt: Date; gymId: string | null };
}

interface HistoricalSetWithOrder {
  setNumber: number;
  weight: number;
  reps: number;
  rir: number | null;
  isDropSet: boolean;
}

export interface EquipmentReturnRecommendation {
  gymId: string | null;
  gymEquipmentId: string | null;
  recommendation: ReturnRecommendation;
}

interface ReturnHistoryData {
  exerciseRows: Map<string, ExerciseHistoryRow[]>;
  latestByMuscle: Map<MuscleGroup, Date | null>;
  recentSetsByMuscle: Map<MuscleGroup, number>;
  baselineSetsByMuscle: Map<MuscleGroup, number>;
}

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

  const historyData = await loadReturnHistoryData({
    userId,
    programExercises,
    excludeSessionId,
    now,
  });

  return Object.fromEntries(
    programExercises.map((pe) => {
      const rows = historyData.exerciseRows.get(pe.exerciseId) ?? [];
      const targets = equipmentTargetsFor(pe, gym);
      const exactTarget = targets.length === 1 ? targets[0] : null;
      const matchingRows = exactTarget
        ? rows.filter(
            (row) =>
              row.session.gymId === exactTarget.gymId &&
              isComparableEquipmentHistory(row, exactTarget.gymEquipmentId),
          )
        : [];
      return [
        pe.id,
        calculateReturnRecommendation({
          programExercise: pe,
          history: buildReturnHistory(pe, matchingRows, rows, historyData),
          now,
          bodyweight,
          loadConstraints: loadConstraintsFor(pe, gym, exactTarget?.gymEquipmentId),
        }),
      ];
    }),
  );
}

// The web runner can switch between multiple physical machines for one
// exercise, so it needs a separate return recommendation for every exact
// equipment identity. A newer Cable B history must not supply Cable A targets
// or its weight ceiling. Null history is retained only for legacy/no-equipment
// paths.
export async function getReturnToTrainingRecommendationsByEquipment({
  userId,
  programExercises,
  excludeSessionId,
  now,
  bodyweight = null,
  gym = null,
}: ReturnRecommendationQuery): Promise<Record<string, EquipmentReturnRecommendation[]>> {
  if (programExercises.length === 0) return {};

  const historyData = await loadReturnHistoryData({
    userId,
    programExercises,
    excludeSessionId,
    now,
  });

  return Object.fromEntries(
    programExercises.map((pe) => [
      pe.id,
      equipmentTargetsFor(pe, gym).map((target) => ({
        gymId: target.gymId,
        gymEquipmentId: target.gymEquipmentId,
        recommendation: calculateReturnRecommendation({
          programExercise: pe,
          history: buildReturnHistory(
            pe,
            (historyData.exerciseRows.get(pe.exerciseId) ?? []).filter(
              (row) =>
                row.session.gymId === target.gymId &&
                isComparableEquipmentHistory(row, target.gymEquipmentId),
            ),
            historyData.exerciseRows.get(pe.exerciseId) ?? [],
            historyData,
          ),
          now,
          bodyweight,
          loadConstraints: loadConstraintsFor(pe, gym, target.gymEquipmentId),
        }),
      })),
    ]),
  );
}

async function loadReturnHistoryData({
  userId,
  programExercises,
  excludeSessionId,
  now,
}: Pick<
  ReturnRecommendationQuery,
  'userId' | 'programExercises' | 'excludeSessionId' | 'now'
>): Promise<ReturnHistoryData> {
  const exerciseIds = [...new Set(programExercises.map((item) => item.exerciseId))];
  const muscleGroups = [...new Set(programExercises.map((item) => item.exercise.muscleGroup))];
  const excludedSession = excludeSessionId ? { id: { not: excludeSessionId } } : {};
  const baselineStart = new Date(
    now.getTime() - (RECENT_MUSCLE_VOLUME_DAYS + BASELINE_MUSCLE_VOLUME_DAYS) * 86_400_000,
  );
  const recentStart = new Date(now.getTime() - RECENT_MUSCLE_VOLUME_DAYS * 86_400_000);

  const [exerciseEntries, muscleLatestEntries, volumeRows] = await Promise.all([
    Promise.all(
      exerciseIds.map(async (exerciseId) => {
        const rows = await db.set.findMany({
          where: {
            exerciseId,
            isWarmup: false,
            isDropSet: false,
            reps: { gt: 0 },
            weight: { gte: 0 },
            completedAt: { lt: now },
            session: {
              userId,
              ...excludedSession,
            },
          },
          orderBy: { completedAt: 'desc' },
          select: {
            sessionId: true,
            setNumber: true,
            weight: true,
            reps: true,
            rir: true,
            isDropSet: true,
            gymEquipmentId: true,
            equipmentNameSnapshot: true,
            equipmentLoadSnapshot: true,
            completedAt: true,
            session: { select: { startedAt: true, gymId: true } },
          },
        });
        return [exerciseId, rows] as const;
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
            session: { userId, ...excludedSession },
            exercise: { muscleGroup, category: { not: 'CARDIO' } },
          },
          orderBy: { completedAt: 'desc' },
          select: { completedAt: true },
        });
        return [muscleGroup, row?.completedAt ?? null] as const;
      }),
    ),
    db.set.findMany({
      where: {
        isWarmup: false,
        isDropSet: false,
        reps: { gt: 0 },
        completedAt: { gte: baselineStart, lt: now },
        session: { userId, ...excludedSession },
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

  return {
    exerciseRows: new Map<string, ExerciseHistoryRow[]>(exerciseEntries),
    latestByMuscle,
    recentSetsByMuscle,
    baselineSetsByMuscle,
  };
}

function buildReturnHistory(
  pe: ProgramExerciseForReturn,
  rows: ExerciseHistoryRow[],
  allExerciseRows: ExerciseHistoryRow[],
  data: ReturnHistoryData,
): ReturnTrainingHistory {
  const baselineSets = data.baselineSetsByMuscle.get(pe.exercise.muscleGroup) ?? 0;
  const comparableSessionIds = new Set(rows.map((row) => row.sessionId));
  const nonComparableSessionIds = new Set(
    allExerciseRows
      .filter((row) => !comparableSessionIds.has(row.sessionId))
      .map((row) => row.sessionId),
  );
  return {
    exerciseLastPerformedAt: rows[0]?.completedAt ?? null,
    muscleLastPerformedAt: data.latestByMuscle.get(pe.exercise.muscleGroup) ?? null,
    recentMuscleSets: data.recentSetsByMuscle.get(pe.exercise.muscleGroup) ?? 0,
    baselineMuscleSetsPer28Days:
      baselineSets * (RECENT_MUSCLE_VOLUME_DAYS / BASELINE_MUSCLE_VOLUME_DAYS),
    exerciseSessions: groupHistoricalSessions(rows),
    nonComparableExerciseSessions: nonComparableSessionIds.size,
  };
}

function groupHistoricalSessions(rows: ExerciseHistoryRow[]): ReturnHistorySession[] {
  const sessions = new Map<
    string,
    Omit<ReturnHistorySession, 'sets'> & { sets: HistoricalSetWithOrder[] }
  >();
  for (const row of rows) {
    let session = sessions.get(row.sessionId);
    if (!session) {
      session = {
        sessionId: row.sessionId,
        performedAt: row.completedAt,
        sets: [],
      };
      sessions.set(row.sessionId, session);
    }
    session.sets.push({
      setNumber: row.setNumber,
      weight: row.weight,
      reps: row.reps,
      rir: row.rir,
      isDropSet: row.isDropSet,
    });
  }

  return [...sessions.values()].map((session) => ({
    sessionId: session.sessionId,
    performedAt: session.performedAt,
    sets: [...session.sets]
      .sort((left, right) => left.setNumber - right.setNumber)
      .map(({ weight, reps, rir, isDropSet }) => ({ weight, reps, rir, isDropSet })),
  }));
}

function isComparableEquipmentHistory(
  row: ExerciseHistoryRow,
  gymEquipmentId: string | null,
): boolean {
  if (gymEquipmentId != null) return row.gymEquipmentId === gymEquipmentId;
  return (
    row.gymEquipmentId == null &&
    row.equipmentNameSnapshot == null &&
    row.equipmentLoadSnapshot == null
  );
}

function loadConstraintsFor(
  pe: ProgramExerciseForReturn,
  gym: GymForReturn | null,
  gymEquipmentId?: string | null,
): GymLoadConstraints | null {
  if (!gym) return null;
  const config = gym.exerciseConfigs.find((item) => item.exerciseId === pe.exerciseId);
  const linkedEquipment: EquipmentLoadProfile[] = (gym.equipment ?? [])
    .filter((item) => item.exerciseLinks.some((link) => link.exerciseId === pe.exerciseId))
    .map((item) => ({
      equipmentId: item.id,
      equipmentName: item.name,
      equipmentType: item.equipmentType,
      loadType: item.loadType,
      weightOptions: item.weightOptions,
      selectedLoadMultiplier: item.selectedLoadMultiplier,
      baseLoadKg: item.baseLoadKg,
      loadingSides: item.loadingSides,
      platePoolId: item.platePoolId,
      platePoolName: item.platePool?.name ?? null,
      plates: item.platePool?.plates ?? [],
    }));
  const inventory = resolveExerciseInventory({
    inventoryMode: gym.inventoryMode ?? 'LEGACY',
    exercise: {
      id: pe.exerciseId,
      name: pe.exercise.name,
      equipmentType: pe.exercise.equipmentType,
    },
    linkedEquipment,
    preferredEquipmentId: config?.preferredEquipmentId ?? null,
    legacyConfig: config,
    sharedDumbbellWeights: gym.dumbbellWeights,
    legacyPlateWeights: gym.plateWeights,
    legacyBarWeights: gym.barWeights,
  });
  return gymEquipmentId && inventory.source === 'equipment'
    ? { ...inventory.constraints, equipmentId: gymEquipmentId }
    : inventory.constraints;
}

function equipmentTargetsFor(
  pe: ProgramExerciseForReturn,
  gym: GymForReturn | null,
): Array<{ gymId: string | null; gymEquipmentId: string | null }> {
  const equipmentIds = (gym?.equipment ?? [])
    .filter((item) => item.exerciseLinks.some((link) => link.exerciseId === pe.exerciseId))
    .map((item) => item.id);
  return equipmentIds.length > 0
    ? equipmentIds.map((gymEquipmentId) => ({ gymId: gym?.id ?? null, gymEquipmentId }))
    : [{ gymId: gym?.id ?? null, gymEquipmentId: null }];
}
