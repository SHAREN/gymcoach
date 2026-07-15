import { NextResponse } from 'next/server';
import { ApiError, handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';
import { db } from '@/lib/db';
import { getOwnedGymInventory, upsertOwnedGymEquipment } from '@/lib/gym-equipment';
import { gymEquipmentInputSchema } from '@/lib/schemas/gym-equipment';

interface Params {
  params: Promise<{ id: string }>;
}

async function requireOwnedGym(id: string, userId: string) {
  const gym = await db.gym.findFirst({ where: { id, userId }, select: { id: true } });
  if (!gym) throw new ApiError(404, 'Gym not found.');
}

export async function GET(req: Request, props: Params) {
  const { id } = await props.params;
  try {
    const userId = await requireApiUserId(req);
    await requireOwnedGym(id, userId);
    return NextResponse.json(await getOwnedGymInventory(userId, req.url, id));
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: Request, props: Params) {
  const { id } = await props.params;
  try {
    const userId = await requireApiUserId(req);
    await requireOwnedGym(id, userId);
    const parsed = await parseJsonBody(req, gymEquipmentInputSchema);
    const { equipmentId: _ignored, ...input } = parsed;
    const saved = await upsertOwnedGymEquipment(userId, id, input);
    return NextResponse.json(saved, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
