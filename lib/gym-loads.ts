import type { EquipmentLoadType, EquipmentType, GymInventoryMode } from '@/lib/prisma-client';

export interface PlateInventoryItem {
  weightKg: number;
  // Null preserves a legacy denomination whose physical quantity is unknown.
  quantity: number | null;
}

export interface EquipmentLoadProfile {
  equipmentId: string;
  equipmentName: string;
  equipmentType: EquipmentType;
  loadType: EquipmentLoadType;
  weightOptions: number[];
  selectedLoadMultiplier: number;
  baseLoadKg: number;
  loadingSides: number;
  platePoolId: string | null;
  platePoolName?: string | null;
  plates?: PlateInventoryItem[];
}

export interface ResolvedEquipmentLoadProfile extends EquipmentLoadProfile {
  attainableLoads: number[];
  inventoryPrecision: 'KNOWN' | 'UNKNOWN_QUANTITIES' | 'NOT_APPLICABLE';
}

export interface GymLoadConstraints {
  equipmentType: EquipmentType;
  isAvailable?: boolean;
  dumbbellWeights?: number[];
  plateWeights?: number[];
  barWeights?: number[];
  weightOptions?: number[];
  // Equipment-first callers provide one profile per physical instance. A
  // selected equipmentId prevents loads from different machines being merged.
  equipmentId?: string | null;
  equipmentOptions?: ResolvedEquipmentLoadProfile[];
}

export interface ResolveExerciseInventoryInput {
  inventoryMode: GymInventoryMode;
  exercise: { id: string; name: string; equipmentType: EquipmentType };
  linkedEquipment: EquipmentLoadProfile[];
  preferredEquipmentId?: string | null;
  legacyConfig?: {
    isAvailable: boolean;
    systemProfileSupported?: boolean | null;
    weightOptions: number[];
    dumbbellWeights: number[];
    plateWeights: number[];
    barWeights: number[];
  } | null;
  sharedDumbbellWeights?: number[];
  legacyPlateWeights?: number[];
  legacyBarWeights?: number[];
}

export interface ResolvedExerciseInventory {
  isAvailable: boolean;
  source: 'equipment' | 'shared-dumbbells' | 'legacy-config' | 'legacy-gym' | 'implicit' | 'none';
  equipment: ResolvedEquipmentLoadProfile[];
  requiresEquipmentSelection: boolean;
  weightOptions: number[];
  constraints: GymLoadConstraints;
  preferredEquipmentId?: string | null;
}

export function resolveEquipmentType(
  equipmentType: EquipmentType,
  exerciseName: string,
): EquipmentType {
  if (equipmentType !== 'OTHER') return equipmentType;

  const name = exerciseName.toLocaleLowerCase();
  if (/\bbarbell\b|\bez[- ]?bar\b|штанг|ez[- ]?гриф|сз[- ]?гриф/u.test(name)) return 'BARBELL';
  if (/\bdumbbells?\b|гантел/u.test(name)) return 'DUMBBELL';
  if (/\bcable\b|трос|кроссовер/u.test(name)) return 'CABLE';
  if (/\bmachine\b|тренаж[её]р/u.test(name)) return 'MACHINE';
  return equipmentType;
}

export function gymWeightOptions(
  constraints: GymLoadConstraints | null | undefined,
  referenceWeight: number,
): number[] {
  if (!constraints || constraints.isAvailable === false) return [];

  if (constraints.equipmentOptions?.length) {
    const selected = constraints.equipmentId
      ? constraints.equipmentOptions.find((item) => item.equipmentId === constraints.equipmentId)
      : constraints.equipmentOptions.length === 1
        ? constraints.equipmentOptions[0]
        : null;
    // Never union multiple physical machines into one progression scale.
    return selected?.attainableLoads ?? [];
  }

  switch (constraints.equipmentType) {
    case 'DUMBBELL':
      return uniquePositive(constraints.dumbbellWeights ?? []);
    case 'BARBELL':
      return constructibleBarbellWeights(
        constraints.barWeights ?? [],
        constraints.plateWeights ?? [],
        Math.max(200, referenceWeight + 100),
      );
    case 'MACHINE':
    case 'CABLE':
    case 'BODYWEIGHT':
    case 'OTHER':
      return uniquePositive(constraints.weightOptions ?? []);
    default:
      return [];
  }
}

