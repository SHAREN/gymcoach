import { describe, expect, it } from 'vitest';
import { gymEquipmentInputSchema, gymPlatePoolInputSchema } from './gym-equipment';

describe('equipment-first gym schemas', () => {
  it('normalizes a compatible universal plate pool while preserving unknown quantities', () => {
    const parsed = gymPlatePoolInputSchema.parse({
      name: ' Olympic plates ',
      compatibilityKey: 'olympic_50mm',
      plates: [
        { weightKg: 20, quantity: null },
        { weightKg: 5, quantity: 4 },
        { weightKg: 20, quantity: null },
      ],
    });
    expect(parsed.name).toBe('Olympic plates');
    expect(parsed.plates).toEqual([
      { weightKg: 5, quantity: 4 },
      { weightKg: 20, quantity: null },
    ]);
  });

  it('requires a plate pool for plate-loaded equipment', () => {
    expect(
      gymEquipmentInputSchema.safeParse({
        name: 'Smith machine',
        equipmentType: 'BARBELL',
        loadType: 'PLATE_LOADED',
        baseLoadKg: 20,
        exerciseIds: [],
      }).success,
    ).toBe(false);
  });

  it('accepts a machine-specific selectorized multiplier', () => {
    const parsed = gymEquipmentInputSchema.parse({
      name: 'Upper pulley',
      equipmentType: 'CABLE',
      loadType: 'SELECTORIZED',
      weightOptions: [50, 40, 45],
      selectedLoadMultiplier: 0.5,
      exerciseIds: [],
    });
    expect(parsed.weightOptions).toEqual([40, 45, 50]);
    expect(parsed.selectedLoadMultiplier).toBe(0.5);
  });
});
