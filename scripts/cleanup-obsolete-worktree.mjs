import { spawnSync } from 'node:child_process';
import { lstat, opendir, readFile, realpath, rm, statfs } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const INACTIVE_THREAD_STATES = new Set(['archived', 'completed', 'idle', 'notLoaded']);
const KNOWN_THREAD_STATES = new Set([...INACTIVE_THREAD_STATES, 'active', 'running', 'waiting']);
const PROTECTED_STAGES = new Set(['stage:review', 'stage:verify']);
const ROLES = new Set(['dispatcher', 'implementation', 'integration', 'verifier']);
const MAX_THREAD_SNAPSHOT_AGE_MS = 10 * 60 * 1000;
const ZERO_COMMIT = '0'.repeat(40);

export class WorktreeCleanupError extends Error {
  constructor(message, code = 'rejected') {
    super(message);
    this.code = code;
  }
}

function fail(message, code) {
  throw new WorktreeCleanupError(message, code);
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function requireBoolean(value, label) {
  if (typeof value !== 'boolean') {
    fail(`${label} must be boolean`);
  }
  return value;
}

function requireCommit(value, label) {
  const commit = requireString(value, label).toLowerCase();
  if (!COMMIT_PATTERN.test(commit)) {
    fail(`${label} must be a full 40-character Git commit`);
  }
  return commit;
}

function run(command, args, { cwd, allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  });
  if ((result.error || result.status !== 0) && !allowFailure) {
    fail(
      `${command} ${args.join(' ')} failed: ${result.error?.message ?? (result.stderr || result.stdout).trim()}`,
    );
  }
  return result;
}

function runGit(repo, args, options = {}) {
  return run('git', args, { cwd: repo, ...options });
}

function isWindowsStylePath(value) {
  return /^(?:\\\\\?\\|[a-z]:[\\/]|\\\\)/i.test(value);
}

function stripWindowsExtendedPrefix(value) {
  if (/^\\\\\?\\UNC\\/i.test(value)) {
    return `\\\\${value.slice(8)}`;
  }
  if (/^\\\\\?\\/.test(value)) {
    return value.slice(4);
  }
  return value;
}

export function normalizePathForComparison(value) {
  const input = requireString(value, 'path');
  const windowsStyle = isWindowsStylePath(input);
  const pathApi = windowsStyle ? path.win32 : path;
  const resolved = pathApi.resolve(stripWindowsExtendedPrefix(input)).replaceAll('\\', '/');
  const root = pathApi
    .parse(pathApi.resolve(stripWindowsExtendedPrefix(input)))
    .root.replaceAll('\\', '/');
  const withoutTrailing = resolved.length > root.length ? resolved.replace(/\/$/, '') : resolved;
  return windowsStyle || process.platform === 'win32'
    ? withoutTrailing.toLowerCase()
    : withoutTrailing;
}

function pathsEqual(left, right) {
  return normalizePathForComparison(left) === normalizePathForComparison(right);
}

function isStrictDescendant(root, candidate) {
  const rootKey = normalizePathForComparison(root);
  const candidateKey = normalizePathForComparison(candidate);
  const rootPrefix = rootKey.endsWith('/') ? rootKey : `${rootKey}/`;
  return candidateKey.startsWith(rootPrefix);
}

function parseWorktreeList(output) {
  const entries = [];
  let current;
  for (const line of output.split(/\r?\n/)) {
    if (line === '') {
      if (current) {
        entries.push(current);
        current = undefined;
      }
      continue;
    }
    const separator = line.indexOf(' ');
    const key = separator === -1 ? line : line.slice(0, separator);
    const value = separator === -1 ? true : line.slice(separator + 1);
    if (key === 'worktree') {
      if (current) entries.push(current);
      current = { path: value };
    } else if (current) {
      current[key] = value;
    }
  }
  if (current) entries.push(current);
  return entries;
}

function readBeadsTask(taskId, repo) {
  const output = run('bd', ['--readonly', 'show', taskId, '--json'], { cwd: repo }).stdout;
  const tasks = JSON.parse(output);
  const task = Array.isArray(tasks) ? tasks.find((entry) => entry.id === taskId) : undefined;
  if (!task) fail(`Beads task ${taskId} was not found`);
  return task;
}

function listWorktrees(repo) {
  return parseWorktreeList(runGit(repo, ['worktree', 'list', '--porcelain']).stdout);
}

