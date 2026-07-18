import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
const MAX_RESIDUAL_RECEIPT_AGE_MS = 24 * 60 * 60 * 1000;
const LIST_THREADS_SCHEMA_VERSION = 2;
const LIST_THREADS_MAX_LIMIT = 50;
const RECEIPT_SCHEMA_VERSION = 2;
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

function run(command, args, { cwd, allowFailure = false, input } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    input,
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

export function worktreePathSha256(value) {
  return createHash('sha256')
    .update(`gymcoach-worktree-path-v1\0${normalizePathForComparison(value)}`)
    .digest('hex');
}

function gitCommonDirectorySha256(value) {
  return createHash('sha256')
    .update(`gymcoach-git-common-directory-v1\0${normalizePathForComparison(value)}`)
    .digest('hex');
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
  const repositoryCommonDirectory = await resolveGitPath(
    repo,
    runGit(repo, ['rev-parse', '--git-common-dir']).stdout.trim(),
  );
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
    const { receipt, receiptRef } = loadCleanupReceipt(
      repo,
      manifest.previousRegisteredCleanupRef,
      manifest.candidate?.taskId,
    );
    const receiptHead = requireCommit(receipt.head, 'cleanup receipt head');
    const commit = runGit(repo, ['cat-file', '-e', `${receiptHead}^{commit}`], {
      allowFailure: true,
    });
    if (commit.status !== 0) fail('cleanup receipt head is not a Git commit in this repository');
    const durableRefs = durableRefsContaining(repo, receiptHead);
    let receiptReachabilityVerified = false;
    if (receipt.reachability?.kind === 'archive') {
      const archived = runGit(repo, ['rev-parse', '--verify', receipt.reachability.ref], {
        allowFailure: true,
      });
      receiptReachabilityVerified =
        archived.status === 0 && archived.stdout.trim().toLowerCase() === receiptHead;
    } else if (receipt.reachability?.kind === 'durable-ref') {
      receiptReachabilityVerified =
        Array.isArray(receipt.reachability.refs) &&
        receipt.reachability.refs.some((ref) => durableRefs.includes(ref));
    }
    return {
      allowedRoot,
      candidatePath: candidate.candidatePath,
      registered: false,
      absent: candidate.absent,
      isMainWorktree: false,
      isSymbolicLink: candidate.isSymbolicLink,
      currentExecution: pathsEqual(candidate.candidatePath, process.cwd()),
      receipt,
      receiptRef,
      durableRefs,
      receiptReachabilityVerified,
      commonDirectory: repositoryCommonDirectory,
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
    commonDirectory: repositoryCommonDirectory,
  };
}

function validatePathArray(value, label) {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  return value.map((entry, index) => requireString(entry, `${label}[${index}]`));
}

function requireExactKeys(value, expectedKeys, label) {
  const keys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expected)) {
    fail(`${label} must preserve the exact raw list_threads envelope`);
  }
}

function requireFiniteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`${label} must be a finite number`);
  }
  return value;
}

