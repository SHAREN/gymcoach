import { describe, expect, it } from 'vitest';
import {
  constrainGymWeight,
  constrainGymWeightAtOrBelow,
  constructibleBarbellWeights,
  constructiblePlateLoadedWeights,
  resolveEquipmentLoadProfile,
} from '@/lib/gym-loads';

describe('saved gym load constraints', () => {
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
});

describe('structured equipment load profiles', () => {
  it('never infers attainable loads when configuration is explicitly unknown', () => {
    const resolved = resolveEquipmentLoadProfile({
      equipmentId: 'hammer-1',
      equipmentName: 'Hammer upper pulldown',
      equipmentType: 'MACHINE',
      loadConfigurationKnown: false,
      loadType: 'NONE',
      weightOptions: [],
      selectedLoadMultiplier: 1,
      baseLoadKg: 0,
      loadingSides: 2,
      platePoolId: null,
    });

    expect(resolved.attainableLoads).toEqual([]);
    expect(resolved.inventoryPrecision).toBe('UNKNOWN_CONFIG');
  });

  it('honors finite plate counts instead of treating them as unlimited', () => {
    const resolved = constructiblePlateLoadedWeights(
      20,
      2,
      [
        { weightKg: 5, quantity: 2 },
        { weightKg: 10, quantity: 2 },
      ],
      80,
    );

    expect(resolved.inventoryPrecision).toBe('KNOWN');
    expect(resolved.attainableLoads).toContain(20);
    expect(resolved.attainableLoads).toContain(30);
    expect(resolved.attainableLoads).toContain(40);
    expect(resolved.attainableLoads).toContain(50);
    expect(resolved.attainableLoads).not.toContain(60);
  });

  it('preserves unknown plate quantities as uncertainty without inventing a count', () => {
    const resolved = constructiblePlateLoadedWeights(
      20,
      2,
      [{ weightKg: 5, quantity: null }],
      45,
    );

    expect(resolved.inventoryPrecision).toBe('UNKNOWN_QUANTITIES');
    expect(resolved.attainableLoads).toContain(20);
    expect(resolved.attainableLoads).toContain(30);
    expect(resolved.attainableLoads).toContain(40);
  });
});
