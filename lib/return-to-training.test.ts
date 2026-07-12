import { describe, expect, it } from 'vitest';
import {
  calculateReturnRecommendation,
  type ReturnProgramExercise,
  type ReturnTrainingHistory,
} from '@/lib/return-to-training';

const now = new Date('2026-07-12T12:00:00.000Z');
const programExercise: ReturnProgramExercise = {
  exerciseId: 'incline-dumbbell-press',
  targetSets: 4,
  targetRepsMin: 8,
  targetRIR: 2,
  exercise: {
    category: 'COMPOUND',
    equipmentType: 'DUMBBELL',
    usesBodyweight: false,
  },
};

function daysAgo(days: number): Date {
  return new Date(now.getTime() - days * 86_400_000);
}

function sessions(weight = 20) {
  return [1, 2, 3].map((index) => ({
    sessionId: `session-${index}`,
    performedAt: daysAgo(50 + index * 7),
    sets: [{ weight, reps: 10, rir: 2, isDropSet: false }],
  }));
}

function history(overrides: Partial<ReturnTrainingHistory> = {}): ReturnTrainingHistory {
  return {
    exerciseLastPerformedAt: daysAgo(60),
    muscleLastPerformedAt: daysAgo(5),
    recentMuscleSets: 12,
    baselineMuscleSetsPer28Days: 12,
    exerciseSessions: sessions(),
    ...overrides,
  };
}

const olympDumbbells = {
  equipmentType: 'DUMBBELL' as const,
  dumbbellWeights: [10, 12, 14, 15, 16, 19],
};

describe('return-to-training recommendations', () => {
  it('does not infer detraining when a user has no history at all', () => {
    const result = calculateReturnRecommendation({
      programExercise,
      history: history({
        exerciseLastPerformedAt: null,
        muscleLastPerformedAt: null,
        recentMuscleSets: 0,
        baselineMuscleSetsPer28Days: 0,
        exerciseSessions: [],
      }),
      now,
      loadConstraints: olympDumbbells,
    });

    expect(result).toMatchObject({
      mode: 'normal',
      targetSets: 4,
      targetRIR: 2,
      calibrationRequired: false,
    });
  });

  it('keeps normal programming when the exercise gap is not over six weeks', () => {
    const result = calculateReturnRecommendation({
      programExercise,
      history: history({ exerciseLastPerformedAt: daysAgo(42) }),
      now,
      loadConstraints: olympDumbbells,
    });

    expect(result).toMatchObject({
      mode: 'normal',
      targetSets: 4,
      targetRIR: 2,
      calibrationRequired: false,
      suggestedWeight: null,
    });
  });

  it('recalibrates a stale exercise while preserving maintained-muscle volume', () => {
    const result = calculateReturnRecommendation({
      programExercise,
      history: history({ exerciseLastPerformedAt: daysAgo(60) }),
      now,
      loadConstraints: olympDumbbells,
    });

    expect(result).toMatchObject({
      mode: 'exercise-reintro',
      exerciseGapDays: 60,
      muscleMaintained: true,
      targetSets: 2,
      targetRIR: 3,
      weightCeiling: 19,
      suggestedWeight: 16,
      calibrationRequired: true,
      historySessionCount: 3,
    });
  });

  it('uses a broader reduction when the primary muscle also had a long break', () => {
    const result = calculateReturnRecommendation({
      programExercise,
      history: history({ muscleLastPerformedAt: daysAgo(60), recentMuscleSets: 0 }),
      now,
      loadConstraints: olympDumbbells,
    });

    expect(result).toMatchObject({
      mode: 'muscle-reintro',
      muscleGapDays: 60,
      muscleMaintained: false,
      targetSets: 1,
      targetRIR: 4,
      weightCeiling: 19,
      suggestedWeight: 15,
    });
  });

  it('does not convert another exercise into an exact load for a new movement', () => {
    const result = calculateReturnRecommendation({
      programExercise,
      history: history({ exerciseLastPerformedAt: null, exerciseSessions: [] }),
      now,
      loadConstraints: olympDumbbells,
    });

    expect(result).toMatchObject({
      mode: 'new-exercise',
      muscleMaintained: true,
      targetSets: 2,
      targetRIR: 3,
      weightCeiling: null,
      suggestedWeight: 10,
    });
  });

  it('treats sharply reduced recent muscle volume as not maintained', () => {
    const result = calculateReturnRecommendation({
      programExercise,
      history: history({ recentMuscleSets: 2, baselineMuscleSetsPer28Days: 8 }),
      now,
      loadConstraints: olympDumbbells,
    });

    expect(result).toMatchObject({
      mode: 'exercise-reintro',
      muscleMaintained: false,
      recentVolumeRatio: 0.25,
      targetSets: 1,
      targetRIR: 4,
      suggestedWeight: 15,
    });
  });

  it('does not suggest a load for equipment marked unavailable in the selected gym', () => {
    const result = calculateReturnRecommendation({
      programExercise,
      history: history(),
      now,
      loadConstraints: { ...olympDumbbells, isAvailable: false },
    });

    expect(result.suggestedWeight).toBeNull();
    expect(result.weightCeiling).toBeNull();
  });

  it('uses current bodyweight when recalibrating added load', () => {
    const bodyweightExercise: ReturnProgramExercise = {
      ...programExercise,
      exerciseId: 'pull-up',
      exercise: {
        category: 'COMPOUND',
        equipmentType: 'BODYWEIGHT',
        usesBodyweight: true,
      },
    };
    const result = calculateReturnRecommendation({
      programExercise: bodyweightExercise,
      history: history({ exerciseSessions: sessions(0) }),
      now,
      bodyweight: 80,
    });

    expect(result.mode).toBe('exercise-reintro');
    expect(result.suggestedWeight).toBe(0);
    expect(result.weightCeiling).toBe(0);
  });
});