function validateThreadSnapshot(manifest, candidatePath, executorPath, now) {
  const snapshot = manifest.threadSnapshot;
  if (!snapshot || typeof snapshot !== 'object') {
    fail('threadSnapshot must contain raw codex_app.list_threads provenance');
  }
  const observedAt = Date.parse(requireString(snapshot.capturedAt, 'threadSnapshot.capturedAt'));
  if (!Number.isFinite(observedAt)) fail('threadSnapshot.capturedAt must be an ISO timestamp');
  const age = now - observedAt;
  if (age < -60_000 || age > MAX_THREAD_SNAPSHOT_AGE_MS) {
    fail('Codex list_threads snapshot is stale or from the future');
  }
  if (snapshot.tool !== 'codex_app.list_threads') {
    fail('only raw codex_app.list_threads output is valid cleanup evidence');
  }
  const request = snapshot.request;
  if (!request || typeof request !== 'object') fail('threadSnapshot.request is required');
  requireExactKeys(request, ['limit', 'query'], 'threadSnapshot.request');
  if (request.limit !== LIST_THREADS_MAX_LIMIT || request.query !== null) {
    fail('list_threads must be unfiltered and requested at the maximum supported limit');
  }
  const response = snapshot.response;
  if (!response || typeof response !== 'object') fail('threadSnapshot.response is required');
  requireExactKeys(
    response,
    ['query', 'schemaVersion', 'threads', 'unavailableHosts'],
    'threadSnapshot.response',
  );
  if (response.schemaVersion !== LIST_THREADS_SCHEMA_VERSION || response.query !== null) {
    fail('list_threads response schema/query does not prove an unfiltered snapshot');
  }
  if (!Array.isArray(response.unavailableHosts)) {
    fail('list_threads unavailableHosts must be preserved');
  }
  if (response.unavailableHosts.length > 0) {
    fail('list_threads snapshot is incomplete because at least one host was unavailable');
  }
  if (!Array.isArray(response.threads) || response.threads.length === 0) {
    fail('list_threads response must contain project thread evidence');
  }
  if (response.threads.length >= request.limit) {
    fail('list_threads result reached its limit and may be truncated');
  }
  const seenIds = new Set();
  const threads = response.threads.map((thread, index) => {
    if (!thread || typeof thread !== 'object') {
      fail(`threadSnapshot.response.threads[${index}] must be an object`);
    }
    const id = requireString(thread.id, `threadSnapshot.response.threads[${index}].id`);
    const hostId = requireString(thread.hostId, `threadSnapshot.response.threads[${index}].hostId`);
    const identity = `${hostId}:${id}`;
    if (seenIds.has(identity)) fail(`duplicate Codex thread identity ${identity}`);
    seenIds.add(identity);
    const status = requireString(thread.status, `threadSnapshot.response.threads[${index}].status`);
    if (!KNOWN_THREAD_STATES.has(status)) fail(`unknown Codex thread status ${status}`);
    if (typeof thread.hasUnreadTurn !== 'boolean') {
      fail(`threadSnapshot.response.threads[${index}].hasUnreadTurn must be boolean`);
    }
    requireFiniteNumber(thread.createdAt, `threadSnapshot.response.threads[${index}].createdAt`);
    requireFiniteNumber(thread.updatedAt, `threadSnapshot.response.threads[${index}].updatedAt`);
    return {
      id,
      hostId,
      status,
      cwd: requireString(thread.cwd, `threadSnapshot.response.threads[${index}].cwd`),
    };
  });
  const candidateThreadId = requireString(manifest.candidate?.threadId, 'candidate.threadId');
  const candidateHostId = requireString(manifest.candidate?.hostId, 'candidate.hostId');
  const ownerThread = threads.find(
    (thread) => thread.id === candidateThreadId && thread.hostId === candidateHostId,
  );
  if (!ownerThread) {
    fail('candidate thread/host is absent from the complete list_threads snapshot');
  }
  if (!pathsEqual(ownerThread.cwd, candidatePath)) {
    fail('owning Codex thread cwd must match candidate.path');
  }
  const capturedBy = snapshot.capturedBy;
  if (!capturedBy || typeof capturedBy !== 'object') {
    fail('threadSnapshot.capturedBy is required');
  }
  requireExactKeys(capturedBy, ['hostId', 'threadId'], 'threadSnapshot.capturedBy');
  const executorThread = threads.find(
    (thread) =>
      thread.id === requireString(capturedBy.threadId, 'threadSnapshot.capturedBy.threadId') &&
      thread.hostId === requireString(capturedBy.hostId, 'threadSnapshot.capturedBy.hostId'),
  );
  if (!executorThread || !pathsEqual(executorThread.cwd, executorPath)) {
    fail('list_threads snapshot does not contain the cleanup executor at its live path');
  }
  if (!['active', 'running'].includes(executorThread.status)) {
    fail('cleanup executor must be active in the list_threads snapshot');
  }
  const pathThreads = threads.filter((thread) => pathsEqual(thread.cwd, candidatePath));
  return { ownerThread, pathThreads };
}

