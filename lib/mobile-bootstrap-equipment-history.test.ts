import { describe, expect, it } from 'vitest';

import type { LastPerformance } from './last-performance';
import {
  buildMobileEquipmentHistoryContract,
  mergeMobileEquipmentReturnRecommendations,
  mobileHistoryGymIds,
  mobileWorkoutGymIds,
} from './mobile-bootstrap';
import type { EquipmentReturnRecommendation } from './return-to-training-history';

function performance(
  gymEquipmentId: string | null,
  sessionId: string,
  sessionStartedAt: string,
  maxWeight: number,
  gymId: string | null = 'gym-1',
): LastPerformance {
  return {
    exerciseId: 'pressdown',
    sessionId,
    sessionStartedAt: new Date(sessionStartedAt),
    gymId,
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
  gymEquipmentId: string | null,
  suggestedWeight: number,
  gymId: string | null = 'gym-1',
): EquipmentReturnRecommendation {
  return {
    gymId,
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

  it('includes the open-session gym when the active gym is different', () => {
    const gymIds = mobileWorkoutGymIds(
      'gym-a',
      [{ workoutId: 'workout-1', gymId: 'gym-b' }],
      'workout-1',
    );
    const historyGymIds = mobileHistoryGymIds('gym-a', [{ gymId: 'gym-b' }, { gymId: 'gym-a' }]);
    const merged = mergeMobileEquipmentReturnRecommendations([
      { 'program-exercise-1': [recommendation('cable-a', 30)] },
      { 'program-exercise-1': [recommendation('cable-b', 60)] },
    ]);
    const contract = buildMobileEquipmentHistoryContract(
      [performance('cable-b', 'session-b', '2026-06-20T10:00:00.000Z', 60)],
      [['workout-1', merged]],
    );

    expect(gymIds).toEqual(['gym-a', 'gym-b']);
    expect(historyGymIds).toEqual(['gym-a', 'gym-b']);
    expect(contract.lastPerformancesByEquipment.pressdown?.[0]?.gymEquipmentId).toBe('cable-b');
    expect(
      contract.returnRecommendationsByEquipmentByWorkout['workout-1']?.['program-exercise-1']?.map(
        (item) => item.gymEquipmentId,
      ),
    ).toEqual(['cable-a', 'cable-b']);
  });

  it('does not collapse null-equipment history across gyms', () => {
    const merged = mergeMobileEquipmentReturnRecommendations([
      { 'program-exercise-1': [recommendation(null, 30, 'gym-a')] },
      { 'program-exercise-1': [recommendation(null, 60, 'gym-b')] },
    ]);
    const contract = buildMobileEquipmentHistoryContract(
      [
        performance(null, 'session-a', '2026-07-14T10:00:00.000Z', 30, 'gym-a'),
        performance(null, 'session-b', '2026-06-20T10:00:00.000Z', 60, 'gym-b'),
      ],
      [['workout-1', merged]],
    );

    expect(contract.lastPerformancesByEquipment.pressdown).toEqual([
      expect.objectContaining({ gymId: 'gym-a', gymEquipmentId: null, sessionId: 'session-a' }),
      expect.objectContaining({ gymId: 'gym-b', gymEquipmentId: null, sessionId: 'session-b' }),
    ]);
    expect(
      contract.returnRecommendationsByEquipmentByWorkout['workout-1']?.['program-exercise-1']?.map(
        (item) => ({ gymId: item.gymId, suggestedWeight: item.recommendation.suggestedWeight }),
      ),
    ).toEqual([
      { gymId: 'gym-a', suggestedWeight: 30 },
      { gymId: 'gym-b', suggestedWeight: 60 },
    ]);
  });

  it('keeps an open no-gym session as a first-class scope beside the active gym', () => {
    const gymIds = mobileWorkoutGymIds(
      'gym-a',
      [{ workoutId: 'workout-1', gymId: null }],
      'workout-1',
    );
    const historyGymIds = mobileHistoryGymIds('gym-a', [{ gymId: null }]);
    const merged = mergeMobileEquipmentReturnRecommendations([
      { 'program-exercise-1': [recommendation(null, 30, 'gym-a')] },
      { 'program-exercise-1': [recommendation(null, 60, null)] },
    ]);
    const contract = buildMobileEquipmentHistoryContract(
      [
        performance(null, 'session-a', '2026-07-14T10:00:00.000Z', 30, 'gym-a'),
        performance(null, 'session-no-gym', '2026-06-20T10:00:00.000Z', 60, null),
      ],
      [['workout-1', merged]],
    );

    expect(gymIds).toEqual(['gym-a', null]);
    expect(historyGymIds).toEqual(['gym-a', null]);
    expect(
      contract.lastPerformancesByEquipment.pressdown?.find(
        (item) => item.gymId == null && item.gymEquipmentId == null,
      )?.sessionId,
    ).toBe('session-no-gym');
    expect(
      contract.returnRecommendationsByEquipmentByWorkout['workout-1']?.['program-exercise-1']?.find(
        (item) => item.gymId == null && item.gymEquipmentId == null,
      )?.recommendation.suggestedWeight,
    ).toBe(60);
  });
});
