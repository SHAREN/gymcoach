// Keep the live-session RSC payload deliberately small. In particular, do not
// select GymEquipment.imageData here: equipment photos can be several MiB each
// and the runner only needs identity/name, compatibility, and deterministic
// load facts required for equipment-aware recommendations.
export const liveSessionGymInclude = {
  exerciseConfigs: true,
  equipment: {
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
      platePool: {
        select: {
          id: true,
          name: true,
          plates: {
            orderBy: { weightKg: 'asc' as const },
            select: { weightKg: true, quantity: true },
          },
        },
      },
      exerciseLinks: { select: { exerciseId: true } },
    },
  },
} as const;
