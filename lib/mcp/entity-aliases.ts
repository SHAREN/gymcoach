import { db } from '@/lib/db';
import type { Prisma } from '@/lib/prisma-client';
import { normalizeEntityName } from '@/lib/mcp/entity-match';

export interface ExerciseAliasProposal {
  exerciseId: string;
  alias: string;
}

export interface EquipmentAliasProposal {
  gymId: string;
  equipmentId: string;
  alias: string;
}

export interface McpEntityAliasProposals {
  exercises?: ExerciseAliasProposal[];
  equipment?: EquipmentAliasProposal[];
}

export async function learnMcpEntityAliases(
  tx: Prisma.TransactionClient,
  userId: string,
  proposals: McpEntityAliasProposals,
) {
  const exerciseRows = dedupeExerciseAliases(proposals.exercises ?? []);
  const equipmentRows = dedupeEquipmentAliases(proposals.equipment ?? []);

  if (exerciseRows.length > 0) {
    await tx.exerciseAlias.createMany({
      data: exerciseRows.map((row) => ({
        userId,
        exerciseId: row.exerciseId,
        alias: row.alias,
        normalizedAlias: row.normalizedAlias,
      })),
      skipDuplicates: true,
    });
  }

  if (equipmentRows.length > 0) {
    await tx.gymEquipmentAlias.createMany({
      data: equipmentRows.map((row) => ({
        userId,
        gymId: row.gymId,
        equipmentId: row.equipmentId,
        alias: row.alias,
        normalizedAlias: row.normalizedAlias,
      })),
      skipDuplicates: true,
    });
  }
}

function dedupeExerciseAliases(rows: ExerciseAliasProposal[]) {
  const byAlias = new Map<
    string,
    { exerciseIds: Set<string>; row: { exerciseId: string; alias: string; normalizedAlias: string } }
  >();
  for (const row of rows) {
    const alias = row.alias.trim();
    const normalizedAlias = normalizeEntityName(alias);
    if (!alias || !normalizedAlias) continue;
    const existing = byAlias.get(normalizedAlias);
    if (existing) {
      existing.exerciseIds.add(row.exerciseId);
    } else {
      byAlias.set(normalizedAlias, {
        exerciseIds: new Set([row.exerciseId]),
        row: { exerciseId: row.exerciseId, alias, normalizedAlias },
      });
    }
  }
  return [...byAlias.values()].filter((entry) => entry.exerciseIds.size === 1).map((entry) => entry.row);
}

function dedupeEquipmentAliases(rows: EquipmentAliasProposal[]) {
  const byAlias = new Map<
    string,
    {
      equipmentIds: Set<string>;
      row: { gymId: string; equipmentId: string; alias: string; normalizedAlias: string };
    }
  >();
  for (const row of rows) {
    const alias = row.alias.trim();
    const normalizedAlias = normalizeEntityName(alias);
    if (!alias || !normalizedAlias) continue;
    const scopeKey = row.gymId + String.fromCharCode(0) + normalizedAlias;
    const existing = byAlias.get(scopeKey);
    if (existing) {
      existing.equipmentIds.add(row.equipmentId);
    } else {
      byAlias.set(scopeKey, {
        equipmentIds: new Set([row.equipmentId]),
        row: { gymId: row.gymId, equipmentId: row.equipmentId, alias, normalizedAlias },
      });
    }
  }
  return [...byAlias.values()].filter((entry) => entry.equipmentIds.size === 1).map((entry) => entry.row);
}

