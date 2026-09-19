import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sessionStartSchema } from '@/lib/schemas/session';
import { ApiError, handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';

export async function GET() {
  try {
    const userId = await requireApiUserId();
    const sessions = await db.session.findMany({
      where: { userId },
      orderBy: { startedAt: 'desc' },
      include: {
        workout: { select: { name: true } },
        program: { select: { name: true } },
        _count: { select: { sets: true } },
      },
      take: 50,
    });
    return NextResponse.json(sessions);
  } catch (err) {
    return handleApiError(err);
  }
}

// POST /api/sessions: starts either a programmed workout or an empty freeform
// session. A freeform session deliberately has no Program/Workout rows.
export async function POST(req: Request) {
  try {
    const userId = await requireApiUserId();
    const input = await parseJsonBody(req, sessionStartSchema);

    const selectedGymId =
      input.gymId ??
      (await db.user.findUnique({ where: { id: userId }, select: { activeGymId: true } }))
        ?.activeGymId ??
      null;
    if (selectedGymId) {
      const gym = await db.gym.findFirst({
        where: { id: selectedGymId, userId },
        select: { id: true },
      });
      if (!gym) throw new ApiError(400, 'Invalid gym.');
    }

    if ('freeform' in input) {
      const inProgress = await db.session.findFirst({
        where: {
          userId,
          workoutId: null,
          programId: null,
          finishedAt: null,
        },
        orderBy: { startedAt: 'desc' },
      });
      if (inProgress) {
        return NextResponse.json(inProgress, { status: 200 });
      }

      const created = await db.session.create({
        data: {
          userId,
          gymId: selectedGymId,
          freeExerciseIds: [],
        },
      });
      return NextResponse.json(created, { status: 201 });
    }

    const workout = await db.workout.findFirst({
      where: { id: input.workoutId, program: { userId } },
    });
    if (!workout) {
      throw new ApiError(404, 'Session not found.');
    }

    const inProgress = await db.session.findFirst({
      where: { userId, workoutId: input.workoutId, finishedAt: null },
    });
    if (inProgress) {
      return NextResponse.json(inProgress, { status: 200 });
    }

    const created = await db.session.create({
      data: {
        userId,
        workoutId: input.workoutId,
        programId: workout.programId,
        gymId: selectedGymId,
      },
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
