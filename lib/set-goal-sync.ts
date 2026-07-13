import type { Exercise, Set } from '@/lib/prisma-client';
import { db } from '@/lib/db';
import { findAchievingSet, setAchievesGoal } from '@/lib/goals';
import { effectiveWeight } from '@/lib/stats';

export async function stampGoalIfAchieved(
  userId: string,
  exercise: Exercise,
  set: Set,
): Promise<void> {
  if (set.isWarmup) return;
  const goal = await db.exerciseGoal.findUnique({
    where: { userId_exerciseId: { userId, exerciseId: exercise.id } },
  });
  if (!goal || goal.achievedAt) return;

  let weight = set.weight;
  if (exercise.usesBodyweight) {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { bodyweight: true },
    });
    weight = effectiveWeight(set.weight, true, user?.bodyweight);
  }
  if (setAchievesGoal({ weight, reps: set.reps, isWarmup: set.isWarmup }, goal)) {
    await db.exerciseGoal.update({
      where: { id: goal.id },
      data: { achievedAt: set.completedAt },
    });
  }
}

export async function rederiveGoalAchievement(userId: string, exerciseId: string): Promise<void> {
  const goal = await db.exerciseGoal.findUnique({
    where: { userId_exerciseId: { userId, exerciseId } },
  });
  if (!goal) return;

  const [exercise, sets] = await Promise.all([
    db.exercise.findUnique({
      where: { id: exerciseId },
      select: { usesBodyweight: true },
    }),
    db.set.findMany({
      where: { exerciseId, isWarmup: false, session: { userId } },
      select: { weight: true, reps: true, isWarmup: true, completedAt: true },
    }),
  ]);
  if (!exercise) return;

  let bodyweight: number | null = null;
  if (exercise.usesBodyweight) {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { bodyweight: true },
    });
    bodyweight = user?.bodyweight ?? null;
  }

  const achieving = findAchievingSet(
    sets.map((set) => ({
      ...set,
      weight: effectiveWeight(set.weight, exercise.usesBodyweight, bodyweight),
    })),
    goal,
  );
  const achievedAt = achieving?.completedAt ?? null;
  if (achievedAt?.getTime() !== goal.achievedAt?.getTime()) {
    await db.exerciseGoal.update({
      where: { id: goal.id },
      data: { achievedAt },
    });
  }
}
