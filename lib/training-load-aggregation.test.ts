import { describe, expect, it } from 'vitest';
import { MuscleGroup } from '@/lib/prisma-client';
import {
  reviewedExerciseLoadProfile,
  unclassifiedExerciseLoadProfile,
} from '@/lib/schemas/exercise-load-profile';
import { aggregateTrainingLoad, type TrainingLoadSetInput } from '@/lib/training-load-aggregation';

const pressProfile = reviewedExerciseLoadProfile({
  primaryMuscles: [MuscleGroup.CHEST],
  secondaryMuscles: [MuscleGroup.TRICEPS, MuscleGroup.SHOULDERS_FRONT],
  movementPatterns: ['HORIZONTAL_PUSH'],
  fatigueTags: ['SYSTEMIC_COMPOUND'],
  jointStress: ['SHOULDER', 'ELBOW'],
});

function set(overrides: Partial<TrainingLoadSetInput> = {}): TrainingLoadSetInput {
  return {
    setId: 'set-1',
    exerciseId: 'bench',
    legacyMuscleGroup: MuscleGroup.CHEST,
    loadProfile: pressProfile,
    isWarmup: false,
    isDropSet: false,
    rir: 2,
    historyReliability: 'RELIABLE',
    ...overrides,
  };
}

describe('aggregateTrainingLoad', () => {
  it('keeps direct and indirect sets authoritative and deduplicates set ids', () => {
    const result = aggregateTrainingLoad([set(), set()]);

    expect(result.qualifyingSetCount).toBe(1);
    expect(result.deduplicatedSetCount).toBe(1);
    expect(result.muscles.CHEST).toMatchObject({ directSets: 1, indirectSets: 0 });
    expect(result.muscles.TRICEPS).toMatchObject({
      directSets: 0,
      indirectSets: 1,
      equivalentSets: 0.5,
    });
    expect(result.movementPatterns.HORIZONTAL_PUSH).toBe(1);
    expect(result.fatigueTags.SYSTEMIC_COMPOUND).toBe(1);
    expect(result.jointStress.SHOULDER).toBe(1);
  });

  it('preserves warm-up, drop-set, RIR and reliability distinctions', () => {
    const result = aggregateTrainingLoad([
      set({ setId: 'warmup', isWarmup: true }),
      set({ setId: 'regular-missing-rir', rir: null, historyReliability: 'UNKNOWN' }),
      set({ setId: 'drop', isDropSet: true, rir: 0, historyReliability: 'UNRELIABLE' }),
    ]);

    expect(result.qualifyingSetCount).toBe(2);
    expect(result.muscles.CHEST!.directSetBreakdown).toMatchObject({
      total: 2,
      regular: 1,
      drop: 1,
      setsWithRir: 0,
      setsWithoutRir: 1,
      setsAtRir0To4: 0,
      unreliableHistory: 1,
      unknownHistoryReliability: 1,
    });
  });

  it('never applies the secondary coefficient to unknown participation', () => {
    const result = aggregateTrainingLoad([set({ loadProfile: unclassifiedExerciseLoadProfile() })]);

    expect(result.unclassifiedSetCount).toBe(1);
    expect(result.unknownSecondaryParticipationSetCount).toBe(1);
    expect(result.muscles).toEqual({});
  });

  it('exposes coefficient sensitivity without replacing raw counts', () => {
    const inputs = [set(), set({ setId: 'set-2' })];
    const conservative = aggregateTrainingLoad(inputs, { secondaryCoefficient: 0 });
    const defaultResult = aggregateTrainingLoad(inputs);
    const oneToOne = aggregateTrainingLoad(inputs, { secondaryCoefficient: 1 });

    expect(conservative.muscles.TRICEPS!.indirectSets).toBe(2);
    expect(defaultResult.muscles.TRICEPS!.indirectSets).toBe(2);
    expect(oneToOne.muscles.TRICEPS!.indirectSets).toBe(2);
    expect([
      conservative.muscles.TRICEPS!.equivalentSets,
      defaultResult.muscles.TRICEPS!.equivalentSets,
      oneToOne.muscles.TRICEPS!.equivalentSets,
    ]).toEqual([0, 1, 2]);
  });

  it('does not invent effort or range-of-motion coefficients', () => {
    const missing = aggregateTrainingLoad([set({ rir: null })]);
    const unreliable = aggregateTrainingLoad([
      set({
        effortCoefficient: { status: 'UNRELIABLE', value: 1.25 },
        rangeOfMotionCoefficient: { status: 'UNRELIABLE', value: 0.75 },
      }),
    ]);
    const incompleteKnown = aggregateTrainingLoad([
      set({ effortCoefficient: { status: 'KNOWN', value: 1.25 } }),
    ]);
    const reliableExplicit = aggregateTrainingLoad([
      set({
        effortCoefficient: {
          status: 'KNOWN',
          value: 1.25,
          provenance: 'explicit-test-input',
          confidence: 'MEDIUM',
        },
        rangeOfMotionCoefficient: {
          status: 'KNOWN',
          value: 0.8,
          provenance: 'explicit-test-input',
          confidence: 'HIGH',
        },
      }),
    ]);

    expect(missing.muscles.CHEST!.equivalentSets).toBe(1);
    expect(missing.confidence).toBe('LOW');
    expect(missing.equivalentSetsHeuristic.effortCoefficient.unknownSetCount).toBe(1);
    expect(unreliable.muscles.CHEST!.equivalentSets).toBe(1);
    expect(unreliable.equivalentSetsHeuristic.effortCoefficient.unreliableSetCount).toBe(1);
    expect(unreliable.equivalentSetsHeuristic.rangeOfMotionCoefficient.unreliableSetCount).toBe(1);
    expect(incompleteKnown.muscles.CHEST!.equivalentSets).toBe(1);
    expect(incompleteKnown.confidence).toBe('LOW');
    expect(incompleteKnown.equivalentSetsHeuristic.effortCoefficient.unreliableSetCount).toBe(1);
    expect(reliableExplicit.muscles.CHEST!.equivalentSets).toBe(1);
    expect(reliableExplicit.confidence).toBe('MEDIUM');
    expect(reliableExplicit.equivalentSetsHeuristic.effortCoefficient.appliedSetCount).toBe(1);
    expect(reliableExplicit.equivalentSetsHeuristic.rangeOfMotionCoefficient.appliedSetCount).toBe(
      1,
    );
  });
});
