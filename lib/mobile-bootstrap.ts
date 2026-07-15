import { db } from '@/lib/db';
import { isDeloadActive } from '@/lib/deload';
import { getLastPerformances } from '@/lib/last-performance';
import { ensureMobileEquipmentSnapshotRevision } from '@/lib/mobile-equipment-snapshot';
import { READINESS_RECENCY_HOURS } from '@/lib/progression';
import { getReturnToTrainingRecommendations } from '@/lib/return-to-training-history';

export const MOBILE_BOOTSTRAP_SCHEMA_VERSION = 3;
export const MOBILE_CALCULATION_VERSION = '2026-07-15-equipment-v1';

export async function buildMobileBootstrap(userId: string) {
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
    gyms: mobileGyms,
    catalog,
    openSessions,
    lastPerformances: serializedPerformances,
    returnRecommendationsByWorkout: Object.fromEntries(returnEntries),
    readiness,
  };
}
