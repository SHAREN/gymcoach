import { describe, expect, it } from 'vitest';
import { mobileSyncBatchSchema, mobileSyncOperationSchema } from '@/lib/schemas/mobile';

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

  it('accepts distinct active-workout exercise replacements', () => {
    expect(
      mobileSyncOperationSchema.parse({
        operationId: 'replace_exercise_schema_01',
        type: 'REPLACE_PROGRAM_EXERCISE',
        sessionId: 'session_schema_01',
        programExerciseId: 'program_exercise_schema_01',
        previousExerciseId: 'exercise_schema_01',
        replacementExerciseId: 'exercise_schema_02',
      }),
    ).toMatchObject({
      type: 'REPLACE_PROGRAM_EXERCISE',
      previousExerciseId: 'exercise_schema_01',
      replacementExerciseId: 'exercise_schema_02',
    });
  });

  it('rejects replacing an exercise with itself', () => {
    expect(
      mobileSyncOperationSchema.safeParse({
        operationId: 'replace_exercise_schema_02',
        type: 'REPLACE_PROGRAM_EXERCISE',
        sessionId: 'session_schema_02',
        programExerciseId: 'program_exercise_schema_02',
        previousExerciseId: 'exercise_schema_same',
        replacementExerciseId: 'exercise_schema_same',
      }).success,
    ).toBe(false);
  });

  it('accepts an atomic active-workout exercise list mutation', () => {
    const exercise = (id: string, exerciseId: string, order: number) => ({
      id,
      exerciseId,
      order,
      targetSets: 4,
      targetDropSets: 0,
      targetRepsMin: 8,
      targetRepsMax: 12,
      targetRIR: 2,
      restSec: 90,
      tempo: null,
      notes: null,
      supersetGroup: null,
      autoregulationMode: 'PRESERVE_RIR',
      fatigueRate: null,
      loadAdjustmentPct: null,
    });
    const parsed = mobileSyncOperationSchema.parse({
      operationId: 'mutate_workout_schema_01',
      type: 'MUTATE_WORKOUT_EXERCISES',
      sessionId: 'session_schema_mutate_01',
      workoutId: 'workout_schema_mutate_01',
      previousExercises: [exercise('program_exercise_01', 'exercise_01', 0)],
      exercises: [
        exercise('program_exercise_01', 'exercise_01', 0),
        exercise('program_exercise_02', 'exercise_02', 1),
      ],
      previousActiveExerciseId: 'exercise_01',
      nextActiveExerciseId: 'exercise_02',
    });

    expect(parsed.type).toBe('MUTATE_WORKOUT_EXERCISES');
  });

  it('rejects duplicate exercises, invalid repetition ranges and missing active members', () => {
    const exercise = (id: string, exerciseId: string, order: number) => ({
      id,
      exerciseId,
      order,
      targetSets: 4,
      targetDropSets: 0,
      targetRepsMin: 12,
      targetRepsMax: 8,
      targetRIR: 2,
      restSec: 90,
      autoregulationMode: 'PRESERVE_RIR',
    });
    expect(
      mobileSyncOperationSchema.safeParse({
        operationId: 'mutate_workout_schema_02',
        type: 'MUTATE_WORKOUT_EXERCISES',
        sessionId: 'session_schema_mutate_02',
        workoutId: 'workout_schema_mutate_02',
        previousExercises: [exercise('program_exercise_01', 'exercise_01', 0)],
        exercises: [
          exercise('program_exercise_01', 'exercise_01', 0),
          exercise('program_exercise_02', 'exercise_01', 1),
        ],
        previousActiveExerciseId: 'exercise_missing',
        nextActiveExerciseId: 'exercise_missing',
      }).success,
    ).toBe(false);
  });
});

