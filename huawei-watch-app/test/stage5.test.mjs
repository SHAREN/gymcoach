import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { canonicalJson, canonicalSha256 } from '../src/core/canonical-json.js';
import { WatchCompanion } from '../src/core/companion.js';
import {
  createFileTransferEnvelope,
  createSyncAck,
  createWatchEvent,
  DataEnvelopeTooLargeError,
  parseFileTransferEnvelope,
  parseSyncAck,
  serializeFileTransferEnvelope,
  serializeSyncAck,
  WatchEventType,
} from '../src/core/contracts.js';
import {
  createSensorSample,
  SensorPhase,
  SensorType,
} from '../src/core/sensors.js';
import { createVolatileStorageBackend, WatchStateRepository } from '../src/core/storage.js';
import { createDebugTransportPair } from '../src/debug/debug-transport.js';

async function sharedJson(relativePath) {
  const url = new URL(`../../shared-contracts/${relativePath}`, import.meta.url);
  return JSON.parse(await readFile(url, 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function uuidSequence(prefix = 'a', start = 1) {
  let value = start - 1;
  return () => {
    value += 1;
    return `${prefix.repeat(8)}-${prefix.repeat(4)}-4${prefix.repeat(3)}-8${prefix.repeat(3)}-${String(value).padStart(12, '0')}`;
  };
}

function mutableClock(initial) {
  let value = initial;
  return {
    advance(milliseconds) {
      value += milliseconds;
      return value;
    },
    now() {
      return value;
    },
  };
}

function idleSnapshot(snapshot) {
  const next = clone(snapshot);
  next.workoutSession.activeSetId = null;
  next.runtimeState.activeSetId = null;
  next.runtimeState.setStartedAt = null;
  next.runtimeState.setAccumulatedPauseMs = 0;
  next.runtimeState.rest = null;
  return next;
}

async function createHarness({
  backend = createVolatileStorageBackend(),
  clock,
  connected = true,
  sendSnapshot = true,
  sensorSampleLimit,
  snapshot,
} = {}) {
  const source = snapshot || idleSnapshot(await sharedJson('examples/sync-snapshot.json'));
  const watchClock = clock || mutableClock(source.timestamp + 10_000);
  const transports = createDebugTransportPair();
  const receivedMessages = [];
  const receivedFiles = [];
  transports.phone.setMessageHandler(async (serialized) => receivedMessages.push(serialized));
  transports.phone.setFileHandler(async (serialized) => receivedFiles.push(serialized));
  if (connected) {
    await transports.phone.connect();
  }
  const repository = new WatchStateRepository(backend);
  const watch = new WatchCompanion({
    clock: watchClock.now,
    deviceId: 'watch-stage5-test',
    eventIdGenerator: uuidSequence('a'),
    idGenerator: (() => {
      let value = 0;
      return () => `stage5-control-${++value}`;
    })(),
    repository,
    sensorSampleLimit,
    setIdGenerator: () => 'watch_set_stage5',
    transport: transports.watch,
  });
  await watch.start();
  if (sendSnapshot) {
    await watch.receiveFile(JSON.stringify(source));
  }
  return {
    backend,
    clock: watchClock,
    receivedFiles,
    receivedMessages,
    repository,
    snapshot: source,
    transports,
    watch,
  };
}

function ackFor(event, overrides = {}) {
  return createSyncAck({
    ackId: overrides.ackId || 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001',
    deviceId: 'phone-stage5-test',
    errorCode: overrides.errorCode ?? null,
    eventIds: overrides.eventIds || [event.eventId],
    revision: overrides.revision ?? event.revision,
    sessionId: event.sessionId,
    source: 'PHONE',
    status: overrides.status || 'APPLIED',
    timestamp: overrides.timestamp || event.timestamp + 1,
  });
}

function pendingEvents(repository) {
  return repository.pending().filter((entry) => entry.eventId);
}

test('canonical JSON and SHA-256 match the shared cross-implementation vector', async () => {
  const vector = await sharedJson('fixtures/canonical-event-hash.json');
  assert.equal(canonicalJson(vector.inputA), vector.canonicalJson);
  assert.equal(canonicalJson(vector.inputB), vector.canonicalJson);
  assert.equal(canonicalSha256(vector.inputA), vector.sha256);
  assert.equal(canonicalSha256(vector.inputB), vector.sha256);
  assert.throws(() => canonicalJson(Number.POSITIVE_INFINITY), /non-finite/);
});

test('SyncAck is strict and APPLIED or DUPLICATE removes events idempotently', async () => {
  const harness = await createHarness();
  const event = await harness.watch.changeExercise(1);
  assert.equal(pendingEvents(harness.repository).some((entry) => entry.eventId === event.eventId), true);

  const applied = ackFor(event);
  assert.deepEqual(parseSyncAck(serializeSyncAck(applied)), applied);
  const first = await harness.watch.receive(serializeSyncAck(applied));
  const duplicate = await harness.watch.receive(serializeSyncAck(applied));
  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(pendingEvents(harness.repository).some((entry) => entry.eventId === event.eventId), false);
  assert.equal(harness.repository.snapshot().peerWatermark.revision, event.revision);

  const secondEvent = await harness.watch.changeExercise(-1);
  const duplicateStatus = ackFor(secondEvent, {
    ackId: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002',
    status: 'DUPLICATE',
  });
  await harness.watch.receive(serializeSyncAck(duplicateStatus));
  assert.equal(
    pendingEvents(harness.repository).some((entry) => entry.eventId === secondEvent.eventId),
    false,
  );

  assert.throws(
    () => parseSyncAck(JSON.stringify({ ...applied, unknown: true })),
    /unknown field/,
  );
});

test('STALE, CONFLICT, and REJECTED ACKs keep data and record sanitized diagnostics', async () => {
  for (const [index, status] of ['STALE', 'CONFLICT', 'REJECTED'].entries()) {
    const harness = await createHarness();
    const event = await harness.watch.changeExercise(1);
    const ack = ackFor(event, {
      ackId: `bbbbbbbb-bbbb-4bbb-8bbb-${String(100 + index).padStart(12, '0')}`,
      errorCode: `${status}_REVISION`,
      status,
    });
    await harness.watch.receive(serializeSyncAck(ack));
    assert.equal(pendingEvents(harness.repository).some((entry) => entry.eventId === event.eventId), true);
    assert.equal(harness.watch.getState().lastErrorCode, `${status}_REVISION`);
    assert.equal(harness.watch.getState().conflictCount, 1);
    await harness.watch.receive(serializeSyncAck(ack));
    assert.equal(harness.watch.getState().conflictCount, 1);
  }
});

test('same eventId with changed canonical event content records EVENT_ID_REUSE', async () => {
  const harness = await createHarness();
  const base = harness.watch.getState().activeWorkout;
  const exercise = base.exercises[1];
  const event = createWatchEvent({
    deviceId: 'phone-stage5-test',
    eventId: 'cccccccc-cccc-4ccc-8ccc-000000000001',
    payload: {
      exerciseId: exercise.exerciseId,
      exerciseSessionId: exercise.exerciseSessionId,
      order: exercise.order,
    },
    revision: base.revision + 1,
    sessionId: base.session.sessionId,
    source: 'PHONE',
    timestamp: harness.clock.now(),
    type: WatchEventType.ACTIVE_EXERCISE_CHANGED,
  });
  await harness.watch.receive(JSON.stringify(event));
  const changed = clone(event);
  changed.payload = {
    exerciseId: base.exercises[0].exerciseId,
    exerciseSessionId: base.exercises[0].exerciseSessionId,
    order: base.exercises[0].order,
  };
  const result = await harness.watch.receive(JSON.stringify(changed));
  assert.equal(result.conflict, true);
  assert.equal(harness.repository.conflicts().at(-1).code, 'EVENT_ID_REUSE');
});

test('two offline actions keep consecutive revisions, survive restart, and replay on reconnect', async () => {
  const backend = createVolatileStorageBackend();
  const first = await createHarness({ backend });
  await first.transports.watch.disconnect();
  const forward = await first.watch.changeExercise(1);
  const backward = await first.watch.changeExercise(-1);
  assert.deepEqual([forward.revision, backward.revision], [first.snapshot.revision + 1, first.snapshot.revision + 2]);

  await first.watch.stop();
  const second = await createHarness({ backend, sendSnapshot: false });
  assert.deepEqual(
    pendingEvents(second.repository).map((event) => event.eventId),
    [forward.eventId, backward.eventId],
  );
  const replayed = second.receivedMessages
    .map((serialized) => JSON.parse(serialized))
    .filter((entry) => entry.eventId)
    .map((entry) => entry.eventId);
  assert.deepEqual(replayed, [forward.eventId, backward.eventId]);
});

test('sensor checkpoint queues file and manifest offline and retains raw samples until ACK', async () => {
  const backend = createVolatileStorageBackend();
  const harness = await createHarness({ backend });
  await harness.transports.watch.disconnect();
  const active = harness.watch.getState().activeWorkout;
  const context = {
    sessionId: active.session.sessionId,
    exerciseSessionId: active.exercises[0].exerciseSessionId,
    setId: null,
    phase: SensorPhase.WORKOUT,
  };
  const sample = createSensorSample({
    context,
    reading: { valid: true, value: 123 },
    sampleId: 'dddddddd-dddd-4ddd-8ddd-000000000001',
    sensorType: SensorType.HEART_RATE,
    timestamp: harness.clock.now(),
    unit: 'BPM',
  });
  await harness.watch.recordSensorSample(sample);
  await harness.watch.lifecycleCheckpoint();

  const manifest = pendingEvents(harness.repository).find(
    (event) => event.type === WatchEventType.SENSOR_BATCH_RECORDED,
  );
  assert.ok(manifest);
  assert.equal(harness.repository.pendingFileTransfers('OUTBOUND').length, 1);
  assert.equal(harness.repository.sensorSamples().length, 1);
  assert.equal(harness.repository.unassignedSensorSamples().length, 0);

  const restartedRepository = new WatchStateRepository(backend);
  await restartedRepository.load();
  assert.equal(restartedRepository.pendingFileTransfers('OUTBOUND').length, 1);
  assert.equal(restartedRepository.sensorSamples().length, 1);

  await harness.transports.watch.connect();
  assert.equal(harness.receivedFiles.length >= 1, true);
  await harness.watch.receive(
    serializeSyncAck(
      ackFor(manifest, {
        ackId: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000300',
      }),
    ),
  );
  assert.equal(harness.repository.pendingFileTransfers('OUTBOUND').length, 0);
  assert.equal(harness.repository.sensorSamples().length, 0);
});

test('sensor buffer queues assigned samples before overflow without rebatching or loss', async () => {
  const harness = await createHarness({ sensorSampleLimit: 1 });
  await harness.transports.watch.disconnect();
  const active = harness.watch.getState().activeWorkout;
  const context = {
    sessionId: active.session.sessionId,
    exerciseSessionId: active.exercises[0].exerciseSessionId,
    setId: null,
    phase: SensorPhase.WORKOUT,
  };
  for (const [index, value] of [120, 121].entries()) {
    await harness.watch.recordSensorSample(
      createSensorSample({
        context,
        reading: { valid: true, value },
        sampleId: `dddddddd-dddd-4ddd-8ddd-${String(100 + index).padStart(12, '0')}`,
        sensorType: SensorType.HEART_RATE,
        timestamp: harness.clock.advance(1_000),
        unit: 'BPM',
      }),
    );
  }
  const transfer = harness.repository.pendingFileTransfers('OUTBOUND')[0];
  assert.deepEqual(transfer.sampleIds, ['dddddddd-dddd-4ddd-8ddd-000000000100']);
  assert.deepEqual(
    harness.repository.unassignedSensorSamples().map((sample) => sample.sampleId),
    ['dddddddd-dddd-4ddd-8ddd-000000000101'],
  );
  assert.equal(harness.repository.sensorSamples().length, 2);
});

test('FileTransferEnvelope detects corrupt hash, corrupt length, redelivery, and target bounds', async () => {
  const fixture = await sharedJson('examples/file-transfer-envelope.json');
  assert.deepEqual(parseFileTransferEnvelope(JSON.stringify(fixture)), fixture);

  const corruptPayload = clone(fixture);
  corruptPayload.payload.samples[0].value = 155;
  assert.throws(() => parseFileTransferEnvelope(JSON.stringify(corruptPayload)), /sha256/);
  const corruptLength = { ...fixture, byteLength: fixture.byteLength + 1 };
  assert.throws(() => parseFileTransferEnvelope(JSON.stringify(corruptLength)), /byteLength/);

  const largePayload = clone(fixture.payload);
  largePayload.samples[0].quality = 'x'.repeat(3_500_000);
  const large = createFileTransferEnvelope({
    createdAt: fixture.createdAt,
    deviceId: fixture.deviceId,
    payload: largePayload,
    payloadId: fixture.payloadId,
    payloadType: fixture.payloadType,
    relatedEventId: fixture.relatedEventId,
    sequence: fixture.sequence,
    sessionId: fixture.sessionId,
    source: fixture.source,
    totalSequences: fixture.totalSequences,
    transferId: fixture.transferId,
  });
  assert.throws(
    () => serializeFileTransferEnvelope(large),
    (error) => error instanceof DataEnvelopeTooLargeError && error.maxBytes === 3_500_000,
  );
  const forbiddenPayload = clone(fixture.payload);
  forbiddenPayload.samples[0].quality = 'y'.repeat(3_999_000);
  assert.throws(
    () =>
      createFileTransferEnvelope({
        createdAt: fixture.createdAt,
        deviceId: fixture.deviceId,
        payload: forbiddenPayload,
        payloadId: fixture.payloadId,
        payloadType: fixture.payloadType,
        relatedEventId: fixture.relatedEventId,
        sequence: fixture.sequence,
        sessionId: fixture.sessionId,
        source: fixture.source,
        totalSequences: fixture.totalSequences,
        transferId: fixture.transferId,
      }),
    /below 4,000,000 bytes/,
  );

  const transports = createDebugTransportPair();
  const delivered = [];
  transports.phone.setFileHandler(async (serialized) => delivered.push(serialized));
  await transports.phone.connect();
  await transports.watch.connect();
  await transports.watch.sendFile(JSON.stringify(fixture));
  await transports.watch.redeliverLastFile();
  assert.equal(delivered.length, 2);
  transports.watch.corruptNextFile();
  await transports.watch.sendFile(JSON.stringify(fixture));
  assert.throws(() => parseFileTransferEnvelope(delivered[2]), /sha256/);
});

test('snapshot reconciliation replays pending set/delete events and restores absolute runtime timers', async () => {
  const source = idleSnapshot(await sharedJson('examples/sync-snapshot.json'));
  const harness = await createHarness({ snapshot: source });
  await harness.transports.watch.disconnect();
  await harness.watch.startSet();
  harness.clock.advance(5_000);
  await harness.watch.completeSet({ weight: 100, reps: 8, rir: 2 });
  await harness.watch.skipRest();
  await harness.watch.deleteLastSet();
  const pendingIds = pendingEvents(harness.repository).map((event) => event.eventId);

  const replacement = clone(source);
  replacement.snapshotId = 'eeeeeeee-eeee-4eee-8eee-000000000001';
  replacement.timestamp = harness.clock.advance(1_000);
  await harness.watch.receiveFile(JSON.stringify(replacement));
  assert.deepEqual(pendingEvents(harness.repository).map((event) => event.eventId), pendingIds);
  assert.equal(
    harness.watch.getState().activeWorkout.completedSets.some((set) => set.setId === 'watch_set_stage5'),
    false,
  );
  assert.equal(
    harness.repository.snapshot().snapshotWatermark.snapshotId,
    replacement.snapshotId,
  );

  const runtime = clone(source);
  runtime.snapshotId = 'eeeeeeee-eeee-4eee-8eee-000000000002';
  runtime.timestamp = harness.clock.advance(1_000);
  runtime.workoutSession.activeSetId = 'runtime_set_stage5';
  runtime.runtimeState.activeSetId = 'runtime_set_stage5';
  runtime.runtimeState.setStartedAt = runtime.timestamp - 20_000;
  runtime.runtimeState.updatedAt = runtime.timestamp;
  const cleanHarness = await createHarness({ sendSnapshot: false, snapshot: source });
  await cleanHarness.watch.receiveFile(JSON.stringify(runtime));
  assert.equal(cleanHarness.watch.timerState(runtime.timestamp).setElapsedMs, 20_000);
});

test('repository safely migrates the Stage 2 document to durable Stage 5 records', async () => {
  const backend = createVolatileStorageBackend();
  await backend.set(
    'gymcoach.watch.control.v1',
    JSON.stringify({
      version: 2,
      state: {
        lastPongAt: 10,
        lastSnapshotAt: null,
        lastError: 'server details must not survive verbatim',
      },
      outbox: [],
      receipts: ['legacy-message'],
      activeWorkout: null,
    }),
  );
  const repository = new WatchStateRepository(backend);
  const migrated = await repository.load();
  assert.equal(migrated.version, 4);
  assert.equal(migrated.receiptRecords[0].id, 'legacy-message');
  assert.equal(migrated.receiptRecords[0].canonicalHash, null);
  assert.equal(migrated.state.lastError, 'SERVER_DETAILS_MUST_NOT_SURVIVE_VERBATIM');
  assert.deepEqual(migrated.pendingFileTransfers, []);
  assert.deepEqual(migrated.sensorSamples, []);
});

test('revision gap requests a snapshot without applying the event', async () => {
  const harness = await createHarness();
  const active = harness.watch.getState().activeWorkout;
  const exercise = active.exercises[1];
  const gap = createWatchEvent({
    deviceId: 'phone-stage5-test',
    eventId: 'ffffffff-ffff-4fff-8fff-000000000001',
    payload: {
      exerciseId: exercise.exerciseId,
      exerciseSessionId: exercise.exerciseSessionId,
      order: exercise.order,
    },
    revision: active.revision + 2,
    sessionId: active.session.sessionId,
    source: 'PHONE',
    timestamp: harness.clock.now(),
    type: WatchEventType.ACTIVE_EXERCISE_CHANGED,
  });
  const result = await harness.watch.receive(JSON.stringify(gap));
  assert.equal(result.gap, true);
  assert.equal(harness.watch.getState().activeWorkout.revision, active.revision);
  assert.equal(
    harness.repository.pending().some((entry) => entry.type === 'SYNC_REQUESTED'),
    true,
  );
});
