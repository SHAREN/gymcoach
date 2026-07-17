import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  executeWorktreeCleanup,
  normalizePathForComparison,
  planWorktreeCleanup,
  WorktreeCleanupError,
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

async function exists(value) {
  try {
    await lstat(value);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function task(status = 'closed', labels = []) {
  return { id: 'gymcoach-example', status, labels };
}

function manifest(overrides = {}) {
  return {
    schemaVersion: 1,
    mode: 'registered',
    observedAt: new Date(now).toISOString(),
    completeForProject: true,
    threadSource: 'codex_app.list_threads',
    allowedWorktreeRoot: path.dirname(candidatePath),
    currentSourceWorktree: currentSourcePath,
    currentIntegrationWorktrees: [],
    ownerPreservedWorktrees: [],
    candidate: {
      path: candidatePath,
      role: 'verifier',
      taskId: 'gymcoach-example',
      threadId: 'thread-example',
      noLongerNeeded: true,
      expectedHead: head,
      expectedBranch: 'chore/gymcoach-example',
    },
    threads: [{ id: 'thread-example', status: 'idle', cwd: candidatePath }],
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
    ...overrides,
  };
}

function plan(options = {}) {
  return planWorktreeCleanup({
    manifest: options.manifest ?? manifest(),
    task: options.task ?? task(),
    gitState: options.gitState ?? gitState(),
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
      threads: [{ id: 'thread-example', status: 'active', cwd: candidatePath }],
    }),
  }),
  /is active/,
);
assertPreserved(
  plan({
    manifest: manifest({
      threads: [
        { id: 'thread-example', status: 'idle', cwd: candidatePath },
        { id: 'thread-second', status: 'waiting', cwd: candidatePath },
      ],
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
    task: task('in_progress'),
  }),
  /not closed or stage:verified/,
);
assert.equal(
  plan({
    manifest: manifest({
      candidate: { ...manifest().candidate, role: 'implementation' },
    }),
    task: task('in_progress', ['stage:verified']),
  }).action,
  'remove-worktree',
);
assert.equal(plan({ task: task('in_progress') }).action, 'remove-worktree');
assertPreserved(
  plan({
    manifest: manifest({ candidate: { ...manifest().candidate, role: 'integration' } }),
    task: task('in_progress'),
  }),
  /integration root is not closed/,
);
assert.equal(
  plan({
    manifest: manifest({ candidate: { ...manifest().candidate, role: 'integration' } }),
    task: task('closed'),
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
  () => plan({ manifest: manifest({ observedAt: '2026-07-18T11:00:00.000Z' }) }),
  /snapshot is stale/,
);
assert.throws(
  () => plan({ manifest: manifest({ completeForProject: false }) }),
  /complete for the project/,
);
assert.throws(
  () => plan({ manifest: manifest({ threads: [] }) }),
  /fresh complete Codex thread snapshot/,
);
assert.throws(
  () =>
    plan({
      manifest: manifest({
        threads: [{ id: 'thread-example', status: 'unknown', cwd: candidatePath }],
      }),
    }),
  /unknown Codex thread status/,
);
assert.throws(
  () =>
    plan({
      manifest: manifest({
        threads: [{ id: 'thread-other', status: 'idle', cwd: candidatePath }],
      }),
    }),
  /candidate.threadId is absent/,
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

const residualReceipt = {
  schemaVersion: 1,
  path: candidatePath,
  taskId: 'gymcoach-example',
  threadId: 'thread-example',
  head,
  branch: null,
  clean: true,
  registrationRemoved: true,
  commitReachable: true,
  archiveRef: null,
  removedAt: new Date(now).toISOString(),
};
const residualManifest = manifest({
  mode: 'residual',
  candidate: {
    path: candidatePath,
    role: 'verifier',
    taskId: 'gymcoach-example',
    threadId: 'thread-example',
    noLongerNeeded: true,
  },
  previousRegisteredCleanup: residualReceipt,
});
const residualState = {
  allowedRoot: path.dirname(candidatePath),
  candidatePath,
  registered: false,
  absent: false,
  isMainWorktree: false,
  isSymbolicLink: false,
  currentExecution: false,
};
assert.equal(
  planWorktreeCleanup({
    manifest: residualManifest,
    task: task(),
    gitState: residualState,
    now,
  }).action,
  'remove-residual',
);
assert.throws(
  () =>
    planWorktreeCleanup({
      manifest: { ...residualManifest, previousRegisteredCleanup: undefined },
      task: task(),
      gitState: residualState,
      now,
    }),
  /previousRegisteredCleanup/,
);
assert.equal(
  planWorktreeCleanup({
    manifest: residualManifest,
    task: task(),
    gitState: { ...residualState, absent: true },
    now,
  }).action,
  'already-removed',
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
    schemaVersion: 1,
    mode,
    observedAt: new Date().toISOString(),
    completeForProject: true,
    threadSource: 'codex_app.list_threads',
    allowedWorktreeRoot: managedRoot,
    currentSourceWorktree: repo,
    currentIntegrationWorktrees: [],
    ownerPreservedWorktrees: [],
    candidate: {
      path: worktree,
      role: 'verifier',
      taskId: 'gymcoach-example',
      threadId: 'thread-example',
      noLongerNeeded: true,
      ...(mode === 'registered'
        ? { expectedHead: worktreeHead, expectedBranch: branch ?? null }
        : {}),
    },
    threads: [{ id: 'thread-example', status: 'idle', cwd: worktree }],
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
      adapters: { readBeadsTask: () => task() },
    });
    assertPreserved(dirtyPlan, /dirty/);
    await rm(untrackedPath, { force: false });

    git(state.repo, 'worktree', 'lock', worktree);
    const lockedPlan = await executeWorktreeCleanup(cleanupManifest, {
      repo: state.repo,
      dryRun: true,
      adapters: { readBeadsTask: () => task() },
    });
    assertPreserved(lockedPlan, /locked/);
    git(state.repo, 'worktree', 'unlock', worktree);

    const dryRun = await executeWorktreeCleanup(cleanupManifest, {
      repo: state.repo,
      dryRun: true,
      adapters: { readBeadsTask: () => task() },
    });
    assert.equal(dryRun.action, 'remove-worktree');
    assert.equal(await exists(worktree), true);

    const result = await executeWorktreeCleanup(cleanupManifest, {
      repo: state.repo,
      dryRun: false,
      adapters: { readBeadsTask: () => task() },
    });
    assert.equal(result.status, 'removed');
    assert.equal(result.receipt.archiveRef, null);
    assert.ok(BigInt(result.measuredReclaimedBytes) > 0n);
    assert.equal(await exists(worktree), false);
    assert.doesNotMatch(git(state.repo, 'worktree', 'list', '--porcelain'), /branch worktree/);
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
      adapters: { readBeadsTask: () => task() },
    });
    const expectedRef = `refs/codex/worktree-archive/gymcoach-example/${worktreeHead}`;
    assert.equal(result.receipt.archiveRef, expectedRef);
    assert.equal(git(state.repo, 'rev-parse', expectedRef), worktreeHead);
    assert.equal(await exists(worktree), false);
  } finally {
    await rm(state.container, { recursive: true, force: false, maxRetries: 0 });
  }
}

