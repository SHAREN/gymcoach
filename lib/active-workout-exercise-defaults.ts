export const ACTIVE_WORKOUT_EXERCISE_DEFAULTS = Object.freeze({
  targetSets: 4,
  targetDropSets: 0,
  targetRepsMin: 8,
  targetRepsMax: 12,
  targetRIR: 2,
  autoregulationMode: 'PRESERVE_RIR' as const,
  fatigueRate: null,
  loadAdjustmentPct: null,
});

export type ActiveWorkoutExerciseDefaults = typeof ACTIVE_WORKOUT_EXERCISE_DEFAULTS;
