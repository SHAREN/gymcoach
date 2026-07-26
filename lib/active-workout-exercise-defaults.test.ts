import { describe, expect, it } from 'vitest';
import { ACTIVE_WORKOUT_EXERCISE_DEFAULTS } from '@/lib/active-workout-exercise-defaults';

describe('active workout exercise defaults', () => {
  it('keeps the web add flow and mobile bootstrap on one frozen contract', () => {
    expect(ACTIVE_WORKOUT_EXERCISE_DEFAULTS).toEqual({
      targetSets: 4,
      targetDropSets: 0,
      targetRepsMin: 8,
      targetRepsMax: 12,
      targetRIR: 2,
      autoregulationMode: 'PRESERVE_RIR',
      fatigueRate: null,
      loadAdjustmentPct: null,
    });
    expect(Object.isFrozen(ACTIVE_WORKOUT_EXERCISE_DEFAULTS)).toBe(true);
  });
});