export function constrainGymWeight(
  targetWeight: number,
  referenceWeight: number,
  constraints?: GymLoadConstraints | null,
): number {
  if (!constraints || constraints.isAvailable === false || targetWeight <= 0) {
    return round(targetWeight);
  }

  if (constraints.equipmentOptions?.length) {
    const normalized = gymWeightOptions(constraints, Math.max(targetWeight, referenceWeight));
    if (normalized.length === 0) return round(targetWeight);
    return selectDirectionalWeight(normalized, targetWeight, referenceWeight);
  }

  let options: number[] = [];
  switch (constraints.equipmentType) {
    case 'DUMBBELL':
      options = constraints.dumbbellWeights ?? [];
      break;
    case 'BARBELL':
      options = constructibleBarbellWeights(
        constraints.barWeights ?? [],
        constraints.plateWeights ?? [],
        Math.max(targetWeight, referenceWeight),
      );
      break;
    case 'MACHINE':
    case 'CABLE':
    case 'BODYWEIGHT':
    case 'OTHER':
      options = constraints.weightOptions ?? [];
      break;
    case 'CARDIO':
      return round(targetWeight);
    default:
      break;
  }

  const normalized = uniquePositive(options);
  if (normalized.length === 0) return round(targetWeight);
  return selectDirectionalWeight(normalized, targetWeight, referenceWeight);
}

export function constrainGymWeightAtOrBelow(
  targetWeight: number,
  constraints?: GymLoadConstraints | null,
): number {
  if (constraints?.isAvailable === false) return 0;
  if (!constraints || targetWeight <= 0) return round(Math.max(0, targetWeight));

  const options = gymWeightOptions(constraints, targetWeight);
  if (options.length === 0) return round(targetWeight);
  return round(options.filter((value) => value <= targetWeight).at(-1) ?? 0);
}

export function constructibleBarbellWeights(
  barWeights: number[],
  plateWeights: number[],
  targetCeiling: number,
): number[] {
  const bars = uniquePositive(barWeights);
  const plates = uniquePositive(plateWeights);
  if (bars.length === 0 || plates.length === 0) return bars;

  const maxPlate = plates.at(-1) ?? 0;
  const maxTotal = Math.min(5000, Math.max(...bars, targetCeiling + maxPlate * 4 + 50));
  const plateUnits = plates.map(toUnits);
  const divisor = plateUnits.reduce(gcd);
  const scaledPlates = [...new Set(plateUnits.map((value) => value / divisor))];
  const totals = new Set<number>(bars);

  for (const bar of bars) {
    const maxPerSideUnits = Math.max(0, Math.floor(toUnits((maxTotal - bar) / 2) / divisor));
    const reachable = new Uint8Array(maxPerSideUnits + 1);
    reachable[0] = 1;
    for (let current = 0; current <= maxPerSideUnits; current += 1) {
      if (!reachable[current]) continue;
      for (const plate of scaledPlates) {
        const next = current + plate;
        if (next <= maxPerSideUnits) reachable[next] = 1;
      }
    }
    for (let perSide = 0; perSide <= maxPerSideUnits; perSide += 1) {
      if (reachable[perSide]) totals.add(round(bar + (perSide * divisor * 2) / 100));
    }
  }

  return [...totals].sort((a, b) => a - b);
}

export function resolveEquipmentLoadProfile(
  profile: EquipmentLoadProfile,
  targetCeiling = 500,
): ResolvedEquipmentLoadProfile {
  if (profile.loadType === 'FIXED' || profile.loadType === 'SELECTORIZED') {
    return {
      ...profile,
      attainableLoads: uniquePositive(profile.weightOptions),
      inventoryPrecision: 'NOT_APPLICABLE',
    };
  }
  if (profile.loadType === 'PLATE_LOADED') {
    const resolved = constructiblePlateLoadedWeights(
      profile.baseLoadKg,
      profile.loadingSides,
      profile.plates ?? [],
      targetCeiling,
    );
    return { ...profile, ...resolved };
  }
  return { ...profile, attainableLoads: [], inventoryPrecision: 'NOT_APPLICABLE' };
}

