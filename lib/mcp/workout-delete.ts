import { db } from '@/lib/db';

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

  await db.$transaction(async (tx) => {
    const result = await tx.session.deleteMany({
      where: { userId, id: { in: uniqueIds } },
    });
    if (result.count !== uniqueIds.length) {
      throw new Error('Workout deletion changed concurrently; the transaction was rolled back.');
    }
  });

  return {
    ok: true,
    status: 'DELETED' as const,
    reason,
    deletedCount: deleted.length,
    deleted,
    recoverable: false,
    recoveryNote:
      'This P0 endpoint uses the existing hard-delete session model. Operation audit/undo is a planned follow-up and is not claimed as available yet.',
  };
}
