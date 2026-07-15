import { Buffer } from 'node:buffer';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  ExerciseCategory,
  EquipmentLoadType,
  EquipmentType,
  GymInventoryMode,
  MessageRole,
  MuscleGroup,
  Sex,
  TrainingGoal,
  WeightUnit,
  Prisma,
} from '@/lib/prisma-client';
import { db } from '@/lib/db';
import { ApiError, handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';
import { GYM_EQUIPMENT_IMAGE_MIME_TYPES, decodeGymEquipmentImage } from '@/lib/gym-equipment';
import {
  AVG_HR_MAX,
  AVG_HR_MIN,
  MAX_DISTANCE_M,
  MAX_DURATION_SEC,
  MAX_HR_MAX,
  MAX_HR_MIN,
} from '@/lib/cardio';
import { MAX_SUPERSET_GROUP, MIN_SUPERSET_GROUP } from '@/lib/supersets';
import { sorenessSchema } from '@/lib/schemas/readiness';
import { assertLegacySetEquipmentSnapshotConsistency } from '@/lib/set-equipment';

// ============================================================
// Backup / Import JSON (LOT 11, completed by issue #168)
// ============================================================
// The export covers every entity tied to the user; the import recreates the
// content for the current user with fresh cuid ids (relations are re-linked
// by name), so it does not break uniqueness constraints or pollute another
// user.
//
// Export inventory - systematic check against prisma/schema.prisma. When a
// model or column is added to the schema, extend BOTH the export and the
// import below, bump VERSION, and keep older versions importable.
//
// Exported models and fields:
// - User: profile fields (displayName, bodyweight, sex, heightCm, goal,
//   weeklyFrequency, unit, deloadUntil). email/createdAt ride along for
//   reference but are NEVER imported (they identify the importing account).
// - Exercise: name, muscleGroup, category, defaultRestSec, notes,
//   usesBodyweight.
// - Program / Workout / ProgramExercise: all user content incl drop sets and supersets.
// - Session / SessionExercise / Set: all user content incl durable exercise
//   membership, durationSec, distanceM, avgHr.
// - CoachSession, ExerciseGoal, BodyweightEntry, ReadinessCheckin,
//   Conversation / Message: all user content.
//
// Intentionally excluded:
// - User.id / email / passwordHash / createdAt (identity + credentials of the
//   importing account; restoring them would hijack or corrupt the account).
// - Every row id (regenerated on import; relations re-linked by name).
// - Program.createdAt / Program.updatedAt and Exercise.createdAt (server-side
//   bookkeeping with no user-facing meaning; reset to the import time).

const VERSION = 10;

// Hard cap on the import body size, enforced while reading the stream (the
// Content-Length header is attacker-controlled). Generous: a decade of daily
// training exports to a few MB.
const MAX_BACKUP_BYTES = 50 * 1024 * 1024;

// GET /api/backup: returns an exportable JSON.
export async function GET(req: Request) {
  try {
    const userId = await requireApiUserId(req);

    const [
      user,
      programs,
      exercises,
      sessions,
      coachSessions,
      exerciseGoals,
      bodyweightEntries,
      readinessCheckins,
      conversations,
      gyms,
    ] = await Promise.all([
      db.user.findUnique({
        where: { id: userId },
        select: {
          email: true,
          createdAt: true,
          displayName: true,
          bodyweight: true,
          sex: true,
          heightCm: true,
          goal: true,
          weeklyFrequency: true,
          unit: true,
          deloadUntil: true,
          activeGymId: true,
        },
      }),
      db.program.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' },
        include: {
          workouts: {
            orderBy: { order: 'asc' },
            include: {
              exercises: {
                orderBy: { order: 'asc' },
                include: { exercise: { select: { name: true } } },
              },
            },
          },
        },
      }),
      db.exercise.findMany({ where: { userId }, orderBy: { name: 'asc' } }),
      db.session.findMany({
        where: { userId },
        orderBy: { startedAt: 'asc' },
        include: {
          sets: { orderBy: [{ exerciseId: 'asc' }, { setNumber: 'asc' }] },
          exerciseMemberships: {
            orderBy: [{ addedAt: 'asc' }, { ordinal: 'asc' }],
            include: { exercise: { select: { name: true } } },
          },
        },
      }),
      db.coachSession.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
      db.exerciseGoal.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' },
        include: { exercise: { select: { name: true } } },
      }),
      db.bodyweightEntry.findMany({
        where: { userId },
        orderBy: { measuredAt: 'asc' },
      }),
      db.readinessCheckin.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' },
      }),
      db.conversation.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' },
        include: { messages: { orderBy: { createdAt: 'asc' } } },
      }),
      db.gym.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' },
        include: {
          equipment: {
            orderBy: { name: 'asc' },
            include: {
              platePool: true,
              exerciseLinks: { include: { exercise: { select: { name: true } } } },
            },
          },
          platePools: {
            orderBy: { name: 'asc' },
            include: { plates: { orderBy: { weightKg: 'asc' } } },
          },
          exerciseConfigs: { include: { exercise: { select: { name: true } } } },
        },
      }),
    ]);

    if (!user) throw new ApiError(404, 'User not found.');

    const dump = {
      version: VERSION,
      exportedAt: new Date().toISOString(),
      user: { email: user.email, createdAt: user.createdAt },
      // Profile fields restored onto the importing account (new in v2).
      profile: {
        displayName: user.displayName,
        bodyweight: user.bodyweight,
        sex: user.sex,
        heightCm: user.heightCm,
        goal: user.goal,
        weeklyFrequency: user.weeklyFrequency,
        unit: user.unit,
        deloadUntil: user.deloadUntil?.toISOString() ?? null,
        activeGymName: gyms.find((gym) => gym.id === user.activeGymId)?.name ?? null,
      },
      exercises: exercises.map((e) => ({
        name: e.name,
        muscleGroup: e.muscleGroup,
        category: e.category,
        defaultRestSec: e.defaultRestSec,
        notes: e.notes,
        usesBodyweight: e.usesBodyweight,
        equipmentType: e.equipmentType,
      })),
      gyms: gyms.map((gym) => ({
        name: gym.name,
        inventoryMode: gym.inventoryMode,
        dumbbellWeights: gym.dumbbellWeights,
        plateWeights: gym.plateWeights,
        barWeights: gym.barWeights,
        platePools: gym.platePools.map((pool) => ({
          name: pool.name,
          compatibilityKey: pool.compatibilityKey,
          plates: pool.plates.map((plate) => ({
            weightKg: plate.weightKg,
            quantity: plate.quantity,
          })),
        })),
        equipment: gym.equipment.map((item) => ({
          name: item.name,
          equipmentType: item.equipmentType,
          description: item.description,
          manufacturer: item.manufacturer,
          modelName: item.modelName,
          quantity: item.quantity,
          loadType: item.loadType,
          weightOptions: item.weightOptions,
          selectedLoadMultiplier: item.selectedLoadMultiplier,
          baseLoadKg: item.baseLoadKg,
          platePoolCompatibilityKey: item.platePool?.compatibilityKey ?? null,
          loadingSides: item.loadingSides,
          imageUrl: item.imageUrl,
          imageMimeType: item.imageMimeType,
          imageBase64: item.imageData ? Buffer.from(item.imageData).toString('base64') : null,
          exerciseNames: item.exerciseLinks.map((link) => link.exercise.name),
          legacyMirrorExerciseNames: item.exerciseLinks
            .filter((link) => link.mirrorsLegacyConfig)
            .map((link) => link.exercise.name),
        })),
        exerciseConfigs: gym.exerciseConfigs.map((config) => ({
          exerciseName: config.exercise.name,
          isAvailable: config.isAvailable,
          weightOptions: config.weightOptions,
          dumbbellWeights: config.dumbbellWeights,
          plateWeights: config.plateWeights,
          barWeights: config.barWeights,
          isEquipmentMirror: config.isEquipmentMirror,
        })),
      })),
      programs: programs.map((p) => ({
        name: p.name,
        description: p.description,
        phase: p.phase,
        isActive: p.isActive,
        startDate: p.startDate.toISOString(),
        endDate: p.endDate?.toISOString() ?? null,
        workouts: p.workouts.map((w) => ({
          name: w.name,
          dayOfWeek: w.dayOfWeek,
          order: w.order,
          exercises: w.exercises.map((pe) => ({
            exerciseName: pe.exercise.name,
            order: pe.order,
            targetSets: pe.targetSets,
            targetDropSets: pe.targetDropSets,
            targetRepsMin: pe.targetRepsMin,
            targetRepsMax: pe.targetRepsMax,
            targetRIR: pe.targetRIR,
            restSec: pe.restSec,
            autoregulationMode: pe.autoregulationMode,
            fatigueRate: pe.fatigueRate,
            loadAdjustmentPct: pe.loadAdjustmentPct,
            tempo: pe.tempo,
            notes: pe.notes,
            supersetGroup: pe.supersetGroup,
          })),
        })),
      })),
      sessions: sessions.map((s) => ({
        programName: programs.find((p) => p.id === s.programId)?.name ?? null,
        workoutName:
          programs.flatMap((p) => p.workouts).find((w) => w.id === s.workoutId)?.name ?? null,
        startedAt: s.startedAt.toISOString(),
        finishedAt: s.finishedAt?.toISOString() ?? null,
        notes: s.notes,
        sessionRpe: s.sessionRpe,
        gymName: gyms.find((gym) => gym.id === s.gymId)?.name ?? null,
        exerciseNames: s.exerciseMemberships.map((membership) => membership.exercise.name),
        exerciseMemberships: s.exerciseMemberships.map((membership) => ({
          exerciseName: membership.exercise.name,
          addedAt: membership.addedAt.toISOString(),
          ordinal: membership.ordinal,
        })),
        sets: s.sets.map((set) => ({
          exerciseName: exercises.find((e) => e.id === set.exerciseId)?.name ?? null,
          setNumber: set.setNumber,
          weight: set.weight,
          reps: set.reps,
          rir: set.rir,
          durationSec: set.durationSec,
          distanceM: set.distanceM,
          avgHr: set.avgHr,
          maxHr: set.maxHr,
          notes: set.notes,
          isWarmup: set.isWarmup,
          isDropSet: set.isDropSet,
          recoverySec: set.recoverySec,
          equipmentName: set.equipmentNameSnapshot,
          selectedLoadKg: set.selectedLoadKg,
          selectedLoadMultiplier: set.selectedLoadMultiplierSnapshot,
          nominalResistanceKg: set.nominalResistanceKg,
          equipmentLoadSnapshot: set.equipmentLoadSnapshot,
          completedAt: set.completedAt.toISOString(),
        })),
      })),
      coachSessions: coachSessions.map((c) => ({
        weekStart: c.weekStart.toISOString(),
        weekEnd: c.weekEnd.toISOString(),
        prompt: c.prompt,
        response: c.response,
        appliedAt: c.appliedAt?.toISOString() ?? null,
        createdAt: c.createdAt.toISOString(),
      })),
      exerciseGoals: exerciseGoals.map((g) => ({
        exerciseName: g.exercise.name,
        targetWeight: g.targetWeight,
        targetReps: g.targetReps,
        createdAt: g.createdAt.toISOString(),
        achievedAt: g.achievedAt?.toISOString() ?? null,
      })),
      bodyweightEntries: bodyweightEntries.map((b) => ({
        weightKg: b.weightKg,
        measuredAt: b.measuredAt.toISOString(),
        note: b.note,
      })),
      readinessCheckins: readinessCheckins.map((r) => ({
        readiness: r.readiness,
        sleepQuality: r.sleepQuality,
        soreness: r.soreness,
        note: r.note,
        createdAt: r.createdAt.toISOString(),
      })),
      conversations: conversations.map((c) => ({
        title: c.title,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
        messages: c.messages.map((m) => ({
          role: m.role,
          content: m.content,
          createdAt: m.createdAt.toISOString(),
        })),
      })),
    };

    const filename = `gymcoach-backup-${new Date().toISOString().slice(0, 10)}.json`;
    return new NextResponse(JSON.stringify(dump, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

// ------------------------------------------------------------
// Import
// ------------------------------------------------------------
// The payload is untrusted user input (an uploaded file): every value is
// bounded, every date must parse, arrays are capped, and the whole body is
// size-capped while being read. Version 1 files (pre-#168) stay importable:
// every field/model added in v2 is optional and defaults to null/absent.

// A date string that must actually parse AND fall within PostgreSQL's
// timestamp range. JS Date.parse accepts dates far outside it (e.g. year
// 275760), which would pass Zod and then throw deep in Prisma as a 500; we
// reject them here so a malformed file is a clean 400 with the user's data
// untouched (the route's documented contract).
const dateString = z
  .string()
  .max(40)
  .refine(
    (s) => {
      const t = Date.parse(s);
      if (Number.isNaN(t)) return false;
      // Postgres timestamp years run 4713 BC .. 294276 AD; JS Date itself
      // caps at +/-8.64e15 ms. Bound to years [1, 9999] - well within both
      // and far beyond any real training date.
      const year = new Date(t).getUTCFullYear();
      return year >= 1 && year <= 9999;
    },
    { message: 'Invalid or out-of-range date' },
  );

const importSchema = z.object({
  version: z.number().int().min(1).max(VERSION),
  exercises: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        // A legit export only ever contains valid enum values; rejecting the
        // rest here turns a Prisma 500 into a clean 400.
        muscleGroup: z.nativeEnum(MuscleGroup),
        category: z.nativeEnum(ExerciseCategory),
        defaultRestSec: z.number().int().min(15).max(600),
        notes: z.string().max(2000).nullable().optional(),
        // v2; absent in v1 backups.
        usesBodyweight: z.boolean().optional(),
        // v3; absent in older backups.
        equipmentType: z.nativeEnum(EquipmentType).optional(),
      }),
    )
    .max(2000),
  programs: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        description: z.string().max(5000).nullable().optional(),
        phase: z.string().max(100),
        isActive: z.boolean(),
        startDate: dateString,
        endDate: dateString.nullable().optional(),
        workouts: z
          .array(
            z.object({
              name: z.string().trim().min(1).max(200),
              dayOfWeek: z.number().int().min(1).max(7).nullable().optional(),
              order: z.number().int().min(0).max(1000),
              exercises: z
                .array(
                  z.object({
                    exerciseName: z.string().max(120),
                    order: z.number().int().min(0).max(1000),
                    targetSets: z.number().int().min(1).max(20),
                    targetDropSets: z.number().int().min(0).max(10).optional(),
                    targetRepsMin: z.number().int().min(1).max(50),
                    targetRepsMax: z.number().int().min(1).max(50),
                    targetRIR: z.number().int().min(0).max(5),
                    restSec: z.number().int().min(15).max(600),
                    autoregulationMode: z.enum(['PRESERVE_RIR', 'PRESERVE_REPS']).optional(),
                    fatigueRate: z.number().min(0.25).max(2).nullable().optional(),
                    loadAdjustmentPct: z.number().min(1).max(5).nullable().optional(),
                    tempo: z.string().max(20).nullable().optional(),
                    notes: z.string().max(2000).nullable().optional(),
                    // v2; absent in v1 backups.
                    supersetGroup: z
                      .number()
                      .int()
                      .min(MIN_SUPERSET_GROUP)
                      .max(MAX_SUPERSET_GROUP)
                      .nullable()
                      .optional(),
                  }),
                )
                .max(200),
            }),
          )
          .max(100),
      }),
    )
    .max(200),
  sessions: z
    .array(
      z.object({
        programName: z.string().max(200).nullable().optional(),
        workoutName: z.string().max(200).nullable().optional(),
        startedAt: dateString,
        finishedAt: dateString.nullable().optional(),
        notes: z.string().max(5000).nullable().optional(),
        sessionRpe: z.number().int().min(1).max(10).nullable().optional(),
        gymName: z.string().max(80).nullable().optional(),
        // v9; absent in earlier backups, whose memberships are reconstructed
        // from their set rows by the database trigger.
        exerciseNames: z.array(z.string().max(120)).max(500).optional(),
        exerciseMemberships: z
          .array(
            z.object({
              exerciseName: z.string().max(120),
              addedAt: dateString,
              // v10; v9 structured memberships keep their exported array
              // order when this stable tie-breaker is absent.
              ordinal: z.number().int().min(0).max(2_147_483_647).optional(),
            }),
          )
          .max(500)
          .optional(),
        sets: z
          .array(
            z.object({
              exerciseName: z.string().max(120).nullable(),
              setNumber: z.number().int().min(1).max(1000),
              weight: z.number().min(0).max(5000),
              reps: z.number().int().min(0).max(1000),
              rir: z.number().int().min(0).max(10).nullable().optional(),
              // v2 cardio fields; absent in v1 backups.
              durationSec: z.number().int().min(1).max(MAX_DURATION_SEC).nullable().optional(),
              distanceM: z.number().min(0).max(MAX_DISTANCE_M).nullable().optional(),
              avgHr: z.number().int().min(AVG_HR_MIN).max(AVG_HR_MAX).nullable().optional(),
              maxHr: z.number().int().min(MAX_HR_MIN).max(MAX_HR_MAX).nullable().optional(),
              notes: z.string().max(2000).nullable().optional(),
              isWarmup: z.boolean(),
              isDropSet: z.boolean(),
              recoverySec: z.number().int().min(0).max(86_400).nullable().optional(),
              equipmentName: z.string().max(120).nullable().optional(),
              selectedLoadKg: z.number().min(0).max(5000).nullable().optional(),
              selectedLoadMultiplier: z.number().positive().max(20).nullable().optional(),
              nominalResistanceKg: z.number().min(0).max(100_000).nullable().optional(),
              equipmentLoadSnapshot: z.record(z.string(), z.unknown()).nullable().optional(),
              completedAt: dateString,
            }),
          )
          .max(1000),
      }),
    )
    .max(20000),
  coachSessions: z
    .array(
      z.object({
        weekStart: dateString,
        weekEnd: dateString,
        prompt: z.string().max(200_000),
        response: z.string().max(200_000),
        appliedAt: dateString.nullable().optional(),
        createdAt: dateString,
      }),
    )
    .max(5000)
    .optional(),
  // Everything below is new in v2 and absent from v1 backups.
  profile: z
    .object({
      displayName: z.string().trim().min(1).max(80).nullable().optional(),
      bodyweight: z.number().min(20).max(300).nullable().optional(),
      sex: z.nativeEnum(Sex).nullable().optional(),
      heightCm: z.number().int().min(100).max(250).nullable().optional(),
      goal: z.nativeEnum(TrainingGoal).nullable().optional(),
      weeklyFrequency: z.number().int().min(1).max(14).nullable().optional(),
      unit: z.nativeEnum(WeightUnit).optional(),
      deloadUntil: dateString.nullable().optional(),
      activeGymName: z.string().max(80).nullable().optional(),
    })
    .optional(),
  gyms: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(80),
        inventoryMode: z.nativeEnum(GymInventoryMode).optional(),
        dumbbellWeights: z.array(z.number().min(0.1).max(5000)).max(200),
        plateWeights: z.array(z.number().min(0.1).max(5000)).max(200),
        barWeights: z.array(z.number().min(0.1).max(5000)).max(200),
        platePools: z
          .array(
            z.object({
              name: z.string().trim().min(1).max(120),
              compatibilityKey: z
                .string()
                .trim()
                .min(1)
                .max(80)
                .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/),
              plates: z
                .array(
                  z.object({
                    weightKg: z.number().min(0.1).max(500),
                    quantity: z.number().int().min(0).max(1000).nullable(),
                  }),
                )
                .max(200),
            }),
          )
          .max(100)
          .optional(),
        equipment: z
          .array(
            z.object({
              name: z.string().trim().min(1).max(120),
              equipmentType: z.nativeEnum(EquipmentType),
              description: z.string().max(4000).nullable().optional(),
              manufacturer: z.string().max(120).nullable().optional(),
              modelName: z.string().max(120).nullable().optional(),
              quantity: z.number().int().min(1).max(100),
              loadType: z.nativeEnum(EquipmentLoadType).optional(),
              weightOptions: z.array(z.number().min(0.1).max(5000)).max(200),
              selectedLoadMultiplier: z.number().positive().max(20).optional(),
              baseLoadKg: z.number().min(0).max(5000).optional(),
              platePoolCompatibilityKey: z.string().max(80).nullable().optional(),
              loadingSides: z.number().int().min(1).max(8).optional(),
              imageUrl: z
                .string()
                .url()
                .max(2048)
                .nullable()
                .optional()
                .refine((value) => value == null || value.startsWith('https://'), {
                  message: 'Equipment image URL must use HTTPS.',
                }),
              imageMimeType: z.enum(GYM_EQUIPMENT_IMAGE_MIME_TYPES).nullable().optional(),
              imageBase64: z.string().max(7_100_000).nullable().optional(),
              exerciseNames: z.array(z.string().max(120)).max(100),
              legacyMirrorExerciseNames: z.array(z.string().max(120)).max(100).optional(),
            }),
          )
          .max(1000)
          .optional(),
        exerciseConfigs: z
          .array(
            z.object({
              exerciseName: z.string().max(120),
              isAvailable: z.boolean(),
              weightOptions: z.array(z.number().min(0.1).max(5000)).max(200),
              dumbbellWeights: z.array(z.number().min(0.1).max(5000)).max(200).default([]),
              plateWeights: z.array(z.number().min(0.1).max(5000)).max(200).default([]),
              barWeights: z.array(z.number().min(0.1).max(5000)).max(200).default([]),
              isEquipmentMirror: z.boolean().optional(),
            }),
          )
          .max(2000),
      }),
    )
    .max(100)
    .optional(),
  exerciseGoals: z
    .array(
      z.object({
        exerciseName: z.string().max(120),
        targetWeight: z.number().positive().max(1000),
        targetReps: z.number().int().min(1).max(100),
        createdAt: dateString,
        achievedAt: dateString.nullable().optional(),
      }),
    )
    .max(2000)
    .optional(),
  bodyweightEntries: z
    .array(
      z.object({
        weightKg: z.number().min(20).max(300),
        measuredAt: dateString,
        note: z.string().max(500).nullable().optional(),
      }),
    )
    .max(20000)
    .optional(),
  readinessCheckins: z
    .array(
      z.object({
        readiness: z.number().int().min(1).max(5),
        sleepQuality: z.number().int().min(1).max(5),
        soreness: sorenessSchema,
        note: z.string().max(500).nullable().optional(),
        createdAt: dateString,
      }),
    )
    .max(20000)
    .optional(),
  conversations: z
    .array(
      z.object({
        title: z.string().max(200).nullable().optional(),
        createdAt: dateString,
        updatedAt: dateString,
        messages: z
          .array(
            z.object({
              role: z.nativeEnum(MessageRole),
              content: z.string().max(200_000),
              createdAt: dateString,
            }),
          )
          .max(2000),
      }),
    )
    .max(2000)
    .optional(),
});

