import { validateSetRecord, validateSyncSnapshot, validateWatchEvent, WatchEventType } from './contracts.js';

const ACTIVE_EXERCISE_FIELDS = ['exerciseId', 'exerciseSessionId', 'order'];
const SET_STARTED_FIELDS = ['setId', 'exerciseSessionId', 'setNumber', 'startedAt'];
const SET_DELETED_FIELDS = ['setId', 'deletedAt', 'baseRevision'];

export function activeWorkoutFromSnapshot(snapshot) {
  validateSyncSnapshot(snapshot);
  return {
    session: clone(snapshot.workoutSession),
    exercises: snapshot.exerciseSessions.map(clone).sort((left, right) => left.order - right.order),
    activeExerciseId: snapshot.workoutSession.activeExerciseId,
    activeSetId: snapshot.workoutSession.activeSetId,
    revision: snapshot.revision,
    completedSets: snapshot.setRecords.map(clone),
    startedAt: snapshot.workoutSession.startedAt,
    pendingSet: null,
  };
}

export function applyWorkoutEvent(activeWorkout, event) {
  validateWatchEvent(event);
  validateActiveWorkout(activeWorkout);
  if (event.sessionId !== activeWorkout.session.sessionId) {
    throw new Error('Workout event belongs to a different session.');
  }
  if (event.revision > activeWorkout.revision + 1) {
    throw new Error('Workout event revision gap requires a new snapshot.');
  }
  if (event.revision < activeWorkout.revision) {
    return clone(activeWorkout);
  }

  const next = clone(activeWorkout);
  if (event.type === WatchEventType.ACTIVE_EXERCISE_CHANGED) {
    applyActiveExerciseChanged(next, event.payload);
  } else if (event.type === WatchEventType.SET_STARTED) {
    applySetStarted(next, event.payload);
  } else if (event.type === WatchEventType.SET_UPDATED) {
    applySetUpsert(next, event.payload, event, false);
  } else if (event.type === WatchEventType.SET_COMPLETED) {
    applySetUpsert(next, event.payload, event, true);
  } else if (event.type === WatchEventType.SET_DELETED) {
    applySetDeleted(next, event.payload);
  } else if (event.type === WatchEventType.WORKOUT_FINISHED) {
    applyWorkoutFinished(next, event.payload);
  } else {
    throw new Error(`Stage 3 does not handle workout event ${event.type}.`);
  }

  next.revision = event.revision;
  next.session.revision = event.revision;
  next.session.updatedAt = event.timestamp;
  next.session.updatedBy = event.source;
  return next;
}

export function currentExercise(activeWorkout) {
  if (!activeWorkout) {
    return null;
  }
  return (
    activeWorkout.exercises.find(
      (exercise) => exercise.exerciseId === activeWorkout.activeExerciseId,
    ) || activeWorkout.exercises[0] || null
  );
}

export function nextExercise(activeWorkout, offset) {
  const exercises = activeWorkout.exercises;
  if (exercises.length === 0) {
    throw new Error('Workout has no exercises.');
  }
  const current = currentExercise(activeWorkout);
  const index = Math.max(0, exercises.findIndex((exercise) => exercise.exerciseId === current.exerciseId));
  const nextIndex = Math.min(exercises.length - 1, Math.max(0, index + offset));
  return exercises[nextIndex];
}

export function completedSetsForExercise(activeWorkout, exerciseSessionId) {
  return activeWorkout.completedSets.filter((set) => set.exerciseSessionId === exerciseSessionId);
}

function applyActiveExerciseChanged(activeWorkout, payload) {
  exactPayload(payload, ACTIVE_EXERCISE_FIELDS, 'ACTIVE_EXERCISE_CHANGED');
  opaque(payload.exerciseId, 'ACTIVE_EXERCISE_CHANGED.exerciseId');
  opaque(payload.exerciseSessionId, 'ACTIVE_EXERCISE_CHANGED.exerciseSessionId');
  positiveInteger(payload.order, 'ACTIVE_EXERCISE_CHANGED.order');
  const exercise = activeWorkout.exercises.find(
    (candidate) =>
      candidate.exerciseId === payload.exerciseId &&
      candidate.exerciseSessionId === payload.exerciseSessionId &&
      candidate.order === payload.order,
  );
  if (!exercise) {
    throw new Error('ACTIVE_EXERCISE_CHANGED references an unknown exercise.');
  }
  for (const candidate of activeWorkout.exercises) {
    if (candidate.status === 'ACTIVE') {
      candidate.status = 'PENDING';
    }
  }
  exercise.status = 'ACTIVE';
  activeWorkout.activeExerciseId = exercise.exerciseId;
  activeWorkout.session.activeExerciseId = exercise.exerciseId;
}

