import { z } from 'zod';
import { EquipmentLoadType, EquipmentType, GymInventoryMode } from '@/lib/prisma-client';
import { gymWeightListSchema } from '@/lib/schemas/gym';

const nullableText = (max: number) => z.string().trim().max(max).nullable().optional();

export const plateCompatibilityKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'Use letters, numbers, underscores, or hyphens.');

export const gymPlateInventoryItemSchema = z.object({
  weightKg: z.coerce.number().min(0.1).max(500),
  quantity: z.coerce.number().int().min(0).max(1000).nullable(),
});

const opaqueInventoryId = z.string().trim().min(8).max(200);

export const gymPlatePoolInputSchema = z.object({
  poolId: opaqueInventoryId.optional(),
  name: z.string().trim().min(1).max(120),
  compatibilityKey: plateCompatibilityKeySchema,
  plates: z
    .array(gymPlateInventoryItemSchema)
    .max(200)
    .transform((items) =>
      [
        ...new Map(items.map((item) => [Math.round(item.weightKg * 100) / 100, item])).values(),
      ].sort((left, right) => left.weightKg - right.weightKg),
    ),
});

export const gymEquipmentInputSchema = z
  .object({
    equipmentId: z.string().cuid().optional(),
    name: z.string().trim().min(1).max(120),
    equipmentType: z.nativeEnum(EquipmentType),
    description: nullableText(4000),
    manufacturer: nullableText(120),
    modelName: nullableText(120),
    quantity: z.coerce.number().int().min(1).max(100).optional(),
    loadType: z.nativeEnum(EquipmentLoadType).optional(),
    weightOptions: gymWeightListSchema.optional(),
    selectedLoadMultiplier: z.coerce.number().positive().max(20).optional(),
    baseLoadKg: z.coerce.number().min(0).max(5000).optional(),
    platePoolId: opaqueInventoryId.nullable().optional(),
    loadingSides: z.coerce.number().int().min(1).max(8).optional(),
    exerciseIds: z.array(z.string().cuid()).max(500).optional(),
  })
  .superRefine((input, ctx) => {
    if (
      (input.loadType === 'FIXED' || input.loadType === 'SELECTORIZED') &&
      (input.weightOptions?.length ?? 0) === 0
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['weightOptions'],
        message: `${input.loadType} equipment requires at least one displayed load.`,
      });
    }
    if (input.loadType === 'PLATE_LOADED' && !input.platePoolId) {
      ctx.addIssue({
        code: 'custom',
        path: ['platePoolId'],
        message: 'Plate-loaded equipment requires a compatible gym plate pool.',
      });
    }
    if (input.loadType !== 'PLATE_LOADED' && input.platePoolId) {
      ctx.addIssue({
        code: 'custom',
        path: ['platePoolId'],
        message: 'Only plate-loaded equipment may reference a plate pool.',
      });
    }
  });

export const gymInventoryModeUpdateSchema = z.object({
  inventoryMode: z.nativeEnum(GymInventoryMode),
});

export type GymEquipmentInput = z.infer<typeof gymEquipmentInputSchema>;
export type GymPlatePoolInput = z.infer<typeof gymPlatePoolInputSchema>;
