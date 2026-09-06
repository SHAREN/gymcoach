import { Prisma } from '@/prisma/generated/client';

type EquipmentReader = Pick<Prisma.TransactionClient, 'gymEquipment'>;

export interface SetEquipmentSnapshot {
  gymEquipmentId: string | null;
  equipmentNameSnapshot: string | null;
  equipmentLoadSnapshot: Prisma.InputJsonValue | typeof Prisma.JsonNull;
}

export async function resolveSetEquipmentSnapshot(
  client: EquipmentReader,
  input: {
    userId: string;
    sessionGymId: string | null;
    exerciseId: string;
    gymEquipmentId?: string | null;
  },
): Promise<SetEquipmentSnapshot> {
  if (!input.gymEquipmentId) return emptySetEquipmentSnapshot();

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
      manufacturer: true,
      modelName: true,
      loadConfigurationKnown: true,
      loadType: true,
      weightOptions: true,
      selectedLoadMultiplier: true,
      baseLoadKg: true,
      platePoolId: true,
      loadingSides: true,
      systemBarbellFamily: true,
      platePool: {
        select: {
          id: true,
          name: true,
          compatibilityKey: true,
          systemBarbellFamily: true,
          plates: {
            orderBy: { weightKg: 'asc' },
            select: { weightKg: true, quantity: true },
          },
        },
      },
    },
  });
  // Equipment is optional decoration on a training set. A stale/deleted,
  // unlinked, foreign, or wrong-gym reference must never make the actual
  // weight/reps/RIR fail to record. Drop the reference and preserve the set.
  if (!equipment || !input.sessionGymId || equipment.gymId !== input.sessionGymId) {
    return emptySetEquipmentSnapshot();
  }

  const loadFacts: Prisma.InputJsonObject = equipment.loadConfigurationKnown
    ? {
        state: 'KNOWN',
        loadType: equipment.loadType,
        weightOptions: equipment.weightOptions,
        selectedLoadMultiplier: equipment.selectedLoadMultiplier,
        baseLoadKg: equipment.baseLoadKg,
        loadingSides: equipment.loadingSides,
        platePool:
          equipment.platePool == null
            ? null
            : {
                id: equipment.platePool.id,
                name: equipment.platePool.name,
                compatibilityKey: equipment.platePool.compatibilityKey,
                systemBarbellFamily: equipment.platePool.systemBarbellFamily,
                plates: equipment.platePool.plates.map((plate) => ({
                  weightKg: plate.weightKg,
                  quantity: plate.quantity,
                })),
              },
      }
    : { state: 'UNKNOWN' };

  const snapshot = {
    version: 2,
    // Keep the original identity in the immutable snapshot too. The nullable
    // FK may later be cleared by ON DELETE SET NULL; replay can still prove
    // which physical item the original write referenced.
    gymEquipmentId: equipment.id,
    equipmentType: equipment.equipmentType,
    manufacturer: equipment.manufacturer,
    modelName: equipment.modelName,
    loadConfigurationKnown: equipment.loadConfigurationKnown,
    systemBarbellFamily: equipment.systemBarbellFamily,
    loadFacts,
  } satisfies Prisma.InputJsonObject;

  return {
    gymEquipmentId: equipment.id,
    equipmentNameSnapshot: equipment.name,
    equipmentLoadSnapshot: snapshot,
  };
}

export function emptySetEquipmentSnapshot(): SetEquipmentSnapshot {
  return {
    gymEquipmentId: null,
    equipmentNameSnapshot: null,
    equipmentLoadSnapshot: Prisma.JsonNull,
  };
}
