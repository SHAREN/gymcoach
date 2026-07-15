import { describe, expect, it } from 'vitest';
import { frozenSetLoadConstraints } from '@/lib/set-equipment';

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

  it('does not invent frozen choices for legacy or malformed snapshots', () => {
    expect(frozenSetLoadConstraints('Legacy cable', { version: 1 })).toBeNull();
    expect(frozenSetLoadConstraints('Broken cable', { version: 2 })).toBeNull();
  });
});
