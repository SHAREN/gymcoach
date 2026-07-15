import { MAX_MESSAGE_BYTES, SCHEMA_VERSION, PROTOCOL_VERSION, utf8ByteLength } from './messages.js';

export const MAX_FILE_BYTES = 4_000_000;

export const WatchEventType = Object.freeze({
  WORKOUT_STARTED: 'WORKOUT_STARTED',
  WORKOUT_PAUSED: 'WORKOUT_PAUSED',
  WORKOUT_RESUMED: 'WORKOUT_RESUMED',
  WORKOUT_FINISHED: 'WORKOUT_FINISHED',
  ACTIVE_EXERCISE_CHANGED: 'ACTIVE_EXERCISE_CHANGED',
  SET_STARTED: 'SET_STARTED',
  SET_UPDATED: 'SET_UPDATED',
  SET_COMPLETED: 'SET_COMPLETED',
  SET_DELETED: 'SET_DELETED',
  REST_STARTED: 'REST_STARTED',
  REST_UPDATED: 'REST_UPDATED',
  REST_FINISHED: 'REST_FINISHED',
  REST_SKIPPED: 'REST_SKIPPED',
  SENSOR_BATCH_RECORDED: 'SENSOR_BATCH_RECORDED',
  HEART_RATE_UPDATED: 'HEART_RATE_UPDATED',
  WATCH_CONNECTED: 'WATCH_CONNECTED',
  WATCH_DISCONNECTED: 'WATCH_DISCONNECTED',
  SYNC_REQUESTED: 'SYNC_REQUESTED',
  SYNC_SNAPSHOT: 'SYNC_SNAPSHOT',
  SYNC_ACKNOWLEDGED: 'SYNC_ACKNOWLEDGED',
});

