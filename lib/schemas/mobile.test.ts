import { describe, expect, it } from 'vitest';
import { mobileSyncOperationSchema } from '@/lib/schemas/mobile';

describe('mobileSyncOperationSchema', () => {
  it('accepts bounded planned set count updates', () => {
    expect(
      mobileSyncOperationSchema.parse({
        operationId: 'target_sets_schema_01',
        type: 'UPDATE_TARGET_SETS',
        programExerciseId: 'program_exercise_01',
        previousTargetSets: 1,
        targetSets: 20,
      }),
    ).toMatchObject({
      type: 'UPDATE_TARGET_SETS',
      previousTargetSets: 1,
      targetSets: 20,
    });
  });

  it('rejects planned set counts outside 1 through 20', () => {
    const operation = {
      operationId: 'target_sets_schema_02',
      type: 'UPDATE_TARGET_SETS',
      programExerciseId: 'program_exercise_02',
      previousTargetSets: 3,
      targetSets: 5,
    };

    expect(mobileSyncOperationSchema.safeParse({ ...operation, targetSets: 0 }).success).toBe(
      false,
    );
    expect(mobileSyncOperationSchema.safeParse({ ...operation, targetSets: 21 }).success).toBe(
      false,
    );
    expect(
      mobileSyncOperationSchema.safeParse({ ...operation, previousTargetSets: 0 }).success,
    ).toBe(false);
    expect(
      mobileSyncOperationSchema.safeParse({ ...operation, previousTargetSets: 21 }).success,
    ).toBe(false);
  });
});
