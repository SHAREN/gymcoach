import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ApiError, handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';
import { setUpdateSchema } from '@/lib/schemas/set';
import { rederiveGoalAchievement } from '@/lib/set-goal-sync';

interface Params {
  params: Promise<{ id: string }>;
}

// PATCH /api/sets/[id]: corrects values on a completed strength set without
// changing its exercise, set number, completion timestamp, or frozen equipment
// history. Active-session editing continues to use the normal session sync path.
export async function PATCH(req: Request, props: Params) {
  const params = await props.params;
  try {
    const userId = await requireApiUserId();
    const set = await db.set.findFirst({
      where: { id: params.id, session: { userId } },
      include: {
        session: { select: { finishedAt: true } },
        exercise: { select: { category: true } },
      },
    });
    if (!set) {
      throw new ApiError(404, 'Set not found.');
    }
    if (!set.session.finishedAt) {
      throw new ApiError(400, 'Historical set edits require a finished session.');
    }
    if (set.exercise.category === 'CARDIO') {
      throw new ApiError(400, 'Historical cardio rows are read-only.');
    }

    const data = await parseJsonBody(req, setUpdateSchema);
    const updated = await db.set.update({
      where: { id: set.id },
      data: {
        weight: data.weight,
        reps: data.reps,
        rir: data.rir ?? null,
      },
    });

    try {
      await rederiveGoalAchievement(userId, set.exerciseId);
    } catch (rederiveErr) {
      console.error('[api] goal achievement re-derivation failed:', rederiveErr);
    }

    return NextResponse.json(updated);
  } catch (err) {
    return handleApiError(err);
  }
}

// DELETE /api/sets/[id]: deletes a set (e.g. an input mistake).
// The user can then re-enter it. Ownership lives in the query scope itself.
export async function DELETE(_req: Request, props: Params) {
  const params = await props.params;
  try {
    const userId = await requireApiUserId();
    const set = await db.set.findFirst({
      where: { id: params.id, session: { userId } },
    });
    if (!set) {
      throw new ApiError(404, 'Set not found.');
    }
    await db.set.delete({ where: { id: params.id, session: { userId } } });
    // Best-effort: the set is already gone, so a failure here must never fail
    // the deletion. Historical corrections can move or clear achievedAt.
    try {
      await rederiveGoalAchievement(userId, set.exerciseId);
    } catch (rederiveErr) {
      console.error('[api] goal achievement re-derivation failed:', rederiveErr);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
