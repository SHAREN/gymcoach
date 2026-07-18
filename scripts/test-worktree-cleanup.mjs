import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  executeWorktreeCleanup,
  normalizePathForComparison,
  planWorktreeCleanup,
  WorktreeCleanupError,
  worktreePathSha256,
  worktreeRemoveArgs,
} from './cleanup-obsolete-worktree.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = path.join(root, 'scripts/fixtures/worktree-cleanup/registered-worktree.json');
const now = Date.parse('2026-07-18T12:00:00.000Z');
const head = '1'.repeat(40);
const candidatePath = path.join(os.tmpdir(), 'GymCoach Worktrees', 'example');
const currentSourcePath = path.join(os.tmpdir(), 'GymCoach Source');

function git(repo, ...args) {
  const result = spawnSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function storeReceipt(repo, receipt) {
  const contents = `${JSON.stringify(receipt, null, 2)}\n`;
  const receiptId = createHash('sha256').update(contents).digest('hex');
  const receiptRef = `refs/codex/worktree-cleanup-receipts/gymcoach-example/${receiptId}`;
  const blob = spawnSync('git', ['-C', repo, 'hash-object', '-w', '--stdin'], {
    input: contents,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(blob.status, 0, blob.stderr || blob.stdout);
  git(repo, 'update-ref', receiptRef, blob.stdout.trim());
  return receiptRef;
}

function setCandidatePath(cleanupManifest, worktree) {
  cleanupManifest.candidate.path = worktree;
  const owner = cleanupManifest.threadSnapshot.response.threads.find(
    (thread) => thread.id === cleanupManifest.candidate.threadId,
  );
  owner.cwd = worktree;
}

async function exists(value) {
  try {
    await lstat(value);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function worktreeBinding({
  role = 'verifier',
  threadId = 'thread-example',
  hostId = 'local',
  worktreePath = candidatePath,
} = {}) {
  return `Codex worktree binding v1: task=gymcoach-example; role=${role}; thread=${threadId}; host=${hostId}; path-sha256=${worktreePathSha256(worktreePath)}`;
}

function task(status = 'closed', labels = [], bindingOptions = {}) {
  return {
    id: 'gymcoach-example',
    status,
    labels,
    notes: worktreeBinding(bindingOptions),
  };
}

function rawThread({ id, status, cwd, hostId = 'local', createdAt = 1, updatedAt = 2 }) {
  return { id, hostId, status, hasUnreadTurn: false, cwd, createdAt, updatedAt };
}

function threadSnapshot(overrides = {}) {
  return {
    capturedAt: new Date(now).toISOString(),
    tool: 'codex_app.list_threads',
    request: { limit: 50, query: null },
    capturedBy: { threadId: 'thread-dispatcher', hostId: 'local' },
    response: {
      schemaVersion: 2,
      query: null,
      threads: [
        rawThread({ id: 'thread-dispatcher', status: 'active', cwd: currentSourcePath }),
        rawThread({ id: 'thread-example', status: 'idle', cwd: candidatePath }),
      ],
      unavailableHosts: [],
    },
    ...overrides,
  };
}

function snapshotWithThreads(threads, responseOverrides = {}, snapshotOverrides = {}) {
  return threadSnapshot({
    response: {
      schemaVersion: 2,
      query: null,
      threads,
      unavailableHosts: [],
      ...responseOverrides,
    },
    ...snapshotOverrides,
  });
}

function manifest(overrides = {}) {
  return {
    schemaVersion: 2,
    mode: 'registered',
    threadSnapshot: threadSnapshot(),
    allowedWorktreeRoot: path.dirname(candidatePath),
    currentSourceWorktree: currentSourcePath,
    currentIntegrationWorktrees: [],
    ownerPreservedWorktrees: [],
    candidate: {
      path: candidatePath,
      role: 'verifier',
      taskId: 'gymcoach-example',
      threadId: 'thread-example',
      hostId: 'local',
      noLongerNeeded: true,
      expectedHead: head,
      expectedBranch: 'chore/gymcoach-example',
    },
    ...overrides,
  };
}

function gitState(overrides = {}) {
  return {
    allowedRoot: path.dirname(candidatePath),
    candidatePath,
    registered: true,
    registeredEntry: { path: candidatePath },
    absent: false,
    locked: false,
    isMainWorktree: false,
    isSymbolicLink: false,
    currentExecution: false,
    head,
    branch: 'chore/gymcoach-example',
    branchHead: head,
    clean: true,
    durableRefs: ['refs/heads/chore/gymcoach-example'],
    commonDirectory: path.join(os.tmpdir(), 'GymCoach Repository', '.git'),
    ...overrides,
  };
}

function plan(options = {}) {
  return planWorktreeCleanup({
    manifest: options.manifest ?? manifest(),
    task: options.task ?? task(),
    gitState: options.gitState ?? gitState(),
    executorPath: currentSourcePath,
    now,
  });
}

function assertPreserved(result, pattern) {
  assert.equal(result.action, 'preserve');
  assert.match(result.reasons.join('\n'), pattern);
}

assert.equal(
  normalizePathForComparison('\\\\?\\C:\\Users\\RENAT\\Worktrees\\Task One\\'),
  normalizePathForComparison('c:/users/renat/worktrees/task one'),
);
assert.deepEqual(worktreeRemoveArgs('C:\\Worktrees\\Task One'), [
  'worktree',
  'remove',
  '--',
  'C:\\Worktrees\\Task One',
]);
assert.ok(!worktreeRemoveArgs(candidatePath).includes('--force'));

const fixture = await readFile(fixturePath, 'utf8');
assert.doesNotThrow(() =>
  JSON.parse(
    fixture
      .replaceAll('{{OBSERVED_AT}}', new Date(now).toISOString())
      .replaceAll('{{ALLOWED_ROOT}}', path.dirname(candidatePath).replaceAll('\\', '/'))
      .replaceAll('{{CURRENT_SOURCE_PATH}}', currentSourcePath.replaceAll('\\', '/'))
      .replaceAll('{{CANDIDATE_PATH}}', candidatePath.replaceAll('\\', '/'))
      .replaceAll('{{CANDIDATE_HEAD}}', head)
      .replaceAll('{{CANDIDATE_BRANCH}}', 'chore/gymcoach-example'),
  ),
);

assert.equal(plan().action, 'remove-worktree');
assertPreserved(
  plan({ manifest: manifest({ candidate: { ...manifest().candidate, role: 'dispatcher' } }) }),
  /dispatcher Worktree/,
);
assertPreserved(
  plan({
    manifest: manifest({
      threadSnapshot: snapshotWithThreads([
        rawThread({ id: 'thread-dispatcher', status: 'active', cwd: currentSourcePath }),
        rawThread({ id: 'thread-example', status: 'active', cwd: candidatePath }),
      ]),
    }),
  }),
  /is active/,
);
assertPreserved(
  plan({
    manifest: manifest({
      threadSnapshot: snapshotWithThreads([
        rawThread({ id: 'thread-dispatcher', status: 'active', cwd: currentSourcePath }),
        rawThread({ id: 'thread-example', status: 'idle', cwd: candidatePath }),
        rawThread({ id: 'thread-second', status: 'waiting', cwd: candidatePath }),
      ]),
    }),
  }),
  /thread-second is waiting/,
);
assertPreserved(plan({ gitState: gitState({ clean: false }) }), /dirty/);
assertPreserved(plan({ gitState: gitState({ locked: true }) }), /locked/);
assertPreserved(plan({ gitState: gitState({ isMainWorktree: true }) }), /primary Git/);
assertPreserved(plan({ gitState: gitState({ currentExecution: true }) }), /current execution/);
assertPreserved(
  plan({
    manifest: manifest({
      candidate: { ...manifest().candidate, expectedBranch: 'main' },
    }),
    gitState: gitState({ branch: 'main', branchHead: head }),
  }),
  /main branch/,
);
assertPreserved(
  plan({ manifest: manifest({ currentSourceWorktree: candidatePath }) }),
  /current source/,
);
assertPreserved(
  plan({ manifest: manifest({ currentIntegrationWorktrees: [candidatePath] }) }),
  /current integration/,
);
assertPreserved(
  plan({ manifest: manifest({ ownerPreservedWorktrees: [candidatePath] }) }),
  /owner-preserved/,
);
assertPreserved(plan({ task: task('closed', ['worktree:preserve']) }), /worktree:preserve/);
for (const stage of ['stage:review', 'stage:verify']) {
  assertPreserved(plan({ task: task('in_progress', [stage]) }), new RegExp(stage));
}
assertPreserved(
  plan({
    manifest: manifest({
      candidate: { ...manifest().candidate, role: 'implementation' },
    }),
    task: task('in_progress', [], { role: 'implementation' }),
  }),
  /not closed or stage:verified/,
);
assert.equal(
  plan({
    manifest: manifest({
      candidate: { ...manifest().candidate, role: 'implementation' },
    }),
    task: task('in_progress', ['stage:verified'], { role: 'implementation' }),
  }).action,
  'remove-worktree',
);
assert.equal(plan({ task: task('in_progress') }).action, 'remove-worktree');
assert.throws(
  () => plan({ task: task('in_progress', [], { role: 'implementation' }) }),
  /candidate\.role does not match authoritative implementation/,
);
assert.throws(
  () =>
    plan({
      task: {
        ...task('in_progress'),
        notes: `${worktreeBinding()}\n${worktreeBinding()}`,
      },
    }),
  /exactly one matching Worktree role binding/,
);
assert.throws(
  () =>
    plan({
      task: task('in_progress', [], { hostId: 'remote-host' }),
    }),
  /exactly one matching Worktree role binding/,
);
assert.throws(
  () =>
    plan({
      task: task('in_progress', [], { worktreePath: `${candidatePath}-other` }),
    }),
  /exactly one matching Worktree role binding/,
);
assert.equal(
  plan({
    task: {
      ...task('in_progress'),
      notes: `${worktreeBinding({ threadId: 'thread-old', worktreePath: `${candidatePath}-old` })}\n${worktreeBinding()}`,
    },
  }).action,
  'remove-worktree',
);
assertPreserved(
  plan({
    manifest: manifest({ candidate: { ...manifest().candidate, role: 'integration' } }),
    task: task('in_progress', [], { role: 'integration' }),
  }),
  /integration root is not closed/,
);
assert.equal(
  plan({
    manifest: manifest({ candidate: { ...manifest().candidate, role: 'integration' } }),
    task: task('closed', [], { role: 'integration' }),
  }).action,
  'remove-worktree',
);
assertPreserved(
  plan({
    manifest: manifest({
      candidate: { ...manifest().candidate, noLongerNeeded: false },
    }),
  }),
  /still needed/,
);

assert.throws(
  () =>
    plan({
      manifest: manifest({
        threadSnapshot: threadSnapshot({ capturedAt: '2026-07-18T11:00:00.000Z' }),
      }),
    }),
  /list_threads snapshot is stale/,
);
assert.throws(
  () =>
    plan({
      manifest: manifest({
        threadSnapshot: undefined,
        observedAt: new Date(now).toISOString(),
        completeForProject: true,
        threadSource: 'codex_app.list_threads',
        threads: [rawThread({ id: 'thread-example', status: 'idle', cwd: candidatePath })],
      }),
    }),
  /raw codex_app\.list_threads provenance/,
);
assert.throws(
  () =>
    plan({
      manifest: manifest({
        threadSnapshot: threadSnapshot({ tool: 'codex_app.wait_threads' }),
      }),
    }),
  /only raw codex_app\.list_threads/,
);
assert.throws(
  () =>
    plan({
      manifest: manifest({
        threadSnapshot: threadSnapshot({ request: { limit: 50, query: 'gymcoach' } }),
      }),
    }),
  /unfiltered/,
);
assert.throws(
  () =>
    plan({
      manifest: manifest({
        threadSnapshot: threadSnapshot({ request: { limit: 10, query: null } }),
      }),
    }),
  /maximum supported limit/,
);
assert.throws(
  () =>
    plan({
      manifest: manifest({
        threadSnapshot: snapshotWithThreads(
          Array.from({ length: 50 }, (_, index) =>
            rawThread({
              id: index === 0 ? 'thread-dispatcher' : `thread-${index}`,
              status: index === 0 ? 'active' : 'idle',
              cwd: index === 1 ? candidatePath : currentSourcePath,
            }),
          ),
        ),
      }),
    }),
  /may be truncated/,
);
assert.throws(
  () =>
    plan({
      manifest: manifest({
        threadSnapshot: snapshotWithThreads(
          [
            rawThread({ id: 'thread-dispatcher', status: 'active', cwd: currentSourcePath }),
            rawThread({ id: 'thread-example', status: 'idle', cwd: candidatePath }),
          ],
          { unavailableHosts: ['remote-host'] },
        ),
      }),
    }),
  /host was unavailable/,
);
assert.throws(
  () =>
    plan({
      manifest: manifest({
        threadSnapshot: snapshotWithThreads([
          rawThread({ id: 'thread-example', status: 'idle', cwd: candidatePath }),
        ]),
      }),
    }),
  /cleanup executor/,
);
assert.throws(
  () =>
    plan({
      manifest: manifest({
        candidate: { ...manifest().candidate, hostId: 'remote-host' },
      }),
    }),
  /candidate thread\/host is absent/,
);
assert.throws(
  () =>
    plan({
      manifest: manifest({
        threadSnapshot: snapshotWithThreads([
          rawThread({ id: 'thread-dispatcher', status: 'active', cwd: currentSourcePath }),
          rawThread({ id: 'thread-example', status: 'unknown', cwd: candidatePath }),
        ]),
      }),
    }),
  /unknown Codex thread status/,
);
assert.throws(
  () =>
    plan({
      manifest: manifest({
        threadSnapshot: snapshotWithThreads([
          rawThread({ id: 'thread-dispatcher', status: 'active', cwd: currentSourcePath }),
          rawThread({ id: 'thread-other', status: 'idle', cwd: candidatePath }),
        ]),
      }),
    }),
  /candidate thread\/host is absent/,
);
assert.throws(
  () => plan({ gitState: gitState({ head: '2'.repeat(40) }) }),
  /expectedHead does not match/,
);
assert.throws(
  () => plan({ gitState: gitState({ branch: 'chore/other' }) }),
  /expectedBranch does not match/,
);
assert.throws(
  () => plan({ gitState: gitState({ branchHead: '2'.repeat(40) }) }),
  /branch does not point/,
);

const detachedManifest = manifest({
  candidate: { ...manifest().candidate, expectedBranch: null },
});
const detachedPlan = plan({
  manifest: detachedManifest,
  gitState: gitState({ branch: undefined, branchHead: undefined, durableRefs: [] }),
});
assert.equal(detachedPlan.archiveRef, `refs/codex/worktree-archive/gymcoach-example/${head}`);

const invalidResidualManifest = manifest({
  mode: 'residual',
  candidate: {
    path: candidatePath,
    role: 'verifier',
    taskId: 'gymcoach-example',
    threadId: 'thread-example',
    hostId: 'local',
    noLongerNeeded: true,
    expectedHead: head,
    expectedBranch: 'chore/gymcoach-example',
  },
  previousRegisteredCleanup: {
    path: candidatePath,
    taskId: 'gymcoach-example',
    threadId: 'thread-example',
    head,
    clean: true,
    registrationRemoved: true,
  },
});
assert.throws(
  () =>
    planWorktreeCleanup({
      manifest: invalidResidualManifest,
      task: task(),
      gitState: {
        allowedRoot: path.dirname(candidatePath),
        candidatePath,
        registered: false,
        absent: false,
        isMainWorktree: false,
        isSymbolicLink: false,
        currentExecution: false,
        commonDirectory: gitState().commonDirectory,
      },
      executorPath: currentSourcePath,
      now,
    }),
  /Git-stored registered-pass receipt/,
);

async function createRepository() {
  const container = await mkdtemp(path.join(os.tmpdir(), 'gymcoach-worktree-cleanup-'));
  const repo = path.join(container, 'repository');
  const managedRoot = path.join(container, 'managed worktrees');
  await mkdir(repo);
  await mkdir(managedRoot);
  git(repo, 'init', '-b', 'main');
  git(repo, 'config', 'user.name', 'GymCoach Cleanup Test');
  git(repo, 'config', 'user.email', 'cleanup-test@example.invalid');
  await writeFile(path.join(repo, 'README.md'), 'base\n');
  git(repo, 'add', 'README.md');
  git(repo, 'commit', '-m', 'base');
  return { container, repo, managedRoot };
}

function realManifest({ repo, managedRoot, worktree, worktreeHead, branch, mode = 'registered' }) {
  return {
    schemaVersion: 2,
    mode,
    threadSnapshot: {
      capturedAt: new Date().toISOString(),
      tool: 'codex_app.list_threads',
      request: { limit: 50, query: null },
      capturedBy: { threadId: 'thread-dispatcher', hostId: 'local' },
      response: {
        schemaVersion: 2,
        query: null,
        threads: [
          rawThread({ id: 'thread-dispatcher', status: 'active', cwd: repo }),
          rawThread({ id: 'thread-example', status: 'idle', cwd: worktree }),
        ],
        unavailableHosts: [],
      },
    },
    allowedWorktreeRoot: managedRoot,
    currentSourceWorktree: repo,
    currentIntegrationWorktrees: [],
    ownerPreservedWorktrees: [],
    candidate: {
      path: worktree,
      role: 'verifier',
      taskId: 'gymcoach-example',
      threadId: 'thread-example',
      hostId: 'local',
      noLongerNeeded: true,
      expectedHead: worktreeHead,
      expectedBranch: branch ?? null,
    },
  };
}

function realTask(worktree, status = 'closed', role = 'verifier') {
  return task(status, [], { role, worktreePath: worktree });
}

async function produceRegisteredResidual(state, name) {
  const worktree = path.join(state.managedRoot, name);
  const branch = `chore/gymcoach-example-${name.replaceAll(' ', '-')}`;
  git(state.repo, 'worktree', 'add', '-b', branch, worktree, 'HEAD');
  const worktreeHead = git(worktree, 'rev-parse', 'HEAD');
  const registeredManifest = realManifest({ ...state, worktree, worktreeHead, branch });
  const registeredResult = await executeWorktreeCleanup(registeredManifest, {
    repo: state.repo,
    dryRun: false,
    executorPath: state.repo,
    adapters: {
      readBeadsTask: () => realTask(worktree),
      async removeRegisteredWorktree(repo, candidate) {
        git(repo, 'worktree', 'remove', '--', candidate);
        await mkdir(candidate);
        await writeFile(path.join(candidate, 'locked-build-cache.bin'), Buffer.alloc(4096, 7));
      },
    },
  });
  assert.equal(registeredResult.status, 'residual-remains');
  assert.match(
    registeredResult.receiptRef,
    /^refs\/codex\/worktree-cleanup-receipts\/gymcoach-example\/[0-9a-f]{64}$/,
  );
  assert.equal(git(state.repo, 'cat-file', '-t', registeredResult.receiptRef), 'blob');
  const residualManifest = realManifest({
    ...state,
    worktree,
    worktreeHead,
    branch,
    mode: 'residual',
  });
  residualManifest.previousRegisteredCleanupRef = registeredResult.receiptRef;
  return {
    worktree,
    branch,
    worktreeHead,
    receipt: registeredResult.receipt,
    receiptRef: registeredResult.receiptRef,
    residualManifest,
  };
}

async function testRegisteredRemoval() {
  const state = await createRepository();
  try {
    const worktree = path.join(state.managedRoot, 'branch worktree');
    const branch = 'chore/gymcoach-example-cleanup';
    git(state.repo, 'worktree', 'add', '-b', branch, worktree, 'HEAD');
    const worktreeHead = git(worktree, 'rev-parse', 'HEAD');
    const cleanupManifest = realManifest({ ...state, worktree, worktreeHead, branch });

    const untrackedPath = path.join(worktree, 'unique-uncommitted.txt');
    await writeFile(untrackedPath, 'preserve unique uncommitted work\n');
    const dirtyPlan = await executeWorktreeCleanup(cleanupManifest, {
      repo: state.repo,
      dryRun: true,
      executorPath: state.repo,
      adapters: { readBeadsTask: () => realTask(worktree) },
    });
    assertPreserved(dirtyPlan, /dirty/);
    await rm(untrackedPath, { force: false });

    git(state.repo, 'worktree', 'lock', worktree);
    const lockedPlan = await executeWorktreeCleanup(cleanupManifest, {
      repo: state.repo,
      dryRun: true,
      executorPath: state.repo,
      adapters: { readBeadsTask: () => realTask(worktree) },
    });
    assertPreserved(lockedPlan, /locked/);
    git(state.repo, 'worktree', 'unlock', worktree);

    const dryRun = await executeWorktreeCleanup(cleanupManifest, {
      repo: state.repo,
      dryRun: true,
      executorPath: state.repo,
      adapters: { readBeadsTask: () => realTask(worktree) },
    });
    assert.equal(dryRun.action, 'remove-worktree');
    assert.equal(await exists(worktree), true);

    const result = await executeWorktreeCleanup(cleanupManifest, {
      repo: state.repo,
      dryRun: false,
      executorPath: state.repo,
      adapters: { readBeadsTask: () => realTask(worktree) },
    });
    assert.equal(result.status, 'removed');
    assert.equal(result.receipt.reachability.kind, 'durable-ref');
    assert.ok(result.receipt.reachability.refs.includes(`refs/heads/${branch}`));
    assert.ok(BigInt(result.measuredReclaimedBytes) > 0n);
    assert.equal(await exists(worktree), false);
    assert.doesNotMatch(git(state.repo, 'worktree', 'list', '--porcelain'), /branch worktree/);
  } finally {
    await rm(state.container, { recursive: true, force: false, maxRetries: 0 });
  }
}

async function testNonzeroRemovalAfterDeregistrationPersistsReceipt() {
  const state = await createRepository();
  try {
    const worktree = path.join(state.managedRoot, 'nonzero residual worktree');
    const branch = 'chore/gymcoach-example-nonzero-residual';
    git(state.repo, 'worktree', 'add', '-b', branch, worktree, 'HEAD');
    const worktreeHead = git(worktree, 'rev-parse', 'HEAD');
    const cleanupManifest = realManifest({ ...state, worktree, worktreeHead, branch });
    const result = await executeWorktreeCleanup(cleanupManifest, {
      repo: state.repo,
      dryRun: false,
      executorPath: state.repo,
      adapters: {
        readBeadsTask: () => realTask(worktree),
        async removeRegisteredWorktree(repo, candidate) {
          git(repo, 'worktree', 'remove', '--', candidate);
          await mkdir(candidate);
          await writeFile(path.join(candidate, 'locked-build-cache.bin'), Buffer.alloc(2048, 3));
          throw new WorktreeCleanupError('synthetic Windows sharing violation', 'windows-lock');
        },
      },
    });
    assert.equal(result.status, 'residual-remains');
    assert.equal(result.gitRemovalFailed, true);
    assert.match(result.error, /canonical residual receipt was persisted/);
    assert.equal(git(state.repo, 'cat-file', '-t', result.receiptRef), 'blob');
    assert.doesNotMatch(git(state.repo, 'worktree', 'list', '--porcelain'), /nonzero residual/);
    assert.equal(await exists(worktree), true);
  } finally {
    await rm(state.container, { recursive: true, force: false, maxRetries: 0 });
  }
}

async function testUnreachableCommitArchive() {
  const state = await createRepository();
  try {
    const worktree = path.join(state.managedRoot, 'detached worktree');
    git(state.repo, 'worktree', 'add', '--detach', worktree, 'HEAD');
    await writeFile(path.join(worktree, 'detached.txt'), 'unreachable immutable commit\n');
    git(worktree, 'add', 'detached.txt');
    git(worktree, 'commit', '-m', 'detached immutable work');
    const worktreeHead = git(worktree, 'rev-parse', 'HEAD');
    const cleanupManifest = realManifest({
      ...state,
      worktree,
      worktreeHead,
      branch: null,
    });
    const result = await executeWorktreeCleanup(cleanupManifest, {
      repo: state.repo,
      dryRun: false,
      executorPath: state.repo,
      adapters: { readBeadsTask: () => realTask(worktree) },
    });
    const expectedRef = `refs/codex/worktree-archive/gymcoach-example/${worktreeHead}`;
    assert.deepEqual(result.receipt.reachability, { kind: 'archive', ref: expectedRef });
    assert.equal(git(state.repo, 'rev-parse', expectedRef), worktreeHead);
    assert.equal(await exists(worktree), false);
  } finally {
    await rm(state.container, { recursive: true, force: false, maxRetries: 0 });
  }
}

async function testResidualRemovalAndContainment() {
  const state = await createRepository();
  try {
    const residualState = await produceRegisteredResidual(state, 'residual worktree');

    const inlineReceipt = structuredClone(residualState.residualManifest);
    delete inlineReceipt.previousRegisteredCleanupRef;
    inlineReceipt.previousRegisteredCleanup = residualState.receipt;
    await assert.rejects(
      () =>
        executeWorktreeCleanup(inlineReceipt, {
          repo: state.repo,
          executorPath: state.repo,
          adapters: { readBeadsTask: () => realTask(residualState.worktree) },
        }),
      /previousRegisteredCleanupRef/,
    );

    const staleReceipt = structuredClone(residualState.receipt);
    staleReceipt.removedAt = '2026-07-16T00:00:00.000Z';
    const staleManifest = structuredClone(residualState.residualManifest);
    staleManifest.previousRegisteredCleanupRef = storeReceipt(state.repo, staleReceipt);
    await assert.rejects(
      () =>
        executeWorktreeCleanup(staleManifest, {
          repo: state.repo,
          executorPath: state.repo,
          adapters: { readBeadsTask: () => realTask(residualState.worktree) },
        }),
      /receipt is stale/,
    );

    const nonexistentCommitReceipt = structuredClone(residualState.receipt);
    nonexistentCommitReceipt.head = 'f'.repeat(40);
    const nonexistentCommitManifest = structuredClone(residualState.residualManifest);
    nonexistentCommitManifest.candidate.expectedHead = nonexistentCommitReceipt.head;
    nonexistentCommitManifest.previousRegisteredCleanupRef = storeReceipt(
      state.repo,
      nonexistentCommitReceipt,
    );
    await assert.rejects(
      () =>
        executeWorktreeCleanup(nonexistentCommitManifest, {
          repo: state.repo,
          executorPath: state.repo,
          adapters: { readBeadsTask: () => realTask(residualState.worktree) },
        }),
      /head is not a Git commit/,
    );

    const wrongArchiveReceipt = structuredClone(residualState.receipt);
    wrongArchiveReceipt.reachability = {
      kind: 'archive',
      ref: `refs/codex/worktree-archive/gymcoach-example/${residualState.worktreeHead}`,
    };
    const wrongArchiveManifest = structuredClone(residualState.residualManifest);
    wrongArchiveManifest.previousRegisteredCleanupRef = storeReceipt(
      state.repo,
      wrongArchiveReceipt,
    );
    await assert.rejects(
      () =>
        executeWorktreeCleanup(wrongArchiveManifest, {
          repo: state.repo,
          executorPath: state.repo,
          adapters: { readBeadsTask: () => realTask(residualState.worktree) },
        }),
      /not currently reachable from its recorded durable evidence/,
    );

    const wrongBranchReceipt = structuredClone(residualState.receipt);
    wrongBranchReceipt.branch = 'chore/other';
    const wrongBranchManifest = structuredClone(residualState.residualManifest);
    wrongBranchManifest.previousRegisteredCleanupRef = storeReceipt(state.repo, wrongBranchReceipt);
    await assert.rejects(
      () =>
        executeWorktreeCleanup(wrongBranchManifest, {
          repo: state.repo,
          executorPath: state.repo,
          adapters: { readBeadsTask: () => realTask(residualState.worktree) },
        }),
      /branch does not match/,
    );

    const result = await executeWorktreeCleanup(residualState.residualManifest, {
      repo: state.repo,
      dryRun: false,
      executorPath: state.repo,
      adapters: { readBeadsTask: () => realTask(residualState.worktree) },
    });
    assert.equal(result.status, 'removed');
    assert.ok(BigInt(result.measuredReclaimedBytes) >= 4096n);
    assert.equal(result.receiptRef, residualState.receiptRef);
    assert.equal(await exists(residualState.worktree), false);

    const repeated = await executeWorktreeCleanup(residualState.residualManifest, {
      repo: state.repo,
      dryRun: false,
      executorPath: state.repo,
      adapters: { readBeadsTask: () => realTask(residualState.worktree) },
    });
    assert.equal(repeated.action, 'already-removed');

    const nestedState = await produceRegisteredResidual(state, 'nested escape residual');
    const nestedEscapeTarget = path.join(state.container, 'nested escape target');
    const nestedEscapeLink = path.join(nestedState.worktree, 'escape link');
    await mkdir(nestedEscapeTarget);
    try {
      await symlink(
        nestedEscapeTarget,
        nestedEscapeLink,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      await assert.rejects(
        () =>
          executeWorktreeCleanup(nestedState.residualManifest, {
            repo: state.repo,
            dryRun: false,
            executorPath: state.repo,
            adapters: { readBeadsTask: () => realTask(nestedState.worktree) },
          }),
        /symbolic link or junction/,
      );
      assert.equal(await exists(nestedEscapeTarget), true);
      await rm(nestedEscapeLink, { force: false });
      await rm(nestedState.worktree, { recursive: true, force: false, maxRetries: 0 });
    } catch (error) {
      if (!['EACCES', 'EPERM'].includes(error?.code)) throw error;
    }

    const equalRoot = structuredClone(residualState.residualManifest);
    setCandidatePath(equalRoot, state.managedRoot);
    await assert.rejects(
      () =>
        executeWorktreeCleanup(equalRoot, {
          repo: state.repo,
          executorPath: state.repo,
          adapters: { readBeadsTask: () => realTask(state.managedRoot) },
        }),
      /strict descendant/,
    );

    const outside = path.join(state.container, 'outside root');
    await mkdir(outside);
    const outsideManifest = structuredClone(residualState.residualManifest);
    setCandidatePath(outsideManifest, outside);
    await assert.rejects(
      () =>
        executeWorktreeCleanup(outsideManifest, {
          repo: state.repo,
          executorPath: state.repo,
          adapters: { readBeadsTask: () => realTask(outside) },
        }),
      /strict descendant/,
    );

    const escapeTarget = path.join(state.container, 'junction target');
    const escapeLink = path.join(state.managedRoot, 'junction escape');
    await mkdir(escapeTarget);
    try {
      await symlink(escapeTarget, escapeLink, process.platform === 'win32' ? 'junction' : 'dir');
      const escapeManifest = structuredClone(residualState.residualManifest);
      setCandidatePath(escapeManifest, escapeLink);
      await assert.rejects(
        () =>
          executeWorktreeCleanup(escapeManifest, {
            repo: state.repo,
            executorPath: state.repo,
            adapters: { readBeadsTask: () => realTask(escapeLink) },
          }),
        /strict descendant/,
      );
    } catch (error) {
      if (!['EACCES', 'EPERM'].includes(error?.code)) throw error;
    }
  } finally {
    await rm(state.container, { recursive: true, force: false, maxRetries: 0 });
  }
}

async function testFailuresNeverForceDelete() {
  let residualFallbacks = 0;
  await assert.rejects(
    () =>
      executeWorktreeCleanup(manifest(), {
        repo: root,
        dryRun: false,
        executorPath: currentSourcePath,
        now,
        adapters: {
          collectGitState: () => gitState(),
          readBeadsTask: () => task(),
          directoryBytes: () => 100n,
          freeBytesAt: () => 1000n,
          removeRegisteredWorktree: () => {
            throw new WorktreeCleanupError('sharing violation', 'windows-lock');
          },
          removeResidualDirectory: () => {
            residualFallbacks += 1;
          },
        },
      }),
    (error) => error instanceof WorktreeCleanupError && error.code === 'windows-lock',
  );
  assert.equal(residualFallbacks, 0);

  let removalCalls = 0;
  await assert.rejects(
    () =>
      executeWorktreeCleanup(detachedManifest, {
        repo: root,
        dryRun: false,
        executorPath: currentSourcePath,
        now,
        adapters: {
          collectGitState: () =>
            gitState({ branch: undefined, branchHead: undefined, durableRefs: [] }),
          readBeadsTask: () => task(),
          directoryBytes: () => 100n,
          freeBytesAt: () => 1000n,
          archiveCommit: () => {
            throw new WorktreeCleanupError('archive collision');
          },
          removeRegisteredWorktree: () => {
            removalCalls += 1;
          },
        },
      }),
    /archive collision/,
  );
  assert.equal(removalCalls, 0);
}

await testRegisteredRemoval();
await testNonzeroRemovalAfterDeregistrationPersistsReceipt();
await testUnreachableCommitArchive();
await testResidualRemovalAndContainment();
await testFailuresNeverForceDelete();
console.log('Worktree cleanup regression tests passed.');
