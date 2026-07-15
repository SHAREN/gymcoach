import { Buffer } from 'node:buffer';
import { ApiError } from '@/lib/api';
import { db } from '@/lib/db';
import { getExerciseMedia } from '@/lib/exercise-media';
import { resolveExerciseInventory, type EquipmentLoadProfile } from '@/lib/gym-loads';
import type { GymEquipmentInput, GymPlatePoolInput } from '@/lib/schemas/gym-equipment';

export const GYM_EQUIPMENT_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type GymEquipmentImageMimeType = (typeof GYM_EQUIPMENT_IMAGE_MIME_TYPES)[number];
export const MAX_GYM_EQUIPMENT_IMAGE_BYTES = 5 * 1024 * 1024;

type UpsertGymEquipmentInput = GymEquipmentInput & {
  // Accepted temporarily for old MCP clients. Equipment links now resolve
  // availability directly, so no GymExerciseConfig copy is written.
  markExercisesAvailable?: boolean;
};

interface SetGymEquipmentImageInput {
  clear?: boolean;
  imageUrl?: string;
  imageBase64?: string;
  mimeType?: GymEquipmentImageMimeType;
}

const equipmentSelection = {
  id: true,
  gymId: true,
  name: true,
  equipmentType: true,
  description: true,
  manufacturer: true,
  modelName: true,
  quantity: true,
  loadType: true,
  weightOptions: true,
  selectedLoadMultiplier: true,
  baseLoadKg: true,
  platePoolId: true,
  loadingSides: true,
  platePool: {
    select: {
      id: true,
      name: true,
      compatibilityKey: true,
      plates: { orderBy: { weightKg: 'asc' as const } },
    },
  },
  imageUrl: true,
  imageMimeType: true,
  createdAt: true,
  updatedAt: true,
  exerciseLinks: {
    orderBy: { exercise: { name: 'asc' as const } },
    include: {
      exercise: {
        select: {
          id: true,
          name: true,
          muscleGroup: true,
          category: true,
          equipmentType: true,
          notes: true,
        },
      },
    },
  },
} as const;

export async function listOwnedGyms(userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { activeGymId: true },
  });
  const gyms = await db.gym.findMany({
    where: { userId },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      updatedAt: true,
      _count: { select: { equipment: true, exerciseConfigs: true, sessions: true } },
    },
  });
  return {
    activeGymId: user?.activeGymId ?? null,
    gyms: gyms.map((gym) => ({ ...gym, isActive: gym.id === user?.activeGymId })),
  };
}

