import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ApiError, handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';
import { exerciseEquipmentLinksSchema } from '@/lib/schemas/exercise';

interface Params {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: Request, props: Params) {
  const { id } = await props.params;
  try {
    const userId = await requireApiUserId();
    const input = await parseJsonBody(req, exerciseEquipmentLinksSchema);
    const exercise = await db.exercise.findFirst({ where: { id, userId }, select: { id: true } });
    if (!exercise) throw new ApiError(404, 'Exercise not found.');

    const ownedEquipment = await db.gymEquipment.findMany({
      where: { gym: { userId } },
      select: { id: true },
    });
    const ownedIds = new Set(ownedEquipment.map((item) => item.id));
    const requestedIds = [...new Set(input.equipmentIds)];
    if (requestedIds.some((equipmentId) => !ownedIds.has(equipmentId))) {
      throw new ApiError(400, 'One or more equipment IDs do not belong to the trainee.');
    }

    await db.$transaction(async (tx) => {
      if (ownedEquipment.length > 0) {
        await tx.gymEquipmentExercise.deleteMany({
          where: { exerciseId: id, equipmentId: { in: ownedEquipment.map((item) => item.id) } },
        });
      }
      if (requestedIds.length > 0) {
        await tx.gymEquipmentExercise.createMany({
          data: requestedIds.map((equipmentId) => ({ equipmentId, exerciseId: id })),
        });
      }
    });

    return NextResponse.json({ ok: true, equipmentIds: requestedIds });
  } catch (error) {
    return handleApiError(error);
  }
}
