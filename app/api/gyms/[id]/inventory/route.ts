import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ApiError, handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';
import {
  getOwnedGymInventory,
  reconcileAllLegacyExerciseConfigMirrorsForGym,
} from '@/lib/gym-equipment';
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
    await db.$transaction(async (tx) => {
      const gym = await tx.gym.findFirst({ where: { id, userId }, select: { id: true } });
      if (!gym) throw new ApiError(404, 'Gym not found.');
      await tx.gym.update({
        where: { id },
        data: { inventoryMode: input.inventoryMode },
      });
      await reconcileAllLegacyExerciseConfigMirrorsForGym(tx, id);
    });
    return NextResponse.json({ ok: true, inventoryMode: input.inventoryMode });
  } catch (err) {
    return handleApiError(err);
  }
}
