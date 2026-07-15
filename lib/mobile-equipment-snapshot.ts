import { createHash } from 'node:crypto';
import { ApiError } from '@/lib/api';
import { resolveEquipmentLoadProfile } from '@/lib/gym-loads';
import { Prisma, type EquipmentLoadType, type EquipmentType } from '@/lib/prisma-client';
import type { MobileFrozenEquipmentSnapshot } from '@/lib/schemas/mobile';
import type { SetEquipmentSnapshot } from '@/lib/set-equipment';

interface EquipmentRevisionSource {
  id: string;
  gymId: string;
  name: string;
  equipmentType: EquipmentType;
  loadType: EquipmentLoadType;
  selectedLoadMultiplier: number;
  baseLoadKg: number;
  loadingSides: number;
  weightOptions: number[];
  exerciseLinks: { exerciseId: string }[];
  platePool: {
    id: string;
    name: string;
    compatibilityKey: string;
    plates: { weightKg: number; quantity: number | null }[];
  } | null;
}

type RevisionWriter = Pick<Prisma.TransactionClient, 'mobileEquipmentSnapshotRevision'>;
type RevisionReader = Pick<
  Prisma.TransactionClient,
  'mobileEquipmentSnapshotRevision' | 'gymEquipment'
>;

export async function ensureMobileEquipmentSnapshotRevision(
  client: RevisionWriter,
  equipment: EquipmentRevisionSource,
): Promise<string> {
  const selectedLoadMultiplier = equipment.selectedLoadMultiplier;
  const baseLoadKg = equipment.baseLoadKg;
  const weightOptions = [...equipment.weightOptions];
  const exerciseIds = [...new Set(equipment.exerciseLinks.map((link) => link.exerciseId))].sort();
  const platePool = equipment.platePool;
  const plates = [...(platePool?.plates ?? [])]
    .map((plate) => ({ weightKg: plate.weightKg, quantity: plate.quantity }))
    .sort((left, right) => left.weightKg - right.weightKg);
  const configHash = createHash('sha256')
    .update(
      JSON.stringify({
        equipmentNameSnapshot: equipment.name,
        equipmentType: equipment.equipmentType,
        loadType: equipment.loadType,
        selectedLoadMultiplier,
        baseLoadKg,
        loadingSides: equipment.loadingSides,
        weightOptions,
        platePool: platePool
          ? {
              id: platePool.id,
              name: platePool.name,
              compatibilityKey: platePool.compatibilityKey,
              plates,
            }
          : null,
        exerciseIds,
      }),
    )
    .digest('hex');

  const revision = await client.mobileEquipmentSnapshotRevision.upsert({
    where: {
      equipmentId_configHash: {
        equipmentId: equipment.id,
        configHash,
      },
    },
    update: {},
    create: {
      gymId: equipment.gymId,
      equipmentId: equipment.id,
      equipmentNameSnapshot: equipment.name,
      equipmentType: equipment.equipmentType,
      loadType: equipment.loadType,
      selectedLoadMultiplier,
      baseLoadKg,
      loadingSides: equipment.loadingSides,
      weightOptions,
      platePoolIdSnapshot: platePool?.id ?? null,
      platePoolNameSnapshot: platePool?.name ?? null,
      platePoolCompatibilityKeySnapshot: platePool?.compatibilityKey ?? null,
      plateInventorySnapshot: platePool ? plates : Prisma.JsonNull,
      exerciseIds,
      configHash,
    },
    select: { id: true },
  });
  return revision.id;
}

