import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyHarnessSnapshot } from './harness-status-core.mjs';

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

const taskSnapshotArrayBinding = run(pwsh, [
  '-NoLogo',
  '-NoProfile',
  '-ExecutionPolicy',
  'Bypass',
  '-File',
  scriptPath,
  '-FixturePath',
  path.join(fixtureRoot, 'complete.json'),
  '-TaskThreadSnapshotPath',
  'scope-one.json',
  'scope-two.json',
]);
assert.equal(
  taskSnapshotArrayBinding.status,
  0,
  taskSnapshotArrayBinding.stderr || taskSnapshotArrayBinding.stdout,
);

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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
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
assert.ok(actionKeys(queued).includes('wait-writer:gymcoach-cf1'));
assert.ok(actionKeys(queued).includes('wait-writer:gymcoach-cf2'));
assert.ok(!actionKeys(queued).includes('start-writer:gymcoach-cf1'));
assert.ok(!actionKeys(queued).includes('start-writer:gymcoach-cf2'));
assert.ok(actionKeys(queued).includes('wait-writer:gymcoach-bf1'));
assert.ok(actionKeys(queued).includes('wait-writer:gymcoach-bf2'));
assert.ok(!actionKeys(queued).includes('start-writer:gymcoach-bf1'));
assert.ok(!actionKeys(queued).includes('start-writer:gymcoach-bf2'));
assert.equal(queued.codexThreads.evidenceAmbiguous, true);
assert.equal(queued.sourceHealth.sources.codexThreads.ok, false);
assert.ok(
  queued.codexThreads.items.some(
    (thread) =>
      thread.clientThreadId === 'client-new-thread:11111111-2222-3333-4444-555555555555' &&
      thread.taskId === 'gymcoach-queued' &&
      thread.role === 'implementation' &&
      thread.state === 'creating' &&
      thread.durableReservation === true,
  ),
);
assert.equal(
  queued.codexThreads.items.filter(
    (thread) => thread.clientThreadId === 'client-new-thread:11111111-2222-3333-4444-555555555555',
  ).length,
  1,
);
for (const taskId of ['gymcoach-cf1', 'gymcoach-cf2']) {
  assert.ok(
    queued.codexThreads.items.some(
      (thread) =>
        thread.clientThreadId === 'client-new-thread:99999999-2222-3333-4444-555555555555' &&
        thread.taskId === taskId &&
        thread.role === 'implementation' &&
        thread.state === 'reservation-conflict' &&
        thread.durableReservation === true &&
        thread.reservationConflict === true,
    ),
  );
}
for (const taskId of ['gymcoach-bf1', 'gymcoach-bf2']) {
  assert.ok(
    queued.codexThreads.items.some(
      (thread) =>
        thread.threadId === 'thread-binding-conflict' &&
        thread.hostId === 'local' &&
        thread.taskId === taskId &&
        thread.role === 'implementation' &&
        thread.state === 'binding-conflict' &&
        thread.durableBinding === true &&
        thread.bindingConflict === true,
    ),
  );
}
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

const overLimitScoped = runFixture('over-limit-scoped.json');
assert.equal(overLimitScoped.codexThreads.complete, false);
assert.equal(overLimitScoped.codexThreads.taskScopedReconciliationAvailable, true);
assert.ok(overLimitScoped.codexThreads.reconciledTaskIds.includes('gymcoach-scr'));
assert.ok(overLimitScoped.codexThreads.reconciledTaskIds.includes('gymcoach-srv'));
assert.ok(actionKeys(overLimitScoped).includes('inspect-thread-source'));
assert.ok(actionKeys(overLimitScoped).includes('start-writer:gymcoach-scr'));
assert.ok(actionKeys(overLimitScoped).includes('start-verifier:gymcoach-srv'));
assert.ok(actionKeys(overLimitScoped).includes('start-writer:gymcoach-ina'));
assert.ok(actionKeys(overLimitScoped).includes('wait-writer:gymcoach-bsa'));
assert.ok(actionKeys(overLimitScoped).includes('wait-writer:gymcoach-sca'));
assert.ok(actionKeys(overLimitScoped).includes('wait-verifier:gymcoach-sva'));
assert.ok(actionKeys(overLimitScoped).includes('wait-writer:gymcoach-dur'));
assert.ok(actionKeys(overLimitScoped).includes('wait-writer:gymcoach-qrd'));
assert.ok(actionKeys(overLimitScoped).includes('wait-verifier:gymcoach-orv'));
assert.ok(actionKeys(overLimitScoped).includes('wait-writer:gymcoach-cf1'));
assert.ok(actionKeys(overLimitScoped).includes('wait-writer:gymcoach-cf2'));
assert.ok(!actionKeys(overLimitScoped).includes('start-writer:gymcoach-cf1'));
assert.ok(!actionKeys(overLimitScoped).includes('start-writer:gymcoach-cf2'));
assert.ok(actionKeys(overLimitScoped).includes('wait-writer:gymcoach-bf1'));
assert.ok(actionKeys(overLimitScoped).includes('wait-writer:gymcoach-bf2'));
assert.ok(!actionKeys(overLimitScoped).includes('start-writer:gymcoach-bf1'));
assert.ok(!actionKeys(overLimitScoped).includes('start-writer:gymcoach-bf2'));
assert.ok(!actionKeys(overLimitScoped).includes('start-writer:gymcoach-msg'));
assert.ok(
  overLimitScoped.codexThreads.items.some(
    (thread) =>
      thread.clientThreadId === 'client-new-thread:11111111-2222-3333-4444-555555555555' &&
      thread.taskId === 'gymcoach-qrd' &&
      thread.role === 'implementation' &&
      thread.state === 'setting-up' &&
      thread.durableReservation === true,
  ),
);
assert.equal(overLimitScoped.sourceHealth.creationRecommendationsSuppressed, false);
assert.deepEqual(overLimitScoped.sourceHealth.suppressedCreationTaskIds, ['gymcoach-msg']);

