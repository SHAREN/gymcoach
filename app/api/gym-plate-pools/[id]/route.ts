import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ApiError, handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';
import { deleteOwnedGymPlatePool, upsertOwnedGymPlatePool } from '@/lib/gym-equipment';
import { gymPlatePoolInputSchema } from '@/lib/schemas/gym-equipment';

interface Params {
  params: Promise<{ id: string }>;
}

export async function PUT(req: Request, props: Params) {
  const { id } = await props.params;
  try {
    const userId = await requireApiUserId();
    const current = await db.gymPlatePool.findFirst({
      where: { id, gym: { userId } },
      select: { gymId: true },
    });
    if (!current) throw new ApiError(404, 'Gym plate pool not found.');
    const input = await parseJsonBody(req, gymPlatePoolInputSchema.omit({ poolId: true }));
    return NextResponse.json(
      await upsertOwnedGymPlatePool(userId, current.gymId, { ...input, poolId: id }),
    );
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(_req: Request, props: Params) {
  const { id } = await props.params;
  try {
    const userId = await requireApiUserId();
    return NextResponse.json(await deleteOwnedGymPlatePool(userId, id));
  } catch (err) {
    return handleApiError(err);
  }
}
