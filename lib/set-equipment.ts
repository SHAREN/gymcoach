import { ApiError } from '@/lib/api';
import { Prisma, type Set } from '@/lib/prisma-client';

type EquipmentReader = Pick<Prisma.TransactionClient, 'gymEquipment'>;

export interface SetEquipmentSnapshot {
  gymEquipmentId: string | null;
  equipmentNameSnapshot: string | null;
  selectedLoadKg: number | null;
  selectedLoadMultiplierSnapshot: number | null;
  nominalResistanceKg: number | null;
  equipmentLoadSnapshot: Prisma.InputJsonValue | typeof Prisma.JsonNull;
}

export type SetEquipmentSnapshotAction = 'REPLACE' | 'CLEAR';

type StoredSetEquipmentSnapshot = Pick<
  Set,
  | 'gymEquipmentId'
  | 'equipmentNameSnapshot'
  | 'selectedLoadKg'
  | 'selectedLoadMultiplierSnapshot'
  | 'nominalResistanceKg'
  | 'equipmentLoadSnapshot'
>;

export async function resolveSetEquipmentSnapshot(
  client: EquipmentReader,
  input: {
    userId: string;
    sessionGymId: string | null;
    exerciseId: string;
    gymEquipmentId?: string | null;
    selectedLoadKg: number;
  },
): Promise<SetEquipmentSnapshot> {
  if (!input.gymEquipmentId) {
    return {
      gymEquipmentId: null,
      equipmentNameSnapshot: null,
      selectedLoadKg: null,
      selectedLoadMultiplierSnapshot: null,
      nominalResistanceKg: null,
      equipmentLoadSnapshot: Prisma.JsonNull,
    };
  }

  const equipment = await client.gymEquipment.findFirst({
    where: {
      id: input.gymEquipmentId,
      gym: { userId: input.userId },
      exerciseLinks: { some: { exerciseId: input.exerciseId } },
    },
    select: {
      id: true,
      gymId: true,
      name: true,
      equipmentType: true,
      loadType: true,
      selectedLoadMultiplier: true,
      baseLoadKg: true,
      loadingSides: true,
      platePool: { select: { id: true, name: true, compatibilityKey: true } },
    },
  });
  if (!equipment) {
    throw new ApiError(400, 'Equipment is not available for this exercise.');
  }
  if (!input.sessionGymId || equipment.gymId !== input.sessionGymId) {
    throw new ApiError(400, 'Equipment must belong to the gym frozen on this session.');
  }

  const selectedLoadKg = round(input.selectedLoadKg);
  const multiplier = equipment.selectedLoadMultiplier;
  const nominalResistanceKg =
    equipment.loadType === 'SELECTORIZED' ? round(selectedLoadKg * multiplier) : null;
  const snapshot = {
    version: 1,
    loadType: equipment.loadType,
    equipmentType: equipment.equipmentType,
    selectedLoadKg,
    selectedLoadMultiplier: multiplier,
    nominalResistanceKg,
    baseLoadKg: equipment.baseLoadKg,
    loadingSides: equipment.loadingSides,
    platePool: equipment.platePool,
  } satisfies Prisma.InputJsonObject;

  return {
    gymEquipmentId: equipment.id,
    equipmentNameSnapshot: equipment.name,
    selectedLoadKg,
    selectedLoadMultiplierSnapshot: multiplier,
    nominalResistanceKg,
    equipmentLoadSnapshot: snapshot,
  };
}

