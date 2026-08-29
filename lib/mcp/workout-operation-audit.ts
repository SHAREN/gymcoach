import { db } from '@/lib/db';
import { Prisma } from '@/lib/prisma-client';
import type { Prisma as PrismaTypes } from '@/lib/prisma-client';
import { rederiveHistoricalWorkoutGoals } from '@/lib/mcp/historical-workout-import';

export interface StoredSetSnapshot {
  id: string;
  sessionId: string;
  exerciseId: string;
  gymEquipmentId: string | null;
  equipmentNameSnapshot: string | null;
  selectedLoadKg: number | null;
  selectedLoadMultiplierSnapshot: number | null;
  nominalResistanceKg: number | null;
  equipmentLoadSnapshot: PrismaTypes.JsonValue | null;
  setNumber: number;
  weight: number;
  reps: number;
  repsKnown: boolean;
  loadBasis: 'TOTAL' | 'PER_SIDE' | 'PER_HAND' | 'STACK_DISPLAY' | 'PLATE_PER_SIDE';
  rir: number | null;
  durationSec: number | null;
  distanceM: number | null;
  avgHr: number | null;
  maxHr: number | null;
  track: PrismaTypes.JsonValue | null;
  notes: string | null;
  isWarmup: boolean;
  isDropSet: boolean;
  recoverySec: number | null;
  completedAt: string;
}

export interface StoredMembershipSnapshot {
  sessionId: string;
  exerciseId: string;
  addedAt: string;
  ordinal: number;
}

export interface StoredSessionSnapshot {
  id: string;
  userId: string;
  programId: string | null;
  workoutId: string | null;
  startedAt: string;
  finishedAt: string | null;
  historicalDate: string | null;
  timePrecision: 'EXACT' | 'DATE_ONLY';
  notes: string | null;
  sessionRpe: number | null;
  gymId: string | null;
  sets: StoredSetSnapshot[];
  exerciseMemberships: StoredMembershipSnapshot[];
}

export interface WorkoutUndoSnapshot {
  version: 1;
  createdSessions: StoredSessionSnapshot[];
  deletedSessions: StoredSessionSnapshot[];
}

export async function captureOwnedSessionSnapshots(
  tx: PrismaTypes.TransactionClient,
  userId: string,
  sessionIds: string[],
): Promise<StoredSessionSnapshot[]> {
  const ids = [...new Set(sessionIds)];
  if (ids.length === 0) return [];
  const rows = await tx.session.findMany({
    where: { userId, id: { in: ids } },
    orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
    include: {
      sets: { orderBy: [{ setNumber: 'asc' }, { id: 'asc' }] },
      exerciseMemberships: { orderBy: [{ ordinal: 'asc' }, { exerciseId: 'asc' }] },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    programId: row.programId,
    workoutId: row.workoutId,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    historicalDate: row.historicalDate?.toISOString() ?? null,
    timePrecision: row.timePrecision,
    notes: row.notes,
    sessionRpe: row.sessionRpe,
    gymId: row.gymId,
    sets: row.sets.map((set) => ({
      id: set.id,
      sessionId: set.sessionId,
      exerciseId: set.exerciseId,
      gymEquipmentId: set.gymEquipmentId,
      equipmentNameSnapshot: set.equipmentNameSnapshot,
      selectedLoadKg: set.selectedLoadKg,
      selectedLoadMultiplierSnapshot: set.selectedLoadMultiplierSnapshot,
      nominalResistanceKg: set.nominalResistanceKg,
      equipmentLoadSnapshot: set.equipmentLoadSnapshot,
      setNumber: set.setNumber,
      weight: set.weight,
      reps: set.reps,
      repsKnown: set.repsKnown,
      loadBasis: set.loadBasis,
      rir: set.rir,
      durationSec: set.durationSec,
      distanceM: set.distanceM,
      avgHr: set.avgHr,
      maxHr: set.maxHr,
      track: set.track,
      notes: set.notes,
      isWarmup: set.isWarmup,
      isDropSet: set.isDropSet,
      recoverySec: set.recoverySec,
      completedAt: set.completedAt.toISOString(),
    })),
    exerciseMemberships: row.exerciseMemberships.map((membership) => ({
      sessionId: membership.sessionId,
      exerciseId: membership.exerciseId,
      addedAt: membership.addedAt.toISOString(),
      ordinal: membership.ordinal,
    })),
  }));
}

export async function createWorkoutOperationAudit(
  tx: PrismaTypes.TransactionClient,
  input: {
    userId: string;
    operation: string;
    reason?: string | null;
    request?: unknown;
    result?: unknown;
    undoSnapshot: WorkoutUndoSnapshot;
  },
) {
  const row = await tx.mcpOperationAudit.create({
    data: {
      userId: input.userId,
      operation: input.operation,
      reason: input.reason ?? null,
      request: toInputJson(input.request ?? {}),
      result: toInputJson(input.result ?? {}),
      undoSnapshot: toInputJson(input.undoSnapshot),
    },
    select: { id: true, createdAt: true },
  });
  return { operationId: row.id, createdAt: row.createdAt.toISOString() };
}

