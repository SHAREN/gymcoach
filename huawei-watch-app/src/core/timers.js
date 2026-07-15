export function workoutElapsedMs(activeWorkout, now) {
  if (!activeWorkout) {
    return 0;
  }
  const timing = activeWorkout.timing || emptyTiming();
  const currentPause = timing.pauseStartedAt === null ? 0 : Math.max(0, now - timing.pauseStartedAt);
  return Math.max(0, now - activeWorkout.startedAt - timing.accumulatedPauseMs - currentPause);
}

export function setElapsedMs(activeWorkout, now) {
  const pendingSet = activeWorkout?.pendingSet;
  const startedAt = pendingSet?.startedAt;
  if (!Number.isInteger(startedAt)) {
    return 0;
  }
  const pauseStartedAt = pendingSet.pauseStartedAt;
  const effectiveNow = Number.isInteger(pauseStartedAt) ? pauseStartedAt : now;
  return Math.max(0, effectiveNow - startedAt - (pendingSet.accumulatedPauseMs || 0));
}

export function restRemainingMs(activeWorkout, now) {
  const rest = activeWorkout?.rest;
  if (!rest) {
    return 0;
  }
  if (Number.isInteger(rest.pausedRemainingMs)) {
    return Math.max(0, rest.pausedRemainingMs);
  }
  return Math.max(0, rest.restEndsAt - now);
}

export function restTimerState(activeWorkout, now) {
  const remainingMs = restRemainingMs(activeWorkout, now);
  return {
    remainingMs,
    remainingSeconds: Math.ceil(remainingMs / 1_000),
    paused: activeWorkout?.session?.status === 'PAUSED',
    expired: Boolean(activeWorkout?.rest) && remainingMs === 0,
  };
}

export function emptyTiming() {
  return {
    accumulatedPauseMs: 0,
    pauseStartedAt: null,
  };
}
