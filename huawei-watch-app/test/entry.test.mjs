import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const entryUrl = new URL('../entry/src/main/js/default/pages/index/index.js', import.meta.url);
const hmlUrl = new URL('../entry/src/main/js/default/pages/index/index.hml', import.meta.url);

test('watch page entry resolves and does not import the debug transport', async () => {
  const source = await readFile(entryUrl, 'utf8');
  assert.equal(source.includes('/debug/'), false);

  const module = await import(entryUrl.href);
  assert.equal(typeof module.default.onInit, 'function');
  assert.equal(typeof module.default.sendPing, 'function');
  assert.equal(typeof module.default.nextExercise, 'function');
  assert.equal(typeof module.default.startSet, 'function');
  assert.equal(typeof module.default.completeSet, 'function');
  assert.equal(typeof module.default.weightUp, 'function');
  assert.equal(typeof module.default.toggleLanguage, 'function');
  assert.equal(typeof module.default.correctLastSet, 'function');
  assert.equal(typeof module.default.deleteLastSet, 'function');
});

test('HML exposes home, workout, and touch-first set entry without a fake pause action', async () => {
  const hml = await readFile(hmlUrl, 'utf8');
  assert.equal(hml.includes('showHome'), true);
  assert.equal(hml.includes('showWorkout'), true);
  assert.equal(hml.includes('showSetEntry'), true);
  assert.equal(hml.includes('onclick="startSet"'), true);
  assert.equal(hml.includes('onclick="completeSet"'), true);
  assert.equal(hml.includes('onclick="weightUp"'), true);
  assert.equal(hml.includes('onclick="correctLastSet"'), true);
  assert.equal(hml.includes('onclick="deleteLastSet"'), true);
  assert.equal(hml.toLowerCase().includes('pause'), false);
});

test('watch labels include both Russian and English workout UI', async () => {
  const { labels } = await import('../src/core/i18n.js');
  assert.equal(labels('en').activeWorkout, 'Active workout');
  assert.equal(labels('ru').activeWorkout, 'Активная тренировка');
  assert.equal(labels('en').completeSet, 'Complete set');
  assert.equal(labels('ru').completeSet, 'Завершить подход');
  assert.equal(labels('en').correctLastSet, 'Correct last set');
  assert.equal(labels('ru').deleteLastSet, 'Удалить подход');
});
