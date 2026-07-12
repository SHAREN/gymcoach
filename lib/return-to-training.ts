import type { Exercise, ProgramExercise, Set } from '@/lib/prisma-client';
import { gymWeightOptions, type GymLoadConstraints } from '@/lib/gym-loads';
import { weightIncrement } from '@/lib/progression';

// Source-backed principles from the project training-science notebook:
// - exercise skill and muscle readiness are separate qualities;
// - a forgotten movement should return with 1-2 working sets, RIR 3-4 and no failure;
// - related exercises can confirm that a muscle remained trained, but cannot
//   provide a reliable load conversion for a different movement.
//
// The exact time windows, volume ratio, Epley estimate and load fractions below
// are deterministic product heuristics. They are intentionally named so they
// are easy to revisit when the exercise model gains secondary-muscle and
// movement-pattern metadata.
export const RETURN_EXERCISE_GAP_DAYS = 42;
export const MAINTAINED_MUSCLE_RECENCY_DAYS = 14;
export const RECENT_MUSCLE_VOLUME_DAYS = 28;
export const BASELINE_MUSCLE_VOLUME_DAYS = 56;
export const MAINTAINED_MUSCLE_VOLUME_RATIO = 0.7;
export const MAINTAINED_EXERCISE_START_FRACTION = 0.85;
export const BROAD_RETURN_START_FRACTION = 0.75;

export type ReturnMode = 'normal' | 'exercise-reintro' | 'muscle-reintro' | 'new-exercise';

export interface ReturnHistorySession {
  sessionId: string;
  performedAt: Date;
  sets: Pick<Set, 'weight' | 'reps' | 'rir' | 'isDropSet'>[];
}

export interface ReturnTrainingHistory {
  exerciseLastPerformedAt: Date | null;
  muscleLastPerformedAt: Date | null;
  recentMuscleSets: number;
  baselineMuscleSetsPer28Days: number;
  exerciseSessions: ReturnHistorySession[];
}

export interface ReturnRecommendation {
  mode: ReturnMode;
  exerciseGapDays: number | null;
  muscleGapDays: number | null;
  muscleMaintained: boolean;
  recentMuscleSets: number;
  baselineMuscleSetsPer28Days: number;
  recentVolumeRatio: number | null;
  targetSets: number;
  targetRIR: number;
  weightCeiling: number | null;
  suggestedWeight: number | null;
  calibrationRequired: boolean;
  historySessionCount: number;
}

export type ReturnProgramExercise = Pick<
  ProgramExercise,
  'exerciseId' | 'targetSets' | 'targetRepsMin' | 'targetRIR'
> & {
  exercise: Pick<Exercise, 'category' | 'equipmentType' | 'usesBodyweight'>;
};

interface CalculateReturnRecommendationInput {
  programExercise: ReturnProgramExercise;
  history: ReturnTrainingHistory;
  now: Date;
  bodyweight?: number | null;
  loadConstraints?: GymLoadConstraints | null;
}

export function calculateReturnRecommendation({
  programExercise,
  history,
  now,
  bodyweight = null,
  loadConstraints = null,
}: CalculateReturnRecommendationInput): ReturnRecommendation {
  const exerciseGapDays = daysSince(history.exerciseLastPerformedAt, now);
  const muscleGapDays = daysSince(history.muscleLastPerformedAt, now);
  const recentVolumeRatio = volumeRatio(
    history.recentMuscleSets,
    history.baselineMuscleSetsPer28Days,
  );
  const muscleMaintained =
    muscleGapDays != null &&
    muscleGapDays <= MAINTAINED_MUSCLE_RECENCY_DAYS &&
    history.recentMuscleSets > 0 &&
    (history.baselineMuscleSetsPer28Days <= 0 ||
      (recentVolumeRatio != null && recentVolumeRatio >= MAINTAINED_MUSCLE_VOLUME_RATIO));

  const mode = resolveReturnMode(programExercise.exercise.category, exerciseGapDays, muscleGapDays);
  if (mode === 'normal') {
    return {
      mode,
      exerciseGapDays,
      muscleGapDays,
      muscleMaintained,
      recentMuscleSets: history.recentMuscleSets,
      baselineMuscleSetsPer28Days: round(history.baselineMuscleSetsPer28Days),
      recentVolumeRatio,
      targetSets: programExercise.targetSets,
      targetRIR: programExercise.targetRIR,
      weightCeiling: null,
      suggestedWeight: null,
      calibrationRequired: false,
      historySessionCount: history.exerciseSessions.length,
    };
  }

  const broadReturn = mode === 'muscle-reintro' || !muscleMaintained;
  const targetSets = Math.min(programExercise.targetSets, broadReturn ? 1 : 2);
  const targetRIR = Math.max(programExercise.targetRIR, broadReturn ? 4 : 3);
  const startFraction = broadReturn
    ? BROAD_RETURN_START_FRACTION
    : MAINTAINED_EXERCISE_START_FRACTION;
  const loadTargets = historicalLoadTargets({
    programExercise,
    sessions: history.exerciseSessions,
    targetRIR,
    startFraction,
    bodyweight,
    loadConstraints,
  });

  const suggestedWeight =
    loadTargets.suggestedWeight ??
    fallbackCalibrationLoad(programExercise.exercise.usesBodyweight, loadConstraints);

  return {
    mode,
    exerciseGapDays,
    muscleGapDays,
    muscleMaintained,
    recentMuscleSets: history.recentMuscleSets,
    baselineMuscleSetsPer28Days: round(history.baselineMuscleSetsPer28Days),
    recentVolumeRatio,
    targetSets,
    targetRIR,
    weightCeiling: loadTargets.weightCeiling,
    suggestedWeight,
    calibrationRequired: true,
    historySessionCount: history.exerciseSessions.length,
  };
}

