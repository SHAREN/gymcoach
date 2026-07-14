import { handleApiError, parseJsonBody } from '@/lib/api';
import { db } from '@/lib/db';
import { parseMobileCreateMetadata, requireMobileUserId } from '@/lib/mobile-programs-catalog';
import { exerciseInputSchema } from '@/lib/schemas/exercise';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const userId = await requireMobileUserId(req);
    return Response.json(
      await db.exercise.findMany({
        where: { userId },
        orderBy: [{ muscleGroup: 'asc' }, { name: 'asc' }],
      }),
    );
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const userId = await requireMobileUserId(req);
    const metadata = parseMobileCreateMetadata(req);
    const data = await parseJsonBody(req, exerciseInputSchema);
    if (metadata.clientEntityId) {
      const existing = await db.exercise.findUnique({ where: { id: metadata.clientEntityId } });
      if (existing) {
        if (existing.userId !== userId) {
          return Response.json({ error: 'Client entity id is already in use.' }, { status: 409 });
        }
        return Response.json(existing);
      }
    }
    const exercise = await db.exercise.create({
      data: {
        ...data,
        id: metadata.clientEntityId,
        userId,
        notes: data.notes ?? null,
      },
    });
    return Response.json(exercise, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
