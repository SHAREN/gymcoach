import { describe, expect, it } from 'vitest';
import {
  classificationMetadataAfterClientUpdate,
  deriveBackupExerciseClassification,
  type ExerciseClassificationIdentity,
} from './exercise-classification';
import { reviewedExerciseLoadProfile } from './schemas/exercise-load-profile';

const catalogBench: ExerciseClassificationIdentity = {
  name: 'Barbell bench press',
  muscleGroup: 'CHEST',
  category: 'COMPOUND',
  defaultRestSec: 150,
  notes:
    'Bar in the heel of the palm, wrist aligned with the forearm. Elbows at 45 degrees from the torso. Touch the chest.',
  usesBodyweight: false,
  equipmentType: 'BARBELL',
};

describe('exercise classification ownership', () => {
  it.each([
    ['name', 'Custom bench'],
    ['muscleGroup', 'TRICEPS'],
    ['category', 'ISOLATION'],
    ['defaultRestSec', 90],
    ['notes', 'Custom technique'],
    ['usesBodyweight', true],
    ['equipmentType', 'DUMBBELL'],
  ] as const)('resets server classification when %s changes', (field, value) => {
    expect(
      classificationMetadataAfterClientUpdate(catalogBench, {
        ...catalogBench,
        [field]: value,
      }),
    ).toMatchObject({
      catalogOrigin: null,
      loadProfile: { classification: 'UNCLASSIFIED', provenance: 'UNCLASSIFIED' },
    });
  });

  it('preserves server classification metadata when the identity is unchanged', () => {
    expect(classificationMetadataAfterClientUpdate(catalogBench, { ...catalogBench })).toEqual({});
  });

  it('rederives catalog metadata only from a complete catalog fingerprint', () => {
    expect(deriveBackupExerciseClassification(catalogBench)).toMatchObject({
      catalogOrigin: 'SYSTEM_DEFAULT_V1',
      loadProfile: { classification: 'REVIEWED', provenance: 'SYSTEM_CATALOG_REVIEW' },
    });

    expect(
      deriveBackupExerciseClassification({
        ...catalogBench,
        defaultRestSec: 90,
        loadProfile: reviewedExerciseLoadProfile({
          primaryMuscles: ['CHEST'],
          secondaryMuscles: ['TRICEPS'],
        }),
      }),
    ).toMatchObject({
      catalogOrigin: null,
      loadProfile: { classification: 'UNCLASSIFIED', provenance: 'UNCLASSIFIED' },
    });
  });
});
