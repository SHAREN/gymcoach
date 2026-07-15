import { describe, expect, it } from 'vitest';
import {
  frozenSetLoadConstraints,
  frozenSetLoadSnapshotVersion,
  preserveSetEquipmentSnapshot,
} from '@/lib/set-equipment';

describe('frozen set load constraints', () => {
  it('reconstructs existing-row loads from the immutable v2 snapshot', () => {
    const constraints = frozenSetLoadConstraints('Original cable', {
      version: 2,
      revisionId: 'revision_original_cable',
      gymEquipmentId: 'equipment_original_cable',
      loadType: 'SELECTORIZED',
      equipmentType: 'CABLE',
      selectedLoadKg: 45,
      selectedLoadMultiplier: 0.5,
      nominalResistanceKg: 22.5,
      baseLoadKg: 0,
      loadingSides: 1,
      weightOptions: [40, 45, 50],
      platePool: null,
    });

    expect(constraints).toMatchObject({
      equipmentType: 'CABLE',
      isAvailable: true,
      equipmentId: 'equipment_original_cable',
      equipmentOptions: [
        {
          equipmentName: 'Original cable',
          attainableLoads: [40, 45, 50],
          selectedLoadMultiplier: 0.5,
        },
      ],
    });
  });

  it('keeps valid v1 rows frozen without inventing an attainable-load scale', () => {
    const equipmentLoadSnapshot = {
      version: 1 as const,
      loadType: 'SELECTORIZED' as const,
      equipmentType: 'CABLE' as const,
      selectedLoadKg: 40,
      selectedLoadMultiplier: 0.5,
      nominalResistanceKg: 20,
      baseLoadKg: 0,
      loadingSides: 1,
      platePool: null,
    };

    expect(frozenSetLoadSnapshotVersion(equipmentLoadSnapshot)).toBe(1);
    expect(frozenSetLoadConstraints('Legacy cable', equipmentLoadSnapshot)).toBeNull();

    const existing = {
      gymEquipmentId: 'legacy-cable',
      equipmentNameSnapshot: 'Legacy cable',
      selectedLoadKg: 40,
      selectedLoadMultiplierSnapshot: 0.5,
      nominalResistanceKg: 20,
      equipmentLoadSnapshot,
    };
    expect(() => preserveSetEquipmentSnapshot(existing, 45)).toThrow(
      'The recorded equipment snapshot is unsupported or invalid.',
    );
    expect(preserveSetEquipmentSnapshot(existing, 45, { allowLegacySnapshot: true })).toEqual({
      gymEquipmentId: 'legacy-cable',
      equipmentNameSnapshot: 'Legacy cable',
      selectedLoadKg: 45,
      selectedLoadMultiplierSnapshot: 0.5,
      nominalResistanceKg: 22.5,
      equipmentLoadSnapshot: {
        ...equipmentLoadSnapshot,
        selectedLoadKg: 45,
        nominalResistanceKg: 22.5,
      },
    });

    expect(() =>
      preserveSetEquipmentSnapshot(
        { ...existing, selectedLoadMultiplierSnapshot: 1 },
        45,
        { allowLegacySnapshot: true },
      ),
    ).toThrow('The recorded equipment snapshot fields are inconsistent.');
    expect(() =>
      preserveSetEquipmentSnapshot(
        {
          ...existing,
          nominalResistanceKg: 999,
          equipmentLoadSnapshot: { ...equipmentLoadSnapshot, nominalResistanceKg: 999 },
        },
        45,
        { allowLegacySnapshot: true },
      ),
    ).toThrow('The recorded equipment snapshot fields are inconsistent.');
    expect(() =>
      preserveSetEquipmentSnapshot(
        {
          ...existing,
          nominalResistanceKg: 20,
          equipmentLoadSnapshot: {
            ...equipmentLoadSnapshot,
            loadType: 'FIXED',
          },
        },
        45,
        { allowLegacySnapshot: true },
      ),
    ).toThrow('The recorded equipment snapshot fields are inconsistent.');
  });

  it('does not invent frozen choices for malformed snapshots', () => {
    expect(frozenSetLoadSnapshotVersion({ version: 1 })).toBeNull();
    expect(frozenSetLoadSnapshotVersion({ version: 2 })).toBeNull();
    expect(frozenSetLoadConstraints('Legacy cable', { version: 1 })).toBeNull();
    expect(frozenSetLoadConstraints('Broken cable', { version: 2 })).toBeNull();
  });
});
