import { NextResponse } from 'next/server';
import { ApiError, handleApiError, requireApiUserId } from '@/lib/api';
import { getOwnedGymSystemProfiles } from '@/lib/gym-system-profiles';
import { databaseIdSchema } from '@/lib/schemas/gym-equipment';

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, props: Params) {
  try {
    const userId = await requireApiUserId();
    const { id } = await props.params;
    const parsed = databaseIdSchema.safeParse(id);
    if (!parsed.success) throw new ApiError(400, 'Invalid gym id.');
    return NextResponse.json(await getOwnedGymSystemProfiles(userId, parsed.data));
  } catch (err) {
    return handleApiError(err);
  }
}
