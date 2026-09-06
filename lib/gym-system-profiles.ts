import { ApiError } from '@/lib/api';
import { db } from '@/lib/db';
import type { BarbellDiameterFamily, EquipmentType, Prisma } from '@/lib/prisma-client';
import type {
  GymBarbellSystemProfileInput,
  GymDumbbellsSystemProfileInput,
} from '@/lib/schemas/gym-equipment';

export type GymSystemProfileKind = 'DUMBBELLS' | 'BARBELL';

const FAMILY_ORDER: BarbellDiameterFamily[] = ['LARGE', 'SMALL'];

export function gymSystemProfileId(gymId: string, kind: GymSystemProfileKind): string {
  return `system-profile-${kind.toLocaleLowerCase()}-${gymId}`;
}

export async function initializeOwnedGymSystemProfiles(
  tx: Prisma.TransactionClient,
  userId: string,
  gymId: string,
) {
  const gym = await tx.gym.findFirst({
    where: { id: gymId, userId },
    select: {
      id: true,
      dumbbellWeights: true,
      plateWeights: true,
      barWeights: true,
    },
  });
  if (!gym) throw new ApiError(404, 'Gym not found.');

  const existingPools = await tx.gymPlatePool.findMany({
    where: { gymId },
    select: { id: true, systemBarbellFamily: true },
  });
  const byFamily = new Map(
    existingPools.flatMap((pool) =>
      pool.systemBarbellFamily ? [[pool.systemBarbellFamily, pool] as const] : [],
    ),
  );

  for (const family of FAMILY_ORDER) {
    if (byFamily.has(family)) continue;
    const suffix = stableSuffix(gymId);
    const pool = await tx.gymPlatePool.create({
      data: {
        gymId,
        name:
          family === 'LARGE'
            ? `Large diameter plates (system ${suffix})`
            : `Small diameter plates (system ${suffix})`,
        compatibilityKey: family === 'LARGE' ? 'system_barbell_large' : 'system_barbell_small',
        systemBarbellFamily: family,
        plates:
          family === 'LARGE' && gym.plateWeights.length > 0
            ? {
                createMany: {
                  data: uniquePositive(gym.plateWeights).map((weightKg) => ({
                    weightKg,
                    quantity: null,
                  })),
                },
              }
            : undefined,
      },
      select: { id: true, systemBarbellFamily: true },
    });
    byFamily.set(family, pool);

    if (family === 'LARGE' && gym.barWeights.length > 0) {
      const existingManagedBars = await tx.gymEquipment.count({
        where: { gymId, systemBarbellFamily: { not: null } },
      });
      if (existingManagedBars === 0) {
        for (const weightKg of uniquePositive(gym.barWeights)) {
          await tx.gymEquipment.create({
            data: {
              gymId,
              name: await uniqueSystemBarName(tx, gymId, family, weightKg),
              equipmentType: 'BARBELL',
              quantity: 1,
              loadConfigurationKnown: true,
              loadType: 'PLATE_LOADED',
              weightOptions: [],
              selectedLoadMultiplier: 1,
              baseLoadKg: weightKg,
              platePoolId: pool.id,
              loadingSides: 2,
              systemBarbellFamily: family,
            },
          });
        }
      }
    }
  }

  await materializeLegacySystemMembership(tx, userId, gymId);
  await syncManagedBarLinks(tx, userId, gymId);
}