export async function getMcpOperationAudit(userId: string, operationId: string) {
  const row = await db.mcpOperationAudit.findFirst({
    where: { id: operationId, userId },
    select: {
      id: true,
      operation: true,
      reason: true,
      request: true,
      result: true,
      createdAt: true,
      undoneAt: true,
    },
  });
  if (!row) {
    return { ok: false, errorCode: 'OPERATION_NOT_FOUND', operationId } as const;
  }
  return {
    ok: true,
    operationId: row.id,
    operation: row.operation,
    reason: row.reason,
    request: row.request,
    result: row.result,
    createdAt: row.createdAt.toISOString(),
    undoneAt: row.undoneAt?.toISOString() ?? null,
    canUndo: row.undoneAt == null,
  } as const;
}

export async function undoMcpWorkoutOperation(userId: string, operationId: string) {
  let affectedExerciseIds: string[] = [];
  const result = await db.$transaction(async (tx) => {
    const audit = await tx.mcpOperationAudit.findFirst({
      where: { id: operationId, userId },
      select: {
        id: true,
        operation: true,
        undoneAt: true,
        undoSnapshot: true,
      },
    });
    if (!audit) {
      return { ok: false, status: 'NEEDS_RESOLUTION' as const, errorCode: 'OPERATION_NOT_FOUND', operationId };
    }
    if (audit.undoneAt) {
      return {
        ok: true,
        status: 'ALREADY_UNDONE' as const,
        operationId,
        undoneAt: audit.undoneAt.toISOString(),
      };
    }
    const snapshot = parseUndoSnapshot(audit.undoSnapshot);
    if (!snapshot) {
      return {
        ok: false,
        status: 'NEEDS_RESOLUTION' as const,
        errorCode: 'OPERATION_NOT_UNDOABLE',
        operationId,
      };
    }

    const createdIds = snapshot.createdSessions.map((row) => row.id);
    const currentCreated = await captureOwnedSessionSnapshots(tx, userId, createdIds);
    if (currentCreated.length !== createdIds.length || !sameSnapshots(currentCreated, snapshot.createdSessions)) {
      return {
        ok: false,
        status: 'NEEDS_RESOLUTION' as const,
        errorCode: 'UNDO_CREATED_SESSION_CHANGED',
        operationId,
        message: 'A session created by the original operation was changed or removed after that operation; undo was not applied.',
      };
    }

    const deletedIds = snapshot.deletedSessions.map((row) => row.id);
    const occupiedDeletedIds = deletedIds.length
      ? await tx.session.findMany({ where: { id: { in: deletedIds } }, select: { id: true } })
      : [];
    if (occupiedDeletedIds.length > 0) {
      return {
        ok: false,
        status: 'NEEDS_RESOLUTION' as const,
        errorCode: 'UNDO_SESSION_ID_CONFLICT',
        operationId,
        sessionIds: occupiedDeletedIds.map((row) => row.id),
      };
    }

    const referenceIssue = await validateRestoreReferences(tx, userId, snapshot.deletedSessions);
    if (referenceIssue) {
      return { ok: false, status: 'NEEDS_RESOLUTION' as const, operationId, ...referenceIssue };
    }

    affectedExerciseIds = [
      ...snapshot.createdSessions.flatMap((row) => row.sets.map((set) => set.exerciseId)),
      ...snapshot.deletedSessions.flatMap((row) => row.sets.map((set) => set.exerciseId)),
    ];

    if (createdIds.length > 0) {
      const deletedCreated = await tx.session.deleteMany({ where: { userId, id: { in: createdIds } } });
      if (deletedCreated.count !== createdIds.length) {
        throw new Error('Undo changed concurrently while removing sessions created by the original operation.');
      }
    }

    for (const session of snapshot.deletedSessions) {
      await restoreSessionSnapshot(tx, session);
    }

    const undoneAt = new Date();
    await tx.mcpOperationAudit.update({ where: { id: audit.id }, data: { undoneAt } });
    const undoAudit = await tx.mcpOperationAudit.create({
      data: {
        userId,
        operation: 'undo_operation',
        request: toInputJson({ operationId }),
        result: toInputJson({
          restoredSessionIds: deletedIds,
          removedCreatedSessionIds: createdIds,
        }),
      },
      select: { id: true },
    });

    return {
      ok: true,
      status: 'UNDONE' as const,
      operationId,
      undoOperationId: undoAudit.id,
      originalOperation: audit.operation,
      restoredSessionIds: deletedIds,
      removedCreatedSessionIds: createdIds,
      undoneAt: undoneAt.toISOString(),
    };
  });

  if (result.ok && result.status === 'UNDONE') {
    await rederiveHistoricalWorkoutGoals(userId, affectedExerciseIds);
  }
  return result;
}

