import { describe, expect, it, vi } from 'vitest';

const cableARow = {
  sessionId: 'session-a',
  setNumber: 1,
  weight: 20,
  reps: 10,
  rir: 3,
  isDropSet: false,
  gymEquipmentId: 'cable-a',
  equipmentNameSnapshot: 'Cable A',
  equipmentLoadSnapshot: { gymEquipmentId: 'cable-a' },
  completedAt: new Date('2026-05-01T10:00:00.000Z'),
  session: { startedAt: new Date('2026-05-01T10:00:00.000Z'), gymId: 'gym-1' },
};
const cableBRow = {
  ...cableARow,
  sessionId: 'session-b',
  weight: 60,
  gymEquipmentId: 'cable-b',
  completedAt: new Date('2026-07-10T10:00:00.000Z'),
  session: { startedAt: new Date('2026-07-10T10:00:00.000Z'), gymId: 'gym-1' },
};
const nullGymARow = {
  ...cableARow,
  sessionId: 'session-null-a',
  weight: 30,
  gymEquipmentId: null,
  equipmentNameSnapshot: null,
  equipmentLoadSnapshot: null,
  completedAt: new Date('2026-07-14T10:00:00.000Z'),
  session: { startedAt: new Date('2026-07-14T10:00:00.000Z'), gymId: 'gym-a' },
};
const nullGymBRow = {
  ...cableARow,
  sessionId: 'session-null-b',
  weight: 60,
  gymEquipmentId: null,
  equipmentNameSnapshot: null,
  equipmentLoadSnapshot: null,
  completedAt: new Date('2026-06-20T10:00:00.000Z'),
  session: { startedAt: new Date('2026-06-20T10:00:00.000Z'), gymId: 'gym-b' },
};
const nullNoGymRow = {
  ...cableARow,
  sessionId: 'session-no-gym',
  weight: 70,
  gymEquipmentId: null,
  equipmentNameSnapshot: null,
  equipmentLoadSnapshot: null,
  completedAt: new Date('2026-06-10T10:00:00.000Z'),
  session: { startedAt: new Date('2026-06-10T10:00:00.000Z'), gymId: null },
};
const deletedGymBRow = {
  ...nullGymBRow,
  sessionId: 'session-deleted-gym-b',
  weight: 200,
  equipmentNameSnapshot: 'Deleted Cable',
  equipmentLoadSnapshot: { gymEquipmentId: 'deleted-cable' },
  completedAt: new Date('2026-09-01T10:00:00.000Z'),
  session: { startedAt: new Date('2026-09-01T10:00:00.000Z'), gymId: 'gym-b' },
};

vi.mock('@/lib/db', () => ({
  db: {
    set: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        if (!('exerciseId' in where)) return [];
        const gymId = (where.session as { gymId?: string | null } | undefined)?.gymId;
        return [
          deletedGymBRow,
          cableBRow,
          cableARow,
          nullGymARow,
          nullGymBRow,
          nullNoGymRow,
        ].filter((row) => gymId === undefined || row.session.gymId === gymId);
      }),
      findFirst: vi.fn(async () => ({ completedAt: cableBRow.completedAt })),
    },
  },
}));

import { getReturnToTrainingRecommendationsByEquipment } from './return-to-training-history';