export async function getOwnedGymSystemProfiles(userId: string, gymId: string) {
  const [gym, exercises, pools, bars, configs] = await Promise.all([
    db.gym.findFirst({
      where: { id: gymId, userId },
      select: { id: true, name: true, dumbbellWeights: true },
    }),
    db.exercise.findMany({
      where: { userId, equipmentType: { in: ['DUMBBELL', 'BARBELL'] } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, equipmentType: true, muscleGroup: true, category: true },
    }),
    db.gymPlatePool.findMany({
      where: { gymId, systemBarbellFamily: { not: null } },
      orderBy: { systemBarbellFamily: 'asc' },
      include: { plates: { orderBy: { weightKg: 'asc' } } },
    }),
    db.gymEquipment.findMany({
      where: { gymId, systemBarbellFamily: { not: null } },
      orderBy: [{ systemBarbellFamily: 'asc' }, { baseLoadKg: 'asc' }],
      select: {
        id: true,
        name: true,
        equipmentType: true,
        loadConfigurationKnown: true,
        loadType: true,
        weightOptions: true,
        selectedLoadMultiplier: true,
        baseLoadKg: true,
        platePoolId: true,
        loadingSides: true,
        systemBarbellFamily: true,
      },
    }),
    db.gymExerciseConfig.findMany({
      where: { gymId },
      select: { exerciseId: true, isAvailable: true, systemProfileSupported: true },
    }),
  ]);
  if (!gym) throw new ApiError(404, 'Gym not found.');

  const configByExercise = new Map(configs.map((config) => [config.exerciseId, config]));
  const supported = (equipmentType: EquipmentType) =>
    exercises.filter((exercise) => {
      if (exercise.equipmentType !== equipmentType) return false;
      const config = configByExercise.get(exercise.id);
      return config?.systemProfileSupported ?? config?.isAvailable ?? true;
    });

  const family = (familyName: BarbellDiameterFamily) => {
    const pool = pools.find((item) => item.systemBarbellFamily === familyName);
    if (!pool) {
      throw new ApiError(
        500,
        `Gym system profile invariant is missing the ${familyName} Barbell plate pool.`,
      );
    }
    const familyBars = bars.filter((bar) => bar.systemBarbellFamily === familyName);
    return {
      family: familyName,
      pool: {
        id: pool.id,
        name: pool.name,
        compatibilityKey: pool.compatibilityKey,
        systemBarbellFamily: pool.systemBarbellFamily,
        plates: pool.plates.map((plate) => ({
          id: plate.id,
          weightKg: plate.weightKg,
          quantity: plate.quantity,
        })),
      },
      bars: familyBars,
      loadingSides: familyBars[0]?.loadingSides ?? 2,
    };
  };

  return {
    gymId: gym.id,
    gymName: gym.name,
    dumbbells: {
      id: gymSystemProfileId(gym.id, 'DUMBBELLS'),
      kind: 'DUMBBELLS' as const,
      weightsKg: gym.dumbbellWeights,
      exerciseLinks: supported('DUMBBELL'),
    },
    barbell: {
      id: gymSystemProfileId(gym.id, 'BARBELL'),
      kind: 'BARBELL' as const,
      exerciseLinks: supported('BARBELL'),
      families: [family('LARGE'), family('SMALL')] as const,
    },
  };
}

export async function saveOwnedDumbbellsSystemProfile(
  userId: string,
  gymId: string,
  input: GymDumbbellsSystemProfileInput,
) {
  await db.$transaction(async (tx) => {
    await initializeOwnedGymSystemProfiles(tx, userId, gymId);
    const exerciseIds = await validateSystemExerciseIds(tx, userId, 'DUMBBELL', input.exerciseIds);
    await replaceSystemExerciseSupport(tx, userId, gymId, 'DUMBBELL', exerciseIds);
    await tx.gym.update({
      where: { id: gymId, userId },
      data: { dumbbellWeights: input.weightsKg },
    });
  });
  return getOwnedGymSystemProfiles(userId, gymId);
}

