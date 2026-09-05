import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ApiError, handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';
import { historicalSetInputSchema } from '@/lib/schemas/set';
import { resolveSetEquipmentSnapshot } from '@/lib/set-equipment';
import { rederiveGoalAchievement } from '@/lib/set-goal-sync';

interface Params {
  params: Promise<{ id: string }>;
}

// POST /api/sessions/[id]/historical-sets: append a corrected strength row to
// a finished session. This stays separate from the active-session endpoint so
// offline queue replays can never accidentally write into completed history.
export async function POST(req: Request, props: Params) {
  const params = await props.params;
  try {
    const userId = await requireApiUserId();
    const session = await db.session.findFirst({
      where: { id: params.id, userId },
      select: { id: true, gymId: true, finishedAt: true },
    });
    if (!session) {
      throw new ApiError(404, 'Session not found.');
    }
    if (!session.finishedAt) {
      throw new ApiError(400, 'Historical sets require a finished session.');
    }

    const data = await parseJsonBody(req, historicalSetInputSchema);
    const created = await db.$transaction(async (tx) => {
      const exercise = await tx.exercise.findFirst({
        where: {
          id: data.exerciseId,
          userId,
          sets: { some: { sessionId: session.id } },
        },
        select: { id: true, category: true },
      });
      if (!exercise) {
        throw new ApiError(400, 'Exercise is not part of this session.');
      }
      if (exercise.category === 'CARDIO') {
        throw new ApiError(400, 'Historical cardio rows are read-only.');
      }

      const equipmentSnapshot = await resolveSetEquipmentSnapshot(tx, {
        userId,
        sessionGymId: session.gymId,
        exerciseId: exercise.id,
        gymEquipmentId: data.gymEquipmentId,
      });
      const lastSet = await tx.set.findFirst({
        where: { sessionId: session.id, exerciseId: exercise.id },
        orderBy: { setNumber: 'desc' },
        select: { setNumber: true },
      });

      return tx.set.create({
        data: {
          sessionId: session.id,
          exerciseId: exercise.id,
          ...equipmentSnapshot,
          setNumber: (lastSet?.setNumber ?? 0) + 1,
          weight: data.weight,
          reps: data.reps,
          rir: data.rir ?? null,
          isWarmup: false,
          isDropSet: false,
          completedAt: session.finishedAt!,
        },
      });
    });

    try {
      await rederiveGoalAchievement(userId, data.exerciseId);
    } catch (rederiveErr) {
      console.error('[api] goal achievement re-derivation failed:', rederiveErr);
    }

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