const EVENT_TYPES = new Set(Object.values(WatchEventType));
const SOURCES = new Set(['PHONE', 'WATCH']);
const WORKOUT_STATUSES = new Set(['ACTIVE', 'PAUSED', 'FINISHED']);
const EXERCISE_STATUSES = new Set(['PENDING', 'ACTIVE', 'COMPLETED', 'SKIPPED']);
const SENSOR_PHASES = new Set(['WORKOUT', 'SET', 'REST', 'PAUSE', 'WARMUP', 'RECOVERY']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const WATCH_EVENT_FIELDS = [
  'protocolVersion',
  'schemaVersion',
  'eventId',
  'sessionId',
  'type',
  'timestamp',
  'source',
  'deviceId',
  'revision',
  'payload',
];
const SYNC_SNAPSHOT_FIELDS = [
  'protocolVersion',
  'schemaVersion',
  'snapshotId',
  'sessionId',
  'timestamp',
  'source',
  'deviceId',
  'revision',
  'workoutSession',
  'exerciseSessions',
  'setRecords',
  'sensorSamples',
  'pendingEvents',
];
const WORKOUT_SESSION_FIELDS = [
  'sessionId',
  'workoutProgramId',
  'userId',
  'status',
  'startedAt',
  'finishedAt',
  'activeExerciseId',
  'activeSetId',
  'revision',
  'updatedAt',
  'updatedBy',
];
const EXERCISE_SESSION_FIELDS = [
  'exerciseSessionId',
  'sessionId',
  'exerciseId',
  'exerciseName',
  'order',
  'status',
  'targetSets',
  'targetReps',
  'targetRir',
  'restDurationSeconds',
];
const SET_RECORD_REQUIRED_FIELDS = [
  'setId',
  'sessionId',
  'exerciseSessionId',
  'setNumber',
  'weight',
  'reps',
  'rir',
  'startedAt',
  'completedAt',
  'source',
  'heartRateSummary',
  'sensorSummary',
  'revision',
];
const SET_RECORD_OPTIONAL_FIELDS = ['setType', 'comment'];
const HEART_RATE_FIELDS = ['min', 'max', 'average', 'start', 'end', 'sampleCount'];
const SENSOR_SAMPLE_FIELDS = [
  'sampleId',
  'sessionId',
  'exerciseSessionId',
  'setId',
  'phase',
  'sensorType',
  'value',
  'unit',
  'timestamp',
  'source',
  'valid',
  'quality',
];
const SENSOR_BATCH_FIELDS = [
  'protocolVersion',
  'schemaVersion',
  'batchId',
  'sessionId',
  'source',
  'deviceId',
  'createdAt',
  'sequence',
  'totalSequences',
  'sampleCount',
  'samples',
];
const REST_HEART_RATE_FIELDS = [
  'startedAt',
  'finishedAt',
  'start',
  'min',
  'average',
  'at30Seconds',
  'at60Seconds',
  'drop30Seconds',
  'drop60Seconds',
  'sampleCount',
];

export class DataEnvelopeTooLargeError extends Error {
  constructor(actualBytes, maxBytes = MAX_FILE_BYTES) {
    super(`Data envelope is ${actualBytes} bytes; the file limit is below ${maxBytes} bytes.`);
    this.name = 'DataEnvelopeTooLargeError';
    this.actualBytes = actualBytes;
    this.maxBytes = maxBytes;
  }
}

export function validateWatchEvent(value) {
  exactObject(value, WATCH_EVENT_FIELDS, [], 'WatchEvent');
  wireVersion(value, 'WatchEvent');
  uuid(value.eventId, 'WatchEvent.eventId');
  opaqueId(value.sessionId, 'WatchEvent.sessionId');
  enumValue(value.type, EVENT_TYPES, 'WatchEvent.type');
  nonNegativeInteger(value.timestamp, 'WatchEvent.timestamp');
  enumValue(value.source, SOURCES, 'WatchEvent.source');
  nonBlankString(value.deviceId, 'WatchEvent.deviceId');
  positiveInteger(value.revision, 'WatchEvent.revision');
  plainObject(value.payload, 'WatchEvent.payload');
  return value;
}

export function validateSyncSnapshot(value) {
  exactObject(value, SYNC_SNAPSHOT_FIELDS, [], 'SyncSnapshot');
  wireVersion(value, 'SyncSnapshot');
  uuid(value.snapshotId, 'SyncSnapshot.snapshotId');
  opaqueId(value.sessionId, 'SyncSnapshot.sessionId');
  nonNegativeInteger(value.timestamp, 'SyncSnapshot.timestamp');
  enumValue(value.source, SOURCES, 'SyncSnapshot.source');
  nonBlankString(value.deviceId, 'SyncSnapshot.deviceId');
  positiveInteger(value.revision, 'SyncSnapshot.revision');
  validateWorkoutSession(value.workoutSession);
  arrayOf(value.exerciseSessions, validateExerciseSession, 'SyncSnapshot.exerciseSessions');
  arrayOf(value.setRecords, validateSetRecord, 'SyncSnapshot.setRecords');
  arrayOf(value.sensorSamples, validateSensorSample, 'SyncSnapshot.sensorSamples');
  arrayOf(value.pendingEvents, validateWatchEvent, 'SyncSnapshot.pendingEvents');

  if (value.workoutSession.sessionId !== value.sessionId) {
    throw new Error('SyncSnapshot workout session ID does not match the envelope.');
  }
  for (const exercise of value.exerciseSessions) {
    sameSession(exercise.sessionId, value.sessionId, 'SyncSnapshot exercise');
  }
  for (const set of value.setRecords) {
    sameSession(set.sessionId, value.sessionId, 'SyncSnapshot set');
  }
  for (const sample of value.sensorSamples) {
    sameSession(sample.sessionId, value.sessionId, 'SyncSnapshot sensor sample');
  }
  for (const event of value.pendingEvents) {
    sameSession(event.sessionId, value.sessionId, 'SyncSnapshot pending event');
  }
  uniqueBy(value.exerciseSessions, (exercise) => exercise.exerciseSessionId, 'exerciseSessionId');
  uniqueBy(value.exerciseSessions, (exercise) => exercise.order, 'exercise order');
  uniqueBy(value.setRecords, (set) => set.setId, 'setId');
  const activeExercises = value.exerciseSessions.filter((exercise) => exercise.status === 'ACTIVE');
  if (activeExercises.length !== 1) {
    throw new Error('SyncSnapshot must contain exactly one ACTIVE exercise.');
  }
  if (activeExercises[0].exerciseId !== value.workoutSession.activeExerciseId) {
    throw new Error('SyncSnapshot activeExerciseId does not reference the ACTIVE exercise.');
  }
  const exerciseSessionIds = new Set(
    value.exerciseSessions.map((exercise) => exercise.exerciseSessionId),
  );
  for (const set of value.setRecords) {
    if (!exerciseSessionIds.has(set.exerciseSessionId)) {
      throw new Error('SyncSnapshot set references an unknown exercise session.');
    }
    if (set.revision > value.revision) {
      throw new Error('SyncSnapshot set revision exceeds the snapshot revision.');
    }
  }
  if (value.workoutSession.revision !== value.revision) {
    throw new Error('SyncSnapshot workout revision must match the envelope revision.');
  }
  return value;
}

export function validateWorkoutSession(value) {
  exactObject(value, WORKOUT_SESSION_FIELDS, [], 'WorkoutSession');
  opaqueId(value.sessionId, 'WorkoutSession.sessionId');
  opaqueId(value.workoutProgramId, 'WorkoutSession.workoutProgramId');
  opaqueId(value.userId, 'WorkoutSession.userId');
  enumValue(value.status, WORKOUT_STATUSES, 'WorkoutSession.status');
  nonNegativeInteger(value.startedAt, 'WorkoutSession.startedAt');
  nullableNonNegativeInteger(value.finishedAt, 'WorkoutSession.finishedAt');
  nullableOpaqueId(value.activeExerciseId, 'WorkoutSession.activeExerciseId');
  nullableOpaqueId(value.activeSetId, 'WorkoutSession.activeSetId');
  positiveInteger(value.revision, 'WorkoutSession.revision');
  nonNegativeInteger(value.updatedAt, 'WorkoutSession.updatedAt');
  enumValue(value.updatedBy, SOURCES, 'WorkoutSession.updatedBy');
  return value;
}

export function validateExerciseSession(value) {
  exactObject(value, EXERCISE_SESSION_FIELDS, [], 'ExerciseSession');
  opaqueId(value.exerciseSessionId, 'ExerciseSession.exerciseSessionId');
  opaqueId(value.sessionId, 'ExerciseSession.sessionId');
  opaqueId(value.exerciseId, 'ExerciseSession.exerciseId');
  nonBlankString(value.exerciseName, 'ExerciseSession.exerciseName');
  positiveInteger(value.order, 'ExerciseSession.order');
  enumValue(value.status, EXERCISE_STATUSES, 'ExerciseSession.status');
  positiveInteger(value.targetSets, 'ExerciseSession.targetSets');
  nonNegativeInteger(value.targetReps, 'ExerciseSession.targetReps');
  boundedInteger(value.targetRir, 0, 5, 'ExerciseSession.targetRir');
  nonNegativeInteger(value.restDurationSeconds, 'ExerciseSession.restDurationSeconds');
  return value;
}

export function validateSetRecord(value) {
  exactObject(value, SET_RECORD_REQUIRED_FIELDS, SET_RECORD_OPTIONAL_FIELDS, 'SetRecord');
  opaqueId(value.setId, 'SetRecord.setId');
  opaqueId(value.sessionId, 'SetRecord.sessionId');
  opaqueId(value.exerciseSessionId, 'SetRecord.exerciseSessionId');
  positiveInteger(value.setNumber, 'SetRecord.setNumber');
  boundedNumber(value.weight, 0, 500, 'SetRecord.weight');
  boundedInteger(value.reps, 1, 100, 'SetRecord.reps');
  if (value.rir !== null) {
    boundedInteger(value.rir, 0, 5, 'SetRecord.rir');
  }
  nullableStringIfPresent(value, 'setType', 'SetRecord.setType');
  nullableStringIfPresent(value, 'comment', 'SetRecord.comment');
  nonNegativeInteger(value.startedAt, 'SetRecord.startedAt');
  nonNegativeInteger(value.completedAt, 'SetRecord.completedAt');
  if (value.startedAt > value.completedAt) {
    throw new Error('SetRecord.startedAt must not exceed completedAt.');
  }
  enumValue(value.source, SOURCES, 'SetRecord.source');
  validateHeartRateSummary(value.heartRateSummary);
  plainObject(value.sensorSummary, 'SetRecord.sensorSummary');
  positiveInteger(value.revision, 'SetRecord.revision');
  return value;
}

export function validateSensorSample(value) {
  return validateSensorSampleValue(value);
}

export function validateSensorBatch(value) {
  exactObject(value, SENSOR_BATCH_FIELDS, [], 'SensorBatch');
  wireVersion(value, 'SensorBatch');
  uuid(value.batchId, 'SensorBatch.batchId');
  opaqueId(value.sessionId, 'SensorBatch.sessionId');
  enumValue(value.source, SOURCES, 'SensorBatch.source');
  nonBlankString(value.deviceId, 'SensorBatch.deviceId');
  if (codePointLength(value.deviceId) > 128) {
    throw new Error('SensorBatch.deviceId must not exceed 128 characters.');
  }
  nonNegativeInteger(value.createdAt, 'SensorBatch.createdAt');
  positiveInteger(value.sequence, 'SensorBatch.sequence');
  positiveInteger(value.totalSequences, 'SensorBatch.totalSequences');
  if (value.sequence > value.totalSequences) {
    throw new Error('SensorBatch.sequence must not exceed totalSequences.');
  }
  positiveInteger(value.sampleCount, 'SensorBatch.sampleCount');
  arrayOf(value.samples, validateSensorSampleValue, 'SensorBatch.samples');
  if (value.samples.length !== value.sampleCount) {
    throw new Error('SensorBatch.sampleCount must match samples length.');
  }
  for (const sample of value.samples) {
    sameSession(sample.sessionId, value.sessionId, 'SensorBatch sample');
    if (sample.source !== value.source) {
      throw new Error('SensorBatch sample source differs from the batch source.');
    }
  }
  return value;
}

export function validateRestHeartRateSummary(value) {
  exactObject(value, REST_HEART_RATE_FIELDS, [], 'RestHeartRateSummary');
  nonNegativeInteger(value.startedAt, 'RestHeartRateSummary.startedAt');
  nonNegativeInteger(value.finishedAt, 'RestHeartRateSummary.finishedAt');
  if (value.finishedAt < value.startedAt) {
    throw new Error('RestHeartRateSummary.finishedAt must not precede startedAt.');
  }
  nullablePositiveNumber(value.start, 'RestHeartRateSummary.start');
  nullablePositiveNumber(value.min, 'RestHeartRateSummary.min');
  nullablePositiveNumber(value.average, 'RestHeartRateSummary.average');
  nullablePositiveNumber(value.at30Seconds, 'RestHeartRateSummary.at30Seconds');
  nullablePositiveNumber(value.at60Seconds, 'RestHeartRateSummary.at60Seconds');
  nullableFiniteNumber(value.drop30Seconds, 'RestHeartRateSummary.drop30Seconds');
  nullableFiniteNumber(value.drop60Seconds, 'RestHeartRateSummary.drop60Seconds');
  nonNegativeInteger(value.sampleCount, 'RestHeartRateSummary.sampleCount');
  return value;
}

export function serializeWatchEvent(value) {
  return serializeValidated(value, validateWatchEvent);
}

export function parseWatchEvent(serialized) {
  return parseValidated(serialized, validateWatchEvent);
}

export function serializeSyncSnapshot(value) {
  return serializeValidated(value, validateSyncSnapshot);
}

export function parseSyncSnapshot(serialized) {
  return parseValidated(serialized, validateSyncSnapshot);
}

export function serializeWorkoutSession(value) {
  return serializeValidated(value, validateWorkoutSession);
}

export function parseWorkoutSession(serialized) {
  return parseValidated(serialized, validateWorkoutSession);
}

export function serializeExerciseSession(value) {
  return serializeValidated(value, validateExerciseSession);
}

export function parseExerciseSession(serialized) {
  return parseValidated(serialized, validateExerciseSession);
}

export function serializeSetRecord(value) {
  return serializeValidated(value, validateSetRecord);
}

export function parseSetRecord(serialized) {
  return parseValidated(serialized, validateSetRecord);
}

export function serializeSensorBatch(value) {
  return serializeValidated(value, validateSensorBatch);
}

export function parseSensorBatch(serialized) {
  return parseValidated(serialized, validateSensorBatch);
}

export function serializeRestHeartRateSummary(value) {
  return serializeValidated(value, validateRestHeartRateSummary);
}

export function parseRestHeartRateSummary(serialized) {
  return parseValidated(serialized, validateRestHeartRateSummary);
}

export function encodeSensorBatchForTransport(value) {
  const serialized = serializeSensorBatch(value);
  const bytes = utf8ByteLength(serialized);
  if (bytes >= MAX_FILE_BYTES) {
    throw new DataEnvelopeTooLargeError(bytes, MAX_FILE_BYTES);
  }
  return { mode: 'FILE', serialized, bytes };
}

export function encodeWatchEventForTransport(value) {
  return encodeDataEnvelope(serializeWatchEvent(value));
}

export function encodeSyncSnapshotForTransport(value) {
  return encodeDataEnvelope(serializeSyncSnapshot(value));
}

export function assertDataEnvelopeSize(serialized, mode) {
  const bytes = utf8ByteLength(serialized);
  if (mode === 'MESSAGE') {
    if (bytes > MAX_MESSAGE_BYTES) {
      throw new DataEnvelopeTooLargeError(bytes, MAX_MESSAGE_BYTES);
    }
  } else if (mode === 'FILE') {
    if (bytes >= MAX_FILE_BYTES) {
      throw new DataEnvelopeTooLargeError(bytes, MAX_FILE_BYTES);
    }
  } else {
    throw new Error(`Unsupported delivery mode: ${mode}`);
  }
  return bytes;
}

export function createWatchEvent({
  deviceId,
  eventId,
  payload,
  revision,
  sessionId,
  source = 'WATCH',
  timestamp,
  type,
}) {
  return validateWatchEvent({
    protocolVersion: PROTOCOL_VERSION,
    schemaVersion: SCHEMA_VERSION,
    eventId,
    sessionId,
    type,
    timestamp,
    source,
    deviceId,
    revision,
    payload,
  });
}

function encodeDataEnvelope(serialized) {
  const bytes = utf8ByteLength(serialized);
  if (bytes <= MAX_MESSAGE_BYTES) {
    return { mode: 'MESSAGE', serialized, bytes };
  }
  if (bytes < MAX_FILE_BYTES) {
    return { mode: 'FILE', serialized, bytes };
  }
  throw new DataEnvelopeTooLargeError(bytes, MAX_FILE_BYTES);
}

function validateHeartRateSummary(value) {
  exactObject(value, HEART_RATE_FIELDS, [], 'HeartRateSummary');
  nullablePositiveNumber(value.min, 'HeartRateSummary.min');
  nullablePositiveNumber(value.max, 'HeartRateSummary.max');
  nullablePositiveNumber(value.average, 'HeartRateSummary.average');
  nullablePositiveNumber(value.start, 'HeartRateSummary.start');
  nullablePositiveNumber(value.end, 'HeartRateSummary.end');
  nonNegativeInteger(value.sampleCount, 'HeartRateSummary.sampleCount');
}

function validateSensorSampleValue(value) {
  exactObject(value, SENSOR_SAMPLE_FIELDS, [], 'SensorSample');
  uuid(value.sampleId, 'SensorSample.sampleId');
  opaqueId(value.sessionId, 'SensorSample.sessionId');
  nullableOpaqueId(value.exerciseSessionId, 'SensorSample.exerciseSessionId');
  nullableOpaqueId(value.setId, 'SensorSample.setId');
  enumValue(value.phase, SENSOR_PHASES, 'SensorSample.phase');
  nonBlankString(value.sensorType, 'SensorSample.sensorType');
  if (!isSensorValue(value.value)) {
    throw new Error('SensorSample.value has an unsupported JSON scalar type.');
  }
  nonBlankString(value.unit, 'SensorSample.unit');
  nonNegativeInteger(value.timestamp, 'SensorSample.timestamp');
  enumValue(value.source, SOURCES, 'SensorSample.source');
  if (typeof value.valid !== 'boolean') {
    throw new Error('SensorSample.valid must be boolean.');
  }
  if (value.quality !== null && typeof value.quality !== 'string') {
    throw new Error('SensorSample.quality must be a string or null.');
  }
  return value;
}

function exactObject(value, requiredFields, optionalFields, label) {
  plainObject(value, label);
  const allowed = new Set([...requiredFields, ...optionalFields]);
  for (const field of requiredFields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`${label} is missing ${field}.`);
    }
  }
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) {
      throw new Error(`${label} contains unknown field ${field}.`);
    }
  }
}

