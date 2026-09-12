import { db } from '@/lib/db';
import { resolveSetEquipmentSnapshot } from '@/lib/set-equipment';
import type { Prisma } from '@/lib/prisma-client';
import { createWorkoutOperationAudit } from '@/lib/mcp/workout-operation-audit';

export interface HistoricalEquipmentGapQuery {
  gymId?: string;
  exerciseId?: string;
  from?: Date;
  to?: Date;
  limit?: number;
}

export interface HistoricalEquipmentAssignment {
  equipmentId: string;
  setIds: string[];
}

const equipmentStateSelect = {
  id: true,
  gymEquipmentId: true,
  equipmentNameSnapshot: true,
  selectedLoadKg: true,
  selectedLoadMultiplierSnapshot: true,
  nominalResistanceKg: true,
  equipmentLoadSnapshot: true,
} satisfies Prisma.SetSelect;

export async function previewHistoricalEquipmentBackfill(
  userId: string,
  input: HistoricalEquipmentGapQuery,
) {
  const limit = Math.max(1, Math.min(input.limit ?? 500, 2000));
  const dateFilter = input.from || input.to
    ? {
        startedAt: {
          ...(input.from ? { gte: input.from } : {}),
          ...(input.to ? { lte: input.to } : {}),
        },
      }
    : {};

  const rows = await db.set.findMany({
    where: {
      gymEquipmentId: null,
      ...(input.exerciseId ? { exerciseId: input.exerciseId } : {}),
      session: {
        userId,
        ...(input.gymId ? { gymId: input.gymId } : {}),
        ...dateFilter,
      },
    },
    orderBy: [{ completedAt: 'asc' }, { id: 'asc' }],
    take: limit + 1,
    select: {
      id: true,
      setNumber: true,
      weight: true,
      reps: true,
      repsKnown: true,
      loadBasis: true,
      completedAt: true,
      exercise: { select: { id: true, name: true, equipmentType: true } },
      session: {
        select: {
          id: true,
          gymId: true,
          startedAt: true,
          historicalDate: true,
          timePrecision: true,
          gym: { select: { id: true, name: true } },
        },
      },
    },
  });

  const truncated = rows.length > limit;
  const gaps = rows.slice(0, limit);
  const gymIds = [...new Set(gaps.flatMap((row) => (row.session.gymId ? [row.session.gymId] : [])))];
  const exerciseIds = [...new Set(gaps.map((row) => row.exercise.id))];

  const [equipment, configs, assignedEvidence] = await Promise.all([
    gymIds.length && exerciseIds.length
      ? db.gymEquipment.findMany({
          where: {
            gymId: { in: gymIds },
            gym: { userId },
            exerciseLinks: { some: { exerciseId: { in: exerciseIds } } },
          },
          orderBy: [{ gymId: 'asc' }, { name: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            gymId: true,
            name: true,
            equipmentType: true,
            loadType: true,
            exerciseLinks: { select: { exerciseId: true } },
          },
        })
      : Promise.resolve([]),
    gymIds.length && exerciseIds.length
      ? db.gymExerciseConfig.findMany({
          where: { gymId: { in: gymIds }, exerciseId: { in: exerciseIds } },
          select: { gymId: true, exerciseId: true, preferredEquipmentId: true },
        })
      : Promise.resolve([]),
    gymIds.length && exerciseIds.length
      ? db.set.findMany({
          where: {
            gymEquipmentId: { not: null },
            exerciseId: { in: exerciseIds },
            session: { userId, gymId: { in: gymIds } },
          },
          orderBy: { completedAt: 'desc' },
          take: 5000,
          select: {
            exerciseId: true,
            gymEquipmentId: true,
            session: { select: { gymId: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  const groups = new Map<string, {
    gymId: string | null;
    gymName: string | null;
    exerciseId: string;
    exerciseName: string;
    equipmentType: string;
    missingSetIds: string[];
    examples: Array<Record<string, unknown>>;
  }>();

  for (const row of gaps) {
    const key = pairKey(row.session.gymId, row.exercise.id);
    const current = groups.get(key) ?? {
      gymId: row.session.gymId,
      gymName: row.session.gym?.name ?? null,
      exerciseId: row.exercise.id,
      exerciseName: row.exercise.name,
      equipmentType: row.exercise.equipmentType,
      missingSetIds: [],
      examples: [],
    };
    current.missingSetIds.push(row.id);
    if (current.examples.length < 8) {
      const date = (row.session.historicalDate ?? row.session.startedAt).toISOString().slice(0, 10);
      current.examples.push({
        setId: row.id,
        sessionId: row.session.id,
        date,
        setNumber: row.setNumber,
        weightKg: row.weight,
        reps: row.repsKnown ? row.reps : null,
        loadBasis: row.loadBasis,
        completedAt: row.session.timePrecision === 'DATE_ONLY' ? null : row.completedAt.toISOString(),
      });
    }
    groups.set(key, current);
  }

  const evidenceCounts = new Map<string, number>();
  for (const row of assignedEvidence) {
    if (!row.session.gymId || !row.gymEquipmentId) continue;
    const key = `${pairKey(row.session.gymId, row.exerciseId)}\u0000${row.gymEquipmentId}`;
    evidenceCounts.set(key, (evidenceCounts.get(key) ?? 0) + 1);
  }

  const serializedGroups = [...groups.values()].map((group) => {
    const candidates = equipment
      .filter(
        (item) =>
          item.gymId === group.gymId &&
          item.exerciseLinks.some((link) => link.exerciseId === group.exerciseId),
      )
      .map((item) => ({
        equipmentId: item.id,
        name: item.name,
        equipmentType: item.equipmentType,
        loadType: item.loadType,
        assignedHistoricalSetCount:
          evidenceCounts.get(`${pairKey(group.gymId, group.exerciseId)}\u0000${item.id}`) ?? 0,
      }));
    const preferredEquipmentId = configs.find(
      (config) => config.gymId === group.gymId && config.exerciseId === group.exerciseId,
    )?.preferredEquipmentId ?? null;
    const preferred = candidates.find((candidate) => candidate.equipmentId === preferredEquipmentId) ?? null;
    const mostUsed = [...candidates].sort(
      (left, right) => right.assignedHistoricalSetCount - left.assignedHistoricalSetCount,
    )[0] ?? null;
    const suggested =
      candidates.length === 1
        ? { ...candidates[0], reason: 'ONLY_LINKED_EQUIPMENT' as const }
        : preferred
          ? { ...preferred, reason: 'PREFERRED_EQUIPMENT' as const }
          : mostUsed && mostUsed.assignedHistoricalSetCount > 0
            ? { ...mostUsed, reason: 'MOST_USED_ASSIGNED_HISTORY' as const }
            : null;

    return {
      gym: group.gymId ? { id: group.gymId, name: group.gymName } : null,
      exercise: {
        id: group.exerciseId,
        name: group.exerciseName,
        equipmentType: group.equipmentType,
      },
      missingSetCount: group.missingSetIds.length,
      missingSetIds: group.missingSetIds,
      examples: group.examples,
      preferredEquipmentId,
      candidateEquipment: candidates,
      suggestedEquipment: suggested,
      suggestionIsConfirmation: false,
    };
  });

  return {
    ok: true as const,
    returnedMissingSets: gaps.length,
    truncated,
    limit,
    filters: {
      gymId: input.gymId ?? null,
      exerciseId: input.exerciseId ?? null,
      from: input.from?.toISOString() ?? null,
      to: input.to?.toISOString() ?? null,
    },
    groups: serializedGroups,
    guidance:
      'Suggestions are evidence for review, not authorization. Confirm the exact equipment mapping with the trainee before calling backfill_historical_equipment.',
  };
}

export async function backfillHistoricalEquipment(
  userId: string,
  assignments: HistoricalEquipmentAssignment[],
  reason: string | null,
) {
  const normalized = assignments.map((assignment) => ({
    equipmentId: assignment.equipmentId,
    setIds: [...new Set(assignment.setIds)],
  }));
  const requestedSetIds = normalized.flatMap((assignment) => assignment.setIds);
  const uniqueSetIds = [...new Set(requestedSetIds)];
  if (requestedSetIds.length !== uniqueSetIds.length) {
    return {
      ok: false as const,
      status: 'NEEDS_RESOLUTION' as const,
      errorCode: 'DUPLICATE_SET_ASSIGNMENT',
      message: 'A historical set may appear in only one equipment assignment.',
    };
  }

  const rows = await db.set.findMany({
    where: { id: { in: uniqueSetIds }, session: { userId } },
    select: {
      id: true,
      sessionId: true,
      exerciseId: true,
      weight: true,
      gymEquipmentId: true,
      session: { select: { gymId: true } },
    },
  });
  const found = new Set(rows.map((row) => row.id));
  const missingSetIds = uniqueSetIds.filter((id) => !found.has(id));
  if (missingSetIds.length > 0) {
    return {
      ok: false as const,
      status: 'NEEDS_RESOLUTION' as const,
      errorCode: 'SET_NOT_FOUND_OR_NOT_OWNED',
      missingSetIds,
    };
  }
  const alreadyAssigned = rows.filter((row) => row.gymEquipmentId != null);
  if (alreadyAssigned.length > 0) {
    return {
      ok: false as const,
      status: 'NEEDS_RESOLUTION' as const,
      errorCode: 'SET_ALREADY_HAS_EQUIPMENT',
      setIds: alreadyAssigned.map((row) => row.id),
      message: 'Backfill only fills missing historical equipment and never replaces an existing assignment.',
    };
  }

  const assignmentBySetId = new Map<string, string>();
  for (const assignment of normalized) {
    for (const setId of assignment.setIds) assignmentBySetId.set(setId, assignment.equipmentId);
  }

  const audit = await db.$transaction(async (tx) => {
    const currentRows = await tx.set.findMany({
      where: { id: { in: uniqueSetIds }, session: { userId } },
      orderBy: { id: 'asc' },
      select: {
        ...equipmentStateSelect,
        exerciseId: true,
        weight: true,
        session: { select: { gymId: true } },
      },
    });
    if (
      currentRows.length !== uniqueSetIds.length ||
      currentRows.some((row) => row.gymEquipmentId != null)
    ) {
      throw new Error('Historical equipment changed concurrently; the transaction was rolled back.');
    }
    const before = currentRows.map(({ exerciseId: _exerciseId, weight: _weight, session: _session, ...state }) => state);

    for (const row of currentRows) {
      const equipmentId = assignmentBySetId.get(row.id);
      if (!equipmentId) throw new Error(`Missing equipment assignment for set ${row.id}.`);
      const snapshot = await resolveSetEquipmentSnapshot(tx, {
        userId,
        sessionGymId: row.session.gymId,
        exerciseId: row.exerciseId,
        gymEquipmentId: equipmentId,
        selectedLoadKg: row.weight,
        snapshotVersion: 2,
      });
      await tx.set.update({
        where: { id: row.id },
        data: snapshot,
      });
    }

    const after = await tx.set.findMany({
      where: { id: { in: uniqueSetIds }, session: { userId } },
      orderBy: { id: 'asc' },
      select: equipmentStateSelect,
    });
    if (after.length !== uniqueSetIds.length) {
      throw new Error('Historical equipment changed concurrently; the transaction was rolled back.');
    }
    return createWorkoutOperationAudit(tx, {
      userId,
      operation: 'backfill_historical_equipment',
      reason,
      request: { assignments: normalized },
      result: { updatedSetIds: uniqueSetIds },
      undoSnapshot: {
        version: 2,
        kind: 'SET_EQUIPMENT_BACKFILL',
        before,
        after,
      },
    });
  });

  return {
    ok: true as const,
    status: 'BACKFILLED' as const,
    operationId: audit.operationId,
    operationCreatedAt: audit.createdAt,
    updatedSetCount: uniqueSetIds.length,
    updatedSetIds: uniqueSetIds,
    recoverable: true,
  };
}

function pairKey(gymId: string | null, exerciseId: string) {
  return `${gymId ?? '<no-gym>'}\u0000${exerciseId}`;
}
