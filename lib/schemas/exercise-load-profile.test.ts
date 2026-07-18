import { describe, expect, it } from 'vitest';
import { MuscleGroup } from '@/lib/prisma-client';
import {
  exerciseLoadProfileSchema,
  legacyPrimaryExerciseLoadProfile,
  reviewedExerciseLoadProfile,
  unclassifiedExerciseLoadProfile,
} from '@/lib/schemas/exercise-load-profile';

describe('exerciseLoadProfileSchema', () => {
  it('accepts reviewed multi-muscle profiles without normalizing contributions', () => {
    const profile = reviewedExerciseLoadProfile({
      primaryMuscles: [MuscleGroup.CHEST],
      secondaryMuscles: [MuscleGroup.TRICEPS, MuscleGroup.SHOULDERS_FRONT],
      movementPatterns: ['HORIZONTAL_PUSH'],
      fatigueTags: ['SYSTEMIC_COMPOUND'],
      jointStress: ['SHOULDER', 'ELBOW'],
    });

    expect(exerciseLoadProfileSchema.parse(profile)).toEqual(profile);
    expect(profile.primaryMuscles.entries).toHaveLength(1);
    expect(profile.secondaryMuscles.entries).toHaveLength(2);
  });

  it('keeps unclassified and legacy-primary states explicit', () => {
    expect(unclassifiedExerciseLoadProfile()).toMatchObject({
      classification: 'UNCLASSIFIED',
      primaryMuscles: { state: 'UNKNOWN', entries: [] },
      secondaryMuscles: { state: 'UNKNOWN', entries: [] },
    });
    expect(legacyPrimaryExerciseLoadProfile(MuscleGroup.BICEPS)).toMatchObject({
      classification: 'LEGACY_PRIMARY_ONLY',
      primaryMuscles: {
        state: 'KNOWN',
        entries: [{ muscleGroup: MuscleGroup.BICEPS }],
      },
      secondaryMuscles: { state: 'UNKNOWN', entries: [] },
    });
  });

  it('rejects duplicate and contradictory muscle entries', () => {
    const profile = reviewedExerciseLoadProfile({
      primaryMuscles: [MuscleGroup.CHEST],
      secondaryMuscles: [MuscleGroup.TRICEPS],
      movementPatterns: [],
      fatigueTags: [],
      jointStress: [],
    });

    expect(
      exerciseLoadProfileSchema.safeParse({
        ...profile,
        primaryMuscles: {
          ...profile.primaryMuscles,
          entries: [...profile.primaryMuscles.entries, ...profile.primaryMuscles.entries],
        },
      }).success,
    ).toBe(false);
    expect(
      exerciseLoadProfileSchema.safeParse({
        ...profile,
        secondaryMuscles: {
          ...profile.secondaryMuscles,
          entries: [profile.primaryMuscles.entries[0]],
        },
      }).success,
    ).toBe(false);
  });

  it('rejects classified entries inside an unknown dimension', () => {
    const profile = legacyPrimaryExerciseLoadProfile(MuscleGroup.CHEST);
    expect(
      exerciseLoadProfileSchema.safeParse({
        ...profile,
        secondaryMuscles: {
          state: 'UNKNOWN',
          entries: [profile.primaryMuscles.entries[0]],
        },
      }).success,
    ).toBe(false);
  });
});
