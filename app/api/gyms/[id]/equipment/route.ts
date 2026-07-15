import { NextResponse } from 'next/server';
import { handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';
import { upsertOwnedGymEquipment } from '@/lib/gym-equipment';
import { gymEquipmentInputSchema } from '@/lib/schemas/gym-equipment';

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, props: Params) {
  const { id } = await props.params;
  try {
    const userId = await requireApiUserId();
    const parsed = await parseJsonBody(req, gymEquipmentInputSchema);
    const { equipmentId: _ignored, ...input } = parsed;
    const saved = await upsertOwnedGymEquipment(userId, id, input);
    return NextResponse.json(saved, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
