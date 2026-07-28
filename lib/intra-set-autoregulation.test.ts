import { describe, expect, it } from 'vitest';
import type { Exercise, ProgramExercise } from '@/lib/prisma-client';
import {
  defaultIntraSetConfig,
  recommendFirstWorkingSet,
  recommendNextIntraSet,
  recommendNextIntraSetFromSharedContract,
} from '@/lib/intra-set-autoregulation';
import type { ReturnRecommendation } from '@/lib/return-to-training';
import type { GymLoadConstraints } from '@/lib/gym-loads';

const squat: Exercise = {
  id: 'squat',
  userId: 'u',
  name: 'Back Squat',
  muscleGroup: 'QUADS',
  category: 'COMPOUND',
  defaultRestSec: 180,
  notes: null,
  usesBodyweight: false,
  equipmentType: 'BARBELL',
  catalogOrigin: null,
  loadProfile: {},
  createdAt: new Date(),
};

const curl: Exercise = {
  ...squat,
  id: 'curl',
  name: 'Cable Curl',
  muscleGroup: 'BICEPS',
  category: 'ISOLATION',
  defaultRestSec: 60,
};

function makePe(
  exercise: Exercise,
  overrides: Partial<ProgramExercise> = {},
): ProgramExercise & { exercise: Exercise } {
  return {
    id: 'pe',
    workoutId: 'w',
    exerciseId: exercise.id,
    targetDropSets: 0,
    order: 1,
    targetSets: 5,
    targetRepsMin: 8,
    targetRepsMax: 12,
    targetRIR: 2,
    restSec: 120,
    tempo: null,
    notes: null,
    supersetGroup: null,
    autoregulationMode: 'PRESERVE_RIR',
    fatigueRate: null,
    loadAdjustmentPct: null,
    ...overrides,
    exercise,
  };
}

function sharedRecommendation(overrides: Partial<ReturnRecommendation> = {}): ReturnRecommendation {
  return {
    mode: 'normal',
    exerciseGapDays: 5,
    returnGapDays: 5,
    muscleGapDays: 5,
    muscleMaintained: true,
    recentMuscleSets: 6,
    baselineMuscleSetsPer28Days: 24,
    recentVolumeRatio: 1,
    targetSets: 3,
    targetRIR: 2,
    weightCeiling: null,
    suggestedWeight: null,
    startFraction: null,
    calibrationRequired: false,
    historySessionCount: 3,
    recentHistorySessionCount: 3,
    longTermHistorySessionCount: 0,
    nonComparableHistorySessionCount: 0,
    historyBasis: 'recent-exact',
    confidence: 'high',
    calibrationKind: 'none',
    strengthSummary: {
      movement: {
        sessionCount: 3,
        workingSetCount: 9,
        lastPerformedAt: '2026-07-07T12:00:00.000Z',
        lastReliableLoad: 32.5,
        recentStrengthAnchor: 45,
        historicalStrengthAnchor: null,
        confidence: 'high',
      },
      equipment: {
        sessionCount: 3,
        workingSetCount: 9,
        lastPerformedAt: '2026-07-07T12:00:00.000Z',
        lastReliableLoad: 32.5,
        recentStrengthAnchor: 45,
        historicalStrengthAnchor: null,
        confidence: 'high',
      },
      anchorScope: 'exact-equipment',
    },
    ...overrides,
  };
}

describe('intra-set autoregulation defaults', () => {
  it('assigns more fatigue to lower-body compounds than isolation work', () => {
    expect(defaultIntraSetConfig(squat).fatigueRate).toBeGreaterThan(
      defaultIntraSetConfig(curl).fatigueRate,
    );
  });
});

