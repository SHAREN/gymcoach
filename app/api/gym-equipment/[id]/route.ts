import { NextResponse } from 'next/server';
import { ApiError, handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';
import { db } from '@/lib/db';
import { upsertOwnedGymEquipment } from '@/lib/gym-equipment';
import { gymEquipmentUpsertSchema } from '@/lib/schemas/gym-equipment';

interface Params {
  params: Promise<{ id: string }>;
}

async function requireOwnedEquipment(id: string, userId: string) {
  const equipment = await db.gymEquipment.findFirst({
    where: { id, gym: { userId } },
    select: { id: true, gymId: true },
  });
  if (!equipment) throw new ApiError(404, 'Gym equipment not found.');
  return equipment;
}

export async function PUT(req: Request, props: Params) {
  const { id } = await props.params;
  try {
    const userId = await requireApiUserId(req);
    const equipment = await requireOwnedEquipment(id, userId);
    const input = await parseJsonBody(req, gymEquipmentUpsertSchema);
    const saved = await upsertOwnedGymEquipment(userId, equipment.gymId, {
      equipmentId: equipment.id,
      ...input,
    });
    return NextResponse.json(saved);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(req: Request, props: Params) {
  const { id } = await props.params;
  try {
    const userId = await requireApiUserId(req);
    const equipment = await requireOwnedEquipment(id, userId);
    await db.gymEquipment.delete({ where: { id: equipment.id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