export async function getOwnedGymInventory(userId: string, baseUrl: string, gymId?: string) {
  const gym = await resolveOwnedGym(userId, gymId);
  const [details, exercises] = await Promise.all([
    db.gym.findUnique({
      where: { id: gym.id },
      include: {
        equipment: { orderBy: { name: 'asc' }, select: equipmentSelection },
        platePools: {
          orderBy: { name: 'asc' },
          include: { plates: { orderBy: { weightKg: 'asc' } } },
        },
        exerciseConfigs: {
          orderBy: { exercise: { name: 'asc' } },
          include: {
            exercise: {
              select: {
                id: true,
                name: true,
                muscleGroup: true,
                category: true,
                equipmentType: true,
                notes: true,
              },
            },
          },
        },
      },
    }),
    db.exercise.findMany({
      where: { userId },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        muscleGroup: true,
        category: true,
        equipmentType: true,
        usesBodyweight: true,
        notes: true,
      },
    }),
  ]);
  if (!details) throw new Error('Gym not found.');

  const configByExercise = new Map(
    details.exerciseConfigs.map((config) => [config.exerciseId, config]),
  );
  const equipmentIdsByExercise = new Map<string, string[]>();
  for (const item of details.equipment) {
    for (const link of item.exerciseLinks) {
      const ids = equipmentIdsByExercise.get(link.exerciseId) ?? [];
      ids.push(item.id);
      equipmentIdsByExercise.set(link.exerciseId, ids);
    }
  }

  const equipmentByExercise = new Map<string, EquipmentLoadProfile[]>();
  for (const item of details.equipment) {
    const profile: EquipmentLoadProfile = {
      equipmentId: item.id,
      equipmentName: item.name,
      equipmentType: item.equipmentType,
      loadType: item.loadType,
      weightOptions: item.weightOptions,
      selectedLoadMultiplier: item.selectedLoadMultiplier,
      baseLoadKg: item.baseLoadKg,
      loadingSides: item.loadingSides,
      platePoolId: item.platePoolId,
      platePoolName: item.platePool?.name ?? null,
      plates:
        item.platePool?.plates.map((plate) => ({
          weightKg: plate.weightKg,
          quantity: plate.quantity,
        })) ?? [],
    };
    for (const link of item.exerciseLinks) {
      const profiles = equipmentByExercise.get(link.exerciseId) ?? [];
      profiles.push(profile);
      equipmentByExercise.set(link.exerciseId, profiles);
    }
  }

  return {
    gym: {
      id: details.id,
      name: details.name,
      inventoryMode: details.inventoryMode,
      sharedFreeWeights: {
        dumbbellWeightsKg: details.dumbbellWeights,
        plateWeightsKg: details.plateWeights,
        barWeightsKg: details.barWeights,
      },
      platePools: details.platePools,
      equipment: details.equipment.map((item) => ({
        ...item,
        image: equipmentImage(item, baseUrl),
        exerciseLinks: item.exerciseLinks.map((link) => link.exercise),
      })),
      exerciseCoverage: exercises.map((exercise) => {
        const config = configByExercise.get(exercise.id);
        const media = getExerciseMedia(exercise.name);
        const resolved = resolveExerciseInventory({
          inventoryMode: details.inventoryMode,
          exercise,
          linkedEquipment: equipmentByExercise.get(exercise.id) ?? [],
          legacyConfig: config,
          sharedDumbbellWeights: details.dumbbellWeights,
          legacyPlateWeights: details.plateWeights,
          legacyBarWeights: details.barWeights,
        });
        return {
          ...exercise,
          configured: config != null,
          isAvailable: resolved.isAvailable,
          availabilitySource: resolved.source,
          requiresEquipmentSelection: resolved.requiresEquipmentSelection,
          attainableLoadsKg: resolved.weightOptions,
          equipmentOptions: resolved.equipment,
          weightOptionsKg: config?.weightOptions ?? [],
          dumbbellWeightsKg: config?.dumbbellWeights ?? [],
          plateWeightsKg: config?.plateWeights ?? [],
          barWeightsKg: config?.barWeights ?? [],
          equipmentIds: equipmentIdsByExercise.get(exercise.id) ?? [],
          builtInMedia: media
            ? {
                frames: media.frames.map((frame) => new URL(frame, baseUrl).toString()),
                approximate: media.approximate,
                source: media.source,
              }
            : null,
        };
      }),
      updatedAt: details.updatedAt,
    },
    workflow: {
      comparePhotosAndNarrationAgainst: ['gym.equipment', 'gym.sharedFreeWeights'],
      addPhysicalItemWith: 'upsert_gym_equipment',
      updateSharedWeightsWith: 'update_gym_free_weights',
      attachImageWith: 'set_gym_equipment_image',
      note: 'Link equipment to exercise IDs so availability and machine weights also constrain program design.',
    },
  };
}

export async function updateOwnedGymFreeWeights(
  userId: string,
  gymId: string | undefined,
  patch: {
    dumbbellWeights?: number[];
    plateWeights?: number[];
    barWeights?: number[];
  },
) {
  const gym = await resolveOwnedGym(userId, gymId);
  if (
    patch.dumbbellWeights === undefined &&
    patch.plateWeights === undefined &&
    patch.barWeights === undefined
  ) {
    throw new Error('Provide at least one free-weight inventory list.');
  }
  return db.gym.update({
    where: { id: gym.id },
    data: patch,
    select: {
      id: true,
      name: true,
      dumbbellWeights: true,
      plateWeights: true,
      barWeights: true,
      updatedAt: true,
    },
  });
}