function wireVersion(value, label) {
  if (value.protocolVersion !== PROTOCOL_VERSION || value.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`${label} has an unsupported protocol version.`);
  }
}

function opaqueId(value, label) {
  nonBlankString(value, label);
  if (codePointLength(value) > 128) {
    throw new Error(`${label} must not exceed 128 characters.`);
  }
}

function nullableOpaqueId(value, label) {
  if (value !== null) {
    opaqueId(value, label);
  }
}

function uuid(value, label) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new Error(`${label} must be a UUID.`);
  }
}

function plainObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${label} must be a plain object.`);
  }
}

function nonBlankString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-blank string.`);
  }
}

function enumValue(value, allowed, label) {
  if (!allowed.has(value)) {
    throw new Error(`${label} has an unsupported value.`);
  }
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

function nullableNonNegativeInteger(value, label) {
  if (value !== null) {
    nonNegativeInteger(value, label);
  }
}

function nonNegativeNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number.`);
  }
}

function boundedInteger(value, minimum, maximum, label) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
}

function boundedNumber(value, minimum, maximum, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be a finite number from ${minimum} to ${maximum}.`);
  }
}

function nullablePositiveNumber(value, label) {
  if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)) {
    throw new Error(`${label} must be a positive finite number or null.`);
  }
}

function nullableFiniteNumber(value, label) {
  if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) {
    throw new Error(`${label} must be a finite number or null.`);
  }
}

function nullableStringIfPresent(value, field, label) {
  if (Object.prototype.hasOwnProperty.call(value, field)) {
    const item = value[field];
    if (item !== null && typeof item !== 'string') {
      throw new Error(`${label} must be a string or null.`);
    }
  }
}

function arrayOf(value, validator, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  for (const item of value) {
    validator(item);
  }
}

function sameSession(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} has a different session ID.`);
  }
}

function uniqueBy(values, selector, label) {
  const selected = values.map(selector);
  if (new Set(selected).size !== selected.length) {
    throw new Error(`SyncSnapshot contains duplicate ${label} values.`);
  }
}

function isSensorValue(value) {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

function serializeValidated(value, validator) {
  validator(value);
  return JSON.stringify(value);
}

function parseValidated(serialized, validator) {
  return validator(JSON.parse(serialized));
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