export async function saveOwnedBarbellSystemProfile(
  userId: string,
  gymId: string,
  input: GymBarbellSystemProfileInput,
) {
  await db.$transaction(async (tx) => {
    await initializeOwnedGymSystemProfiles(tx, userId, gymId);
    const supportedExerciseIds = await validateSystemExerciseIds(
      tx,
      userId,
      'BARBELL',
      input.exerciseIds,
    );
    await replaceSystemExerciseSupport(tx, userId, gymId, 'BARBELL', supportedExerciseIds);

    const existingBars = await tx.gymEquipment.findMany({
      where: { gymId, systemBarbellFamily: { not: null } },
      select: {
        id: true,
        baseLoadKg: true,
        systemBarbellFamily: true,
      },
    });

    for (const familyInput of input.families) {
      const pool = await tx.gymPlatePool.findFirst({
        where: { gymId, systemBarbellFamily: familyInput.family },
        include: { plates: true },
      });
      if (!pool) throw new ApiError(500, 'System Barbell plate pool is missing.');

      await replacePoolPlates(tx, pool.id, familyInput.plates);

      const familyBars = existingBars.filter(
        (bar) => bar.systemBarbellFamily === familyInput.family,
      );
      const byId = new Map(familyBars.map((bar) => [bar.id, bar]));
      const unmatchedByWeight = new Map(familyBars.map((bar) => [round(bar.baseLoadKg), bar]));
      const retainedIds = new Set<string>();

      for (const requestedBar of familyInput.bars) {
        let current = requestedBar.equipmentId
          ? byId.get(requestedBar.equipmentId)
          : unmatchedByWeight.get(requestedBar.weightKg);
        if (requestedBar.equipmentId && !current) {
          throw new ApiError(400, 'A system bar does not belong to the selected Barbell family.');
        }
        if (current && retainedIds.has(current.id)) current = undefined;

        if (current) {
          retainedIds.add(current.id);
          unmatchedByWeight.delete(round(current.baseLoadKg));
          await tx.gymEquipment.update({
            where: { id: current.id },
            data: {
              equipmentType: 'BARBELL',
              loadConfigurationKnown: true,
              loadType: 'PLATE_LOADED',
              weightOptions: [],
              selectedLoadMultiplier: 1,
              baseLoadKg: requestedBar.weightKg,
              platePoolId: pool.id,
              loadingSides: familyInput.loadingSides,
              systemBarbellFamily: familyInput.family,
            },
          });
        } else {
          const created = await tx.gymEquipment.create({
            data: {
              gymId,
              name: await uniqueSystemBarName(
                tx,
                gymId,
                familyInput.family,
                requestedBar.weightKg,
              ),
              equipmentType: 'BARBELL',
              quantity: 1,
              loadConfigurationKnown: true,
              loadType: 'PLATE_LOADED',
              weightOptions: [],
              selectedLoadMultiplier: 1,
              baseLoadKg: requestedBar.weightKg,
              platePoolId: pool.id,
              loadingSides: familyInput.loadingSides,
              systemBarbellFamily: familyInput.family,
            },
            select: { id: true },
          });
          retainedIds.add(created.id);
        }
      }

      const removedIds = familyBars
        .map((bar) => bar.id)
        .filter((equipmentId) => !retainedIds.has(equipmentId));
      if (removedIds.length > 0) {
        const activeSelection = await tx.set.findFirst({
          where: {
            gymEquipmentId: { in: removedIds },
            session: { userId, finishedAt: null },
          },
          select: { id: true },
        });
        if (activeSelection) {
          throw new ApiError(409, 'A system bar used by an active session cannot be removed.');
        }
        await tx.gymEquipment.deleteMany({
          where: { id: { in: removedIds }, gymId, systemBarbellFamily: familyInput.family },
        });
      }
    }

    await syncManagedBarLinks(tx, userId, gymId, supportedExerciseIds);

    const managedBars = await tx.gymEquipment.findMany({
      where: { gymId, systemBarbellFamily: { not: null } },
      select: { baseLoadKg: true },
    });
    const largePool = await tx.gymPlatePool.findFirst({
      where: { gymId, systemBarbellFamily: 'LARGE' },
      select: { plates: { select: { weightKg: true } } },
    });
    await tx.gym.update({
      where: { id: gymId, userId },
      data: {
        barWeights: uniquePositive(managedBars.map((bar) => bar.baseLoadKg)),
        // Legacy two-sided Barbell consumers use the LARGE family only. Small
        // diameter remains isolated and never gets merged into this array.
        plateWeights: uniquePositive(largePool?.plates.map((plate) => plate.weightKg) ?? []),
      },
    });
  });

  return getOwnedGymSystemProfiles(userId, gymId);
}

export async function rejectOwnedSystemBarMutation(userId: string, equipmentId: string) {
  const equipment = await db.gymEquipment.findFirst({
    where: { id: equipmentId, gym: { userId } },
    select: { systemBarbellFamily: true },
  });
  if (equipment?.systemBarbellFamily) {
    throw new ApiError(409, 'System Barbell members must be edited through the Barbell profile.');
  }
}

export async function rejectOwnedSystemPoolMutation(userId: string, poolId: string) {
  const pool = await db.gymPlatePool.findFirst({
    where: { id: poolId, gym: { userId } },
    select: { systemBarbellFamily: true },
  });
  if (pool?.systemBarbellFamily) {
    throw new ApiError(409, 'System Barbell pools must be edited through the Barbell profile.');
  }
}

async function materializeLegacySystemMembership(
  tx: Prisma.TransactionClient,
  userId: string,
  gymId: string,
) {
  const exercises = await tx.exercise.findMany({
    where: { userId, equipmentType: { in: ['DUMBBELL', 'BARBELL'] } },
    select: { id: true },
  });
  if (exercises.length === 0) return;

  const configs = await tx.gymExerciseConfig.findMany({
    where: { gymId, exerciseId: { in: exercises.map((exercise) => exercise.id) } },
    select: { id: true, exerciseId: true, isAvailable: true, systemProfileSupported: true },
  });
  const byExercise = new Map(configs.map((config) => [config.exerciseId, config]));

  for (const exercise of exercises) {
    const current = byExercise.get(exercise.id);
    if (!current) {
      await tx.gymExerciseConfig.create({
        data: {
          gymId,
          exerciseId: exercise.id,
          isAvailable: true,
          systemProfileSupported: true,
        },
      });
    } else if (current.systemProfileSupported == null) {
      await tx.gymExerciseConfig.update({
        where: { id: current.id },
        data: { systemProfileSupported: current.isAvailable },
      });
    }
  }
}

