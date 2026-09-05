import { z } from 'zod';
import { NextResponse } from 'next/server';
import { ApiError, handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';
import { setOwnedExerciseEquipmentSelection } from '@/lib/gym-equipment';

interface Params {
  params: Promise<{ id: string }>;
}

const selectionSchema = z
  .object({
    gyms: z
      .array(
        z
          .object({
            gymId: z.string().trim().min(1).max(191),
            equipmentIds: z.array(z.string().trim().min(1).max(191)).max(100),
            preferredEquipmentId: z.string().trim().min(1).max(191).nullable(),
          })
          .strict(),
      )
      .max(50),
  })
  .strict();

export async function PATCH(req: Request, props: Params) {
  const { id } = await props.params;
  try {
    if (!id.trim()) throw new ApiError(400, 'Invalid exercise id.');
    const userId = await requireApiUserId();
    const input = await parseJsonBody(req, selectionSchema);
    return NextResponse.json(await setOwnedExerciseEquipmentSelection(userId, id, input.gyms));
  } catch (error) {
    return handleApiError(error);
  }
}
