import { z } from 'zod';
import { EquipmentType } from '@/lib/prisma-client';
import { GYM_EQUIPMENT_IMAGE_MIME_TYPES } from '@/lib/gym-equipment';
import { databaseIdSchema } from '@/lib/schemas/database-id';
import { gymWeightListSchema } from '@/lib/schemas/gym';

const nullableText = (max: number) => z.string().trim().max(max).nullable().optional();
const equipmentLoadTypeSchema = z.enum(['NONE', 'FIXED', 'SELECTORIZED', 'PLATE_LOADED']);
const gymInventoryModeSchema = z.enum(['LEGACY', 'EQUIPMENT_FIRST']);
type EquipmentLoadTypeValue = z.infer<typeof equipmentLoadTypeSchema>;

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

export const gymPlatePoolInputSchema = z.object({
  poolId: databaseIdSchema.optional(),
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

const gymEquipmentShape = {
  equipmentId: databaseIdSchema.optional(),
  name: z.string().trim().min(1).max(120),
  equipmentType: z.nativeEnum(EquipmentType),
  description: nullableText(4000),
  manufacturer: nullableText(120),
  modelName: nullableText(120),
  quantity: z.coerce.number().int().min(1).max(100).optional(),
  loadType: equipmentLoadTypeSchema.optional(),
  weightOptions: gymWeightListSchema.optional(),
  selectedLoadMultiplier: z.coerce.number().positive().max(20).optional(),
  baseLoadKg: z.coerce.number().min(0).max(5000).optional(),
  platePoolId: databaseIdSchema.nullable().optional(),
  loadingSides: z.coerce.number().int().min(1).max(8).optional(),
  exerciseIds: z.array(databaseIdSchema).max(500).optional(),
  // Accepted for the current Android settings client and older MCP clients.
  // Equipment-first availability is derived directly from the links.
  markExercisesAvailable: z.boolean().optional(),
};

function validateEquipmentLoad(
  input: {
    loadType?: EquipmentLoadTypeValue;
    weightOptions?: number[];
    platePoolId?: string | null;
  },
  ctx: z.RefinementCtx,
) {
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
  if (input.loadType !== undefined && input.loadType !== 'PLATE_LOADED' && input.platePoolId) {
    ctx.addIssue({
      code: 'custom',
      path: ['platePoolId'],
      message: 'Only plate-loaded equipment may reference a plate pool.',
    });
  }
}

export const gymEquipmentInputSchema = z
  .object(gymEquipmentShape)
  .superRefine(validateEquipmentLoad);

// Compatibility contract used by the existing Android settings flow. New
// equipment-first routes use gymEquipmentInputSchema so omitted update fields
// remain omitted instead of being reset to legacy defaults.
export const gymEquipmentUpsertSchema = z
  .object({
    ...gymEquipmentShape,
    quantity: gymEquipmentShape.quantity.default(1),
    weightOptions: gymEquipmentShape.weightOptions.default([]),
    exerciseIds: gymEquipmentShape.exerciseIds.default([]),
    markExercisesAvailable: gymEquipmentShape.markExercisesAvailable.default(true),
  })
  .superRefine(validateEquipmentLoad);

export const gymInventoryModeUpdateSchema = z.object({
  inventoryMode: gymInventoryModeSchema,
});

const maximumBase64Length = 7_100_000;

export const gymEquipmentImageSchema = z
  .object({
    imageUrl: z.string().trim().url().max(2048).startsWith('https://').optional(),
    imageBase64: z.string().max(maximumBase64Length).optional(),
    mimeType: z.enum(GYM_EQUIPMENT_IMAGE_MIME_TYPES).optional(),
  })
  .refine((value) => Number(value.imageUrl != null) + Number(value.imageBase64 != null) === 1, {
    message: 'Choose exactly one image source.',
  })
  .refine((value) => value.imageBase64 == null || value.mimeType != null, {
    message: 'Uploaded images require a MIME type.',
  });

export type GymEquipmentInput = z.infer<typeof gymEquipmentInputSchema>;
export type GymEquipmentUpsertInput = z.infer<typeof gymEquipmentUpsertSchema>;
export type GymPlatePoolInput = z.infer<typeof gymPlatePoolInputSchema>;
export type GymEquipmentImageInput = z.infer<typeof gymEquipmentImageSchema>;
