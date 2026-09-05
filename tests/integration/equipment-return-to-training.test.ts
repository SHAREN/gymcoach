import { describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { getReturnToTrainingRecommendationsByEquipment } from '@/lib/return-to-training-history';

const now = new Date('2026-09-05T12:00:00.000Z');

function daysAgo(days: number): Date {
  return new Date(now.getTime() - days * 86_400_000);
}

async function createFinishedSession(input: {
  userId: string;
  gymId: string;
  exerciseId: string;
  gymEquipmentId: string | null;
  daysAgoValue: number;
  weight: number;
}) {
  const startedAt = daysAgo(input.daysAgoValue);
  const session = await db.session.create({
    data: {
      userId: input.userId,
      gymId: input.gymId,
      startedAt,
      finishedAt: new Date(startedAt.getTime() + 60 * 60_000),
    },
  });
  await db.set.create({
    data: {
      sessionId: session.id,
      exerciseId: input.exerciseId,
      gymEquipmentId: input.gymEquipmentId,
      equipmentNameSnapshot: input.gymEquipmentId ? `snapshot-${input.gymEquipmentId}` : null,
      equipmentLoadSnapshot: input.gymEquipmentId
        ? { version: 1, gymEquipmentId: input.gymEquipmentId }
        : undefined,
      setNumber: 1,
      weight: input.weight,
      reps: 10,
      rir: 2,
      completedAt: startedAt,
    },
  });
}

describe('equipment-aware return-to-training history', () => {
  it('keeps physical equipment histories independent and preserves a manual no-equipment path', async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const user = await db.user.create({
      data: { email: `equipment-return-${suffix}@test.dev`, passwordHash: 'x' },
    });
    const gym = await db.gym.create({
      data: { userId: user.id, name: `Gym ${suffix}` },
    });
    const exercise = await db.exercise.create({
      data: {
        userId: user.id,
        name: `Cable pressdown ${suffix}`,
        muscleGroup: 'TRICEPS',
        category: 'ISOLATION',
        equipmentType: 'CABLE',
      },
    });
    const cableA = await db.gymEquipment.create({
      data: {
        gymId: gym.id,
        name: `Cable A ${suffix}`,
        equipmentType: 'CABLE',
        weightOptions: [10, 20, 30],
        exerciseLinks: { create: { exerciseId: exercise.id } },
      },
    });
    const cableB = await db.gymEquipment.create({
      data: {
        gymId: gym.id,
        name: `Cable B ${suffix}`,
        equipmentType: 'CABLE',
        weightOptions: [40, 50, 60],
        exerciseLinks: { create: { exerciseId: exercise.id } },
      },
    });
    await db.gymExerciseConfig.create({
      data: {
        gymId: gym.id,
        exerciseId: exercise.id,
        isAvailable: true,
        preferredEquipmentId: cableA.id,
        weightOptions: [5, 10, 15, 20, 25, 30],
      },
    });

    await createFinishedSession({
      userId: user.id,
      gymId: gym.id,
      exerciseId: exercise.id,
      gymEquipmentId: cableA.id,
      daysAgoValue: 75,
      weight: 20,
    });
    await createFinishedSession({
      userId: user.id,
      gymId: gym.id,
      exerciseId: exercise.id,
      gymEquipmentId: cableB.id,
      daysAgoValue: 5,
      weight: 60,
    });
    await createFinishedSession({
      userId: user.id,
      gymId: gym.id,
      exerciseId: exercise.id,
      gymEquipmentId: null,
      daysAgoValue: 50,
      weight: 25,
    });

    const deletedEquipmentSession = await db.session.create({
      data: {
        userId: user.id,
        gymId: gym.id,
        startedAt: daysAgo(1),
        finishedAt: new Date(daysAgo(1).getTime() + 60 * 60_000),
      },
    });
    await db.set.create({
      data: {
        sessionId: deletedEquipmentSession.id,
        exerciseId: exercise.id,
        gymEquipmentId: null,
        equipmentNameSnapshot: 'Deleted Cable',
        equipmentLoadSnapshot: { version: 1, gymEquipmentId: 'deleted-cable' },
        setNumber: 1,
        weight: 999,
        reps: 10,
        rir: 0,
        completedAt: daysAgo(1),
      },
    });

    const recommendations = await getReturnToTrainingRecommendationsByEquipment({
      userId: user.id,
      programExercises: [
        {
          id: 'pe-cable',
          exerciseId: exercise.id,
          targetSets: 3,
          targetRepsMin: 8,
          targetRIR: 2,
          exercise,
        },
      ],
      excludeSessionId: null,
      now,
      gym: {
        ...gym,
        exerciseConfigs: [
          {
            exerciseId: exercise.id,
            isAvailable: true,
            weightOptions: [5, 10, 15, 20, 25, 30],
            preferredEquipmentId: cableA.id,
          },
        ],
        equipment: [
          {
            id: cableA.id,
            name: cableA.name,
            equipmentType: cableA.equipmentType,
            loadConfigurationKnown: cableA.loadConfigurationKnown,
            weightOptions: cableA.weightOptions,
            exerciseLinks: [{ exerciseId: exercise.id }],
          },
          {
            id: cableB.id,
            name: cableB.name,
            equipmentType: cableB.equipmentType,
            loadConfigurationKnown: cableB.loadConfigurationKnown,
            weightOptions: cableB.weightOptions,
            exerciseLinks: [{ exerciseId: exercise.id }],
          },
        ],
      },
    });

    const items = recommendations['pe-cable'] ?? [];
    const forA = items.find((item) => item.gymEquipmentId === cableA.id)?.recommendation;
    const forB = items.find((item) => item.gymEquipmentId === cableB.id)?.recommendation;
    const withoutEquipment = items.find((item) => item.gymEquipmentId == null)?.recommendation;

    expect(forA).toMatchObject({ mode: 'exercise-reintro', exerciseGapDays: 75 });
    expect(forA?.historySessionCount).toBe(1);
    expect(forA?.weightCeiling).toBeLessThanOrEqual(30);

    expect(forB).toMatchObject({ mode: 'normal', exerciseGapDays: 5 });
    expect(forB?.historySessionCount).toBe(1);

    expect(withoutEquipment).toMatchObject({
      mode: 'exercise-reintro',
      exerciseGapDays: 50,
      historySessionCount: 1,
    });
  });
});
