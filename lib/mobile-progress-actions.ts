import { db } from '@/lib/db';
import { DELOAD_DURATION_DAYS } from '@/lib/deload';
import { findAchievingSet } from '@/lib/goals';
import type { GoalInput } from '@/lib/schemas/goal';
import type { VolumeTargetClear, VolumeTargetInput } from '@/lib/schemas/volume-target';
import { applyBodyweight } from '@/lib/stats';

export async function saveMobileGoal(userId: string, data: GoalInput) {
  const exercise = await db.exercise.findUnique({ where: { id: data.exerciseId } });
  if (!exercise || exercise.userId !== userId) return null;

  const [user, sets] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { bodyweight: true } }),
    db.set.findMany({
      where: { exerciseId: data.exerciseId, isWarmup: false, session: { userId } },
      select: { weight: true, reps: true, isWarmup: true, completedAt: true },
    }),
  ]);
  const adjusted = applyBodyweight(
    sets.map((set) => ({ ...set, usesBodyweight: exercise.usesBodyweight })),
    user?.bodyweight,
  );
  const achieving = findAchievingSet(adjusted, data);

  return db.exerciseGoal.upsert({
    where: { userId_exerciseId: { userId, exerciseId: data.exerciseId } },
    create: {
      userId,
      exerciseId: data.exerciseId,
      targetWeight: data.targetWeight,
      targetReps: data.targetReps,
      achievedAt: achieving?.completedAt ?? null,
    },
    update: {
      targetWeight: data.targetWeight,
      targetReps: data.targetReps,
      achievedAt: achieving?.completedAt ?? null,
      createdAt: new Date(),
    },
  });
}

export async function deleteMobileGoal(userId: string, goalId: string): Promise<boolean> {
  const goal = await db.exerciseGoal.findUnique({ where: { id: goalId } });
  if (!goal || goal.userId !== userId) return false;
  await db.exerciseGoal.delete({ where: { id: goalId } });
  return true;
}

export async function saveMobileVolumeTarget(userId: string, data: VolumeTargetInput) {
  return db.volumeTarget.upsert({
    where: { userId_muscleGroup: { userId, muscleGroup: data.muscleGroup } },
    create: { userId, muscleGroup: data.muscleGroup, mev: data.mev, mrv: data.mrv },
    update: { mev: data.mev, mrv: data.mrv },
    select: { muscleGroup: true, mev: true, mrv: true },
  });
}

export async function clearMobileVolumeTarget(userId: string, data: VolumeTargetClear) {
  await db.volumeTarget.deleteMany({
    where: { userId, muscleGroup: data.muscleGroup },
  });
}

export async function startMobileDeload(userId: string, now: Date = new Date()) {
  const deloadUntil = new Date(now.getTime() + DELOAD_DURATION_DAYS * 86_400_000);
  await db.user.update({ where: { id: userId }, data: { deloadUntil } });
  return deloadUntil;
}

export async function endMobileDeload(userId: string) {
  await db.user.update({ where: { id: userId }, data: { deloadUntil: null } });
}