export function constructiblePlateLoadedWeights(
  baseLoadKg: number,
  loadingSides: number,
  plates: PlateInventoryItem[],
  targetCeiling: number,
): Pick<ResolvedEquipmentLoadProfile, 'attainableLoads' | 'inventoryPrecision'> {
  const base = round(Math.max(0, baseLoadKg));
  const sides = Number.isInteger(loadingSides) && loadingSides > 0 ? loadingSides : 2;
  const normalized = [
    ...new Map(
      plates
        .filter((item) => Number.isFinite(item.weightKg) && item.weightKg > 0)
        .map((item) => [
          round(item.weightKg),
          { weightKg: round(item.weightKg), quantity: item.quantity },
        ]),
    ).values(),
  ].sort((a, b) => a.weightKg - b.weightKg);
  if (normalized.length === 0) {
    return { attainableLoads: base > 0 ? [base] : [], inventoryPrecision: 'KNOWN' };
  }

  const hasUnknownQuantity = normalized.some((item) => item.quantity == null);
  const maxPlate = normalized.at(-1)?.weightKg ?? 0;
  const maxTotal = Math.min(5000, Math.max(base, targetCeiling + maxPlate * sides * 4 + 50));
  const maxAddedUnits = Math.max(0, toUnits(maxTotal - base));
  const reachable = new Uint8Array(maxAddedUnits + 1);
  reachable[0] = 1;

  for (const item of normalized) {
    const increment = toUnits(item.weightKg * sides);
    if (increment <= 0) continue;
    if (item.quantity == null) {
      // Legacy inventory recorded that the denomination exists but omitted its
      // count. Preserve that uncertainty and the previous usable behavior.
      for (let current = 0; current + increment <= maxAddedUnits; current += 1) {
        if (reachable[current]) reachable[current + increment] = 1;
      }
      continue;
    }
    const usableGroups = Math.floor(Math.max(0, item.quantity) / sides);
    for (let copy = 0; copy < usableGroups; copy += 1) {
      for (let current = maxAddedUnits - increment; current >= 0; current -= 1) {
        if (reachable[current]) reachable[current + increment] = 1;
      }
    }
  }

  const attainableLoads: number[] = [];
  for (let added = 0; added <= maxAddedUnits; added += 1) {
    if (reachable[added]) attainableLoads.push(round(base + added / 100));
  }
  return {
    attainableLoads,
    inventoryPrecision: hasUnknownQuantity ? 'UNKNOWN_QUANTITIES' : 'KNOWN',
  };
}

