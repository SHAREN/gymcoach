import type { EquipmentLoadType, EquipmentType } from '@/lib/prisma-client';

export interface PlateInventoryItem {
  weightKg: number;
  quantity: number | null;
}

export interface EquipmentLoadProfile {
  equipmentId: string;
  equipmentName: string;
  equipmentType: EquipmentType;
  loadConfigurationKnown: boolean;
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
  inventoryPrecision: 'KNOWN' | 'UNKNOWN_QUANTITIES' | 'NOT_APPLICABLE' | 'UNKNOWN_CONFIG';
}

export interface GymLoadConstraints {
  equipmentType: EquipmentType;
  isAvailable?: boolean;
  dumbbellWeights?: number[];
  plateWeights?: number[];
  barWeights?: number[];
  weightOptions?: number[];
  equipmentId?: string | null;
  equipmentOptions?: ResolvedEquipmentLoadProfile[];
}

export function resolveEquipmentType(
  equipmentType: EquipmentType,
  _exerciseName: string,
): EquipmentType {
  // Do not infer a canonical equipment type from exercise names here. Name and
  // free-text semantics belong to the external MCP agent; GymCoach consumes
  // the explicit canonical field only.
  return equipmentType;
}

export function resolveEquipmentLoadProfile(
  profile: EquipmentLoadProfile,
  targetCeiling = 500,
): ResolvedEquipmentLoadProfile {
  if (!profile.loadConfigurationKnown) {
    return { ...profile, attainableLoads: [], inventoryPrecision: 'UNKNOWN_CONFIG' };
  }
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
    case 'OTHER':
      return uniquePositive(constraints.weightOptions ?? []);
    case 'BODYWEIGHT':
    case 'CARDIO':
      return [];
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
      options = constraints.weightOptions ?? [];
      break;
    case 'BODYWEIGHT':
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
  if (options.length === 0) return round(Math.max(0, targetWeight));
  return round(options.filter((value) => value <= targetWeight + Number.EPSILON).at(-1) ?? 0);
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
