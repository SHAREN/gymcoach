import { db } from '@/lib/db';
import { listOwnedGymEquipment } from '@/lib/gym-equipment';
import { listOwnedGymPlatePools, upsertOwnedGymPlatePool } from '@/lib/gym-plate-pools';
import {
  getOwnedGymSystemProfiles,
  saveOwnedBarbellSystemProfile,
  saveOwnedDumbbellsSystemProfile,
} from '@/lib/gym-system-profiles';
import type {
  GymBarbellSystemProfileInput,
  GymDumbbellsSystemProfileInput,
  GymPlatePoolInput,
} from '@/lib/schemas/gym-equipment';

export async function listMcpGyms(userId: string) {
  const [user, gyms] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { activeGymId: true } }),
    db.gym.findMany({
      where: { userId },
      orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { exerciseConfigs: true, equipment: true, sessions: true } },
      },
    }),
  ]);

  const activeGymId = user?.activeGymId ?? null;
  return {
    activeGymId,
    gyms: gyms.map((gym) => ({
      id: gym.id,
      name: gym.name,
      isActive: gym.id === activeGymId,
      createdAt: gym.createdAt.toISOString(),
      updatedAt: gym.updatedAt.toISOString(),
      physicalEquipmentCount: gym._count.equipment,
      exerciseConfigCount: gym._count.exerciseConfigs,
      sessionCount: gym._count.sessions,
    })),
  };
}

export async function resolveOwnedGymId(userId: string, requestedGymId?: string) {
  if (requestedGymId) {
    const gym = await db.gym.findFirst({
      where: { id: requestedGymId, userId },
      select: { id: true },
    });
    if (!gym) throw new Error('Gym not found.');
    return gym.id;
  }

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { activeGymId: true },
  });
  if (!user?.activeGymId) throw new Error('No gym selected and no active gym is configured.');

  const gym = await db.gym.findFirst({
    where: { id: user.activeGymId, userId },
    select: { id: true },
  });
  if (!gym) throw new Error('Gym not found.');
  return gym.id;
}

export async function updateMcpGymFreeWeights(
  userId: string,
  requestedGymId: string | undefined,
  patch: {
    dumbbellWeights?: number[];
    plateWeights?: number[];
    barWeights?: number[];
  },
) {
  const gymId = await resolveOwnedGymId(userId, requestedGymId);
  let profiles = await getOwnedGymSystemProfiles(userId, gymId);

  if (patch.dumbbellWeights !== undefined) {
    profiles = await saveOwnedDumbbellsSystemProfile(userId, gymId, {
      weightsKg: patch.dumbbellWeights,
      exerciseIds: profiles.dumbbells.exerciseLinks.map((exercise) => exercise.id),
    });
  }

  if (patch.plateWeights !== undefined || patch.barWeights !== undefined) {
    const current = profiles.barbell;
    const large = current.families.find((family) => family.family === 'LARGE')!;
    const existingLargeBarsByWeight = new Map(
      large.bars.map((bar) => [round(bar.baseLoadKg), bar.id] as const),
    );
    const existingLargePlateQuantity = new Map(
      large.pool.plates.map((plate) => [round(plate.weightKg), plate.quantity] as const),
    );

    const families: GymBarbellSystemProfileInput['families'] = current.families.map((family) => {
      if (family.family !== 'LARGE') {
        return {
          family: family.family,
          loadingSides: family.loadingSides,
          bars: family.bars.map((bar) => ({ equipmentId: bar.id, weightKg: bar.baseLoadKg })),
          plates: family.pool.plates.map((plate) => ({
            weightKg: plate.weightKg,
            quantity: plate.quantity,
          })),
        };
      }

      const barWeights = patch.barWeights ?? family.bars.map((bar) => bar.baseLoadKg);
      const plateWeights = patch.plateWeights ?? family.pool.plates.map((plate) => plate.weightKg);
      return {
        family: 'LARGE' as const,
        loadingSides: family.loadingSides,
        bars: barWeights.map((weightKg) => ({
          ...(existingLargeBarsByWeight.get(round(weightKg))
            ? { equipmentId: existingLargeBarsByWeight.get(round(weightKg)) }
            : {}),
          weightKg,
        })),
        plates: plateWeights.map((weightKg) => ({
          weightKg,
          quantity: existingLargePlateQuantity.get(round(weightKg)) ?? null,
        })),
      };
    });

    profiles = await saveOwnedBarbellSystemProfile(userId, gymId, {
      exerciseIds: current.exerciseLinks.map((exercise) => exercise.id),
      families,
    });
  }

  const gym = await db.gym.findFirstOrThrow({
    where: { id: gymId, userId },
    select: {
      id: true,
      name: true,
      dumbbellWeights: true,
      plateWeights: true,
      barWeights: true,
      updatedAt: true,
    },
  });
  return { ...gym, systemProfiles: profiles };
}

