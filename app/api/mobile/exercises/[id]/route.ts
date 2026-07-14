import { ApiError, handleApiError, parseJsonBody } from '@/lib/api';
import { db } from '@/lib/db';
import { requireMobileUserId, requireOwnedExercise } from '@/lib/mobile-programs-catalog';
import { exerciseInputSchema } from '@/lib/schemas/exercise';

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(req: Request, props: Params) {
  try {
    const { id } = await props.params;
    const userId = await requireMobileUserId(req);
    const exercise = await requireOwnedExercise(id, userId);
    const exerciseSessions = await db.set.findMany({
      where: {
        exerciseId: id,
        session: {
          userId,
          finishedAt: { not: null },
        },
      },
      distinct: ['sessionId'],
      select: { session: { select: { startedAt: true } } },
    });
    return Response.json({
      ...exercise,
      trainingDates: exerciseSessions.map((item) => item.session.startedAt.toISOString()),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(req: Request, props: Params) {
  try {
    const { id } = await props.params;
    const userId = await requireMobileUserId(req);
    await requireOwnedExercise(id, userId);
    const data = await parseJsonBody(req, exerciseInputSchema);
    return Response.json(
      await db.exercise.update({
        where: { id },
        data: { ...data, notes: data.notes ?? null },
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
    await requireOwnedExercise(id, userId);
    const usage = await db.exercise.findUnique({
      where: { id },
      select: { _count: { select: { programExercises: true, sets: true } } },
    });
    if (usage && (usage._count.programExercises > 0 || usage._count.sets > 0)) {
      throw new ApiError(409, 'Exercise used in a program or in history. Remove it first.');
    }
    await db.exercise.delete({ where: { id } });
    return Response.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
