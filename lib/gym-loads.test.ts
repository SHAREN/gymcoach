import { describe, expect, it } from 'vitest';
import {
  constrainGymWeight,
  constrainGymWeightAtOrBelow,
  constructibleBarbellWeights,
  constructiblePlateLoadedWeights,
  gymWeightOptions,
  resolveEquipmentLoadProfile,
  resolveExerciseInventory,
  resolveEquipmentType,
} from '@/lib/gym-loads';

describe('saved gym load constraints', () => {
  it('recovers equipment types for legacy exercises saved as OTHER', () => {
    expect(resolveEquipmentType('OTHER', 'Bent-over barbell row')).toBe('BARBELL');
    expect(resolveEquipmentType('OTHER', 'Тяга штанги в наклоне')).toBe('BARBELL');
    expect(resolveEquipmentType('OTHER', 'Incline dumbbell press')).toBe('DUMBBELL');
    expect(resolveEquipmentType('MACHINE', 'Barbell-looking machine')).toBe('MACHINE');
  });

  it('steps down to an actually available dumbbell across inventory gaps', () => {
    const weight = constrainGymWeight(17.1, 19, {
      equipmentType: 'DUMBBELL',
      dumbbellWeights: [10, 12, 14, 15, 16, 19],
    });
    expect(weight).toBe(16);
  });

  it('steps up to the next available dumbbell instead of inventing a load', () => {
    const weight = constrainGymWeight(17, 16, {
      equipmentType: 'DUMBBELL',
      dumbbellWeights: [10, 12, 14, 15, 16, 19],
    });
    expect(weight).toBe(19);
  });

  it('builds barbell options only from a saved bar and symmetric plate pairs', () => {
    const options = constructibleBarbellWeights([20], [1.25, 2.5], 30);
    expect(options).toContain(20);
    expect(options).toContain(22.5);
    expect(options).toContain(25);
    expect(options).not.toContain(21.25);
    expect(
      constrainGymWeight(23.75, 25, {
        equipmentType: 'BARBELL',
        barWeights: [20],
        plateWeights: [1.25, 2.5],
      }),
    ).toBe(22.5);
  });

  it('uses exercise-specific added loads for weighted bodyweight exercises', () => {
    expect(
      gymWeightOptions({ equipmentType: 'BODYWEIGHT', weightOptions: [5, 10, 15.5, 20] }, 12),
    ).toEqual([5, 10, 15.5, 20]);
    expect(
      constrainGymWeight(14, 10, {
        equipmentType: 'BODYWEIGHT',
        weightOptions: [5, 10, 15.5, 20],
      }),
    ).toBe(15.5);
  });

  it('uses explicit machine stack values when configured', () => {
    expect(
      constrainGymWeight(47, 50, {
        equipmentType: 'MACHINE',
        weightOptions: [10, 20, 30, 40, 50, 60],
      }),
    ).toBe(40);
  });

  it('caps a recommendation without jumping over the ceiling across an inventory gap', () => {
    expect(
      constrainGymWeightAtOrBelow(17, {
        equipmentType: 'DUMBBELL',
        dumbbellWeights: [10, 12, 14, 16, 19],
      }),
    ).toBe(16);
  });

  it('falls back to the calculated load when no inventory is configured', () => {
    expect(constrainGymWeight(17.5, 20, { equipmentType: 'DUMBBELL' })).toBe(17.5);
  });

  it('keeps selectorized displayed loads primary while preserving the machine multiplier', () => {
    const profile = resolveEquipmentLoadProfile({
      equipmentId: 'cable-a',
      equipmentName: 'Upper pulley',
      equipmentType: 'CABLE',
      loadType: 'SELECTORIZED',
      weightOptions: [40, 45, 50],
      selectedLoadMultiplier: 0.5,
      baseLoadKg: 0,
      loadingSides: 1,
      platePoolId: null,
    });
    expect(profile.attainableLoads).toEqual([40, 45, 50]);
    expect(profile.selectedLoadMultiplier).toBe(0.5);
  });

  it('respects known universal plate quantities and symmetric loading', () => {
    const result = constructiblePlateLoadedWeights(
      20,
      2,
      [
        { weightKg: 20, quantity: 2 },
        { weightKg: 5, quantity: 4 },
      ],
      100,
    );
    expect(result.inventoryPrecision).toBe('KNOWN');
    expect(result.attainableLoads).toContain(20);
    expect(result.attainableLoads).toContain(30);
    expect(result.attainableLoads).toContain(70);
    expect(result.attainableLoads).not.toContain(110);
  });

  it('preserves unknown legacy plate quantities instead of inventing a count', () => {
    const result = constructiblePlateLoadedWeights(20, 2, [{ weightKg: 20, quantity: null }], 100);
    expect(result.inventoryPrecision).toBe('UNKNOWN_QUANTITIES');
    expect(result.attainableLoads.slice(0, 3)).toEqual([20, 60, 100]);
  });

  it('uses linked equipment before a conflicting legacy exercise configuration', () => {
    const resolved = resolveExerciseInventory({
      inventoryMode: 'EQUIPMENT_FIRST',
      exercise: { id: 'triceps', name: 'Cable pushdown', equipmentType: 'CABLE' },
      linkedEquipment: [
        {
          equipmentId: 'cable-a',
          equipmentName: 'Cable A',
          equipmentType: 'CABLE',
          loadType: 'SELECTORIZED',
          weightOptions: [5, 10, 15],
          selectedLoadMultiplier: 0.5,
          baseLoadKg: 0,
          loadingSides: 1,
          platePoolId: null,
        },
      ],
      legacyConfig: {
        isAvailable: false,
        weightOptions: [40, 45, 50],
        dumbbellWeights: [],
        plateWeights: [],
        barWeights: [],
      },
    });
    expect(resolved.source).toBe('equipment');
    expect(resolved.isAvailable).toBe(true);
    expect(resolved.weightOptions).toEqual([5, 10, 15]);
  });

  it('requires a concrete choice instead of merging two machine load scales', () => {
    const base = {
      equipmentType: 'MACHINE' as const,
      loadType: 'SELECTORIZED' as const,
      selectedLoadMultiplier: 1,
      baseLoadKg: 0,
      loadingSides: 1,
      platePoolId: null,
    };
    const resolved = resolveExerciseInventory({
      inventoryMode: 'EQUIPMENT_FIRST',
      exercise: { id: 'row', name: 'Machine row', equipmentType: 'MACHINE' },
      linkedEquipment: [
        { ...base, equipmentId: 'row-a', equipmentName: 'Row A', weightOptions: [10, 20] },
        { ...base, equipmentId: 'row-b', equipmentName: 'Row B', weightOptions: [15, 25] },
      ],
    });
    expect(resolved.requiresEquipmentSelection).toBe(true);
    expect(resolved.weightOptions).toEqual([]);
    expect(gymWeightOptions(resolved.constraints, 20)).toEqual([]);
    expect(gymWeightOptions({ ...resolved.constraints, equipmentId: 'row-b' }, 20)).toEqual([
      15, 25,
    ]);
  });

  it('initializes multiple equipment options from the validated preferred item', () => {
    const base = {
      equipmentType: 'BARBELL' as const,
      loadType: 'PLATE_LOADED' as const,
      weightOptions: [],
      selectedLoadMultiplier: 1,
      loadingSides: 2,
      platePoolId: 'plates',
      plates: [{ weightKg: 5, quantity: 4 }],
    };
    const resolved = resolveExerciseInventory({
      inventoryMode: 'EQUIPMENT_FIRST',
      exercise: { id: 'curl', name: 'EZ curl', equipmentType: 'BARBELL' },
      preferredEquipmentId: 'ez-bar',
      linkedEquipment: [
        { ...base, equipmentId: 'standard-bar', equipmentName: 'Standard bar', baseLoadKg: 20 },
        { ...base, equipmentId: 'ez-bar', equipmentName: 'EZ bar', baseLoadKg: 10 },
      ],
    });

    expect(resolved.preferredEquipmentId).toBe('ez-bar');
    expect(resolved.constraints.equipmentId).toBe('ez-bar');
    expect(resolved.weightOptions).toEqual([10, 20, 30]);
    expect(resolved.requiresEquipmentSelection).toBe(true);
  });

  it('marks equipment-first exercises unavailable after links and legacy config are removed', () => {
    const resolved = resolveExerciseInventory({
      inventoryMode: 'EQUIPMENT_FIRST',
      exercise: { id: 'triceps', name: 'Cable pushdown', equipmentType: 'CABLE' },
      linkedEquipment: [],
      legacyConfig: null,
    });

    expect(resolved.source).toBe('none');
    expect(resolved.isAvailable).toBe(false);
    expect(resolved.weightOptions).toEqual([]);
  });
});
