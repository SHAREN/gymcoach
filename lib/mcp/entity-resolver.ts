import { exerciseNameDictionaries } from '@/i18n/exercise-names';
import { db } from '@/lib/db';
import { resolveEntityName, type EntityResolution } from '@/lib/mcp/entity-match';

export interface ResolveEntitiesInput {
  gym?: string;
  gymId?: string;
  exercises?: string[];
  equipment?: string[];
  maxCandidates?: number;
}

export async function resolveMcpEntities(userId: string, input: ResolveEntitiesInput) {
  const maxCandidates = Math.max(1, Math.min(input.maxCandidates ?? 5, 10));
  const [gyms, user, exercises, recentSets, activeProgram] = await Promise.all([
    db.gym.findMany({
      where: { userId },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        inventoryMode: true,
        _count: { select: { equipment: true, sessions: true } },
      },
    }),
    db.user.findUnique({ where: { id: userId }, select: { activeGymId: true } }),
    db.exercise.findMany({
      where: { userId },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        muscleGroup: true,
        category: true,
        equipmentType: true,
        aliases: { select: { alias: true } },
      },
    }),
    db.set.findMany({
      where: { session: { userId } },
      orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
      take: 500,
      select: { exerciseId: true },
    }),
    db.program.findFirst({
      where: { userId, isActive: true },
      select: {
        workouts: { select: { exercises: { select: { exerciseId: true } } } },
      },
    }),
  ]);

  const gymResolution = input.gymId
    ? resolveGymById(input.gymId, gyms, user?.activeGymId ?? null)
    : input.gym
      ? resolveEntityName(
          input.gym,
          gyms.map((gym) => ({
            id: gym.id,
            canonicalName: gym.name,
            aliases: [gym.name],
            contextBonus: gym.id === user?.activeGymId ? 0.03 : 0,
            reasons: gym.id === user?.activeGymId ? ['active-gym'] : [],
            metadata: {
              inventoryMode: gym.inventoryMode,
              equipmentCount: gym._count.equipment,
              sessionCount: gym._count.sessions,
              active: gym.id === user?.activeGymId,
            },
          })),
          maxCandidates,
        )
      : null;

  const contextGymId = input.gymId ?? gymResolution?.selected?.id ?? user?.activeGymId ?? null;
  const gymContext = contextGymId
    ? await db.gym.findFirst({
        where: { id: contextGymId, userId },
        select: {
          id: true,
          name: true,
          equipment: {
            orderBy: { name: 'asc' },
            select: {
              id: true,
              name: true,
              manufacturer: true,
              modelName: true,
              equipmentType: true,
              loadType: true,
              aliases: { select: { alias: true } },
              exerciseLinks: { select: { exerciseId: true } },
            },
          },
          exerciseConfigs: {
            where: { isAvailable: true },
            select: { exerciseId: true, preferredEquipmentId: true },
          },
        },
      })
    : null;

  const recentRank = new Map<string, number>();
  recentSets.forEach((row, index) => {
    if (!recentRank.has(row.exerciseId)) recentRank.set(row.exerciseId, index);
  });
  const activeExerciseIds = new Set(
    activeProgram?.workouts.flatMap((workout) => workout.exercises.map((row) => row.exerciseId)) ?? [],
  );
  const gymExerciseIds = new Set<string>();
  const preferredEquipmentIds = new Set<string>();
  for (const config of gymContext?.exerciseConfigs ?? []) {
    gymExerciseIds.add(config.exerciseId);
    if (config.preferredEquipmentId) preferredEquipmentIds.add(config.preferredEquipmentId);
  }
  for (const equipment of gymContext?.equipment ?? []) {
    for (const link of equipment.exerciseLinks) gymExerciseIds.add(link.exerciseId);
  }

  const exerciseRows = exercises.map((exercise) => {
    const russian = exerciseNameDictionaries.ru?.[exercise.name];
    const english = exerciseNameDictionaries.en?.[exercise.name];
    let contextBonus = 0;
    const reasons: string[] = [];
    const recent = recentRank.get(exercise.id);
    if (recent != null) {
      contextBonus += Math.max(0.01, 0.07 * (1 - Math.min(recent, 100) / 100));
      reasons.push('recent-history');
    }
    if (activeExerciseIds.has(exercise.id)) {
      contextBonus += 0.05;
      reasons.push('active-program');
    }
    if (gymExerciseIds.has(exercise.id)) {
      contextBonus += 0.05;
      reasons.push('available-in-gym');
    }
    return {
      id: exercise.id,
      canonicalName: exercise.name,
      displayName: russian,
      aliases: [
        exercise.name,
        russian,
        english,
        ...exercise.aliases.map((row) => row.alias),
      ].filter((value): value is string => Boolean(value)),
      contextBonus,
      reasons,
      metadata: {
        muscleGroup: exercise.muscleGroup,
        category: exercise.category,
        equipmentType: exercise.equipmentType,
      },
    };
  });

  const equipmentRows = (gymContext?.equipment ?? []).map((equipment) => ({
    id: equipment.id,
    canonicalName: equipment.name,
    aliases: [
      equipment.name,
      equipment.manufacturer,
      equipment.modelName,
      [equipment.manufacturer, equipment.modelName].filter(Boolean).join(' '),
      ...equipment.aliases.map((row) => row.alias),
    ].filter((value): value is string => Boolean(value)),
    contextBonus: preferredEquipmentIds.has(equipment.id) ? 0.04 : 0,
    reasons: preferredEquipmentIds.has(equipment.id) ? ['preferred-equipment'] : [],
    metadata: {
      gymId: gymContext?.id ?? null,
      gymName: gymContext?.name ?? null,
      manufacturer: equipment.manufacturer,
      modelName: equipment.modelName,
      equipmentType: equipment.equipmentType,
      loadType: equipment.loadType,
      linkedExerciseIds: equipment.exerciseLinks.map((link) => link.exerciseId),
    },
  }));

  const exerciseResults = (input.exercises ?? []).map((query) =>
    resolveEntityName(query, exerciseRows, maxCandidates),
  );
  const equipmentResults = (input.equipment ?? []).map((query) =>
    resolveEntityName(query, equipmentRows, maxCandidates),
  );
  const all = [...(gymResolution ? [gymResolution] : []), ...exerciseResults, ...equipmentResults];

  return {
    status: all.every((row) => row.status === 'RESOLVED') ? 'READY' : 'NEEDS_RESOLUTION',
    contextGym: gymContext ? { id: gymContext.id, name: gymContext.name } : null,
    gym: gymResolution,
    exercises: exerciseResults,
    equipment: equipmentResults,
    issues: all
      .filter((row) => row.status !== 'RESOLVED')
      .map((row) => ({
        errorCode: row.status === 'AMBIGUOUS' ? 'AMBIGUOUS_ENTITY' : 'ENTITY_NOT_FOUND',
        input: row.query,
        candidates: row.candidates,
      })),
  };
}

function resolveGymById(
  gymId: string,
  gyms: Array<{
    id: string;
    name: string;
    inventoryMode: string;
    _count: { equipment: number; sessions: number };
  }>,
  activeGymId: string | null,
): EntityResolution {
  const gym = gyms.find((row) => row.id === gymId);
  if (!gym) return { query: gymId, status: 'NOT_FOUND', selected: null, candidates: [] };
  const selected = {
    id: gym.id,
    canonicalName: gym.name,
    confidence: 1,
    reasons: ['exact-id', ...(gym.id === activeGymId ? ['active-gym'] : [])],
    metadata: {
      inventoryMode: gym.inventoryMode,
      equipmentCount: gym._count.equipment,
      sessionCount: gym._count.sessions,
      active: gym.id === activeGymId,
    },
  };
  return { query: gymId, status: 'RESOLVED', selected, candidates: [selected] };
}
