import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const schemaDir = join(root, 'schemas', 'v1');
const examplesDir = join(root, 'examples');
const fixturesDir = join(root, 'fixtures');
const draft202012 = 'https://json-schema.org/draft/2020-12/schema';
const p2pMaxBytes = 1_024;
const p2pTargetBytes = 900;
const fileMaxBytes = 4_000_000;
const fileTargetBytes = Math.floor(3.5 * 1024 * 1024);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha256Pattern = /^[0-9a-f]{64}$/;

const expectedSchemas = new Set([
  'active-workout-runtime.schema.json',
  'batch-envelope.schema.json',
  'conflict-record.schema.json',
  'control-message.schema.json',
  'exercise-session.schema.json',
  'file-transfer-envelope.schema.json',
  'heart-rate-summary.schema.json',
  'rest-heart-rate-summary.schema.json',
  'sensor-sample.schema.json',
  'sensor-batch.schema.json',
  'set-record.schema.json',
  'sync-ack.schema.json',
  'sync-snapshot.schema.json',
  'watch-event.schema.json',
  'workout-session.schema.json',
]);

const phases = new Set(['WORKOUT', 'SET', 'REST', 'PAUSE', 'WARMUP', 'RECOVERY']);
const eventTypes = new Set([
  'WORKOUT_STARTED',
  'WORKOUT_PAUSED',
  'WORKOUT_RESUMED',
  'WORKOUT_FINISHED',
  'ACTIVE_EXERCISE_CHANGED',
  'SET_STARTED',
  'SET_UPDATED',
  'SET_COMPLETED',
  'SET_DELETED',
  'REST_STARTED',
  'REST_UPDATED',
  'REST_FINISHED',
  'REST_SKIPPED',
  'SENSOR_BATCH_RECORDED',
  'HEART_RATE_UPDATED',
  'WATCH_CONNECTED',
  'WATCH_DISCONNECTED',
  'SYNC_REQUESTED',
  'SYNC_SNAPSHOT',
  'SYNC_ACKNOWLEDGED',
]);
const sources = new Set(['PHONE', 'WATCH']);
const controlMessageTypes = new Set(['PING', 'PONG', 'SYNC_REQUESTED', 'SYNC_SNAPSHOT']);
const ackStatuses = new Set(['APPLIED', 'DUPLICATE', 'STALE', 'CONFLICT', 'REJECTED']);
const opaqueDomainIdSchemas = [
  ['workout-session.schema.json', 'sessionId'],
  ['workout-session.schema.json', 'workoutProgramId'],
  ['workout-session.schema.json', 'userId'],
  ['exercise-session.schema.json', 'exerciseSessionId'],
  ['exercise-session.schema.json', 'sessionId'],
  ['exercise-session.schema.json', 'exerciseId'],
  ['set-record.schema.json', 'setId'],
  ['set-record.schema.json', 'sessionId'],
  ['set-record.schema.json', 'exerciseSessionId'],
  ['sensor-sample.schema.json', 'sessionId'],
  ['sensor-batch.schema.json', 'sessionId'],
  ['active-workout-runtime.schema.json', 'sessionId'],
  ['active-workout-runtime.schema.json', 'activeExerciseId'],
  ['active-workout-runtime.schema.json', 'activeSetId'],
  ['file-transfer-envelope.schema.json', 'sessionId'],
  ['file-transfer-envelope.schema.json', 'payloadId'],
  ['watch-event.schema.json', 'sessionId'],
  ['sync-ack.schema.json', 'sessionId'],
  ['sync-snapshot.schema.json', 'sessionId'],
  ['batch-envelope.schema.json', 'sessionId'],
  ['conflict-record.schema.json', 'sessionId'],
  ['conflict-record.schema.json', 'entityId'],
];

function validateWireVersion(value, label) {
  assert.equal(value.protocolVersion, '1.0', `${label}.protocolVersion must be 1.0`);
  assert.equal(value.schemaVersion, 1, `${label}.schemaVersion must be 1`);
}

function validateOpaqueMessageId(value, label) {
  assert.equal(typeof value, 'string', `${label} must be a string`);
  assert.ok(value.length >= 1, `${label} must not be empty`);
  assert.ok(value.length <= 128, `${label} must not exceed 128 characters`);
}

function validateControlDeviceId(value, label) {
  assert.equal(typeof value, 'string', `${label} must be a string`);
  assert.ok(value.length >= 1, `${label} must not be empty`);
  assert.ok(value.length <= 128, `${label} must not exceed 128 characters`);
}

function validateOpaqueDomainId(value, label) {
  assert.equal(typeof value, 'string', `${label} must be a string`);
  assert.ok(value.length >= 1, `${label} must not be empty`);
  assert.ok(value.length <= 128, `${label} must not exceed 128 characters`);
}

