import { handleApiError, parseJsonBody } from '@/lib/api';
import { db } from '@/lib/db';
import { requireMobileUserId, requireOwnedWorkout } from '@/lib/mobile-programs-catalog';
import { workoutInputSchema } from '@/lib/schemas/workout';

interface Params {
  params: Promise<{ id: string }>;
}

export async function PUT(req: Request, props: Params) {
  try {
    const { id } = await props.params;
    const userId = await requireMobileUserId(req);
    await requireOwnedWorkout(id, userId);
    const data = await parseJsonBody(req, workoutInputSchema);
    return Response.json(
      await db.workout.update({
        where: { id },
        data: { name: data.name, dayOfWeek: data.dayOfWeek ?? null },
      }),
    );
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(req: Request, props: Params) {
  try {
    const { id } = await props.params;
    const userId = await requireMobileUserId(req);
    await requireOwnedWorkout(id, userId);
    await db.workout.delete({ where: { id } });
    return Response.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
