import { db } from '@/lib/db';
import { isDeloadActive } from '@/lib/deload';
import { getLastPerformances } from '@/lib/last-performance';
import { READINESS_RECENCY_HOURS } from '@/lib/progression';
import { getReturnToTrainingRecommendations } from '@/lib/return-to-training-history';

export const MOBILE_BOOTSTRAP_SCHEMA_VERSION = 2;
export const MOBILE_CALCULATION_VERSION = '2026-07-13';
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
  }>;
}

export async function buildMobileBootstrap(userId: string) {
  const exerciseHistoryRowsPromise = db.$queryRaw<MobileExerciseHistoryRow[]>`
      WITH exercise_sessions AS (
        SELECT DISTINCT
          logged_set."exerciseId" AS "exerciseId",
          logged_set."sessionId" AS "sessionId",
          training_session."startedAt" AS "startedAt"
        FROM "Set" AS logged_set
        INNER JOIN "Session" AS training_session
          ON training_session.id = logged_set."sessionId"
        INNER JOIN "Exercise" AS exercise
          ON exercise.id = logged_set."exerciseId"
        WHERE training_session."userId" = ${userId}
          AND training_session."finishedAt" IS NOT NULL
          AND logged_set."isWarmup" = false
          AND exercise.category <> 'CARDIO'
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
        logged_set."isDropSet" AS "isDropSet"
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
      include: { exerciseConfigs: true },
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

  const activeGym = gyms.find((gym) => gym.id === user.activeGymId) ?? null;
  const programExercises = activeProgram?.workouts.flatMap((workout) => workout.exercises) ?? [];
  const exerciseIds = [...new Set(programExercises.map((item) => item.exerciseId))];
  const lastPerformances = await getLastPerformances(userId, exerciseIds, null);
  const returnEntries = activeProgram
    ? await Promise.all(
        activeProgram.workouts.map(
          async (workout) =>
            [
              workout.id,
              await getReturnToTrainingRecommendations({
                userId,
                programExercises: workout.exercises,
                excludeSessionId: null,
                now: new Date(),
                bodyweight: user.bodyweight,
                gym: activeGym,
              }),
            ] as const,
        ),
      )
    : [];

  const serializedPerformances = Object.fromEntries(
    [...lastPerformances.entries()].map(([exerciseId, performance]) => [
      exerciseId,
      {
        ...performance,
        sessionStartedAt: performance.sessionStartedAt.toISOString(),
      },
    ]),
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
      deloadActive: isDeloadActive(user.deloadUntil, new Date()),
    },
    activeProgram,
    gyms,
    catalog,
    openSessions,
    lastPerformances: serializedPerformances,
    exerciseHistoryByExerciseId,
    returnRecommendationsByWorkout: Object.fromEntries(returnEntries),
    readiness,
  };
}
