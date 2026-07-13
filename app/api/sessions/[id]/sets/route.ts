import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { setInputSchema, validateSetForCategory } from '@/lib/schemas/set';
import { ApiError, handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';
import { resolveSetEquipmentSnapshot } from '@/lib/set-equipment';
import { stampGoalIfAchieved } from '@/lib/set-goal-sync';

interface Params {
  params: Promise<{ id: string }>;
}

// POST /api/sessions/[id]/sets: records a set in a session.
export async function POST(req: Request, props: Params) {
  const params = await props.params;
  try {
    const userId = await requireApiUserId();

    // Scoped reads (issue #317): ownership is part of each query, not a
    // separate comparison that a later edit could drop.
    const session = await db.session.findFirst({ where: { id: params.id, userId } });
    if (!session) {
      throw new ApiError(404, 'Session not found.');
    }
    if (session.finishedAt) {
      throw new ApiError(400, 'Session already finished.');
    }

    const data = await parseJsonBody(req, setInputSchema);

    // Validation: the exercise must belong to the user.
    const exercise = await db.exercise.findFirst({
      where: { id: data.exerciseId, userId },
    });
    if (!exercise) {
      throw new ApiError(400, 'Invalid exercise.');
    }

    // Cardio cross-field rule (issue #133): duration/distance only on CARDIO
    // exercises, and a cardio set requires a duration.
    const categoryError = validateSetForCategory(exercise.category, data);
    if (categoryError) {
      throw new ApiError(400, categoryError);
    }
    const isCardio = exercise.category === 'CARDIO';

    const created = await db.$transaction(async (tx) => {
      const canonicalWeight = isCardio ? 0 : data.weight;
      const equipmentSnapshot = await resolveSetEquipmentSnapshot(tx, {
        userId,
        sessionGymId: session.gymId,
        exerciseId: data.exerciseId,
        gymEquipmentId: data.gymEquipmentId,
      });
      return tx.set.create({
        data: {
          sessionId: params.id,
          exerciseId: data.exerciseId,
          ...equipmentSnapshot,
          setNumber: data.setNumber,
          // Cardio sets store weight = 0 / reps = 1 by convention (the columns
          // are NOT NULL); the UI never shows them for CARDIO exercises.
          weight: canonicalWeight,
          reps: isCardio ? 1 : data.reps,
          rir: isCardio ? null : (data.rir ?? null),
          durationSec: isCardio ? data.durationSec : null,
          distanceM: isCardio ? (data.distanceM ?? null) : null,
          avgHr: isCardio ? (data.avgHr ?? null) : null,
          maxHr: isCardio ? (data.maxHr ?? null) : null,
          notes: data.notes ?? null,
          isWarmup: data.isWarmup ?? false,
          isDropSet: data.isDropSet ?? false,
          recoverySec: data.recoverySec ?? null,
        },
      });
    });
    // Best-effort: the set is already committed, so a failure here must never
    // fail the request (a 500 would make the offline sync retry the POST and
    // duplicate the set). An unstamped goal self-heals on the next achieving
    // set or on goal re-creation, which re-derives achievedAt from history.
    try {
      await stampGoalIfAchieved(userId, exercise, created);
    } catch (stampErr) {
      console.error('[api] goal achievement stamping failed:', stampErr);
    }

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
