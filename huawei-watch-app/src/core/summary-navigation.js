import { currentExercise } from './workout-state.js';

export function createSummarySelection() {
  return {
    workoutSessionId: null,
    exerciseSessionId: null,
  };
}

export function selectSummaryWorkout(selection, workout, { resetExercise = true } = {}) {
  const changedWorkout = selection.workoutSessionId !== workout.session.sessionId;
  return {
    workoutSessionId: workout.session.sessionId,
    exerciseSessionId:
      resetExercise || changedWorkout || selection.exerciseSessionId === null
        ? currentExercise(workout)?.exerciseSessionId || null
        : selection.exerciseSessionId,
  };
}

export function selectedSummaryExercise(workout, selection) {
  if (!workout) {
    return null;
  }
  return (
    workout.exercises.find(
      (exercise) => exercise.exerciseSessionId === selection.exerciseSessionId,
    ) || currentExercise(workout) || workout.exercises[0] || null
  );
}

export function moveSummaryExercise(selection, workout, offset) {
  if (!workout || workout.exercises.length === 0) {
    return selection;
  }
  const selected = selectedSummaryExercise(workout, selection);
  const currentIndex = Math.max(
    0,
    workout.exercises.findIndex(
      (exercise) => exercise.exerciseSessionId === selected?.exerciseSessionId,
    ),
  );
  const nextIndex = Math.min(
    workout.exercises.length - 1,
    Math.max(0, currentIndex + offset),
  );
  return {
    ...selection,
    exerciseSessionId: workout.exercises[nextIndex].exerciseSessionId,
  };
}