export async function listMcpExerciseAliases(userId: string) {
  const rows = await db.exerciseAlias.findMany({
    where: { userId },
    orderBy: [{ alias: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      alias: true,
      normalizedAlias: true,
      exercise: { select: { id: true, name: true } },
      createdAt: true,
      updatedAt: true,
    },
  });
  return { aliases: rows };
}

export async function upsertMcpExerciseAlias(userId: string, exerciseId: string, aliasInput: string) {
  const alias = aliasInput.trim();
  const normalizedAlias = normalizeEntityName(alias);
  if (!alias || !normalizedAlias) {
    return { status: 'ERROR', errorCode: 'INVALID_ALIAS', field: 'alias' } as const;
  }
  const exercise = await db.exercise.findFirst({
    where: { id: exerciseId, userId },
    select: { id: true, name: true },
  });
  if (!exercise) {
    return { status: 'ERROR', errorCode: 'EXERCISE_NOT_FOUND', field: 'exerciseId' } as const;
  }
  const row = await db.exerciseAlias.upsert({
    where: { userId_normalizedAlias: { userId, normalizedAlias } },
    create: { userId, exerciseId, alias, normalizedAlias },
    update: { exerciseId, alias },
    select: { id: true, alias: true, normalizedAlias: true, createdAt: true, updatedAt: true },
  });
  return { status: 'OK', alias: { ...row, exercise } } as const;
}

export async function deleteMcpExerciseAlias(userId: string, aliasInput: string) {
  const normalizedAlias = normalizeEntityName(aliasInput.trim());
  if (!normalizedAlias) {
    return { status: 'ERROR', errorCode: 'INVALID_ALIAS', field: 'alias' } as const;
  }
  const existing = await db.exerciseAlias.findUnique({
    where: { userId_normalizedAlias: { userId, normalizedAlias } },
    select: { id: true, alias: true, exercise: { select: { id: true, name: true } } },
  });
  if (!existing) {
    return { status: 'ERROR', errorCode: 'ALIAS_NOT_FOUND', field: 'alias' } as const;
  }
  await db.exerciseAlias.delete({ where: { id: existing.id } });
  return { status: 'OK', deleted: existing } as const;
}

export async function listMcpEquipmentAliases(userId: string, gymId?: string) {
  const rows = await db.gymEquipmentAlias.findMany({
    where: { userId, ...(gymId ? { gymId } : {}) },
    orderBy: [{ alias: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      alias: true,
      normalizedAlias: true,
      gym: { select: { id: true, name: true } },
      equipment: { select: { id: true, name: true, manufacturer: true, modelName: true } },
      createdAt: true,
      updatedAt: true,
    },
  });
  return { aliases: rows };
}

export async function upsertMcpEquipmentAlias(userId: string, equipmentId: string, aliasInput: string) {
  const alias = aliasInput.trim();
  const normalizedAlias = normalizeEntityName(alias);
  if (!alias || !normalizedAlias) {
    return { status: 'ERROR', errorCode: 'INVALID_ALIAS', field: 'alias' } as const;
  }
  const equipment = await db.gymEquipment.findFirst({
    where: { id: equipmentId, gym: { userId } },
    select: {
      id: true,
      name: true,
      manufacturer: true,
      modelName: true,
      gym: { select: { id: true, name: true } },
    },
  });
  if (!equipment) {
    return { status: 'ERROR', errorCode: 'EQUIPMENT_NOT_FOUND', field: 'equipmentId' } as const;
  }
  const row = await db.gymEquipmentAlias.upsert({
    where: {
      userId_gymId_normalizedAlias: {
        userId,
        gymId: equipment.gym.id,
        normalizedAlias,
      },
    },
    create: {
      userId,
      gymId: equipment.gym.id,
      equipmentId,
      alias,
      normalizedAlias,
    },
    update: { equipmentId, alias },
    select: { id: true, alias: true, normalizedAlias: true, createdAt: true, updatedAt: true },
  });
  return { status: 'OK', alias: { ...row, gym: equipment.gym, equipment } } as const;
}

export async function deleteMcpEquipmentAlias(userId: string, gymId: string, aliasInput: string) {
  const normalizedAlias = normalizeEntityName(aliasInput.trim());
  if (!normalizedAlias) {
    return { status: 'ERROR', errorCode: 'INVALID_ALIAS', field: 'alias' } as const;
  }
  const gym = await db.gym.findFirst({ where: { id: gymId, userId }, select: { id: true, name: true } });
  if (!gym) {
    return { status: 'ERROR', errorCode: 'GYM_NOT_FOUND', field: 'gymId' } as const;
  }
  const existing = await db.gymEquipmentAlias.findUnique({
    where: { userId_gymId_normalizedAlias: { userId, gymId, normalizedAlias } },
    select: {
      id: true,
      alias: true,
      equipment: { select: { id: true, name: true, manufacturer: true, modelName: true } },
    },
  });
  if (!existing) {
    return { status: 'ERROR', errorCode: 'ALIAS_NOT_FOUND', field: 'alias' } as const;
  }
  await db.gymEquipmentAlias.delete({ where: { id: existing.id } });
  return { status: 'OK', deleted: { ...existing, gym } } as const;
}
