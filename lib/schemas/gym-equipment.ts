import { z } from 'zod';
import { BarbellDiameterFamily, EquipmentType } from '@/lib/prisma-client';
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

const strictPositiveWeightListSchema = z
  .array(z.coerce.number().min(0.1).max(5000))
  .max(200)
  .superRefine((values, ctx) => {
    const rounded = values.map((value) => Math.round(value * 100) / 100);
    if (new Set(rounded).size !== rounded.length) {
      ctx.addIssue({ code: 'custom', message: 'Duplicate weights are not allowed.' });
    }
  })
  .transform((values) =>
    values.map((value) => Math.round(value * 100) / 100).sort((a, b) => a - b),
  );

const strictPlateListSchema = z
  .array(gymPlateInventoryItemSchema.strict())
  .max(200)
  .superRefine((plates, ctx) => {
    const weights = plates.map((plate) => Math.round(plate.weightKg * 100) / 100);
    if (new Set(weights).size !== weights.length) {
      ctx.addIssue({ code: 'custom', message: 'Duplicate plate denominations are not allowed.' });
    }
  })
  .transform((plates) =>
    plates
      .map((plate) => ({ ...plate, weightKg: Math.round(plate.weightKg * 100) / 100 }))
      .sort((left, right) => left.weightKg - right.weightKg),
  );

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
  preferredExerciseIds: z.array(databaseIdSchema).max(500).optional(),
  // Accepted for the current Android settings client and older MCP clients.
  // Equipment-first availability is derived directly from the links.
  markExercisesAvailable: z.boolean().optional(),
};

function validateEquipmentLoad(
  input: {
    loadType?: EquipmentLoadTypeValue;
    weightOptions?: number[];
    platePoolId?: string | null;
    exerciseIds?: string[];
    preferredExerciseIds?: string[];
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
  if (
    input.exerciseIds !== undefined &&
    input.preferredExerciseIds?.some((exerciseId) => !input.exerciseIds!.includes(exerciseId))
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['preferredExerciseIds'],
      message: 'Preferred exercises must also remain linked to the equipment.',
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

export const gymDumbbellsSystemProfileInputSchema = z
  .object({
    weightsKg: strictPositiveWeightListSchema,
    exerciseIds: z.array(databaseIdSchema).max(500),
  })
  .strict();

const gymBarbellFamilyInputSchema = z
  .object({
    family: z.nativeEnum(BarbellDiameterFamily),
    loadingSides: z.coerce.number().int().min(1).max(8),
    bars: z
      .array(
        z
          .object({
            equipmentId: databaseIdSchema.optional(),
            weightKg: z.coerce.number().min(0.1).max(5000),
          })
          .strict(),
      )
      .min(1)
      .max(50)
      .superRefine((bars, ctx) => {
        const ids = bars.flatMap((bar) => (bar.equipmentId ? [bar.equipmentId] : []));
        if (new Set(ids).size !== ids.length) {
          ctx.addIssue({ code: 'custom', message: 'A bar may appear only once.' });
        }
        const weights = bars.map((bar) => Math.round(bar.weightKg * 100) / 100);
        if (new Set(weights).size !== weights.length) {
          ctx.addIssue({ code: 'custom', message: 'Duplicate bar weights are not allowed.' });
        }
      })
      .transform((bars) =>
        bars
          .map((bar) => ({ ...bar, weightKg: Math.round(bar.weightKg * 100) / 100 }))
          .sort((left, right) => left.weightKg - right.weightKg),
      ),
    plates: strictPlateListSchema,
  })
  .strict();

export const gymBarbellSystemProfileInputSchema = z
  .object({
    exerciseIds: z.array(databaseIdSchema).max(500),
    families: z.array(gymBarbellFamilyInputSchema).length(2),
  })
  .strict()
  .superRefine((input, ctx) => {
    const families = input.families.map((family) => family.family);
    if (
      new Set(families).size !== 2 ||
      !families.includes('LARGE') ||
      !families.includes('SMALL')
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['families'],
        message: 'Provide exactly one large and one small barbell family.',
      });
    }
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
export type GymDumbbellsSystemProfileInput = z.infer<typeof gymDumbbellsSystemProfileInputSchema>;
export type GymBarbellSystemProfileInput = z.infer<typeof gymBarbellSystemProfileInputSchema>;
