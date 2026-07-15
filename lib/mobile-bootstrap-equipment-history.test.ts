import { describe, expect, it } from 'vitest';

import type { LastPerformance } from './last-performance';
import { buildMobileEquipmentHistoryContract } from './mobile-bootstrap';
import type { EquipmentReturnRecommendation } from './return-to-training-history';

function performance(
  gymEquipmentId: string,
  sessionId: string,
  sessionStartedAt: string,
  maxWeight: number,
): LastPerformance {
  return {
    exerciseId: 'pressdown',
    sessionId,
    sessionStartedAt: new Date(sessionStartedAt),
    gymEquipmentId,
    equipmentName: gymEquipmentId,
    sets: [
      {
        weight: maxWeight,
        reps: 10,
        rir: 2,
        isDropSet: false,
        gymEquipmentId,
        nominalResistanceKg: maxWeight,
      },
    ],
    maxWeight,
    repsAtMaxWeight: 10,
    cardio: null,
  };
}

function recommendation(
  gymEquipmentId: string,
  suggestedWeight: number,
): EquipmentReturnRecommendation {
  return {
    gymEquipmentId,
    recommendation: {
      mode: 'normal',
      exerciseGapDays: 5,
      muscleGapDays: 5,
      muscleMaintained: true,
      recentMuscleSets: 6,
      baselineMuscleSetsPer28Days: 24,
      recentVolumeRatio: 1,
      targetSets: 3,
      targetRIR: 2,
      weightCeiling: suggestedWeight,
      suggestedWeight,
      calibrationRequired: false,
      historySessionCount: 3,
    },
  };
}

describe('mobile equipment history contract', () => {
  it('keeps older Cable B history and recommendation when Cable A is latest', () => {
    const contract = buildMobileEquipmentHistoryContract(
      [
        performance('cable-a', 'session-a-latest', '2026-07-14T10:00:00.000Z', 30),
        performance('cable-b', 'session-b-older', '2026-06-20T10:00:00.000Z', 60),
      ],
      [
        [
          'workout-1',
          {
            'program-exercise-1': [recommendation('cable-a', 30), recommendation('cable-b', 60)],
          },
        ],
      ],
    );

    expect(contract.lastPerformancesByEquipment.pressdown).toEqual([
      expect.objectContaining({
        gymEquipmentId: 'cable-a',
        sessionId: 'session-a-latest',
        sessionStartedAt: '2026-07-14T10:00:00.000Z',
      }),
      expect.objectContaining({
        gymEquipmentId: 'cable-b',
        sessionId: 'session-b-older',
        sessionStartedAt: '2026-06-20T10:00:00.000Z',
      }),
    ]);
    expect(
      contract.returnRecommendationsByEquipmentByWorkout['workout-1']?.['program-exercise-1']?.find(
        (item) => item.gymEquipmentId === 'cable-b',
      )?.recommendation.suggestedWeight,
    ).toBe(60);
  });
});