export function resolveExerciseInventory({
  inventoryMode,
  exercise,
  linkedEquipment,
  preferredEquipmentId = null,
  legacyConfig = null,
  sharedDumbbellWeights = [],
  legacyPlateWeights = [],
  legacyBarWeights = [],
}: ResolveExerciseInventoryInput): ResolvedExerciseInventory {
  const equipment = linkedEquipment.map((item) => resolveEquipmentLoadProfile(item));
  if (equipment.length > 0) {
    const requiresEquipmentSelection = equipment.length > 1;
    const resolvedPreferredEquipmentId = preferredEquipmentId
      ? (equipment.find((item) => item.equipmentId === preferredEquipmentId)?.equipmentId ?? null)
      : null;
    const selectedEquipment =
      equipment.find((item) => item.equipmentId === resolvedPreferredEquipmentId) ??
      (equipment.length === 1 ? equipment[0]! : null);
    const weightOptions = selectedEquipment?.attainableLoads ?? [];
    return {
      isAvailable: true,
      source: 'equipment',
      equipment,
      requiresEquipmentSelection,
      weightOptions,
      preferredEquipmentId: resolvedPreferredEquipmentId,
      constraints: {
        equipmentType: resolveEquipmentType(exercise.equipmentType, exercise.name),
        isAvailable: true,
        equipmentOptions: equipment,
        equipmentId: selectedEquipment?.equipmentId ?? null,
      },
    };
  }

  const equipmentType = resolveEquipmentType(exercise.equipmentType, exercise.name);
  if (
    inventoryMode === 'EQUIPMENT_FIRST' &&
    legacyConfig?.systemProfileSupported != null &&
    (equipmentType === 'DUMBBELL' || equipmentType === 'BARBELL')
  ) {
    if (
      equipmentType === 'DUMBBELL' &&
      legacyConfig.systemProfileSupported &&
      sharedDumbbellWeights.length > 0
    ) {
      const weights = uniquePositive(sharedDumbbellWeights);
      return {
        isAvailable: true,
        source: 'shared-dumbbells',
        equipment: [],
        requiresEquipmentSelection: false,
        weightOptions: weights,
        constraints: { equipmentType, isAvailable: true, dumbbellWeights: weights },
      };
    }
    const constraints = { equipmentType, isAvailable: false } satisfies GymLoadConstraints;
    return {
      isAvailable: false,
      source: 'none',
      equipment: [],
      requiresEquipmentSelection: false,
      weightOptions: [],
      constraints,
    };
  }
  if (equipmentType === 'DUMBBELL' && sharedDumbbellWeights.length > 0) {
    const weights = uniquePositive(sharedDumbbellWeights);
    return {
      isAvailable: true,
      source: 'shared-dumbbells',
      equipment: [],
      requiresEquipmentSelection: false,
      weightOptions: weights,
      constraints: { equipmentType, isAvailable: true, dumbbellWeights: weights },
    };
  }

  if (legacyConfig) {
    const constraints: GymLoadConstraints = {
      equipmentType,
      isAvailable: legacyConfig.isAvailable,
      weightOptions: legacyConfig.weightOptions,
      dumbbellWeights: legacyConfig.dumbbellWeights.length
        ? legacyConfig.dumbbellWeights
        : sharedDumbbellWeights,
      plateWeights: legacyConfig.plateWeights.length
        ? legacyConfig.plateWeights
        : legacyPlateWeights,
      barWeights: legacyConfig.barWeights.length ? legacyConfig.barWeights : legacyBarWeights,
    };
    return {
      isAvailable: legacyConfig.isAvailable,
      source: 'legacy-config',
      equipment: [],
      requiresEquipmentSelection: false,
      weightOptions: gymWeightOptions(constraints, 200),
      constraints,
    };
  }

  if (equipmentType === 'BODYWEIGHT' || equipmentType === 'CARDIO') {
    const constraints = { equipmentType, isAvailable: true } satisfies GymLoadConstraints;
    return {
      isAvailable: true,
      source: 'implicit',
      equipment: [],
      requiresEquipmentSelection: false,
      weightOptions: [],
      constraints,
    };
  }

  if (inventoryMode === 'LEGACY') {
    const constraints: GymLoadConstraints = {
      equipmentType,
      isAvailable: true,
      dumbbellWeights: sharedDumbbellWeights,
      plateWeights: legacyPlateWeights,
      barWeights: legacyBarWeights,
    };
    return {
      isAvailable: true,
      source: 'legacy-gym',
      equipment: [],
      requiresEquipmentSelection: false,
      weightOptions: gymWeightOptions(constraints, 200),
      constraints,
    };
  }

  const constraints = { equipmentType, isAvailable: false } satisfies GymLoadConstraints;
  return {
    isAvailable: false,
    source: 'none',
    equipment: [],
    requiresEquipmentSelection: false,
    weightOptions: [],
    constraints,
  };
}

function selectDirectionalWeight(options: number[], target: number, reference: number): number {
  if (target < reference) {
    const lower = options.filter((value) => value < reference);
    if (lower.length === 0) return round(reference);
    return round(nearest(lower, target));
  }
  if (target > reference) {
    const higher = options.filter((value) => value > reference);
    if (higher.length === 0) return round(reference);
    return round(nearest(higher, target));
  }
  return round(nearest(options, target));
}

function nearest(options: number[], target: number): number {
  return options.reduce((best, value) => {
    const distance = Math.abs(value - target);
    const bestDistance = Math.abs(best - target);
    return distance < bestDistance || (distance === bestDistance && value < best) ? value : best;
  }, options[0]!);
}

function uniquePositive(values: number[]): number[] {
  return [
    ...new Set(values.filter((value) => Number.isFinite(value) && value > 0).map(round)),
  ].sort((a, b) => a - b);
}

function toUnits(value: number): number {
  return Math.round(value * 100);
}

function gcd(a: number, b: number): number {
  let left = Math.abs(a);
  let right = Math.abs(b);
  while (right !== 0) {
    const next = left % right;
    left = right;
    right = next;
  }
  return left || 1;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
