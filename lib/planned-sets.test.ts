import { describe, expect, it } from 'vitest';
import {
  isPlannedExerciseComplete,
  nextPlannedSetIsDropSet,
  plannedSetCounts,
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
});
