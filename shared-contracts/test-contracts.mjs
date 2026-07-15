import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const schemaDir = join(root, 'schemas', 'v1');
const examplesDir = join(root, 'examples');
const draft202012 = 'https://json-schema.org/draft/2020-12/schema';
const p2pMaxBytes = 1_024;
const fileMaxBytes = 4_000_000;

const expectedSchemas = new Set([
  'batch-envelope.schema.json',
  'conflict-record.schema.json',
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
const ackStatuses = new Set(['APPLIED', 'DUPLICATE', 'STALE', 'CONFLICT', 'REJECTED']);

function validateWireVersion(value, label) {
  assert.equal(value.protocolVersion, '1.0', `${label}.protocolVersion must be 1.0`);
  assert.equal(value.schemaVersion, 1, `${label}.schemaVersion must be 1`);
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
for (const name of [
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

console.log(`Validated ${schemaFiles.length} schemas and ${exampleFiles.length} examples.`);
