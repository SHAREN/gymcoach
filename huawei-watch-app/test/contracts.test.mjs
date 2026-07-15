import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  DataEnvelopeTooLargeError,
  encodeSyncSnapshotForTransport,
  encodeWatchEventForTransport,
  MAX_FILE_BYTES,
  parseExerciseSession,
  parseSetRecord,
  parseSyncSnapshot,
  parseWatchEvent,
  parseWorkoutSession,
  serializeExerciseSession,
  serializeSetRecord,
  serializeSyncSnapshot,
  serializeWatchEvent,
  serializeWorkoutSession,
  validateExerciseSession,
  validateSetRecord,
  validateSyncSnapshot,
  WatchEventType,
} from '../src/core/contracts.js';

async function sharedJson(relativePath) {
  const url = new URL(`../../shared-contracts/${relativePath}`, import.meta.url);
  return JSON.parse(await readFile(url, 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('shared v1 DTO fixtures round-trip through strict watch serializers', async () => {
  const workout = await sharedJson('examples/workout-session.json');
  const exercise = await sharedJson('examples/exercise-session.json');
  const set = await sharedJson('examples/set-record.json');
  const event = await sharedJson('examples/watch-event.json');
  const snapshot = await sharedJson('examples/sync-snapshot.json');

  assert.deepEqual(parseWorkoutSession(serializeWorkoutSession(workout)), workout);
  assert.deepEqual(parseExerciseSession(serializeExerciseSession(exercise)), exercise);
  assert.deepEqual(parseSetRecord(serializeSetRecord(set)), set);
  assert.deepEqual(parseWatchEvent(serializeWatchEvent(event)), event);
  assert.deepEqual(parseSyncSnapshot(serializeSyncSnapshot(snapshot)), snapshot);
});

test('Stage 3 payload fixture matches exact event payload contracts', async () => {
  const payloads = await sharedJson('fixtures/stage3-event-payloads.json');
  assert.deepEqual(Object.keys(payloads.activeExerciseChanged).sort(), [
    'exerciseId',
    'exerciseSessionId',
    'order',
  ]);
  assert.deepEqual(Object.keys(payloads.setStarted).sort(), [
    'exerciseSessionId',
    'setId',
    'setNumber',
    'startedAt',
  ]);
  validateSetRecord(payloads.setCompleted);
  assert.deepEqual(Object.keys(payloads.setDeleted).sort(), [
    'baseRevision',
    'deletedAt',
    'setId',
  ]);
});

test('opaque domain IDs are accepted without UUID conversion', async () => {
  const workout = await sharedJson('examples/workout-session.json');
  const serialized = serializeWorkoutSession({
    ...workout,
    sessionId: 'mob_session_non_uuid',
    workoutProgramId: 'program_prefixed_value',
    userId: 'user_prefixed_value',
    activeExerciseId: 'exercise_prefixed_value',
    activeSetId: 'set_prefixed_value',
  });
  const parsed = parseWorkoutSession(serialized);
  assert.equal(parsed.sessionId, 'mob_session_non_uuid');
  assert.equal(parsed.activeSetId, 'set_prefixed_value');
});

test('strength DTO validation rejects fractional or out-of-range input', async () => {
  const exercise = await sharedJson('examples/exercise-session.json');
  const set = await sharedJson('examples/set-record.json');

  for (const targetRir of [1.5, -1, 6]) {
    assert.throws(() => validateExerciseSession({ ...exercise, targetRir }));
  }
  for (const weight of [-1, 500.1]) {
    assert.throws(() => validateSetRecord({ ...set, weight }));
  }
  for (const reps of [0, 1.5, 101]) {
    assert.throws(() => validateSetRecord({ ...set, reps }));
  }
  for (const rir of [-1, 1.5, 6]) {
    assert.throws(() => validateSetRecord({ ...set, rir }));
  }
  assert.equal(validateSetRecord({ ...set, rir: null }).rir, null);
  assert.throws(() =>
    validateSetRecord({ ...set, startedAt: set.completedAt + 1 }),
  );
});

test('snapshot validation enforces active exercise, uniqueness, linkage, and revisions', async () => {
  const snapshot = await sharedJson('examples/sync-snapshot.json');
  validateSyncSnapshot(snapshot);

  const duplicateOrder = clone(snapshot);
  duplicateOrder.exerciseSessions[1].order = duplicateOrder.exerciseSessions[0].order;
  assert.throws(() => validateSyncSnapshot(duplicateOrder));

  const noActive = clone(snapshot);
  noActive.exerciseSessions[0].status = 'PENDING';
  assert.throws(() => validateSyncSnapshot(noActive));

  const unknownExercise = clone(snapshot);
  unknownExercise.workoutSession.activeExerciseId = 'exercise_unknown';
  assert.throws(() => validateSyncSnapshot(unknownExercise));

  const badSetLink = clone(snapshot);
  badSetLink.setRecords[0].exerciseSessionId = 'exercise_session_unknown';
  assert.throws(() => validateSyncSnapshot(badSetLink));

  const futureSet = clone(snapshot);
  futureSet.setRecords[0].revision = snapshot.revision + 1;
  assert.throws(() => validateSyncSnapshot(futureSet));
});

test('data envelopes use message delivery up to 1,024 bytes and file fallback above it', async () => {
  const payloads = await sharedJson('fixtures/stage3-event-payloads.json');
  const snapshot = await sharedJson('examples/sync-snapshot.json');
  const event = {
    protocolVersion: '1.0',
    schemaVersion: 1,
    eventId: '10000000-0000-4000-8000-000000000001',
    sessionId: payloads.setCompleted.sessionId,
    type: WatchEventType.SET_COMPLETED,
    timestamp: payloads.setCompleted.completedAt,
    source: 'WATCH',
    deviceId: 'watch-test',
    revision: payloads.setCompleted.revision,
    payload: payloads.setCompleted,
  };

  assert.equal(encodeWatchEventForTransport(event).mode, 'MESSAGE');
  const fileEvent = clone(event);
  fileEvent.eventId = '10000000-0000-4000-8000-000000000002';
  fileEvent.payload.comment = 'x'.repeat(2_000);
  assert.equal(encodeWatchEventForTransport(fileEvent).mode, 'FILE');
  assert.equal(encodeSyncSnapshotForTransport(snapshot).mode, 'FILE');

  const oversized = clone(event);
  oversized.eventId = '10000000-0000-4000-8000-000000000003';
  oversized.payload.comment = 'x'.repeat(MAX_FILE_BYTES);
  assert.throws(
    () => encodeWatchEventForTransport(oversized),
    (error) => error instanceof DataEnvelopeTooLargeError,
  );
});
