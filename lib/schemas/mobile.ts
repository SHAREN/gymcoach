import { z } from 'zod';
import {
  AVG_HR_MAX,
  AVG_HR_MIN,
  MAX_DISTANCE_M,
  MAX_DURATION_SEC,
  MAX_HR_MAX,
  MAX_HR_MIN,
} from '@/lib/cardio';

const opaqueId = z.string().trim().min(8).max(120);
const isoDate = z.string().datetime({ offset: true });

export const mobileLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(500),
  deviceId: opaqueId,
  deviceName: z.string().trim().min(1).max(120),
});

const mobileSessionSchema = z.object({
  id: opaqueId,
  workoutId: opaqueId,
  gymId: z.string().trim().min(1).max(120).nullable().optional(),
  startedAt: isoDate,
});

const mobileSetSchema = z.object({
  id: opaqueId,
  sessionId: opaqueId,
  exerciseId: opaqueId,
  gymEquipmentId: opaqueId.nullable().optional(),
  equipmentSnapshotAction: z.enum(['REPLACE', 'CLEAR']).optional(),
  setNumber: z.number().int().min(1).max(50),
  weight: z.number().min(0).max(500),
  reps: z.number().int().min(0).max(100),
  rir: z.number().int().min(0).max(5).nullable(),
  durationSec: z.number().int().min(1).max(MAX_DURATION_SEC).nullable().optional(),
  distanceM: z.number().min(0).max(MAX_DISTANCE_M).nullable().optional(),
  avgHr: z.number().int().min(AVG_HR_MIN).max(AVG_HR_MAX).nullable().optional(),
  maxHr: z.number().int().min(MAX_HR_MIN).max(MAX_HR_MAX).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  isWarmup: z.boolean().default(false),
  isDropSet: z.boolean().default(false),
  recoverySec: z.number().int().min(0).max(86_400).nullable().optional(),
  completedAt: isoDate,
});

const operationBase = z.object({ operationId: opaqueId });

export const mobileSyncOperationSchema = z.discriminatedUnion('type', [
  operationBase.extend({ type: z.literal('START_SESSION'), session: mobileSessionSchema }),
  operationBase.extend({ type: z.literal('UPSERT_SET'), set: mobileSetSchema }),
  operationBase.extend({ type: z.literal('DELETE_SET'), setId: opaqueId }),
  operationBase.extend({
    type: z.literal('FINISH_SESSION'),
    sessionId: opaqueId,
    finishedAt: isoDate,
    notes: z.string().trim().max(2000).nullable().optional(),
    sessionRpe: z.number().int().min(1).max(10).nullable().optional(),
  }),
]);

export const mobileSyncBatchSchema = z.object({
  operations: z.array(mobileSyncOperationSchema).min(1).max(500),
});

export type MobileSyncOperation = z.infer<typeof mobileSyncOperationSchema>;