export async function updateMcpGymSystemProfile(
  userId: string,
  requestedGymId: string | undefined,
  input:
    | ({ kind: 'DUMBBELLS' } & GymDumbbellsSystemProfileInput)
    | ({ kind: 'BARBELL' } & GymBarbellSystemProfileInput),
) {
  const gymId = await resolveOwnedGymId(userId, requestedGymId);
  if (input.kind === 'DUMBBELLS') {
    return saveOwnedDumbbellsSystemProfile(userId, gymId, {
      weightsKg: input.weightsKg,
      exerciseIds: input.exerciseIds,
    });
  }
  return saveOwnedBarbellSystemProfile(userId, gymId, {
    exerciseIds: input.exerciseIds,
    families: input.families,
  });
}

export async function upsertMcpGymPlatePool(
  userId: string,
  requestedGymId: string | undefined,
  input: GymPlatePoolInput,
) {
  const gymId = await resolveOwnedGymId(userId, requestedGymId);
  return upsertOwnedGymPlatePool(userId, gymId, input);
}

export async function getMcpGymInventory(userId: string, baseUrl: string, requestedGymId?: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { activeGymId: true },
  });
  const gymId = requestedGymId ?? user?.activeGymId ?? null;
  if (!gymId) throw new Error('No gym selected and no active gym is configured.');

  const [gym, exercises] = await Promise.all([
    db.gym.findFirst({
      where: { id: gymId, userId },
      select: {
        id: true,
        name: true,
        dumbbellWeights: true,
        plateWeights: true,
        barWeights: true,
        createdAt: true,
        updatedAt: true,
        exerciseConfigs: {
          orderBy: { exercise: { name: 'asc' } },
          select: {
            exerciseId: true,
            isAvailable: true,
            weightOptions: true,
            preferredEquipmentId: true,
            systemProfileSupported: true,
            exercise: {
              select: {
                id: true,
                name: true,
                muscleGroup: true,
                category: true,
                equipmentType: true,
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
      },
    }),
  ]);
  if (!gym) throw new Error('Gym not found.');

  const [equipment, platePools, systemProfiles] = await Promise.all([
    listOwnedGymEquipment(userId, gym.id),
    listOwnedGymPlatePools(userId, gym.id),
    getOwnedGymSystemProfiles(userId, gym.id),
  ]);
  const configByExercise = new Map(gym.exerciseConfigs.map((config) => [config.exerciseId, config]));

  return {
    gym: {
      id: gym.id,
      name: gym.name,
      isActive: gym.id === (user?.activeGymId ?? null),
      createdAt: gym.createdAt.toISOString(),
      updatedAt: gym.updatedAt.toISOString(),
    },
    // Compatibility projection for older MCP clients. New agents should prefer
    // systemProfiles + platePools because those preserve family/count semantics.
    sharedFreeWeights: {
      dumbbellWeightsKg: gym.dumbbellWeights,
      plateWeightsKg: gym.plateWeights,
      barWeightsKg: gym.barWeights,
    },
    systemProfiles,
    platePools,
    equipment: equipment.map((item) => ({
      ...item,
      image: item.image
        ? {
            ...item.image,
            url: item.image.url.startsWith('/')
              ? new URL(item.image.url, baseUrl).toString()
              : item.image.url,
          }
        : null,
      loadFacts: item.loadConfigurationKnown
        ? {
            state: 'KNOWN' as const,
            loadType: item.loadType,
            selectedLoadMultiplier: item.selectedLoadMultiplier,
            baseLoadKg: item.baseLoadKg,
            loadingSides: item.loadingSides,
            platePoolId: item.platePoolId,
            weightOptionsKg: item.weightOptions,
          }
        : {
            state: 'UNKNOWN' as const,
            instruction:
              'Do not infer manufacturer, model, plate mechanics or selectable loads. Ask the trainee if those facts are required.',
          },
    })),
    exerciseAvailability: exercises.map((exercise) => {
      const config = configByExercise.get(exercise.id);
      return {
        ...exercise,
        isAvailable: config?.isAvailable ?? true,
        configuredWeightOptionsKg: config?.weightOptions ?? [],
        preferredEquipmentId: config?.preferredEquipmentId ?? null,
        systemProfileSupported: config?.systemProfileSupported ?? null,
        explicitlyConfigured: config != null,
      };
    }),
  };
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
