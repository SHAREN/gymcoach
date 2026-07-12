import { Buffer } from 'node:buffer';
import { db } from '@/lib/db';
import { ApiError, handleApiError, requireApiUserId } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, props: Params) {
  try {
    const userId = await requireApiUserId();
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
