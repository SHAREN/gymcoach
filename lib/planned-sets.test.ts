import { describe, expect, it } from 'vitest';
import {
  isPlannedExerciseComplete,
  nextPlannedSetIsDropSet,
  plannedSetCounts,
  projectSetsToTarget,
  remainingPlannedSets,
} from './planned-sets';

const regular = { isWarmup: false, isDropSet: false };
const drop = { isWarmup: false, isDropSet: true };
const warmup = { isWarmup: true, isDropSet: false };

describe('planned set helpers', () => {
  it('counts regular and drop sets separately and ignores warmups', () => {
    expect(plannedSetCounts([warmup, regular, drop, regular])).toEqual({ regular: 2, drop: 1 });
  });

  it('starts planned drop sets only after all regular sets', () => {
    const target = { targetSets: 3, targetDropSets: 2 };
    expect(nextPlannedSetIsDropSet(target, [regular, regular])).toBe(false);
    expect(nextPlannedSetIsDropSet(target, [regular, regular, regular])).toBe(true);
    expect(nextPlannedSetIsDropSet(target, [regular, regular, regular, drop, drop])).toBe(false);
  });

  it('includes an optimistic just-logged set when calculating remaining work', () => {
    const target = { targetSets: 2, targetDropSets: 1 };
    expect(remainingPlannedSets(target, [regular], regular)).toBe(1);
    expect(remainingPlannedSets(target, [regular, regular], drop)).toBe(0);
  });

  it('is complete only after both regular and drop targets are met', () => {
    const target = { targetSets: 2, targetDropSets: 1 };
    expect(isPlannedExerciseComplete(target, [regular, regular])).toBe(false);
    expect(isPlannedExerciseComplete(target, [regular, regular, drop])).toBe(true);
  });

  it('projects overflow records out of the active plan without removing warmups', () => {
    const regular1 = { ...regular, id: 'regular-1' };
    const regular2 = { ...regular, id: 'regular-2' };
    const regular3 = { ...regular, id: 'regular-3' };
    const regular4 = { ...regular, id: 'regular-4' };
    const warmup1 = { ...warmup, id: 'warmup-1' };

    const projected = projectSetsToTarget({ targetSets: 3, targetDropSets: 0 }, [
      warmup1,
      regular1,
      regular2,
      regular3,
      regular4,
    ]);

    expect(projected.visible.map((set) => set.id)).toEqual([
      'warmup-1',
      'regular-1',
      'regular-2',
      'regular-3',
    ]);
    expect(projected.overflow.map((set) => set.id)).toEqual(['regular-4']);
    expect(
      projectSetsToTarget({ targetSets: 4, targetDropSets: 0 }, [
        warmup1,
        regular1,
        regular2,
        regular3,
        regular4,
      ]).visible.map((set) => set.id),
    ).toContain('regular-4');
  });

  it('applies regular and drop-set targets independently', () => {
    const regular1 = { ...regular, id: 'regular-1' };
    const regular2 = { ...regular, id: 'regular-2' };
    const drop1 = { ...drop, id: 'drop-1' };
    const drop2 = { ...drop, id: 'drop-2' };

    const projected = projectSetsToTarget({ targetSets: 1, targetDropSets: 1 }, [
      regular1,
      regular2,
      drop1,
      drop2,
    ]);

    expect(projected.visible.map((set) => set.id)).toEqual(['regular-1', 'drop-1']);
    expect(projected.overflow.map((set) => set.id)).toEqual(['regular-2', 'drop-2']);
  });
});