function validateAuthoritativeRoleBinding(task, candidate, candidatePath, ownerThread) {
  const taskId = requireString(task.id, 'Beads task id');
  if (taskId !== requireString(candidate.taskId, 'candidate.taskId')) {
    fail('candidate.taskId does not match the authoritative Beads task');
  }
  const pattern =
    /^Codex worktree binding v1: task=([a-z0-9]+(?:[.-][a-z0-9]+)*); role=(implementation|integration|verifier); thread=([^;\s]+); host=([^;\s]+); path-sha256=([0-9a-f]{64})$/gm;
  const matches = [...String(task.notes ?? '').matchAll(pattern)].filter(
    (match) =>
      match[1] === taskId &&
      match[3] === ownerThread.id &&
      match[4] === ownerThread.hostId &&
      match[5] === worktreePathSha256(candidatePath),
  );
  if (matches.length !== 1) {
    fail('authoritative Beads notes must contain exactly one matching Worktree role binding');
  }
  const authoritativeRole = matches[0][2];
  if (requireString(candidate.role, 'candidate.role') !== authoritativeRole) {
    fail(`candidate.role does not match authoritative ${authoritativeRole} Worktree binding`);
  }
  return authoritativeRole;
}

function archiveRefFor(taskId, head) {
  const safeTaskId = requireString(taskId, 'candidate.taskId');
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(safeTaskId)) {
    fail('candidate.taskId is not a safe Beads ID');
  }
  return `refs/codex/worktree-archive/${safeTaskId}/${head}`;
}

function cleanupIntentDigest(manifest, candidatePath, allowedRoot) {
  const candidate = manifest.candidate;
  return createHash('sha256')
    .update(
      JSON.stringify({
        taskId: requireString(candidate.taskId, 'candidate.taskId'),
        role: requireString(candidate.role, 'candidate.role'),
        threadId: requireString(candidate.threadId, 'candidate.threadId'),
        hostId: requireString(candidate.hostId, 'candidate.hostId'),
        path: normalizePathForComparison(candidatePath),
        allowedRoot: normalizePathForComparison(allowedRoot),
        expectedHead: requireCommit(candidate.expectedHead, 'candidate.expectedHead'),
        expectedBranch: candidate.expectedBranch ?? null,
      }),
    )
    .digest('hex');
}

function receiptRefFor(taskId, receiptId) {
  const safeTaskId = requireString(taskId, 'candidate.taskId');
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(safeTaskId)) {
    fail('candidate.taskId is not a safe Beads ID');
  }
  if (!/^[0-9a-f]{64}$/.test(receiptId)) fail('cleanup receipt id must be SHA-256');
  return `refs/codex/worktree-cleanup-receipts/${safeTaskId}/${receiptId}`;
}

function persistCleanupReceipt(repo, receipt) {
  const contents = `${JSON.stringify(receipt, null, 2)}\n`;
  const receiptId = createHash('sha256').update(contents).digest('hex');
  const receiptRef = receiptRefFor(receipt.taskId, receiptId);
  const objectId = runGit(repo, ['hash-object', '-w', '--stdin'], {
    input: contents,
  }).stdout.trim();
  if (!/^[0-9a-f]{40,64}$/.test(objectId)) fail('cleanup receipt Git blob was not created');
  const existing = runGit(repo, ['rev-parse', '--verify', receiptRef], { allowFailure: true });
  if (existing.status === 0) {
    if (existing.stdout.trim() !== objectId) {
      fail('existing cleanup receipt ref points at a different Git object');
    }
  } else {
    runGit(repo, ['update-ref', receiptRef, objectId, ZERO_COMMIT]);
  }
  if (runGit(repo, ['cat-file', '-t', receiptRef]).stdout.trim() !== 'blob') {
    fail('cleanup receipt ref must point to a Git blob');
  }
  if (runGit(repo, ['cat-file', '-p', receiptRef]).stdout !== contents) {
    fail('cleanup receipt Git blob does not match the registered-pass receipt');
  }
  return receiptRef;
}

