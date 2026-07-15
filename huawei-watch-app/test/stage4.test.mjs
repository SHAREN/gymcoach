import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { WatchCompanion } from '../src/core/companion.js';
import {
  DataEnvelopeTooLargeError,
  encodeSensorBatchForTransport,
  encodeSyncSnapshotForTransport,
  MAX_FILE_BYTES,
  WatchEventType,
} from '../src/core/contracts.js';
import {
  buildSensorBatches,
  createSensorSample,
  createUnavailableProductionCollectors,
  SensorCollector,
  SensorPhase,
  SensorSampleBuffer,
  SensorType,
  summarizeHeartRate,
  summarizeRestHeartRate,
} from '../src/core/sensors.js';
import { createVolatileStorageBackend, WatchStateRepository } from '../src/core/storage.js';
import { setElapsedMs } from '../src/core/timers.js';
import { createDebugTransportPair } from '../src/debug/debug-transport.js';
import { DebugSensorCollector } from '../src/debug/debug-sensor-collector.js';
import { DebugVibrationRecorder } from '../src/debug/debug-vibration.js';
import { VibrationCue } from '../src/core/vibration.js';

async function sharedJson(relativePath) {
  const url = new URL(`../../shared-contracts/${relativePath}`, import.meta.url);
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
    set(next) {
      value = next;
      return value;
    },
  };
}

