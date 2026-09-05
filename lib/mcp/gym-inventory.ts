import { db } from '@/lib/db';
import { listOwnedGymEquipment } from '@/lib/gym-equipment';

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

async function resolveOwnedGymId(userId: string, requestedGymId?: string) {
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
  return db.gym.update({
    where: { id: gymId },
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

  const equipment = await listOwnedGymEquipment(userId, gym.id);
  const configByExercise = new Map(gym.exerciseConfigs.map((config) => [config.exerciseId, config]));

  return {
    gym: {
      id: gym.id,
      name: gym.name,
      isActive: gym.id === (user?.activeGymId ?? null),
      createdAt: gym.createdAt.toISOString(),
      updatedAt: gym.updatedAt.toISOString(),
    },
    sharedFreeWeights: {
      dumbbellWeightsKg: gym.dumbbellWeights,
      plateWeightsKg: gym.plateWeights,
      barWeightsKg: gym.barWeights,
    },
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
    })),
    exerciseAvailability: exercises.map((exercise) => {
      const config = configByExercise.get(exercise.id);
      return {
        ...exercise,
        isAvailable: config?.isAvailable ?? true,
        configuredWeightOptionsKg: config?.weightOptions ?? [],
        explicitlyConfigured: config != null,
      };
    }),
  };
}
