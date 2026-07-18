import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = path.join(root, 'scripts/harness-status.ps1');
const fixtureRoot = path.join(root, 'scripts/fixtures/harness-status');

function run(command, args) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
}

function findPowerShell() {
  for (const command of process.platform === 'win32' ? ['pwsh.exe', 'pwsh'] : ['pwsh']) {
    const result = run(command, [
      '-NoLogo',
      '-NoProfile',
      '-Command',
      '$PSVersionTable.PSVersion.Major',
    ]);
    if (result.status === 0 && Number(result.stdout.trim()) >= 7) return command;
  }
  throw new Error('PowerShell 7 is required for harness status tests.');
}

const pwsh = findPowerShell();

function gitStatus() {
  const result = run('git', ['status', '--porcelain=v1', '--untracked-files=all']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

function runFixture(name) {
  const fixture = path.join(fixtureRoot, name);
  const args = [
    '-NoLogo',
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath,
    '-FixturePath',
    fixture,
  ];
  const first = run(pwsh, args);
  assert.equal(first.status, 0, first.stderr || first.stdout);
  const second = run(pwsh, args);
  assert.equal(second.status, 0, second.stderr || second.stdout);
  assert.equal(first.stdout, second.stdout, `${name} output must be byte-stable`);
  return JSON.parse(first.stdout);
}

function ids(items) {
  return items.map((item) => item.id);
}

function actionKeys(status) {
  return status.proposedActions.map((item) => item.key);
}

const statusBefore = gitStatus();
const harnessSource = await readFile(scriptPath, 'utf8');
for (const forbidden of [
  /\bbd\s+(?:create|update|close|claim|comment)\b/i,
  /\bgit\s+worktree\s+(?:add|remove|prune)\b/i,
  /\b(?:Start|Stop|Restart)-Service\b/i,
  /target_thread_id/i,
  /automations?[\\/]automation\.toml/i,
]) {
  assert.doesNotMatch(harnessSource, forbidden);
}

const complete = runFixture('complete.json');
assert.equal(complete.schemaVersion, 2);
for (const section of [
  'activeImplementations',
  'reviewTasks',
  'verifyTasks',
  'awaitingIntegrationTasks',
  'readyTasks',
  'blockedTasks',
  'codexThreads',
  'worktrees',
  'disks',
  'ports',
  'fullGateOwner',
  'sourceHealth',
  'proposedActions',
]) {
  assert.ok(Object.hasOwn(complete, section), `missing top-level section ${section}`);
}
assert.deepEqual(ids(complete.reviewTasks), ['gymcoach-review', 'gymcoach-rva']);
assert.deepEqual(ids(complete.verifyTasks), ['gymcoach-verify']);
assert.deepEqual(ids(complete.awaitingIntegrationTasks), ['gymcoach-await']);
assert.deepEqual(ids(complete.readyTasks), ['gymcoach-rda', 'gymcoach-ready']);
assert.deepEqual(ids(complete.blockedTasks), ['gymcoach-native-blocked', 'gymcoach-ready-blocked']);
assert.ok(ids(complete.activeImplementations).includes('gymcoach-impl'));
assert.ok(ids(complete.activeImplementations).includes('gymcoach-blocker'));
assert.equal(complete.codexThreads.complete, true);
assert.ok(
  complete.codexThreads.items.some(
    (thread) => thread.taskId === 'gymcoach-impl' && thread.role === 'implementation',
  ),
);
assert.ok(
  complete.codexThreads.items.some(
    (thread) => thread.taskId === 'gymcoach-verify' && thread.role === 'verifier',
  ),
);
assert.ok(actionKeys(complete).includes('start-verifier:gymcoach-review'));
assert.ok(actionKeys(complete).includes('start-writer:gymcoach-ready'));
assert.ok(actionKeys(complete).includes('wait-verifier:gymcoach-rva'));
assert.ok(actionKeys(complete).includes('wait-writer:gymcoach-rda'));
assert.ok(!actionKeys(complete).includes('start-verifier:gymcoach-rva'));
assert.ok(!actionKeys(complete).includes('start-writer:gymcoach-rda'));
assert.ok(!actionKeys(complete).includes('start-writer:gymcoach-impl'));
assert.ok(!actionKeys(complete).includes('start-verifier:gymcoach-verify'));
assert.equal(complete.ports.find((port) => port.port === 3030).listening, true);
assert.equal(complete.ports.find((port) => port.port === 3031).listening, false);
assert.equal(complete.fullGateOwner.state, 'none');

const queued = runFixture('queued-writer.json');
assert.ok(actionKeys(queued).includes('wait-writer:gymcoach-queued'));
assert.ok(!actionKeys(queued).includes('start-writer:gymcoach-queued'));
assert.ok(actionKeys(queued).includes('wait-writer:gymcoach-bound'));
assert.ok(!actionKeys(queued).includes('start-writer:gymcoach-bound'));
assert.ok(actionKeys(queued).includes('wait-writer:gymcoach-bound-idle'));
assert.ok(!actionKeys(queued).includes('start-writer:gymcoach-bound-idle'));
assert.ok(actionKeys(queued).includes('wait-verifier:gymcoach-review-idle'));
assert.ok(!actionKeys(queued).includes('start-verifier:gymcoach-review-idle'));
assert.ok(actionKeys(queued).includes('wait-verifier:gymcoach-vbo'));
assert.ok(!actionKeys(queued).includes('start-verifier:gymcoach-vbo'));
assert.ok(
  queued.codexThreads.items.some(
    (thread) =>
      thread.clientThreadId === 'client-new-thread:11111111-2222-3333-4444-555555555555' &&
      thread.state === 'queued-or-orphaned',
  ),
);
assert.ok(
  queued.codexThreads.items.some(
    (thread) =>
      thread.threadId === 'thread-verifier-bound' &&
      thread.state === 'bound-or-orphaned' &&
      thread.durableBinding === true,
  ),
);
assert.ok(
  queued.codexThreads.items.some(
    (thread) =>
      thread.threadId === 'thread-bound-idle' &&
      thread.state === 'idle' &&
      thread.durableBinding === true,
  ),
);
assert.ok(
  queued.codexThreads.items.some(
    (thread) =>
      thread.threadId === 'thread-review-idle' &&
      thread.state === 'idle' &&
      thread.durableBinding === true,
  ),
);
assert.ok(
  queued.codexThreads.items.some(
    (thread) =>
      thread.threadId === 'thread-bound' &&
      thread.state === 'bound-or-orphaned' &&
      thread.durableBinding === true,
  ),
);

const incomplete = runFixture('incomplete-threads.json');
assert.equal(incomplete.codexThreads.complete, false);
assert.equal(incomplete.sourceHealth.ok, false);
assert.equal(incomplete.sourceHealth.creationRecommendationsSuppressed, true);
assert.ok(actionKeys(incomplete).includes('inspect-thread-source'));
assert.ok(!actionKeys(incomplete).some((key) => key.startsWith('start-writer:')));
assert.ok(!actionKeys(incomplete).some((key) => key.startsWith('start-verifier:')));
assert.equal(incomplete.fullGateOwner.state, 'owned');
assert.equal(incomplete.fullGateOwner.taskId, 'gymcoach-gate');
assert.deepEqual(
  incomplete.disks.find((disk) => disk.name === 'D'),
  {
    name: 'D',
    exists: false,
    freeBytes: null,
  },
);
assert.equal(incomplete.ports.find((port) => port.port === 3031).observed, false);
assert.equal(incomplete.ports.find((port) => port.port === 5434).observed, false);

const released = runFixture('full-gate-release.json');
assert.equal(released.fullGateOwner.state, 'none');
assert.ok(!actionKeys(released).some((key) => key.startsWith('wait-full-gate:')));

const invalidThreads = runFixture('invalid-thread-records.json');
assert.equal(invalidThreads.codexThreads.complete, false);
assert.equal(invalidThreads.sourceHealth.creationRecommendationsSuppressed, true);
assert.ok(!actionKeys(invalidThreads).includes('start-writer:gymcoach-invalid-threads'));
assert.match(invalidThreads.codexThreads.problems.join('\n'), /has no id/);
assert.match(invalidThreads.codexThreads.problems.join('\n'), /has no hostId/);
assert.match(invalidThreads.codexThreads.problems.join('\n'), /unknown status mystery/);
assert.match(invalidThreads.codexThreads.problems.join('\n'), /invalid createdAt/);
assert.match(invalidThreads.codexThreads.problems.join('\n'), /invalid updatedAt/);
assert.match(invalidThreads.codexThreads.problems.join('\n'), /invalid hasUnreadTurn/);
assert.match(invalidThreads.codexThreads.problems.join('\n'), /duplicates local\/thread-duplicate/);

assert.equal(gitStatus(), statusBefore, 'fixture tests must not mutate the repository');
process.stdout.write('Harness status fixture regression tests passed.\n');