describe('recommendFirstWorkingSet', () => {
  it('adds one load step and resets reps when every prior working set hit the top', () => {
    const result = recommendFirstWorkingSet({
      programExercise: makePe(squat),
      previousSets: [
        { weight: 100, reps: 12, rir: 2 },
        { weight: 100, reps: 12, rir: 2 },
        { weight: 100, reps: 12, rir: 2 },
      ],
    });

    expect(result).toMatchObject({
      weight: 102.5,
      reps: 8,
      rir: 2,
      reason: 'progress-load',
      fatigueLoss: 0,
      confidence: 'high',
    });
  });

  it('holds the working load and targets one more rep inside the program range', () => {
    const result = recommendFirstWorkingSet({
      programExercise: makePe(squat),
      previousSets: [
        { weight: 100, reps: 10, rir: 2 },
        { weight: 100, reps: 9, rir: 1 },
        { weight: 100, reps: 8, rir: 1 },
        { weight: 80, reps: 15, rir: 0, isDropSet: true },
      ],
    });

    expect(result).toMatchObject({
      weight: 100,
      reps: 11,
      rir: 2,
      reason: 'progress-reps',
    });
  });

  it('does not increase the load or reps when recent readiness requires a hold', () => {
    const result = recommendFirstWorkingSet({
      programExercise: makePe(squat),
      previousSets: [
        { weight: 100, reps: 12, rir: 2 },
        { weight: 100, reps: 12, rir: 2 },
        { weight: 100, reps: 12, rir: 2 },
      ],
      readiness: { readiness: 2, soreness: null, ageHours: 4 },
    });

    expect(result).toMatchObject({
      weight: 100,
      reps: 12,
      reason: 'readiness-hold',
    });
  });

  it('lowers confidence when previous RIR is missing', () => {
    const result = recommendFirstWorkingSet({
      programExercise: makePe(curl),
      previousSets: [{ weight: 20, reps: 10, rir: null }],
    });

    expect(result?.confidence).toBe('low');
  });
});

describe('recommendNextIntraSet', () => {
  it('preserves RIR by lowering the rep target as fatigue accumulates', () => {
    const result = recommendNextIntraSet({
      programExercise: makePe(squat, { fatigueRate: 1 }),
      completedSets: [{ weight: 100, reps: 12, rir: 2 }],
      recoverySec: 120,
    });

    expect(result).toMatchObject({
      mode: 'PRESERVE_RIR',
      weight: 100,
      reps: 11,
      rir: 2,
      reason: 'adjust-reps',
    });
  });

  it('preserves reps by reducing load when predicted capacity falls', () => {
    const result = recommendNextIntraSet({
      programExercise: makePe(squat, {
        autoregulationMode: 'PRESERVE_REPS',
        fatigueRate: 1,
        loadAdjustmentPct: 2.5,
      }),
      completedSets: [{ weight: 100, reps: 12, rir: 2 }],
      recoverySec: 120,
    });

    expect(result).toMatchObject({
      mode: 'PRESERVE_REPS',
      weight: 97.5,
      reps: 12,
      rir: 2,
      reason: 'reduce-load',
    });
  });

  it('penalizes short rest more than full rest', () => {
    const pe = makePe(squat, { fatigueRate: 1 });
    const set = [{ weight: 100, reps: 12, rir: 2 }];
    const short = recommendNextIntraSet({
      programExercise: pe,
      completedSets: set,
      recoverySec: 60,
    });
    const full = recommendNextIntraSet({
      programExercise: pe,
      completedSets: set,
      recoverySec: 120,
    });

    expect(short!.fatigueLoss).toBeGreaterThan(full!.fatigueLoss);
  });

  it('adds fatigue for a same-muscle superset', () => {
    const pe = makePe(squat, { fatigueRate: 1 });
    const set = [{ weight: 100, reps: 12, rir: 2 }];
    const normal = recommendNextIntraSet({
      programExercise: pe,
      completedSets: set,
      recoverySec: 120,
    });
    const superset = recommendNextIntraSet({
      programExercise: pe,
      completedSets: set,
      recoverySec: 120,
      sameMuscleSuperset: true,
    });

    expect(superset!.fatigueLoss).toBeGreaterThan(normal!.fatigueLoss);
  });

  it('never increases load when recovery logic forbids it', () => {
    const result = recommendNextIntraSet({
      programExercise: makePe(curl, {
        targetRepsMin: 8,
        targetRepsMax: 10,
        autoregulationMode: 'PRESERVE_REPS',
        fatigueRate: 0.25,
      }),
      completedSets: [{ weight: 20, reps: 10, rir: 5 }],
      recoverySec: 120,
      allowLoadIncrease: false,
    });

    expect(result!.weight).toBe(20);
  });

  it('does not jump above a return-session ceiling across a gym inventory gap', () => {
    const result = recommendNextIntraSet({
      programExercise: makePe(curl, {
        targetRepsMin: 8,
        targetRepsMax: 10,
        autoregulationMode: 'PRESERVE_REPS',
        fatigueRate: 0.25,
      }),
      completedSets: [{ weight: 16, reps: 10, rir: 5 }],
      recoverySec: 120,
      maxWeight: 17,
      loadConstraints: {
        equipmentType: 'DUMBBELL',
        dumbbellWeights: [10, 12, 14, 16, 19],
      },
    });

    expect(result!.weight).toBe(16);
  });

  it('adjusts reps instead of attempting a negative bodyweight load', () => {
    const bodyweightExercise = { ...squat, usesBodyweight: true };
    const result = recommendNextIntraSet({
      programExercise: makePe(bodyweightExercise, {
        autoregulationMode: 'PRESERVE_REPS',
        fatigueRate: 1,
      }),
      completedSets: [{ weight: 0, reps: 12, rir: 2 }],
      recoverySec: 120,
    });

    expect(result).toMatchObject({
      weight: 0,
      reps: 11,
      reason: 'bodyweight-adjust-reps',
    });
  });

  it('ignores warmups and drop sets when selecting the reference set', () => {
    const result = recommendNextIntraSet({
      programExercise: makePe(squat, { fatigueRate: 1 }),
      completedSets: [
        { weight: 60, reps: 5, rir: 5, isWarmup: true },
        { weight: 100, reps: 12, rir: 2 },
        { weight: 80, reps: 15, rir: 0, isDropSet: true },
      ],
      recoverySec: 120,
    });

    expect(result).toMatchObject({ weight: 100, reps: 11 });
  });
});