const importBodySchema = z.object({
  payload: importSchema,
  // Explicit confirmation: replaces all data of the current user.
  confirmReplace: z.literal(true),
});

function validateImportedLegacyEquipmentSnapshots(
  sessions: Array<{
    sets: Array<{
      selectedLoadKg?: number | null;
      selectedLoadMultiplier?: number | null;
      nominalResistanceKg?: number | null;
      equipmentLoadSnapshot?: Record<string, unknown> | null;
    }>;
  }>,
) {
  for (const session of sessions) {
    for (const set of session.sets) {
      assertLegacySetEquipmentSnapshotConsistency({
        selectedLoadKg: set.selectedLoadKg ?? null,
        selectedLoadMultiplierSnapshot: set.selectedLoadMultiplier ?? null,
        nominalResistanceKg: set.nominalResistanceKg ?? null,
        equipmentLoadSnapshot: set.equipmentLoadSnapshot ?? null,
      });
    }
  }
}

function validateImportedMembershipOrdinals(
  sessions: Array<{ exerciseMemberships?: Array<{ ordinal?: number }> }>,
) {
  for (const session of sessions) {
    const seen = new Set<number>();
    for (const membership of session.exerciseMemberships ?? []) {
      if (membership.ordinal === undefined) continue;
      if (seen.has(membership.ordinal)) {
        throw new ApiError(400, 'Session exercise membership ordinals must be unique.');
      }
      seen.add(membership.ordinal);
    }
  }
}

