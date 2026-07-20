import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const COMPLETE = 'complete';
const DELIVERY_STAGES = ['integrated', 'published', 'installed', 'deployed'];
const DELIVERY_STATUSES = new Set(['complete', 'not-required', 'not-authorized', 'pending']);
const NO_RUNTIME_ALLOWED_EXACT_PATHS = new Set([
  'AGENTS.md',
  'CLAUDE.md',
  'CONTRIBUTING.md',
  'scripts/check-integration-evidence.mjs',
  'scripts/cleanup-obsolete-worktree.mjs',
  'scripts/close-integrated-tasks.mjs',
  'scripts/harness-status-core.mjs',
  'scripts/harness-status.ps1',
  'scripts/publish-integration-draft.mjs',
  'scripts/sync-beads-github.mjs',
  'scripts/verify.sh',
]);
const NO_RUNTIME_ALLOWED_PREFIXES = [
  '.agents/skills/',
  '.codex/',
  'docs/',
  'scripts/fixtures/github-mirror/',
  'scripts/fixtures/harness-status/',
  'scripts/fixtures/integration-evidence/',
  'scripts/fixtures/worktree-cleanup/',
];
const VERIFICATION_EVIDENCE_PREFIX = 'Immutable verification evidence v1: ';
const COORDINATOR_AUTHORITY_LABEL = 'role:integration-coordinator';
const STAGE_LABELS = new Set([
  'stage:inbox',
  'stage:ready',
  'stage:review',
  'stage:verify',
  'stage:awaiting-integration',
]);
const GYMCOACH_ANDROID_PACKAGE = 'org.sharteman.gymcoach';

export class IntegrationEvidenceError extends Error {}

