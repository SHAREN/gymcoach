import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createVolatileStorageBackend, WatchStateRepository } from '../src/core/storage.js';
import {
  createSummarySelection,
  moveSummaryExercise,
  selectSummaryWorkout,
  selectedSummaryExercise,
} from '../src/core/summary-navigation.js';
import { activeWorkoutFromSnapshot } from '../src/core/workout-state.js';
import { summarizeExercise, summarizeWorkout } from '../src/core/workout-summary.js';

async function sharedSnapshot() {
  const url = new URL('../../shared-contracts/examples/sync-snapshot.json', import.meta.url);
  return JSON.parse(await readFile(url, 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('exercise and workout summaries derive volume, RIR, and weighted heart rate', async () => {
  const snapshot = await sharedSnapshot();
  const workout = activeWorkoutFromSnapshot(snapshot);
  const secondSet = clone(workout.completedSets[0]);
  secondSet.setId = 'mob_set_second_stage6';
  secondSet.exerciseSessionId = workout.exercises[1].exerciseSessionId;
  secondSet.setNumber = 1;
  secondSet.weight = 12.5;
  secondSet.reps = 5;
  secondSet.rir = 0;
  secondSet.completedAt += 60_000;
  secondSet.heartRateSummary = {
    min: 100,
    max: 150,
    average: 120,
    start: 105,
    end: 145,
    sampleCount: 5,
  };
  workout.completedSets.push(secondSet);
  workout.session.finishedAt = workout.startedAt + 600_000;
  workout.timing.accumulatedPauseMs = 120_000;
  workout.timing.pauseStartedAt = workout.session.finishedAt - 30_000;
  workout.restSummaries = [
    {
      setId: workout.completedSets[0].setId,
      startedAt: workout.startedAt + 60_000,
      finishedAt: workout.startedAt + 120_000,
      start: 150,
      min: 120,
      average: 130,
      at30Seconds: 138,
      at60Seconds: 130,
      drop30Seconds: 12,
      drop60Seconds: 20,
      sampleCount: 10,
    },
    {
      setId: secondSet.setId,
      startedAt: workout.startedAt + 180_000,
      finishedAt: workout.startedAt + 240_000,
      start: 140,
      min: 115,
      average: 120,
      at30Seconds: 130,
      at60Seconds: 120,
      drop30Seconds: 10,
      drop60Seconds: 20,
      sampleCount: 5,
    },
  ];

  const exercise = summarizeExercise(workout, workout.exercises[0].exerciseSessionId);
  assert.equal(exercise.setCount, 1);
  assert.equal(exercise.totalVolume, 800);
  assert.equal(exercise.averageRir, 2);
  assert.equal(exercise.maximumHeartRate, 158);
  assert.equal(exercise.averageSetHeartRate, 141.4);
  assert.equal(exercise.averageRestHeartRate, 130);
  assert.equal(exercise.averageRecovery60, 20);

  const summary = summarizeWorkout(workout, workout.startedAt + 999_999);
  assert.equal(summary.durationMs, 450_000);
  assert.equal(summary.exerciseCount, 2);
  assert.equal(summary.setCount, 2);
  assert.equal(summary.totalVolume, 862.5);
  assert.equal(summary.averageRir, 1);
  assert.equal(summary.maximumHeartRate, 158);
  assert.equal(summary.heartRateSampleCount, 30);
  assert.equal(summary.averageSetHeartRate, (141.4 * 25 + 120 * 5) / 30);
  assert.equal(summary.averageRestHeartRate, (130 * 10 + 120 * 5) / 15);
  assert.equal(summary.averageRecovery60, 20);
});

test('finished workout survives a new active session and repository restart', async () => {
  const backend = createVolatileStorageBackend();
  const repository = new WatchStateRepository(backend);
  await repository.load();
  const workout = activeWorkoutFromSnapshot(await sharedSnapshot());
  workout.session.status = 'FINISHED';
  workout.session.finishedAt = workout.startedAt + 600_000;
  await repository.enqueue({ messageId: 'offline-stage6-message' });
  await repository.saveActiveWorkout(workout);

  const nextWorkout = clone(workout);
  nextWorkout.session.sessionId = 'next_session_stage6';
  nextWorkout.session.status = 'ACTIVE';
  nextWorkout.session.finishedAt = null;
  nextWorkout.startedAt += 1_000_000;
  await repository.saveActiveWorkout(nextWorkout);

  const restarted = new WatchStateRepository(backend);
  const document = await restarted.load();
  assert.equal(document.version, 6);
  assert.equal(document.activeWorkout.session.sessionId, 'next_session_stage6');
  assert.equal(document.lastWorkout.session.sessionId, workout.session.sessionId);
  assert.equal(document.lastWorkout.session.status, 'FINISHED');
  assert.equal(document.outbox[0].messageId, 'offline-stage6-message');
});

test('summary navigation keeps the selected exercise between result screens', async () => {
  const workout = activeWorkoutFromSnapshot(await sharedSnapshot());
  let selection = selectSummaryWorkout(createSummarySelection(), workout);
  selection = moveSummaryExercise(selection, workout, 1);
  const selectedId = workout.exercises[1].exerciseSessionId;
  assert.equal(selection.exerciseSessionId, selectedId);

  selection = selectSummaryWorkout(selection, workout, { resetExercise: false });
  assert.equal(selection.exerciseSessionId, selectedId);
  assert.equal(selectedSummaryExercise(workout, selection).exerciseSessionId, selectedId);

  const nextWorkout = clone(workout);
  nextWorkout.session.sessionId = 'next_summary_session';
  selection = selectSummaryWorkout(selection, nextWorkout, { resetExercise: false });
  assert.equal(
    selection.exerciseSessionId,
    nextWorkout.exercises[0].exerciseSessionId,
  );
});

test('watch entry exposes last workout, summaries, and compact diagnostics', async () => {
  const entryUrl = new URL('../src/lite/watch-page.js', import.meta.url);
  const hmlUrl = new URL('../entry/src/main/js/MainAbility/pages/index/index.hml', import.meta.url);
  const source = await readFile(entryUrl, 'utf8');
  const hml = await readFile(hmlUrl, 'utf8');
  const module = await import(entryUrl.href);

  assert.equal(typeof module.default.openLastWorkout, 'function');
  assert.equal(typeof module.default.openExerciseSummary, 'function');
  assert.equal(typeof module.default.openWorkoutSummary, 'function');
  assert.equal(typeof module.default.openDiagnostics, 'function');
  assert.equal(hml.includes('showExerciseSummary'), true);
  assert.equal(hml.includes('showWorkoutSummary'), true);
  assert.equal(hml.includes('showDiagnostics'), true);
  assert.equal(hml.includes('lastWorkoutSets'), true);
  assert.equal(hml.includes('diagnosticLastError'), true);
  assert.equal(hml.includes('workoutAverageRestHeartRate'), true);
  assert.equal(hml.includes('workoutRecovery60'), true);
  assert.equal(source.includes('return `${formatWeight(value)} kg`;'), true);
  assert.equal(`${source}\n${hml}`.toLowerCase().includes('crown'), false);
  assert.equal(`${source}\n${hml}`.toLowerCase().includes('rotary'), false);
});

test('summary and diagnostics labels are available in Russian and English', async () => {
  const { labels } = await import('../src/core/i18n.js');
  assert.equal(labels('en').lastWorkout, 'Last workout');
  assert.equal(labels('ru').lastWorkout, 'Последняя тренировка');
  assert.equal(labels('en').exerciseSummary, 'Exercise summary');
  assert.equal(labels('ru').exerciseSummary, 'Итог упражнения');
  assert.equal(labels('en').diagnostics, 'Diagnostics');
  assert.equal(labels('ru').diagnostics, 'Диагностика');
});
