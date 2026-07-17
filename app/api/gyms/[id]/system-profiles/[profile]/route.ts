import { NextResponse } from 'next/server';
import { ApiError, handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';
import { db } from '@/lib/db';
import { getOwnedGymInventory } from '@/lib/gym-equipment';
import {
  saveOwnedBarbellSystemProfile,
  saveOwnedDumbbellsSystemProfile,
} from '@/lib/gym-system-profiles';
import {
  gymBarbellSystemProfileInputSchema,
  gymDumbbellsSystemProfileInputSchema,
} from '@/lib/schemas/gym-equipment';

interface Params {
  params: Promise<{ id: string; profile: string }>;
}

export async function PUT(req: Request, props: Params) {
  const { id, profile } = await props.params;
  try {
    const userId = await requireApiUserId(req);
    if (profile === 'dumbbells') {
      const input = await parseJsonBody(req, gymDumbbellsSystemProfileInputSchema);
      await saveOwnedDumbbellsSystemProfile(userId, id, input);
    } else if (profile === 'barbell') {
      const input = await parseJsonBody(req, gymBarbellSystemProfileInputSchema);
      await saveOwnedBarbellSystemProfile(userId, id, input);
    } else {
      throw new ApiError(404, 'System equipment profile not found.');
    }
    return NextResponse.json(await getOwnedGymInventory(userId, new URL(req.url).origin, id));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(req: Request, props: Params) {
  const { id, profile } = await props.params;
  try {
    const userId = await requireApiUserId(req);
    if (profile !== 'dumbbells' && profile !== 'barbell') {
      throw new ApiError(404, 'System equipment profile not found.');
    }
    const owned = await db.gym.count({ where: { id, userId } });
    if (owned === 0) throw new ApiError(404, 'Gym not found.');
    throw new ApiError(409, 'System equipment profiles cannot be deleted.');
  } catch (error) {
    return handleApiError(error);
  }
}
