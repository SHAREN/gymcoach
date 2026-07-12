import { describe, expect, it } from 'vitest';
import {
  constrainGymWeight,
  constrainGymWeightAtOrBelow,
  constructibleBarbellWeights,
  gymWeightOptions,
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
});
