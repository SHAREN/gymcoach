import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ApiError, handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';
import { deleteOwnedGymEquipment, upsertOwnedGymEquipment } from '@/lib/gym-equipment';
import { gymEquipmentInputSchema } from '@/lib/schemas/gym-equipment';

interface Params {
  params: Promise<{ id: string }>;
}

export async function PUT(req: Request, props: Params) {
  const { id } = await props.params;
  try {
    const userId = await requireApiUserId();
    const current = await db.gymEquipment.findFirst({
      where: { id, gym: { userId } },
      select: { gymId: true },
    });
    if (!current) throw new ApiError(404, 'Gym equipment not found.');
    const parsed = await parseJsonBody(req, gymEquipmentInputSchema);
    const { equipmentId: _ignored, ...input } = parsed;
    return NextResponse.json(
      await upsertOwnedGymEquipment(userId, current.gymId, { ...input, equipmentId: id }),
    );
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(_req: Request, props: Params) {
  const { id } = await props.params;
  try {
    const userId = await requireApiUserId();
    return NextResponse.json(await deleteOwnedGymEquipment(userId, id));
  } catch (err) {
    return handleApiError(err);
  }
}