export async function resolveSetEquipmentUpdate(
  client: EquipmentReader,
  input: {
    userId: string;
    sessionGymId: string | null;
    exerciseId: string;
    selectedLoadKg: number;
    existing: StoredSetEquipmentSnapshot | null;
    requestedGymEquipmentId?: string | null;
    action?: SetEquipmentSnapshotAction;
  },
): Promise<SetEquipmentSnapshot> {
  if (!input.existing) {
    if (input.action === 'CLEAR') return emptySetEquipmentSnapshot();
    return resolveSetEquipmentSnapshot(client, {
      userId: input.userId,
      sessionGymId: input.sessionGymId,
      exerciseId: input.exerciseId,
      gymEquipmentId: input.requestedGymEquipmentId,
      selectedLoadKg: input.selectedLoadKg,
    });
  }

  if (input.action === 'CLEAR') {
    if (input.requestedGymEquipmentId) {
      throw new ApiError(400, 'CLEAR equipment snapshot action cannot include equipment.');
    }
    return emptySetEquipmentSnapshot();
  }
  if (input.action === 'REPLACE') {
    if (!input.requestedGymEquipmentId) {
      throw new ApiError(400, 'REPLACE equipment snapshot action requires equipment.');
    }
    return resolveSetEquipmentSnapshot(client, {
      userId: input.userId,
      sessionGymId: input.sessionGymId,
      exerciseId: input.exerciseId,
      gymEquipmentId: input.requestedGymEquipmentId,
      selectedLoadKg: input.selectedLoadKg,
    });
  }

  if (
    input.requestedGymEquipmentId !== undefined &&
    input.requestedGymEquipmentId !== input.existing.gymEquipmentId
  ) {
    throw new ApiError(
      400,
      'Changing set equipment requires equipmentSnapshotAction REPLACE or CLEAR.',
    );
  }
  return preserveSetEquipmentSnapshot(input.existing, input.selectedLoadKg);
}

export function preserveSetEquipmentSnapshot(
  existing: StoredSetEquipmentSnapshot,
  selectedLoadKg: number,
): SetEquipmentSnapshot {
  const hasSnapshot =
    existing.equipmentNameSnapshot != null ||
    existing.selectedLoadKg != null ||
    existing.selectedLoadMultiplierSnapshot != null ||
    existing.nominalResistanceKg != null ||
    existing.equipmentLoadSnapshot != null;
  if (!hasSnapshot) return emptySetEquipmentSnapshot();

  const selected = round(selectedLoadKg);
  const selectorized =
    snapshotLoadType(existing.equipmentLoadSnapshot) === 'SELECTORIZED' ||
    existing.nominalResistanceKg != null;
  const nominalResistanceKg =
    selectorized && existing.selectedLoadMultiplierSnapshot != null
      ? round(selected * existing.selectedLoadMultiplierSnapshot)
      : existing.nominalResistanceKg;
  return {
    gymEquipmentId: existing.gymEquipmentId,
    equipmentNameSnapshot: existing.equipmentNameSnapshot,
    selectedLoadKg: selected,
    selectedLoadMultiplierSnapshot: existing.selectedLoadMultiplierSnapshot,
    nominalResistanceKg,
    equipmentLoadSnapshot: updateMutableLoadFacts(
      existing.equipmentLoadSnapshot,
      selected,
      nominalResistanceKg,
    ),
  };
}

export function emptySetEquipmentSnapshot(): SetEquipmentSnapshot {
  return {
    gymEquipmentId: null,
    equipmentNameSnapshot: null,
    selectedLoadKg: null,
    selectedLoadMultiplierSnapshot: null,
    nominalResistanceKg: null,
    equipmentLoadSnapshot: Prisma.JsonNull,
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function snapshotLoadType(snapshot: Prisma.JsonValue | null): string | null {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  return typeof snapshot.loadType === 'string' ? snapshot.loadType : null;
}

function updateMutableLoadFacts(
  snapshot: Prisma.JsonValue | null,
  selectedLoadKg: number,
  nominalResistanceKg: number | null,
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return snapshot == null ? Prisma.JsonNull : (snapshot as Prisma.InputJsonValue);
  }
  return {
    ...snapshot,
    selectedLoadKg,
    nominalResistanceKg,
  } as Prisma.InputJsonObject;
}
