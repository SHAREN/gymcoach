import { handleApiError, parseJsonBody } from '@/lib/api';
import { db } from '@/lib/db';
import { requireMobileUserId } from '@/lib/mobile-programs-catalog';
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
    const data = await parseJsonBody(req, exerciseInputSchema);
    const exercise = await db.exercise.create({
      data: { ...data, userId, notes: data.notes ?? null },
    });
    return Response.json(exercise, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
