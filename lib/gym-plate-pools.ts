import { ApiError } from '@/lib/api';
import { db } from '@/lib/db';
import { rejectOwnedSystemPoolMutation } from '@/lib/gym-system-profiles';
import type { GymPlatePoolInput } from '@/lib/schemas/gym-equipment';

export async function listOwnedGymPlatePools(userId: string, gymId: string) {
  const gym = await db.gym.findFirst({ where: { id: gymId, userId }, select: { id: true } });
  if (!gym) throw new ApiError(404, 'Gym not found.');
  return db.gymPlatePool.findMany({
    where: { gymId },
    orderBy: [{ systemBarbellFamily: 'asc' }, { name: 'asc' }],
    include: { plates: { orderBy: { weightKg: 'asc' } } },
  });
}

export async function upsertOwnedGymPlatePool(
  userId: string,
  gymId: string,
  input: GymPlatePoolInput,
) {
  const gym = await db.gym.findFirst({ where: { id: gymId, userId }, select: { id: true } });
  if (!gym) throw new ApiError(404, 'Gym not found.');

  if (input.poolId) await rejectOwnedSystemPoolMutation(userId, input.poolId);

  const current = input.poolId
    ? await db.gymPlatePool.findFirst({
        where: { id: input.poolId, gymId, gym: { userId } },
        select: { id: true, systemBarbellFamily: true },
      })
    : null;
  if (input.poolId && !current) throw new ApiError(404, 'Gym plate pool not found.');

  const conflicts = await db.gymPlatePool.findFirst({
    where: {
      gymId,
      id: current ? { not: current.id } : undefined,
      OR: [{ name: input.name }, { compatibilityKey: input.compatibilityKey }],
    },
    select: { id: true },
  });
  if (conflicts) throw new ApiError(409, 'A plate pool with this name or compatibility key already exists.');

  return db.$transaction(async (tx) => {
    const pool = current
      ? await tx.gymPlatePool.update({
          where: { id: current.id },
          data: { name: input.name, compatibilityKey: input.compatibilityKey },
        })
      : await tx.gymPlatePool.create({
          data: { gymId, name: input.name, compatibilityKey: input.compatibilityKey },
        });

    await tx.gymPlateInventoryItem.deleteMany({ where: { poolId: pool.id } });
    if (input.plates.length > 0) {
      await tx.gymPlateInventoryItem.createMany({
        data: input.plates.map((plate) => ({
          poolId: pool.id,
          weightKg: plate.weightKg,
          quantity: plate.quantity,
        })),
      });
    }

    return tx.gymPlatePool.findUniqueOrThrow({
      where: { id: pool.id },
      include: { plates: { orderBy: { weightKg: 'asc' } } },
    });
  });
}

export async function deleteOwnedGymPlatePool(userId: string, poolId: string) {
  await rejectOwnedSystemPoolMutation(userId, poolId);
  const pool = await db.gymPlatePool.findFirst({
    where: { id: poolId, gym: { userId } },
    select: { id: true },
  });
  if (!pool) throw new ApiError(404, 'Gym plate pool not found.');

  const inUse = await db.gymEquipment.findFirst({
    where: { platePoolId: pool.id },
    select: { id: true },
  });
  if (inUse) throw new ApiError(409, 'A plate pool used by equipment cannot be deleted.');

  await db.gymPlatePool.delete({ where: { id: pool.id } });
}