// POST /api/backup: clears the current user's data and recreates it from the
// payload. Atomic: everything runs in a Prisma transaction, so a failure
// rolls back to the pre-import state.
export async function POST(req: Request) {
  try {
    const userId = await requireApiUserId(req);
    const { payload } = await parseJsonBody(req, importBodySchema, {
      maxBytes: MAX_BACKUP_BYTES,
    });
    validateImportedLegacyEquipmentSnapshots(payload.sessions);
    validateImportedMembershipOrdinals(payload.sessions);

    await db.$transaction(
      async (tx) => {
        // 1. Purge the user's existing data. Order matters where there is no
        //    cascade: sets before sessions and exercises, goals before
        //    exercises. Conversations cascade their messages; programs
        //    cascade workouts and program exercises.
        await tx.set.deleteMany({ where: { session: { userId } } });
        await tx.session.deleteMany({ where: { userId } });
        await tx.gym.deleteMany({ where: { userId } });
        await tx.coachSession.deleteMany({ where: { userId } });
        await tx.exerciseGoal.deleteMany({ where: { userId } });
        await tx.bodyweightEntry.deleteMany({ where: { userId } });
        await tx.readinessCheckin.deleteMany({ where: { userId } });
        await tx.conversation.deleteMany({ where: { userId } });
        // workouts/programExercises cascade via Program.
        await tx.program.deleteMany({ where: { userId } });
        await tx.exercise.deleteMany({ where: { userId } });

        // 2. Profile (v2): restore onto the current account. Identity fields
        //    (email, password) are never touched.
        if (payload.profile) {
          const p = payload.profile;
          await tx.user.update({
            where: { id: userId },
            data: {
              ...(p.displayName !== undefined ? { displayName: p.displayName } : {}),
              ...(p.bodyweight !== undefined ? { bodyweight: p.bodyweight } : {}),
              ...(p.sex !== undefined ? { sex: p.sex } : {}),
              ...(p.heightCm !== undefined ? { heightCm: p.heightCm } : {}),
              ...(p.goal !== undefined ? { goal: p.goal } : {}),
              ...(p.weeklyFrequency !== undefined ? { weeklyFrequency: p.weeklyFrequency } : {}),
              ...(p.unit !== undefined ? { unit: p.unit } : {}),
              ...(p.deloadUntil !== undefined
                ? { deloadUntil: p.deloadUntil ? new Date(p.deloadUntil) : null }
                : {}),
            },
          });
        }

        // 3. Recreate the exercises; we keep a name -> id index to link them.
        const exerciseIdByName = new Map<string, string>();
        for (const e of payload.exercises) {
          const created = await tx.exercise.create({
            data: {
              userId,
              name: e.name,
              muscleGroup: e.muscleGroup,
              category: e.category,
              defaultRestSec: e.defaultRestSec,
              notes: e.notes ?? null,
              usesBodyweight: e.usesBodyweight ?? false,
              equipmentType: e.equipmentType ?? 'OTHER',
            },
          });
          exerciseIdByName.set(e.name, created.id);
        }

        // 4. Saved gyms are recreated after exercises so per-exercise
        // availability can be linked by exercise name.
        const gymIdByName = new Map<string, string>();
        const equipmentIdByGymAndName = new Map<string, string>();
        for (const gym of payload.gyms ?? []) {
          const configs = gym.exerciseConfigs.flatMap((config) => {
            const exerciseId = exerciseIdByName.get(config.exerciseName);
            return exerciseId
              ? [
                  {
                    exerciseId,
                    isAvailable: config.isAvailable,
                    weightOptions: config.weightOptions,
                    dumbbellWeights: config.dumbbellWeights,
                    plateWeights: config.plateWeights,
                    barWeights: config.barWeights,
                    isEquipmentMirror: config.isEquipmentMirror ?? false,
                  },
                ]
              : [];
          });
          const created = await tx.gym.create({
            data: {
              userId,
              name: gym.name,
              inventoryMode: gym.inventoryMode ?? 'LEGACY',
              dumbbellWeights: gym.dumbbellWeights,
              plateWeights: gym.plateWeights,
              barWeights: gym.barWeights,
              exerciseConfigs: { createMany: { data: configs } },
            },
          });
          const platePools =
            gym.platePools ??
            (gym.plateWeights.length > 0
              ? [
                  {
                    name: 'Legacy shared plates',
                    compatibilityKey: 'legacy-default',
                    plates: [...new Set(gym.plateWeights)].map((weightKg) => ({
                      weightKg,
                      quantity: null,
                    })),
                  },
                ]
              : []);
          const poolIdByCompatibilityKey = new Map<string, string>();
          for (const pool of platePools) {
            const savedPool = await tx.gymPlatePool.create({
              data: {
                gymId: created.id,
                name: pool.name,
                compatibilityKey: pool.compatibilityKey,
                plates: {
                  createMany: {
                    data: [
                      ...new Map(
                        pool.plates.map((plate) => [
                          plate.weightKg,
                          { weightKg: plate.weightKg, quantity: plate.quantity },
                        ]),
                      ).values(),
                    ],
                  },
                },
              },
            });
            poolIdByCompatibilityKey.set(pool.compatibilityKey, savedPool.id);
          }
          for (const item of gym.equipment ?? []) {
            const decoded = item.imageBase64
              ? decodeGymEquipmentImage(item.imageBase64, item.imageMimeType ?? undefined)
              : null;
            const equipment = await tx.gymEquipment.create({
              data: {
                gymId: created.id,
                name: item.name,
                equipmentType: item.equipmentType,
                description: item.description ?? null,
                manufacturer: item.manufacturer ?? null,
                modelName: item.modelName ?? null,
                quantity: item.quantity,
                loadType:
                  item.loadType ??
                  (['MACHINE', 'CABLE'].includes(item.equipmentType) &&
                  item.weightOptions.length > 0
                    ? 'SELECTORIZED'
                    : 'NONE'),
                weightOptions: item.weightOptions,
                selectedLoadMultiplier: item.selectedLoadMultiplier ?? 1,
                baseLoadKg: item.baseLoadKg ?? 0,
                platePoolId: item.platePoolCompatibilityKey
                  ? (poolIdByCompatibilityKey.get(item.platePoolCompatibilityKey) ?? null)
                  : null,
                loadingSides: item.loadingSides ?? 2,
                imageUrl: decoded ? null : (item.imageUrl ?? null),
                imageData: decoded?.bytes,
                imageMimeType: decoded?.mimeType ?? null,
              },
            });
            equipmentIdByGymAndName.set(`${gym.name}\u0000${item.name}`, equipment.id);
            const exerciseIds = [
              ...new Set(
                item.exerciseNames.flatMap((name) => {
                  const exerciseId = exerciseIdByName.get(name);
                  return exerciseId ? [exerciseId] : [];
                }),
              ),
            ];
            const legacyMirrorExerciseNames = new Set(item.legacyMirrorExerciseNames ?? []);
            if (exerciseIds.length > 0) {
              await tx.gymEquipmentExercise.createMany({
                data: exerciseIds.map((exerciseId) => ({
                  equipmentId: equipment.id,
                  exerciseId,
                  mirrorsLegacyConfig: item.exerciseNames.some(
                    (name) =>
                      exerciseIdByName.get(name) === exerciseId &&
                      legacyMirrorExerciseNames.has(name),
                  ),
                })),
              });
            }
          }
          gymIdByName.set(gym.name, created.id);
        }
        const activeGymId = payload.profile?.activeGymName
          ? (gymIdByName.get(payload.profile.activeGymName) ?? null)
          : null;
        if (payload.gyms) {
          await tx.user.update({ where: { id: userId }, data: { activeGymId } });
        }

        // 5. Recreate programs / workouts / programExercises.
        for (const p of payload.programs) {
          const program = await tx.program.create({
            data: {
              userId,
              name: p.name,
              description: p.description ?? null,
              phase: p.phase,
              isActive: p.isActive,
              startDate: new Date(p.startDate),
              endDate: p.endDate ? new Date(p.endDate) : null,
            },
          });
          for (const w of p.workouts) {
            const workout = await tx.workout.create({
              data: {
                programId: program.id,
                name: w.name,
                dayOfWeek: w.dayOfWeek ?? null,
                order: w.order,
              },
            });
            for (const pe of w.exercises) {
              const exId = exerciseIdByName.get(pe.exerciseName);
              if (!exId) continue;
              await tx.programExercise.create({
                data: {
                  workoutId: workout.id,
                  exerciseId: exId,
                  order: pe.order,
                  targetSets: pe.targetSets,
                  targetDropSets: pe.targetDropSets ?? 0,
                  targetRepsMin: pe.targetRepsMin,
                  targetRepsMax: pe.targetRepsMax,
                  targetRIR: pe.targetRIR,
                  restSec: pe.restSec,
                  autoregulationMode: pe.autoregulationMode ?? 'PRESERVE_RIR',
                  fatigueRate: pe.fatigueRate ?? null,
                  loadAdjustmentPct: pe.loadAdjustmentPct ?? null,
                  tempo: pe.tempo ?? null,
                  notes: pe.notes ?? null,
                  supersetGroup: pe.supersetGroup ?? null,
                },
              });
            }
          }
        }

        // 6. Sessions + sets: we try to link to the program/workout by name,
        //    but accept leaving them nullable if not found.
        const programs = await tx.program.findMany({
          where: { userId },
          include: { workouts: true },
        });
        const programByName = new Map(programs.map((p) => [p.name, p]));

        for (const s of payload.sessions) {
          const program = s.programName ? programByName.get(s.programName) : null;
          const workout = s.workoutName
            ? program?.workouts.find((w) => w.name === s.workoutName)
            : null;
          const session = await tx.session.create({
            data: {
              userId,
              programId: program?.id ?? null,
              workoutId: workout?.id ?? null,
              startedAt: new Date(s.startedAt),
              finishedAt: s.finishedAt ? new Date(s.finishedAt) : null,
              notes: s.notes ?? null,
              sessionRpe: s.sessionRpe ?? null,
              gymId: s.gymName ? (gymIdByName.get(s.gymName) ?? null) : null,
            },
          });
          if (s.exerciseMemberships !== undefined) {
            const seenExerciseIds = new Set<string>();
            const usedOrdinals = new Set(
              s.exerciseMemberships.flatMap((membership) =>
                membership.ordinal === undefined ? [] : [membership.ordinal],
              ),
            );
            let nextFallbackOrdinal = 0;
            const membershipRows = s.exerciseMemberships.flatMap((membership) => {
              const exerciseId = exerciseIdByName.get(membership.exerciseName);
              if (!exerciseId || seenExerciseIds.has(exerciseId)) return [];
              seenExerciseIds.add(exerciseId);
              while (usedOrdinals.has(nextFallbackOrdinal)) nextFallbackOrdinal += 1;
              const ordinal = membership.ordinal ?? nextFallbackOrdinal++;
              usedOrdinals.add(ordinal);
              return [
                {
                  sessionId: session.id,
                  exerciseId,
                  addedAt: new Date(membership.addedAt),
                  ordinal,
                },
              ];
            });
            if (membershipRows.length > 0) {
              await tx.sessionExercise.createMany({ data: membershipRows, skipDuplicates: true });
            }
          }
          const setRows = s.sets.flatMap((set) => {
            const exId = set.exerciseName ? exerciseIdByName.get(set.exerciseName) : undefined;
            if (!exId) return [];
            return [
              {
                sessionId: session.id,
                exerciseId: exId,
                setNumber: set.setNumber,
                weight: set.weight,
                reps: set.reps,
                rir: set.rir ?? null,
                durationSec: set.durationSec ?? null,
                distanceM: set.distanceM ?? null,
                avgHr: set.avgHr ?? null,
                maxHr: set.maxHr ?? null,
                notes: set.notes ?? null,
                isWarmup: set.isWarmup,
                isDropSet: set.isDropSet,
                recoverySec: set.recoverySec ?? null,
                gymEquipmentId:
                  s.gymName && set.equipmentName
                    ? (equipmentIdByGymAndName.get(`${s.gymName}\u0000${set.equipmentName}`) ??
                      null)
                    : null,
                equipmentNameSnapshot: set.equipmentName ?? null,
                selectedLoadKg: set.selectedLoadKg ?? null,
                selectedLoadMultiplierSnapshot: set.selectedLoadMultiplier ?? null,
                nominalResistanceKg: set.nominalResistanceKg ?? null,
                equipmentLoadSnapshot:
                  set.equipmentLoadSnapshot == null
                    ? Prisma.JsonNull
                    : (set.equipmentLoadSnapshot as Prisma.InputJsonValue),
                completedAt: new Date(set.completedAt),
              },
            ];
          });
          if (setRows.length > 0) await tx.set.createMany({ data: setRows });
          if (s.exerciseMemberships === undefined) {
            const existingMemberships = await tx.sessionExercise.findMany({
              where: { sessionId: session.id },
              select: { exerciseId: true, ordinal: true },
            });
            const seenExerciseIds = new Set(
              existingMemberships.map((membership) => membership.exerciseId),
            );
            let nextOrdinal =
              Math.max(-1, ...existingMemberships.map((membership) => membership.ordinal)) + 1;
            const membershipRows = (s.exerciseNames ?? []).flatMap((exerciseName) => {
              const exerciseId = exerciseIdByName.get(exerciseName);
              if (!exerciseId || seenExerciseIds.has(exerciseId)) return [];
              seenExerciseIds.add(exerciseId);
              return [{ sessionId: session.id, exerciseId, ordinal: nextOrdinal++ }];
            });
            if (membershipRows.length > 0) {
              await tx.sessionExercise.createMany({ data: membershipRows, skipDuplicates: true });
            }
          }
        }

        for (const c of payload.coachSessions ?? []) {
          await tx.coachSession.create({
            data: {
              userId,
              weekStart: new Date(c.weekStart),
              weekEnd: new Date(c.weekEnd),
              prompt: c.prompt,
              response: c.response,
              appliedAt: c.appliedAt ? new Date(c.appliedAt) : null,
              createdAt: new Date(c.createdAt),
            },
          });
        }

        // 7. Goals / bodyweight / readiness / conversations (v2). A goal
        //    whose exercise is unknown is skipped, like sets above.
        const goalRows = (payload.exerciseGoals ?? []).flatMap((g) => {
          const exId = exerciseIdByName.get(g.exerciseName);
          if (!exId) return [];
          return [
            {
              userId,
              exerciseId: exId,
              targetWeight: g.targetWeight,
              targetReps: g.targetReps,
              createdAt: new Date(g.createdAt),
              achievedAt: g.achievedAt ? new Date(g.achievedAt) : null,
            },
          ];
        });
        if (goalRows.length > 0) {
          // One goal per (user, exercise): duplicates in the file would break
          // the unique constraint, so keep the last one per exercise.
          const lastPerExercise = new Map(goalRows.map((g) => [g.exerciseId, g]));
          await tx.exerciseGoal.createMany({
            data: Array.from(lastPerExercise.values()),
          });
        }

        const bodyweightRows = (payload.bodyweightEntries ?? []).map((b) => ({
          userId,
          weightKg: b.weightKg,
          measuredAt: new Date(b.measuredAt),
          note: b.note ?? null,
        }));
        if (bodyweightRows.length > 0) {
          await tx.bodyweightEntry.createMany({ data: bodyweightRows });
        }

        const readinessRows = (payload.readinessCheckins ?? []).map((r) => ({
          userId,
          readiness: r.readiness,
          sleepQuality: r.sleepQuality,
          soreness: r.soreness ?? undefined,
          note: r.note ?? null,
          createdAt: new Date(r.createdAt),
        }));
        if (readinessRows.length > 0) {
          await tx.readinessCheckin.createMany({ data: readinessRows });
        }

        for (const c of payload.conversations ?? []) {
          const conversation = await tx.conversation.create({
            data: {
              userId,
              title: c.title ?? null,
              createdAt: new Date(c.createdAt),
              updatedAt: new Date(c.updatedAt),
            },
          });
          if (c.messages.length > 0) {
            await tx.message.createMany({
              data: c.messages.map((m) => ({
                conversationId: conversation.id,
                role: m.role,
                content: m.content,
                createdAt: new Date(m.createdAt),
              })),
            });
          }
        }
      },
      { timeout: 60_000 },
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
