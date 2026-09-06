import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ApiError, handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';
import { gymUpdateSchema } from '@/lib/schemas/gym';
import { validateGymExerciseConfigs } from '@/lib/gym-data';

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
    const userId = await requireApiUserId();
    const currentGym = await requireOwnedGym(id, userId);
    const input = await parseJsonBody(req, gymUpdateSchema);
    const exerciseConfigs = await validateGymExerciseConfigs(userId, input.exerciseConfigs);

    if (
      (input.dumbbellWeights !== undefined &&
        !sameWeights(input.dumbbellWeights, currentGym.dumbbellWeights)) ||
      (input.plateWeights !== undefined &&
        !sameWeights(input.plateWeights, currentGym.plateWeights)) ||
      (input.barWeights !== undefined && !sameWeights(input.barWeights, currentGym.barWeights))
    ) {
      throw new ApiError(
        409,
        'Free-weight inventory must be edited through the permanent system profiles.',
      );
    }

    // Keep equipment preference/system-profile metadata on GymExerciseConfig. The gym editor owns
    // only isAvailable + weightOptions; omitted rows mean their legacy fields
    // return to implicit defaults, not that preferred/system metadata is erased.
    const updated = await db.$transaction(async (tx) => {
      const existingConfigs = await tx.gymExerciseConfig.findMany({
        where: { gymId: id, gym: { userId } },
        select: {
          id: true,
          exerciseId: true,
          preferredEquipmentId: true,
          systemProfileSupported: true,
        },
      });
      const requestedByExercise = new Map(
        exerciseConfigs.map((config) => [config.exerciseId, config]),
      );

      for (const config of exerciseConfigs) {
        await tx.gymExerciseConfig.upsert({
          where: { gymId_exerciseId: { gymId: id, exerciseId: config.exerciseId } },
          create: {
            gymId: id,
            exerciseId: config.exerciseId,
            isAvailable: config.isAvailable,
            weightOptions: config.weightOptions,
          },
          update: {
            isAvailable: config.isAvailable,
            weightOptions: config.weightOptions,
          },
        });
      }

      for (const current of existingConfigs) {
        if (requestedByExercise.has(current.exerciseId)) continue;
        if (current.preferredEquipmentId != null || current.systemProfileSupported != null) {
          await tx.gymExerciseConfig.update({
            where: { id: current.id },
            data: { isAvailable: true, weightOptions: [] },
          });
        } else {
          await tx.gymExerciseConfig.delete({ where: { id: current.id } });
        }
      }

      return tx.gym.update({
        where: { id, userId },
        data: { name: input.name },
        include: { exerciseConfigs: true },
      });
    });
    return NextResponse.json(updated);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(_req: Request, props: Params) {
  const { id } = await props.params;
  try {
    const userId = await requireApiUserId();
    await requireOwnedGym(id, userId);
    await db.$transaction(async (tx) => {
      await tx.gym.delete({ where: { id, userId } });
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

function sameWeights(left: number[], right: number[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