export async function upsertOwnedGymEquipment(
  userId: string,
  gymId: string | undefined,
  input: UpsertGymEquipmentInput,
) {
  const gym = await resolveOwnedGym(userId, gymId);
  const requestedExerciseIds = input.exerciseIds ? [...new Set(input.exerciseIds)] : undefined;
  const current = input.equipmentId
    ? await db.gymEquipment.findFirst({
        where: { id: input.equipmentId, gymId: gym.id },
        select: {
          id: true,
          equipmentType: true,
          loadType: true,
          weightOptions: true,
          selectedLoadMultiplier: true,
          baseLoadKg: true,
          platePoolId: true,
          loadingSides: true,
          exerciseLinks: { select: { exerciseId: true } },
        },
      })
    : await db.gymEquipment.findFirst({
        where: { gymId: gym.id, name: { equals: input.name, mode: 'insensitive' } },
        select: {
          id: true,
          equipmentType: true,
          loadType: true,
          weightOptions: true,
          selectedLoadMultiplier: true,
          baseLoadKg: true,
          platePoolId: true,
          loadingSides: true,
          exerciseLinks: { select: { exerciseId: true } },
        },
      });
  if (input.equipmentId && !current) throw new ApiError(404, 'Gym equipment not found.');

  const exerciseIds =
    requestedExerciseIds ?? current?.exerciseLinks.map((link) => link.exerciseId) ?? [];
  const exercises = exerciseIds.length
    ? await db.exercise.findMany({
        where: { userId, id: { in: exerciseIds } },
        select: { id: true, name: true, equipmentType: true },
      })
    : [];
  if (exercises.length !== exerciseIds.length) {
    throw new ApiError(400, 'One or more exercise IDs do not belong to the trainee.');
  }
  const inferredLoadType =
    input.loadType ??
    current?.loadType ??
    (input.platePoolId
      ? 'PLATE_LOADED'
      : input.weightOptions?.length && ['MACHINE', 'CABLE'].includes(input.equipmentType)
        ? 'SELECTORIZED'
        : input.weightOptions?.length && input.equipmentType === 'DUMBBELL'
          ? 'FIXED'
          : 'NONE');
  const effectivePlatePoolId =
    input.platePoolId === undefined ? (current?.platePoolId ?? null) : input.platePoolId;
  if (effectivePlatePoolId) {
    const pool = await db.gymPlatePool.findFirst({
      where: { id: effectivePlatePoolId, gymId: gym.id },
      select: { id: true },
    });
    if (!pool) throw new ApiError(400, 'Gym plate pool not found.');
  }
  if (inferredLoadType === 'PLATE_LOADED' && !effectivePlatePoolId) {
    throw new ApiError(400, 'Plate-loaded equipment requires a compatible gym plate pool.');
  }

  const equipment = await db.$transaction(async (tx) => {
    const item = current
      ? await tx.gymEquipment.update({
          where: { id: current.id },
          data: {
            name: input.name,
            equipmentType: input.equipmentType,
            description: input.description,
            manufacturer: input.manufacturer,
            modelName: input.modelName,
            quantity: input.quantity,
            loadType: input.loadType,
            weightOptions: input.weightOptions,
            selectedLoadMultiplier: input.selectedLoadMultiplier,
            baseLoadKg: input.baseLoadKg,
            platePoolId: input.platePoolId,
            loadingSides: input.loadingSides,
          },
        })
      : await tx.gymEquipment.create({
          data: {
            gymId: gym.id,
            name: input.name,
            equipmentType: input.equipmentType,
            description: input.description,
            manufacturer: input.manufacturer,
            modelName: input.modelName,
            quantity: input.quantity ?? 1,
            loadType: inferredLoadType,
            weightOptions: input.weightOptions ?? [],
            selectedLoadMultiplier: input.selectedLoadMultiplier ?? 1,
            baseLoadKg: input.baseLoadKg ?? 0,
            platePoolId: effectivePlatePoolId,
            loadingSides: input.loadingSides ?? 2,
          },
        });

    if (requestedExerciseIds !== undefined) {
      await tx.gymEquipmentExercise.deleteMany({ where: { equipmentId: item.id } });
      if (requestedExerciseIds.length > 0) {
        await tx.gymEquipmentExercise.createMany({
          data: requestedExerciseIds.map((exerciseId) => ({
            equipmentId: item.id,
            exerciseId,
          })),
        });
      }
    }
    return item;
  });

  const saved = await db.gymEquipment.findUnique({
    where: { id: equipment.id },
    select: equipmentSelection,
  });
  if (!saved) throw new Error('Gym equipment could not be read after saving.');
  const mismatchedExercises = exercises
    .filter(
      (exercise) =>
        exercise.equipmentType !== 'OTHER' &&
        input.equipmentType !== 'OTHER' &&
        exercise.equipmentType !== input.equipmentType,
    )
    .map((exercise) => ({
      id: exercise.id,
      name: exercise.name,
      exerciseEquipmentType: exercise.equipmentType,
    }));
  return { equipment: saved, mismatchedExercises };
}

