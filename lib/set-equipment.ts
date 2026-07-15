import { ApiError } from '@/lib/api';
import { Prisma } from '@/lib/prisma-client';

type EquipmentReader = Pick<Prisma.TransactionClient, 'gymEquipment'>;

export interface SetEquipmentSnapshot {
  gymEquipmentId: string | null;
  equipmentNameSnapshot: string | null;
  selectedLoadKg: number | null;
  selectedLoadMultiplierSnapshot: number | null;
  nominalResistanceKg: number | null;
  equipmentLoadSnapshot: Prisma.InputJsonValue | typeof Prisma.JsonNull;
}

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
  const multiplier = round(equipment.selectedLoadMultiplier);
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

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
