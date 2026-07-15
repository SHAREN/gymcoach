import { NextResponse } from 'next/server';
import { Prisma } from '@/prisma/generated/client';
import { db } from '@/lib/db';
import { setInputSchema, validateSetForCategory } from '@/lib/schemas/set';
import { ApiError, handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';
import { stampGoalIfAchieved } from '@/lib/set-goal-sync';
import { resolveSetEquipmentSnapshot } from '@/lib/set-equipment';
import { assertWebSetEquipmentMayBeNull } from '@/lib/web-set-equipment-policy';

interface Params {
  params: Promise<{ id: string }>;
}

// POST /api/sessions/[id]/sets: records a set in a session.
export async function POST(req: Request, props: Params) {
  const params = await props.params;
  try {
    const userId = await requireApiUserId();

    const session = await db.session.findUnique({ where: { id: params.id } });
    if (!session || session.userId !== userId) {
      throw new ApiError(404, 'Session not found.');
    }
    if (session.finishedAt) {
      throw new ApiError(400, 'Session already finished.');
    }

    const data = await parseJsonBody(req, setInputSchema);

    // Validation: the exercise must belong to the user.
    const exercise = await db.exercise.findUnique({ where: { id: data.exerciseId } });
    if (!exercise || exercise.userId !== userId) {
      throw new ApiError(400, 'Invalid exercise.');
    }

    // Cardio cross-field rule (issue #133): duration/distance only on CARDIO
    // exercises, and a cardio set requires a duration.
    const categoryError = validateSetForCategory(exercise.category, data);
    if (categoryError) {
      throw new ApiError(400, categoryError);
    }
    const isCardio = exercise.category === 'CARDIO';
    const requestedData = {
      ...(data.id ? { id: data.id } : {}),
      sessionId: params.id,
      exerciseId: data.exerciseId,
      setNumber: data.setNumber,
      // Cardio sets store weight = 0 / reps = 1 by convention (the columns
      // are NOT NULL); the UI never shows them for CARDIO exercises.
      weight: isCardio ? 0 : data.weight,
      reps: isCardio ? 1 : data.reps,
      rir: isCardio ? null : (data.rir ?? null),
      durationSec: isCardio ? (data.durationSec ?? null) : null,
      distanceM: isCardio ? (data.distanceM ?? null) : null,
      avgHr: isCardio ? (data.avgHr ?? null) : null,
      maxHr: isCardio ? (data.maxHr ?? null) : null,
      notes: data.notes ?? null,
      isWarmup: data.isWarmup ?? false,
      isDropSet: data.isDropSet ?? false,
      recoverySec: data.recoverySec ?? null,
      gymEquipmentId: isCardio ? null : (data.gymEquipmentId ?? null),
    };

    if (data.id) {
      const existing = await db.set.findUnique({ where: { id: data.id } });
      if (existing) {
        assertIdempotentSet(existing, requestedData, params.id);
        return NextResponse.json(existing);
      }
    }

    if (!data.gymEquipmentId) {
      await assertWebSetEquipmentMayBeNull(db, {
        userId,
        sessionGymId: session.gymId,
        exerciseId: data.exerciseId,
      });
    }
    const equipmentSnapshot = await resolveSetEquipmentSnapshot(db, {
      userId,
      sessionGymId: session.gymId,
      exerciseId: data.exerciseId,
      gymEquipmentId: data.gymEquipmentId,
      selectedLoadKg: isCardio ? 0 : data.weight,
    });
    const createData = { ...requestedData, ...(equipmentSnapshot ?? {}) };

    let created;
    try {
      created = await db.set.create({
        data: createData,
      });
    } catch (error) {
      if (
        data.id &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await db.set.findUnique({ where: { id: data.id } });
        if (existing) {
          assertIdempotentSet(existing, requestedData, params.id);
          return NextResponse.json(existing);
        }
      }
      throw error;
    }
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

function assertIdempotentSet(
  existing: {
    sessionId: string;
    exerciseId: string;
    setNumber: number;
    weight: number;
    reps: number;
    rir: number | null;
    durationSec: number | null;
    distanceM: number | null;
    avgHr: number | null;
    maxHr: number | null;
    notes: string | null;
    isWarmup: boolean;
    isDropSet: boolean;
    recoverySec: number | null;
    gymEquipmentId: string | null;
  },
  expected: Omit<typeof existing, never> & { id?: string },
  sessionId: string,
) {
  const matches =
    existing.sessionId === sessionId &&
    existing.exerciseId === expected.exerciseId &&
    existing.setNumber === expected.setNumber &&
    existing.weight === expected.weight &&
    existing.reps === expected.reps &&
    existing.rir === expected.rir &&
    existing.durationSec === expected.durationSec &&
    existing.distanceM === expected.distanceM &&
    existing.avgHr === expected.avgHr &&
    existing.maxHr === expected.maxHr &&
    existing.notes === expected.notes &&
    existing.isWarmup === expected.isWarmup &&
    existing.isDropSet === expected.isDropSet &&
    existing.recoverySec === expected.recoverySec &&
    existing.gymEquipmentId === expected.gymEquipmentId;

  if (!matches) {
    throw new ApiError(409, 'Set ID was already used with different data.');
  }
}
