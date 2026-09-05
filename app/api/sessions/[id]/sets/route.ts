import { NextResponse } from 'next/server';
import { Prisma } from '@/prisma/generated/client';
import type { Exercise, Set } from '@/lib/prisma-client';
import { db } from '@/lib/db';
import { setInputSchema, validateSetForCategory } from '@/lib/schemas/set';
import { ApiError, handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';
import { setAchievesGoal } from '@/lib/goals';
import { effectiveWeight } from '@/lib/stats';
import { resolveSetEquipmentSnapshot } from '@/lib/set-equipment';

interface Params {
  params: Promise<{ id: string }>;
}

// POST /api/sessions/[id]/sets: records a set in a session. A web/offline
// caller may provide a stable client ID; replaying the exact same mutation then
// returns the original row instead of creating a duplicate.
export async function POST(req: Request, props: Params) {
  const params = await props.params;
  try {
    const userId = await requireApiUserId();

    const session = await db.session.findFirst({ where: { id: params.id, userId } });
    if (!session) {
      throw new ApiError(404, 'Session not found.');
    }
    if (session.finishedAt) {
      throw new ApiError(400, 'Session already finished.');
    }

    const data = await parseJsonBody(req, setInputSchema);
    const exercise = await db.exercise.findFirst({
      where: { id: data.exerciseId, userId },
    });
    if (!exercise) {
      throw new ApiError(400, 'Invalid exercise.');
    }

    const categoryError = validateSetForCategory(exercise.category, data);
    if (categoryError) {
      throw new ApiError(400, categoryError);
    }
    const isCardio = exercise.category === 'CARDIO';
    const requested = {
      sessionId: params.id,
      exerciseId: data.exerciseId,
      setNumber: data.setNumber,
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
      gymEquipmentId: data.gymEquipmentId ?? null,
    };

    const replayEquipmentSnapshot = data.id
      ? await resolveSetEquipmentSnapshot(db, {
          userId,
          sessionGymId: session.gymId,
          exerciseId: data.exerciseId,
          gymEquipmentId: data.gymEquipmentId,
        })
      : null;

    if (data.id) {
      const existing = await db.set.findFirst({
        where: { id: data.id, session: { userId } },
      });
      if (existing) {
        assertIdempotentReplay(
          existing,
          requested,
          data.gymEquipmentId ?? null,
          replayEquipmentSnapshot?.gymEquipmentId ?? null,
        );
        return NextResponse.json(existing);
      }
    }

    let created: Set;
    try {
      created = await db.$transaction(async (tx) => {
        const equipmentSnapshot = await resolveSetEquipmentSnapshot(tx, {
          userId,
          sessionGymId: session.gymId,
          exerciseId: data.exerciseId,
          gymEquipmentId: data.gymEquipmentId,
        });
        return tx.set.create({
          data: {
            ...(data.id ? { id: data.id } : {}),
            ...requested,
            ...equipmentSnapshot,
          },
        });
      });
    } catch (error) {
      // Two replay requests can race between the existence check and create.
      // The stable primary key remains the source of truth: on a uniqueness
      // race, re-read and validate the exact mutation before acknowledging it.
      if (
        data.id &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await db.set.findFirst({
          where: { id: data.id, session: { userId } },
        });
        if (existing) {
          assertIdempotentReplay(
            existing,
            requested,
            data.gymEquipmentId ?? null,
            replayEquipmentSnapshot?.gymEquipmentId ?? null,
          );
          return NextResponse.json(existing);
        }
      }
      throw error;
    }

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

function assertIdempotentReplay(
  existing: Pick<
    Set,
    | 'sessionId'
    | 'exerciseId'
    | 'setNumber'
    | 'weight'
    | 'reps'
    | 'rir'
    | 'durationSec'
    | 'distanceM'
    | 'avgHr'
    | 'maxHr'
    | 'notes'
    | 'isWarmup'
    | 'isDropSet'
    | 'gymEquipmentId'
    | 'equipmentLoadSnapshot'
  >,
  expected: {
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
    gymEquipmentId: string | null;
  },
  requestedEquipmentId: string | null,
  currentlyResolvableEquipmentId: string | null,
) {
  const existingEquipmentId = originalEquipmentId(existing);
  const equipmentMatches =
    existingEquipmentId === currentlyResolvableEquipmentId ||
    (existingEquipmentId !== null && existingEquipmentId === requestedEquipmentId);
  const matches =
    existing.sessionId === expected.sessionId &&
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
    equipmentMatches;

  if (!matches) {
    throw new ApiError(409, 'Set ID was already used with different data.');
  }
}

function originalEquipmentId(
  existing: Pick<Set, 'gymEquipmentId' | 'equipmentLoadSnapshot'>,
): string | null {
  if (existing.gymEquipmentId) return existing.gymEquipmentId;
  const snapshot = existing.equipmentLoadSnapshot;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  return typeof snapshot.gymEquipmentId === 'string' ? snapshot.gymEquipmentId : null;
}

// Per-exercise goal (issue #90): when a freshly logged working set meets an
// unachieved goal's target, stamp achievedAt with the set's completedAt.
async function stampGoalIfAchieved(userId: string, exercise: Exercise, set: Set): Promise<void> {
  if (set.isWarmup) return;
  const goal = await db.exerciseGoal.findUnique({
    where: { userId_exerciseId: { userId, exerciseId: exercise.id } },
  });
  if (!goal || goal.achievedAt) return;

  let weight = set.weight;
  if (exercise.usesBodyweight) {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { bodyweight: true },
    });
    weight = effectiveWeight(set.weight, true, user?.bodyweight);
  }
  if (setAchievesGoal({ weight, reps: set.reps, isWarmup: set.isWarmup }, goal)) {
    await db.exerciseGoal.update({
      where: { id: goal.id },
      data: { achievedAt: set.completedAt },
    });
  }
}
