import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { MAX_FREEFORM_EXERCISES, freeSessionExerciseSchema } from '@/lib/schemas/session';
import { ApiError, handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, context: RouteContext) {
  try {
    const userId = await requireApiUserId();
    const { id } = await context.params;
    const { exerciseId } = await parseJsonBody(req, freeSessionExerciseSchema);

    const [session, exercise] = await Promise.all([
      db.session.findFirst({
        where: { id, userId },
        select: {
          id: true,
          workoutId: true,
          programId: true,
          finishedAt: true,
          freeExerciseIds: true,
        },
      }),
      db.exercise.findFirst({
        where: { id: exerciseId, userId },
        select: { id: true },
      }),
    ]);

    if (!session) throw new ApiError(404, 'Session not found.');
    if (session.finishedAt) throw new ApiError(400, 'Session is already finished.');
    if (session.workoutId || session.programId) {
      throw new ApiError(400, 'Exercises can only be added to a freeform session.');
    }
    if (!exercise) throw new ApiError(404, 'Exercise not found.');

    if (session.freeExerciseIds.includes(exerciseId)) {
      return NextResponse.json({ ok: true, exerciseId, freeExerciseIds: session.freeExerciseIds });
    }
    if (session.freeExerciseIds.length >= MAX_FREEFORM_EXERCISES) {
      throw new ApiError(400, 'Freeform session exercise limit reached.');
    }

    // Append inside one PostgreSQL statement. The predicates are rechecked
    // after a concurrent row update, so distinct additions cannot overwrite
    // each other, duplicate requests stay idempotent, and the cap cannot be
    // exceeded by racing requests.
    const [updated] = await db.$queryRaw<Array<{ freeExerciseIds: string[] }>>`
      UPDATE "Session"
      SET "freeExerciseIds" = array_append("freeExerciseIds", ${exerciseId})
      WHERE "id" = ${session.id}
        AND "userId" = ${userId}
        AND "workoutId" IS NULL
        AND "programId" IS NULL
        AND "finishedAt" IS NULL
        AND cardinality("freeExerciseIds") < ${MAX_FREEFORM_EXERCISES}
        AND NOT (${exerciseId} = ANY("freeExerciseIds"))
      RETURNING "freeExerciseIds"
    `;

    if (updated) {
      return NextResponse.json(
        { ok: true, exerciseId, freeExerciseIds: updated.freeExerciseIds },
        { status: 201 },
      );
    }

    const current = await db.session.findFirst({
      where: { id: session.id, userId },
      select: { finishedAt: true, programId: true, workoutId: true, freeExerciseIds: true },
    });
    if (!current) throw new ApiError(404, 'Session not found.');
    if (current.finishedAt) throw new ApiError(400, 'Session is already finished.');
    if (current.workoutId || current.programId) {
      throw new ApiError(400, 'Exercises can only be added to a freeform session.');
    }
    if (current.freeExerciseIds.includes(exerciseId)) {
      return NextResponse.json({ ok: true, exerciseId, freeExerciseIds: current.freeExerciseIds });
    }
    throw new ApiError(400, 'Freeform session exercise limit reached.');
  } catch (err) {
    return handleApiError(err);
  }
}