async function testResidualRemovalAndContainment() {
  const state = await createRepository();
  try {
    const residual = path.join(state.managedRoot, 'residual worktree');
    await mkdir(residual);
    await writeFile(path.join(residual, 'locked-build-cache.bin'), Buffer.alloc(4096, 7));
    const cleanupManifest = realManifest({
      ...state,
      worktree: residual,
      mode: 'residual',
    });
    cleanupManifest.previousRegisteredCleanup = {
      ...residualReceipt,
      path: residual,
      removedAt: new Date().toISOString(),
    };
    const result = await executeWorktreeCleanup(cleanupManifest, {
      repo: state.repo,
      dryRun: false,
      adapters: { readBeadsTask: () => task() },
    });
    assert.equal(result.status, 'removed');
    assert.ok(BigInt(result.measuredReclaimedBytes) >= 4096n);
    assert.equal(await exists(residual), false);

    const repeated = await executeWorktreeCleanup(cleanupManifest, {
      repo: state.repo,
      dryRun: false,
      adapters: { readBeadsTask: () => task() },
    });
    assert.equal(repeated.action, 'already-removed');

    const nestedEscapeTarget = path.join(state.container, 'nested escape target');
    const nestedResidual = path.join(state.managedRoot, 'nested escape residual');
    const nestedEscapeLink = path.join(nestedResidual, 'escape link');
    await mkdir(nestedEscapeTarget);
    await mkdir(nestedResidual);
    try {
      await symlink(
        nestedEscapeTarget,
        nestedEscapeLink,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      const nestedManifest = structuredClone(cleanupManifest);
      nestedManifest.candidate.path = nestedResidual;
      nestedManifest.threads[0].cwd = nestedResidual;
      nestedManifest.previousRegisteredCleanup.path = nestedResidual;
      await assert.rejects(
        () =>
          executeWorktreeCleanup(nestedManifest, {
            repo: state.repo,
            dryRun: false,
            adapters: { readBeadsTask: () => task() },
          }),
        /symbolic link or junction/,
      );
      assert.equal(await exists(nestedEscapeTarget), true);
      await rm(nestedEscapeLink, { force: false });
      await rm(nestedResidual, { recursive: true, force: false, maxRetries: 0 });
    } catch (error) {
      if (!['EACCES', 'EPERM'].includes(error?.code)) throw error;
    }

    const equalRoot = structuredClone(cleanupManifest);
    equalRoot.candidate.path = state.managedRoot;
    equalRoot.threads[0].cwd = state.managedRoot;
    equalRoot.previousRegisteredCleanup.path = state.managedRoot;
    await assert.rejects(
      () =>
        executeWorktreeCleanup(equalRoot, {
          repo: state.repo,
          adapters: { readBeadsTask: () => task() },
        }),
      /strict descendant/,
    );

    const outside = path.join(state.container, 'outside root');
    await mkdir(outside);
    const outsideManifest = structuredClone(cleanupManifest);
    outsideManifest.candidate.path = outside;
    outsideManifest.threads[0].cwd = outside;
    outsideManifest.previousRegisteredCleanup.path = outside;
    await assert.rejects(
      () =>
        executeWorktreeCleanup(outsideManifest, {
          repo: state.repo,
          adapters: { readBeadsTask: () => task() },
        }),
      /strict descendant/,
    );

    const escapeTarget = path.join(state.container, 'junction target');
    const escapeLink = path.join(state.managedRoot, 'junction escape');
    await mkdir(escapeTarget);
    try {
      await symlink(escapeTarget, escapeLink, process.platform === 'win32' ? 'junction' : 'dir');
      const escapeManifest = structuredClone(cleanupManifest);
      escapeManifest.candidate.path = escapeLink;
      escapeManifest.threads[0].cwd = escapeLink;
      escapeManifest.previousRegisteredCleanup.path = escapeLink;
      await assert.rejects(
        () =>
          executeWorktreeCleanup(escapeManifest, {
            repo: state.repo,
            adapters: { readBeadsTask: () => task() },
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
await testUnreachableCommitArchive();
await testResidualRemovalAndContainment();
await testFailuresNeverForceDelete();
console.log('Worktree cleanup regression tests passed.');
