import { NextResponse } from 'next/server';
import { ApiError, handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';
import { listOwnedGymPlatePools, upsertOwnedGymPlatePool } from '@/lib/gym-plate-pools';
import { databaseIdSchema, gymPlatePoolInputSchema } from '@/lib/schemas/gym-equipment';

interface Params { params: Promise<{ id: string }> }

export async function GET(_req: Request, props: Params) {
  try {
    const userId = await requireApiUserId();
    const { id } = await props.params;
    const parsed = databaseIdSchema.safeParse(id);
    if (!parsed.success) throw new ApiError(400, 'Invalid gym id.');
    return NextResponse.json({ pools: await listOwnedGymPlatePools(userId, parsed.data) });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: Request, props: Params) {
  try {
    const userId = await requireApiUserId();
    const { id } = await props.params;
    const parsed = databaseIdSchema.safeParse(id);
    if (!parsed.success) throw new ApiError(400, 'Invalid gym id.');
    const input = await parseJsonBody(req, gymPlatePoolInputSchema);
    if (input.poolId) throw new ApiError(400, 'New plate pools must not provide poolId.');
    const pool = await upsertOwnedGymPlatePool(userId, parsed.data, input);
    return NextResponse.json(pool, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
