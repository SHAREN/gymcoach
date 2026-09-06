import { z } from 'zod';
import { BarbellDiameterFamily, EquipmentLoadType, EquipmentType } from '@/lib/prisma-client';
import { GYM_EQUIPMENT_IMAGE_MIME_TYPES } from '@/lib/gym-equipment';
import { gymWeightListSchema } from '@/lib/schemas/gym';

export const databaseIdSchema = z.string().trim().min(1).max(191);

const nullableText = (max: number) => z.string().trim().max(max).nullable().optional();

export const plateCompatibilityKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'Use letters, numbers, underscores, or hyphens.');

export const gymPlateInventoryItemSchema = z
  .object({
    weightKg: z.coerce.number().min(0.1).max(500),
    quantity: z.coerce.number().int().min(0).max(1000).nullable(),
  })
  .strict();

export const gymPlatePoolInputSchema = z
  .object({
    poolId: databaseIdSchema.optional(),
    name: z.string().trim().min(1).max(120),
    compatibilityKey: plateCompatibilityKeySchema,
    plates: z.array(gymPlateInventoryItemSchema).max(200),
  })
  .strict()
  .superRefine((input, ctx) => {
    const weights = input.plates.map((plate) => round(plate.weightKg));
    if (new Set(weights).size !== weights.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['plates'],
        message: 'Duplicate plate denominations are not allowed.',
      });
    }
  })
  .transform((input) => ({
    ...input,
    plates: input.plates
      .map((plate) => ({ ...plate, weightKg: round(plate.weightKg) }))
      .sort((left, right) => left.weightKg - right.weightKg),
  }));

const gymEquipmentShape = {
  equipmentId: databaseIdSchema.optional(),
  name: z.string().trim().min(1).max(120),
  equipmentType: z.nativeEnum(EquipmentType),
  description: nullableText(4000),
  manufacturer: nullableText(120),
  modelName: nullableText(120),
  quantity: z.number().int().min(1).max(100).optional(),
  loadConfigurationKnown: z.boolean().optional(),
  loadType: z.nativeEnum(EquipmentLoadType).optional(),
  weightOptions: gymWeightListSchema.optional(),
  selectedLoadMultiplier: z.coerce.number().positive().max(20).optional(),
  baseLoadKg: z.coerce.number().min(0).max(5000).optional(),
  platePoolId: databaseIdSchema.nullable().optional(),
  loadingSides: z.coerce.number().int().min(1).max(8).optional(),
  exerciseIds: z.array(databaseIdSchema).max(500).optional(),
  markExercisesAvailable: z.boolean().optional(),
};

type EquipmentLoadInput = {
  loadConfigurationKnown?: boolean;
  loadType?: EquipmentLoadType;
  weightOptions?: number[];
  selectedLoadMultiplier?: number;
  baseLoadKg?: number;
  platePoolId?: string | null;
  loadingSides?: number;
};

function validateEquipmentLoad(input: EquipmentLoadInput, ctx: z.RefinementCtx) {
  if (input.loadConfigurationKnown === false) {
    const claimsKnownFacts =
      (input.loadType != null && input.loadType !== 'NONE') ||
      (input.weightOptions?.length ?? 0) > 0 ||
      input.platePoolId != null ||
      (input.baseLoadKg != null && input.baseLoadKg !== 0) ||
      (input.selectedLoadMultiplier != null && input.selectedLoadMultiplier !== 1) ||
      (input.loadingSides != null && input.loadingSides !== 2);
    if (claimsKnownFacts) {
      ctx.addIssue({
        code: 'custom',
        path: ['loadConfigurationKnown'],
        message: 'Unknown load configuration cannot carry confirmed load mechanics.',
      });
    }
  }

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

export const gymEquipmentUpsertObjectSchema = z.object(gymEquipmentShape).strict();

export const gymEquipmentUpsertSchema = gymEquipmentUpsertObjectSchema.superRefine(validateEquipmentLoad);

const strictPositiveWeightListSchema = z
  .array(z.coerce.number().min(0.1).max(5000))
  .max(200)
  .superRefine((values, ctx) => {
    const rounded = values.map(round);
    if (new Set(rounded).size !== rounded.length) {
      ctx.addIssue({ code: 'custom', message: 'Duplicate weights are not allowed.' });
    }
  })
  .transform((values) => values.map(round).sort((a, b) => a - b));

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
      .max(50)
      .superRefine((bars, ctx) => {
        const ids = bars.flatMap((bar) => (bar.equipmentId ? [bar.equipmentId] : []));
        if (new Set(ids).size !== ids.length) {
          ctx.addIssue({ code: 'custom', message: 'A bar may appear only once.' });
        }
        const weights = bars.map((bar) => round(bar.weightKg));
        if (new Set(weights).size !== weights.length) {
          ctx.addIssue({ code: 'custom', message: 'Duplicate bar weights are not allowed.' });
        }
      })
      .transform((bars) =>
        bars
          .map((bar) => ({ ...bar, weightKg: round(bar.weightKg) }))
          .sort((left, right) => left.weightKg - right.weightKg),
      ),
    plates: z.array(gymPlateInventoryItemSchema).max(200),
  })
  .strict()
  .superRefine((input, ctx) => {
    const weights = input.plates.map((plate) => round(plate.weightKg));
    if (new Set(weights).size !== weights.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['plates'],
        message: 'Duplicate plate denominations are not allowed.',
      });
    }
  })
  .transform((input) => ({
    ...input,
    plates: input.plates
      .map((plate) => ({ ...plate, weightKg: round(plate.weightKg) }))
      .sort((left, right) => left.weightKg - right.weightKg),
  }));

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

export type GymEquipmentUpsertInput = z.infer<typeof gymEquipmentUpsertSchema>;
export type GymEquipmentImageInput = z.infer<typeof gymEquipmentImageSchema>;
export type GymPlatePoolInput = z.infer<typeof gymPlatePoolInputSchema>;
export type GymDumbbellsSystemProfileInput = z.infer<typeof gymDumbbellsSystemProfileInputSchema>;
export type GymBarbellSystemProfileInput = z.infer<typeof gymBarbellSystemProfileInputSchema>;

function round(value: number) {
  return Math.round(value * 100) / 100;
}