async function validateSystemExerciseIds(
  tx: Prisma.TransactionClient,
  userId: string,
  targetType: 'DUMBBELL' | 'BARBELL',
  requestedExerciseIds: string[],
) {
  const requested = [...new Set(requestedExerciseIds)];
  if (requested.length === 0) return requested;
  const exercises = await tx.exercise.findMany({
    where: { userId, id: { in: requested } },
    select: { id: true, equipmentType: true },
  });
  if (exercises.length !== requested.length) {
    throw new ApiError(400, 'One or more system-profile exercises do not belong to the trainee.');
  }
  if (exercises.some((exercise) => exercise.equipmentType !== targetType)) {
    throw new ApiError(400, `System ${targetType.toLocaleLowerCase()} exercises must match its type.`);
  }
  return requested;
}

async function replaceSystemExerciseSupport(
  tx: Prisma.TransactionClient,
  userId: string,
  gymId: string,
  targetType: 'DUMBBELL' | 'BARBELL',
  requestedExerciseIds: string[],
) {
  const matchingExercises = await tx.exercise.findMany({
    where: { userId, equipmentType: targetType },
    select: { id: true },
  });
  const requested = new Set(requestedExerciseIds);
  for (const exercise of matchingExercises) {
    await tx.gymExerciseConfig.upsert({
      where: { gymId_exerciseId: { gymId, exerciseId: exercise.id } },
      create: {
        gymId,
        exerciseId: exercise.id,
        isAvailable: requested.has(exercise.id),
        systemProfileSupported: requested.has(exercise.id),
      },
      update: {
        isAvailable: requested.has(exercise.id),
        systemProfileSupported: requested.has(exercise.id),
      },
    });
  }
}

async function replacePoolPlates(
  tx: Prisma.TransactionClient,
  poolId: string,
  plates: Array<{ weightKg: number; quantity: number | null }>,
) {
  await tx.gymPlateInventoryItem.deleteMany({ where: { poolId } });
  if (plates.length > 0) {
    await tx.gymPlateInventoryItem.createMany({
      data: plates.map((plate) => ({
        poolId,
        weightKg: plate.weightKg,
        quantity: plate.quantity,
      })),
    });
  }
}

async function syncManagedBarLinks(
  tx: Prisma.TransactionClient,
  userId: string,
  gymId: string,
  supportedOverride?: string[],
) {
  const supportedExerciseIds =
    supportedOverride ??
    (
      await tx.gymExerciseConfig.findMany({
        where: {
          gymId,
          systemProfileSupported: true,
          exercise: { userId, equipmentType: 'BARBELL' },
        },
        select: { exerciseId: true },
      })
    ).map((config) => config.exerciseId);

  const bars = await tx.gymEquipment.findMany({
    where: { gymId, systemBarbellFamily: { not: null } },
    select: { id: true },
  });
  const barIds = bars.map((bar) => bar.id);
  if (barIds.length === 0) return;

  await tx.gymEquipmentExercise.deleteMany({ where: { equipmentId: { in: barIds } } });
  if (supportedExerciseIds.length > 0) {
    await tx.gymEquipmentExercise.createMany({
      data: barIds.flatMap((equipmentId) =>
        supportedExerciseIds.map((exerciseId) => ({ equipmentId, exerciseId })),
      ),
      skipDuplicates: true,
    });
  }
}

async function uniqueSystemBarName(
  tx: Prisma.TransactionClient,
  gymId: string,
  family: BarbellDiameterFamily,
  weightKg: number,
) {
  const base = `${family === 'LARGE' ? 'Large' : 'Small'} diameter ${round(weightKg)} kg bar`;
  const conflict = await tx.gymEquipment.count({
    where: { gymId, name: { equals: base, mode: 'insensitive' } },
  });
  return conflict === 0 ? base : `${base} (system ${stableSuffix(gymId)})`;
}

function stableSuffix(gymId: string) {
  return gymId.replace(/[^A-Za-z0-9]/g, '').slice(-6) || 'profile';
}

function uniquePositive(values: number[]) {
  return [...new Set(values.filter((value) => Number.isFinite(value) && value > 0).map(round))].sort(
    (a, b) => a - b,
  );
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
