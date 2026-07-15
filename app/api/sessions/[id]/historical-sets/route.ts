import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ApiError, handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';
import { historicalSetInputSchema } from '@/lib/schemas/set';
import { assertWebSetEquipmentMayBeNull } from '@/lib/web-set-equipment-policy';
import { resolveSetEquipmentSnapshot } from '@/lib/set-equipment';
import { resolveEquipmentLoadProfile } from '@/lib/gym-loads';
import { rederiveGoalAchievement } from '@/lib/set-goal-sync';
import type { Prisma } from '@/lib/prisma-client';

interface Params {
  params: Promise<{ id: string }>;
}

// POST /api/sessions/[id]/historical-sets: appends a correction row to a
// finished strength session. This is intentionally separate from the normal
// active-session POST endpoint, whose finished-session guard protects offline
// queue replays.
export async function POST(req: Request, props: Params) {
  const params = await props.params;
  try {
    const userId = await requireApiUserId();
    const session = await db.session.findFirst({
      where: { id: params.id, userId },
      select: {
        id: true,
        gymId: true,
        finishedAt: true,
        gym: { select: { inventoryMode: true } },
      },
    });
    if (!session) {
      throw new ApiError(404, 'Session not found.');
    }
    const completedAt = session.finishedAt;
    if (!completedAt) {
      throw new ApiError(400, 'Historical sets require a finished session.');
    }

    const data = await parseJsonBody(req, historicalSetInputSchema);
    const created = await db.$transaction(async (tx) => {
      const exercise = await tx.exercise.findFirst({
        where: {
          id: data.exerciseId,
          userId,
          sessionMemberships: { some: { sessionId: session.id } },
        },
        select: { id: true, category: true },
      });
      if (!exercise) {
        throw new ApiError(400, 'Exercise is not part of this session.');
      }
      if (exercise.category === 'CARDIO') {
        throw new ApiError(400, 'Historical cardio rows are read-only.');
      }

      if (!data.gymEquipmentId) {
        if (session.gym?.inventoryMode === 'EQUIPMENT_FIRST') {
          throw new ApiError(400, 'Select linked equipment before saving this set.');
        }
        await assertWebSetEquipmentMayBeNull(tx, {
          userId,
          sessionGymId: session.gymId,
          exerciseId: exercise.id,
        });
      } else {
        await assertHistoricalLoadIsAttainable(tx, {
          userId,
          sessionGymId: session.gymId,
          exerciseId: exercise.id,
          gymEquipmentId: data.gymEquipmentId,
          selectedLoadKg: data.weight,
        });
      }

      const equipmentSnapshot = await resolveSetEquipmentSnapshot(tx, {
        userId,
        sessionGymId: session.gymId,
        exerciseId: exercise.id,
        gymEquipmentId: data.gymEquipmentId,
        selectedLoadKg: data.weight,
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
          setNumber: (lastSet?.setNumber ?? 0) + 1,
          weight: data.weight,
          reps: data.reps,
          rir: data.rir ?? null,
          isWarmup: false,
          isDropSet: false,
          completedAt,
          ...equipmentSnapshot,
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

async function assertHistoricalLoadIsAttainable(
  client: Pick<Prisma.TransactionClient, 'gymEquipment'>,
  input: {
    userId: string;
    sessionGymId: string | null;
    exerciseId: string;
    gymEquipmentId: string;
    selectedLoadKg: number;
  },
) {
  const equipment = await client.gymEquipment.findFirst({
    where: {
      id: input.gymEquipmentId,
      gymId: input.sessionGymId ?? undefined,
      gym: { userId: input.userId },
      exerciseLinks: { some: { exerciseId: input.exerciseId } },
    },
    select: {
      id: true,
      name: true,
      equipmentType: true,
      loadType: true,
      weightOptions: true,
      selectedLoadMultiplier: true,
      baseLoadKg: true,
      loadingSides: true,
      platePoolId: true,
      platePool: {
        select: {
          name: true,
          plates: { select: { weightKg: true, quantity: true } },
        },
      },
    },
  });
  if (!equipment || !input.sessionGymId) {
    throw new ApiError(400, 'Equipment is not available for this exercise.');
  }

  const profile = resolveEquipmentLoadProfile({
    equipmentId: equipment.id,
    equipmentName: equipment.name,
    equipmentType: equipment.equipmentType,
    loadType: equipment.loadType,
    weightOptions: equipment.weightOptions,
    selectedLoadMultiplier: equipment.selectedLoadMultiplier,
    baseLoadKg: equipment.baseLoadKg,
    loadingSides: equipment.loadingSides,
    platePoolId: equipment.platePoolId,
    platePoolName: equipment.platePool?.name ?? null,
    plates: equipment.platePool?.plates ?? [],
  });
  if (
    profile.attainableLoads.length > 0 &&
    !profile.attainableLoads.some((load) => Math.abs(load - input.selectedLoadKg) < 0.001)
  ) {
    throw new ApiError(400, 'Selected load is not achievable with this equipment.');
  }
}
