import { z } from 'zod';

export const sessionStartSchema = z.object({
  workoutId: z.string().min(1),
  gymId: z.string().min(1).optional().nullable(),
});

export const sessionUpdateSchema = z.object({
  notes: z.string().trim().max(2000).optional().nullable(),
  // If true, sets finishedAt to now.
  finish: z.boolean().optional(),
  sessionRpe: z.coerce.number().int().min(1).max(10).optional().nullable(),
});

export type SessionStart = z.infer<typeof sessionStartSchema>;
export type SessionUpdate = z.infer<typeof sessionUpdateSchema>;