const overLimitFixture = JSON.parse(
  await readFile(path.join(fixtureRoot, 'over-limit-scoped.json'), 'utf8'),
);

const underLimit = clone(overLimitFixture);
underLimit.threads.snapshot.response.threads.pop();
underLimit.threads.taskSnapshots = [];
const underLimitStatus = classifyHarnessSnapshot(underLimit);
assert.equal(underLimitStatus.codexThreads.complete, true);
assert.ok(actionKeys(underLimitStatus).includes('start-writer:gymcoach-msg'));

const cappedWithoutScopes = clone(overLimitFixture);
cappedWithoutScopes.threads.taskSnapshots = [];
const cappedWithoutScopesStatus = classifyHarnessSnapshot(cappedWithoutScopes);
assert.equal(cappedWithoutScopesStatus.codexThreads.complete, false);
assert.ok(!actionKeys(cappedWithoutScopesStatus).includes('start-writer:gymcoach-scr'));
assert.ok(!actionKeys(cappedWithoutScopesStatus).includes('start-verifier:gymcoach-srv'));

function scopedVariant(taskId, mutate) {
  const fixture = clone(overLimitFixture);
  const snapshot = fixture.threads.taskSnapshots.find(
    (candidate) => candidate.request.query === taskId,
  );
  assert.ok(snapshot, `missing task snapshot ${taskId}`);
  mutate(snapshot, fixture);
  return classifyHarnessSnapshot(fixture);
}

const wrongQuery = scopedVariant('gymcoach-scr', (snapshot) => {
  snapshot.request.query = 'gymcoach-wrong-query';
  snapshot.response.query = 'gymcoach-wrong-query';
});
assert.ok(!actionKeys(wrongQuery).includes('start-writer:gymcoach-scr'));

const staleScope = scopedVariant('gymcoach-scr', (snapshot) => {
  snapshot.capturedAt = '2026-07-18T15:40:00.000Z';
});
assert.ok(!actionKeys(staleScope).includes('start-writer:gymcoach-scr'));

const predatingScope = scopedVariant('gymcoach-scr', (snapshot) => {
  snapshot.capturedAt = '2026-07-18T15:59:00.000Z';
});
assert.ok(!actionKeys(predatingScope).includes('start-writer:gymcoach-scr'));

const cappedScope = scopedVariant('gymcoach-scr', (snapshot, fixture) => {
  snapshot.response.threads = clone(fixture.threads.snapshot.response.threads);
});
assert.ok(!actionKeys(cappedScope).includes('start-writer:gymcoach-scr'));

const unavailableScope = scopedVariant('gymcoach-scr', (snapshot) => {
  snapshot.response.unavailableHosts = ['remote'];
});
assert.ok(!actionKeys(unavailableScope).includes('start-writer:gymcoach-scr'));

const malformedScope = scopedVariant('gymcoach-scr', (snapshot) => {
  snapshot.response.threads = [
    {
      hostId: 'local',
      status: 'active',
      cwd: 'D:/GymCoach/Worktrees/gymcoach-scr',
      createdAt: 1,
      updatedAt: 2,
      hasUnreadTurn: false,
    },
  ];
});
assert.ok(!actionKeys(malformedScope).includes('start-writer:gymcoach-scr'));

const duplicateScope = scopedVariant('gymcoach-scr', (snapshot) => {
  const duplicate = {
    id: 'thread-duplicate-scoped',
    hostId: 'local',
    status: 'completed',
    cwd: 'D:/GymCoach/Worktrees/gymcoach-scr',
    gitBranch: 'chore/gymcoach-scr-history',
    agentRole: 'implementation',
    createdAt: 1,
    updatedAt: 2,
    hasUnreadTurn: false,
  };
  snapshot.response.threads = [duplicate, clone(duplicate)];
});
assert.ok(!actionKeys(duplicateScope).includes('start-writer:gymcoach-scr'));

const unknownActiveRole = scopedVariant('gymcoach-scr', (snapshot) => {
  snapshot.response.threads = [
    {
      id: 'thread-unknown-active-role',
      hostId: 'local',
      status: 'active',
      cwd: 'D:/GymCoach/Worktrees/gymcoach-scr',
      gitBranch: 'chore/gymcoach-scr-history',
      createdAt: 1,
      updatedAt: 2,
      hasUnreadTurn: false,
    },
  ];
});
assert.ok(!actionKeys(unknownActiveRole).includes('start-writer:gymcoach-scr'));

const invalidGlobalBaseline = clone(overLimitFixture);
invalidGlobalBaseline.threads.snapshot.response.unavailableHosts = ['remote'];
const invalidGlobalBaselineStatus = classifyHarnessSnapshot(invalidGlobalBaseline);
assert.equal(invalidGlobalBaselineStatus.codexThreads.taskScopedReconciliationAvailable, false);
assert.ok(!actionKeys(invalidGlobalBaselineStatus).includes('start-writer:gymcoach-scr'));

assert.equal(gitStatus(), statusBefore, 'fixture tests must not mutate the repository');
process.stdout.write('Harness status fixture regression tests passed.\n');