function resolveReturnMode(
  category: Exercise['category'],
  exerciseGapDays: number | null,
  muscleGapDays: number | null,
): ReturnMode {
  if (category === 'CARDIO') return 'normal';
  // No history is not evidence of a break. Preserve the authored program for
  // a first-ever session instead of silently treating a new user as detrained.
  if (exerciseGapDays == null && muscleGapDays == null) return 'normal';
  if (muscleGapDays == null || muscleGapDays > RETURN_EXERCISE_GAP_DAYS) {
    return 'muscle-reintro';
  }
  if (exerciseGapDays == null) return 'new-exercise';
  if (exerciseGapDays > RETURN_EXERCISE_GAP_DAYS) return 'exercise-reintro';
  return 'normal';
}

function historicalLoadTargets({
  programExercise,
  sessions,
  targetRIR,
  startFraction,
  bodyweight,
  loadConstraints,
}: {
  programExercise: ReturnProgramExercise;
  sessions: ReturnHistorySession[];
  targetRIR: number;
  startFraction: number;
  bodyweight: number | null;
  loadConstraints: GymLoadConstraints | null;
}): { weightCeiling: number | null; suggestedWeight: number | null } {
  if (loadConstraints?.isAvailable === false) {
    return { weightCeiling: null, suggestedWeight: null };
  }

  const estimates = sessions
    .slice(0, 3)
    .map((session) =>
      bestSessionCapacity(session, programExercise.exercise.usesBodyweight, bodyweight),
    )
    .filter((value): value is number => value != null);
  if (estimates.length === 0) {
    return { weightCeiling: null, suggestedWeight: null };
  }

  const estimatedCapacity = median(estimates);
  const targetCapacityReps = programExercise.targetRepsMin + targetRIR;
  const effectiveWeightCeiling = estimatedCapacity / (1 + targetCapacityReps / 30);
  const effectiveSuggestedWeight = effectiveWeightCeiling * startFraction;
  const externalWeightCeiling = externalLoad(
    effectiveWeightCeiling,
    programExercise.exercise.usesBodyweight,
    bodyweight,
  );
  const externalSuggestedWeight = externalLoad(
    effectiveSuggestedWeight,
    programExercise.exercise.usesBodyweight,
    bodyweight,
  );
  const weightCeiling = roundLoadDown(
    externalWeightCeiling,
    programExercise.exercise.category,
    loadConstraints,
  );
  const suggestedWeight = Math.min(
    weightCeiling,
    roundLoadDown(externalSuggestedWeight, programExercise.exercise.category, loadConstraints),
  );

  return { weightCeiling, suggestedWeight };
}

function bestSessionCapacity(
  session: ReturnHistorySession,
  usesBodyweight: boolean,
  bodyweight: number | null,
): number | null {
  const estimates = session.sets
    .filter((set) => !set.isDropSet && set.reps > 0 && set.weight >= 0)
    .map((set) => {
      const effectiveLoad =
        usesBodyweight && bodyweight != null && bodyweight > 0
          ? bodyweight + set.weight
          : set.weight;
      if (effectiveLoad <= 0) return null;
      const rir = clamp(set.rir ?? 0, 0, 5);
      const repsAtFailure = clamp(set.reps + rir, 1, 30);
      return effectiveLoad * (1 + repsAtFailure / 30);
    })
    .filter((value): value is number => value != null);
  return estimates.length > 0 ? Math.max(...estimates) : null;
}

function externalLoad(
  effectiveLoad: number,
  usesBodyweight: boolean,
  bodyweight: number | null,
): number {
  if (!usesBodyweight || bodyweight == null || bodyweight <= 0) return Math.max(0, effectiveLoad);
  return Math.max(0, effectiveLoad - bodyweight);
}

function roundLoadDown(
  targetWeight: number,
  category: Exercise['category'],
  loadConstraints: GymLoadConstraints | null,
): number {
  if (!(targetWeight > 0)) return 0;

  const options = gymWeightOptions(loadConstraints, targetWeight);
  if (options.length > 0) {
    const available = options.filter((weight) => weight <= targetWeight + Number.EPSILON);
    return available.at(-1) ?? 0;
  }

  const step = weightIncrement(category);
  return round(Math.floor(targetWeight / step) * step);
}

function fallbackCalibrationLoad(
  usesBodyweight: boolean,
  loadConstraints: GymLoadConstraints | null,
): number | null {
  if (usesBodyweight) return 0;
  if (loadConstraints?.isAvailable === false) return null;
  const options = gymWeightOptions(loadConstraints, 0);
  return options[0] ?? null;
}

function daysSince(value: Date | null, now: Date): number | null {
  if (!value) return null;
  return Math.max(0, Math.floor((now.getTime() - value.getTime()) / 86_400_000));
}

function volumeRatio(recent: number, baseline: number): number | null {
  if (baseline <= 0) return recent > 0 ? 1 : null;
  return round(recent / baseline);
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
