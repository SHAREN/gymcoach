import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ApiError, handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';
import { getOwnedGymInventory } from '@/lib/gym-equipment';
import { gymInventoryModeUpdateSchema } from '@/lib/schemas/gym-equipment';

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(req: Request, props: Params) {
  const { id } = await props.params;
  try {
    const userId = await requireApiUserId();
    return NextResponse.json(await getOwnedGymInventory(userId, new URL(req.url).origin, id));
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(req: Request, props: Params) {
  const { id } = await props.params;
  try {
    const userId = await requireApiUserId();
    const input = await parseJsonBody(req, gymInventoryModeUpdateSchema);
    const result = await db.gym.updateMany({
      where: { id, userId },
      data: { inventoryMode: input.inventoryMode },
    });
    if (result.count !== 1) throw new ApiError(404, 'Gym not found.');
    return NextResponse.json({ ok: true, inventoryMode: input.inventoryMode });
  } catch (err) {
    return handleApiError(err);
  }
}
