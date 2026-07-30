import { describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { buildMobileProgress } from '@/lib/mobile-progress';

describe('mobile progress deload classification', () => {
  it('does not prescribe another deload after the owner recovery-break case', async () => {
    const now = new Date('2026-07-30T12:00:00Z');
    const user = await db.user.create({
      data: {
        email: 'completed-recovery-break@test.dev',
        passwordHash: 'x',
        weeklyFrequency: 3,
      },
    });
    const [bench, squat] = await Promise.all([
      db.exercise.create({
        data: {
          userId: user.id,
          name: 'Bench Press',
          muscleGroup: 'CHEST',
          category: 'COMPOUND',
        },
      }),
      db.exercise.create({
        data: {
          userId: user.id,
          name: 'Squat',
          muscleGroup: 'QUADS',
          category: 'COMPOUND',
        },
      }),
    ]);
    const performedDaysAgo = [12.6, 18, 23, 26, 27, 32, 39, 46, 53, 60, 67];
    for (const days of performedDaysAgo) {
      const performedAt = new Date(now.getTime() - days * 86_400_000);
      const session = await db.session.create({
        data: {
          userId: user.id,
          startedAt: performedAt,
          finishedAt: new Date(performedAt.getTime() + 3_600_000),
        },
      });
      await db.set.createMany({
        data: [
          {
            sessionId: session.id,
            exerciseId: bench.id,
            setNumber: 1,
            weight: 80,
            reps: 8,
            rir: 2,
            completedAt: performedAt,
          },
          {
            sessionId: session.id,
            exerciseId: squat.id,
            setNumber: 2,
            weight: 100,
            reps: 8,
            rir: 2,
            completedAt: performedAt,
          },
        ],
      });
    }
    await db.session.create({
      data: {
        userId: user.id,
        startedAt: new Date(now.getTime() - 86_400_000),
        finishedAt: null,
      },
    });
    await db.readinessCheckin.createMany({
      data: [1, 2, 3].map((days) => ({
        userId: user.id,
        readiness: 4,
        sleepQuality: 4,
        soreness: {},
        createdAt: new Date(now.getTime() - days * 86_400_000),
      })),
    });

    const progress = await buildMobileProgress(user.id, now);

    expect(progress.deload).toMatchObject({
      state: 'recovery-break-completed',
      recommended: false,
      recent7DayCompletedWorkouts: 0,
      recent7DayWorkingSets: 0,
      actualWeeklyFrequency28Days: 1.25,
      plannedWeeklyFrequency: 3,
    });
    expect(progress.deload.daysSinceLastMeaningfulWorkout).toBe(12.6);
    expect(progress.deload.stalledExerciseNames).toEqual(['Bench Press', 'Squat']);
  });
});
