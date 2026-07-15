import { completedSetsForExercise } from './workout-state.js';
import { workoutElapsedMs } from './timers.js';

export function summarizeExercise(activeWorkout, exerciseSessionId) {
  if (!activeWorkout) {
    return null;
  }
  const exercise = activeWorkout.exercises.find(
    (candidate) => candidate.exerciseSessionId === exerciseSessionId,
  );
  if (!exercise) {
    return null;
  }
  const sets = completedSetsForExercise(activeWorkout, exerciseSessionId);
  const setIds = new Set(sets.map((set) => set.setId));
  return {
    exercise,
    ...summarizeSets(sets),
    ...summarizeRests(
      (activeWorkout.restSummaries || []).filter((summary) => setIds.has(summary.setId)),
    ),
  };
}

export function summarizeWorkout(activeWorkout, now = Date.now()) {
  if (!activeWorkout) {
    return null;
  }
  const finishedAt = activeWorkout.session.finishedAt;
  const effectiveEnd = Number.isInteger(finishedAt) ? finishedAt : now;
  return {
    durationMs: workoutElapsedMs(activeWorkout, effectiveEnd),
    exerciseCount: activeWorkout.exercises.length,
    ...summarizeSets(activeWorkout.completedSets),
    ...summarizeRests(activeWorkout.restSummaries || []),
  };
}

function summarizeSets(sets) {
  const validRir = sets.map((set) => set.rir).filter(Number.isFinite);
  const heartRateSummaries = sets
    .map((set) => set.heartRateSummary)
    .filter(
      (summary) =>
        summary &&
        Number.isFinite(summary.average) &&
        Number.isFinite(summary.max) &&
        Number.isInteger(summary.sampleCount) &&
        summary.sampleCount > 0,
    );
  const heartRateSamples = heartRateSummaries.reduce(
    (total, summary) => total + summary.sampleCount,
    0,
  );
  const weightedHeartRate = heartRateSummaries.reduce(
    (total, summary) => total + summary.average * summary.sampleCount,
    0,
  );
  return {
    setCount: sets.length,
    totalVolume: sets.reduce((total, set) => total + set.weight * set.reps, 0),
    averageRir:
      validRir.length === 0
        ? null
        : validRir.reduce((total, rir) => total + rir, 0) / validRir.length,
    averageSetHeartRate: heartRateSamples === 0 ? null : weightedHeartRate / heartRateSamples,
    maximumHeartRate:
      heartRateSummaries.length === 0
        ? null
        : Math.max(...heartRateSummaries.map((summary) => summary.max)),
    heartRateSampleCount: heartRateSamples,
  };
}

function summarizeRests(restSummaries) {
  const valid = restSummaries.filter(
    (summary) =>
      Number.isFinite(summary.average) &&
      Number.isInteger(summary.sampleCount) &&
      summary.sampleCount > 0,
  );
  const sampleCount = valid.reduce((total, summary) => total + summary.sampleCount, 0);
  const weightedHeartRate = valid.reduce(
    (total, summary) => total + summary.average * summary.sampleCount,
    0,
  );
  return {
    averageRestHeartRate: sampleCount === 0 ? null : weightedHeartRate / sampleCount,
    averageRecovery30: averageFinite(restSummaries.map((summary) => summary.drop30Seconds)),
    averageRecovery60: averageFinite(restSummaries.map((summary) => summary.drop60Seconds)),
    restHeartRateSampleCount: sampleCount,
  };
}

function averageFinite(values) {
  const valid = values.filter(Number.isFinite);
  return valid.length === 0
    ? null
    : valid.reduce((total, value) => total + value, 0) / valid.length;
}
