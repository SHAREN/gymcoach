import { z } from 'zod';

export const MAX_FREEFORM_EXERCISES = 200;

const gymIdSchema = z.string().min(1).optional().nullable();

export const sessionStartSchema = z.union([
  z.object({
    workoutId: z.string().min(1),
    gymId: gymIdSchema,
  }),
  z.object({
    freeform: z.literal(true),
    gymId: gymIdSchema,
  }),
]);

export const freeSessionExerciseSchema = z.object({
  exerciseId: z.string().min(1),
});

export const sessionUpdateSchema = z.object({
  notes: z.string().trim().max(2000).optional().nullable(),
  // If true, sets finishedAt to now.
  finish: z.boolean().optional(),
});

export type SessionStart = z.infer<typeof sessionStartSchema>;
export type SessionUpdate = z.infer<typeof sessionUpdateSchema>;
