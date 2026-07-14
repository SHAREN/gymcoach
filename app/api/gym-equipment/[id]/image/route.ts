import { Buffer } from 'node:buffer';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ApiError, handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';
import {
  decodeGymEquipmentImage,
  setOwnedGymEquipmentImage,
} from '@/lib/gym-equipment';
import { gymEquipmentImageSchema } from '@/lib/schemas/gym-equipment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

async function requireOwnedEquipment(id: string, userId: string) {
  const equipment = await db.gymEquipment.findFirst({
    where: { id, gym: { userId } },
    select: { id: true },
  });
  if (!equipment) throw new ApiError(404, 'Gym equipment not found.');
}

export async function GET(req: Request, props: Params) {
  try {
    const userId = await requireApiUserId(req);
    const { id } = await props.params;
    const equipment = await db.gymEquipment.findFirst({
      where: { id, gym: { userId } },
      select: { imageData: true, imageMimeType: true, updatedAt: true },
    });
    if (!equipment?.imageData || !equipment.imageMimeType) {
      throw new ApiError(404, 'Equipment image not found.');
    }
    const bytes = Buffer.from(equipment.imageData);
    return new Response(bytes, {
      headers: {
        'Content-Type': equipment.imageMimeType,
        'Content-Length': String(bytes.byteLength),
        'Cache-Control': 'private, max-age=3600',
        'Last-Modified': equipment.updatedAt.toUTCString(),
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(req: Request, props: Params) {
  try {
    const userId = await requireApiUserId(req);
    const { id } = await props.params;
    await requireOwnedEquipment(id, userId);
    const input = await parseJsonBody(req, gymEquipmentImageSchema, {
      maxBytes: 7_110_000,
    });
    if (input.imageBase64) {
      try {
        decodeGymEquipmentImage(input.imageBase64, input.mimeType);
      } catch (error) {
        throw new ApiError(400, error instanceof Error ? error.message : 'Invalid image.');
      }
    }
    const equipment = await setOwnedGymEquipmentImage(userId, id, input);
    return NextResponse.json({ equipment });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(req: Request, props: Params) {
  try {
    const userId = await requireApiUserId(req);
    const { id } = await props.params;
    await requireOwnedEquipment(id, userId);
    const equipment = await setOwnedGymEquipmentImage(userId, id, { clear: true });
    return NextResponse.json({ equipment });
  } catch (err) {
    return handleApiError(err);
  }
}