export async function deleteOwnedGymEquipment(userId: string, equipmentId: string) {
  const equipment = await db.gymEquipment.findFirst({
    where: { id: equipmentId, gym: { userId } },
    select: { id: true },
  });
  if (!equipment) throw new ApiError(404, 'Gym equipment not found.');
  await db.gymEquipment.delete({ where: { id: equipment.id } });
  return { ok: true };
}

export async function upsertOwnedGymPlatePool(
  userId: string,
  gymId: string | undefined,
  input: GymPlatePoolInput,
) {
  const gym = await resolveOwnedGym(userId, gymId);
  const current = input.poolId
    ? await db.gymPlatePool.findFirst({
        where: { id: input.poolId, gymId: gym.id },
        select: { id: true },
      })
    : await db.gymPlatePool.findFirst({
        where: {
          gymId: gym.id,
          OR: [
            { name: { equals: input.name, mode: 'insensitive' } },
            { compatibilityKey: input.compatibilityKey },
          ],
        },
        select: { id: true },
      });
  if (input.poolId && !current) throw new ApiError(404, 'Gym plate pool not found.');

  const pool = await db.$transaction(async (tx) => {
    const saved = current
      ? await tx.gymPlatePool.update({
          where: { id: current.id },
          data: { name: input.name, compatibilityKey: input.compatibilityKey },
        })
      : await tx.gymPlatePool.create({
          data: {
            gymId: gym.id,
            name: input.name,
            compatibilityKey: input.compatibilityKey,
          },
        });
    await tx.gymPlateInventoryItem.deleteMany({ where: { poolId: saved.id } });
    if (input.plates.length > 0) {
      await tx.gymPlateInventoryItem.createMany({
        data: input.plates.map((plate) => ({
          poolId: saved.id,
          weightKg: plate.weightKg,
          quantity: plate.quantity,
        })),
      });
    }
    return saved;
  });

  return db.gymPlatePool.findUniqueOrThrow({
    where: { id: pool.id },
    include: {
      plates: { orderBy: { weightKg: 'asc' } },
      equipment: { orderBy: { name: 'asc' }, select: { id: true, name: true } },
    },
  });
}

export async function deleteOwnedGymPlatePool(userId: string, poolId: string) {
  const pool = await db.gymPlatePool.findFirst({
    where: { id: poolId, gym: { userId } },
    select: { id: true, _count: { select: { equipment: true } } },
  });
  if (!pool) throw new ApiError(404, 'Gym plate pool not found.');
  if (pool._count.equipment > 0) {
    throw new ApiError(409, 'Detach plate-loaded equipment before deleting this plate pool.');
  }
  await db.gymPlatePool.delete({ where: { id: pool.id } });
  return { ok: true };
}

export async function getOwnedGymEquipmentImage(userId: string, equipmentId: string) {
  const equipment = await db.gymEquipment.findFirst({
    where: { id: equipmentId, gym: { userId } },
    select: {
      id: true,
      gymId: true,
      name: true,
      imageUrl: true,
      imageData: true,
      imageMimeType: true,
      updatedAt: true,
    },
  });
  if (!equipment) throw new Error('Gym equipment not found.');

  if (equipment.imageData && equipment.imageMimeType) {
    if (
      !GYM_EQUIPMENT_IMAGE_MIME_TYPES.includes(equipment.imageMimeType as GymEquipmentImageMimeType)
    ) {
      throw new Error('Gym equipment image has an unsupported MIME type.');
    }
    return {
      equipment: { id: equipment.id, gymId: equipment.gymId, name: equipment.name },
      image: {
        kind: 'uploaded' as const,
        data: Buffer.from(equipment.imageData).toString('base64'),
        mimeType: equipment.imageMimeType as GymEquipmentImageMimeType,
        updatedAt: equipment.updatedAt,
      },
    };
  }
  if (equipment.imageUrl) {
    return {
      equipment: { id: equipment.id, gymId: equipment.gymId, name: equipment.name },
      image: { kind: 'external' as const, url: equipment.imageUrl, updatedAt: equipment.updatedAt },
    };
  }
  throw new Error('Gym equipment image not found.');
}

