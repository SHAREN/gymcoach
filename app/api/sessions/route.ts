import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sessionStartSchema } from '@/lib/schemas/session';
import { ApiError, handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';
import { defaultIntraSetConfig } from '@/lib/intra-set-autoregulation';

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

// POST /api/sessions: starts either a programmed workout or a free session.
// A free session is created atomically with its first exercise, so cancelling
// the picker can never leave an empty unfinished Session behind.
export async function POST(req: Request) {
  try {
    const userId = await requireApiUserId();
    const { workoutId, gymId, initialExerciseId } = await parseJsonBody(req, sessionStartSchema);

    const selectedGymId =
      gymId ??
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

    if (!workoutId) {
      const inProgressFree = await db.session.findFirst({
        where: { userId, workoutId: null, programId: null, finishedAt: null },
        orderBy: { startedAt: 'desc' },
      });
      if (inProgressFree) return NextResponse.json(inProgressFree);

      const exercise = await db.exercise.findFirst({
        where: { id: initialExerciseId!, userId },
      });
      if (!exercise) throw new ApiError(400, 'Invalid exercise.');

      const autoregulation = defaultIntraSetConfig(exercise);
      const created = await db.$transaction(async (tx) => {
        const session = await tx.session.create({
          data: {
            userId,
            gymId: selectedGymId,
          },
        });
        await tx.sessionExercise.create({
          data: {
            sessionId: session.id,
            exerciseId: exercise.id,
            ordinal: 0,
            targetSets: 4,
            targetRepsMin: 8,
            targetRepsMax: 12,
            targetRIR: 2,
            restSec: exercise.defaultRestSec,
            autoregulationMode: 'PRESERVE_RIR',
            fatigueRate: autoregulation.fatigueRate,
            loadAdjustmentPct: autoregulation.loadAdjustmentPct,
          },
        });
        return session;
      });
      return NextResponse.json(created, { status: 201 });
    }

    const workout = await db.workout.findFirst({
      where: { id: workoutId, program: { userId } },
    });
    if (!workout) throw new ApiError(404, 'Session not found.');

    const inProgress = await db.session.findFirst({
      where: { userId, workoutId, finishedAt: null },
    });
    if (inProgress) return NextResponse.json(inProgress, { status: 200 });

    const created = await db.session.create({
      data: {
        userId,
        workoutId,
        programId: workout.programId,
        gymId: selectedGymId,
      },
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
