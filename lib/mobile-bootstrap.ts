import { db } from '@/lib/db';
import { isDeloadActive } from '@/lib/deload';
import {
  buildEquipmentPerformanceTargets,
  getLastPerformances,
  getLastPerformancesForEquipmentTargets,
  type LastPerformance,
} from '@/lib/last-performance';
import { ensureMobileEquipmentSnapshotRevision } from '@/lib/mobile-equipment-snapshot';
import { ensureGymSystemProfiles } from '@/lib/gym-system-profiles';
import { READINESS_RECENCY_HOURS } from '@/lib/progression';
import {
  getReturnToTrainingRecommendations,
  getReturnToTrainingRecommendationsByEquipment,
  type EquipmentReturnRecommendation,
} from '@/lib/return-to-training-history';
import { normalizeCoachingProfile } from '@/lib/schemas/coaching-profile';

export const MOBILE_BOOTSTRAP_SCHEMA_VERSION = 6;
export const MOBILE_CALCULATION_VERSION = '2026-07-16-return-history-v2';
export const MOBILE_EXERCISE_HISTORY_SESSION_LIMIT = 12;

interface MobileExerciseHistoryRow {
  exerciseId: string;
  sessionId: string;
  startedAt: Date;
  setNumber: number;
  weight: number;
  reps: number;
  rir: number | null;
  isDropSet: boolean;
  durationSec: number | null;
  distanceM: number | null;
  avgHr: number | null;
  maxHr: number | null;
}

interface MobileExerciseHistorySession {
  sessionId: string;
  startedAt: string;
  sets: Array<{
    setNumber: number;
    weight: number;
    reps: number;
    rir: number | null;
    isDropSet: boolean;
    durationSec: number | null;
    distanceM: number | null;
    avgHr: number | null;
    maxHr: number | null;
  }>;
}

function serializeMobilePerformance(performance: LastPerformance) {
  return {
    ...performance,
    sessionStartedAt: performance.sessionStartedAt.toISOString(),
  };
}

export function buildMobileEquipmentHistoryContract(
  performances: LastPerformance[],
  returnEntries: Array<readonly [string, Record<string, EquipmentReturnRecommendation[]>]>,
) {
  const lastPerformancesByEquipment: Record<
    string,
    ReturnType<typeof serializeMobilePerformance>[]
  > = {};
  for (const performance of performances) {
    (lastPerformancesByEquipment[performance.exerciseId] ??= []).push(
      serializeMobilePerformance(performance),
    );
  }

  return {
    lastPerformancesByEquipment,
    returnRecommendationsByEquipmentByWorkout: Object.fromEntries(returnEntries),
  };
}

export function mobileWorkoutGymIds(
  activeGymId: string | null,
  openSessions: Array<{ workoutId: string | null; gymId: string | null }>,
  workoutId: string,
): Array<string | null> {
  return mobileHistoryGymIds(
    activeGymId,
    openSessions.filter((session) => session.workoutId === workoutId),
  );
}

export function mobileHistoryGymIds(
  activeGymId: string | null,
  openSessions: Array<{ gymId: string | null }>,
): Array<string | null> {
  return [...new Set([activeGymId, ...openSessions.map((session) => session.gymId)])];
}

export function mergeMobileEquipmentReturnRecommendations(
  recommendationsByGym: Array<Record<string, EquipmentReturnRecommendation[]>>,
): Record<string, EquipmentReturnRecommendation[]> {
  const merged: Record<string, EquipmentReturnRecommendation[]> = {};
  for (const recommendations of recommendationsByGym) {
    for (const [programExerciseId, equipmentRecommendations] of Object.entries(recommendations)) {
      const byEquipmentIdentity = new Map(
        (merged[programExerciseId] ?? []).map((item) => [
          `${item.gymId ?? ''}\u0000${item.gymEquipmentId ?? ''}`,
          item,
        ]),
      );
      for (const item of equipmentRecommendations) {
        const identity = `${item.gymId ?? ''}\u0000${item.gymEquipmentId ?? ''}`;
        if (!byEquipmentIdentity.has(identity)) {
          byEquipmentIdentity.set(identity, item);
        }
      }
      merged[programExerciseId] = [...byEquipmentIdentity.values()];
    }
  }
  return merged;
}

