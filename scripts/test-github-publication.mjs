import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  buildDraftPrBody,
  originMatchesRepository,
  validatePublicationBranch,
  validatePublicationEvidence,
} from './publish-integration-draft.mjs';

assert.equal(
  validatePublicationBranch('codex/integration-gymcoach-js4', {
    rootTaskId: 'gymcoach-js4',
    closureTaskIds: ['gymcoach-js4'],
  }),
  'codex/integration-gymcoach-js4',
);
assert.equal(
  validatePublicationBranch('chore/gymcoach-js4-integrated-artifact-gate', {
    rootTaskId: 'gymcoach-js4',
    closureTaskIds: ['gymcoach-js4'],
  }),
  'chore/gymcoach-js4-integrated-artifact-gate',
);
assert.equal(
  validatePublicationBranch('feat/gymcoach-bk0.1-native-import', {
    rootTaskId: 'gymcoach-bk0.1',
    closureTaskIds: ['gymcoach-bk0.1'],
  }),
  'feat/gymcoach-bk0.1-native-import',
);
assert.throws(
  () =>
    validatePublicationBranch('codex/integration-gymcoach-other', {
      rootTaskId: 'gymcoach-js4',
      closureTaskIds: ['gymcoach-js4'],
    }),
  /not bound to a guarded Beads task/,
);
assert.throws(
  () =>
    validatePublicationBranch('main', {
      rootTaskId: 'gymcoach-js4',
      closureTaskIds: ['gymcoach-js4'],
    }),
  /must be dedicated/,
);
assert.equal(originMatchesRepository('https://github.com/SHAREN/gymcoach.git'), true);
assert.equal(originMatchesRepository('git@github.com:SHAREN/gymcoach.git'), true);
assert.equal(originMatchesRepository('https://github.com/other/repo.git'), false);
assert.throws(
  () =>
    validatePublicationEvidence({
      closureTaskIds: ['gymcoach-js4'],
      alreadyGuardedTaskIds: [],
    }),
  /requires every guarded task to be closed/,
);
assert.equal(
  validatePublicationEvidence({
    closureTaskIds: ['gymcoach-js4'],
    alreadyGuardedTaskIds: ['gymcoach-js4'],
  }).closureTaskIds[0],
  'gymcoach-js4',
);
const repositoryOverride = spawnSync(
  process.execPath,
  [
    fileURLToPath(new URL('./publish-integration-draft.mjs', import.meta.url)),
    '--repository',
    'other/repository',
    '--manifest',
    'missing.json',
  ],
  { encoding: 'utf8', windowsHide: true },
);
assert.equal(repositoryOverride.status, 1);
assert.match(repositoryOverride.stderr, /unknown argument --repository/);
const baseOverride = spawnSync(
  process.execPath,
  [
    fileURLToPath(new URL('./publish-integration-draft.mjs', import.meta.url)),
    '--base',
    'develop',
    '--manifest',
    'missing.json',
  ],
  { encoding: 'utf8', windowsHide: true },
);
assert.equal(baseOverride.status, 1);
assert.match(baseOverride.stderr, /unknown argument --base/);
assert.match(
  buildDraftPrBody({
    mode: 'integration',
    head: 'a'.repeat(40),
    taskIds: ['gymcoach-js4'],
    closureTaskIds: ['gymcoach-js4'],
    delivery: {
      integrated: { status: 'complete' },
      published: { status: 'not-required' },
      installed: { status: 'not-authorized' },
      deployed: { status: 'not-authorized' },
    },
  }),
  /must not be auto-merged/,
);
assert.match(
  buildDraftPrBody({
    mode: 'no-runtime-artifact',
    head: 'b'.repeat(40),
    taskIds: ['gymcoach-js4'],
    closureTaskIds: ['gymcoach-js4'],
    delivery: {
      integrated: { status: 'not-required' },
      published: { status: 'not-required' },
      installed: { status: 'not-required' },
      deployed: { status: 'not-required' },
    },
  }),
  /Guarded verified harness task/,
);
console.log('GitHub integration publication tests passed.');