function reject(message) {
  throw new IntegrationEvidenceError(message);
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    reject(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function requireCommit(value, label) {
  const commit = requireString(value, label).toLowerCase();
  if (!COMMIT_PATTERN.test(commit)) {
    reject(`${label} must be a full 40-character Git commit`);
  }
  return commit;
}

function requireExactKeys(value, expectedKeys, label) {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    reject(`${label} has unexpected or missing fields`);
  }
}

function runGit(repo, args, { allowFailure = false } = {}) {
  const result = spawnSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error) {
    reject(`git ${args.join(' ')} failed: ${result.error.message}`);
  }
  if (result.status !== 0 && !allowFailure) {
    reject(`git ${args.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return result;
}

function runBeads(repo, args) {
  const result = spawnSync('bd', ['--readonly', ...args], {
    cwd: repo,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    reject(
      `bd ${args.join(' ')} failed: ${result.error?.message ?? (result.stderr || result.stdout).trim()}`,
    );
  }
  try {
    return result.stdout.trim() === '' ? [] : JSON.parse(result.stdout);
  } catch (error) {
    reject(`bd ${args.join(' ')} returned invalid JSON: ${error.message}`);
  }
}

function runBeadsExport(repo) {
  const result = spawnSync('bd', ['--readonly', 'export'], {
    cwd: repo,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 100 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    reject(`bd export failed: ${result.error?.message ?? (result.stderr || result.stdout).trim()}`);
  }
  return result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        reject(`bd export returned invalid JSONL: ${error.message}`);
      }
    });
}

export function indexBeadsExportRows(rows) {
  const index = new Map();
  for (const row of rows) {
    if (row?._type !== 'issue' || typeof row.id !== 'string') continue;
    if (index.has(row.id)) reject(`bd export contains duplicate task ${row.id}`);
    index.set(row.id, row);
  }
  return index;
}

function requireGitCommit(repo, commit) {
  runGit(repo, ['cat-file', '-e', `${commit}^{commit}`]);
  return commit;
}

function isAncestor(repo, ancestor, descendant) {
  return (
    runGit(repo, ['merge-base', '--is-ancestor', ancestor, descendant], {
      allowFailure: true,
    }).status === 0
  );
}

function currentHead(repo) {
  return runGit(repo, ['rev-parse', 'HEAD']).stdout.trim().toLowerCase();
}

function currentBranch(repo) {
  return runGit(repo, ['branch', '--show-current']).stdout.trim();
}

function resolveInsideRepo(repo, relativePath, label) {
  const value = requireString(relativePath, label);
  if (path.isAbsolute(value)) {
    reject(`${label} must be relative to the integration repository`);
  }
  const root = path.resolve(repo);
  const resolved = path.resolve(root, value);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    reject(`${label} escapes the integration repository`);
  }
  return resolved;
}

async function readJson(jsonPath, label) {
  try {
    return JSON.parse(await readFile(jsonPath, 'utf8'));
  } catch (error) {
    reject(`${label} is not valid JSON: ${error.message}`);
  }
}

function normalizeDigest(value) {
  return value.replaceAll(':', '').toLowerCase();
}

function readCertificateDigest(output, label) {
  const match = output.match(/Signer #\d+ certificate SHA-256 digest:\s*([0-9a-f:]+)/i);
  if (!match) {
    reject(`${label} does not contain an apksigner SHA-256 certificate digest`);
  }
  const digest = normalizeDigest(match[1]);
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    reject(`${label} contains an invalid certificate digest`);
  }
  return digest;
}

function defaultAndroidToolRunner(executable, args, label) {
  let command = executable;
  let commandArgs = args;
  if (process.platform === 'win32' && executable.toLowerCase().endsWith('.bat')) {
    const values = [executable, ...args];
    if (values.some((value) => /["&|<>^%!]/.test(value))) {
      reject(`${label} contains a path or argument unsafe for cmd.exe batch execution`);
    }
    command = process.env.ComSpec ?? 'cmd.exe';
    commandArgs = ['/d', '/s', '/c', 'call', ...values];
  }
  const result = spawnSync(command, commandArgs, { encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) {
    reject(`${label} failed: ${result.error?.message ?? (result.stderr || result.stdout).trim()}`);
  }
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

async function resolveAndroidTool(repo, value, label, allowedNames, sdkRoot) {
  const raw = requireString(value, label);
  const resolved = path.isAbsolute(raw) ? path.resolve(raw) : resolveInsideRepo(repo, raw, label);
  const toolStat = await stat(resolved).catch(() => undefined);
  if (!toolStat?.isFile()) reject(`${label} must identify an existing executable file`);
  const resolvedTool = await realpath(resolved);
  const resolvedSdkRoot = await realpath(requireString(sdkRoot, 'Android SDK root')).catch(() =>
    reject('Android SDK root does not exist'),
  );
  const toolName = path.basename(resolvedTool).toLowerCase();
  if (!allowedNames.has(toolName)) {
    reject(`${label} must identify the Android SDK ${[...allowedNames][0]} executable`);
  }
  const relative = path.relative(resolvedSdkRoot, resolvedTool).replaceAll('\\', '/');
  const match = relative.match(/^build-tools\/(\d+(?:\.\d+){1,2})\/[^/]+$/);
  if (!match || relative.startsWith('../')) {
    reject(`${label} must resolve under the configured Android SDK build-tools directory`);
  }
  return { path: resolvedTool, buildToolsVersion: match[1], directory: path.dirname(resolvedTool) };
}

function listZipEntries(contents, label) {
  const minimumEocdSize = 22;
  const searchStart = Math.max(0, contents.length - 65_557);
  let eocd = -1;
  for (let offset = contents.length - minimumEocdSize; offset >= searchStart; offset -= 1) {
    if (contents.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) reject(`${label} is not a structurally valid ZIP/APK`);
  const entryCount = contents.readUInt16LE(eocd + 10);
  let offset = contents.readUInt32LE(eocd + 16);
  const entries = [];
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > contents.length || contents.readUInt32LE(offset) !== 0x02014b50) {
      reject(`${label} has an invalid ZIP central directory`);
    }
    const nameLength = contents.readUInt16LE(offset + 28);
    const extraLength = contents.readUInt16LE(offset + 30);
    const commentLength = contents.readUInt16LE(offset + 32);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > contents.length) reject(`${label} has a truncated ZIP entry`);
    entries.push(contents.subarray(nameStart, nameEnd).toString('utf8'));
    offset = nameEnd + extraLength + commentLength;
  }
  return entries;
}

async function validateApkStructure(filePath, label) {
  const contents = await readFile(filePath);
  const entries = listZipEntries(contents, label);
  if (!entries.includes('AndroidManifest.xml')) {
    reject(`${label} does not contain AndroidManifest.xml`);
  }
  if (!entries.some((entry) => /^classes\d*\.dex$/.test(entry))) {
    reject(`${label} does not contain an Android DEX payload`);
  }
  return {
    sha256: createHash('sha256').update(contents).digest('hex'),
    sizeBytes: contents.length,
  };
}

function parseAaptBadging(output, label) {
  const packageLine = output.match(
    /^package:\s+name='([^']+)'\s+versionCode='(\d+)'\s+versionName='([^']+)'/m,
  );
  if (!packageLine) reject(`${label} did not report package/version manifest data`);
  return {
    packageName: packageLine[1],
    versionCode: Number(packageLine[2]),
    versionName: packageLine[3],
  };
}

export function buildImmutableVerificationNote({
  verifiedBase,
  verifiedCommit,
  gate,
  artifactImpact,
}) {
  return `${VERIFICATION_EVIDENCE_PREFIX}${JSON.stringify({
    artifactImpact: requireString(artifactImpact, 'artifactImpact'),
    gate: {
      command: requireString(gate?.command, 'gate.command'),
      exitCode: gate?.exitCode,
      head: requireCommit(gate?.head, 'gate.head'),
    },
    verifiedBase: requireCommit(verifiedBase, 'verifiedBase'),
    verifiedCommit: requireCommit(verifiedCommit, 'verifiedCommit'),
  })}`;
}

function closureDeliveryStatus(evidence, stageName) {
  const stage = evidence?.delivery?.[stageName];
  const status = typeof stage === 'string' ? stage : stage?.status;
  if (!DELIVERY_STATUSES.has(status)) {
    reject(`guarded closure delivery.${stageName}.status is invalid`);
  }
  return status;
}

export function buildGuardedClosureNote(evidence, taskId) {
  const head = requireCommit(evidence?.head, 'guarded closure head');
  if (evidence?.mode === 'no-runtime-artifact') {
    return `Guarded no-runtime-artifact closure at verified commit ${head}.`;
  }
  if (evidence?.mode !== 'integration') {
    reject('guarded closure mode must be integration or no-runtime-artifact');
  }
  const coordinatorTaskIds = new Set(evidence.coordinatorTaskIds ?? []);
  const prefix = coordinatorTaskIds.has(taskId)
    ? 'Guarded integration root coordination closure'
    : 'Guarded integration closure';
  return `${prefix}: head ${head}; integrated=${closureDeliveryStatus(evidence, 'integrated')}; published=${closureDeliveryStatus(evidence, 'published')}; installed=${closureDeliveryStatus(evidence, 'installed')}; deployed=${closureDeliveryStatus(evidence, 'deployed')}.`;
}

function guardedClosureRecords(task) {
  const records = [];
  const integrationPattern =
    /^(Guarded integration(?: root coordination)? closure): head ([0-9a-f]{40}); integrated=(complete|not-required|not-authorized|pending); published=(complete|not-required|not-authorized|pending); installed=(complete|not-required|not-authorized|pending); deployed=(complete|not-required|not-authorized|pending)\.$/;
  const noRuntimePattern =
    /^Guarded no-runtime-artifact closure at verified commit ([0-9a-f]{40})\.$/;
  for (const line of String(task?.notes ?? '').split(/\r?\n/)) {
    const trimmed = line.trim();
    const integration = trimmed.match(integrationPattern);
    if (integration) {
      records.push({ line: trimmed, kind: 'integration' });
      continue;
    }
    if (noRuntimePattern.test(trimmed)) {
      records.push({ line: trimmed, kind: 'no-runtime-artifact' });
    }
  }
  return records;
}

function taskHasMatchingGuardedClosureNote(task, evidence, taskId = task?.id) {
  const records = guardedClosureRecords(task);
  if (records.length !== 1) return false;
  return records[0].line === buildGuardedClosureNote(evidence, taskId);
}

export function taskHasGuardedClosure(task, evidence, taskId = task?.id) {
  if (evidence === undefined || task?.status !== 'closed' || taskStageLabels(task).length !== 0) {
    return false;
  }
  const records = guardedClosureRecords(task);
  if (records.length !== 1) return false;
  return records[0].line === buildGuardedClosureNote(evidence, taskId);
}

function verificationRecords(task) {
  const records = [];
  for (const line of String(task.notes ?? '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(VERIFICATION_EVIDENCE_PREFIX)) continue;
    let record;
    try {
      record = JSON.parse(trimmed.slice(VERIFICATION_EVIDENCE_PREFIX.length));
    } catch (error) {
      reject(`${task.id} has invalid immutable verification JSON: ${error.message}`);
    }
    if (!record || typeof record !== 'object') {
      reject(`${task.id} immutable verification evidence must be an object`);
    }
    requireExactKeys(
      record,
      ['artifactImpact', 'gate', 'verifiedBase', 'verifiedCommit'],
      `${task.id} immutable verification evidence`,
    );
    if (!record.gate || typeof record.gate !== 'object') {
      reject(`${task.id} immutable verification gate is required`);
    }
    requireExactKeys(
      record.gate,
      ['command', 'exitCode', 'head'],
      `${task.id} immutable verification gate`,
    );
    records.push({
      artifactImpact: requireString(record.artifactImpact, `${task.id} artifactImpact`),
      gate: {
        command: requireString(record.gate.command, `${task.id} gate.command`),
        exitCode: record.gate.exitCode,
        head: requireCommit(record.gate.head, `${task.id} gate.head`),
      },
      verifiedBase: requireCommit(record.verifiedBase, `${task.id} verifiedBase`),
      verifiedCommit: requireCommit(record.verifiedCommit, `${task.id} verifiedCommit`),
    });
  }
  return records;
}

function validateGate(gate, expectedHead, label) {
  if (!gate || typeof gate !== 'object') {
    reject(`${label} is required`);
  }
  requireString(gate.command, `${label}.command`);
  if (gate.exitCode !== 0) {
    reject(`${label}.exitCode must be 0`);
  }
  if (expectedHead !== undefined) {
    const gateHead = requireCommit(gate.head, `${label}.head`);
    if (gateHead !== expectedHead) {
      reject(`${label}.head must match ${expectedHead}`);
    }
  }
}

function validateIntegrationReview(review, integrationHead) {
  if (!review || typeof review !== 'object') {
    reject('integration.review is required');
  }
  if (requireCommit(review.head, 'integration.review.head') !== integrationHead) {
    reject('integration.review.head must match the integration head');
  }
  if (review.result !== 'passed') {
    reject('integration.review.result must be passed');
  }
  requireString(review.reviewedBy, 'integration.review.reviewedBy');
  requireString(review.reviewEvidence, 'integration.review.reviewEvidence');
}

function validateDelivery(delivery, { integrationHead, androidRequired, requirements }) {
  if (!delivery || typeof delivery !== 'object') {
    reject('delivery evidence is required');
  }
  for (const stageName of DELIVERY_STAGES) {
    const stage = delivery[stageName];
    if (!stage || typeof stage !== 'object') {
      reject(`delivery.${stageName} is required`);
    }
    if (typeof stage.required !== 'boolean') {
      reject(`delivery.${stageName}.required must be boolean`);
    }
    if (!DELIVERY_STATUSES.has(stage.status)) {
      reject(`delivery.${stageName}.status is invalid`);
    }
    if (stage.required && stage.status !== COMPLETE) {
      reject(`delivery.${stageName} is required but not complete`);
    }
    if (stage.status === COMPLETE && stageName !== 'integrated') {
      requireString(stage.evidence, `delivery.${stageName}.evidence`);
    }
  }

  if (integrationHead) {
    const integrated = delivery.integrated;
    if (!integrated.required || integrated.status !== COMPLETE) {
      reject('delivery.integrated must be required and complete for product integration');
    }
    if (requireCommit(integrated.head, 'delivery.integrated.head') !== integrationHead) {
      reject('delivery.integrated.head must match the integration head');
    }
  }

  if (androidRequired) {
    if (!delivery.published.required || delivery.published.status !== COMPLETE) {
      reject('Android integration requires completed publication evidence');
    }
  }

  for (const stageName of ['installed', 'deployed']) {
    const required = requirements[stageName];
    if (delivery[stageName].required !== required) {
      reject(`delivery.${stageName}.required must match task acceptance requirements`);
    }
  }
}

function expectedArtifactImpact(task, paths) {
  if (task.classification === 'no-runtime-artifact') return 'no-runtime-artifact';
  return task.affectsAndroid === true ||
    paths.some((file) => file.startsWith('android/') || file.startsWith('data/android-release/'))
    ? 'android'
    : 'runtime';
}

function validateVerifiedTask(repo, task, authoritativeTask) {
  const id = requireString(task.id, 'task.id');
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(id)) {
    reject(`task.id ${id} is not a safe Beads task ID`);
  }
  if (!task.verified || typeof task.verified !== 'object') {
    reject(`${id}.verified evidence is required`);
  }
  const base = requireGitCommit(repo, requireCommit(task.verified.base, `${id}.verified.base`));
  const commit = requireGitCommit(
    repo,
    requireCommit(task.verified.commit, `${id}.verified.commit`),
  );
  if (!isAncestor(repo, base, commit)) {
    reject(`${id}.verified.base is not an ancestor of the verified commit`);
  }
  validateGate(task.verified.gate, commit, `${id}.verified.gate`);
  if (!authoritativeTask || authoritativeTask.id !== id) {
    reject(`${id} is absent from authoritative Beads verification state`);
  }
  const taskChangedPaths = changedPaths(repo, base, commit);
  const artifactImpact = expectedArtifactImpact(task, taskChangedPaths);
  const matches = verificationRecords(authoritativeTask).filter(
    (record) =>
      record.verifiedBase === base &&
      record.verifiedCommit === commit &&
      record.artifactImpact === artifactImpact &&
      record.gate.head === commit &&
      record.gate.exitCode === task.verified.gate.exitCode &&
      record.gate.command === task.verified.gate.command,
  );
  if (matches.length !== 1) {
    reject(`${id} manifest verification does not match exactly one immutable Beads note`);
  }
  return { id, base, commit, artifactImpact, changedPaths: taskChangedPaths };
}

function validateBehaviorEquivalentMapping(
  repo,
  mapping,
  integrationHead,
  { subject, fieldPrefix },
) {
  const replacements = mapping.replacementCommits;
  if (!Array.isArray(replacements) || replacements.length === 0) {
    reject(`${subject} behavior-equivalent mapping needs replacement commits`);
  }
  for (const [index, replacementValue] of replacements.entries()) {
    const replacement = requireGitCommit(
      repo,
      requireCommit(replacementValue, `${fieldPrefix}.replacementCommits[${index}]`),
    );
    if (!isAncestor(repo, replacement, integrationHead)) {
      reject(`${subject} replacement commit ${replacement} is absent from the integration head`);
    }
  }
  requireString(mapping.reviewedBy, `${fieldPrefix}.reviewedBy`);
  requireString(mapping.reviewEvidence, `${fieldPrefix}.reviewEvidence`);
  requireString(mapping.mappingId, `${fieldPrefix}.mappingId`);
  return replacements;
}

function validateIntegrationMapping(repo, task, verified, integrationHead) {
  if (!task.integration || typeof task.integration !== 'object') {
    reject(`${verified.id}.integration mapping is required`);
  }
  if (task.integration.method === 'ancestor') {
    if (!isAncestor(repo, verified.commit, integrationHead)) {
      reject(
        `${verified.id} verified commit ${verified.commit} is not an ancestor of integration head ${integrationHead}`,
      );
    }
    return { method: 'ancestor' };
  }
  if (task.integration.method !== 'behavior-equivalent') {
    reject(`${verified.id}.integration.method must be ancestor or behavior-equivalent`);
  }
  const replacements = validateBehaviorEquivalentMapping(repo, task.integration, integrationHead, {
    subject: verified.id,
    fieldPrefix: `${verified.id}.integration`,
  });
  return { method: 'behavior-equivalent', replacements };
}

function changedPaths(repo, base, commit) {
  const output = runGit(repo, ['diff', '--name-only', `${base}..${commit}`]).stdout.trim();
  return output === '' ? [] : output.split(/\r?\n/).sort();
}

export function isNoRuntimeArtifactPath(file) {
  return (
    NO_RUNTIME_ALLOWED_EXACT_PATHS.has(file) ||
    NO_RUNTIME_ALLOWED_PREFIXES.some((prefix) => file.startsWith(prefix)) ||
    /^scripts\/test-[a-z0-9_.-]+\.mjs$/i.test(file)
  );
}

function validateNoRuntimeArtifact(repo, task, verified) {
  if (task.classification !== 'no-runtime-artifact') {
    reject(`${verified.id} must use classification no-runtime-artifact`);
  }
  const exception = task.noRuntimeArtifact;
  if (!exception || typeof exception !== 'object') {
    reject(`${verified.id}.noRuntimeArtifact exception is required`);
  }
  requireString(exception.reason, `${verified.id}.noRuntimeArtifact.reason`);
  requireString(exception.reviewedBy, `${verified.id}.noRuntimeArtifact.reviewedBy`);
  if (!Array.isArray(exception.changedPaths) || exception.changedPaths.length === 0) {
    reject(`${verified.id}.noRuntimeArtifact.changedPaths is required`);
  }
  const declared = [
    ...new Set(exception.changedPaths.map((item) => requireString(item, 'changed path'))),
  ].sort();
  const actual = changedPaths(repo, verified.base, verified.commit);
  if (JSON.stringify(declared) !== JSON.stringify(actual)) {
    reject(`${verified.id} no-runtime changed paths do not match the verified Git diff`);
  }
  const runtimePath = actual.find((file) => !isNoRuntimeArtifactPath(file));
  if (runtimePath) {
    reject(`${verified.id} no-runtime exception includes runtime path ${runtimePath}`);
  }
}

function taskStageLabels(task) {
  const stages = task.labels?.filter((label) => label.startsWith('stage:')) ?? [];
  const unknown = stages.find((stage) => !STAGE_LABELS.has(stage));
  if (unknown) reject(`${task.id} has unsupported workflow stage ${unknown}`);
  return stages;
}

function taskHasVerifiedEvidence(
  task,
  { allowVerifyStage = false, allowPartialClosure = false, closureEvidence } = {},
) {
  const stages = taskStageLabels(task);
  const hasImmutableRecord = verificationRecords(task).length > 0;
  if (!hasImmutableRecord || task.status !== 'in_progress') return false;
  if (stages.length === 1 && stages[0] === 'stage:awaiting-integration') return true;
  if (allowVerifyStage && stages.length === 1 && stages[0] === 'stage:verify') return true;
  return (
    allowPartialClosure &&
    stages.length === 0 &&
    taskHasMatchingGuardedClosureNote(task, closureEvidence, task.id)
  );
}

function dependencyId(dependency) {
  return dependency?.depends_on_id ?? dependency?.id;
}

async function loadBeadsAuthority(repo, rootTaskId) {
  const tasks = {};
  const blockingDependencies = {};
  const taskIndex = indexBeadsExportRows(runBeadsExport(repo));
  const pending = [rootTaskId];
  while (pending.length > 0) {
    const taskId = pending.pop();
    if (tasks[taskId]) {
      continue;
    }
    const task = taskIndex.get(taskId);
    if (!task) reject(`authoritative Beads export task ${taskId} was not found exactly once`);
    if (task.id !== taskId) {
      reject(`authoritative Beads lookup for ${taskId} returned ${task.id ?? 'an invalid task'}`);
    }
    tasks[taskId] = task;
    const dependencies = runBeads(repo, ['dep', 'list', taskId, '--type', 'blocks', '--json']);
    if (!Array.isArray(dependencies)) {
      reject(`authoritative Beads dependencies for ${taskId} are invalid`);
    }
    const ids = dependencies.map(dependencyId).filter(Boolean);
    blockingDependencies[taskId] = [...new Set(ids)].sort();
    pending.push(...blockingDependencies[taskId]);
  }
  return { rootTaskId, tasks, blockingDependencies };
}

function splitAcceptanceClauses(value) {
  return requireString(value, 'Beads acceptance criteria')
    .replace(/\r\n/g, '\n')
    .split(/\n+|(?=\b\d+\.\s+)|(?<=[.;])\s+/)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

function clauseRequiresDelivery(clause, stageName) {
  const term = stageName === 'installed' ? /install(?:ed|ation|ing)?/ : /deploy(?:ed|ment|ing)?/;
  const source = term.source;
  if (!new RegExp(`\\b(?:${source})\\b`, 'i').test(clause)) {
    return false;
  }
  if (
    /\b(?:if|when|unless)\b/i.test(clause) ||
    /\bonly\s+(?:if|when|after|once|with|under|upon)\b/i.test(clause) ||
    /\b(?:for example|e\.g\.|for instance|hypothetically|illustrative(?:ly)?|suppose|assuming)\b/i.test(
      clause,
    ) ||
    /\b(?:could|might|may)\s+(?:be\s+)?(?:installed|deployed)\b/i.test(clause)
  ) {
    return false;
  }
  if (
    new RegExp(
      `(?:\\b(?:no|never|without|do not|does not|did not|must not|shall not|should not|may not|cannot|unauthorized|not[- ]authorized|not[- ]required|prohibited|forbidden|optional)\\b[^.;\\n]{0,120}\\b(?:${source})\\b|\\b(?:${source})\\b[^.;\\n]{0,120}\\b(?:never inferred|not[- ]authorized|not[- ]required|not[- ]permitted|not[- ]performed|prohibited|forbidden|optional|(?:do|does|did|must|shall|should|may|can)\\s+not|cannot|not\\s+occur(?:s)?)\\b)`,
      'i',
    ).test(clause)
  ) {
    return false;
  }
  const directPatterns =
    stageName === 'installed'
      ? [
          /\bmust\s+(?:be\s+)?installed\b/i,
          /\b(?:apk|app|application|artifact|build|hap|package)\s+(?:is|are|shall be)\s+installed\b/i,
          /\brequires?\s+(?:an?\s+|physical\s+)?installation\b/i,
          /\binstallation\s+(?:is|shall be|must be)\s+required\b/i,
        ]
      : [
          /\bmust\s+(?:be\s+)?deployed\b/i,
          /\b(?:app|application|artifact|build|integration|runtime|service)\s+(?:is|are|shall be)\s+deployed\b/i,
          /\brequires?\s+(?:a\s+|production\s+)?deployment\b/i,
          /\bdeployment\s+(?:is|shall be|must be)\s+required\b/i,
          /\bdeployment\s+(?:reaches|completes?)\b/i,
          /^\s*(?:\d+\.\s*)?deploy\s+the\s+integrated\s+version\b/i,
        ];
  if (directPatterns.some((pattern) => pattern.test(clause))) {
    return true;
  }
  if (
    new RegExp(
      `\\b(?:${source})\\b[^.;\\n]{0,120}\\b(?:metadata\\s+fields?|status\\s+labels?|state\\s+labels?)\\b`,
      'i',
    ).test(clause) ||
    /\bnot\s+(?:an?\s+)?delivery\s+requirements?\b/i.test(clause)
  ) {
    return false;
  }
  const imperativePattern =
    stageName === 'installed'
      ? /^\s*(?:\d+\.\s*)?install\b(?=[^.;\n]{0,80}\b(?:apk|app|application|artifact|build|hap|package|version)\b)/i
      : /^\s*(?:\d+\.\s*)?deploy\b(?=[^.;\n]{0,80}\b(?:app|application|artifact|build|integrated\s+version|integration|runtime|service|version)\b)/i;
  return imperativePattern.test(clause);
}

export function deriveAcceptanceDeliveryRequirements(tasks) {
  const requirements = { installed: false, deployed: false };
  for (const task of tasks) {
    for (const clause of splitAcceptanceClauses(task.acceptance_criteria)) {
      requirements.installed ||= clauseRequiresDelivery(clause, 'installed');
      requirements.deployed ||= clauseRequiresDelivery(clause, 'deployed');
    }
  }
  return requirements;
}

function normalizeAuthority(authority, rootTaskId) {
  if (!authority || typeof authority !== 'object') {
    reject('authoritative Beads context is required');
  }
  if (authority.rootTaskId !== rootTaskId) {
    reject('authoritative Beads root does not match authority.rootTaskId');
  }
  if (!authority.tasks || typeof authority.tasks !== 'object') {
    reject('authoritative Beads tasks are required');
  }
  if (!authority.blockingDependencies || typeof authority.blockingDependencies !== 'object') {
    reject('authoritative Beads blocking dependencies are required');
  }
  return authority;
}

function deriveAuthoritativePlan(
  authority,
  { allowVerifyStage = false, allowPartialClosure = false, closureEvidence } = {},
) {
  const visited = new Set();
  const active = new Set();
  const orderedTaskIds = [];
  function visit(taskId) {
    if (active.has(taskId)) {
      reject(`authoritative Beads blocks graph contains a cycle at ${taskId}`);
    }
    if (visited.has(taskId)) {
      return;
    }
    const task = authority.tasks[taskId];
    if (!task || task.id !== taskId) {
      reject(`authoritative Beads graph is missing task ${taskId}`);
    }
    active.add(taskId);
    const dependencies = authority.blockingDependencies[taskId] ?? [];
    for (const dependency of dependencies) {
      visit(dependency);
    }
    active.delete(taskId);
    visited.add(taskId);
    orderedTaskIds.push(taskId);
  }
  visit(authority.rootTaskId);

  const verifiedTaskIds = [];
  const coordinatorTaskIds = [];
  const legacyTaskIds = [];
  for (const taskId of orderedTaskIds) {
    const task = authority.tasks[taskId];
    const dependencies = authority.blockingDependencies[taskId] ?? [];
    const coordinatorAuthority = task.labels?.includes(COORDINATOR_AUTHORITY_LABEL) === true;
    if (task.status === 'closed') {
      if (coordinatorAuthority) {
        if (taskId !== authority.rootTaskId || dependencies.length === 0) {
          reject(`${taskId} integration coordinator authority requires the root with blockers`);
        }
        if (!taskHasGuardedClosure(task, closureEvidence, taskId)) {
          reject(
            `${taskId} is closed without exactly one matching guarded coordinator closure note and no stage labels`,
          );
        }
        coordinatorTaskIds.push(taskId);
      } else if (verificationRecords(task).length > 0) {
        if (!taskHasGuardedClosure(task, closureEvidence, taskId)) {
          reject(
            `${taskId} is closed without exactly one matching guarded closure note and no stage labels`,
          );
        }
        verifiedTaskIds.push(taskId);
      } else {
        legacyTaskIds.push(taskId);
      }
    } else if (coordinatorAuthority) {
      const stages = taskStageLabels(task);
      if (
        taskId !== authority.rootTaskId ||
        dependencies.length === 0 ||
        task.status !== 'in_progress' ||
        stages.length !== 0
      ) {
        reject(
          `${taskId} integration coordinator authority requires the in_progress stage-less root with blockers`,
        );
      }
      coordinatorTaskIds.push(taskId);
    } else if (
      taskHasVerifiedEvidence(task, {
        allowVerifyStage,
        allowPartialClosure,
        closureEvidence,
      })
    ) {
      verifiedTaskIds.push(taskId);
    } else {
      reject(
        `authoritative required task ${taskId} must be stage:awaiting-integration before integration closure`,
      );
    }
  }

  const deliveryRequirements = deriveAcceptanceDeliveryRequirements(
    orderedTaskIds.map((taskId) => authority.tasks[taskId]),
  );
  return {
    orderedTaskIds,
    verifiedTaskIds: verifiedTaskIds.sort(),
    coordinatorTaskIds: coordinatorTaskIds.sort(),
    legacyTaskIds: legacyTaskIds.sort(),
    closureTaskIds: orderedTaskIds.filter((taskId) => !legacyTaskIds.includes(taskId)),
    alreadyGuardedTaskIds: orderedTaskIds
      .filter((taskId) => taskHasGuardedClosure(authority.tasks[taskId], closureEvidence, taskId))
      .sort(),
    tasks: authority.tasks,
    deliveryRequirements,
  };
}

async function validateAndroid(
  repo,
  android,
  integrationHead,
  toolRunner = defaultAndroidToolRunner,
  androidSdkRoot = process.env.ANDROID_SDK_ROOT ?? process.env.ANDROID_HOME,
) {
  if (!android || typeof android !== 'object') {
    reject('Android-affecting integration requires android evidence');
  }
  if (requireCommit(android.sourceHead, 'android.sourceHead') !== integrationHead) {
    reject('android.sourceHead must match the integration head');
  }
  validateGate(android.assembleGate, integrationHead, 'android.assembleGate');
  if (!android.assembleGate.command.includes('assembleDebug')) {
    reject('android.assembleGate.command must include assembleDebug');
  }

  const outputMetadataPath = resolveInsideRepo(
    repo,
    android.outputMetadataPath,
    'android.outputMetadataPath',
  );
  const debugApkPath = resolveInsideRepo(repo, android.debugApkPath, 'android.debugApkPath');
  const immutableApkPath = resolveInsideRepo(
    repo,
    android.immutableApkPath,
    'android.immutableApkPath',
  );
  const latestJsonPath = resolveInsideRepo(repo, android.latestJsonPath, 'android.latestJsonPath');
  const apksigner = await resolveAndroidTool(
    repo,
    android.apksignerPath,
    'android.apksignerPath',
    new Set(['apksigner', 'apksigner.bat', 'apksigner.exe']),
    androidSdkRoot,
  );
  const aapt = await resolveAndroidTool(
    repo,
    android.aaptPath,
    'android.aaptPath',
    new Set(['aapt', 'aapt.exe', 'aapt2', 'aapt2.exe']),
    androidSdkRoot,
  );
  if (
    apksigner.directory !== aapt.directory ||
    apksigner.buildToolsVersion !== aapt.buildToolsVersion
  ) {
    reject('aapt and apksigner must come from the same Android SDK build-tools version');
  }

  const outputMetadata = await readJson(outputMetadataPath, 'Android output metadata');
  const output = outputMetadata.elements?.[0];
  if (!output || !Number.isInteger(output.versionCode) || typeof output.versionName !== 'string') {
    reject('Android output metadata lacks versionName/versionCode');
  }
  const latest = await readJson(latestJsonPath, 'Android latest.json');
  const debugApk = await validateApkStructure(debugApkPath, 'app-debug.apk');
  const immutableApk = await validateApkStructure(immutableApkPath, 'immutable APK');
  if (debugApk.sha256 !== immutableApk.sha256 || debugApk.sizeBytes !== immutableApk.sizeBytes) {
    reject('app-debug.apk and immutable published APK do not match');
  }
  if (
    latest.versionName !== output.versionName ||
    latest.versionCode !== output.versionCode ||
    latest.sha256 !== immutableApk.sha256 ||
    latest.sizeBytes !== immutableApk.sizeBytes ||
    latest.apkFile !== path.basename(immutableApkPath)
  ) {
    reject('latest.json does not match output metadata and the immutable APK');
  }
  const immutableName = path.basename(immutableApkPath);
  if (
    immutableName === 'app-debug.apk' ||
    !immutableName.includes(String(output.versionCode)) ||
    !immutableName.includes(immutableApk.sha256.slice(0, 12))
  ) {
    reject('published APK is not an immutable version/hash-qualified artifact');
  }
  const apksignerVersion = requireString(
    toolRunner(apksigner.path, ['version'], 'apksigner version').trim(),
    'apksigner version output',
  );
  const aaptVersion = requireString(
    toolRunner(aapt.path, ['version'], 'aapt version').trim(),
    'aapt version output',
  );
  const debugCertificate = readCertificateDigest(
    toolRunner(apksigner.path, ['verify', '--print-certs', debugApkPath], 'debug APK apksigner'),
    'debug APK apksigner output',
  );
  const immutableCertificate = readCertificateDigest(
    toolRunner(
      apksigner.path,
      ['verify', '--print-certs', immutableApkPath],
      'immutable APK apksigner',
    ),
    'immutable APK apksigner output',
  );
  if (debugCertificate !== immutableCertificate) {
    reject('debug and immutable APK signing certificates do not match');
  }
  const debugManifest = parseAaptBadging(
    toolRunner(aapt.path, ['dump', 'badging', debugApkPath], 'debug APK aapt'),
    'debug APK aapt output',
  );
  const immutableManifest = parseAaptBadging(
    toolRunner(aapt.path, ['dump', 'badging', immutableApkPath], 'immutable APK aapt'),
    'immutable APK aapt output',
  );
  if (
    debugManifest.packageName !== GYMCOACH_ANDROID_PACKAGE ||
    immutableManifest.packageName !== GYMCOACH_ANDROID_PACKAGE ||
    JSON.stringify(debugManifest) !== JSON.stringify(immutableManifest)
  ) {
    reject('aapt package/version evidence does not match the GymCoach APK pair');
  }
  if (
    debugManifest.versionName !== output.versionName ||
    debugManifest.versionCode !== output.versionCode
  ) {
    reject('APK manifest version does not match output metadata');
  }
  await stat(debugApkPath);
  await stat(immutableApkPath);
  return {
    versionName: output.versionName,
    versionCode: output.versionCode,
    sha256: immutableApk.sha256,
    sizeBytes: immutableApk.sizeBytes,
    signingCertificateSha256: immutableCertificate,
    apkFile: immutableName,
    buildToolsVersion: apksigner.buildToolsVersion,
    apksignerVersion,
    aaptVersion,
  };
}

function legacyVerifiedCommits(task) {
  return [
    ...String(task?.notes ?? '').matchAll(
      /Immutable verification evidence:[^\r\n]*verified-commit\s+([0-9a-f]{40})/gi,
    ),
  ].map((match) => match[1].toLowerCase());
}

function validateLegacyAudit(repo, legacyClosedTasks, integrationHead, expectedTasks = []) {
  const expectedTaskIds = expectedTasks.map((task) => task.id).sort();
  const expectedTaskById = new Map(expectedTasks.map((task) => [task.id, task]));
  if (legacyClosedTasks === undefined) {
    if (expectedTaskIds.length > 0) {
      reject(`legacyClosedTasks must include ${expectedTaskIds.join(', ')}`);
    }
    return [];
  }
  if (!Array.isArray(legacyClosedTasks)) {
    reject('legacyClosedTasks must be an array');
  }
  const warnings = [];
  const auditedTaskIds = [];
  for (const entry of legacyClosedTasks) {
    const id = requireString(entry.id, 'legacyClosedTasks.id');
    auditedTaskIds.push(id);
    requireString(entry.note, `${id}.legacy note`);
    if (entry.auditStatus === 'missing-from-integration') {
      reject(`legacy closed task ${id} is missing from the integration head`);
    }
    if (!['integrated', 'behavior-equivalent'].includes(entry.auditStatus)) {
      reject(
        `${id}.auditStatus must be integrated, behavior-equivalent, or missing-from-integration`,
      );
    }
    const commit = requireGitCommit(
      repo,
      requireCommit(entry.verifiedCommit, `${id}.verifiedCommit`),
    );
    const recordedLegacyCommits = legacyVerifiedCommits(expectedTaskById.get(id));
    if (recordedLegacyCommits.length > 0 && !recordedLegacyCommits.includes(commit)) {
      reject(`${id}.verifiedCommit does not match recorded legacy immutable verification notes`);
    }
    if (entry.auditStatus === 'integrated' && !isAncestor(repo, commit, integrationHead)) {
      reject(`legacy closed task ${id} is marked integrated but its commit is absent`);
    }
    if (entry.auditStatus === 'behavior-equivalent') {
      validateBehaviorEquivalentMapping(repo, entry, integrationHead, {
        subject: `legacy closed task ${id}`,
        fieldPrefix: `${id}.legacyAudit`,
      });
    }
    warnings.push(
      `legacy closed task ${id} audited as ${entry.auditStatus}; history was not rewritten`,
    );
  }
  const actualTaskIds = [...new Set(auditedTaskIds)].sort();
  if (actualTaskIds.length !== auditedTaskIds.length) {
    reject('legacyClosedTasks contains a duplicate task');
  }
  if (JSON.stringify(actualTaskIds) !== JSON.stringify(expectedTaskIds)) {
    reject('legacyClosedTasks does not match authoritative closed Beads blockers');
  }
  return warnings;
}

export async function validateIntegrationEvidence(
  manifest,
  {
    repo = process.cwd(),
    beadsAuthority,
    allowPartialClosure = false,
    androidToolRunner,
    androidSdkRoot,
  } = {},
) {
  const repository = path.resolve(repo);
  if (manifest?.schemaVersion !== 1) {
    reject('schemaVersion must be 1');
  }
  const rootTaskId = requireString(manifest.authority?.rootTaskId, 'authority.rootTaskId');
  const authority = normalizeAuthority(
    beadsAuthority ?? (await loadBeadsAuthority(repository, rootTaskId)),
    rootTaskId,
  );
  const coordinatorTaskIds = Object.values(authority.tasks)
    .filter((task) => task.labels?.includes(COORDINATOR_AUTHORITY_LABEL))
    .map((task) => task.id);
  const closureEvidence = {
    mode: manifest.mode,
    head:
      manifest.mode === 'integration'
        ? manifest.integration?.head
        : manifest.tasks?.[0]?.verified?.commit,
    delivery: manifest.delivery,
    coordinatorTaskIds,
  };
  const authoritativePlan = deriveAuthoritativePlan(authority, {
    allowVerifyStage: manifest.mode === 'no-runtime-artifact',
    allowPartialClosure,
    closureEvidence,
  });
  if (!Array.isArray(manifest.tasks) || manifest.tasks.length === 0) {
    reject('tasks must contain at least one task');
  }
  const taskIds = new Set();
  const verifiedTasks = manifest.tasks.map((task) => {
    const verified = validateVerifiedTask(repository, task, authority.tasks[task.id]);
    if (taskIds.has(verified.id)) {
      reject(`duplicate task ${verified.id}`);
    }
    taskIds.add(verified.id);
    return { task, verified };
  });

  if (manifest.mode === 'no-runtime-artifact') {
    if (verifiedTasks.length !== 1) {
      reject('no-runtime-artifact mode closes exactly one independently verified task');
    }
    const [{ task, verified }] = verifiedTasks;
    if (
      authoritativePlan.orderedTaskIds.length !== 1 ||
      authoritativePlan.verifiedTaskIds[0] !== verified.id ||
      rootTaskId !== verified.id
    ) {
      reject('no-runtime-artifact authority must contain only the exact verified root task');
    }
    if (currentHead(repository) !== verified.commit) {
      reject('no-runtime-artifact closure must run at the verified commit');
    }
    validateNoRuntimeArtifact(repository, task, verified);
    validateDelivery(manifest.delivery, {
      integrationHead: undefined,
      androidRequired: false,
      requirements: { installed: false, deployed: false },
    });
    for (const stageName of DELIVERY_STAGES) {
      if (
        manifest.delivery[stageName].required ||
        manifest.delivery[stageName].status !== 'not-required'
      ) {
        reject(`no-runtime-artifact delivery.${stageName} must be not-required`);
      }
    }
    return {
      mode: manifest.mode,
      rootTaskId,
      taskIds: [verified.id],
      closureTaskIds: [verified.id],
      coordinatorTaskIds: [],
      alreadyGuardedTaskIds: authoritativePlan.alreadyGuardedTaskIds,
      authoritativeTaskStates: Object.fromEntries(
        authoritativePlan.closureTaskIds.map((taskId) => [taskId, authority.tasks[taskId]]),
      ),
      head: verified.commit,
      delivery: manifest.delivery,
      warnings: [],
    };
  }

  if (manifest.mode !== 'integration') {
    reject('mode must be integration or no-runtime-artifact');
  }
  if (!manifest.integration || typeof manifest.integration !== 'object') {
    reject('integration evidence is required');
  }
  const integrationHead = requireGitCommit(
    repository,
    requireCommit(manifest.integration.head, 'integration.head'),
  );
  if (currentHead(repository) !== integrationHead) {
    reject('integration guard must run at integration.head');
  }
  const branch = requireString(manifest.integration.branch, 'integration.branch');
  if (['main', 'master'].includes(branch) || currentBranch(repository) !== branch) {
    reject('integration.branch must be the current dedicated non-main branch');
  }
  validateGate(manifest.integration.combinedGate, integrationHead, 'integration.combinedGate');
  validateIntegrationReview(manifest.integration.review, integrationHead);

  if (!Array.isArray(manifest.integration.requiredTaskIds)) {
    reject('integration.requiredTaskIds is required');
  }
  const requiredTaskIds = [
    ...new Set(
      manifest.integration.requiredTaskIds.map((taskId) =>
        requireString(taskId, 'integration.requiredTaskIds entry'),
      ),
    ),
  ].sort();
  const manifestTaskIds = verifiedTasks.map(({ verified }) => verified.id).sort();
  if (
    JSON.stringify(requiredTaskIds) !== JSON.stringify(authoritativePlan.verifiedTaskIds) ||
    JSON.stringify(manifestTaskIds) !== JSON.stringify(authoritativePlan.verifiedTaskIds)
  ) {
    reject('integration manifest is missing or contains an unexpected required task');
  }

  let androidRequired = false;
  const requirements = authoritativePlan.deliveryRequirements;
  const mappings = [];
  for (const { task, verified } of verifiedTasks) {
    if (!['product', 'no-runtime-artifact'].includes(task.classification)) {
      reject(`${verified.id}.classification is invalid`);
    }
    mappings.push(validateIntegrationMapping(repository, task, verified, integrationHead));
    androidRequired ||=
      task.affectsAndroid === true ||
      verified.changedPaths.some(
        (changedPath) =>
          changedPath.startsWith('android/') || changedPath.startsWith('data/android-release/'),
      );
  }

  validateDelivery(manifest.delivery, { integrationHead, androidRequired, requirements });
  const android = androidRequired
    ? await validateAndroid(
        repository,
        manifest.android,
        integrationHead,
        androidToolRunner,
        androidSdkRoot,
      )
    : undefined;
  const warnings = validateLegacyAudit(
    repository,
    manifest.legacyClosedTasks,
    integrationHead,
    authoritativePlan.legacyTaskIds.map((taskId) => authority.tasks[taskId]),
  );
  return {
    mode: manifest.mode,
    rootTaskId,
    taskIds: verifiedTasks.map(({ verified }) => verified.id),
    closureTaskIds: authoritativePlan.closureTaskIds,
    coordinatorTaskIds: authoritativePlan.coordinatorTaskIds,
    alreadyGuardedTaskIds: authoritativePlan.alreadyGuardedTaskIds,
    authoritativeTaskStates: Object.fromEntries(
      authoritativePlan.closureTaskIds.map((taskId) => [taskId, authority.tasks[taskId]]),
    ),
    requirements,
    head: integrationHead,
    branch,
    mappings,
    android,
    delivery: manifest.delivery,
    warnings,
  };
}

function parseArguments(argv) {
  const result = { repo: process.cwd() };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--manifest') {
      result.manifest = argv[++index];
    } else if (argument === '--repo') {
      result.repo = argv[++index];
    } else {
      reject(`unknown argument ${argument}`);
    }
  }
  if (!result.manifest) {
    reject('usage: node scripts/check-integration-evidence.mjs --manifest PATH [--repo PATH]');
  }
  return result;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const manifestPath = path.resolve(options.repo, options.manifest);
    const manifest = await readJson(manifestPath, 'integration manifest');
    const result = await validateIntegrationEvidence(manifest, { repo: options.repo });
    console.log(`Integration evidence accepted for ${result.taskIds.join(', ')} at ${result.head}`);
    for (const warning of result.warnings) {
      console.warn(`WARNING: ${warning}`);
    }
  } catch (error) {
    console.error(`Integration evidence rejected: ${error.message}`);
    process.exitCode = 1;
  }
}
