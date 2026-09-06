import { describe, expect, it } from 'vitest';
import {
  gymBarbellSystemProfileInputSchema,
  gymEquipmentImageSchema,
  gymEquipmentUpsertSchema,
} from './gym-equipment';

describe('gym equipment schemas', () => {
  it('normalizes a complete equipment input without inventing omitted update fields', () => {
    const parsed = gymEquipmentUpsertSchema.parse({
      equipmentId: ' equipment-1 ',
      name: '  Cable station  ',
      equipmentType: 'CABLE',
      quantity: 2,
      weightOptions: [20, 10, 20],
      exerciseIds: ['exercise-1'],
    });

    expect(parsed).toMatchObject({
      equipmentId: 'equipment-1',
      name: 'Cable station',
      quantity: 2,
      weightOptions: [10, 20],
      exerciseIds: ['exercise-1'],
    });
    expect(parsed.markExercisesAvailable).toBeUndefined();

    const minimal = gymEquipmentUpsertSchema.parse({
      name: 'Cable station',
      equipmentType: 'CABLE',
    });
    expect(minimal.quantity).toBeUndefined();
    expect(minimal.weightOptions).toBeUndefined();
    expect(minimal.exerciseIds).toBeUndefined();
    expect(minimal.markExercisesAvailable).toBeUndefined();
  });

  it('keeps an unknown load configuration free of invented mechanics', () => {
    expect(
      gymEquipmentUpsertSchema.safeParse({
        name: 'Hammer upper pulldown',
        equipmentType: 'MACHINE',
        loadConfigurationKnown: false,
      }).success,
    ).toBe(true);

    expect(
      gymEquipmentUpsertSchema.safeParse({
        name: 'Hammer upper pulldown',
        equipmentType: 'MACHINE',
        loadConfigurationKnown: false,
        loadType: 'PLATE_LOADED',
        platePoolId: 'pool-1',
        baseLoadKg: 25,
      }).success,
    ).toBe(false);
  });

  it('requires a plate pool only for confirmed plate-loaded equipment', () => {
    expect(
      gymEquipmentUpsertSchema.safeParse({
        name: 'Leg press',
        equipmentType: 'MACHINE',
        loadConfigurationKnown: true,
        loadType: 'PLATE_LOADED',
      }).success,
    ).toBe(false);

    expect(
      gymEquipmentUpsertSchema.safeParse({
        name: 'Leg press',
        equipmentType: 'MACHINE',
        loadConfigurationKnown: true,
        loadType: 'PLATE_LOADED',
        platePoolId: 'pool-1',
        baseLoadKg: 35,
        loadingSides: 2,
      }).success,
    ).toBe(true);
  });

  it('requires exactly one large and one small Barbell family', () => {
    const large = {
      family: 'LARGE' as const,
      loadingSides: 2,
      bars: [{ weightKg: 20 }],
      plates: [{ weightKg: 5, quantity: 4 }],
    };
    const small = {
      family: 'SMALL' as const,
      loadingSides: 2,
      bars: [],
      plates: [],
    };

    expect(
      gymBarbellSystemProfileInputSchema.safeParse({
        exerciseIds: ['exercise-1'],
        families: [large, small],
      }).success,
    ).toBe(true);
    expect(
      gymBarbellSystemProfileInputSchema.safeParse({
        exerciseIds: ['exercise-1'],
        families: [large, large],
      }).success,
    ).toBe(false);
  });

  it('rejects duplicate bar and plate facts inside a Barbell family', () => {
    expect(
      gymBarbellSystemProfileInputSchema.safeParse({
        exerciseIds: [],
        families: [
          {
            family: 'LARGE',
            loadingSides: 2,
            bars: [{ weightKg: 20 }, { weightKg: 20 }],
            plates: [{ weightKg: 5, quantity: 2 }],
          },
          {
            family: 'SMALL',
            loadingSides: 2,
            bars: [],
            plates: [{ weightKg: 2.5, quantity: 2 }, { weightKg: 2.5, quantity: null }],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('requires exactly one safe equipment image source', () => {
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
