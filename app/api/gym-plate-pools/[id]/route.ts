import { NextResponse } from 'next/server';
import { ApiError, handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';
import { db } from '@/lib/db';
import { deleteOwnedGymPlatePool, upsertOwnedGymPlatePool } from '@/lib/gym-plate-pools';
import { databaseIdSchema, gymPlatePoolInputSchema } from '@/lib/schemas/gym-equipment';

interface Params { params: Promise<{ id: string }> }

export async function PUT(req: Request, props: Params) {
  try {
    const userId = await requireApiUserId();
    const { id } = await props.params;
    const parsed = databaseIdSchema.safeParse(id);
    if (!parsed.success) throw new ApiError(400, 'Invalid plate pool id.');
    const current = await db.gymPlatePool.findFirst({
      where: { id: parsed.data, gym: { userId } },
      select: { id: true, gymId: true },
    });
    if (!current) throw new ApiError(404, 'Gym plate pool not found.');
    const input = await parseJsonBody(req, gymPlatePoolInputSchema);
    if (input.poolId && input.poolId !== current.id) {
      throw new ApiError(400, 'Plate pool id does not match the route.');
    }
    return NextResponse.json(
      await upsertOwnedGymPlatePool(userId, current.gymId, { ...input, poolId: current.id }),
    );
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(_req: Request, props: Params) {
  try {
    const userId = await requireApiUserId();
    const { id } = await props.params;
    const parsed = databaseIdSchema.safeParse(id);
    if (!parsed.success) throw new ApiError(400, 'Invalid plate pool id.');
    await deleteOwnedGymPlatePool(userId, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
