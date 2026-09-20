import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { ApiError, handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';
import { defaultIntraSetConfig } from '@/lib/intra-set-autoregulation';

const inputSchema = z.object({
  exerciseId: z.string().min(1),
});

interface Params {
  params: Promise<{ id: string }>;
}

// POST /api/sessions/[id]/exercises: add an exercise to a free session only.
// Programmed workouts keep using ProgramExercise and are never mutated here.
export async function POST(req: Request, props: Params) {
  const params = await props.params;
  try {
    const userId = await requireApiUserId();
    const session = await db.session.findFirst({
      where: { id: params.id, userId },
      select: { id: true, workoutId: true, finishedAt: true },
    });
    if (!session) throw new ApiError(404, 'Session not found.');
    if (session.finishedAt) throw new ApiError(400, 'Session already finished.');
    if (session.workoutId)
      throw new ApiError(400, 'Exercises can only be added directly to free sessions.');

    const { exerciseId } = await parseJsonBody(req, inputSchema);
    const exercise = await db.exercise.findFirst({
      where: { id: exerciseId, userId },
    });
    if (!exercise) throw new ApiError(400, 'Invalid exercise.');

    const existing = await db.sessionExercise.findUnique({
      where: { sessionId_exerciseId: { sessionId: session.id, exerciseId } },
      include: { exercise: true },
    });
    if (existing) return NextResponse.json(existing);

    const last = await db.sessionExercise.findFirst({
      where: { sessionId: session.id },
      orderBy: { ordinal: 'desc' },
      select: { ordinal: true },
    });
    const autoregulation = defaultIntraSetConfig(exercise);
    const created = await db.sessionExercise.create({
      data: {
        sessionId: session.id,
        exerciseId,
        ordinal: (last?.ordinal ?? -1) + 1,
        targetSets: 4,
        targetRepsMin: 8,
        targetRepsMax: 12,
        targetRIR: 2,
        restSec: exercise.defaultRestSec,
        autoregulationMode: 'PRESERVE_RIR',
        fatigueRate: autoregulation.fatigueRate,
        loadAdjustmentPct: autoregulation.loadAdjustmentPct,
      },
      include: { exercise: true },
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
