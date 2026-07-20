import { ApiError } from '@/lib/api';
import { db } from '@/lib/db';
import { resolveEquipmentType } from '@/lib/gym-loads';
import type { BarbellDiameterFamily, Prisma } from '@/lib/prisma-client';
import type {
  GymBarbellSystemProfileInput,
  GymDumbbellsSystemProfileInput,
} from '@/lib/schemas/gym-equipment';

export type GymSystemProfileKind = 'DUMBBELLS' | 'BARBELL';

const PROFILE_ID_PREFIX = 'system-profile';
const FAMILY_ORDER: BarbellDiameterFamily[] = ['LARGE', 'SMALL'];

export function gymSystemProfileId(gymId: string, kind: GymSystemProfileKind): string {
  return `${PROFILE_ID_PREFIX}-${kind.toLocaleLowerCase()}-${gymId}`;
}

export async function rejectOwnedSystemProfileMutation(
  userId: string,
  profileId: string,
): Promise<void> {
  const parsed = parseGymSystemProfileId(profileId);
  if (!parsed) return;
  const owned = await db.gym.count({ where: { id: parsed.gymId, userId } });
  if (owned > 0) {
    throw new ApiError(409, 'System equipment profiles cannot be deleted or converted.');
  }
}

export async function ensureGymSystemProfiles(
  tx: Prisma.TransactionClient,
  userId: string,
  gymId: string,
) {
  const gym = await tx.gym.findFirst({
    where: { id: gymId, userId },
    select: { id: true },
  });
  if (!gym) throw new ApiError(404, 'Gym not found.');

  const pools = new Map(
    (
      await tx.gymPlatePool.findMany({
        where: { gymId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, compatibilityKey: true, systemBarbellFamily: true },
      })
    ).map((pool) => [pool.id, pool]),
  );

  for (const family of FAMILY_ORDER) {
    let pool = [...pools.values()].find((item) => item.systemBarbellFamily === family);
    if (!pool) {
      const compatibilityKeys =
        family === 'LARGE'
          ? ['legacy-default', 'system_barbell_large']
          : ['small_diameter', 'system_barbell_small'];
      const candidate = [...pools.values()].find((item) =>
        compatibilityKeys.includes(item.compatibilityKey),
      );
      if (candidate) {
        pool = await tx.gymPlatePool.update({
          where: { id: candidate.id },
          data: { systemBarbellFamily: family },
          select: { id: true, compatibilityKey: true, systemBarbellFamily: true },
        });
      } else if (family === 'LARGE') {
        const barPool = await tx.gymPlatePool.findFirst({
          where: {
            gymId,
            systemBarbellFamily: null,
            equipment: {
              some: { equipmentType: 'BARBELL', loadType: 'PLATE_LOADED' },
            },
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { id: true, compatibilityKey: true, systemBarbellFamily: true },
        });
        if (barPool) {
          pool = await tx.gymPlatePool.update({
            where: { id: barPool.id },
            data: { systemBarbellFamily: family },
            select: { id: true, compatibilityKey: true, systemBarbellFamily: true },
          });
        }
      }
      if (!pool) {
        const suffix = gymId.replace(/[^A-Za-z0-9]/g, '').slice(-6) || 'profile';
        pool = await tx.gymPlatePool.create({
          data: {
            gymId,
            name:
              family === 'LARGE'
                ? `Large diameter plates (${suffix})`
                : `Small diameter plates (${suffix})`,
            compatibilityKey: family === 'LARGE' ? 'system_barbell_large' : 'system_barbell_small',
            systemBarbellFamily: family,
          },
          select: { id: true, compatibilityKey: true, systemBarbellFamily: true },
        });
      }
      pools.set(pool.id, pool);
    }

    await tx.gymEquipment.updateMany({
      where: {
        gymId,
        equipmentType: 'BARBELL',
        loadType: 'PLATE_LOADED',
        platePoolId: pool.id,
        systemBarbellFamily: null,
      },
      data: { systemBarbellFamily: family },
    });
  }

  const exercises = await tx.exercise.findMany({
    where: { userId },
    select: { id: true, name: true, equipmentType: true },
  });
  const freeWeightExercises = exercises.filter((exercise) => {
    const type = resolveEquipmentType(exercise.equipmentType, exercise.name);
    return type === 'DUMBBELL' || type === 'BARBELL';
  });
  const exerciseIds = freeWeightExercises.map((exercise) => exercise.id);
  const existingConfigs = exerciseIds.length
    ? await tx.gymExerciseConfig.findMany({
        where: { gymId, exerciseId: { in: exerciseIds } },
        select: { id: true, exerciseId: true, isAvailable: true, systemProfileSupported: true },
      })
    : [];
  const existingByExercise = new Map(existingConfigs.map((config) => [config.exerciseId, config]));
  const missingExerciseIds = exerciseIds.filter(
    (exerciseId) => !existingByExercise.has(exerciseId),
  );
  if (missingExerciseIds.length > 0) {
    await tx.gymExerciseConfig.createMany({
      data: missingExerciseIds.map((exerciseId) => ({
        gymId,
        exerciseId,
        isAvailable: true,
        systemProfileSupported: true,
      })),
    });
  }
  for (const config of existingConfigs) {
    if (config.systemProfileSupported != null) continue;
    await tx.gymExerciseConfig.update({
      where: { id: config.id },
      data: { systemProfileSupported: config.isAvailable },
    });
  }

  const supportedBarbellConfigs = await tx.gymExerciseConfig.findMany({
    where: {
      gymId,
      systemProfileSupported: true,
    },
    select: {
      exerciseId: true,
      exercise: { select: { name: true, equipmentType: true } },
    },
  });
  const supportedBarbellExerciseIds = supportedBarbellConfigs
    .filter(
      (config) =>
        resolveEquipmentType(config.exercise.equipmentType, config.exercise.name) === 'BARBELL',
    )
    .map((config) => config.exerciseId);
  const managedBars = await tx.gymEquipment.findMany({
    where: { gymId, systemBarbellFamily: { not: null } },
    select: { id: true },
  });
  if (supportedBarbellExerciseIds.length > 0 && managedBars.length > 0) {
    await tx.gymEquipmentExercise.createMany({
      data: managedBars.flatMap((bar) =>
        supportedBarbellExerciseIds.map((exerciseId) => ({
          equipmentId: bar.id,
          exerciseId,
          mirrorsLegacyConfig: false,
        })),
      ),
      skipDuplicates: true,
    });
  }
}

export async function saveOwnedDumbbellsSystemProfile(
  userId: string,
  gymId: string,
  input: GymDumbbellsSystemProfileInput,
) {
  await db.$transaction(async (tx) => {
    await ensureGymSystemProfiles(tx, userId, gymId);
    await updateSystemExerciseSupport(tx, userId, gymId, 'DUMBBELLS', input.exerciseIds);
    await tx.gym.update({
      where: { id: gymId },
      data: { dumbbellWeights: input.weightsKg },
    });
  });
  return { ok: true };
}

export async function saveOwnedBarbellSystemProfile(
  userId: string,
  gymId: string,
  input: GymBarbellSystemProfileInput,
) {
  await db.$transaction(async (tx) => {
    await ensureGymSystemProfiles(tx, userId, gymId);
    const supportedExerciseIds = await updateSystemExerciseSupport(
      tx,
      userId,
      gymId,
      'BARBELL',
      input.exerciseIds,
    );
    const previousBars = await tx.gymEquipment.findMany({
      where: { gymId, systemBarbellFamily: { not: null } },
      select: {
        id: true,
        name: true,
        baseLoadKg: true,
        systemBarbellFamily: true,
        exerciseLinks: { select: { exerciseId: true } },
      },
    });
    const previousBarIds = previousBars.map((bar) => bar.id);
    const affectedExerciseIds = new Set([
      ...supportedExerciseIds,
      ...previousBars.flatMap((bar) => bar.exerciseLinks.map((link) => link.exerciseId)),
    ]);

    for (const familyInput of input.families) {
      const family = familyInput.family;
      const pool = await tx.gymPlatePool.findFirst({
        where: { gymId, systemBarbellFamily: family },
        include: { plates: true },
      });
      if (!pool) throw new Error(`Missing ${family} system plate pool.`);

      const requestedPlateWeights = familyInput.plates.map((plate) => plate.weightKg);
      await tx.gymPlateInventoryItem.deleteMany({
        where: {
          poolId: pool.id,
          ...(requestedPlateWeights.length > 0
            ? { weightKg: { notIn: requestedPlateWeights } }
            : {}),
        },
      });
      const currentPlateByWeight = new Map(
        pool.plates.map((plate) => [roundWeight(plate.weightKg), plate]),
      );
      for (const plate of familyInput.plates) {
        const current = currentPlateByWeight.get(plate.weightKg);
        if (current) {
          await tx.gymPlateInventoryItem.update({
            where: { id: current.id },
            data: { quantity: plate.quantity },
          });
        } else {
          await tx.gymPlateInventoryItem.create({
            data: { poolId: pool.id, weightKg: plate.weightKg, quantity: plate.quantity },
          });
        }
      }

      const familyBars = previousBars.filter((bar) => bar.systemBarbellFamily === family);
      const familyById = new Map(familyBars.map((bar) => [bar.id, bar]));
      const unmatchedByWeight = new Map(
        familyBars.map((bar) => [roundWeight(bar.baseLoadKg), bar]),
      );
      const retainedIds = new Set<string>();
      for (const requestedBar of familyInput.bars) {
        let current = requestedBar.equipmentId
          ? familyById.get(requestedBar.equipmentId)
          : unmatchedByWeight.get(requestedBar.weightKg);
        if (requestedBar.equipmentId && !current) {
          throw new ApiError(400, 'A system bar does not belong to the selected family.');
        }
        if (current && retainedIds.has(current.id)) current = undefined;
        if (current) {
          retainedIds.add(current.id);
          unmatchedByWeight.delete(roundWeight(current.baseLoadKg));
          await tx.gymEquipment.update({
            where: { id: current.id },
            data: {
              equipmentType: 'BARBELL',
              loadType: 'PLATE_LOADED',
              baseLoadKg: requestedBar.weightKg,
              loadingSides: familyInput.loadingSides,
              platePoolId: pool.id,
              systemBarbellFamily: family,
            },
          });
          continue;
        }

        const created = await tx.gymEquipment.create({
          data: {
            gymId,
            name: await uniqueSystemBarName(tx, gymId, family, requestedBar.weightKg),
            equipmentType: 'BARBELL',
            loadType: 'PLATE_LOADED',
            baseLoadKg: requestedBar.weightKg,
            loadingSides: familyInput.loadingSides,
            platePoolId: pool.id,
            systemBarbellFamily: family,
          },
          select: { id: true },
        });
        retainedIds.add(created.id);
      }

      const removedIds = familyBars
        .map((bar) => bar.id)
        .filter((equipmentId) => !retainedIds.has(equipmentId));
      if (removedIds.length > 0) {
        const activeSelection = await tx.set.findFirst({
          where: {
            gymEquipmentId: { in: removedIds },
            session: { finishedAt: null },
          },
          select: { gymEquipmentId: true },
        });
        if (activeSelection) {
          throw new ApiError(409, 'A system bar used by an active session cannot be removed.');
        }
        await tx.gymEquipment.deleteMany({ where: { id: { in: removedIds } } });
      }
    }

    const managedBars = await tx.gymEquipment.findMany({
      where: { gymId, systemBarbellFamily: { not: null } },
      select: { id: true },
    });
    const managedBarIds = managedBars.map((bar) => bar.id);
    if (managedBarIds.length > 0) {
      await tx.gymEquipmentExercise.deleteMany({
        where: { equipmentId: { in: managedBarIds } },
      });
      if (supportedExerciseIds.length > 0) {
        await tx.gymEquipmentExercise.createMany({
          data: managedBarIds.flatMap((equipmentId) =>
            supportedExerciseIds.map((exerciseId) => ({
              equipmentId,
              exerciseId,
              mirrorsLegacyConfig: false,
            })),
          ),
        });
      }
    }
    if (previousBarIds.length > 0) {
      await tx.gymExerciseConfig.updateMany({
        where: {
          gymId,
          preferredEquipmentId: { in: previousBarIds },
          ...(supportedExerciseIds.length > 0
            ? { exerciseId: { notIn: supportedExerciseIds } }
            : {}),
        },
        data: { preferredEquipmentId: null },
      });
    }
    await reconcileLegacyMirrors(tx, gymId, [...affectedExerciseIds]);
  });
  return { ok: true };
}

async function updateSystemExerciseSupport(
  tx: Prisma.TransactionClient,
  userId: string,
  gymId: string,
  kind: GymSystemProfileKind,
  requestedExerciseIds: string[],
): Promise<string[]> {
  const allExercises = await tx.exercise.findMany({
    where: { userId },
    select: { id: true, name: true, equipmentType: true },
  });
  const targetType = kind === 'DUMBBELLS' ? 'DUMBBELL' : 'BARBELL';
  const matchingExerciseIds = allExercises
    .filter(
      (exercise) => resolveEquipmentType(exercise.equipmentType, exercise.name) === targetType,
    )
    .map((exercise) => exercise.id);
  const matchingSet = new Set(matchingExerciseIds);
  const requested = [...new Set(requestedExerciseIds)];
  if (requested.some((exerciseId) => !matchingSet.has(exerciseId))) {
    throw new ApiError(400, `System ${kind.toLocaleLowerCase()} exercises must match its type.`);
  }

  const existing = await tx.gymExerciseConfig.findMany({
    where: { gymId, exerciseId: { in: matchingExerciseIds } },
    select: { exerciseId: true },
  });
  const existingIds = new Set(existing.map((config) => config.exerciseId));
  const requestedSet = new Set(requested);
  const missing = matchingExerciseIds.filter((exerciseId) => !existingIds.has(exerciseId));
  if (missing.length > 0) {
    await tx.gymExerciseConfig.createMany({
      data: missing.map((exerciseId) => ({
        gymId,
        exerciseId,
        isAvailable: true,
        systemProfileSupported: requestedSet.has(exerciseId),
      })),
    });
  }
  if (requested.length > 0) {
    await tx.gymExerciseConfig.updateMany({
      where: { gymId, exerciseId: { in: requested } },
      data: { systemProfileSupported: true },
    });
  }
  const removed = matchingExerciseIds.filter((exerciseId) => !requestedSet.has(exerciseId));
  if (removed.length > 0) {
    await tx.gymExerciseConfig.updateMany({
      where: { gymId, exerciseId: { in: removed } },
      data: { systemProfileSupported: false },
    });
  }
  return requested;
}

async function uniqueSystemBarName(
  tx: Prisma.TransactionClient,
  gymId: string,
  family: BarbellDiameterFamily,
  weightKg: number,
) {
  const base = `${family === 'LARGE' ? 'Large' : 'Small'} diameter ${weightKg} kg bar`;
  const conflict = await tx.gymEquipment.count({
    where: { gymId, name: { equals: base, mode: 'insensitive' } },
  });
  return conflict === 0 ? base : `${base} (system)`;
}

async function reconcileLegacyMirrors(
  tx: Prisma.TransactionClient,
  gymId: string,
  exerciseIds: string[],
) {
  const ids = [...new Set(exerciseIds)];
  if (ids.length === 0) return;
  const remaining = await tx.gymEquipmentExercise.findMany({
    where: {
      exerciseId: { in: ids },
      mirrorsLegacyConfig: true,
      equipment: { gymId },
    },
    select: { exerciseId: true },
  });
  const remainingIds = new Set(remaining.map((link) => link.exerciseId));
  const withoutMirror = ids.filter((exerciseId) => !remainingIds.has(exerciseId));
  if (withoutMirror.length > 0) {
    await tx.gymExerciseConfig.updateMany({
      where: {
        gymId,
        exerciseId: { in: withoutMirror },
        isEquipmentMirror: true,
        systemProfileSupported: { not: null },
      },
      data: { isEquipmentMirror: false },
    });
    await tx.gymExerciseConfig.deleteMany({
      where: {
        gymId,
        exerciseId: { in: withoutMirror },
        isEquipmentMirror: true,
        systemProfileSupported: null,
      },
    });
  }
}

function parseGymSystemProfileId(
  profileId: string,
): { kind: GymSystemProfileKind; gymId: string } | null {
  const match = /^system-profile-(dumbbells|barbell)-(.+)$/.exec(profileId);
  if (!match) return null;
  return {
    kind: match[1] === 'dumbbells' ? 'DUMBBELLS' : 'BARBELL',
    gymId: match[2]!,
  };
}

function roundWeight(value: number) {
  return Math.round(value * 100) / 100;
}