function validateNullableTimestamp(value, label) {
  assert.ok(
    value === null || (Number.isInteger(value) && value >= 0),
    `${label} must be null or a non-negative integer`,
  );
}

function compareUnicodeCodePoints(left, right) {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0));
  const rightPoints = Array.from(right, (character) => character.codePointAt(0));
  const sharedLength = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < sharedLength; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) {
      return leftPoints[index] - rightPoints[index];
    }
  }
  return leftPoints.length - rightPoints.length;
}

function canonicalJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    assert.ok(Number.isFinite(value), 'canonical JSON rejects non-finite numbers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }
  assert.equal(typeof value, 'object', 'canonical JSON accepts only JSON values');
  const keys = Object.keys(value).sort(compareUnicodeCodePoints);
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(',')}}`;
}

function canonicalSha256(value) {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function required(value, fields, label) {
  assert.equal(typeof value, 'object', `${label} must be an object`);
  assert.notEqual(value, null, `${label} must not be null`);
  for (const field of fields) {
    assert.ok(Object.hasOwn(value, field), `${label}.${field} is required`);
  }
}

function validateRootShape(value, schema, label) {
  required(value, schema.required, label);
  if (schema.additionalProperties === false) {
    const allowed = new Set(Object.keys(schema.properties));
    for (const field of Object.keys(value)) {
      assert.ok(allowed.has(field), `${label}.${field} is not declared by the v1 schema`);
    }
  }
}

function validateEvent(event, label) {
  validateRootShape(event, schemas.get('watch-event.schema.json'), label);
  validateWireVersion(event, label);
  assert.ok(eventTypes.has(event.type), `${label}.type is not in the protocol enum`);
  assert.ok(sources.has(event.source), `${label}.source is invalid`);
  assert.ok(
    Number.isInteger(event.revision) && event.revision >= 1,
    `${label}.revision must be a positive integer`,
  );
}

function validateActiveWorkoutRuntime(runtime, label) {
  const schema = schemas.get('active-workout-runtime.schema.json');
  validateRootShape(runtime, schema, label);
  validateOpaqueDomainId(runtime.sessionId, `${label}.sessionId`);
  assert.ok(['ACTIVE', 'PAUSED', 'FINISHED'].includes(runtime.status), `${label}.status is invalid`);
  for (const field of ['activeExerciseId', 'activeSetId']) {
    if (runtime[field] !== null) {
      validateOpaqueDomainId(runtime[field], `${label}.${field}`);
    }
  }
  validateNullableTimestamp(runtime.setStartedAt, `${label}.setStartedAt`);
  validateNullableTimestamp(runtime.pausedAt, `${label}.pausedAt`);
  assert.ok(
    Number.isInteger(runtime.workoutAccumulatedPauseMs) &&
      runtime.workoutAccumulatedPauseMs >= 0,
    `${label}.workoutAccumulatedPauseMs must be a non-negative integer`,
  );
  assert.ok(
    Number.isInteger(runtime.setAccumulatedPauseMs) && runtime.setAccumulatedPauseMs >= 0,
    `${label}.setAccumulatedPauseMs must be a non-negative integer`,
  );
  if (runtime.rest !== null) {
    validateRootShape(runtime.rest, schema.properties.rest, `${label}.rest`);
    validateOpaqueDomainId(runtime.rest.setId, `${label}.rest.setId`);
    assert.ok(
      Number.isInteger(runtime.rest.startedAt) && runtime.rest.startedAt >= 0,
      `${label}.rest.startedAt must be a non-negative integer`,
    );
    assert.ok(
      Number.isInteger(runtime.rest.endsAt) && runtime.rest.endsAt >= runtime.rest.startedAt,
      `${label}.rest.endsAt must not predate rest.startedAt`,
    );
    validateNullableTimestamp(runtime.rest.pausedRemainingMs, `${label}.rest.pausedRemainingMs`);
  }
  assert.ok(
    Number.isInteger(runtime.revision) && runtime.revision >= 1,
    `${label}.revision must be a positive integer`,
  );
  assert.ok(
    Number.isInteger(runtime.updatedAt) && runtime.updatedAt >= 0,
    `${label}.updatedAt must be a non-negative integer`,
  );
  assert.ok(sources.has(runtime.updatedBy), `${label}.updatedBy is invalid`);
}

function validateFileTransferEnvelope(envelope, label) {
  validateRootShape(envelope, schemas.get('file-transfer-envelope.schema.json'), label);
  validateWireVersion(envelope, label);
  assert.match(envelope.transferId, uuidPattern, `${label}.transferId must be a UUID`);
  validateOpaqueDomainId(envelope.sessionId, `${label}.sessionId`);
  assert.ok(
    envelope.relatedEventId === null || uuidPattern.test(envelope.relatedEventId),
    `${label}.relatedEventId must be null or a UUID`,
  );
  assert.ok(
    ['SENSOR_BATCH', 'SYNC_SNAPSHOT', 'EVENT_BATCH'].includes(envelope.payloadType),
    `${label}.payloadType is invalid`,
  );
  validateOpaqueDomainId(envelope.payloadId, `${label}.payloadId`);
  assert.ok(
    Number.isInteger(envelope.sequence) && envelope.sequence >= 1,
    `${label}.sequence must be positive`,
  );
  assert.ok(
    Number.isInteger(envelope.totalSequences) && envelope.totalSequences >= 1,
    `${label}.totalSequences must be positive`,
  );
  assert.ok(
    envelope.sequence <= envelope.totalSequences,
    `${label}.sequence must not exceed totalSequences`,
  );
  assert.ok(
    Number.isInteger(envelope.byteLength) &&
      envelope.byteLength >= 1 &&
      envelope.byteLength < fileMaxBytes,
    `${label}.byteLength must be from 1 through 3999999`,
  );
  assert.match(envelope.sha256, sha256Pattern, `${label}.sha256 must be lowercase hex`);
  assert.ok(
    Number.isInteger(envelope.createdAt) && envelope.createdAt >= 0,
    `${label}.createdAt must be a non-negative integer`,
  );
  assert.ok(sources.has(envelope.source), `${label}.source is invalid`);
  validateControlDeviceId(envelope.deviceId, `${label}.deviceId`);
  const canonicalPayload = canonicalJson(envelope.payload);
  assert.equal(
    envelope.byteLength,
    Buffer.byteLength(canonicalPayload, 'utf8'),
    `${label}.byteLength must cover canonical payload JSON`,
  );
  assert.equal(
    envelope.sha256,
    canonicalSha256(envelope.payload),
    `${label}.sha256 must cover canonical payload JSON`,
  );
}

function assertUniqueEventIds(events, label) {
  const ids = events.map((event) => event.eventId);
  assert.equal(new Set(ids).size, ids.length, `${label} contains duplicate eventId values`);
}

const schemaFiles = (await readdir(schemaDir)).filter((name) => name.endsWith('.json'));
assert.deepEqual(new Set(schemaFiles), expectedSchemas, 'v1 schema set is incomplete');

const schemas = new Map();
for (const name of schemaFiles) {
  const schema = JSON.parse(await readFile(join(schemaDir, name), 'utf8'));
  schemas.set(name, schema);
  assert.equal(schema.$schema, draft202012, `${name} must use JSON Schema Draft 2020-12`);
  assert.ok(schema.$id?.includes('/watch/v1/'), `${name} must have a versioned $id`);
  assert.equal(schema.type, 'object', `${name} root must be an object`);
  assert.ok(Array.isArray(schema.required), `${name} must declare required fields`);
}

assert.deepEqual(
  new Set(schemas.get('sensor-sample.schema.json').properties.phase.enum),
  phases,
  'SensorSample phase enum must match the protocol',
);
assert.deepEqual(
  new Set(schemas.get('watch-event.schema.json').properties.type.enum),
  eventTypes,
  'WatchEvent type enum must match the protocol',
);
assert.deepEqual(
  new Set(schemas.get('sync-ack.schema.json').properties.status.enum),
  ackStatuses,
  'SyncAck status enum must match the protocol',
);
assert.deepEqual(
  new Set(schemas.get('control-message.schema.json').properties.type.enum),
  controlMessageTypes,
  'ControlMessage type enum must match the diagnostic protocol',
);
const controlMessageIdProperty = schemas.get('control-message.schema.json').properties.messageId;
assert.equal(controlMessageIdProperty.format, undefined, 'ControlMessage.messageId must be opaque');
assert.equal(
  controlMessageIdProperty.minLength,
  1,
  'ControlMessage.messageId must reject empty IDs',
);
assert.equal(
  controlMessageIdProperty.maxLength,
  128,
  'ControlMessage.messageId must bound Lite message IDs',
);
const controlReplyProperty = schemas.get('control-message.schema.json').properties.replyTo;
assert.equal(controlReplyProperty.format, undefined, 'ControlMessage.replyTo must be opaque');
assert.equal(controlReplyProperty.minLength, 1, 'ControlMessage.replyTo must reject empty IDs');
assert.equal(controlReplyProperty.maxLength, 128, 'ControlMessage.replyTo must bound Lite IDs');
const controlDeviceIdProperty = schemas.get('control-message.schema.json').properties.deviceId;
assert.equal(controlDeviceIdProperty.minLength, 1, 'ControlMessage.deviceId must reject empty IDs');
assert.equal(controlDeviceIdProperty.maxLength, 128, 'ControlMessage.deviceId must bound Lite IDs');
for (const [schemaName, propertyName] of opaqueDomainIdSchemas) {
  const property = schemas.get(schemaName).properties[propertyName];
  assert.equal(
    property.format,
    undefined,
    `${schemaName}.${propertyName} must accept existing opaque IDs`,
  );
  assert.equal(property.minLength, 1, `${schemaName}.${propertyName} must reject empty opaque IDs`);
}
for (const name of [
  'control-message.schema.json',
  'watch-event.schema.json',
  'sync-ack.schema.json',
  'sync-snapshot.schema.json',
  'batch-envelope.schema.json',
  'file-transfer-envelope.schema.json',
  'sensor-batch.schema.json',
]) {
  const schema = schemas.get(name);
  assert.ok(schema.required.includes('protocolVersion'), `${name} must require protocolVersion`);
  assert.ok(schema.required.includes('schemaVersion'), `${name} must require schemaVersion`);
  assert.equal(schema.properties.protocolVersion.const, '1.0', `${name} protocol version drift`);
  assert.equal(schema.properties.schemaVersion.const, 1, `${name} schema version drift`);
}
const runtimeSchema = schemas.get('active-workout-runtime.schema.json');
assert.equal(
  runtimeSchema.properties.workoutAccumulatedPauseMs.minimum,
  0,
  'ActiveWorkoutRuntime workout pause must be non-negative',
);
assert.equal(
  runtimeSchema.properties.setAccumulatedPauseMs.minimum,
  0,
  'ActiveWorkoutRuntime set pause must be non-negative',
);
assert.equal(
  runtimeSchema.properties.rest.properties.pausedRemainingMs.minimum,
  0,
  'ActiveWorkoutRuntime paused rest remainder must be non-negative',
);
const fileTransferSchema = schemas.get('file-transfer-envelope.schema.json');
assert.equal(fileTransferSchema.properties.sequence.minimum, 1, 'file sequence must be positive');
assert.equal(
  fileTransferSchema.properties.totalSequences.minimum,
  1,
  'file totalSequences must be positive',
);
assert.equal(
  fileTransferSchema.properties.byteLength.maximum,
  3_999_999,
  'file payload byteLength must remain strictly below the Wear Engine file limit',
);
assert.equal(
  fileTransferSchema.properties.sha256.pattern,
  '^[0-9a-f]{64}$',
  'file payload SHA-256 must be lowercase hexadecimal',
);
assert.ok(
  !schemas.get('sync-snapshot.schema.json').required.includes('runtimeState'),
  'SyncSnapshot.runtimeState must remain optional for older v1 snapshots',
);

const exampleFiles = (await readdir(examplesDir)).filter((name) => name.endsWith('.json'));
const examples = new Map();
for (const name of exampleFiles) {
  const raw = await readFile(join(examplesDir, name), 'utf8');
  const parsed = JSON.parse(raw);
  examples.set(name, { parsed, bytes: Buffer.byteLength(JSON.stringify(parsed), 'utf8') });
  assert.ok(Buffer.byteLength(raw, 'utf8') < fileMaxBytes, `${name} exceeds file limit`);
}

for (const [name, example] of examples) {
  const schemaName = name.replace(/\.json$/, '.schema.json');
  validateRootShape(example.parsed, schemas.get(schemaName), name);
}

const workout = examples.get('workout-session.json').parsed;
required(
  workout,
  [
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
  ],
  'WorkoutSession',
);
assert.ok(
  workout.sessionId.startsWith('mob_session_'),
  'WorkoutSession example must prove opaque prefixed Android IDs are accepted',
);
assert.ok(sources.has(workout.updatedBy), 'WorkoutSession.updatedBy is invalid');

const runtime = examples.get('active-workout-runtime.json').parsed;
validateActiveWorkoutRuntime(runtime, 'ActiveWorkoutRuntime');
assert.ok(
  runtime.activeSetId && runtime.setStartedAt !== null,
  'ActiveWorkoutRuntime fixture must include an in-progress set',
);

const exercise = examples.get('exercise-session.json').parsed;
required(
  exercise,
  [
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
  ],
  'ExerciseSession',
);

const heartRate = examples.get('heart-rate-summary.json').parsed;
required(heartRate, ['min', 'max', 'average', 'start', 'end', 'sampleCount'], 'HeartRateSummary');

const restHeartRate = examples.get('rest-heart-rate-summary.json').parsed;
required(
  restHeartRate,
  [
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
  ],
  'RestHeartRateSummary',
);
assert.ok(
  restHeartRate.startedAt <= restHeartRate.finishedAt,
  'RestHeartRateSummary timestamps are reversed',
);
assert.equal(
  restHeartRate.drop30Seconds,
  restHeartRate.start - restHeartRate.at30Seconds,
  'RestHeartRateSummary 30-second drop mismatch',
);
assert.equal(
  restHeartRate.drop60Seconds,
  restHeartRate.start - restHeartRate.at60Seconds,
  'RestHeartRateSummary 60-second drop mismatch',
);

const sensor = examples.get('sensor-sample.json').parsed;
required(
  sensor,
  [
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
  ],
  'SensorSample',
);
assert.ok(phases.has(sensor.phase), 'SensorSample.phase is not in the protocol enum');
assert.ok(sources.has(sensor.source), 'SensorSample.source is invalid');

const sensorBatch = examples.get('sensor-batch.json').parsed;
required(
  sensorBatch,
  [
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
  ],
  'SensorBatch',
);
validateWireVersion(sensorBatch, 'SensorBatch');
assert.equal(
  sensorBatch.sampleCount,
  sensorBatch.samples.length,
  'SensorBatch sampleCount mismatch',
);
assert.ok(
  sensorBatch.sequence <= sensorBatch.totalSequences,
  'SensorBatch sequence is out of range',
);
assert.ok(
  sensorBatch.samples.every((sample) => sample.sessionId === sensorBatch.sessionId),
  'SensorBatch samples must use the envelope sessionId',
);
assert.equal(
  sensorBatch.samples.filter((sample) => sample.valid).length,
  2,
  'SensorBatch fixture must include two valid readings',
);
assert.ok(
  sensorBatch.samples.some((sample) => !sample.valid && sample.value === null),
  'SensorBatch fixture must preserve an invalid off-wrist reading without zero',
);
assert.ok(
  examples.get('sensor-batch.json').bytes < fileMaxBytes,
  'SensorBatch fixture exceeds file limit',
);

const setRecord = examples.get('set-record.json').parsed;
required(
  setRecord,
  [
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
  ],
  'SetRecord',
);
assert.deepEqual(
  new Set(schemas.get('set-record.schema.json').properties.rir.type),
  new Set(['number', 'null']),
  'SetRecord.rir must preserve historical missing RIR values',
);

const control = examples.get('control-message.json').parsed;
validateWireVersion(control, 'ControlMessage');
assert.ok(controlMessageTypes.has(control.type), 'ControlMessage.type is invalid');
assert.ok(sources.has(control.source), 'ControlMessage.source is invalid');
validateOpaqueMessageId(control.messageId, 'ControlMessage.messageId');
validateControlDeviceId(control.deviceId, 'ControlMessage.deviceId');
assert.equal(control.replyTo, null, 'standalone PING must not claim a reply target');
assert.ok(
  examples.get('control-message.json').bytes <= p2pMaxBytes,
  'ControlMessage exceeds direct P2P limit',
);
assert.ok(
  examples.get('control-message.json').bytes <= p2pTargetBytes,
  'ControlMessage exceeds the GymCoach P2P engineering target',
);

const controlReply = {
  ...control,
  messageId: 'stage2-pong-001',
  type: 'PONG',
  source: 'PHONE',
  deviceId: 'android-stage2',
  replyTo: control.messageId,
};
validateRootShape(controlReply, schemas.get('control-message.schema.json'), 'ControlMessage reply');
validateWireVersion(controlReply, 'ControlMessage reply');
validateOpaqueMessageId(controlReply.messageId, 'ControlMessage reply.messageId');
validateOpaqueMessageId(controlReply.replyTo, 'ControlMessage reply.replyTo');
validateControlDeviceId(controlReply.deviceId, 'ControlMessage reply.deviceId');
assert.notEqual(
  controlReply.messageId,
  controlReply.replyTo,
  'control reply must use a unique messageId',
);
assert.ok(
  Buffer.byteLength(JSON.stringify(controlReply), 'utf8') <= p2pTargetBytes,
  'ControlMessage reply exceeds the GymCoach P2P engineering target',
);
assert.equal(
  new Set([control.messageId, controlReply.messageId]).size,
  2,
  'ControlMessage IDs must be unique',
);
assert.throws(
  () => validateOpaqueMessageId('', 'empty control ID'),
  /must not be empty/,
  'empty control IDs must be rejected',
);
assert.throws(
  () => validateOpaqueMessageId('x'.repeat(129), 'oversized control ID'),
  /must not exceed 128/,
  'oversized control IDs must be rejected',
);
assert.throws(
  () => validateControlDeviceId('', 'empty control device ID'),
  /must not be empty/,
  'empty control device IDs must be rejected',
);
assert.throws(
  () => validateControlDeviceId('x'.repeat(129), 'oversized control device ID'),
  /must not exceed 128/,
  'oversized control device IDs must be rejected',
);
assert.throws(
  () =>
    validateRootShape(
      { ...control, sessionId: 'must-not-be-on-control-messages' },
      schemas.get('control-message.schema.json'),
      'ControlMessage with workout field',
    ),
  /is not declared by the v1 schema/,
  'ControlMessage must reject workout root fields',
);
const controlWithoutReplyTo = { ...control };
delete controlWithoutReplyTo.replyTo;
assert.throws(
  () =>
    validateRootShape(
      controlWithoutReplyTo,
      schemas.get('control-message.schema.json'),
      'ControlMessage without replyTo',
    ),
  /replyTo is required/,
  'ControlMessage must require all root fields',
);

const standaloneEvent = examples.get('watch-event.json').parsed;
validateEvent(standaloneEvent, 'WatchEvent');
assert.ok(
  examples.get('watch-event.json').bytes <= p2pMaxBytes,
  'standalone WatchEvent exceeds direct P2P limit',
);

const ack = examples.get('sync-ack.json').parsed;
required(
  ack,
  [
    'protocolVersion',
    'schemaVersion',
    'ackId',
    'sessionId',
    'eventIds',
    'status',
    'timestamp',
    'source',
    'deviceId',
    'revision',
    'errorCode',
  ],
  'SyncAck',
);
validateWireVersion(ack, 'SyncAck');
assert.ok(ackStatuses.has(ack.status), 'SyncAck.status is invalid');
assert.equal(new Set(ack.eventIds).size, ack.eventIds.length, 'SyncAck repeats eventId values');
assert.ok(examples.get('sync-ack.json').bytes <= p2pMaxBytes, 'SyncAck exceeds P2P limit');

const snapshot = examples.get('sync-snapshot.json').parsed;
required(
  snapshot,
  [
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
  ],
  'SyncSnapshot',
);
validateWireVersion(snapshot, 'SyncSnapshot');
assert.equal(
  schemas.get('sync-snapshot.schema.json').properties.runtimeState.$ref,
  'active-workout-runtime.schema.json',
  'SyncSnapshot.runtimeState must reference the v1 runtime schema',
);
if (snapshot.runtimeState !== undefined) {
  validateActiveWorkoutRuntime(snapshot.runtimeState, 'SyncSnapshot.runtimeState');
  assert.equal(
    snapshot.runtimeState.sessionId,
    snapshot.sessionId,
    'SyncSnapshot runtime state must use the envelope sessionId',
  );
  assert.equal(
    snapshot.runtimeState.revision,
    snapshot.revision,
    'SyncSnapshot runtime state revision must match the envelope revision',
  );
  assert.ok(
    snapshot.runtimeState.updatedAt <= snapshot.timestamp,
    'SyncSnapshot runtime state must not postdate the snapshot',
  );
}
const snapshotWithoutRuntime = { ...snapshot };
delete snapshotWithoutRuntime.runtimeState;
validateRootShape(
  snapshotWithoutRuntime,
  schemas.get('sync-snapshot.schema.json'),
  'SyncSnapshot without optional runtimeState',
);
snapshot.pendingEvents.forEach((event, index) =>
  validateEvent(event, `SyncSnapshot.pendingEvents[${index}]`),
);
assertUniqueEventIds(snapshot.pendingEvents, 'SyncSnapshot.pendingEvents');
assert.equal(
  snapshot.workoutSession.sessionId,
  snapshot.sessionId,
  'SyncSnapshot workout session must use the envelope sessionId',
);
assert.equal(
  snapshot.workoutSession.revision,
  snapshot.revision,
  'SyncSnapshot workout session revision must match the envelope revision',
);
assert.ok(
  snapshot.timestamp >= snapshot.workoutSession.updatedAt,
  'SyncSnapshot timestamp must not predate the projected workout state',
);
assert.ok(
  snapshot.exerciseSessions.length >= 2,
  'Stage 3 snapshot fixture must include multiple exercises',
);
const exerciseSessionIds = snapshot.exerciseSessions.map((entry) => entry.exerciseSessionId);
const exerciseIds = snapshot.exerciseSessions.map((entry) => entry.exerciseId);
const exerciseOrders = snapshot.exerciseSessions.map((entry) => entry.order);
assert.equal(
  new Set(exerciseSessionIds).size,
  exerciseSessionIds.length,
  'SyncSnapshot exerciseSessionId values must be unique',
);
assert.equal(
  new Set(exerciseOrders).size,
  exerciseOrders.length,
  'SyncSnapshot exercise order values must be unique',
);
assert.ok(
  snapshot.exerciseSessions.every((entry) => entry.sessionId === snapshot.sessionId),
  'SyncSnapshot exercises must link to the envelope session',
);
assert.ok(
  exerciseIds.includes(snapshot.workoutSession.activeExerciseId),
  'SyncSnapshot activeExerciseId must reference a projected exercise',
);
assert.equal(
  snapshot.exerciseSessions.filter((entry) => entry.status === 'ACTIVE').length,
  1,
  'SyncSnapshot must expose one active exercise',
);
const setIds = snapshot.setRecords.map((entry) => entry.setId);
assert.equal(new Set(setIds).size, setIds.length, 'SyncSnapshot setId values must be unique');
assert.ok(
  snapshot.setRecords.every(
    (entry) =>
      entry.sessionId === snapshot.sessionId &&
      exerciseSessionIds.includes(entry.exerciseSessionId) &&
      entry.revision <= snapshot.revision &&
      entry.startedAt <= entry.completedAt,
  ),
  'SyncSnapshot sets must link to projected exercises and valid revisions',
);
assert.ok(
  snapshot.workoutSession.activeSetId && !setIds.includes(snapshot.workoutSession.activeSetId),
  'Stage 3 fixture must distinguish the active in-progress set from completed sets',
);
assert.equal(
  snapshot.sensorSamples.length,
  0,
  'Stage 3 snapshot fixture must not claim sensor support before Stage 4',
);
assert.ok(
  examples.get('sync-snapshot.json').bytes > p2pMaxBytes &&
    examples.get('sync-snapshot.json').bytes < fileMaxBytes,
  'Stage 3 snapshot fixture must exercise file delivery rather than direct P2P',
);

const conflict = examples.get('conflict-record.json').parsed;
required(
  conflict,
  [
    'conflictId',
    'sessionId',
    'entityType',
    'entityId',
    'localRevision',
    'remoteRevision',
    'localEvent',
    'remoteEvent',
    'detectedAt',
    'resolution',
    'resolvedAt',
  ],
  'ConflictRecord',
);
validateEvent(conflict.localEvent, 'ConflictRecord.localEvent');
validateEvent(conflict.remoteEvent, 'ConflictRecord.remoteEvent');
assert.notEqual(
  conflict.localEvent.eventId,
  conflict.remoteEvent.eventId,
  'conflicting mutations must have distinct eventId values',
);

const batch = examples.get('batch-envelope.json').parsed;
required(
  batch,
  [
    'protocolVersion',
    'schemaVersion',
    'batchId',
    'sessionId',
    'source',
    'deviceId',
    'createdAt',
    'sequence',
    'totalSequences',
    'deliveryMode',
    'eventCount',
    'events',
  ],
  'BatchEnvelope',
);
validateWireVersion(batch, 'BatchEnvelope');
assert.equal(batch.eventCount, batch.events.length, 'BatchEnvelope.eventCount mismatch');
assert.ok(batch.sequence <= batch.totalSequences, 'BatchEnvelope sequence is out of range');
batch.events.forEach((event, index) => validateEvent(event, `BatchEnvelope.events[${index}]`));
assertUniqueEventIds(batch.events, 'BatchEnvelope.events');
const batchLimit = batch.deliveryMode === 'P2P' ? p2pMaxBytes : fileMaxBytes;
const batchFits =
  batch.deliveryMode === 'P2P'
    ? examples.get('batch-envelope.json').bytes <= batchLimit
    : examples.get('batch-envelope.json').bytes < batchLimit;
assert.ok(batchFits, `BatchEnvelope exceeds ${batch.deliveryMode} transport limit`);

const fileTransfer = examples.get('file-transfer-envelope.json').parsed;
validateFileTransferEnvelope(fileTransfer, 'FileTransferEnvelope');
assert.ok(
  examples.get('file-transfer-envelope.json').bytes < fileMaxBytes,
  'FileTransferEnvelope total serialized file must remain below 4,000,000 bytes',
);
assert.ok(
  examples.get('file-transfer-envelope.json').bytes <= fileTargetBytes,
  'FileTransferEnvelope fixture exceeds the 3.5 MiB engineering target',
);
assert.equal(
  fileTransfer.payloadType,
  'SENSOR_BATCH',
  'FileTransferEnvelope fixture must exercise a sensor batch',
);
validateRootShape(
  fileTransfer.payload,
  schemas.get('sensor-batch.schema.json'),
  'FileTransferEnvelope.payload',
);
assert.equal(
  fileTransfer.payload.batchId,
  fileTransfer.payloadId,
  'FileTransferEnvelope payloadId must identify its sensor batch payload',
);

assert.throws(
  () =>
    validateFileTransferEnvelope(
      { ...fileTransfer, sha256: '0'.repeat(64) },
      'FileTransferEnvelope with bad sha256',
    ),
  /sha256 must cover canonical payload JSON/,
  'a syntactically valid but incorrect SHA-256 must be rejected',
);
assert.throws(
  () =>
    validateFileTransferEnvelope(
      { ...fileTransfer, sequence: fileTransfer.totalSequences + 1 },
      'FileTransferEnvelope with sequence gap',
    ),
  /sequence must not exceed totalSequences/,
  'sequence values beyond totalSequences must be rejected',
);
assert.throws(
  () =>
    validateFileTransferEnvelope(
      { ...fileTransfer, byteLength: fileMaxBytes },
      'FileTransferEnvelope at the forbidden file limit',
    ),
  /byteLength must be from 1 through 3999999/,
  'a 4,000,000-byte payload declaration must be rejected',
);

assert.throws(
  () =>
    validateActiveWorkoutRuntime(
      { ...runtime, workoutAccumulatedPauseMs: -1 },
      'ActiveWorkoutRuntime with negative workout pause',
    ),
  /workoutAccumulatedPauseMs must be a non-negative integer/,
  'negative workout pause accumulation must be rejected',
);
assert.throws(
  () =>
    validateActiveWorkoutRuntime(
      { ...runtime, setAccumulatedPauseMs: -1 },
      'ActiveWorkoutRuntime with negative set pause',
    ),
  /setAccumulatedPauseMs must be a non-negative integer/,
  'negative set pause accumulation must be rejected',
);
assert.throws(
  () =>
    validateActiveWorkoutRuntime(
      {
        ...runtime,
        rest: {
          setId: 'mob_set_rest_vector',
          startedAt: 1784102583000,
          endsAt: 1784102703000,
          pausedRemainingMs: -1,
        },
      },
      'ActiveWorkoutRuntime with negative paused rest remainder',
    ),
  /pausedRemainingMs must be null or a non-negative integer/,
  'negative paused rest time must be rejected',
);

const stage3Payloads = JSON.parse(
  await readFile(join(fixturesDir, 'stage3-event-payloads.json'), 'utf8'),
);
required(
  stage3Payloads.activeExerciseChanged,
  ['exerciseId', 'exerciseSessionId', 'order'],
  'ACTIVE_EXERCISE_CHANGED payload',
);
assert.ok(
  stage3Payloads.activeExerciseChanged.order >= 1,
  'ACTIVE_EXERCISE_CHANGED order must be positive',
);
required(
  stage3Payloads.setStarted,
  ['setId', 'exerciseSessionId', 'setNumber', 'startedAt'],
  'SET_STARTED payload',
);
assert.ok(stage3Payloads.setStarted.setNumber >= 1, 'SET_STARTED setNumber must be positive');
assert.ok(stage3Payloads.setStarted.startedAt >= 0, 'SET_STARTED startedAt must be non-negative');
validateRootShape(
  stage3Payloads.setCompleted,
  schemas.get('set-record.schema.json'),
  'SET_COMPLETED payload',
);
required(stage3Payloads.setDeleted, ['setId', 'deletedAt', 'baseRevision'], 'SET_DELETED payload');
assert.ok(stage3Payloads.setDeleted.deletedAt >= 0, 'SET_DELETED deletedAt must be non-negative');
assert.ok(stage3Payloads.setDeleted.baseRevision >= 1, 'SET_DELETED baseRevision must be positive');

const stage4Payloads = JSON.parse(
  await readFile(join(fixturesDir, 'stage4-rest-payloads.json'), 'utf8'),
);
required(
  stage4Payloads.sensorBatchRecorded,
  ['batchId', 'sequence', 'totalSequences', 'deliveryMode', 'sampleCount'],
  'SENSOR_BATCH_RECORDED payload',
);
assert.ok(
  ['P2P', 'FILE'].includes(stage4Payloads.sensorBatchRecorded.deliveryMode),
  'SENSOR_BATCH_RECORDED delivery mode is invalid',
);
required(stage4Payloads.restStarted, ['setId', 'startedAt', 'restEndsAt'], 'REST_STARTED payload');
assert.ok(
  stage4Payloads.restStarted.startedAt <= stage4Payloads.restStarted.restEndsAt,
  'REST_STARTED timestamps are reversed',
);
required(stage4Payloads.restUpdated, ['restEndsAt', 'reason'], 'REST_UPDATED payload');
required(stage4Payloads.restFinished, ['finishedAt', 'summary'], 'REST_FINISHED payload');
validateRootShape(
  stage4Payloads.restFinished.summary,
  schemas.get('rest-heart-rate-summary.schema.json'),
  'REST_FINISHED summary',
);
required(stage4Payloads.restSkipped, ['skippedAt'], 'REST_SKIPPED payload');

const canonicalHashVector = JSON.parse(
  await readFile(join(fixturesDir, 'canonical-event-hash.json'), 'utf8'),
);
validateEvent(canonicalHashVector.inputA, 'Canonical hash vector inputA');
validateEvent(canonicalHashVector.inputB, 'Canonical hash vector inputB');
const canonicalA = canonicalJson(canonicalHashVector.inputA);
const canonicalB = canonicalJson(canonicalHashVector.inputB);
assert.equal(canonicalA, canonicalB, 'reordered semantic objects must canonicalize identically');
assert.equal(
  canonicalA,
  canonicalHashVector.canonicalJson,
  'canonical WatchEvent JSON changed from the published test vector',
);
assert.equal(
  canonicalSha256(canonicalHashVector.inputA),
  canonicalHashVector.sha256,
  'canonical WatchEvent SHA-256 changed from the published test vector',
);
assert.equal(
  canonicalSha256(canonicalHashVector.inputB),
  canonicalHashVector.sha256,
  'reordered WatchEvent must retain the published SHA-256',
);
assert.throws(
  () => canonicalJson(Number.POSITIVE_INFINITY),
  /rejects non-finite numbers/,
  'canonical JSON must reject non-finite numbers',
);

console.log(`Validated ${schemaFiles.length} schemas and ${exampleFiles.length} examples.`);
