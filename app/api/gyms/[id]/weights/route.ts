import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ApiError, handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';
import { gymWeightUpdateSchema } from '@/lib/schemas/gym';
import { resolveEquipmentType } from '@/lib/gym-loads';

interface Params {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: Request, props: Params) {
  const { id } = await props.params;
  try {
    const userId = await requireApiUserId(req);
    const input = await parseJsonBody(req, gymWeightUpdateSchema);
    const [gym, exercise] = await Promise.all([
      db.gym.findFirst({ where: { id, userId }, select: { id: true } }),
      db.exercise.findFirst({
        where: { id: input.exerciseId, userId },
        select: { id: true, name: true, equipmentType: true },
      }),
    ]);
    if (!gym) throw new ApiError(404, 'Gym not found.');
    if (!exercise) throw new ApiError(400, 'Invalid exercise.');

    const equipmentType = resolveEquipmentType(exercise.equipmentType, exercise.name);
    await db.$transaction(async (tx) => {
      if (input.scope === 'equipment') {
        if (equipmentType === 'BARBELL') {
          await tx.gym.update({
            where: { id },
            data: { barWeights: input.barWeights, plateWeights: input.plateWeights },
          });
          return;
        }
        if (equipmentType === 'DUMBBELL') {
          await tx.gym.update({
            where: { id },
            data: { dumbbellWeights: input.dumbbellWeights },
          });
          return;
        }
        throw new ApiError(
          400,
          'Shared weight settings are only available for barbells and dumbbells.',
        );
      }

      const overrides =
        equipmentType === 'BARBELL'
          ? { barWeights: input.barWeights, plateWeights: input.plateWeights }
          : equipmentType === 'DUMBBELL'
            ? { dumbbellWeights: input.dumbbellWeights }
            : { weightOptions: input.weightOptions };
      await tx.gymExerciseConfig.upsert({
        where: { gymId_exerciseId: { gymId: id, exerciseId: exercise.id } },
        update: overrides,
        create: { gymId: id, exerciseId: exercise.id, ...overrides },
      });
    });

    const updated = await db.gym.findUnique({
      where: { id },
      include: { exerciseConfigs: true },
    });
    return NextResponse.json(updated);
  } catch (err) {
    return handleApiError(err);
  }
}
