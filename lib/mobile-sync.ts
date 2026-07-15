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
    }
  } catch (error) {
    console.error('[mobile/sync] goal update failed:', error);
  }
}