function applySetStarted(activeWorkout, payload) {
  exactPayload(payload, SET_STARTED_FIELDS, 'SET_STARTED');
  opaque(payload.setId, 'SET_STARTED.setId');
  opaque(payload.exerciseSessionId, 'SET_STARTED.exerciseSessionId');
  positiveInteger(payload.setNumber, 'SET_STARTED.setNumber');
  nonNegativeInteger(payload.startedAt, 'SET_STARTED.startedAt');
  requireExercise(activeWorkout, payload.exerciseSessionId);
  activeWorkout.pendingSet = clone(payload);
  activeWorkout.activeSetId = payload.setId;
  activeWorkout.session.activeSetId = payload.setId;
}

function applySetUpsert(activeWorkout, payload, event, completed) {
  validateSetRecord(payload);
  if (payload.sessionId !== activeWorkout.session.sessionId) {
    throw new Error(`${event.type} set belongs to a different session.`);
  }
  requireExercise(activeWorkout, payload.exerciseSessionId);
  if (payload.revision !== event.revision) {
    throw new Error(`${event.type} set revision must match the event revision.`);
  }
  const index = activeWorkout.completedSets.findIndex((set) => set.setId === payload.setId);
  if (index >= 0) {
    activeWorkout.completedSets[index] = clone(payload);
  } else {
    activeWorkout.completedSets.push(clone(payload));
  }
  activeWorkout.completedSets.sort(
    (left, right) => left.completedAt - right.completedAt || left.setNumber - right.setNumber,
  );
  if (completed && activeWorkout.activeSetId === payload.setId) {
    activeWorkout.pendingSet = null;
    activeWorkout.activeSetId = null;
    activeWorkout.session.activeSetId = null;
  }
}

function applySetDeleted(activeWorkout, payload) {
  exactPayload(payload, SET_DELETED_FIELDS, 'SET_DELETED');
  opaque(payload.setId, 'SET_DELETED.setId');
  nonNegativeInteger(payload.deletedAt, 'SET_DELETED.deletedAt');
  positiveInteger(payload.baseRevision, 'SET_DELETED.baseRevision');
  activeWorkout.completedSets = activeWorkout.completedSets.filter(
    (set) => set.setId !== payload.setId,
  );
  if (activeWorkout.activeSetId === payload.setId) {
    activeWorkout.pendingSet = null;
    activeWorkout.activeSetId = null;
    activeWorkout.session.activeSetId = null;
  }
}

function applyWorkoutFinished(activeWorkout, payload) {
  if (!isPlainObject(payload) || !Object.prototype.hasOwnProperty.call(payload, 'finishedAt')) {
    throw new Error('WORKOUT_FINISHED requires finishedAt.');
  }
  nonNegativeInteger(payload.finishedAt, 'WORKOUT_FINISHED.finishedAt');
  activeWorkout.session.status = 'FINISHED';
  activeWorkout.session.finishedAt = payload.finishedAt;
  activeWorkout.pendingSet = null;
  activeWorkout.activeSetId = null;
  activeWorkout.session.activeSetId = null;
}

function validateActiveWorkout(activeWorkout) {
  if (!isPlainObject(activeWorkout) || !isPlainObject(activeWorkout.session)) {
    throw new Error('Active workout state is invalid.');
  }
  if (!Array.isArray(activeWorkout.exercises) || !Array.isArray(activeWorkout.completedSets)) {
    throw new Error('Active workout collections are invalid.');
  }
  positiveInteger(activeWorkout.revision, 'Active workout revision');
  nonNegativeInteger(activeWorkout.startedAt, 'Active workout startedAt');
  for (const set of activeWorkout.completedSets) {
    validateSetRecord(set);
  }
}

function requireExercise(activeWorkout, exerciseSessionId) {
  const exercise = activeWorkout.exercises.find(
    (candidate) => candidate.exerciseSessionId === exerciseSessionId,
  );
  if (!exercise) {
    throw new Error('Set references an unknown exercise session.');
  }
  return exercise;
}

function exactPayload(payload, fields, label) {
  if (!isPlainObject(payload)) {
    throw new Error(`${label} payload must be an object.`);
  }
  const allowed = new Set(fields);
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(payload, field)) {
      throw new Error(`${label} payload is missing ${field}.`);
    }
  }
  for (const field of Object.keys(payload)) {
    if (!allowed.has(field)) {
      throw new Error(`${label} payload contains unknown field ${field}.`);
    }
  }
}

function opaque(value, label) {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    codePointLength(value) > 128
  ) {
    throw new Error(`${label} must be a non-empty opaque ID of at most 128 characters.`);
  }
}

function codePointLength(value) {
  let length = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        index += 1;
      }
    }
    length += 1;
  }
  return length;
}

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
}

function nonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