function durableRefsContaining(repo, commit) {
  const output = runGit(repo, [
    'for-each-ref',
    `--contains=${commit}`,
    '--format=%(refname)',
    'refs/heads',
    'refs/remotes',
    'refs/tags',
    'refs/codex/worktree-archive',
  ]).stdout.trim();
  return output === '' ? [] : output.split(/\r?\n/).sort();
}

async function freeBytesAt(directory) {
  const stats = await statfs(directory);
  return BigInt(stats.bavail) * BigInt(stats.bsize);
}

async function pathExists(value) {
  try {
    await lstat(value);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function directoryBytes(directory) {
  const stats = await lstat(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) return BigInt(stats.size);
  let total = BigInt(stats.size);
  const entries = await opendir(directory);
  for await (const entry of entries) {
    total += await directoryBytes(path.join(directory, entry.name));
  }
  return total;
}

async function rejectNestedSymbolicLinks(directory) {
  const stats = await lstat(directory);
  if (stats.isSymbolicLink()) {
    fail('residual directory contains a symbolic link or junction');
  }
  if (!stats.isDirectory()) return;
  const entries = await opendir(directory);
  for await (const entry of entries) {
    await rejectNestedSymbolicLinks(path.join(directory, entry.name));
  }
}

async function resolveGitPath(base, value) {
  const cleanValue = stripWindowsExtendedPrefix(requireString(value, 'Git path'));
  return realpath(path.isAbsolute(cleanValue) ? cleanValue : path.resolve(base, cleanValue));
}

async function resolveCandidate(allowedRoot, rawCandidate, allowMissing) {
  const candidateInput = path.resolve(stripWindowsExtendedPrefix(rawCandidate));
  try {
    const inputStats = await lstat(candidateInput);
    const candidatePath = await realpath(candidateInput);
    if (!isStrictDescendant(allowedRoot, candidatePath)) {
      fail('candidate.path must resolve to a strict descendant of allowedWorktreeRoot');
    }
    return {
      candidatePath,
      absent: false,
      isSymbolicLink: inputStats.isSymbolicLink(),
    };
  } catch (error) {
    if (error?.code !== 'ENOENT' || !allowMissing) throw error;
    const resolvedParent = await realpath(path.dirname(candidateInput));
    const candidatePath = path.join(resolvedParent, path.basename(candidateInput));
    if (!isStrictDescendant(allowedRoot, candidatePath)) {
      fail('candidate.path must resolve to a strict descendant of allowedWorktreeRoot');
    }
    return { candidatePath, absent: true, isSymbolicLink: false };
  }
}

async function collectGitState(repo, manifest) {
  const allowedRoot = await realpath(
    path.resolve(
      stripWindowsExtendedPrefix(
        requireString(manifest.allowedWorktreeRoot, 'allowedWorktreeRoot'),
      ),
    ),
  );
  const mode = manifest.mode ?? 'registered';
  const candidate = await resolveCandidate(
    allowedRoot,
    requireString(manifest.candidate?.path, 'candidate.path'),
    mode === 'residual',
  );
  const worktrees = listWorktrees(repo);
  const registeredEntry = worktrees.find((entry) =>
    pathsEqual(entry.path, candidate.candidatePath),
  );
  if (mode === 'registered' && !registeredEntry) {
    fail('candidate Worktree is not registered with Git');
  }
  if (mode === 'registered' && candidate.absent) {
    fail('registered candidate Worktree path is missing');
  }
  if (mode === 'residual' && registeredEntry) {
    fail('residual cleanup requires Git registration to be absent');
  }
  if (mode === 'residual') {
    return {
      allowedRoot,
      candidatePath: candidate.candidatePath,
      registered: false,
      absent: candidate.absent,
      isMainWorktree: false,
      isSymbolicLink: candidate.isSymbolicLink,
      currentExecution: pathsEqual(candidate.candidatePath, process.cwd()),
    };
  }

  const head = requireCommit(
    runGit(candidate.candidatePath, ['rev-parse', 'HEAD']).stdout.trim(),
    'candidate Git HEAD',
  );
  const branchResult = runGit(
    candidate.candidatePath,
    ['symbolic-ref', '--quiet', '--short', 'HEAD'],
    { allowFailure: true },
  );
  const branch = branchResult.status === 0 ? branchResult.stdout.trim() : undefined;
  const status = runGit(candidate.candidatePath, [
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
  ]).stdout;
  const gitDirectory = await resolveGitPath(
    candidate.candidatePath,
    runGit(candidate.candidatePath, ['rev-parse', '--git-dir']).stdout.trim(),
  );
  const candidateCommonDirectory = await resolveGitPath(
    candidate.candidatePath,
    runGit(candidate.candidatePath, ['rev-parse', '--git-common-dir']).stdout.trim(),
  );
  const repositoryCommonDirectory = await resolveGitPath(
    repo,
    runGit(repo, ['rev-parse', '--git-common-dir']).stdout.trim(),
  );
  if (!pathsEqual(candidateCommonDirectory, repositoryCommonDirectory)) {
    fail('candidate Worktree belongs to a different Git common directory');
  }
  let branchHead;
  if (branch) {
    branchHead = requireCommit(
      runGit(repo, ['rev-parse', `refs/heads/${branch}`]).stdout.trim(),
      'candidate branch head',
    );
  }
  return {
    allowedRoot,
    candidatePath: candidate.candidatePath,
    registered: true,
    registeredEntry,
    absent: false,
    locked: registeredEntry.locked !== undefined,
    isMainWorktree: pathsEqual(gitDirectory, candidateCommonDirectory),
    isSymbolicLink: candidate.isSymbolicLink,
    currentExecution: pathsEqual(candidate.candidatePath, process.cwd()),
    head,
    branch,
    branchHead,
    clean: status.trim() === '',
    durableRefs: durableRefsContaining(repo, head),
  };
}

function validatePathArray(value, label) {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  return value.map((entry, index) => requireString(entry, `${label}[${index}]`));
}

function validateThreadSnapshot(manifest, candidatePath, now) {
  const observedAt = Date.parse(requireString(manifest.observedAt, 'observedAt'));
  if (!Number.isFinite(observedAt)) fail('observedAt must be an ISO timestamp');
  const age = now - observedAt;
  if (age < -60_000 || age > MAX_THREAD_SNAPSHOT_AGE_MS) {
    fail('Codex thread snapshot is stale or from the future');
  }
  requireBoolean(manifest.completeForProject, 'completeForProject');
  if (manifest.completeForProject !== true) {
    fail('Codex thread snapshot must be complete for the project');
  }
  if (
    manifest.threadSource !== 'codex_app.list_threads' &&
    manifest.threadSource !== 'codex_app.wait_threads'
  ) {
    fail('threadSource must be a live Codex thread tool');
  }
  if (!Array.isArray(manifest.threads) || manifest.threads.length === 0) {
    fail('threads must contain the fresh complete Codex thread snapshot');
  }
  const seenIds = new Set();
  const threads = manifest.threads.map((thread, index) => {
    if (!thread || typeof thread !== 'object') fail(`threads[${index}] must be an object`);
    const id = requireString(thread.id, `threads[${index}].id`);
    if (seenIds.has(id)) fail(`duplicate Codex thread id ${id}`);
    seenIds.add(id);
    const status = requireString(thread.status, `threads[${index}].status`);
    if (!KNOWN_THREAD_STATES.has(status)) fail(`unknown Codex thread status ${status}`);
    return {
      id,
      status,
      cwd: requireString(thread.cwd, `threads[${index}].cwd`),
    };
  });
  const candidateThreadId = requireString(manifest.candidate?.threadId, 'candidate.threadId');
  const ownerThread = threads.find((thread) => thread.id === candidateThreadId);
  if (!ownerThread) fail('candidate.threadId is absent from the complete Codex thread snapshot');
  if (!pathsEqual(ownerThread.cwd, candidatePath)) {
    fail('owning Codex thread cwd must match candidate.path');
  }
  const pathThreads = threads.filter((thread) => pathsEqual(thread.cwd, candidatePath));
  return { ownerThread, pathThreads };
}

function archiveRefFor(taskId, head) {
  const safeTaskId = requireString(taskId, 'candidate.taskId');
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(safeTaskId)) {
    fail('candidate.taskId is not a safe Beads ID');
  }
  return `refs/codex/worktree-archive/${safeTaskId}/${head}`;
}

function candidateIsListed(candidatePath, paths) {
  return paths.some((entry) => pathsEqual(candidatePath, entry));
}

function validateExpectedGitIdentity(candidate, gitState) {
  const expectedHead = requireCommit(candidate.expectedHead, 'candidate.expectedHead');
  if (gitState.head !== expectedHead) fail('candidate.expectedHead does not match live Git HEAD');
  if (!Object.hasOwn(candidate, 'expectedBranch')) {
    fail('candidate.expectedBranch must be supplied, using null for detached HEAD');
  }
  if (candidate.expectedBranch === null) {
    if (gitState.branch !== undefined) fail('candidate expected detached HEAD but has a branch');
  } else if (
    requireString(candidate.expectedBranch, 'candidate.expectedBranch') !== gitState.branch
  ) {
    fail('candidate.expectedBranch does not match live Git branch');
  }
  if (gitState.branch && gitState.branchHead !== gitState.head) {
    fail('candidate branch does not point at the Worktree HEAD');
  }
}

function validateResidualReceipt(manifest, gitState) {
  const receipt = manifest.previousRegisteredCleanup;
  if (!receipt || typeof receipt !== 'object') {
    fail('residual cleanup requires previousRegisteredCleanup evidence');
  }
  if (!pathsEqual(receipt.path, gitState.candidatePath)) {
    fail('previousRegisteredCleanup.path must match candidate.path');
  }
  if (
    requireString(receipt.taskId, 'previousRegisteredCleanup.taskId') !== manifest.candidate.taskId
  ) {
    fail('previousRegisteredCleanup.taskId must match candidate.taskId');
  }
  if (
    requireString(receipt.threadId, 'previousRegisteredCleanup.threadId') !==
    manifest.candidate.threadId
  ) {
    fail('previousRegisteredCleanup.threadId must match candidate.threadId');
  }
  requireCommit(receipt.head, 'previousRegisteredCleanup.head');
  if (receipt.clean !== true || receipt.registrationRemoved !== true) {
    fail('residual cleanup requires clean and registrationRemoved evidence');
  }
  if (receipt.commitReachable !== true) {
    fail('residual cleanup requires archived or otherwise reachable commit evidence');
  }
  return receipt;
}

export function planWorktreeCleanup({ manifest, task, gitState, now = Date.now() }) {
  if (manifest?.schemaVersion !== 1) fail('schemaVersion must be 1');
  const mode = manifest.mode ?? 'registered';
  if (!['registered', 'residual'].includes(mode)) fail('mode must be registered or residual');
  const candidate = manifest.candidate;
  if (!candidate || typeof candidate !== 'object') fail('candidate is required');
  const role = requireString(candidate.role, 'candidate.role');
  if (!ROLES.has(role)) fail('candidate.role is invalid');
  requireBoolean(candidate.noLongerNeeded, 'candidate.noLongerNeeded');
  const { pathThreads } = validateThreadSnapshot(manifest, gitState.candidatePath, now);
  const currentSourceWorktree = requireString(
    manifest.currentSourceWorktree,
    'currentSourceWorktree',
  );
  const currentIntegrationWorktrees = validatePathArray(
    manifest.currentIntegrationWorktrees,
    'currentIntegrationWorktrees',
  );
  const ownerPreservedWorktrees = validatePathArray(
    manifest.ownerPreservedWorktrees,
    'ownerPreservedWorktrees',
  );
  const reasons = [];
  if (role === 'dispatcher') reasons.push('dispatcher Worktree');
  if (gitState.isMainWorktree) reasons.push('primary Git Worktree');
  if (gitState.currentExecution) reasons.push('current execution Worktree');
  if (pathsEqual(gitState.candidatePath, currentSourceWorktree)) {
    reasons.push('current source Worktree');
  }
  if (candidateIsListed(gitState.candidatePath, currentIntegrationWorktrees)) {
    reasons.push('current integration Worktree');
  }
  if (candidateIsListed(gitState.candidatePath, ownerPreservedWorktrees)) {
    reasons.push('owner-preserved Worktree');
  }
  if (candidate.noLongerNeeded !== true) reasons.push('Worktree is still needed');
  for (const thread of pathThreads) {
    if (!INACTIVE_THREAD_STATES.has(thread.status)) {
      reasons.push(`Codex thread ${thread.id} is ${thread.status}`);
    }
  }
  if (gitState.locked) reasons.push('Git Worktree is locked');
  if (gitState.isSymbolicLink) reasons.push('candidate path is a symbolic link or junction');
  if (mode === 'registered' && !gitState.clean) reasons.push('Git Worktree is dirty');
  if (mode === 'registered' && ['main', 'master'].includes(gitState.branch)) {
    reasons.push(`${gitState.branch} branch Worktree`);
  }

  if (role !== 'dispatcher') {
    if (!task || typeof task !== 'object') fail('authoritative Beads task is required');
    const status = requireString(task.status, 'Beads task status');
    if (!['blocked', 'closed', 'in_progress', 'open'].includes(status)) {
      fail(`unexpected Beads task status ${status}`);
    }
    const labels = new Set(task.labels ?? []);
    const stages = [...labels].filter((label) => label.startsWith('stage:'));
    if (stages.length > 1) fail('Beads task has multiple stage labels');
    const stage = stages[0];
    if (labels.has('worktree:preserve')) reasons.push('Beads worktree:preserve label');
    if (PROTECTED_STAGES.has(stage)) reasons.push(`${stage} is protected`);

    if (role === 'implementation') {
      const eligible =
        status === 'closed' || (status === 'in_progress' && stage === 'stage:verified');
      if (!eligible) reasons.push('implementation task is not closed or stage:verified');
    }
    if (role === 'verifier') {
      const eligible =
        status === 'closed' ||
        (status === 'in_progress' && (stage === undefined || stage === 'stage:verified'));
      if (!eligible) reasons.push('verifier lifecycle is not complete');
    }
    if (role === 'integration' && status !== 'closed') {
      reasons.push('integration root is not closed');
    }
  }

  if (mode === 'registered') {
    validateExpectedGitIdentity(candidate, gitState);
  } else {
    validateResidualReceipt(manifest, gitState);
    if (gitState.absent) {
      return { action: 'already-removed', mode, reasons: [] };
    }
  }
  if (reasons.length > 0) {
    return { action: 'preserve', mode, reasons: [...new Set(reasons)].sort() };
  }
  const archiveRef =
    mode === 'registered' && gitState.durableRefs.length === 0
      ? archiveRefFor(candidate.taskId, gitState.head)
      : undefined;
  return {
    action: mode === 'registered' ? 'remove-worktree' : 'remove-residual',
    mode,
    archiveRef,
    durableRefs: mode === 'registered' ? gitState.durableRefs : undefined,
    head: mode === 'registered' ? gitState.head : manifest.previousRegisteredCleanup.head,
  };
}

function archiveCommit(repo, archiveRef, head) {
  const existing = runGit(repo, ['rev-parse', '--verify', archiveRef], { allowFailure: true });
  if (existing.status === 0) {
    const existingHead = requireCommit(existing.stdout.trim(), 'existing archive ref head');
    if (existingHead !== head) fail('existing archive ref points at a different commit');
    return;
  }
  runGit(repo, ['update-ref', archiveRef, head, ZERO_COMMIT]);
  const archivedHead = requireCommit(
    runGit(repo, ['rev-parse', archiveRef]).stdout.trim(),
    'archive ref head',
  );
  if (archivedHead !== head) fail('archive ref does not contain the candidate head');
}

export function worktreeRemoveArgs(candidatePath) {
  return ['worktree', 'remove', '--', candidatePath];
}

export function isWindowsLockFailure(error) {
  const value = `${error?.code ?? ''} ${error?.message ?? error ?? ''}`;
  return /EACCES|EBUSY|EPERM|access is denied|permission denied|sharing violation|used by another process|unable to unlink|failed to delete|locked/i.test(
    value,
  );
}

function removeRegisteredWorktree(repo, candidatePath) {
  const result = runGit(repo, worktreeRemoveArgs(candidatePath), { allowFailure: true });
  if (result.error || result.status !== 0) {
    const detail = result.error?.message ?? (result.stderr || result.stdout).trim();
    const code = isWindowsLockFailure(detail) ? 'windows-lock' : 'git-remove-failed';
    fail(`git worktree remove failed; no force deletion was attempted: ${detail}`, code);
  }
}

async function removeResidualDirectory(candidatePath) {
  try {
    await rejectNestedSymbolicLinks(candidatePath);
    await rm(candidatePath, { recursive: true, force: false, maxRetries: 0 });
  } catch (error) {
    const code = isWindowsLockFailure(error) ? 'windows-lock' : 'residual-remove-failed';
    fail(
      `residual directory removal failed; no unsafe force deletion was attempted: ${error.message}`,
      code,
    );
  }
}

export async function executeWorktreeCleanup(
  manifest,
  { repo = process.cwd(), dryRun = true, now = Date.now(), adapters = {} } = {},
) {
  const repository = path.resolve(repo);
  const collectState = adapters.collectGitState ?? collectGitState;
  const readTask = adapters.readBeadsTask ?? readBeadsTask;
  const doArchive = adapters.archiveCommit ?? archiveCommit;
  const doRemoveWorktree = adapters.removeRegisteredWorktree ?? removeRegisteredWorktree;
  const doRemoveResidual = adapters.removeResidualDirectory ?? removeResidualDirectory;
  const getWorktrees = adapters.listWorktrees ?? listWorktrees;
  const exists = adapters.pathExists ?? pathExists;
  const getFreeBytes = adapters.freeBytesAt ?? freeBytesAt;
  const getDirectoryBytes = adapters.directoryBytes ?? directoryBytes;

  const gitState = await collectState(repository, manifest);
  const role = manifest.candidate?.role;
  const task =
    role === 'dispatcher'
      ? { status: 'open', labels: [] }
      : await readTask(requireString(manifest.candidate?.taskId, 'candidate.taskId'), repository);
  const plan = planWorktreeCleanup({ manifest, task, gitState, now });
  if (plan.action === 'preserve' || plan.action === 'already-removed' || dryRun) {
    return { ...plan, dryRun };
  }

  const parent = path.dirname(gitState.candidatePath);
  const measuredBytesBefore = await getDirectoryBytes(gitState.candidatePath);
  const freeBytesBefore = await getFreeBytes(parent);
  if (plan.action === 'remove-worktree') {
    if (plan.archiveRef) await doArchive(repository, plan.archiveRef, plan.head);
    await doRemoveWorktree(repository, gitState.candidatePath);
    const stillRegistered = getWorktrees(repository).some((entry) =>
      pathsEqual(entry.path, gitState.candidatePath),
    );
    if (stillRegistered) fail('git worktree remove returned success but registration remains');
    const receipt = {
      schemaVersion: 1,
      path: gitState.candidatePath,
      taskId: manifest.candidate.taskId,
      threadId: manifest.candidate.threadId,
      head: plan.head,
      branch: gitState.branch ?? null,
      clean: true,
      registrationRemoved: true,
      commitReachable: plan.archiveRef !== undefined || plan.durableRefs.length > 0,
      archiveRef: plan.archiveRef ?? null,
      removedAt: new Date(now).toISOString(),
    };
    if (await exists(gitState.candidatePath)) {
      return {
        status: 'residual-remains',
        action: plan.action,
        receipt,
        measuredBytesBefore: measuredBytesBefore.toString(),
        error:
          'Git registration was removed but a residual directory remains; use guarded residual mode after Windows locks clear.',
      };
    }
    const freeBytesAfter = await getFreeBytes(parent);
    return {
      status: 'removed',
      action: plan.action,
      receipt,
      measuredReclaimedBytes: measuredBytesBefore.toString(),
      freeBytesBefore: freeBytesBefore.toString(),
      freeBytesAfter: freeBytesAfter.toString(),
      freeSpaceDeltaBytes: (freeBytesAfter > freeBytesBefore
        ? freeBytesAfter - freeBytesBefore
        : 0n
      ).toString(),
    };
  }

  await doRemoveResidual(gitState.candidatePath);
  if (await exists(gitState.candidatePath)) {
    fail('residual cleanup returned success but the directory remains');
  }
  const freeBytesAfter = await getFreeBytes(parent);
  return {
    status: 'removed',
    action: plan.action,
    receipt: manifest.previousRegisteredCleanup,
    measuredReclaimedBytes: measuredBytesBefore.toString(),
    freeBytesBefore: freeBytesBefore.toString(),
    freeBytesAfter: freeBytesAfter.toString(),
    freeSpaceDeltaBytes: (freeBytesAfter > freeBytesBefore
      ? freeBytesAfter - freeBytesBefore
      : 0n
    ).toString(),
  };
}

function parseArguments(argv) {
  const options = { repo: process.cwd(), apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--manifest') {
      options.manifest = argv[++index];
    } else if (argument === '--repo') {
      options.repo = argv[++index];
    } else if (argument === '--apply') {
      options.apply = true;
    } else if (argument === '--dry-run') {
      options.apply = false;
    } else {
      fail(`unknown argument ${argument}`);
    }
  }
  if (!options.manifest) {
    fail(
      'usage: node scripts/cleanup-obsolete-worktree.mjs --manifest PATH [--repo PATH] [--apply]',
    );
  }
  return options;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const manifest = JSON.parse(
      await readFile(path.resolve(options.repo, options.manifest), 'utf8'),
    );
    const result = await executeWorktreeCleanup(manifest, {
      repo: options.repo,
      dryRun: !options.apply,
    });
    console.log(JSON.stringify(result, null, 2));
    if (result.status === 'residual-remains') process.exitCode = 1;
  } catch (error) {
    console.error(`Worktree cleanup rejected (${error.code ?? 'error'}): ${error.message}`);
    process.exitCode = 1;
  }
}