async function validateRestoreReferences(
  tx: PrismaTypes.TransactionClient,
  userId: string,
  sessions: StoredSessionSnapshot[],
) {
  const exerciseIds = [...new Set(sessions.flatMap((row) => [
    ...row.sets.map((set) => set.exerciseId),
    ...row.exerciseMemberships.map((membership) => membership.exerciseId),
  ]))];
  const gymIds = [...new Set(sessions.flatMap((row) => (row.gymId ? [row.gymId] : [])))];
  const programIds = [...new Set(sessions.flatMap((row) => (row.programId ? [row.programId] : [])))];
  const workoutIds = [...new Set(sessions.flatMap((row) => (row.workoutId ? [row.workoutId] : [])))];
  const equipmentIds = [...new Set(sessions.flatMap((row) => row.sets.flatMap((set) => set.gymEquipmentId ? [set.gymEquipmentId] : [])))];

  const [exerciseCount, gymCount, programCount, workoutCount, equipmentCount] = await Promise.all([
    exerciseIds.length ? tx.exercise.count({ where: { userId, id: { in: exerciseIds } } }) : 0,
    gymIds.length ? tx.gym.count({ where: { userId, id: { in: gymIds } } }) : 0,
    programIds.length ? tx.program.count({ where: { userId, id: { in: programIds } } }) : 0,
    workoutIds.length ? tx.workout.count({ where: { program: { userId }, id: { in: workoutIds } } }) : 0,
    equipmentIds.length ? tx.gymEquipment.count({ where: { gym: { userId }, id: { in: equipmentIds } } }) : 0,
  ]);
  const missingKinds: string[] = [];
  if (exerciseCount !== exerciseIds.length) missingKinds.push('exercise');
  if (gymCount !== gymIds.length) missingKinds.push('gym');
  if (programCount !== programIds.length) missingKinds.push('program');
  if (workoutCount !== workoutIds.length) missingKinds.push('workout');
  if (equipmentCount !== equipmentIds.length) missingKinds.push('equipment');
  return missingKinds.length
    ? {
        errorCode: 'UNDO_REFERENCE_MISSING',
        message: 'One or more objects required to restore the deleted workout no longer exist.',
        missingKinds,
      }
    : null;
}

async function restoreSessionSnapshot(tx: PrismaTypes.TransactionClient, session: StoredSessionSnapshot) {
  await tx.session.create({
    data: {
      id: session.id,
      userId: session.userId,
      programId: session.programId,
      workoutId: session.workoutId,
      startedAt: new Date(session.startedAt),
      finishedAt: session.finishedAt ? new Date(session.finishedAt) : null,
      historicalDate: session.historicalDate ? new Date(session.historicalDate) : null,
      timePrecision: session.timePrecision,
      notes: session.notes,
      sessionRpe: session.sessionRpe,
      gymId: session.gymId,
    },
  });
  if (session.exerciseMemberships.length > 0) {
    await tx.sessionExercise.createMany({
      data: session.exerciseMemberships.map((membership) => ({
        sessionId: session.id,
        exerciseId: membership.exerciseId,
        addedAt: new Date(membership.addedAt),
        ordinal: membership.ordinal,
      })),
    });
  }
  if (session.sets.length > 0) {
    await tx.set.createMany({
      data: session.sets.map((set) => ({
        id: set.id,
        sessionId: session.id,
        exerciseId: set.exerciseId,
        gymEquipmentId: set.gymEquipmentId,
        equipmentNameSnapshot: set.equipmentNameSnapshot,
        selectedLoadKg: set.selectedLoadKg,
        selectedLoadMultiplierSnapshot: set.selectedLoadMultiplierSnapshot,
        nominalResistanceKg: set.nominalResistanceKg,
        equipmentLoadSnapshot: nullableJsonInput(set.equipmentLoadSnapshot),
        setNumber: set.setNumber,
        weight: set.weight,
        reps: set.reps,
        repsKnown: set.repsKnown,
        loadBasis: set.loadBasis,
        rir: set.rir,
        durationSec: set.durationSec,
        distanceM: set.distanceM,
        avgHr: set.avgHr,
        maxHr: set.maxHr,
        track: nullableJsonInput(set.track),
        notes: set.notes,
        isWarmup: set.isWarmup,
        isDropSet: set.isDropSet,
        recoverySec: set.recoverySec,
        completedAt: new Date(set.completedAt),
      })),
    });
  }
}

function nullableJsonInput(value: PrismaTypes.JsonValue | null) {
  return value === null ? Prisma.DbNull : (value as PrismaTypes.InputJsonValue);
}

function parseUndoSnapshot(value: PrismaTypes.JsonValue | null): WorkoutUndoSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1 || !Array.isArray(candidate.createdSessions) || !Array.isArray(candidate.deletedSessions)) {
    return null;
  }
  return candidate as unknown as WorkoutUndoSnapshot;
}

function sameSnapshots(a: StoredSessionSnapshot[], b: StoredSessionSnapshot[]) {
  return stableJson(a) === stableJson(b);
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortJson(nested)]),
  );
}

function toInputJson(value: unknown): PrismaTypes.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as PrismaTypes.InputJsonValue;
}
