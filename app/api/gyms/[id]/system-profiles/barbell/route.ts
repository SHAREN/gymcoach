import { NextResponse } from 'next/server';
import { ApiError, handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';
import { saveOwnedBarbellSystemProfile } from '@/lib/gym-system-profiles';
import {
  databaseIdSchema,
  gymBarbellSystemProfileInputSchema,
} from '@/lib/schemas/gym-equipment';

interface Params {
  params: Promise<{ id: string }>;
}

export async function PUT(req: Request, props: Params) {
  try {
    const userId = await requireApiUserId();
    const { id } = await props.params;
    const parsed = databaseIdSchema.safeParse(id);
    if (!parsed.success) throw new ApiError(400, 'Invalid gym id.');
    const input = await parseJsonBody(req, gymBarbellSystemProfileInputSchema);
    return NextResponse.json(await saveOwnedBarbellSystemProfile(userId, parsed.data, input));
  } catch (err) {
    return handleApiError(err);
  }
}
