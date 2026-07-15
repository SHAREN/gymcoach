import assert from 'node:assert/strict';
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

const expectedSchemas = new Set([
  'batch-envelope.schema.json',
  'conflict-record.schema.json',
  'control-message.schema.json',
  'exercise-session.schema.json',
  'heart-rate-summary.schema.json',
  'sensor-sample.schema.json',
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
]) {
  const schema = schemas.get(name);
  assert.ok(schema.required.includes('protocolVersion'), `${name} must require protocolVersion`);
  assert.ok(schema.required.includes('schemaVersion'), `${name} must require schemaVersion`);
  assert.equal(schema.properties.protocolVersion.const, '1.0', `${name} protocol version drift`);
  assert.equal(schema.properties.schemaVersion.const, 1, `${name} schema version drift`);
}

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

console.log(`Validated ${schemaFiles.length} schemas and ${exampleFiles.length} examples.`);
