import { z } from 'zod';
import type { ExerciseCategory } from '@/lib/prisma-client';
import {
  AVG_HR_MAX,
  AVG_HR_MIN,
  MAX_DISTANCE_M,
  MAX_DURATION_SEC,
  MAX_HR_MAX,
  MAX_HR_MIN,
} from '@/lib/cardio';

export const setInputSchema = z.object({
  // Optional client-generated ID makes web/offline POST replay idempotent. The
  // server still generates its normal ID for callers that omit it.
  id: z.string().trim().min(1).max(191).optional(),
  exerciseId: z.string().min(1),
  gymEquipmentId: z.string().min(1).nullable().optional(),
  setNumber: z.coerce.number().int().min(1).max(50),
  weight: z.coerce.number().min(0).max(500),
  reps: z.coerce.number().int().min(0).max(100),
  rir: z.union([z.coerce.number().int().min(0).max(5), z.null()]).optional().nullable(),
  // Cardio fields (issue #133): only valid on CARDIO exercises - the API
  // enforces that with validateSetForCategory below, since the category lives
  // on the exercise row, not in the payload. Bounds: 1 second to 24 hours,
  // 0 to 1000 km.
  durationSec: z
    .union([z.coerce.number().int().min(1).max(MAX_DURATION_SEC), z.null()])
    .optional()
    .nullable(),
  distanceM: z
    .union([z.coerce.number().min(0).max(MAX_DISTANCE_M), z.null()])
    .optional()
    .nullable(),
  // Average heart rate in bpm (issue #152): cardio-only like the fields
  // above, mainly written by the TCX import. 40..250 when present.
  avgHr: z
    .union([z.coerce.number().int().min(AVG_HR_MIN).max(AVG_HR_MAX), z.null()])
    .optional()
    .nullable(),
  // Maximum (peak) heart rate in bpm (issue #203): cardio-only like avgHr,
  // mainly written by the TCX import. 40..250 when present.
  maxHr: z
    .union([z.coerce.number().int().min(MAX_HR_MIN).max(MAX_HR_MAX), z.null()])
    .optional()
    .nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  isWarmup: z.boolean().optional().default(false),
  isDropSet: z.boolean().optional().default(false),
});

export type SetInput = z.infer<typeof setInputSchema>;

// Historical strength corrections intentionally use narrower contracts than
// the active-session writer. They cannot change exercise/order/completion
// metadata on an existing set, and newly appended historical rows let the
// server derive ordering and completedAt from the finished session.
export const setUpdateSchema = z
  .object({
    weight: z.coerce.number().min(0).max(500),
    reps: z.coerce.number().int().min(1).max(100),
    rir: z.union([z.coerce.number().int().min(0).max(5), z.null()]).optional().nullable(),
  })
  .strict();

export type SetUpdateInput = z.infer<typeof setUpdateSchema>;

export const historicalSetInputSchema = z
  .object({
    exerciseId: z.string().min(1),
    gymEquipmentId: z.string().min(1).nullable().optional(),
    weight: z.coerce.number().min(0).max(500),
    reps: z.coerce.number().int().min(1).max(100),
    rir: z.union([z.coerce.number().int().min(0).max(5), z.null()]).optional().nullable(),
  })
  .strict();

export type HistoricalSetInput = z.infer<typeof historicalSetInputSchema>;

// Cross-field rule the schema alone cannot express: duration/distance are
// accepted only on CARDIO exercises (so strength data stays clean), and a
// cardio set requires a duration. Returns an error message or null when valid.
export function validateSetForCategory(
  category: ExerciseCategory,
  data: Pick<SetInput, 'durationSec' | 'distanceM' | 'avgHr' | 'maxHr'>,
): string | null {
  if (category === 'CARDIO') {
    if (data.durationSec == null) {
      return 'A cardio set requires a duration.';
    }
    return null;
  }
  if (
    data.durationSec != null ||
    data.distanceM != null ||
    data.avgHr != null ||
    data.maxHr != null
  ) {
    return 'Duration, distance and heart rate are only valid on cardio exercises.';
  }
  return null;
}
