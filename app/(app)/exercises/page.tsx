import { db } from '@/lib/db';
import { requireSession } from '@/lib/auth';
import { ExercisesView } from '@/components/exercises/exercises-view';

export default async function ExercisesPage() {
  const session = await requireSession();
  const [exercises, gyms, user, exerciseSessions] = await Promise.all([
    db.exercise.findMany({
      where: { userId: session.userId },
      orderBy: [{ muscleGroup: 'asc' }, { name: 'asc' }],
    }),
    db.gym.findMany({
      where: { userId: session.userId },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        exerciseConfigs: {
          select: { exerciseId: true, isAvailable: true },
        },
      },
    }),
    db.user.findUnique({
      where: { id: session.userId },
      select: { activeGymId: true },
    }),
    db.set.findMany({
      where: {
        session: {
          userId: session.userId,
          finishedAt: { not: null },
        },
      },
      distinct: ['exerciseId', 'sessionId'],
      select: {
        exerciseId: true,
        session: { select: { startedAt: true } },
      },
    }),
  ]);
  const trainingDatesByExercise: Record<string, string[]> = {};
  for (const item of exerciseSessions) {
    (trainingDatesByExercise[item.exerciseId] ??= []).push(item.session.startedAt.toISOString());
  }

  return (
    <main className="flex-1 px-4 py-6">
      <ExercisesView
        exercises={exercises}
        gyms={gyms}
        activeGymId={user?.activeGymId ?? null}
        trainingDatesByExercise={trainingDatesByExercise}
      />
    </main>
  );
}
