import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ApiError, handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';
import { gymUpdateSchema } from '@/lib/schemas/gym';
import { validateGymExerciseConfigs } from '@/lib/gym-data';
import { ensureGymSystemProfiles } from '@/lib/gym-system-profiles';

interface Params {
  params: Promise<{ id: string }>;
}

async function requireOwnedGym(id: string, userId: string) {
  const gym = await db.gym.findFirst({ where: { id, userId } });
  if (!gym) throw new ApiError(404, 'Gym not found.');
  return gym;
}

export async function PUT(req: Request, props: Params) {
  const { id } = await props.params;
  try {
    const userId = await requireApiUserId(req);
    await requireOwnedGym(id, userId);
    const input = await parseJsonBody(req, gymUpdateSchema);
    const exerciseConfigs = input.exerciseConfigs
      ? await validateGymExerciseConfigs(userId, input.exerciseConfigs)
      : null;

    const updated = await db.$transaction(async (tx) => {
      if (exerciseConfigs) {
        const requestedIds = exerciseConfigs.map((config) => config.exerciseId);
        await tx.gymExerciseConfig.deleteMany({
          where: {
            gymId: id,
            isEquipmentMirror: false,
            preferredEquipmentId: null,
            systemProfileSupported: null,
            ...(requestedIds.length > 0 ? { exerciseId: { notIn: requestedIds } } : {}),
          },
        });
        for (const config of exerciseConfigs) {
          await tx.gymExerciseConfig.upsert({
            where: { gymId_exerciseId: { gymId: id, exerciseId: config.exerciseId } },
            update: {
              isAvailable: config.isAvailable,
              weightOptions: config.weightOptions,
              dumbbellWeights: config.dumbbellWeights,
              plateWeights: config.plateWeights,
              barWeights: config.barWeights,
              isEquipmentMirror: false,
            },
            create: { gymId: id, ...config, isEquipmentMirror: false },
          });
        }
      }
      await tx.gym.update({
        where: { id },
        data: {
          name: input.name,
          ...(input.inventoryMode ? { inventoryMode: input.inventoryMode } : {}),
          ...(input.dumbbellWeights ? { dumbbellWeights: input.dumbbellWeights } : {}),
          ...(input.plateWeights ? { plateWeights: input.plateWeights } : {}),
          ...(input.barWeights ? { barWeights: input.barWeights } : {}),
        },
      });
      await ensureGymSystemProfiles(tx, userId, id);
      return tx.gym.findUniqueOrThrow({
        where: { id },
        include: {
          exerciseConfigs: true,
          platePools: { include: { plates: { orderBy: { weightKg: 'asc' } } } },
          equipment: { include: { exerciseLinks: true, platePool: { include: { plates: true } } } },
        },
      });
    });
    return NextResponse.json(updated);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(req: Request, props: Params) {
  const { id } = await props.params;
  try {
    const userId = await requireApiUserId(req);
    await requireOwnedGym(id, userId);
    await db.$transaction(async (tx) => {
      await tx.gym.delete({ where: { id } });
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { activeGymId: true },
      });
      if (!user?.activeGymId) {
        const replacement = await tx.gym.findFirst({ where: { userId }, orderBy: { name: 'asc' } });
        if (replacement) {
          await tx.user.update({ where: { id: userId }, data: { activeGymId: replacement.id } });
        }
      }
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