describe('equipment-specific return-to-training history', () => {
  it('does not let newer Cable B history replace older Cable A return targets', async () => {
    const recommendations = await getReturnToTrainingRecommendationsByEquipment({
      userId: 'user-1',
      programExercises: [
        {
          id: 'pe-1',
          exerciseId: 'pressdown',
          targetSets: 3,
          targetRepsMin: 8,
          targetRIR: 2,
          exercise: {
            name: 'Cable pressdown',
            category: 'ISOLATION',
            equipmentType: 'CABLE',
            usesBodyweight: false,
            muscleGroup: 'TRICEPS',
          },
        },
      ],
      excludeSessionId: 'current-session',
      now: new Date('2026-07-15T10:00:00.000Z'),
      gym: {
        id: 'gym-1',
        inventoryMode: 'EQUIPMENT_FIRST',
        dumbbellWeights: [],
        plateWeights: [],
        barWeights: [],
        exerciseConfigs: [],
        equipment: [
          {
            id: 'cable-a',
            name: 'Cable A',
            equipmentType: 'CABLE',
            loadType: 'SELECTORIZED',
            weightOptions: [10, 20],
            selectedLoadMultiplier: 0.5,
            baseLoadKg: 0,
            loadingSides: 1,
            platePoolId: null,
            platePool: null,
            exerciseLinks: [{ exerciseId: 'pressdown' }],
          },
          {
            id: 'cable-b',
            name: 'Cable B',
            equipmentType: 'CABLE',
            loadType: 'SELECTORIZED',
            weightOptions: [50, 60],
            selectedLoadMultiplier: 1,
            baseLoadKg: 0,
            loadingSides: 1,
            platePoolId: null,
            platePool: null,
            exerciseLinks: [{ exerciseId: 'pressdown' }],
          },
        ],
      },
    });

    const cableA = recommendations['pe-1']?.find(
      (item) => item.gymEquipmentId === 'cable-a',
    )?.recommendation;
    const cableB = recommendations['pe-1']?.find(
      (item) => item.gymEquipmentId === 'cable-b',
    )?.recommendation;

    expect(cableA).toMatchObject({ mode: 'exercise-reintro', exerciseGapDays: 75 });
    expect(cableA?.weightCeiling).not.toBe(cableB?.weightCeiling);
    expect(cableB).toMatchObject({ mode: 'normal', exerciseGapDays: 5 });
    expect(cableA?.nonComparableHistorySessionCount).toBe(5);
  });

  it('keeps null-equipment return history scoped to its gym', async () => {
    const gymBRecommendations = await getReturnToTrainingRecommendationsByEquipment({
      userId: 'user-1',
      programExercises: [
        {
          id: 'pe-1',
          exerciseId: 'pressdown',
          targetSets: 3,
          targetRepsMin: 8,
          targetRIR: 2,
          exercise: {
            name: 'Cable pressdown',
            category: 'ISOLATION',
            equipmentType: 'CABLE',
            usesBodyweight: false,
            muscleGroup: 'TRICEPS',
          },
        },
      ],
      excludeSessionId: 'current-session',
      now: new Date('2026-07-15T10:00:00.000Z'),
      gym: {
        id: 'gym-b',
        inventoryMode: 'LEGACY',
        dumbbellWeights: [],
        plateWeights: [],
        barWeights: [],
        exerciseConfigs: [],
        equipment: [],
      },
    });

    expect(gymBRecommendations['pe-1']?.[0]).toMatchObject({
      gymId: 'gym-b',
      gymEquipmentId: null,
      recommendation: { exerciseGapDays: 25 },
    });
  });

  it('uses only no-gym return history for a no-gym session', async () => {
    const recommendations = await getReturnToTrainingRecommendationsByEquipment({
      userId: 'user-1',
      programExercises: [
        {
          id: 'pe-1',
          exerciseId: 'pressdown',
          targetSets: 3,
          targetRepsMin: 8,
          targetRIR: 2,
          exercise: {
            name: 'Cable pressdown',
            category: 'ISOLATION',
            equipmentType: 'CABLE',
            usesBodyweight: false,
            muscleGroup: 'TRICEPS',
          },
        },
      ],
      excludeSessionId: 'current-session',
      now: new Date('2026-07-15T10:00:00.000Z'),
      gym: null,
    });

    expect(recommendations['pe-1']?.[0]).toMatchObject({
      gymId: null,
      gymEquipmentId: null,
      recommendation: { exerciseGapDays: 35 },
    });
  });

  it('does not treat deleted equipment snapshots as manual null-equipment history', async () => {
    const recommendations = await getReturnToTrainingRecommendationsByEquipment({
      userId: 'user-1',
      programExercises: [
        {
          id: 'pe-1',
          exerciseId: 'pressdown',
          targetSets: 3,
          targetRepsMin: 8,
          targetRIR: 2,
          exercise: {
            name: 'Cable pressdown',
            category: 'ISOLATION',
            equipmentType: 'CABLE',
            usesBodyweight: false,
            muscleGroup: 'TRICEPS',
          },
        },
      ],
      excludeSessionId: 'current-session',
      now: new Date('2026-09-15T10:00:00.000Z'),
      gym: {
        id: 'gym-b',
        inventoryMode: 'LEGACY',
        dumbbellWeights: [],
        plateWeights: [],
        barWeights: [],
        exerciseConfigs: [
          {
            exerciseId: 'pressdown',
            isAvailable: true,
            weightOptions: [10, 20, 30, 40, 50, 60],
            dumbbellWeights: [],
            plateWeights: [],
            barWeights: [],
          },
        ],
        equipment: [],
      },
    });

    expect(recommendations['pe-1']?.[0]?.recommendation).toMatchObject({
      historySessionCount: 1,
      nonComparableHistorySessionCount: 5,
      historyBasis: 'long-term-exact',
    });
  });
});
