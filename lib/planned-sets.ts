export const MAX_TARGET_DROP_SETS = 10;
export const DROP_SET_TRANSITION_REST_SEC = 15;

export interface PlannedSetTarget {
  targetSets: number;
  targetDropSets?: number | null;
}

export interface PlannedSetLike {
  isWarmup: boolean;
  isDropSet: boolean;
}

export interface PlannedSetCounts {
  regular: number;
  drop: number;
}

export interface PlannedSetProjection<T extends PlannedSetLike> {
  visible: T[];
  overflow: T[];
}

export function plannedSetCounts(sets: readonly PlannedSetLike[]): PlannedSetCounts {
  let regular = 0;
  let drop = 0;
  for (const set of sets) {
    if (set.isWarmup) continue;
    if (set.isDropSet) drop += 1;
    else regular += 1;
  }
  return { regular, drop };
}

export function targetDropSets(target: PlannedSetTarget): number {
  return Math.max(0, target.targetDropSets ?? 0);
}

export function projectSetsToTarget<T extends PlannedSetLike>(
  target: PlannedSetTarget,
  sets: readonly T[],
): PlannedSetProjection<T> {
  const visible: T[] = [];
  const overflow: T[] = [];
  let regular = 0;
  let drop = 0;
  const dropTarget = targetDropSets(target);

  for (const set of sets) {
    if (set.isWarmup) {
      visible.push(set);
      continue;
    }

    if (set.isDropSet) {
      if (drop < dropTarget) {
        visible.push(set);
        drop += 1;
      } else {
        overflow.push(set);
      }
      continue;
    }

    if (regular < target.targetSets) {
      visible.push(set);
      regular += 1;
    } else {
      overflow.push(set);
    }
  }

  return { visible, overflow };
}

export function remainingPlannedSets(
  target: PlannedSetTarget,
  sets: readonly PlannedSetLike[],
  additionalSet?: PlannedSetLike | null,
): number {
  const counts = plannedSetCounts(additionalSet ? [...sets, additionalSet] : sets);
  return (
    Math.max(0, target.targetSets - counts.regular) +
    Math.max(0, targetDropSets(target) - counts.drop)
  );
}

export function isPlannedExerciseComplete(
  target: PlannedSetTarget,
  sets: readonly PlannedSetLike[],
): boolean {
  return remainingPlannedSets(target, sets) === 0;
}

export function nextPlannedSetIsDropSet(
  target: PlannedSetTarget,
  sets: readonly PlannedSetLike[],
): boolean {
  const counts = plannedSetCounts(sets);
  return counts.regular >= target.targetSets && counts.drop < targetDropSets(target);
}
