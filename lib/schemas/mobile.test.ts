import { describe, expect, it } from 'vitest';
import { mobileSyncBatchSchema } from '@/lib/schemas/mobile';

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