function uuidSequence(start = 1) {
  let value = start - 1;
  return () => {
    value += 1;
    return `90000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
  };
}

function activeSnapshot(snapshot) {
  const next = clone(snapshot);
  next.workoutSession.activeSetId = null;
  return next;
}

async function createHarness({
  backend = createVolatileStorageBackend(),
  clock,
  sendSnapshot = true,
  sensorCollectors,
  sensorSampleLimit,
  setIdGenerator = () => 'watch_set_stage4',
  snapshot,
  vibrationAdapter,
}) {
  const transports = createDebugTransportPair();
  const receivedMessages = [];
  const receivedFiles = [];
  transports.phone.setMessageHandler(async (serialized) => receivedMessages.push(serialized));
  transports.phone.setFileHandler(async (serialized) => receivedFiles.push(serialized));
  await transports.phone.connect();

  const repository = new WatchStateRepository(backend);
  const watch = new WatchCompanion({
    clock: clock.now,
    deviceId: 'watch-stage4-test',
    eventIdGenerator: uuidSequence(),
    idGenerator: (() => {
      let value = 0;
      return () => `stage4-control-${++value}`;
    })(),
    repository,
    sensorCollectors,
    sensorSampleLimit,
    setIdGenerator,
    transport: transports.watch,
    vibrationAdapter,
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

  return {
    backend,
    receivedFiles,
    receivedMessages,
    repository,
    transports,
    watch,
  };
}

function outboundWorkoutEvents(repository) {
  return repository.pending().filter((envelope) =>
    Object.prototype.hasOwnProperty.call(envelope, 'eventId'),
  );
}

function heartRateSample({
  context,
  sampleId,
  timestamp,
  valid = true,
  value,
  quality = valid ? 'VALID' : 'OFF_WRIST',
}) {
  return createSensorSample({
    context,
    quality,
    reading: { valid, value },
    sampleId,
    sensorType: SensorType.HEART_RATE,
    timestamp,
    unit: 'BPM',
  });
}

test('SensorCollector exposes the exact contract and production adapters stay unavailable', async () => {
  assert.deepEqual(
    Object.getOwnPropertyNames(SensorCollector.prototype)
      .filter((name) => name !== 'constructor')
      .sort(),
    ['flushSamples', 'getCurrentValue', 'isSupported', 'requestPermission', 'start', 'stop'],
  );

  const collectors = createUnavailableProductionCollectors();
  assert.equal(collectors.length, Object.keys(SensorType).length);
  for (const collector of collectors) {
    assert.equal(collector.isSupported(), false);
    assert.equal(await collector.requestPermission(), false);
    assert.equal(collector.getCurrentValue(), null);
    assert.deepEqual(collector.flushSamples(), []);
    await assert.rejects(() => collector.start({ phase: SensorPhase.WORKOUT }));
    await collector.stop();
  }
});

test('heart-rate normalization preserves valid values and nulls invalid or off-wrist readings', () => {
  const context = {
    sessionId: 'session-stage4',
    exerciseSessionId: 'exercise-session-stage4',
    setId: 'set-stage4',
    phase: SensorPhase.SET,
  };
  const valid = heartRateSample({
    context,
    sampleId: '91000000-0000-4000-8000-000000000001',
    timestamp: 1_000,
    value: 145,
  });
  const offWrist = heartRateSample({
    context,
    sampleId: '91000000-0000-4000-8000-000000000002',
    timestamp: 2_000,
    valid: false,
    value: 0,
  });

  assert.equal(valid.value, 145);
  assert.equal(valid.valid, true);
  assert.equal(offWrist.value, null);
  assert.equal(offWrist.valid, false);
  assert.equal(offWrist.quality, 'OFF_WRIST');
});

test('sensor samples retain all six normative workout phases', () => {
  const nextUuid = uuidSequence(100);
  for (const phase of Object.values(SensorPhase)) {
    const sample = heartRateSample({
      context: {
        sessionId: 'session-stage4',
        exerciseSessionId: 'exercise-session-stage4',
        setId: phase === SensorPhase.SET || phase === SensorPhase.REST ? 'set-stage4' : null,
        phase,
      },
      sampleId: nextUuid(),
      timestamp: 1_000,
      value: 120,
    });
    assert.equal(sample.phase, phase);
  }
});

test('sensor buffers are bounded and batches split below the file transport limit', () => {
  const context = {
    sessionId: 'session-stage4',
    exerciseSessionId: 'exercise-session-stage4',
    setId: 'set-stage4',
    phase: SensorPhase.SET,
  };
  const first = heartRateSample({
    context,
    sampleId: '92000000-0000-4000-8000-000000000001',
    timestamp: 1_000,
    value: 120,
  });
  const buffer = new SensorSampleBuffer(1);
  buffer.add(first);
  assert.throws(() => buffer.add(first), /buffer is full/);
  assert.equal(buffer.flushSamples().length, 1);
  assert.equal(buffer.size(), 0);

  const nextUuid = uuidSequence(200);
  const samples = Array.from({ length: 24 }, (_, index) =>
    heartRateSample({
      context,
      sampleId: nextUuid(),
      timestamp: 2_000 + index,
      value: 120 + (index % 5),
      quality: 'Q'.repeat(160),
    }),
  );
  const batches = buildSensorBatches({
    batchId: '92000000-0000-4000-8000-000000000099',
    createdAt: 3_000,
    deviceId: 'watch-stage4-test',
    samples,
    sessionId: context.sessionId,
    targetBytes: 1_024,
  });

  assert.equal(batches.length > 1, true);
  assert.equal(batches.flatMap((batch) => batch.samples).length, samples.length);
  for (const [index, batch] of batches.entries()) {
    assert.equal(batch.sequence, index + 1);
    assert.equal(batch.totalSequences, batches.length);
    const encoded = encodeSensorBatchForTransport(batch);
    assert.equal(encoded.mode, 'FILE');
    assert.equal(encoded.bytes < MAX_FILE_BYTES, true);
  }

  const oversized = clone(batches[0]);
  oversized.sequence = 1;
  oversized.totalSequences = 1;
  oversized.samples = [
    {
      ...oversized.samples[0],
      quality: 'x'.repeat(MAX_FILE_BYTES),
    },
  ];
  oversized.sampleCount = 1;
  assert.throws(
    () => encodeSensorBatchForTransport(oversized),
    (error) => error instanceof DataEnvelopeTooLargeError,
  );
});

test('heart-rate summaries exclude invalid samples and use the earlier sample on equal distance', () => {
  const context = {
    sessionId: 'session-stage4',
    exerciseSessionId: 'exercise-session-stage4',
    setId: 'set-stage4',
    phase: SensorPhase.SET,
  };
  const setSamples = [
    heartRateSample({
      context,
      sampleId: '93000000-0000-4000-8000-000000000001',
      timestamp: 1_000,
      value: 100,
    }),
    heartRateSample({
      context,
      sampleId: '93000000-0000-4000-8000-000000000002',
      timestamp: 2_000,
      valid: false,
      value: 0,
    }),
    heartRateSample({
      context,
      sampleId: '93000000-0000-4000-8000-000000000003',
      timestamp: 3_000,
      value: 150,
    }),
  ];
  assert.deepEqual(summarizeHeartRate(setSamples, 1_000, 3_000), {
    start: 100,
    end: 150,
    min: 100,
    max: 150,
    average: 125,
    sampleCount: 2,
    durationMs: 2_000,
  });

  const restContext = { ...context, phase: SensorPhase.REST };
  const restSamples = [
    heartRateSample({
      context: restContext,
      sampleId: '93000000-0000-4000-8000-000000000004',
      timestamp: 0,
      value: 160,
    }),
    heartRateSample({
      context: restContext,
      sampleId: '93000000-0000-4000-8000-000000000005',
      timestamp: 29_000,
      value: 140,
    }),
    heartRateSample({
      context: restContext,
      sampleId: '93000000-0000-4000-8000-000000000006',
      timestamp: 31_000,
      value: 130,
    }),
    heartRateSample({
      context: restContext,
      sampleId: '93000000-0000-4000-8000-000000000007',
      timestamp: 59_000,
      value: 120,
    }),
    heartRateSample({
      context: restContext,
      sampleId: '93000000-0000-4000-8000-000000000008',
      timestamp: 61_000,
      value: 110,
    }),
  ];
  const rest = summarizeRestHeartRate(restSamples, 0, 61_000);
  assert.equal(rest.at30Seconds, 140);
  assert.equal(rest.at60Seconds, 120);
  assert.equal(rest.drop30Seconds, 20);
  assert.equal(rest.drop60Seconds, 40);
});

test('set elapsed time subtracts completed pause intervals', async () => {
  const source = await sharedJson('examples/sync-snapshot.json');
  const snapshot = activeSnapshot(source);
  const clock = mutableClock(snapshot.timestamp + 10_000);
  const harness = await createHarness({ clock, snapshot });

  await harness.watch.startSet();
  clock.advance(3_000);
  await harness.watch.togglePause();
  clock.advance(5_000);
  await harness.watch.togglePause();
  clock.advance(2_000);

  const active = harness.watch.getState().activeWorkout;
  assert.equal(active.pendingSet.accumulatedPauseMs, 5_000);
  assert.equal(setElapsedMs(active, clock.now()), 5_000);
});

test('set completion flushes buffered heart rate and starts rest with exact payloads', async () => {
  const source = await sharedJson('examples/sync-snapshot.json');
  const snapshot = activeSnapshot(source);
  const clock = mutableClock(snapshot.timestamp + 10_000);
  const collector = new DebugSensorCollector({
    clock: clock.now,
    sampleIdGenerator: uuidSequence(300),
    sensorType: SensorType.HEART_RATE,
    unit: 'BPM',
  });
  const harness = await createHarness({
    clock,
    sensorCollectors: [collector],
    snapshot,
  });

  const started = await harness.watch.startSet();
  clock.advance(1_000);
  collector.record({ valid: true, value: 121 });
  clock.advance(4_000);
  collector.record({ valid: true, value: 151 });
  const completed = await harness.watch.completeSet({ weight: 105, reps: 8, rir: 2 });
  const events = outboundWorkoutEvents(harness.repository);
  const restStarted = events.find((event) => event.type === WatchEventType.REST_STARTED);

  assert.deepEqual(completed.payload.heartRateSummary, {
    min: 121,
    max: 151,
    average: 136,
    start: 121,
    end: 151,
    sampleCount: 2,
  });
  assert.deepEqual(restStarted.payload, {
    setId: started.payload.setId,
    startedAt: clock.now(),
    restEndsAt: clock.now() + 120_000,
  });

  const add15 = await harness.watch.adjustRest(15);
  const add30 = await harness.watch.adjustRest(30);
  assert.deepEqual(add15.payload, {
    restEndsAt: restStarted.payload.restEndsAt + 15_000,
    reason: 'ADD_15_SECONDS',
  });
  assert.deepEqual(add30.payload, {
    restEndsAt: restStarted.payload.restEndsAt + 45_000,
    reason: 'ADD_30_SECONDS',
  });
});

test('rest supports pause, resume, skip, and starting the next set', async () => {
  const source = await sharedJson('examples/sync-snapshot.json');
  const snapshot = activeSnapshot(source);
  const clock = mutableClock(snapshot.timestamp + 10_000);
  const harness = await createHarness({ clock, snapshot });

  await harness.watch.startSet();
  clock.advance(5_000);
  await harness.watch.completeSet({ weight: 100, reps: 8, rir: 2 });
  clock.advance(10_000);
  const paused = await harness.watch.togglePause();
  clock.advance(5_000);
  const nextSet = await harness.watch.startNextSetFromRest();
  const events = outboundWorkoutEvents(harness.repository);
  const resumed = events.find((event) => event.type === WatchEventType.WORKOUT_RESUMED);
  const skipped = events.find((event) => event.type === WatchEventType.REST_SKIPPED);

  assert.deepEqual(paused.payload, { pausedAt: clock.now() - 5_000 });
  assert.deepEqual(resumed.payload, { resumedAt: clock.now() });
  assert.deepEqual(skipped.payload, { skippedAt: clock.now() });
  assert.equal(nextSet.type, WatchEventType.SET_STARTED);
  assert.equal(harness.watch.getState().activeWorkout.session.status, 'ACTIVE');
  assert.equal(harness.watch.getState().activeWorkout.rest, null);
  assert.equal(harness.watch.getState().activeWorkout.activeSetId, nextSet.payload.setId);
});

test('absolute rest timer survives sleep, application restart, and transport disconnect', async () => {
  const source = await sharedJson('examples/sync-snapshot.json');
  const snapshot = activeSnapshot(source);
  const backend = createVolatileStorageBackend();
  const clock = mutableClock(snapshot.timestamp + 10_000);
  const first = await createHarness({ backend, clock, snapshot });

  await first.watch.startSet();
  await first.watch.completeSet({ weight: 100, reps: 8, rir: 2 });
  clock.advance(30_000);
  await first.watch.lifecycleCheckpoint(clock.now());
  assert.equal(first.watch.timerState(clock.now()).rest.remainingMs, 90_000);
  await first.transports.watch.disconnect();
  clock.advance(10_000);
  assert.equal(first.watch.getState().connection, 'disconnected');
  assert.equal(first.watch.timerState(clock.now()).rest.remainingMs, 80_000);
  await first.watch.stop();

  const second = await createHarness({
    backend,
    clock,
    sendSnapshot: false,
    snapshot,
  });
  assert.equal(second.watch.timerState(clock.now()).rest.remainingMs, 80_000);
  clock.advance(20_000);
  assert.equal(second.watch.timerState(clock.now()).rest.remainingMs, 60_000);
});

test('rest warning and completion vibration cues fire only once', async () => {
  const source = await sharedJson('examples/sync-snapshot.json');
  const snapshot = activeSnapshot(source);
  const clock = mutableClock(snapshot.timestamp + 10_000);
  const vibration = new DebugVibrationRecorder();
  const harness = await createHarness({
    clock,
    snapshot,
    vibrationAdapter: vibration,
  });

  await harness.watch.startSet();
  await harness.watch.completeSet({ weight: 100, reps: 8, rir: 2 });
  const restEndsAt = harness.watch.getState().activeWorkout.rest.restEndsAt;
  clock.set(restEndsAt - 9_000);
  await harness.watch.checkRestTimer(clock.now());
  await harness.watch.checkRestTimer(clock.now());
  clock.set(restEndsAt);
  await harness.watch.checkRestTimer(clock.now());
  await harness.watch.checkRestTimer(clock.now());

  assert.deepEqual(vibration.cues, [
    VibrationCue.REST_WARNING,
    VibrationCue.REST_FINISHED,
  ]);
});

test('REST_FINISHED matches the shared fixture and excludes no invalid values as real pulse', async () => {
  const source = await sharedJson('examples/sync-snapshot.json');
  const payloads = await sharedJson('fixtures/stage4-rest-payloads.json');
  const snapshot = activeSnapshot(source);
  snapshot.setRecords = [];
  const clock = mutableClock(payloads.restStarted.startedAt - 10_000);
  const harness = await createHarness({
    clock,
    setIdGenerator: () => payloads.restStarted.setId,
    snapshot,
  });

  await harness.watch.startSet();
  clock.set(payloads.restStarted.startedAt);
  await harness.watch.completeSet({ weight: 100, reps: 8, rir: 2 });
  const active = harness.watch.getState().activeWorkout;
  const context = {
    sessionId: active.session.sessionId,
    exerciseSessionId: active.exercises[0].exerciseSessionId,
    setId: payloads.restStarted.setId,
    phase: SensorPhase.REST,
  };
  const samples = [
    [0, 154],
    [30_000, 140],
    [60_000, 126],
    [90_000, 118],
    ...Array.from({ length: 16 }, (_, index) => [1_000 + index * 7_000, 132]),
  ];
  const nextUuid = uuidSequence(400);
  for (const [offset, value] of samples) {
    await harness.watch.recordSensorSample(
      heartRateSample({
        context,
        sampleId: nextUuid(),
        timestamp: payloads.restStarted.startedAt + offset,
        value,
      }),
    );
  }
  await harness.watch.recordSensorSample(
    heartRateSample({
      context,
      sampleId: nextUuid(),
      timestamp: payloads.restStarted.startedAt + 45_000,
      valid: false,
      value: 0,
    }),
  );

  clock.set(payloads.restFinished.finishedAt);
  await harness.watch.checkRestTimer(clock.now());
  const finished = outboundWorkoutEvents(harness.repository).find(
    (event) => event.type === WatchEventType.REST_FINISHED,
  );
  assert.deepEqual(finished.payload, payloads.restFinished);
});
