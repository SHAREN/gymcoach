import { db } from '@/lib/db';

export async function getExerciseCatalogWithUsage(userId: string) {
  const [exerciseCatalog, exerciseUsage] = await Promise.all([
    db.exercise.findMany({
      where: { userId },
      orderBy: [{ muscleGroup: 'asc' }, { name: 'asc' }],
    }),
    db.set.findMany({
      where: { isWarmup: false, session: { userId } },
      select: { exerciseId: true, sessionId: true },
      distinct: ['exerciseId', 'sessionId'],
    }),
  ]);

  const sessionCountByExercise = new Map<string, number>();
  for (const usage of exerciseUsage) {
    sessionCountByExercise.set(
      usage.exerciseId,
      (sessionCountByExercise.get(usage.exerciseId) ?? 0) + 1,
    );
  }

  return exerciseCatalog.map((exercise) => ({
    ...exercise,
    sessionCount: sessionCountByExercise.get(exercise.id) ?? 0,
  }));
}
