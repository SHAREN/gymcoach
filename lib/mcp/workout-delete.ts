import { db } from '@/lib/db';
import {
  captureOwnedSessionSnapshots,
  createWorkoutOperationAudit,
} from '@/lib/mcp/workout-operation-audit';

export async function deleteOwnedWorkouts(
  userId: string,
  sessionIds: string[],
  reason: string | null,
) {
  const uniqueIds = [...new Set(sessionIds)];
  const rows = await db.session.findMany({
    where: { userId, id: { in: uniqueIds } },
    orderBy: { startedAt: 'asc' },
    select: {
      id: true,
      startedAt: true,
      finishedAt: true,
      notes: true,
      gym: { select: { id: true, name: true } },
      _count: { select: { sets: true, exerciseMemberships: true } },
    },
  });
  const found = new Set(rows.map((row) => row.id));
  const missingSessionIds = uniqueIds.filter((id) => !found.has(id));
  if (missingSessionIds.length > 0) {
    return {
      ok: false,
      status: 'NEEDS_RESOLUTION' as const,
      errorCode: 'SESSION_NOT_FOUND_OR_NOT_OWNED',
      issues: missingSessionIds.map((sessionId) => ({
        errorCode: 'SESSION_NOT_FOUND_OR_NOT_OWNED',
        sessionId,
        message: 'The session does not exist for this trainee, may already be deleted, or is not owned by this token.',
      })),
      deleted: [],
    };
  }

  const deleted = rows.map((row) => ({
    sessionId: row.id,
    date: row.startedAt.toISOString().slice(0, 10),
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    gym: row.gym,
    exerciseCount: row._count.exerciseMemberships,
    setCount: row._count.sets,
    notes: row.notes,
  }));

  const audit = await db.$transaction(async (tx) => {
    const snapshots = await captureOwnedSessionSnapshots(tx, userId, uniqueIds);
    if (snapshots.length !== uniqueIds.length) {
      throw new Error('Workout deletion changed concurrently; the transaction was rolled back.');
    }
    const result = await tx.session.deleteMany({
      where: { userId, id: { in: uniqueIds } },
    });
    if (result.count !== uniqueIds.length) {
      throw new Error('Workout deletion changed concurrently; the transaction was rolled back.');
    }
    return createWorkoutOperationAudit(tx, {
      userId,
      operation: uniqueIds.length === 1 ? 'delete_workout' : 'delete_workouts',
      reason,
      request: { sessionIds: uniqueIds },
      result: { deletedSessionIds: uniqueIds },
      undoSnapshot: { version: 1, createdSessions: [], deletedSessions: snapshots },
    });
  });

  return {
    ok: true,
    status: 'DELETED' as const,
    operationId: audit.operationId,
    operationCreatedAt: audit.createdAt,
    reason,
    deletedCount: deleted.length,
    deleted,
    recoverable: true,
  };
}
