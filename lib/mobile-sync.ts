import { createHash } from 'node:crypto';
import { Prisma } from '@/prisma/generated/client';
import { ApiError } from '@/lib/api';
import { db } from '@/lib/db';
import type { MobilePrincipal } from '@/lib/mobile-auth';
import { resolveFrozenMobileSetEquipmentSnapshot } from '@/lib/mobile-equipment-snapshot';
import type { MobileSyncOperation } from '@/lib/schemas/mobile';
import { validateSetForCategory } from '@/lib/schemas/set';
import { rederiveGoalAchievement, stampGoalIfAchieved } from '@/lib/set-goal-sync';
import { resolveSetEquipmentUpdate } from '@/lib/set-equipment';
import { setPreferredExerciseEquipment } from '@/lib/gym-equipment';

export interface MobileSyncResult {
  operationId: string;
  status: 'APPLIED' | 'DUPLICATE' | 'REJECTED';
  result?: Record<string, unknown>;
  error?: string;
}

export async function applyMobileOperations(
  principal: MobilePrincipal,
  operations: MobileSyncOperation[],
): Promise<MobileSyncResult[]> {
  const results: MobileSyncResult[] = [];
  for (const operation of operations) {
    const result = await applyMobileOperation(principal, operation);
    results.push(result);
    if (result.status === 'REJECTED') break;
  }
  return results;
}

async function applyMobileOperation(
  principal: MobilePrincipal,
  operation: MobileSyncOperation,
): Promise<MobileSyncResult> {
  const payloadHash = createHash('sha256').update(JSON.stringify(operation)).digest('hex');
  const duplicate = await db.mobileMutation.findUnique({
    where: {
      userId_operationId: { userId: principal.userId, operationId: operation.operationId },
    },
  });
  if (duplicate) {
    if (duplicate.payloadHash !== payloadHash) {
      return {
        operationId: operation.operationId,
        status: 'REJECTED',
        error: 'Operation ID was already used with a different payload.',
      };
    }
    return {
      operationId: operation.operationId,
      status: 'DUPLICATE',
      result: duplicate.result as Record<string, unknown>,
    };
  }

  try {
    const applied = await db.$transaction(async (tx) => {
      const raced = await tx.mobileMutation.findUnique({
        where: {
          userId_operationId: { userId: principal.userId, operationId: operation.operationId },
        },
      });
      if (raced) return { duplicate: true, result: raced.result as Record<string, unknown> };

      const result = await applyOperationInTransaction(tx, principal.userId, operation);
      await tx.mobileMutation.create({
        data: {
          userId: principal.userId,
          deviceId: principal.deviceId,
          operationId: operation.operationId,
          type: operation.type,
          payloadHash,
          result: result as Prisma.InputJsonValue,
        },
      });
      return { duplicate: false, result };
    });

    if (!applied.duplicate) {
      await runGoalSideEffect(principal.userId, operation, applied.result);
    }
    return {
      operationId: operation.operationId,
      status: applied.duplicate ? 'DUPLICATE' : 'APPLIED',
      result: applied.result,
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const raced = await db.mobileMutation.findUnique({
        where: {
          userId_operationId: { userId: principal.userId, operationId: operation.operationId },
        },
      });
      if (raced) {
        if (raced.payloadHash !== payloadHash) {
          return {
            operationId: operation.operationId,
            status: 'REJECTED',
            error: 'Operation ID was already used with a different payload.',
          };
        }
        return {
          operationId: operation.operationId,
          status: 'DUPLICATE',
          result: raced.result as Record<string, unknown>,
        };
      }
    }
    if (error instanceof ApiError) {
      return {
        operationId: operation.operationId,
        status: 'REJECTED',
        error: error.message,
      };
    }
    throw error;
  }
}