export async function setOwnedGymEquipmentImage(
  userId: string,
  equipmentId: string,
  input: SetGymEquipmentImageInput,
) {
  const equipment = await db.gymEquipment.findFirst({
    where: { id: equipmentId, gym: { userId } },
    select: { id: true },
  });
  if (!equipment) throw new Error('Gym equipment not found.');

  const modes = [input.clear === true, input.imageUrl != null, input.imageBase64 != null].filter(
    Boolean,
  ).length;
  if (modes !== 1) {
    throw new Error('Choose exactly one image action: clear, imageUrl, or imageBase64.');
  }

  const data = input.clear
    ? { imageUrl: null, imageData: null, imageMimeType: null }
    : input.imageUrl
      ? { imageUrl: input.imageUrl, imageData: null, imageMimeType: null }
      : (() => {
          const decoded = decodeGymEquipmentImage(input.imageBase64!, input.mimeType);
          return {
            imageUrl: null,
            imageData: decoded.bytes,
            imageMimeType: decoded.mimeType,
          };
        })();
  return db.gymEquipment.update({
    where: { id: equipment.id },
    data,
    select: {
      id: true,
      gymId: true,
      name: true,
      imageUrl: true,
      imageMimeType: true,
      updatedAt: true,
    },
  });
}

export function decodeGymEquipmentImage(
  raw: string,
  declaredMimeType?: GymEquipmentImageMimeType,
): { bytes: Uint8Array<ArrayBuffer>; mimeType: GymEquipmentImageMimeType } {
  const dataUrl = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/s.exec(raw.trim());
  const mimeType = (dataUrl?.[1] ?? declaredMimeType) as GymEquipmentImageMimeType | undefined;
  if (!mimeType || !GYM_EQUIPMENT_IMAGE_MIME_TYPES.includes(mimeType)) {
    throw new Error('Uploaded equipment image must be JPEG, PNG, or WebP.');
  }
  if (dataUrl && declaredMimeType && dataUrl[1] !== declaredMimeType) {
    throw new Error('The declared image MIME type does not match the data URL.');
  }

  const base64 = (dataUrl?.[2] ?? raw).replace(/\s/g, '');
  if (base64.length > Math.ceil((MAX_GYM_EQUIPMENT_IMAGE_BYTES * 4) / 3) + 16) {
    throw new Error('Uploaded equipment image is larger than 5 MB.');
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new Error('Invalid base64 image data.');
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length === 0) throw new Error('Uploaded equipment image is empty.');
  if (buffer.length > MAX_GYM_EQUIPMENT_IMAGE_BYTES) {
    throw new Error('Uploaded equipment image is larger than 5 MB.');
  }
  if (!matchesImageSignature(buffer, mimeType)) {
    throw new Error('Uploaded bytes do not match the declared image type.');
  }
  const bytes = new Uint8Array(new ArrayBuffer(buffer.length));
  bytes.set(buffer);
  return { bytes, mimeType };
}

async function resolveOwnedGym(userId: string, gymId?: string) {
  const resolvedId =
    gymId ??
    (
      await db.user.findUnique({
        where: { id: userId },
        select: { activeGymId: true },
      })
    )?.activeGymId;
  if (!resolvedId) {
    throw new ApiError(400, 'No active gym. Provide gymId or activate a gym first.');
  }
  const gym = await db.gym.findFirst({
    where: { id: resolvedId, userId },
    select: { id: true, name: true },
  });
  if (!gym) throw new ApiError(404, 'Gym not found.');
  return gym;
}

function equipmentImage(
  item: { id: string; imageUrl: string | null; imageMimeType: string | null; updatedAt: Date },
  baseUrl: string,
) {
  if (item.imageMimeType) {
    return {
      kind: 'uploaded',
      url: new URL(
        `/api/gym-equipment/${item.id}/image?v=${item.updatedAt.getTime()}`,
        baseUrl,
      ).toString(),
      mimeType: item.imageMimeType,
    };
  }
  return item.imageUrl ? { kind: 'external', url: item.imageUrl, mimeType: null } : null;
}

function matchesImageSignature(buffer: Buffer, mimeType: GymEquipmentImageMimeType): boolean {
  if (mimeType === 'image/jpeg') {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mimeType === 'image/png') {
    return (
      buffer.length >= 8 &&
      buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    );
  }
  return (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  );
}
