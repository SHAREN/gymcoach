import { db } from '@/lib/db';
import { analyzeMcpWorkoutConflicts } from '@/lib/mcp/workout-conflicts';
import { learnMcpEntityAliases, type McpEntityAliasProposals } from '@/lib/mcp/entity-aliases';
import {
  formatHistoricalWorkoutResult,
  importHistoricalWorkoutWithTx,
  rederiveHistoricalWorkoutGoals,
  type HistoricalWorkoutImportInput,
} from '@/lib/mcp/historical-workout-import';
import {
  previewHistoricalWorkoutBatch,
  type HistoricalWorkoutDraft,
} from '@/lib/mcp/historical-workout-batch';
import { McpOperationError, asMcpIssue } from '@/lib/mcp/operation-error';
import {
  captureOwnedSessionSnapshots,
  createWorkoutOperationAudit,
} from '@/lib/mcp/workout-operation-audit';

export async function reconcileHistoricalWorkouts(
  userId: string,
  rawDrafts: HistoricalWorkoutDraft[],
  deleteSessionIds: string[],
  reason: string | null,
) {
  const preview = await previewHistoricalWorkoutBatch(userId, rawDrafts);
  if (preview.status !== 'READY') {
    return { ok: false, status: 'NEEDS_RESOLUTION' as const, issues: preview.issues, preview };
  }

  const uniqueDeleteIds = [...new Set(deleteSessionIds)];
  const deleteRows = uniqueDeleteIds.length
    ? await db.session.findMany({
        where: { userId, id: { in: uniqueDeleteIds } },
        orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
        include: {
          gym: { select: { id: true, name: true } },
          sets: { select: { exerciseId: true } },
          exerciseMemberships: { select: { exerciseId: true } },
        },
      })
    : [];
  if (deleteRows.length !== uniqueDeleteIds.length) {
    const found = new Set(deleteRows.map((row) => row.id));
    const missing = uniqueDeleteIds.filter((id) => !found.has(id));
    return {
      ok: false,
      status: 'NEEDS_RESOLUTION' as const,
      issues: missing.map((sessionId) => ({
        errorCode: 'SESSION_NOT_FOUND_OR_NOT_OWNED',
        sessionId,
        message: 'The requested cleanup session is missing, already deleted or not owned by this trainee.',
      })),
      preview,
    };
  }

  const resolvedInputs = preview.workouts.map((row) => {
    if (row.status !== 'READY' || !('resolvedWorkout' in row)) {
      throw new Error('Internal preview/reconcile mismatch.');
    }
    return row.resolvedWorkout as HistoricalWorkoutImportInput;
  });

  try {
    const committed = await db.$transaction(async (tx) => {
      const deletedSnapshots = await captureOwnedSessionSnapshots(tx, userId, uniqueDeleteIds);
      if (deletedSnapshots.length !== uniqueDeleteIds.length) {
        throw new McpOperationError(
          'RECONCILE_CONCURRENT_CHANGE',
          'One or more cleanup sessions changed before the reconciliation transaction began.',
          { field: 'deleteSessionIds' },
        );
      }
      if (uniqueDeleteIds.length > 0) {
        const deleted = await tx.session.deleteMany({ where: { userId, id: { in: uniqueDeleteIds } } });
        if (deleted.count !== uniqueDeleteIds.length) {
          throw new McpOperationError(
            'RECONCILE_DELETE_MISMATCH',
            'The cleanup delete count changed concurrently; the whole reconciliation was rolled back.',
            { field: 'deleteSessionIds' },
          );
        }
      }

      const written = [];
      for (let index = 0; index < resolvedInputs.length; index += 1) {
        try {
          const row = await importHistoricalWorkoutWithTx(tx, userId, resolvedInputs[index]!);
          const previewRow = preview.workouts[index];
          if (previewRow && 'aliasProposals' in previewRow) {
            await learnMcpEntityAliases(
              tx,
              userId,
              previewRow.aliasProposals as McpEntityAliasProposals,
            );
          }
          written.push(row);
        } catch (error) {
          const issue = asMcpIssue(error);
          throw new McpOperationError(
            typeof issue.errorCode === 'string' ? issue.errorCode : 'RECONCILE_IMPORT_FAILED',
            typeof issue.message === 'string' ? issue.message : 'Historical reconciliation import failed.',
            { field: 'workouts[' + index + ']', details: { workoutIndex: index, issue } },
          );
        }
      }
      const createdSessionIds = written.filter((row) => row.created).map((row) => row.session.id);
      const createdSnapshots = await captureOwnedSessionSnapshots(tx, userId, createdSessionIds);
      const audit = await createWorkoutOperationAudit(tx, {
        userId,
        operation: 'reconcile_historical_workouts',
        reason,
        request: {
          importIds: resolvedInputs.map((input) => input.importId),
          deleteSessionIds: uniqueDeleteIds,
        },
        result: {
          createdSessionIds,
          deletedSessionIds: uniqueDeleteIds,
        },
        undoSnapshot: {
          version: 1,
          createdSessions: createdSnapshots,
          deletedSessions: deletedSnapshots,
        },
      });
      return { written, audit };
    });

    const affectedExerciseIds = [
      ...deleteRows.flatMap((row) => [
        ...row.sets.map((set) => set.exerciseId),
        ...row.exerciseMemberships.map((membership) => membership.exerciseId),
      ]),
      ...committed.written.flatMap((row) => row.exerciseIds),
    ];
    await rederiveHistoricalWorkoutGoals(userId, affectedExerciseIds);

    const imported = committed.written.map(formatHistoricalWorkoutResult);
    const deleted = deleteRows.map((row) => ({
      sessionId: row.id,
      date: (row.historicalDate ?? row.startedAt).toISOString().slice(0, 10),
      timePrecision: row.timePrecision,
      gym: row.gym,
      setCount: row.sets.length,
      exerciseCount: new Set([
        ...row.sets.map((set) => set.exerciseId),
        ...row.exerciseMemberships.map((membership) => membership.exerciseId),
      ]).size,
    }));
    const dates = [...new Set([
      ...deleted.map((row) => row.date),
      ...imported.map((row) => row.date),
    ])];
    const finalConflicts = dates.length
      ? await analyzeMcpWorkoutConflicts(userId, { dates })
      : null;

    return {
      ok: true,
      status: 'RECONCILED' as const,
      operationId: committed.audit.operationId,
      operationCreatedAt: committed.audit.createdAt,
      recoverable: true,
      reason,
      atomic: true,
      deletedCount: deleted.length,
      importedCount: imported.filter((row) => row.created).length,
      idempotentReplayCount: imported.filter((row) => row.idempotentReplay).length,
      deleted,
      workouts: imported,
      finalConflicts: finalConflicts?.status === 'READY' ? finalConflicts.findings : [],
      verificationDates: dates,
    };
  } catch (error) {
    return {
      ok: false,
      status: 'ROLLED_BACK' as const,
      atomic: true,
      deletedCount: 0,
      importedCount: 0,
      issues: [asMcpIssue(error)],
      previewConflicts: preview.conflicts,
    };
  }
}
