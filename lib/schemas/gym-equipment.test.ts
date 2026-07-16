import { describe, expect, it } from 'vitest';
import {
  gymEquipmentImageSchema,
  gymEquipmentInputSchema,
  gymEquipmentUpsertSchema,
  gymPlatePoolInputSchema,
} from './gym-equipment';

describe('gym equipment schemas', () => {
  it('normalizes the Android-compatible equipment input', () => {
    const parsed = gymEquipmentUpsertSchema.parse({
      name: '  Cable station  ',
      equipmentType: 'CABLE',
      quantity: 2,
      weightOptions: [20, 10, 20],
      exerciseIds: ['exercise-1'],
    });

    expect(parsed).toMatchObject({
      name: 'Cable station',
      quantity: 2,
      weightOptions: [10, 20],
      exerciseIds: ['exercise-1'],
      markExercisesAvailable: true,
    });
    expect(parsed.preferredExerciseIds).toBeUndefined();
  });

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

  it('requires every preferred exercise to remain linked', () => {
    expect(
      gymEquipmentInputSchema.safeParse({
        name: 'EZ bar',
        equipmentType: 'BARBELL',
        exerciseIds: ['exercise-1'],
        preferredExerciseIds: ['exercise-2'],
      }).success,
    ).toBe(false);
  });

  it('requires one safe equipment image source', () => {
    expect(
      gymEquipmentImageSchema.safeParse({ imageUrl: 'http://unsafe.test/image.jpg' }).success,
    ).toBe(false);
    expect(
      gymEquipmentImageSchema.safeParse({ imageBase64: 'abcd', mimeType: 'image/gif' }).success,
    ).toBe(false);
    expect(
      gymEquipmentImageSchema.safeParse({
        imageUrl: 'https://example.test/image.jpg',
        imageBase64: 'abcd',
        mimeType: 'image/jpeg',
      }).success,
    ).toBe(false);
    expect(
      gymEquipmentImageSchema.safeParse({ imageBase64: 'abcd', mimeType: 'image/jpeg' }).success,
    ).toBe(true);
  });
});