async function applyOperationInTransaction(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  userId: string,
  operation: MobileSyncOperation,
): Promise<Record<string, unknown>> {
  switch (operation.type) {
    case 'START_SESSION': {
      const current = await tx.session.findUnique({ where: { id: operation.session.id } });
      if (current) {
        if (current.userId !== userId) throw new ApiError(404, 'Session not found.');
        return { entityType: 'SESSION', entityId: current.id, created: false };
      }
      const workout = await tx.workout.findFirst({
        where: { id: operation.session.workoutId, program: { userId } },
        select: { id: true, programId: true },
      });
      if (!workout) throw new ApiError(400, 'Invalid workout.');
      if (operation.session.gymId) {
        const gym = await tx.gym.findFirst({
          where: { id: operation.session.gymId, userId },
          select: { id: true },
        });
        if (!gym) throw new ApiError(400, 'Invalid gym.');
      }
      const session = await tx.session.create({
        data: {
          id: operation.session.id,
          userId,
          workoutId: workout.id,
          programId: workout.programId,
          gymId: operation.session.gymId ?? null,
          startedAt: new Date(operation.session.startedAt),
        },
      });
      return {
        entityType: 'SESSION',
        entityId: session.id,
        created: true,
        startedAt: session.startedAt.toISOString(),
      };
    }
    case 'UPSERT_SET': {
      const session = await tx.session.findFirst({
        where: { id: operation.set.sessionId, userId },
        select: { id: true, gymId: true },
      });
      if (!session) throw new ApiError(404, 'Session not found.');
      const exercise = await tx.exercise.findFirst({
        where: { id: operation.set.exerciseId, userId },
      });
      if (!exercise) throw new ApiError(400, 'Invalid exercise.');
      const categoryError = validateSetForCategory(exercise.category, operation.set);
      if (categoryError) throw new ApiError(400, categoryError);
      const existing = await tx.set.findUnique({
        where: { id: operation.set.id },
        include: { session: { select: { userId: true } } },
      });
      if (existing && existing.session.userId !== userId) {
        throw new ApiError(404, 'Set not found.');
      }
      if (
        existing &&
        (existing.sessionId !== operation.set.sessionId ||
          existing.exerciseId !== operation.set.exerciseId)
      ) {
        throw new ApiError(400, 'An existing set cannot change its session or exercise.');
      }
      const isCardio = exercise.category === 'CARDIO';
      if (isCardio && operation.set.frozenEquipmentSnapshot) {
        throw new ApiError(400, 'Cardio sets cannot include an equipment load snapshot.');
      }
      if (existing && operation.set.frozenEquipmentSnapshot) {
        throw new ApiError(400, 'Frozen equipment snapshots are accepted only for new sets.');
      }
      const equipmentSnapshot = isCardio
        ? null
        : operation.set.frozenEquipmentSnapshot
          ? await resolveFrozenMobileSetEquipmentSnapshot(tx, {
              userId,
              sessionGymId: session.gymId,
              exerciseId: operation.set.exerciseId,
              requestedGymEquipmentId: operation.set.gymEquipmentId,
              snapshot: operation.set.frozenEquipmentSnapshot,
            })
          : await resolveSetEquipmentUpdate(tx, {
              userId,
              sessionGymId: session.gymId,
              exerciseId: operation.set.exerciseId,
              selectedLoadKg: operation.set.weight,
              existing,
              requestedGymEquipmentId: operation.set.gymEquipmentId,
              action: operation.set.equipmentSnapshotAction,
              createSnapshotVersion: 1,
              allowLegacySnapshot: true,
            });
      const data = {
        sessionId: operation.set.sessionId,
        exerciseId: operation.set.exerciseId,
        setNumber: operation.set.setNumber,
        weight: isCardio ? 0 : operation.set.weight,
        reps: isCardio ? 1 : operation.set.reps,
        rir: isCardio ? null : operation.set.rir,
        durationSec: isCardio ? (operation.set.durationSec ?? null) : null,
        distanceM: isCardio ? (operation.set.distanceM ?? null) : null,
        avgHr: isCardio ? (operation.set.avgHr ?? null) : null,
        maxHr: isCardio ? (operation.set.maxHr ?? null) : null,
        notes: operation.set.notes ?? null,
        isWarmup: operation.set.isWarmup,
        isDropSet: operation.set.isDropSet,
        recoverySec: operation.set.recoverySec ?? null,
        completedAt: new Date(operation.set.completedAt),
        ...(equipmentSnapshot ?? {}),
      };
      const saved = existing
        ? await tx.set.update({ where: { id: existing.id }, data })
        : await tx.set.create({ data: { id: operation.set.id, ...data } });
      return {
        entityType: 'SET',
        entityId: saved.id,
        exerciseId: saved.exerciseId,
        created: !existing,
        completedAt: saved.completedAt.toISOString(),
      };
    }
    case 'DELETE_SET': {
      const existing = await tx.set.findUnique({
        where: { id: operation.setId },
        include: { session: { select: { userId: true } } },
      });
      if (!existing) {
        return { entityType: 'SET', entityId: operation.setId, deleted: false };
      }
      if (existing.session.userId !== userId) throw new ApiError(404, 'Set not found.');
      await tx.set.delete({ where: { id: existing.id } });
      return {
        entityType: 'SET',
        entityId: existing.id,
        exerciseId: existing.exerciseId,
        deleted: true,
      };
    }
    case 'DELETE_SESSION': {
      const existing = await tx.session.findFirst({
        where: { id: operation.sessionId, userId },
        select: {
          id: true,
          sets: { select: { exerciseId: true }, distinct: ['exerciseId'] },
        },
      });
      if (!existing) {
        return {
          entityType: 'SESSION',
          entityId: operation.sessionId,
          deleted: false,
          exerciseIds: [],
        };
      }
      const deleted = await tx.session.deleteMany({
        where: { id: operation.sessionId, userId },
      });
      return {
        entityType: 'SESSION',
        entityId: operation.sessionId,
        deleted: deleted.count === 1,
        exerciseIds: existing.sets.map((set) => set.exerciseId),
      };
    }
    case 'UPDATE_TARGET_SETS': {
      const current = await tx.programExercise.findFirst({
        where: {
          id: operation.programExerciseId,
          workout: { program: { userId } },
        },
        select: { id: true, targetSets: true },
      });
      if (!current) throw new ApiError(404, 'Program exercise not found.');

      if (current.targetSets === operation.targetSets) {
        return {
          entityType: 'PROGRAM_EXERCISE',
          entityId: current.id,
          previousTargetSets: current.targetSets,
          targetSets: current.targetSets,
          changed: false,
        };
      }
      if (current.targetSets !== operation.previousTargetSets) {
        throw new ApiError(
          409,
          `Target set count changed from ${operation.previousTargetSets} to ${current.targetSets}. Refresh the program and try again.`,
        );
      }

      const updated = await tx.programExercise.updateMany({
        where: {
          id: current.id,
          targetSets: operation.previousTargetSets,
        },
        data: { targetSets: operation.targetSets },
      });
      if (updated.count !== 1) {
        const latest = await tx.programExercise.findFirst({
          where: {
            id: operation.programExerciseId,
            workout: { program: { userId } },
          },
          select: { targetSets: true },
        });
        if (!latest) throw new ApiError(404, 'Program exercise not found.');
        if (latest.targetSets === operation.targetSets) {
          return {
            entityType: 'PROGRAM_EXERCISE',
            entityId: current.id,
            previousTargetSets: latest.targetSets,
            targetSets: latest.targetSets,
            changed: false,
          };
        }
        throw new ApiError(
          409,
          `Target set count changed from ${operation.previousTargetSets} to ${latest.targetSets}. Refresh the program and try again.`,
        );
      }

      return {
        entityType: 'PROGRAM_EXERCISE',
        entityId: current.id,
        previousTargetSets: current.targetSets,
        targetSets: operation.targetSets,
        changed: true,
      };
    }
    case 'UPDATE_PREFERRED_EQUIPMENT': {
      const preference = await setPreferredExerciseEquipment(
        tx,
        userId,
        operation.gymId,
        operation.exerciseId,
        operation.preferredEquipmentId,
        'CLEAR',
      );
      return {
        entityType: 'GYM_EXERCISE_CONFIG',
        entityId: `${operation.gymId}:${operation.exerciseId}`,
        ...preference,
      };
    }
    case 'MUTATE_WORKOUT_EXERCISES': {
      const session = await tx.session.findFirst({
        where: {
          id: operation.sessionId,
          userId,
          workoutId: operation.workoutId,
          finishedAt: operation.programDecision === true ? { not: null } : null,
        },
        select: { id: true },
      });
      if (!session) throw new ApiError(404, 'Workout session not found.');

      const currentRows = await tx.programExercise.findMany({
        where: { workoutId: operation.workoutId, workout: { program: { userId } } },
        orderBy: [{ order: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          exerciseId: true,
          order: true,
          targetSets: true,
          targetDropSets: true,
          targetRepsMin: true,
          targetRepsMax: true,
          targetRIR: true,
          restSec: true,
          tempo: true,
          notes: true,
          supersetGroup: true,
          autoregulationMode: true,
          fatigueRate: true,
          loadAdjustmentPct: true,
        },
      });
      if (currentRows.length === 0) throw new ApiError(404, 'Workout exercises not found.');

      const canonical = (
        rows: Array<{
          id: string;
          exerciseId: string;
          order: number;
          targetSets: number;
          targetDropSets: number;
          targetRepsMin: number;
          targetRepsMax: number;
          targetRIR: number;
          restSec: number;
          tempo?: string | null;
          notes?: string | null;
          supersetGroup?: number | null;
          autoregulationMode: 'PRESERVE_RIR' | 'PRESERVE_REPS';
          fatigueRate?: number | null;
          loadAdjustmentPct?: number | null;
        }>,
      ) =>
        rows
          .map((row) => ({
            ...row,
            tempo: row.tempo ?? null,
            notes: row.notes ?? null,
            supersetGroup: row.supersetGroup ?? null,
            fatigueRate: row.fatigueRate ?? null,
            loadAdjustmentPct: row.loadAdjustmentPct ?? null,
          }))
          .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
      const current = canonical(currentRows);
      const previous = canonical(operation.previousExercises);
      const next = canonical(operation.exercises);
      if (JSON.stringify(current) === JSON.stringify(next)) {
        return {
          entityType: 'WORKOUT_EXERCISES',
          entityId: operation.workoutId,
          changed: false,
        };
      }
      if (JSON.stringify(current) !== JSON.stringify(previous)) {
        throw new ApiError(409, 'Workout exercises changed. Refresh the workout and try again.');
      }

      const ownedExerciseCount = await tx.exercise.count({
        where: { userId, id: { in: next.map((exercise) => exercise.exerciseId) } },
      });
      if (ownedExerciseCount !== next.length) {
        throw new ApiError(400, 'A workout exercise is unavailable.');
      }

      const nextIds = new Set(next.map((exercise) => exercise.id));
      await tx.programExercise.deleteMany({
        where: { workoutId: operation.workoutId, id: { notIn: [...nextIds] } },
      });
      const currentIds = new Set(current.map((exercise) => exercise.id));
      for (const exercise of next) {
        const data = {
          exerciseId: exercise.exerciseId,
          order: exercise.order,
          targetSets: exercise.targetSets,
          targetDropSets: exercise.targetDropSets,
          targetRepsMin: exercise.targetRepsMin,
          targetRepsMax: exercise.targetRepsMax,
          targetRIR: exercise.targetRIR,
          restSec: exercise.restSec,
          tempo: exercise.tempo,
          notes: exercise.notes,
          supersetGroup: exercise.supersetGroup,
          autoregulationMode: exercise.autoregulationMode,
          fatigueRate: exercise.fatigueRate,
          loadAdjustmentPct: exercise.loadAdjustmentPct,
        };
        if (currentIds.has(exercise.id)) {
          await tx.programExercise.update({ where: { id: exercise.id }, data });
        } else {
          await tx.programExercise.create({
            data: { id: exercise.id, workoutId: operation.workoutId, ...data },
          });
        }
      }

      return {
        entityType: 'WORKOUT_EXERCISES',
        entityId: operation.workoutId,
        changed: true,
      };
    }
    case 'REPLACE_PROGRAM_EXERCISE': {
      const current = await tx.programExercise.findFirst({
        where: {
          id: operation.programExerciseId,
          workout: { program: { userId } },
        },
        select: { id: true, workoutId: true, exerciseId: true },
      });
      if (!current) throw new ApiError(404, 'Program exercise not found.');

      const session = await tx.session.findFirst({
        where: {
          id: operation.sessionId,
          userId,
          workoutId: current.workoutId,
          finishedAt: null,
        },
        select: { id: true },
      });
      if (!session) throw new ApiError(404, 'Workout session not found.');

      const replacement = await tx.exercise.findFirst({
        where: { id: operation.replacementExerciseId, userId },
        select: { id: true },
      });
      if (!replacement) throw new ApiError(400, 'Invalid replacement exercise.');

      if (current.exerciseId === operation.replacementExerciseId) {
        return {
          entityType: 'PROGRAM_EXERCISE',
          entityId: current.id,
          previousExerciseId: operation.previousExerciseId,
          replacementExerciseId: current.exerciseId,
          changed: false,
        };
      }
      if (current.exerciseId !== operation.previousExerciseId) {
        throw new ApiError(
          409,
          `Program exercise changed from ${operation.previousExerciseId} to ${current.exerciseId}. Refresh the workout and try again.`,
        );
      }

      const updated = await tx.programExercise.updateMany({
        where: {
          id: current.id,
          exerciseId: operation.previousExerciseId,
        },
        data: { exerciseId: operation.replacementExerciseId },
      });
      if (updated.count !== 1) {
        const latest = await tx.programExercise.findFirst({
          where: {
            id: operation.programExerciseId,
            workout: { program: { userId } },
          },
          select: { exerciseId: true },
        });
        if (!latest) throw new ApiError(404, 'Program exercise not found.');
        if (latest.exerciseId === operation.replacementExerciseId) {
          return {
            entityType: 'PROGRAM_EXERCISE',
            entityId: current.id,
            previousExerciseId: operation.previousExerciseId,
            replacementExerciseId: latest.exerciseId,
            changed: false,
          };
        }
        throw new ApiError(
          409,
          `Program exercise changed from ${operation.previousExerciseId} to ${latest.exerciseId}. Refresh the workout and try again.`,
        );
      }

      return {
        entityType: 'PROGRAM_EXERCISE',
        entityId: current.id,
        previousExerciseId: current.exerciseId,
        replacementExerciseId: operation.replacementExerciseId,
        changed: true,
      };
    }
    case 'FINISH_SESSION': {
      const existing = await tx.session.findFirst({ where: { id: operation.sessionId, userId } });
      if (!existing) throw new ApiError(404, 'Session not found.');
      const session = await tx.session.update({
        where: { id: existing.id },
        data: {
          finishedAt: existing.finishedAt ?? new Date(operation.finishedAt),
          ...(operation.notes !== undefined ? { notes: operation.notes } : {}),
          ...(operation.sessionRpe !== undefined ? { sessionRpe: operation.sessionRpe } : {}),
        },
      });
      return {
        entityType: 'SESSION',
        entityId: session.id,
        finishedAt: session.finishedAt?.toISOString() ?? null,
      };
    }
  }
}

async function runGoalSideEffect(
  userId: string,
  operation: MobileSyncOperation,
  result: Record<string, unknown>,
) {
  try {
    if (operation.type === 'UPSERT_SET') {
      const set = await db.set.findUnique({ where: { id: operation.set.id } });
      const exercise = await db.exercise.findUnique({ where: { id: operation.set.exerciseId } });
      if (set && exercise) await stampGoalIfAchieved(userId, exercise, set);
    } else if (operation.type === 'DELETE_SET' && typeof result.exerciseId === 'string') {
      await rederiveGoalAchievement(userId, result.exerciseId);
    } else if (operation.type === 'DELETE_SESSION' && Array.isArray(result.exerciseIds)) {
      for (const exerciseId of result.exerciseIds) {
        if (typeof exerciseId === 'string') await rederiveGoalAchievement(userId, exerciseId);
      }
    }
  } catch (error) {
    console.error('[mobile/sync] goal update failed:', error);
  }
}
