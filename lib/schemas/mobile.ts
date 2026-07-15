import { z } from 'zod';
import { EquipmentLoadType, EquipmentType } from '@/lib/prisma-client';
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
const boundedSnapshotNumber = (minimum: number, maximum: number) =>
  z
    .number()
    .min(minimum)
    .max(maximum)
    .refine(
      (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8,
      'Snapshot numbers must use at most two decimal places.',
    );
const snapshotText = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value === value.trim(), 'Snapshot text must not have outer whitespace.');

const mobileFrozenEquipmentLoadSnapshotSchema = z
  .object({
    version: z.literal(2),
    revisionId: opaqueId,
    gymEquipmentId: opaqueId,
    loadType: z.nativeEnum(EquipmentLoadType),
    equipmentType: z.nativeEnum(EquipmentType),
    selectedLoadKg: z.number().min(0).max(500),
    selectedLoadMultiplier: z.number().positive().max(20),
    nominalResistanceKg: boundedSnapshotNumber(0, 10_000).nullable(),
    baseLoadKg: z.number().min(0).max(5_000),
    loadingSides: z.number().int().min(1).max(8),
    weightOptions: z.array(boundedSnapshotNumber(0.1, 5_000)).max(200),
    platePool: z
      .object({
        id: opaqueId,
        name: snapshotText(120),
        compatibilityKey: snapshotText(80).refine(
          (value) => /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value),
          'Invalid plate compatibility key.',
        ),
        plates: z
          .array(
            z
              .object({
                weightKg: boundedSnapshotNumber(0.1, 500),
                quantity: z.number().int().min(0).max(1_000).nullable(),
              })
              .strict(),
          )
          .max(200),
      })
      .strict()
      .nullable(),
  })
  .strict();

export const mobileFrozenEquipmentSnapshotSchema = z
  .object({
    equipmentNameSnapshot: snapshotText(120),
    selectedLoadKg: z.number().min(0).max(500),
    selectedLoadMultiplierSnapshot: z.number().positive().max(20),
    nominalResistanceKg: boundedSnapshotNumber(0, 10_000).nullable(),
    equipmentLoadSnapshot: mobileFrozenEquipmentLoadSnapshotSchema,
  })
  .strict()
  .superRefine((snapshot, ctx) => {
    const loadSnapshot = snapshot.equipmentLoadSnapshot;
    const mismatches = [
      snapshot.selectedLoadKg !== loadSnapshot.selectedLoadKg
        ? ['selectedLoadKg', 'Selected load does not match the versioned load snapshot.']
        : null,
      snapshot.selectedLoadMultiplierSnapshot !== loadSnapshot.selectedLoadMultiplier
        ? [
            'selectedLoadMultiplierSnapshot',
            'Selected-load multiplier does not match the versioned load snapshot.',
          ]
        : null,
      snapshot.nominalResistanceKg !== loadSnapshot.nominalResistanceKg
        ? ['nominalResistanceKg', 'Nominal resistance does not match the versioned load snapshot.']
        : null,
    ].filter((item): item is [string, string] => item != null);
    for (const [field, message] of mismatches) {
      ctx.addIssue({ code: 'custom', path: [field], message });
    }

    const expectedNominal =
      loadSnapshot.loadType === EquipmentLoadType.SELECTORIZED
        ? Math.round(loadSnapshot.selectedLoadKg * loadSnapshot.selectedLoadMultiplier * 100) / 100
        : null;
    if (snapshot.nominalResistanceKg !== expectedNominal) {
      ctx.addIssue({
        code: 'custom',
        path: ['nominalResistanceKg'],
        message: 'Nominal resistance is inconsistent with the frozen equipment load type.',
      });
    }
  });

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

const mobileSetSchema = z
  .object({
    id: opaqueId,
    sessionId: opaqueId,
    exerciseId: opaqueId,
    gymEquipmentId: opaqueId.nullable().optional(),
    equipmentSnapshotAction: z.enum(['REPLACE', 'CLEAR']).optional(),
    frozenEquipmentSnapshot: mobileFrozenEquipmentSnapshotSchema.optional(),
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
  })
  .superRefine((set, ctx) => {
    const snapshot = set.frozenEquipmentSnapshot;
    if (!snapshot) return;
    if (!set.gymEquipmentId) {
      ctx.addIssue({
        code: 'custom',
        path: ['gymEquipmentId'],
        message: 'A frozen equipment snapshot requires equipment identity.',
      });
    } else if (snapshot.equipmentLoadSnapshot.gymEquipmentId !== set.gymEquipmentId) {
      ctx.addIssue({
        code: 'custom',
        path: ['frozenEquipmentSnapshot', 'equipmentLoadSnapshot', 'gymEquipmentId'],
        message: 'Frozen equipment identity does not match the set equipment.',
      });
    }
    if (snapshot.selectedLoadKg !== set.weight) {
      ctx.addIssue({
        code: 'custom',
        path: ['frozenEquipmentSnapshot', 'selectedLoadKg'],
        message: 'Frozen selected load must match the logged set weight.',
      });
    }
    if (set.equipmentSnapshotAction) {
      ctx.addIssue({
        code: 'custom',
        path: ['equipmentSnapshotAction'],
        message: 'Frozen snapshots cannot be combined with equipment replacement actions.',
      });
    }
  });

const operationBase = z.object({ operationId: opaqueId });

export const mobileSyncOperationSchema = z.discriminatedUnion('type', [
  operationBase.extend({ type: z.literal('START_SESSION'), session: mobileSessionSchema }),
  operationBase.extend({ type: z.literal('UPSERT_SET'), set: mobileSetSchema }),
  operationBase.extend({ type: z.literal('DELETE_SET'), setId: opaqueId }),
  operationBase.extend({ type: z.literal('DELETE_SESSION'), sessionId: opaqueId }),
  operationBase.extend({
    type: z.literal('UPDATE_TARGET_SETS'),
    programExerciseId: opaqueId,
    targetSets: z.number().int().min(1).max(20),
    previousTargetSets: z.number().int().min(1).max(20),
  }),
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
export type MobileFrozenEquipmentSnapshot = z.infer<typeof mobileFrozenEquipmentSnapshotSchema>;
