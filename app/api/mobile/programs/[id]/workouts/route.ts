import { handleApiError, parseJsonBody } from '@/lib/api';
import { db } from '@/lib/db';
import { requireMobileUserId, requireOwnedProgram } from '@/lib/mobile-programs-catalog';
import { workoutInputSchema } from '@/lib/schemas/workout';

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, props: Params) {
  try {
    const { id } = await props.params;
    const userId = await requireMobileUserId(req);
    await requireOwnedProgram(id, userId);
    const data = await parseJsonBody(req, workoutInputSchema);
    const last = await db.workout.findFirst({
      where: { programId: id },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    const workout = await db.workout.create({
      data: {
        programId: id,
        name: data.name,
        dayOfWeek: data.dayOfWeek ?? null,
        order: (last?.order ?? 0) + 1,
      },
    });
    return Response.json(workout, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
