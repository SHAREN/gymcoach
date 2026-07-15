import { z } from 'zod';
import { GymInventoryMode } from '@/lib/prisma-client';

export const gymWeightListSchema = z
  .array(z.coerce.number().min(0.1).max(5000))
  .max(200)
  .transform((values) =>
    [...new Set(values.map((value) => Math.round(value * 100) / 100))].sort((a, b) => a - b),
  );

export const gymExerciseConfigSchema = z.object({
  exerciseId: z.string().min(1),
  isAvailable: z.boolean().default(true),
  weightOptions: gymWeightListSchema.default([]),
  dumbbellWeights: gymWeightListSchema.default([]),
  plateWeights: gymWeightListSchema.default([]),
  barWeights: gymWeightListSchema.default([]),
});

export const gymCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  inventoryMode: z.nativeEnum(GymInventoryMode).default('EQUIPMENT_FIRST'),
  dumbbellWeights: gymWeightListSchema.default([]),
  plateWeights: gymWeightListSchema.default([]),
  barWeights: gymWeightListSchema.default([]),
  exerciseConfigs: z.array(gymExerciseConfigSchema).max(2000).default([]),
  makeActive: z.boolean().default(false),
});

export const gymUpdateSchema = gymCreateSchema
  .omit({ makeActive: true, inventoryMode: true })
  .extend({ inventoryMode: z.nativeEnum(GymInventoryMode).optional() });

export const gymWeightUpdateSchema = z.object({
  exerciseId: z.string().min(1),
  scope: z.enum(['equipment', 'exercise']),
  dumbbellWeights: gymWeightListSchema.default([]),
  plateWeights: gymWeightListSchema.default([]),
  barWeights: gymWeightListSchema.default([]),
  weightOptions: gymWeightListSchema.default([]),
});

export type GymCreateInput = z.infer<typeof gymCreateSchema>;
export type GymUpdateInput = z.infer<typeof gymUpdateSchema>;
export type GymWeightUpdateInput = z.infer<typeof gymWeightUpdateSchema>;
