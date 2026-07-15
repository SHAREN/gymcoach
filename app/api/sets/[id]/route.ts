import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ApiError, handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';
import { setUpdateSchema } from '@/lib/schemas/set';
import { rederiveGoalAchievement } from '@/lib/set-goal-sync';
import { resolveSetEquipmentSnapshot } from '@/lib/set-equipment';

interface Params {
  params: Promise<{ id: string }>;
}

// PATCH /api/sets/[id]: corrects the logged values without changing the set's
// exercise, order, or completion timestamp.
export async function PATCH(req: Request, props: Params) {
  const params = await props.params;
  try {
    const userId = await requireApiUserId();
    const set = await db.set.findUnique({
      where: { id: params.id },
      include: { session: { select: { userId: true, gymId: true } } },
    });
    if (!set || set.session.userId !== userId) {
      throw new ApiError(404, 'Set not found.');
    }

    const data = await parseJsonBody(req, setUpdateSchema);
    const equipmentSnapshot = await resolveSetEquipmentSnapshot(db, {
      userId,
      sessionGymId: set.session.gymId,
      exerciseId: set.exerciseId,
      gymEquipmentId: data.gymEquipmentId === undefined ? set.gymEquipmentId : data.gymEquipmentId,
      selectedLoadKg: data.weight,
    });
    const updated = await db.set.update({
      where: { id: set.id },
      data: {
        weight: data.weight,
        reps: data.reps,
        rir: data.rir ?? null,
        ...equipmentSnapshot,
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
export async function DELETE(_req: Request, props: Params) {
  const params = await props.params;
  try {
    const userId = await requireApiUserId();
    const set = await db.set.findUnique({
      where: { id: params.id },
      include: { session: { select: { userId: true } } },
    });
    if (!set || set.session.userId !== userId) {
      throw new ApiError(404, 'Set not found.');
    }
    await db.set.delete({ where: { id: params.id } });
    // Best-effort, mirroring the stamping at set-save: the set is already
    // gone, so a failure here must never fail the deletion. A stale
    // achievedAt also self-heals on goal re-creation.
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