describe('shared next-set golden contract', () => {
  const exercise = makePe(curl, {
    targetRepsMin: 10,
    targetRepsMax: 10,
    autoregulationMode: 'PRESERVE_RIR',
    fatigueRate: 0.5,
    loadAdjustmentPct: 3,
  });
  const completedSets = [{ weight: 32.5, reps: 12, rir: 2 }];
  const loadConstraints: GymLoadConstraints = {
    equipmentType: 'DUMBBELL',
    dumbbellWeights: [30, 32.5, 35],
  };

  it('matches the return target for 32.5 kg x 12 at RIR 2', () => {
    const result = recommendNextIntraSetFromSharedContract({
      programExercise: exercise,
      returnRecommendation: sharedRecommendation({
        mode: 'muscle-reintro',
        targetSets: 1,
        targetRIR: 4,
        weightCeiling: 32.5,
      }),
      completedSets,
      recoverySec: 120,
      loadConstraints,
    });

    expect(result).toEqual({
      mode: 'PRESERVE_RIR',
      weight: 32.5,
      reps: 10,
      rir: 4,
      reason: 'adjust-reps',
      predictedRepsAtSameLoad: 10,
      fatigueLoss: 0.5,
      confidence: 'medium',
    });
  });

  it('fails closed when the shared session state is missing or stale', () => {
    expect(
      recommendNextIntraSetFromSharedContract({
        programExercise: exercise,
        returnRecommendation: null,
        completedSets,
        recoverySec: 120,
        loadConstraints,
      }),
    ).toBeNull();
  });

  it('rounds at or below the return ceiling instead of crossing an equipment step', () => {
    const result = recommendNextIntraSetFromSharedContract({
      programExercise: exercise,
      returnRecommendation: sharedRecommendation({
        mode: 'exercise-reintro',
        targetRIR: 3,
        weightCeiling: 33,
      }),
      completedSets: [{ weight: 32.5, reps: 12, rir: 5 }],
      recoverySec: 120,
      loadConstraints,
    });

    expect(result?.weight).toBe(32.5);
    expect(result?.weight).toBeLessThanOrEqual(33);
    expect(result?.rir).toBe(3);
  });

  it('preserves the ordinary unrestricted scenario', () => {
    const result = recommendNextIntraSetFromSharedContract({
      programExercise: exercise,
      returnRecommendation: sharedRecommendation(),
      completedSets,
      recoverySec: 120,
      loadConstraints,
    });

    expect(result).toMatchObject({
      weight: 35,
      reps: 10,
      rir: 2,
      reason: 'increase-load',
      confidence: 'medium',
    });
  });
});
