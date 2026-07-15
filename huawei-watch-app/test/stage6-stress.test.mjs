import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { canonicalSha256 } from '../src/core/canonical-json.js';
import { WatchCompanion } from '../src/core/companion.js';
import {
  createFileTransferEnvelope,
  createSyncAck,
  createWatchEvent,
  FILE_TARGET_BYTES,
  MAX_FILE_BYTES,
  parseFileTransferEnvelope,
  serializeFileTransferEnvelope,
  serializeSyncAck,
  WatchEventType,
} from '../src/core/contracts.js';
import {
  ControlMessageType,
  createControlMessage,
  serializeControlMessage,
  TARGET_MESSAGE_BYTES,
  utf8ByteLength,
} from '../src/core/messages.js';
import {
  buildSensorBatches,
  createSensorSample,
  SensorPhase,
  SensorType,
} from '../src/core/sensors.js';
import { createVolatileStorageBackend, WatchStateRepository } from '../src/core/storage.js';
import { createDebugTransportPair } from '../src/debug/debug-transport.js';

async function sharedSnapshot() {
  const url = new URL('../../shared-contracts/examples/sync-snapshot.json', import.meta.url);
  return JSON.parse(await readFile(url, 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
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

function uuidSequence(seed = 'a', start = 1) {
  let value = start - 1;
  return () => {
    value += 1;
    return `${seed.repeat(8)}-${seed.repeat(4)}-4${seed.repeat(3)}-8${seed.repeat(3)}-${String(value).padStart(12, '0')}`;
  };
}

function stressSnapshot(source, exerciseCount = 10) {
  const snapshot = clone(source);
  snapshot.revision = 1;
  snapshot.timestamp += 10_000;
  snapshot.setRecords = [];
  snapshot.sensorSamples = [];
  snapshot.pendingEvents = [];
  snapshot.exerciseSessions = Array.from({ length: exerciseCount }, (_, index) => ({
    exerciseSessionId: `exercise_session_stress_${index + 1}`,
    sessionId: snapshot.sessionId,
    exerciseId: `exercise_stress_${index + 1}`,
    exerciseName: `Stress exercise ${index + 1}`,
    order: index + 1,
    status: index === 0 ? 'ACTIVE' : 'PENDING',
    targetSets: 8,
    targetReps: 8 + (index % 4),
    targetRir: 2,
    restDurationSeconds: 60 + (index % 3) * 30,
  }));
  const activeExerciseId = snapshot.exerciseSessions[0].exerciseId;
  snapshot.workoutSession = {
    ...snapshot.workoutSession,
    status: 'ACTIVE',
    finishedAt: null,
    activeExerciseId,
    activeSetId: null,
    revision: snapshot.revision,
    updatedAt: snapshot.timestamp,
    updatedBy: 'PHONE',
  };
  snapshot.runtimeState = {
    ...snapshot.runtimeState,
    status: 'ACTIVE',
    activeExerciseId,
    activeSetId: null,
    setStartedAt: null,
    pausedAt: null,
    workoutAccumulatedPauseMs: 0,
    setAccumulatedPauseMs: 0,
    rest: null,
    revision: snapshot.revision,
    updatedAt: snapshot.timestamp,
    updatedBy: 'PHONE',
  };
  return snapshot;
}

function activeSensorContext(watch) {
  const active = watch.getState().activeWorkout;
  const exercise = active.exercises.find(
    (candidate) => candidate.exerciseId === active.activeExerciseId,
  );
  return {
    sessionId: active.session.sessionId,
    exerciseSessionId: exercise.exerciseSessionId,
    setId: active.pendingSet?.setId ?? active.rest?.setId ?? active.activeSetId,
    phase: active.pendingSet
      ? SensorPhase.SET
      : active.rest
        ? SensorPhase.REST
        : SensorPhase.WORKOUT,
  };
}

async function recordHeartRate(watch, clock, sampleId, value) {
  await watch.recordSensorSample(
    createSensorSample({
      context: activeSensorContext(watch),
      reading: { quality: 'GOOD', valid: true, value },
      sampleId,
      sensorType: SensorType.HEART_RATE,
      timestamp: clock.advance(500),
      unit: 'BPM',
    }),
  );
}

function createWatch({
  backend,
  clock,
  eventIdGenerator,
  setIdGenerator,
}) {
  const transports = createDebugTransportPair();
  const repository = new WatchStateRepository(backend);
  const watch = new WatchCompanion({
    clock: clock.now,
    deviceId: 'watch-stage6-stress',
    eventIdGenerator,
    idGenerator: (() => {
      let value = 0;
      return () => `stress-control-${++value}`;
    })(),
    repository,
    setIdGenerator,
    transport: transports.watch,
  });
  return { repository, transports, watch };
}

test('large offline workout survives restart and reconnect without loss', async () => {
  const source = stressSnapshot(await sharedSnapshot());
  const backend = createVolatileStorageBackend();
  const clock = mutableClock(source.timestamp + 1_000);
  const eventIds = uuidSequence('a');
  const sampleIds = uuidSequence('b');
  let setId = 0;
  const first = createWatch({
    backend,
    clock,
    eventIdGenerator: eventIds,
    setIdGenerator: () => `watch_set_stress_${++setId}`,
  });
  await first.watch.start();
  await first.transports.watch.disconnect();
  await first.watch.receiveFile(JSON.stringify(source));

  for (let exerciseIndex = 0; exerciseIndex < source.exerciseSessions.length; exerciseIndex += 1) {
    for (let setIndex = 0; setIndex < 8; setIndex += 1) {
      clock.advance(1_000);
      await first.watch.startSet();
      await recordHeartRate(first.watch, clock, sampleIds(), 120 + (setIndex % 20));
      await first.watch.completeSet({
        comment: `exercise-${exerciseIndex + 1}-set-${setIndex + 1}`,
        weight: 60 + exerciseIndex * 5 + setIndex,
        reps: 8 + (setIndex % 4),
        rir: setIndex % 4,
      });
      await recordHeartRate(first.watch, clock, sampleIds(), 140 - (setIndex % 15));
      await first.watch.adjustRest(setIndex % 2 === 0 ? 15 : 30);
      if (setIndex === 0) {
        await first.watch.togglePause();
        clock.advance(2_000);
        await first.watch.togglePause();
      }
      await first.watch.skipRest();
      if (setIndex % 2 === 0) {
        await first.watch.updateLastSet({
          comment: `edited-${exerciseIndex + 1}-${setIndex + 1}`,
          weight: 61 + exerciseIndex * 5 + setIndex,
          reps: 9 + (setIndex % 3),
          rir: 1,
        });
      }
      if (setIndex % 4 === 3) {
        await first.watch.deleteLastSet();
      }
    }
    if (exerciseIndex < source.exerciseSessions.length - 1) {
      await first.watch.changeExercise(1);
    }
  }

  const pendingBeforeRestart = first.repository.pending();
  const eventsBeforeRestart = pendingBeforeRestart.filter((entry) => entry.eventId);
  const filesBeforeRestart = first.repository.pendingFileTransfers('OUTBOUND');
  const completedBeforeRestart = first.watch.getState().activeWorkout.completedSets;
  const eventIdOrder = eventsBeforeRestart.map((event) => event.eventId);
  const transferIdOrder = filesBeforeRestart.map((transfer) => transfer.transferId);

  assert.equal(eventsBeforeRestart.length > 600, true);
  assert.equal(filesBeforeRestart.length, 160);
  assert.equal(completedBeforeRestart.length, 60);
  assert.deepEqual(
    eventsBeforeRestart.map((event) => event.revision),
    Array.from({ length: eventsBeforeRestart.length }, (_, index) => source.revision + index + 1),
  );
  assert.equal(first.repository.sensorSamples().length, 160);
  assert.equal(first.repository.snapshot().receiptRecords.length <= 512, true);
  assert.equal(first.repository.conflicts().length <= 128, true);
  assert.equal(utf8ByteLength(JSON.stringify(first.repository.snapshot())) < MAX_FILE_BYTES, true);

  await first.watch.stop();

  const receivedEvents = [];
  const receivedFiles = [];
  const ackIds = uuidSequence('e');
  let phoneControlId = 0;
  const second = createWatch({
    backend,
    clock,
    eventIdGenerator: uuidSequence('c', 5_000),
    setIdGenerator: () => `watch_set_restarted_${++setId}`,
  });
  second.transports.phone.setFileHandler(async (serialized) => {
    assert.equal(utf8ByteLength(serialized) <= FILE_TARGET_BYTES, true);
    assert.equal(utf8ByteLength(serialized) < MAX_FILE_BYTES, true);
    receivedFiles.push(parseFileTransferEnvelope(serialized));
  });
  second.transports.phone.setMessageHandler(async (serialized) => {
    assert.equal(utf8ByteLength(serialized) <= TARGET_MESSAGE_BYTES, true);
    const envelope = JSON.parse(serialized);
    if (envelope.messageId) {
      if (envelope.type === ControlMessageType.SYNC_REQUESTED) {
        await second.transports.phone.send(
          serializeControlMessage(
            createControlMessage({
              deviceId: 'phone-stage6-stress',
              messageId: `phone-stress-control-${++phoneControlId}`,
              payload: {
                sessionId: source.sessionId,
                revision: eventsBeforeRestart.at(-1).revision,
              },
              replyTo: envelope.messageId,
              source: 'PHONE',
              timestamp: clock.advance(1),
              type: ControlMessageType.SYNC_SNAPSHOT,
            }),
          ),
        );
      }
      return;
    }
    if (envelope.eventId) {
      receivedEvents.push(envelope);
      await second.transports.phone.send(
        serializeSyncAck(
          createSyncAck({
            ackId: ackIds(),
            deviceId: 'phone-stage6-stress',
            eventIds: [envelope.eventId],
            revision: envelope.revision,
            sessionId: envelope.sessionId,
            source: 'PHONE',
            status: 'APPLIED',
            timestamp: clock.advance(1),
          }),
        ),
      );
    }
  });
  await second.transports.phone.connect();

  const loaded = await second.repository.load();
  assert.deepEqual(
    loaded.outbox.filter((entry) => entry.eventId).map((event) => event.eventId),
    eventIdOrder,
  );
  assert.deepEqual(
    loaded.pendingFileTransfers.map((transfer) => transfer.transferId),
    transferIdOrder,
  );
  assert.equal(loaded.activeWorkout.completedSets.length, completedBeforeRestart.length);

  await second.watch.start();

  assert.deepEqual(receivedEvents.map((event) => event.eventId), eventIdOrder);
  assert.deepEqual(
    new Set(receivedFiles.map((transfer) => transfer.transferId)),
    new Set(transferIdOrder),
  );
  assert.deepEqual(second.repository.pending(), []);
  assert.deepEqual(second.repository.pendingFileTransfers('OUTBOUND'), []);
  assert.deepEqual(second.repository.sensorSamples(), []);
  assert.equal(second.watch.getState().activeWorkout.completedSets.length, 60);
  assert.equal(second.repository.snapshot().receiptRecords.length <= 512, true);
  assert.equal(second.repository.snapshot().receipts.length <= 512, true);
  assert.equal(second.repository.conflicts().length, 0);
  assert.equal(
    second.repository.snapshot().peerWatermark.revision,
    eventsBeforeRestart.at(-1).revision,
  );
});

test('sensor batching reserves room for the file envelope below transport targets', () => {
  const sampleIds = uuidSequence('d');
  const context = {
    sessionId: 'mob_session_stage6_file_stress',
    exerciseSessionId: null,
    setId: null,
    phase: SensorPhase.WORKOUT,
  };
  const samples = Array.from({ length: 4 }, (_, index) =>
    createSensorSample({
      context,
      quality: 'q'.repeat(1_166_150),
      reading: { valid: true, value: 120 + index },
      sampleId: sampleIds(),
      sensorType: SensorType.HEART_RATE,
      timestamp: 10_000 + index,
      unit: 'BPM',
    }),
  );
  const batches = buildSensorBatches({
    batchId: 'dddddddd-dddd-4ddd-8ddd-000000009999',
    createdAt: 10_000,
    deviceId: 'watch-stage6-file-stress',
    samples,
    sessionId: context.sessionId,
  });

  assert.equal(batches.length > 1, true);
  for (const [index, batch] of batches.entries()) {
    const envelope = createFileTransferEnvelope({
      createdAt: batch.createdAt,
      deviceId: batch.deviceId,
      payload: batch,
      payloadId: batch.batchId,
      payloadType: 'SENSOR_BATCH',
      relatedEventId: `eeeeeeee-eeee-4eee-8eee-${String(index + 1).padStart(12, '0')}`,
      sequence: batch.sequence,
      sessionId: batch.sessionId,
      source: batch.source,
      totalSequences: batch.totalSequences,
      transferId: `ffffffff-ffff-4fff-8fff-${String(index + 1).padStart(12, '0')}`,
    });
    const serialized = serializeFileTransferEnvelope(envelope);
    assert.equal(utf8ByteLength(serialized) <= FILE_TARGET_BYTES, true);
    assert.equal(utf8ByteLength(serialized) < MAX_FILE_BYTES, true);
  }
});

test('concurrent edit and delete retain both hashes and reconcile to confirmed snapshot', async () => {
  const source = clone(await sharedSnapshot());
  source.workoutSession.activeSetId = null;
  source.runtimeState.activeSetId = null;
  source.runtimeState.setStartedAt = null;
  source.runtimeState.setAccumulatedPauseMs = 0;
  source.runtimeState.rest = null;
  const backend = createVolatileStorageBackend();
  const clock = mutableClock(source.timestamp + 10_000);
  const harness = createWatch({
    backend,
    clock,
    eventIdGenerator: uuidSequence('a'),
    setIdGenerator: () => 'watch_set_conflict_unused',
  });
  await harness.transports.phone.connect();
  harness.transports.phone.setMessageHandler(async () => {});
  await harness.watch.start();
  await harness.watch.receiveFile(JSON.stringify(source));

  const localEdit = await harness.watch.updateLastSet({
    comment: 'local confirmed edit candidate',
    weight: 102.5,
    reps: 9,
    rir: 1,
  });
  const remoteDelete = createWatchEvent({
    deviceId: 'phone-stage6-conflict',
    eventId: 'bbbbbbbb-bbbb-4bbb-8bbb-000000008888',
    payload: {
      setId: source.setRecords[0].setId,
      deletedAt: clock.advance(1_000),
      baseRevision: source.revision,
    },
    revision: localEdit.revision,
    sessionId: source.sessionId,
    source: 'PHONE',
    timestamp: clock.now(),
    type: WatchEventType.SET_DELETED,
  });

  const conflictResult = await harness.watch.receive(JSON.stringify(remoteDelete));
  assert.equal(conflictResult.conflict, true);
  const concurrent = harness.repository.conflicts().find(
    (entry) => entry.code === 'CONCURRENT_REVISION',
  );
  assert.equal(concurrent.localHash, canonicalSha256(localEdit));
  assert.equal(concurrent.remoteHash, canonicalSha256(remoteDelete));
  assert.equal(
    harness.repository.pending().some((entry) => entry.eventId === localEdit.eventId),
    true,
  );
  assert.equal(
    harness.watch.getState().activeWorkout.completedSets[0].comment,
    localEdit.payload.comment,
  );

  const confirmed = clone(source);
  confirmed.snapshotId = 'cccccccc-cccc-4ccc-8ccc-000000007777';
  confirmed.revision = remoteDelete.revision;
  confirmed.timestamp = clock.advance(1_000);
  confirmed.setRecords = [];
  confirmed.workoutSession.revision = confirmed.revision;
  confirmed.workoutSession.updatedAt = confirmed.timestamp;
  confirmed.runtimeState.revision = confirmed.revision;
  confirmed.runtimeState.updatedAt = confirmed.timestamp;
  await harness.watch.receiveFile(JSON.stringify(confirmed));

  assert.deepEqual(harness.watch.getState().activeWorkout.completedSets, []);
  assert.equal(
    harness.repository.pending().some((entry) => entry.eventId === localEdit.eventId),
    true,
  );
  const snapshotConflict = harness.repository.conflicts().find(
    (entry) => entry.code === 'SNAPSHOT_PENDING_CONFLICT',
  );
  assert.equal(snapshotConflict.localHash, canonicalSha256(localEdit));
  assert.equal(snapshotConflict.remoteHash, canonicalSha256(confirmed));
  assert.equal(harness.watch.getState().syncStatus, 'requesting');
});
