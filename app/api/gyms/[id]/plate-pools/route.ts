import { NextResponse } from 'next/server';
import { handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';
import { upsertOwnedGymPlatePool } from '@/lib/gym-equipment';
import { gymPlatePoolInputSchema } from '@/lib/schemas/gym-equipment';

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, props: Params) {
  const { id } = await props.params;
  try {
    const userId = await requireApiUserId();
    const input = await parseJsonBody(req, gymPlatePoolInputSchema.omit({ poolId: true }));
    return NextResponse.json(await upsertOwnedGymPlatePool(userId, id, input), { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
