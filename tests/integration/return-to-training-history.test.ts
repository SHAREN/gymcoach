import { describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import {
  getReturnToTrainingRecommendations,
  getReturnToTrainingRecommendationsByEquipment,
} from '@/lib/return-to-training-history';

const now = new Date('2026-07-12T12:00:00.000Z');

function daysAgo(days: number): Date {
  return new Date(now.getTime() - days * 86_400_000);
}

describe('return-to-training history builder', () => {
  it('separates a stale exercise from a recently trained primary muscle', async () => {
    const user = await db.user.create({
      data: { email: 'return-history@test.dev', passwordHash: 'x', bodyweight: 80 },
    });
    const dumbbellPress = await db.exercise.create({
      data: {
        userId: user.id,
        name: 'Incline Dumbbell Press',
        muscleGroup: 'CHEST',
        category: 'COMPOUND',
        equipmentType: 'DUMBBELL',
      },
    });
    const barbellPress = await db.exercise.create({
      data: {
        userId: user.id,
        name: 'Barbell Bench Press',
        muscleGroup: 'CHEST',
        category: 'COMPOUND',
        equipmentType: 'BARBELL',
      },
    });

    for (const [index, age] of [60, 70, 80].entries()) {
      const session = await db.session.create({
        data: { userId: user.id, startedAt: daysAgo(age) },
      });
      await db.set.create({
        data: {
          sessionId: session.id,
          exerciseId: dumbbellPress.id,
          setNumber: index + 1,
          weight: 20,
          reps: 10,
          rir: 2,
          completedAt: daysAgo(age),
        },
      });
    }

    for (const age of [5, 8, 35, 42]) {
      const session = await db.session.create({
        data: { userId: user.id, startedAt: daysAgo(age) },
      });
      await db.set.createMany({
        data: [1, 2].map((setNumber) => ({
          sessionId: session.id,
          exerciseId: barbellPress.id,
          setNumber,
          weight: 80,
          reps: 8,
          rir: 2,
          completedAt: daysAgo(age),
        })),
      });
    }

    const current = await db.session.create({
      data: { userId: user.id, startedAt: now },
    });
    await db.set.create({
      data: {
        sessionId: current.id,
        exerciseId: dumbbellPress.id,
        setNumber: 1,
        weight: 40,
        reps: 5,
        rir: 0,
        completedAt: daysAgo(1),
      },
    });

    const recommendations = await getReturnToTrainingRecommendations({
      userId: user.id,
      programExercises: [
        {
          id: 'pe-return',
          exerciseId: dumbbellPress.id,
          targetSets: 4,
          targetRepsMin: 8,
          targetRIR: 2,
          exercise: dumbbellPress,
        },
      ],
      excludeSessionId: current.id,
      now,
      bodyweight: user.bodyweight,
      gym: {
        dumbbellWeights: [10, 12, 14, 15, 16, 19],
        plateWeights: [1.25, 2.5, 5, 10, 20],
        barWeights: [20],
        exerciseConfigs: [],
      },
    });

    expect(recommendations['pe-return']).toMatchObject({
      mode: 'exercise-reintro',
      exerciseGapDays: 60,
      muscleGapDays: 5,
      muscleMaintained: true,
      targetSets: 2,
      targetRIR: 3,
      weightCeiling: 19,
      suggestedWeight: 16,
      historySessionCount: 3,
    });
  });

  it('does not reuse shared Dumbbells loads after explicit profile removal', async () => {
    const user = await db.user.create({
      data: { email: 'return-system-profile@test.dev', passwordHash: 'x' },
    });
    const exercise = await db.exercise.create({
      data: {
        userId: user.id,
        name: 'Dumbbell row',
        muscleGroup: 'BACK_THICKNESS',
        category: 'COMPOUND',
        equipmentType: 'DUMBBELL',
      },
    });
    const session = await db.session.create({
      data: { userId: user.id, startedAt: daysAgo(60) },
    });
    await db.set.create({
      data: {
        sessionId: session.id,
        exerciseId: exercise.id,
        setNumber: 1,
        weight: 20,
        reps: 10,
        rir: 2,
        completedAt: daysAgo(60),
      },
    });

    const recommendations = await getReturnToTrainingRecommendations({
      userId: user.id,
      programExercises: [
        {
          id: 'removed-dumbbell-profile',
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
        inventoryMode: 'EQUIPMENT_FIRST',
        dumbbellWeights: [10, 20],
        plateWeights: [],
        barWeights: [],
        exerciseConfigs: [
          {
            exerciseId: exercise.id,
            isAvailable: true,
            systemProfileSupported: false,
            weightOptions: [],
            dumbbellWeights: [],
            plateWeights: [],
            barWeights: [],
          },
        ],
      },
    });

    expect(recommendations['removed-dumbbell-profile']).toMatchObject({
      weightCeiling: null,
      suggestedWeight: null,
    });
  });

  it('keeps old exact-machine history after more than sixty newer other-machine sets', async () => {
    const user = await db.user.create({
      data: { email: 'return-equipment-history@test.dev', passwordHash: 'x' },
    });
    const bench = await db.exercise.create({
      data: {
        userId: user.id,
        name: 'Barbell Bench Press',
        muscleGroup: 'CHEST',
        category: 'COMPOUND',
        equipmentType: 'BARBELL',
      },
    });
    const gym = await db.gym.create({
      data: { userId: user.id, name: 'Return History Gym', inventoryMode: 'EQUIPMENT_FIRST' },
    });
    const barA = await db.gymEquipment.create({
      data: {
        gymId: gym.id,
        name: 'Bench Station A',
        equipmentType: 'BARBELL',
        loadType: 'FIXED',
        weightOptions: [20, 40, 50, 60, 70, 80],
        exerciseLinks: { create: { exerciseId: bench.id } },
      },
    });
    const barB = await db.gymEquipment.create({
      data: {
        gymId: gym.id,
        name: 'Bench Station B',
        equipmentType: 'BARBELL',
        loadType: 'FIXED',
        weightOptions: [20, 30, 40],
        exerciseLinks: { create: { exerciseId: bench.id } },
      },
    });

    for (const [index, age] of [180, 210, 240].entries()) {
      const session = await db.session.create({
        data: { userId: user.id, gymId: gym.id, startedAt: daysAgo(age) },
      });
      await db.set.create({
        data: {
          sessionId: session.id,
          exerciseId: bench.id,
          gymEquipmentId: barA.id,
          setNumber: 1,
          weight: [60, 70, 80][index]!,
          reps: 8,
          rir: 2,
          completedAt: daysAgo(age),
        },
      });
    }
    for (let age = 1; age <= 61; age += 1) {
      const session = await db.session.create({
        data: { userId: user.id, gymId: gym.id, startedAt: daysAgo(age) },
      });
      await db.set.create({
        data: {
          sessionId: session.id,
          exerciseId: bench.id,
          gymEquipmentId: barB.id,
          setNumber: 1,
          weight: 40,
          reps: 8,
          rir: 2,
          completedAt: daysAgo(age),
        },
      });
    }

    const recommendations = await getReturnToTrainingRecommendationsByEquipment({
      userId: user.id,
      programExercises: [
        {
          id: 'bench-program-exercise',
          exerciseId: bench.id,
          targetSets: 4,
          targetRepsMin: 8,
          targetRIR: 2,
          exercise: bench,
        },
      ],
      excludeSessionId: null,
      now,
      gym: {
        id: gym.id,
        inventoryMode: gym.inventoryMode,
        dumbbellWeights: [],
        plateWeights: [],
        barWeights: [],
        exerciseConfigs: [],
        equipment: [barA, barB].map((equipment) => ({
          id: equipment.id,
          name: equipment.name,
          equipmentType: equipment.equipmentType,
          loadType: equipment.loadType,
          weightOptions: equipment.weightOptions,
          selectedLoadMultiplier: equipment.selectedLoadMultiplier,
          baseLoadKg: equipment.baseLoadKg,
          loadingSides: equipment.loadingSides,
          platePoolId: equipment.platePoolId,
          platePool: null,
          exerciseLinks: [{ exerciseId: bench.id }],
        })),
      },
    });
    const stationA = recommendations['bench-program-exercise']?.find(
      (item) => item.gymEquipmentId === barA.id,
    )?.recommendation;

    expect(stationA).toMatchObject({
      mode: 'normal',
      exerciseGapDays: 1,
      calibrationKind: 'none',
      calibrationRequired: false,
      historySessionCount: 3,
      longTermHistorySessionCount: 3,
      historyBasis: 'long-term-exact',
      suggestedWeight: null,
      nonComparableHistorySessionCount: 61,
      strengthSummary: {
        anchorScope: 'exact-equipment',
        movement: { sessionCount: 64, confidence: 'high' },
        equipment: {
          sessionCount: 3,
          workingSetCount: 3,
          calibrationSetCount: 3,
          lastReliableLoad: 60,
        },
      },
    });
    expect(stationA?.strengthSummary.equipment.historicalStrengthAnchor).toBeGreaterThan(80);
  });
});