const validFrozenSnapshot = {
  equipmentNameSnapshot: 'Cable station',
  selectedLoadKg: 50,
  selectedLoadMultiplierSnapshot: 0.5,
  nominalResistanceKg: 25,
  equipmentLoadSnapshot: {
    version: 2,
    revisionId: 'revision_equipment_0001',
    gymEquipmentId: 'equipment_cable_0001',
    loadType: 'SELECTORIZED',
    equipmentType: 'CABLE',
    selectedLoadKg: 50,
    selectedLoadMultiplier: 0.5,
    nominalResistanceKg: 25,
    baseLoadKg: 0,
    loadingSides: 1,
    weightOptions: [40, 45, 50],
    platePool: null,
  },
} as const;

function batch(setOverrides: Record<string, unknown> = {}) {
  return {
    operations: [
      {
        operationId: 'operation_snapshot_0001',
        type: 'UPSERT_SET',
        set: {
          id: 'mobile_set_snapshot_0001',
          sessionId: 'mobile_session_snapshot_0001',
          exerciseId: 'exercise_snapshot_0001',
          gymEquipmentId: 'equipment_cable_0001',
          setNumber: 1,
          weight: 50,
          reps: 10,
          rir: 2,
          isWarmup: false,
          isDropSet: false,
          completedAt: '2026-07-15T10:05:00.000Z',
          ...setOverrides,
        },
      },
    ],
  };
}

describe('mobile sync equipment snapshot schema', () => {
  it('keeps a complete valid frozen snapshot instead of stripping it', () => {
    const parsed = mobileSyncBatchSchema.parse(
      batch({ frozenEquipmentSnapshot: validFrozenSnapshot }),
    );
    const operation = parsed.operations[0];
    expect(operation?.type).toBe('UPSERT_SET');
    if (operation?.type !== 'UPSERT_SET') throw new Error('Expected set operation.');
    expect(operation.set.frozenEquipmentSnapshot).toEqual(validFrozenSnapshot);
  });

  it('keeps legacy set payloads without snapshot fields valid', () => {
    const parsed = mobileSyncBatchSchema.parse(batch());
    const operation = parsed.operations[0];
    expect(operation?.type).toBe('UPSERT_SET');
    if (operation?.type !== 'UPSERT_SET') throw new Error('Expected set operation.');
    expect(operation.set.frozenEquipmentSnapshot).toBeUndefined();
  });

  it('rejects inconsistent, unbounded, or extended snapshot data', () => {
    expect(
      mobileSyncBatchSchema.safeParse(
        batch({
          frozenEquipmentSnapshot: {
            ...validFrozenSnapshot,
            selectedLoadMultiplierSnapshot: 25,
          },
        }),
      ).success,
    ).toBe(false);
    expect(
      mobileSyncBatchSchema.safeParse(
        batch({
          frozenEquipmentSnapshot: {
            ...validFrozenSnapshot,
            equipmentLoadSnapshot: {
              ...validFrozenSnapshot.equipmentLoadSnapshot,
              selectedLoadKg: 45,
            },
          },
        }),
      ).success,
    ).toBe(false);
    expect(
      mobileSyncBatchSchema.safeParse(
        batch({
          frozenEquipmentSnapshot: {
            ...validFrozenSnapshot,
            equipmentLoadSnapshot: {
              ...validFrozenSnapshot.equipmentLoadSnapshot,
              arbitraryClientJson: { nested: true },
            },
          },
        }),
      ).success,
    ).toBe(false);
    expect(
      mobileSyncBatchSchema.safeParse(
        batch({
          weight: 50.001,
          frozenEquipmentSnapshot: validFrozenSnapshot,
        }),
      ).success,
    ).toBe(false);
  });

  it('preserves valid multiplier precision below one hundredth', () => {
    const multiplier = 0.005;
    const preciseSnapshot = {
      ...validFrozenSnapshot,
      selectedLoadMultiplierSnapshot: multiplier,
      nominalResistanceKg: 0.25,
      equipmentLoadSnapshot: {
        ...validFrozenSnapshot.equipmentLoadSnapshot,
        selectedLoadMultiplier: multiplier,
        nominalResistanceKg: 0.25,
      },
    };
    expect(
      mobileSyncBatchSchema.safeParse(batch({ frozenEquipmentSnapshot: preciseSnapshot })).success,
    ).toBe(true);
  });
});