function loadCleanupReceipt(repo, receiptRef, taskId) {
  const safeTaskId = requireString(taskId, 'candidate.taskId');
  const match = requireString(receiptRef, 'previousRegisteredCleanupRef').match(
    /^refs\/codex\/worktree-cleanup-receipts\/([a-z0-9]+(?:[.-][a-z0-9]+)*)\/([0-9a-f]{64})$/,
  );
  if (!match || match[1] !== safeTaskId) {
    fail('previousRegisteredCleanupRef is not the exact task receipt namespace');
  }
  if (runGit(repo, ['cat-file', '-t', receiptRef]).stdout.trim() !== 'blob') {
    fail('previousRegisteredCleanupRef must point to a Git blob');
  }
  const contents = runGit(repo, ['cat-file', '-p', receiptRef]).stdout;
  if (createHash('sha256').update(contents).digest('hex') !== match[2]) {
    fail('previousRegisteredCleanupRef digest does not match its Git blob');
  }
  let receipt;
  try {
    receipt = JSON.parse(contents);
  } catch {
    fail('previousRegisteredCleanupRef does not contain JSON');
  }
  return { receipt, receiptRef };
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

function validateResidualReceipt(manifest, gitState, now) {
  const receipt = gitState.receipt;
  if (!receipt || typeof receipt !== 'object') {
    fail('residual cleanup requires a Git-stored registered-pass receipt');
  }
  requireExactKeys(
    receipt,
    [
      'allowedWorktreeRoot',
      'branch',
      'commonDirectorySha256',
      'head',
      'hostId',
      'intentSha256',
      'kind',
      'path',
      'pathSha256',
      'producer',
      'reachability',
      'registeredRemoval',
      'removedAt',
      'residualObserved',
      'role',
      'schemaVersion',
      'taskId',
      'threadId',
    ],
    'cleanup receipt',
  );
  if (
    receipt.schemaVersion !== RECEIPT_SCHEMA_VERSION ||
    receipt.kind !== 'registered-worktree-removal' ||
    receipt.producer !== 'scripts/cleanup-obsolete-worktree.mjs'
  ) {
    fail('cleanup receipt schema or producer is invalid');
  }
  const removedAt = Date.parse(requireString(receipt.removedAt, 'cleanup receipt removedAt'));
  if (!Number.isFinite(removedAt)) fail('cleanup receipt removedAt must be an ISO timestamp');
  const age = now - removedAt;
  if (age < -60_000 || age > MAX_RESIDUAL_RECEIPT_AGE_MS) {
    fail('cleanup receipt is stale or from the future');
  }
  if (!pathsEqual(receipt.path, gitState.candidatePath)) {
    fail('cleanup receipt path must match candidate.path');
  }
  if (receipt.pathSha256 !== worktreePathSha256(gitState.candidatePath)) {
    fail('cleanup receipt path hash does not match candidate.path');
  }
  if (!pathsEqual(receipt.allowedWorktreeRoot, gitState.allowedRoot)) {
    fail('cleanup receipt allowed root does not match the current resolved root');
  }
  if (receipt.commonDirectorySha256 !== gitCommonDirectorySha256(gitState.commonDirectory)) {
    fail('cleanup receipt Git common-directory identity does not match this repository');
  }
  if (requireString(receipt.taskId, 'cleanup receipt taskId') !== manifest.candidate.taskId) {
    fail('cleanup receipt taskId must match candidate.taskId');
  }
  if (
    requireString(receipt.threadId, 'cleanup receipt threadId') !== manifest.candidate.threadId ||
    requireString(receipt.hostId, 'cleanup receipt hostId') !== manifest.candidate.hostId ||
    requireString(receipt.role, 'cleanup receipt role') !== manifest.candidate.role
  ) {
    fail('cleanup receipt thread/host/role does not match the candidate');
  }
  const receiptHead = requireCommit(receipt.head, 'cleanup receipt head');
  if (receiptHead !== requireCommit(manifest.candidate.expectedHead, 'candidate.expectedHead')) {
    fail('cleanup receipt head does not match candidate.expectedHead');
  }
  if (!Object.hasOwn(manifest.candidate, 'expectedBranch')) {
    fail('residual candidate.expectedBranch must be supplied');
  }
  if ((receipt.branch ?? null) !== (manifest.candidate.expectedBranch ?? null)) {
    fail('cleanup receipt branch does not match candidate.expectedBranch');
  }
  if (
    receipt.intentSha256 !==
    cleanupIntentDigest(manifest, gitState.candidatePath, gitState.allowedRoot)
  ) {
    fail('cleanup receipt does not match the registered cleanup intent');
  }
  const removal = receipt.registeredRemoval;
  if (removal && typeof removal === 'object') {
    requireExactKeys(
      removal,
      ['clean', 'command', 'force', 'registrationRemoved'],
      'cleanup receipt registeredRemoval',
    );
  }
  if (
    !removal ||
    typeof removal !== 'object' ||
    removal.command !== 'git worktree remove' ||
    removal.force !== false ||
    removal.clean !== true ||
    removal.registrationRemoved !== true ||
    receipt.residualObserved !== true
  ) {
    fail('cleanup receipt does not prove the clean non-forced registered removal pass');
  }
  if (!receipt.reachability || typeof receipt.reachability !== 'object') {
    fail('cleanup receipt reachability evidence is required');
  }
  if (receipt.reachability.kind === 'archive') {
    requireExactKeys(receipt.reachability, ['kind', 'ref'], 'cleanup receipt reachability');
    if (receipt.reachability.ref !== archiveRefFor(receipt.taskId, receiptHead)) {
      fail('cleanup receipt archive ref does not match task/head identity');
    }
  } else if (receipt.reachability.kind === 'durable-ref') {
    requireExactKeys(receipt.reachability, ['kind', 'refs'], 'cleanup receipt reachability');
    if (
      !Array.isArray(receipt.reachability.refs) ||
      receipt.reachability.refs.length === 0 ||
      (receipt.branch !== null &&
        !receipt.reachability.refs.includes(`refs/heads/${receipt.branch}`))
    ) {
      fail('cleanup receipt durable-ref evidence is incomplete');
    }
  } else {
    fail('cleanup receipt reachability kind is invalid');
  }
  if (!gitState.receiptReachabilityVerified) {
    fail('cleanup receipt head is not currently reachable from its recorded durable evidence');
  }
  return receipt;
}

export function planWorktreeCleanup({
  manifest,
  task,
  gitState,
  executorPath = process.cwd(),
  now = Date.now(),
}) {
  if (manifest?.schemaVersion !== 2) fail('schemaVersion must be 2');
  const mode = manifest.mode ?? 'registered';
  if (!['registered', 'residual'].includes(mode)) fail('mode must be registered or residual');
  const candidate = manifest.candidate;
  if (!candidate || typeof candidate !== 'object') fail('candidate is required');
  let role = requireString(candidate.role, 'candidate.role');
  if (!ROLES.has(role)) fail('candidate.role is invalid');
  requireBoolean(candidate.noLongerNeeded, 'candidate.noLongerNeeded');
  const { ownerThread, pathThreads } = validateThreadSnapshot(
    manifest,
    gitState.candidatePath,
    executorPath,
    now,
  );
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
    role = validateAuthoritativeRoleBinding(task, candidate, gitState.candidatePath, ownerThread);
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
    validateResidualReceipt(manifest, gitState, now);
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
    head: mode === 'registered' ? gitState.head : gitState.receipt.head,
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

function buildRegisteredCleanupReceipt({ manifest, gitState, plan, now, residualObserved }) {
  return {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    kind: 'registered-worktree-removal',
    producer: 'scripts/cleanup-obsolete-worktree.mjs',
    taskId: manifest.candidate.taskId,
    role: manifest.candidate.role,
    threadId: manifest.candidate.threadId,
    hostId: manifest.candidate.hostId,
    path: gitState.candidatePath,
    pathSha256: worktreePathSha256(gitState.candidatePath),
    allowedWorktreeRoot: gitState.allowedRoot,
    commonDirectorySha256: gitCommonDirectorySha256(gitState.commonDirectory),
    head: plan.head,
    branch: gitState.branch ?? null,
    intentSha256: cleanupIntentDigest(manifest, gitState.candidatePath, gitState.allowedRoot),
    reachability: plan.archiveRef
      ? { kind: 'archive', ref: plan.archiveRef }
      : { kind: 'durable-ref', refs: plan.durableRefs },
    registeredRemoval: {
      command: 'git worktree remove',
      force: false,
      clean: true,
      registrationRemoved: true,
    },
    residualObserved,
    removedAt: new Date(now).toISOString(),
  };
}

export async function executeWorktreeCleanup(
  manifest,
  {
    repo = process.cwd(),
    dryRun = true,
    executorPath = process.cwd(),
    now = Date.now(),
    adapters = {},
  } = {},
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
  const storeReceipt = adapters.persistCleanupReceipt ?? persistCleanupReceipt;

  const gitState = await collectState(repository, manifest);
  const role = manifest.candidate?.role;
  const task =
    role === 'dispatcher'
      ? { status: 'open', labels: [] }
      : await readTask(requireString(manifest.candidate?.taskId, 'candidate.taskId'), repository);
  const plan = planWorktreeCleanup({ manifest, task, gitState, executorPath, now });
  if (plan.action === 'preserve' || plan.action === 'already-removed' || dryRun) {
    return { ...plan, dryRun };
  }

  const parent = path.dirname(gitState.candidatePath);
  const measuredBytesBefore = await getDirectoryBytes(gitState.candidatePath);
  const freeBytesBefore = await getFreeBytes(parent);
  if (plan.action === 'remove-worktree') {
    if (plan.archiveRef) await doArchive(repository, plan.archiveRef, plan.head);
    let removalError;
    try {
      await doRemoveWorktree(repository, gitState.candidatePath);
    } catch (error) {
      removalError = error;
    }
    const stillRegistered = getWorktrees(repository).some((entry) =>
      pathsEqual(entry.path, gitState.candidatePath),
    );
    if (stillRegistered) {
      if (removalError) throw removalError;
      fail('git worktree remove returned success but registration remains');
    }
    const residualObserved = await exists(gitState.candidatePath);
    const receipt = buildRegisteredCleanupReceipt({
      manifest,
      gitState,
      plan,
      now,
      residualObserved,
    });
    if (residualObserved) {
      const receiptRef = await storeReceipt(repository, receipt);
      return {
        status: 'residual-remains',
        action: plan.action,
        receipt,
        receiptRef,
        measuredBytesBefore: measuredBytesBefore.toString(),
        gitRemovalFailed: removalError !== undefined,
        error: removalError
          ? 'Git registration was removed despite a nonzero git worktree remove result; the canonical residual receipt was persisted before returning the lock failure.'
          : 'Git registration was removed but a residual directory remains; use guarded residual mode after Windows locks clear.',
      };
    }
    if (removalError) {
      fail(
        'git worktree remove returned nonzero after registration and path were already removed; no fallback deletion was attempted',
        isWindowsLockFailure(removalError) ? 'windows-lock' : 'git-remove-failed',
      );
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
    receipt: gitState.receipt,
    receiptRef: gitState.receiptRef,
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
