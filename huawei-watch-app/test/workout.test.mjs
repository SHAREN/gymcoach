import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  createWatchEvent,
  encodeSyncSnapshotForTransport,
  encodeWatchEventForTransport,
  parseWatchEvent,
  WatchEventType,
} from '../src/core/contracts.js';
import { WatchCompanion } from '../src/core/companion.js';
import { createVolatileStorageBackend, WatchStateRepository } from '../src/core/storage.js';
import { createDebugTransportPair } from '../src/debug/debug-transport.js';
import { currentExercise } from '../src/core/workout-state.js';

async function sharedJson(relativePath) {
  const url = new URL(`../../shared-contracts/${relativePath}`, import.meta.url);
  return JSON.parse(await readFile(url, 'utf8'));
}

function sequenceClock(start) {
  let value = start;
  return () => ++value;
}

function uuidSequence(start = 1) {
  let value = start - 1;
  return () => {
    value += 1;
    return `10000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
  };
}

async function createHarness({
  backend = createVolatileStorageBackend(),
  sendSnapshot = true,
  snapshot,
}) {
  const transports = createDebugTransportPair();
  const receivedMessages = [];
  const receivedFiles = [];
  transports.phone.setMessageHandler(async (serialized) => receivedMessages.push(serialized));
  transports.phone.setFileHandler(async (serialized) => receivedFiles.push(serialized));
  await transports.phone.connect();

  const repository = new WatchStateRepository(backend);
  const watch = new WatchCompanion({
    clock: sequenceClock(snapshot.timestamp + 10_000),
    deviceId: 'watch-stage3-test',
    eventIdGenerator: uuidSequence(),
    idGenerator: (() => {
      let id = 0;
      return () => `control-${++id}`;
    })(),
    repository,
    setIdGenerator: () => 'watch_set_stable_stage3',
    transport: transports.watch,
  });
  await watch.start();

  if (sendSnapshot) {
    const encoded = encodeSyncSnapshotForTransport(snapshot);
    if (encoded.mode === 'FILE') {
      await transports.phone.sendFile(encoded.serialized);
    } else {
      await transports.phone.send(encoded.serialized);
    }
  }

  return { backend, receivedFiles, receivedMessages, repository, transports, watch };
}

async function sendEvent(phoneTransport, event) {
  const encoded = encodeWatchEventForTransport(event);
  if (encoded.mode === 'FILE') {
    await phoneTransport.sendFile(encoded.serialized);
  } else {
    await phoneTransport.send(encoded.serialized);
  }
}

function workoutEvents(harness) {
  return [...harness.receivedMessages, ...harness.receivedFiles]
    .map((serialized) => JSON.parse(serialized))
    .filter((envelope) => Object.prototype.hasOwnProperty.call(envelope, 'eventId'))
    .map((envelope) => parseWatchEvent(JSON.stringify(envelope)));
}

test('opening the app applies a standalone snapshot and renders active state', async () => {
  const snapshot = await sharedJson('examples/sync-snapshot.json');
  const harness = await createHarness({ snapshot });
  const active = harness.watch.getState().activeWorkout;

  assert.equal(active.session.sessionId, snapshot.sessionId);
  assert.equal(active.exercises.length, 2);
  assert.equal(currentExercise(active).exerciseName, 'Barbell squat');
  assert.equal(active.completedSets.length, 1);
  assert.equal(active.startedAt, snapshot.workoutSession.startedAt);
  assert.equal(active.revision, snapshot.revision);
});

test('phone exercise change is applied and leaves exactly one ACTIVE exercise', async () => {
  const snapshot = await sharedJson('examples/sync-snapshot.json');
  const payloads = await sharedJson('fixtures/stage3-event-payloads.json');
  const harness = await createHarness({ snapshot });
  const event = createWatchEvent({
    deviceId: 'phone-stage3-test',
    eventId: '20000000-0000-4000-8000-000000000001',
    payload: payloads.activeExerciseChanged,
    revision: snapshot.revision + 1,
    sessionId: snapshot.sessionId,
    source: 'PHONE',
    timestamp: snapshot.timestamp + 1,
    type: WatchEventType.ACTIVE_EXERCISE_CHANGED,
  });

  await sendEvent(harness.transports.phone, event);
  const active = harness.watch.getState().activeWorkout;
  assert.equal(currentExercise(active).exerciseName, 'Bench press');
  assert.equal(active.exercises.filter((exercise) => exercise.status === 'ACTIVE').length, 1);
});

test('watch exercise change emits the exact durable event payload', async () => {
  const snapshot = await sharedJson('examples/sync-snapshot.json');
  const payloads = await sharedJson('fixtures/stage3-event-payloads.json');
  const harness = await createHarness({ snapshot });

  const event = await harness.watch.changeExercise(1);
  assert.equal(event.type, WatchEventType.ACTIVE_EXERCISE_CHANGED);
  assert.deepEqual(event.payload, payloads.activeExerciseChanged);
  assert.equal(event.source, 'WATCH');
  assert.equal(
    harness.repository.pending().some((envelope) => envelope.eventId === event.eventId),
    true,
  );
  assert.equal(
    workoutEvents(harness).some((received) => received.eventId === event.eventId),
    true,
  );
});

test('watch completes a set with stable setId and exact weight, reps, and RIR', async () => {
  const snapshot = await sharedJson('examples/sync-snapshot.json');
  snapshot.workoutSession.activeSetId = null;
  const harness = await createHarness({ snapshot });

  const started = await harness.watch.startSet();
  await assert.rejects(() =>
    harness.watch.completeSet({ weight: 102.5, reps: 9, rir: null }),
  );
  const completed = await harness.watch.completeSet({ weight: 102.5, reps: 9, rir: 1 });

  assert.equal(started.type, WatchEventType.SET_STARTED);
  assert.deepEqual(Object.keys(started.payload).sort(), [
    'exerciseSessionId',
    'setId',
    'setNumber',
    'startedAt',
  ]);
  assert.equal(completed.type, WatchEventType.SET_COMPLETED);
  assert.equal(completed.payload.setId, started.payload.setId);
  assert.equal(completed.payload.setId, 'watch_set_stable_stage3');
  assert.equal(completed.payload.weight, 102.5);
  assert.equal(completed.payload.reps, 9);
  assert.equal(completed.payload.rir, 1);
  assert.equal(completed.payload.revision, completed.revision);
  assert.equal(harness.watch.getState().activeWorkout.activeSetId, null);
  assert.equal(
    harness.watch.getState().activeWorkout.completedSets.some(
      (set) => set.setId === 'watch_set_stable_stage3',
    ),
    true,
  );
});

test('duplicate event delivery is idempotent', async () => {
  const snapshot = await sharedJson('examples/sync-snapshot.json');
  const payloads = await sharedJson('fixtures/stage3-event-payloads.json');
  const harness = await createHarness({ snapshot });
  const event = createWatchEvent({
    deviceId: 'phone-stage3-test',
    eventId: '20000000-0000-4000-8000-000000000002',
    payload: payloads.activeExerciseChanged,
    revision: snapshot.revision + 1,
    sessionId: snapshot.sessionId,
    source: 'PHONE',
    timestamp: snapshot.timestamp + 1,
    type: WatchEventType.ACTIVE_EXERCISE_CHANGED,
  });
  const encoded = encodeWatchEventForTransport(event);

  await harness.transports.phone.send(encoded.serialized);
  await harness.transports.phone.send(encoded.serialized);

  assert.equal(harness.watch.getState().activeWorkout.revision, event.revision);
  assert.equal(harness.repository.snapshot().receipts.filter((id) => id === event.eventId).length, 1);
});

test('active workout and outbound event survive a watch restart', async () => {
  const snapshot = await sharedJson('examples/sync-snapshot.json');
  const backend = createVolatileStorageBackend();
  const first = await createHarness({ backend, snapshot });
  const event = await first.watch.changeExercise(1);
  await first.watch.stop();

  const second = await createHarness({ backend, sendSnapshot: false, snapshot });
  const active = second.watch.getState().activeWorkout;

  assert.equal(currentExercise(active).exerciseName, 'Bench press');
  assert.equal(second.repository.pending().some((item) => item.eventId === event.eventId), true);
});

test('SET_STARTED, SET_UPDATED, SET_DELETED, and WORKOUT_FINISHED are applied', async () => {
  const snapshot = await sharedJson('examples/sync-snapshot.json');
  const payloads = await sharedJson('fixtures/stage3-event-payloads.json');
  const harness = await createHarness({ snapshot });
  let revision = snapshot.revision;

  const started = createWatchEvent({
    deviceId: 'phone-stage3-test',
    eventId: '40000000-0000-4000-8000-000000000001',
    payload: payloads.setStarted,
    revision: ++revision,
    sessionId: snapshot.sessionId,
    source: 'PHONE',
    timestamp: snapshot.timestamp + 1,
    type: WatchEventType.SET_STARTED,
  });
  await sendEvent(harness.transports.phone, started);
  assert.equal(harness.watch.getState().activeWorkout.pendingSet.setId, payloads.setStarted.setId);

  const updatedSet = {
    ...payloads.setCompleted,
    weight: 105,
    revision: ++revision,
  };
  const updated = createWatchEvent({
    deviceId: 'phone-stage3-test',
    eventId: '40000000-0000-4000-8000-000000000002',
    payload: updatedSet,
    revision,
    sessionId: snapshot.sessionId,
    source: 'PHONE',
    timestamp: snapshot.timestamp + 2,
    type: WatchEventType.SET_UPDATED,
  });
  await sendEvent(harness.transports.phone, updated);
  assert.equal(
    harness.watch.getState().activeWorkout.completedSets.find(
      (set) => set.setId === updatedSet.setId,
    ).weight,
    105,
  );

  const deleted = createWatchEvent({
    deviceId: 'phone-stage3-test',
    eventId: '40000000-0000-4000-8000-000000000003',
    payload: {
      setId: updatedSet.setId,
      deletedAt: snapshot.timestamp + 3,
      baseRevision: revision,
    },
    revision: ++revision,
    sessionId: snapshot.sessionId,
    source: 'PHONE',
    timestamp: snapshot.timestamp + 3,
    type: WatchEventType.SET_DELETED,
  });
  await sendEvent(harness.transports.phone, deleted);
  assert.equal(harness.watch.getState().activeWorkout.completedSets.length, 0);

  const finished = createWatchEvent({
    deviceId: 'phone-stage3-test',
    eventId: '40000000-0000-4000-8000-000000000004',
    payload: { finishedAt: snapshot.timestamp + 4 },
    revision: ++revision,
    sessionId: snapshot.sessionId,
    source: 'PHONE',
    timestamp: snapshot.timestamp + 4,
    type: WatchEventType.WORKOUT_FINISHED,
  });
  await sendEvent(harness.transports.phone, finished);
  assert.equal(harness.watch.getState().activeWorkout.session.status, 'FINISHED');
});

test('watch corrects and deletes the last set with exact durable payloads', async () => {
  const snapshot = await sharedJson('examples/sync-snapshot.json');
  snapshot.workoutSession.activeSetId = null;
  const harness = await createHarness({ snapshot });
  const original = snapshot.setRecords[0];

  const updated = await harness.watch.updateLastSet({ weight: 107.5, reps: 10, rir: 1 });
  assert.equal(updated.type, WatchEventType.SET_UPDATED);
  assert.equal(updated.payload.setId, original.setId);
  assert.equal(updated.payload.weight, 107.5);
  assert.equal(updated.payload.reps, 10);
  assert.equal(updated.payload.rir, 1);
  assert.equal(updated.payload.revision, updated.revision);

  const deleted = await harness.watch.deleteLastSet();
  assert.equal(deleted.type, WatchEventType.SET_DELETED);
  assert.deepEqual(Object.keys(deleted.payload).sort(), ['baseRevision', 'deletedAt', 'setId']);
  assert.equal(deleted.payload.setId, original.setId);
  assert.equal(deleted.payload.baseRevision, updated.revision);
  assert.equal(harness.watch.getState().activeWorkout.completedSets.length, 0);
  assert.equal(harness.repository.pending().some((item) => item.eventId === updated.eventId), true);
  assert.equal(harness.repository.pending().some((item) => item.eventId === deleted.eventId), true);
});
