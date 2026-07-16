import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const entryUrl = new URL('../src/lite/watch-page.js', import.meta.url);
const generatedEntryUrl = new URL(
  '../entry/src/main/js/MainAbility/pages/index/index.js',
  import.meta.url,
);
const hmlUrl = new URL('../entry/src/main/js/MainAbility/pages/index/index.hml', import.meta.url);
const cssUrl = new URL('../entry/src/main/js/MainAbility/pages/index/index.css', import.meta.url);
const physicalAppUrl = new URL('../src/lite/physical-install-app.js', import.meta.url);
const physicalPageUrl = new URL('../src/lite/physical-install-page.js', import.meta.url);

test('watch page entry resolves and does not import the debug transport', async () => {
  const source = await readFile(entryUrl, 'utf8');
  const generated = await readFile(generatedEntryUrl, 'utf8');
  assert.equal(source.includes('/debug/'), false);
  assert.equal(generated.includes('/debug/'), false);
  assert.equal(/\brequire\s*\(\s*['"](?:@babel\/runtime|\.\.?\/)/u.test(generated), false);

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
  assert.equal(source.includes('formatElapsed(timer.workoutElapsedMs)'), true);
  assert.equal(source.includes('setElapsed: formatElapsed(timer.setElapsedMs)'), true);
  assert.equal(source.includes("activeWorkout.session.status === 'FINISHED'"), true);
});

test('physical GT4 entry stays compact and renders an honest empty state', async () => {
  const physicalApp = await readFile(physicalAppUrl, 'utf8');
  const physicalPage = await readFile(physicalPageUrl, 'utf8');
  const generated = await readFile(generatedEntryUrl, 'utf8');
  const module = await import(`${physicalPageUrl.href}?physical-entry-test`);

  assert.equal(physicalApp.includes('GymCoach physical watch build started.'), true);
  assert.equal(module.default.data.showHome, true);
  assert.equal(module.default.data.hasWorkout, false);
  assert.equal(module.default.data.noWorkout, true);
  assert.equal(typeof module.default.toggleLanguage, 'function');
  assert.equal(typeof module.default.openDiagnostics, 'function');
  assert.equal(physicalPage.includes('Preview connected'), false);
  assert.equal(physicalPage.includes('Barbell squat'), false);
  assert.equal(Buffer.byteLength(generated, 'utf8') < 8_192, true);
});

test('HML exposes workout, set, and rest controls without unsupported crown APIs', async () => {
  const hml = await readFile(hmlUrl, 'utf8');
  const css = await readFile(cssUrl, 'utf8');
  const source = await readFile(entryUrl, 'utf8');
  assert.equal(hml.includes('showHome'), true);
  assert.equal(hml.includes('showWorkout'), true);
  assert.equal(hml.includes('showSetEntry'), true);
  assert.equal(hml.includes('showRest'), true);
  assert.equal(hml.includes('onclick="startSet"'), true);
  assert.equal(hml.includes('onclick="completeSet"'), true);
  assert.equal(hml.includes('onclick="weightUp"'), true);
  assert.equal(hml.includes('onclick="correctLastSet"'), true);
  assert.equal(hml.includes('onclick="deleteLastSet"'), true);
  assert.equal(hml.includes('onclick="skipRest"'), true);
  assert.equal(hml.includes('onclick="add15Seconds"'), true);
  assert.equal(hml.includes('onclick="add30Seconds"'), true);
  assert.equal(hml.includes('onclick="togglePause"'), true);
  assert.equal(hml.includes('showExerciseNavigation'), true);
  assert.equal(hml.includes('showPauseButton'), true);
  assert.equal(hml.includes('onclick="startNextSet"'), true);
  assert.equal(hml.includes('{{ setElapsed }}'), true);
  assert.equal(hml.includes('<button'), false);
  assert.equal(/class="[^"]*\{\{/.test(hml), false);
  assert.equal(hml.includes('class="home-card-main home-card-small"'), true);
  assert.equal(css.includes('.home-card-main.small'), false);
  assert.equal(css.includes('font-weight:'), false);
  assert.equal(css.includes('min-height:'), false);
  assert.equal(`${hml}\n${source}`.toLowerCase().includes('crown'), false);
  assert.equal(`${hml}\n${source}`.toLowerCase().includes('rotary'), false);
});

test('watch labels include both Russian and English workout UI', async () => {
  const { labels } = await import('../src/core/i18n.js');
  assert.equal(labels('en').activeWorkout, 'Active workout');
  assert.equal(labels('ru').activeWorkout, 'Активная тренировка');
  assert.equal(labels('en').completeSet, 'Complete set');
  assert.equal(labels('ru').completeSet, 'Завершить подход');
  assert.equal(labels('en').correctLastSet, 'Correct last set');
  assert.equal(labels('ru').deleteLastSet, 'Удалить подход');
  assert.equal(labels('en').rest, 'Rest');
  assert.equal(labels('ru').rest, 'Отдых');
  assert.equal(labels('en').add15, '+15 sec');
  assert.equal(labels('ru').add30, '+30 секунд');
});