export async function resolveFrozenMobileSetEquipmentSnapshot(
  client: RevisionReader,
  input: {
    userId: string;
    sessionGymId: string | null;
    exerciseId: string;
    requestedGymEquipmentId?: string | null;
    snapshot: MobileFrozenEquipmentSnapshot;
  },
): Promise<SetEquipmentSnapshot> {
  const loadSnapshot = input.snapshot.equipmentLoadSnapshot;
  if (
    !input.sessionGymId ||
    !input.requestedGymEquipmentId ||
    input.requestedGymEquipmentId !== loadSnapshot.gymEquipmentId
  ) {
    throw invalidFrozenSnapshot();
  }

  const revision = await client.mobileEquipmentSnapshotRevision.findFirst({
    where: {
      id: loadSnapshot.revisionId,
      gymId: input.sessionGymId,
      gym: { userId: input.userId },
    },
  });
  if (
    !revision ||
    revision.equipmentId !== input.requestedGymEquipmentId ||
    !revision.exerciseIds.includes(input.exerciseId) ||
    revision.equipmentNameSnapshot !== input.snapshot.equipmentNameSnapshot ||
    revision.equipmentType !== loadSnapshot.equipmentType ||
    revision.loadType !== loadSnapshot.loadType ||
    revision.selectedLoadMultiplier !== input.snapshot.selectedLoadMultiplierSnapshot ||
    revision.selectedLoadMultiplier !== loadSnapshot.selectedLoadMultiplier ||
    revision.baseLoadKg !== loadSnapshot.baseLoadKg ||
    revision.loadingSides !== loadSnapshot.loadingSides ||
    !sameNumberArray(revision.weightOptions, loadSnapshot.weightOptions) ||
    !platePoolMatchesRevision(loadSnapshot.platePool, revision)
  ) {
    throw invalidFrozenSnapshot();
  }

  const plates = readPlateInventory(revision.plateInventorySnapshot);
  if (plates == null || !isAttainableFrozenLoad(input.snapshot.selectedLoadKg, revision, plates)) {
    throw invalidFrozenSnapshot();
  }

  const currentEquipment = await client.gymEquipment.findFirst({
    where: { id: revision.equipmentId, gymId: revision.gymId },
    select: { id: true },
  });

  return {
    // The live foreign key is optional and may already have been deleted. The
    // immutable original equipment ID remains inside the versioned JSON.
    gymEquipmentId: currentEquipment?.id ?? null,
    equipmentNameSnapshot: input.snapshot.equipmentNameSnapshot,
    selectedLoadKg: input.snapshot.selectedLoadKg,
    selectedLoadMultiplierSnapshot: input.snapshot.selectedLoadMultiplierSnapshot,
    nominalResistanceKg: input.snapshot.nominalResistanceKg,
    equipmentLoadSnapshot: loadSnapshot as Prisma.InputJsonObject,
  };
}

function platePoolMatchesRevision(
  platePool: MobileFrozenEquipmentSnapshot['equipmentLoadSnapshot']['platePool'],
  revision: {
    platePoolIdSnapshot: string | null;
    platePoolNameSnapshot: string | null;
    platePoolCompatibilityKeySnapshot: string | null;
    plateInventorySnapshot: Prisma.JsonValue | null;
  },
): boolean {
  if (!platePool) {
    return (
      revision.platePoolIdSnapshot == null &&
      revision.platePoolNameSnapshot == null &&
      revision.platePoolCompatibilityKeySnapshot == null
    );
  }
  return (
    platePool.id === revision.platePoolIdSnapshot &&
    platePool.name === revision.platePoolNameSnapshot &&
    platePool.compatibilityKey === revision.platePoolCompatibilityKeySnapshot &&
    samePlateInventory(platePool.plates, readPlateInventory(revision.plateInventorySnapshot))
  );
}

function isAttainableFrozenLoad(
  selectedLoadKg: number,
  revision: {
    equipmentId: string;
    equipmentNameSnapshot: string;
    equipmentType: EquipmentType;
    loadType: EquipmentLoadType;
    weightOptions: number[];
    selectedLoadMultiplier: number;
    baseLoadKg: number;
    loadingSides: number;
    platePoolIdSnapshot: string | null;
    platePoolNameSnapshot: string | null;
  },
  plates: { weightKg: number; quantity: number | null }[],
): boolean {
  if (revision.loadType === 'NONE') return true;
  const resolved = resolveEquipmentLoadProfile({
    equipmentId: revision.equipmentId,
    equipmentName: revision.equipmentNameSnapshot,
    equipmentType: revision.equipmentType,
    loadType: revision.loadType,
    weightOptions: revision.weightOptions,
    selectedLoadMultiplier: revision.selectedLoadMultiplier,
    baseLoadKg: revision.baseLoadKg,
    loadingSides: revision.loadingSides,
    platePoolId: revision.platePoolIdSnapshot,
    platePoolName: revision.platePoolNameSnapshot,
    plates,
  });
  return resolved.attainableLoads.includes(selectedLoadKg);
}

function readPlateInventory(
  value: Prisma.JsonValue | null,
): { weightKg: number; quantity: number | null }[] | null {
  if (value == null) return [];
  if (!Array.isArray(value)) return null;
  const plates: { weightKg: number; quantity: number | null }[] = [];
  for (const item of value) {
    if (
      !item ||
      typeof item !== 'object' ||
      Array.isArray(item) ||
      typeof item.weightKg !== 'number' ||
      (item.quantity !== null && typeof item.quantity !== 'number')
    ) {
      return null;
    }
    plates.push({ weightKg: item.weightKg, quantity: item.quantity });
  }
  return plates;
}

function sameNumberArray(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function samePlateInventory(
  left: { weightKg: number; quantity: number | null }[],
  right: { weightKg: number; quantity: number | null }[] | null,
): boolean {
  return (
    right != null &&
    left.length === right.length &&
    left.every(
      (plate, index) =>
        plate.weightKg === right[index]?.weightKg && plate.quantity === right[index]?.quantity,
    )
  );
}

function invalidFrozenSnapshot(): ApiError {
  return new ApiError(400, 'Frozen equipment snapshot is invalid for this session and exercise.');
}
