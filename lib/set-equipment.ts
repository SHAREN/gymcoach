import { ApiError } from '@/lib/api';
import { Prisma, type Set } from '@/lib/prisma-client';
import { ensureMobileEquipmentSnapshotRevision } from '@/lib/mobile-equipment-snapshot';
import { resolveEquipmentLoadProfile } from '@/lib/gym-loads';
import { mobileFrozenEquipmentLoadSnapshotSchema } from '@/lib/schemas/mobile';

type EquipmentReader = Pick<
  Prisma.TransactionClient,
  'gymEquipment' | 'mobileEquipmentSnapshotRevision'
>;

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
      weightOptions: true,
      exerciseLinks: { select: { exerciseId: true } },
      platePool: {
        select: {
          id: true,
          name: true,
          compatibilityKey: true,
          plates: {
            orderBy: { weightKg: 'asc' },
            select: { weightKg: true, quantity: true },
          },
        },
      },
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
  const revisionId = await ensureMobileEquipmentSnapshotRevision(client, equipment);
  const snapshot = {
    version: 2,
    revisionId,
    gymEquipmentId: equipment.id,
    loadType: equipment.loadType,
    equipmentType: equipment.equipmentType,
    selectedLoadKg,
    selectedLoadMultiplier: multiplier,
    nominalResistanceKg,
    baseLoadKg: equipment.baseLoadKg,
    loadingSides: equipment.loadingSides,
    weightOptions: equipment.weightOptions,
    platePool: equipment.platePool
      ? {
          id: equipment.platePool.id,
          name: equipment.platePool.name,
          compatibilityKey: equipment.platePool.compatibilityKey,
          plates: equipment.platePool.plates,
        }
      : null,
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
  const frozenLoadSnapshot = requireSupportedFrozenLoadSnapshot(existing);
  const resolved = resolveEquipmentLoadProfile({
    equipmentId: frozenLoadSnapshot.gymEquipmentId,
    equipmentName: existing.equipmentNameSnapshot ?? frozenLoadSnapshot.gymEquipmentId,
    equipmentType: frozenLoadSnapshot.equipmentType,
    loadType: frozenLoadSnapshot.loadType,
    weightOptions: frozenLoadSnapshot.weightOptions,
    selectedLoadMultiplier: frozenLoadSnapshot.selectedLoadMultiplier,
    baseLoadKg: frozenLoadSnapshot.baseLoadKg,
    loadingSides: frozenLoadSnapshot.loadingSides,
    platePoolId: frozenLoadSnapshot.platePool?.id ?? null,
    platePoolName: frozenLoadSnapshot.platePool?.name ?? null,
    plates: frozenLoadSnapshot.platePool?.plates ?? [],
  });
  if (
    frozenLoadSnapshot.loadType !== 'NONE' &&
    !resolved.attainableLoads.includes(selected)
  ) {
    throw new ApiError(400, 'Selected weight is not attainable with the recorded equipment snapshot.');
  }
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

function requireSupportedFrozenLoadSnapshot(existing: StoredSetEquipmentSnapshot) {
  const parsed = mobileFrozenEquipmentLoadSnapshotSchema.safeParse(existing.equipmentLoadSnapshot);
  if (!parsed.success) {
    throw new ApiError(400, 'The recorded equipment snapshot is unsupported or invalid.');
  }
  if (
    existing.gymEquipmentId != null &&
    existing.gymEquipmentId !== parsed.data.gymEquipmentId
  ) {
    throw new ApiError(400, 'The recorded equipment snapshot does not match the set equipment.');
  }
  return parsed.data;
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