export async function buildMobileBootstrap(userId: string) {
  const ownedGymIds = await db.gym.findMany({ where: { userId }, select: { id: true } });
  await db.$transaction(async (tx) => {
    for (const gym of ownedGymIds) await ensureGymSystemProfiles(tx, userId, gym.id);
  });
  const exerciseHistoryRowsPromise = db.$queryRaw<MobileExerciseHistoryRow[]>`
      WITH exercise_sessions AS (
        SELECT DISTINCT
          logged_set."exerciseId" AS "exerciseId",
          logged_set."sessionId" AS "sessionId",
          training_session."startedAt" AS "startedAt"
        FROM "Set" AS logged_set
        INNER JOIN "Session" AS training_session
          ON training_session.id = logged_set."sessionId"
        WHERE training_session."userId" = ${userId}
          AND training_session."finishedAt" IS NOT NULL
          AND logged_set."isWarmup" = false
      ),
      ranked_exercise_sessions AS (
        SELECT
          "exerciseId",
          "sessionId",
          "startedAt",
          ROW_NUMBER() OVER (
            PARTITION BY "exerciseId"
            ORDER BY "startedAt" DESC, "sessionId" DESC
          ) AS session_rank
        FROM exercise_sessions
      )
      SELECT
        ranked."exerciseId" AS "exerciseId",
        ranked."sessionId" AS "sessionId",
        ranked."startedAt" AS "startedAt",
        logged_set."setNumber" AS "setNumber",
        logged_set.weight,
        logged_set.reps,
        logged_set.rir,
        logged_set."isDropSet" AS "isDropSet",
        logged_set."durationSec" AS "durationSec",
        logged_set."distanceM" AS "distanceM",
        logged_set."avgHr" AS "avgHr",
        logged_set."maxHr" AS "maxHr"
      FROM ranked_exercise_sessions AS ranked
      INNER JOIN "Set" AS logged_set
        ON logged_set."sessionId" = ranked."sessionId"
        AND logged_set."exerciseId" = ranked."exerciseId"
      WHERE ranked.session_rank <= ${MOBILE_EXERCISE_HISTORY_SESSION_LIMIT}
        AND logged_set."isWarmup" = false
      ORDER BY
        ranked."exerciseId" ASC,
        ranked."startedAt" DESC,
        ranked."sessionId" DESC,
        logged_set."setNumber" ASC,
        logged_set."completedAt" ASC,
        logged_set.id ASC
    `;
  const [user, activeProgram, gyms, openSessions, latestReadiness, catalog] = await Promise.all([
    db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        bodyweight: true,
        unit: true,
        activeGymId: true,
        coachingProfile: true,
        coachingProfileUpdatedAt: true,
        deloadUntil: true,
      },
    }),
    db.program.findFirst({
      where: { userId, isActive: true },
      orderBy: { updatedAt: 'desc' },
      include: {
        workouts: {
          orderBy: { order: 'asc' },
          include: {
            exercises: {
              orderBy: { order: 'asc' },
              include: { exercise: true },
            },
          },
        },
      },
    }),
    db.gym.findMany({
      where: { userId },
      orderBy: { name: 'asc' },
      include: {
        exerciseConfigs: true,
        equipment: {
          select: {
            id: true,
            gymId: true,
            name: true,
            equipmentType: true,
            description: true,
            manufacturer: true,
            modelName: true,
            quantity: true,
            loadType: true,
            weightOptions: true,
            selectedLoadMultiplier: true,
            baseLoadKg: true,
            platePoolId: true,
            loadingSides: true,
            systemBarbellFamily: true,
            exerciseLinks: true,
            platePool: { include: { plates: { orderBy: { weightKg: 'asc' } } } },
          },
        },
        platePools: { include: { plates: { orderBy: { weightKg: 'asc' } } } },
      },
    }),
    db.session.findMany({
      where: { userId, finishedAt: null },
      orderBy: { startedAt: 'desc' },
      include: {
        sets: { orderBy: [{ exerciseId: 'asc' }, { setNumber: 'asc' }] },
        workout: {
          include: {
            exercises: {
              orderBy: { order: 'asc' },
              include: { exercise: true },
            },
          },
        },
      },
    }),
    db.readinessCheckin.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    }),
    db.exercise.findMany({
      where: { userId },
      orderBy: [{ muscleGroup: 'asc' }, { name: 'asc' }],
    }),
  ]);
  if (!user) throw new Error('User not found.');
  const exerciseHistoryRows = await exerciseHistoryRowsPromise;

  const mobileGyms = await Promise.all(
    gyms.map(async (gym) => ({
      ...gym,
      equipment: await Promise.all(
        gym.equipment.map(async (equipment) => ({
          ...equipment,
          snapshotRevisionId: await ensureMobileEquipmentSnapshotRevision(db, equipment),
        })),
      ),
    })),
  );

  const activeGym = gyms.find((gym) => gym.id === user.activeGymId) ?? null;
  const gymsById = new Map(gyms.map((gym) => [gym.id, gym]));
  const bootstrapWorkouts = [
    ...(activeProgram?.workouts ?? []),
    ...openSessions.flatMap((session) => (session.workout ? [session.workout] : [])),
  ];
  const workouts = [...new Map(bootstrapWorkouts.map((workout) => [workout.id, workout])).values()];
  const programExercises = workouts.flatMap((workout) => workout.exercises);
  const exerciseIds = [...new Set(programExercises.map((item) => item.exerciseId))];
  const historyGymIds = mobileHistoryGymIds(user.activeGymId, openSessions);
  const historyGyms = historyGymIds.flatMap((gymId) => {
    if (gymId == null) return [null];
    const gym = gymsById.get(gymId);
    return gym ? [gym] : [];
  });
  const performanceTargets = [
    ...new Map(
      (historyGyms.length > 0 ? historyGyms : [null])
        .flatMap((gym) => buildEquipmentPerformanceTargets(exerciseIds, gym))
        .map((target) => [
          `${target.exerciseId}\u0000${target.gymId ?? ''}\u0000${target.gymEquipmentId ?? ''}`,
          target,
        ]),
    ).values(),
  ];
  const now = new Date();
  const returnEntriesPromise =
    workouts.length > 0
      ? Promise.all(
          workouts.map(
            async (workout) =>
              [
                workout.id,
                await getReturnToTrainingRecommendations({
                  userId,
                  programExercises: workout.exercises,
                  excludeSessionId:
                    openSessions.find((session) => session.workoutId === workout.id)?.id ?? null,
                  now,
                  bodyweight: user.bodyweight,
                  gym: activeGym,
                }),
              ] as const,
          ),
        )
      : Promise.resolve([]);
  const equipmentReturnEntriesPromise =
    workouts.length > 0
      ? Promise.all(
          workouts.map(async (workout) => {
            const workoutGyms = mobileWorkoutGymIds(
              user.activeGymId,
              openSessions,
              workout.id,
            ).flatMap((gymId) => {
              if (gymId == null) return [null];
              const gym = gymsById.get(gymId);
              return gym ? [gym] : [];
            });
            const recommendationsByGym = await Promise.all(
              (workoutGyms.length > 0 ? workoutGyms : [null]).map((gym) => {
                const gymId = gym?.id ?? null;
                return getReturnToTrainingRecommendationsByEquipment({
                  userId,
                  programExercises: workout.exercises,
                  excludeSessionId:
                    openSessions.find(
                      (session) => session.workoutId === workout.id && session.gymId === gymId,
                    )?.id ?? null,
                  now,
                  bodyweight: user.bodyweight,
                  gym,
                });
              }),
            );
            return [
              workout.id,
              mergeMobileEquipmentReturnRecommendations(recommendationsByGym),
            ] as const;
          }),
        )
      : Promise.resolve([]);
  const [lastPerformances, equipmentLastPerformances, returnEntries, equipmentReturnEntries] =
    await Promise.all([
      getLastPerformances(userId, exerciseIds, null),
      getLastPerformancesForEquipmentTargets(userId, performanceTargets, null),
      returnEntriesPromise,
      equipmentReturnEntriesPromise,
    ]);

  const serializedPerformances = Object.fromEntries(
    [...lastPerformances.entries()].map(([exerciseId, performance]) => [
      exerciseId,
      serializeMobilePerformance(performance),
    ]),
  );
  const equipmentHistoryContract = buildMobileEquipmentHistoryContract(
    equipmentLastPerformances,
    equipmentReturnEntries,
  );
  const readinessAgeHours = latestReadiness
    ? (Date.now() - latestReadiness.createdAt.getTime()) / 3_600_000
    : null;
  const readiness =
    latestReadiness && readinessAgeHours != null && readinessAgeHours <= READINESS_RECENCY_HOURS
      ? {
          readiness: latestReadiness.readiness,
          sleepQuality: latestReadiness.sleepQuality,
          soreness: latestReadiness.soreness,
          note: latestReadiness.note,
          createdAt: latestReadiness.createdAt,
          ageHours: readinessAgeHours,
        }
      : null;
  const exerciseHistoryByExerciseId: Record<string, MobileExerciseHistorySession[]> = {};
  for (const row of exerciseHistoryRows) {
    const exerciseSessions = (exerciseHistoryByExerciseId[row.exerciseId] ??= []);
    let session = exerciseSessions.at(-1);
    if (!session || session.sessionId !== row.sessionId) {
      session = {
        sessionId: row.sessionId,
        startedAt: row.startedAt.toISOString(),
        sets: [],
      };
      exerciseSessions.push(session);
    }
    session.sets.push({
      setNumber: row.setNumber,
      weight: row.weight,
      reps: row.reps,
      rir: row.rir,
      isDropSet: row.isDropSet,
      durationSec: row.durationSec,
      distanceM: row.distanceM,
      avgHr: row.avgHr,
      maxHr: row.maxHr,
    });
  }

  return {
    schemaVersion: MOBILE_BOOTSTRAP_SCHEMA_VERSION,
    calculationVersion: MOBILE_CALCULATION_VERSION,
    serverTime: new Date(),
    profile: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      bodyweight: user.bodyweight,
      unit: user.unit,
      activeGymId: user.activeGymId,
      coachingProfile: normalizeCoachingProfile(
        user.coachingProfile,
        user.coachingProfileUpdatedAt,
      ),
      deloadActive: isDeloadActive(user.deloadUntil, new Date()),
    },
    activeProgram,
    gyms: mobileGyms,
    catalog,
    openSessions,
    lastPerformances: serializedPerformances,
    ...equipmentHistoryContract,
    exerciseHistoryByExerciseId,
    returnRecommendationsByWorkout: Object.fromEntries(returnEntries),
    readiness,
  };
}
