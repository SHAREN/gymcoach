import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const DEFAULT_GITHUB_REPOSITORY = 'SHAREN/gymcoach';
export const DEFAULT_GITHUB_BRANCH = 'main';

const MANAGED_LABEL_PREFIXES = ['beads:', 'stage:', 'type:', 'priority:', 'area:'];
const LABEL_COLORS = {
  'beads:open': '1d76db',
  'beads:in-progress': 'fbca04',
  'beads:blocked': 'd93f0b',
  'beads:closed': '0e8a16',
};

function fail(message) {
  throw new Error(message);
}

function run(command, args, { cwd, input, allowFailure = false } = {}) {
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

function runJson(command, args, options = {}) {
  const output = run(command, args, options).stdout.trim();
  try {
    return output === '' ? null : JSON.parse(output);
  } catch (error) {
    fail(`${command} returned invalid JSON: ${error.message}`);
  }
}

function markerFor(taskId) {
  return `<!-- beads-task-id: ${taskId} -->`;
}

export function sanitizeMirrorText(value, maxLength = 4000) {
  if (typeof value !== 'string') {
    return '';
  }
  let sanitized = value
    .replace(/(?:\b[A-Za-z]:[\\/]|\\\\)[^\r\n]*/g, '[PRIVATE_PATH]')
    .replace(/\/(?:home|root|tmp|Users)\/[^\r\n]*/g, '[PRIVATE_PATH]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]')
    .replace(
      /\b(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})\b/g,
      '[PRIVATE_ADDRESS]',
    )
    .replace(
      /\b(?:gh[pousr]_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,}|sk-[A-Za-z0-9_-]{8,})\b/g,
      '[REDACTED_TOKEN]',
    )
    .replace(/\b(authorization\s+)?bearer\s+[A-Za-z0-9._~+/=-]{6,}/gi, '$1Bearer [REDACTED]')
    .replace(
      /\b(password|passwd|passphrase|token|secret|authorization|cookie|api[_ -]?key|access[_ -]?key|client[_ -]?secret|private[_ -]?key|credentials?)\s*[:=][^\r\n]*/gi,
      '$1=[REDACTED]',
    )
    .replace(
      /\b(serial(?:[_ -]?(?:number|no|id))?|device(?:[_ -]?(?:id|identifier|serial))?|physical[_ -]?serial|hardware[_ -]?serial|adb[_ -]?serial|udid|imei|android[_ -]?id)\s*[:=][^\r\n]*/gi,
      '$1=[DEVICE]',
    )
    .replace(/\badb\s+-s\s+\S+/gi, 'adb -s [DEVICE]')
    .replace(/\bemulator-\d+\b/gi, '[DEVICE]')
    .replace(/\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b/gi, '[DEVICE]')
    .replace(/\b\d{14,17}\b/g, '[DEVICE]')
    .replace(
      /\b(?=[A-Z0-9-]{10,40}\b)(?=[A-Z0-9-]*[A-Z])(?=[A-Z0-9-]*\d)(?:[A-Z0-9]{2,}-)+[A-Z0-9]{2,}\b/g,
      '[DEVICE]',
    )
    .replace(
      /\b(?=[A-Za-z0-9]{10,32}\b)(?=[A-Za-z0-9]*[A-Za-z])(?=[A-Za-z0-9]*\d)[A-Za-z0-9]+\b/g,
      '[DEVICE]',
    )
    .replace(/\r\n/g, '\n')
    .trim();
  if (sanitized.length > maxLength) {
    sanitized = `${sanitized.slice(0, maxLength - 18)}\n[TRUNCATED SAFELY]`;
  }
  return sanitized;
}

export function beadsIdsFromIssue(issue) {
  const body = issue?.body ?? '';
  const ids = new Set();
  for (const match of body.matchAll(/<!-- beads-task-id:\s*([a-z0-9]+(?:[.-][a-z0-9]+)*)\s*-->/g)) {
    ids.add(match[1]);
  }
  for (const match of body.matchAll(/Beads task:\s*`([a-z0-9]+(?:[.-][a-z0-9]+)*)`/g)) {
    ids.add(match[1]);
  }
  for (const match of body.matchAll(/Beads source of truth:\s*`([a-z0-9]+(?:[.-][a-z0-9]+)*)`/g)) {
    ids.add(match[1]);
  }
  return [...ids];
}

export function indexIssuesByBeadsId(issues) {
  const index = new Map();
  for (const issue of issues) {
    if (issue.pull_request) {
      continue;
    }
    for (const taskId of beadsIdsFromIssue(issue)) {
      const matches = index.get(taskId) ?? [];
      matches.push(issue);
      index.set(taskId, matches);
    }
  }
  return index;
}

function normalizedStatus(status) {
  return status === 'in_progress' ? 'in-progress' : status;
}

function taskStage(task) {
  return task.labels?.find((label) => label.startsWith('stage:')) ?? 'stage:in-progress';
}

function taskLabel(task, prefix, fallback) {
  return task.labels?.find((label) => label.startsWith(prefix)) ?? fallback;
}

function managedLabelsFor(task) {
  return [
    `beads:${normalizedStatus(task.status)}`,
    taskStage(task),
    taskLabel(task, 'type:', `type:${task.issue_type}`),
    taskLabel(task, 'priority:', `priority:P${task.priority}`),
    taskLabel(task, 'area:', 'area:unspecified'),
  ];
}

function isManagedLabel(label) {
  return MANAGED_LABEL_PREFIXES.some((prefix) => label.startsWith(prefix));
}

function evidenceLines(evidence) {
  if (!evidence || typeof evidence !== 'object') {
    return ['No sanitized lifecycle evidence was supplied for this mirror update.'];
  }
  const lines = [];
  if (evidence.kind === 'verification') {
    lines.push(`- Verified base: \`${sanitizeMirrorText(evidence.verifiedBase, 80)}\``);
    lines.push(`- Verified commit: \`${sanitizeMirrorText(evidence.verifiedCommit, 80)}\``);
    lines.push(
      `- Artifact impact: ${sanitizeMirrorText(evidence.artifactImpact, 80) || 'unspecified'}`,
    );
    lines.push(`- Verification gate: ${sanitizeMirrorText(evidence.gate, 300)}`);
  } else if (evidence.kind === 'integration') {
    lines.push(`- Integration head: \`${sanitizeMirrorText(evidence.integrationHead, 80)}\``);
    for (const [stage, status] of Object.entries(evidence.delivery ?? {})) {
      lines.push(
        `- ${sanitizeMirrorText(String(stage), 80)}: ${sanitizeMirrorText(String(status), 80)}`,
      );
    }
    if (evidence.android) {
      const versionName = sanitizeMirrorText(String(evidence.android.versionName ?? ''), 80);
      const versionCode = sanitizeMirrorText(String(evidence.android.versionCode ?? ''), 80);
      const sizeBytes = sanitizeMirrorText(String(evidence.android.sizeBytes ?? ''), 80);
      lines.push(`- Android artifact: ${versionName} (${versionCode}), ${sizeBytes} bytes`);
      lines.push(
        `- APK SHA-256: \`${sanitizeMirrorText(String(evidence.android.sha256 ?? ''), 80)}\``,
      );
      lines.push(
        `- Signing certificate SHA-256: \`${sanitizeMirrorText(String(evidence.android.signingCertificateSha256 ?? ''), 80)}\``,
      );
      lines.push(
        `- Immutable APK: \`${sanitizeMirrorText(String(evidence.android.apkFile ?? ''), 200)}\``,
      );
    }
  } else if (evidence.kind === 'no-runtime-artifact') {
    lines.push(`- Verified commit: \`${sanitizeMirrorText(evidence.verifiedCommit, 80)}\``);
    lines.push('- Runtime artifact: explicitly not required by independent review.');
  } else {
    lines.push('Evidence kind was not recognized; no free-form evidence was mirrored.');
  }
  return lines;
}

function guardedClosureRecorded(task) {
  return /Guarded (?:integration(?: root coordination)?|no-runtime-artifact) closure/.test(
    task.notes ?? '',
  );
}

export function buildIssuePayload(task, existingIssue, evidence) {
  const stage = taskStage(task);
  const type = taskLabel(task, 'type:', `type:${task.issue_type}`);
  const priority = taskLabel(task, 'priority:', `priority:P${task.priority}`);
  const area = taskLabel(task, 'area:', 'area:unspecified');
  if (task.status === 'closed' && !guardedClosureRecorded(task)) {
    fail(`${task.id} is closed without guarded integration/no-runtime closure evidence`);
  }
  const preservedLabels = (existingIssue?.labels ?? [])
    .map((label) => (typeof label === 'string' ? label : label.name))
    .filter((label) => label && !isManagedLabel(label));
  const labels = [...new Set([...preservedLabels, ...managedLabelsFor(task)])].sort();
  const sanitizedTitle = sanitizeMirrorText(task.title, 200).replace(/\s+/g, ' ').trim();
  const body = `${markerFor(task.id)}

> Beads is authoritative. This GitHub issue is an idempotent sanitized mirror.

| Field | Value |
| --- | --- |
| Beads ID | \`${task.id}\` |
| Status | \`${task.status}\` |
| Stage | \`${stage}\` |
| Type | \`${type}\` |
| Priority | \`${priority}\` |
| Area | \`${area}\` |

## Summary

${sanitizeMirrorText(task.description) || 'No mirror-safe summary is available.'}

## Acceptance criteria

${sanitizeMirrorText(task.acceptance_criteria) || 'No acceptance criteria recorded.'}

## Sanitized lifecycle evidence

${evidenceLines(evidence).join('\n')}

Raw logs, credentials, private paths, device identifiers, and personal data are intentionally excluded.
`;
  return {
    title: `[${task.id}] ${sanitizedTitle || 'Sanitized Beads task'}`,
    body,
    labels,
    state: task.status === 'closed' ? 'closed' : 'open',
    state_reason: task.status === 'closed' ? 'completed' : undefined,
  };
}

export function selectBackfillTasks(tasks) {
  return tasks.filter((task) => ['open', 'in_progress', 'blocked'].includes(task.status));
}

function issueNumberFromExternalRef(externalRef, repository) {
  if (typeof externalRef !== 'string') {
    return undefined;
  }
  const escapedRepository = repository.replace('/', '\\/');
  const match = externalRef.match(
    new RegExp(`^https://github\\.com/${escapedRepository}/issues/(\\d+)$`),
  );
  return match ? Number(match[1]) : undefined;
}

function issueUrl(repository, number) {
  return `https://github.com/${repository}/issues/${number}`;
}

export function issueEqual(issue, payload) {
  const currentLabels = (issue.labels ?? [])
    .map((label) => (typeof label === 'string' ? label : label.name))
    .filter(Boolean)
    .sort();
  return (
    issue.title === payload.title &&
    issue.body === payload.body &&
    issue.state === payload.state &&
    JSON.stringify(currentLabels) === JSON.stringify(payload.labels)
  );
}

function listGitHubIssues(repository, cwd) {
  const pages = runJson(
    'gh',
    [
      'api',
      '--paginate',
      '--slurp',
      '--method',
      'GET',
      `repos/${repository}/issues`,
      '-f',
      'state=all',
      '-f',
      'per_page=100',
    ],
    { cwd },
  );
  return pages.flat();
}

function listGitHubLabels(repository, cwd) {
  const pages = runJson(
    'gh',
    ['api', '--paginate', '--slurp', `repos/${repository}/labels?per_page=100`],
    { cwd },
  );
  return pages.flat();
}

function ensureLabels(repository, labels, { cwd, dryRun }) {
  const existing = new Set(listGitHubLabels(repository, cwd).map((label) => label.name));
  for (const label of labels) {
    if (existing.has(label)) {
      continue;
    }
    if (dryRun) {
      console.log(`[dry-run] create GitHub label ${label}`);
      continue;
    }
    const color = LABEL_COLORS[label] ?? 'ededed';
    run('gh', ['api', '--method', 'POST', `repos/${repository}/labels`, '--input', '-'], {
      cwd,
      input: JSON.stringify({
        name: label,
        color,
        description: 'Managed by the GymCoach Beads mirror.',
      }),
    });
  }
}

function readBeadsTask(taskId, cwd) {
  const tasks = runJson('bd', ['show', taskId, '--json'], { cwd });
  if (!Array.isArray(tasks) || tasks.length !== 1) {
    fail(`Beads task ${taskId} was not found`);
  }
  return tasks[0];
}

function persistExternalRef(task, url, { cwd, dryRun }) {
  if (task.external_ref === url) {
    return;
  }
  if (dryRun) {
    console.log(`[dry-run] persist ${url} to ${task.id}.external_ref`);
    return;
  }
  run('bd', ['update', task.id, '--external-ref', url], { cwd });
}

export function planIssueMatch(task, issues, repository) {
  const index = indexIssuesByBeadsId(issues);
  const markerMatches = index.get(task.id) ?? [];
  for (const issue of markerMatches) {
    const issueTaskIds = beadsIdsFromIssue(issue).sort();
    if (issueTaskIds.length > 1) {
      fail(
        `GitHub issue #${issue.number} contains multiple Beads task IDs: ${issueTaskIds.join(', ')}`,
      );
    }
  }
  const externalNumber = issueNumberFromExternalRef(task.external_ref, repository);
  if (
    typeof task.external_ref === 'string' &&
    task.external_ref.trim() !== '' &&
    externalNumber === undefined
  ) {
    fail(`${task.id}.external_ref is not an exact ${repository} GitHub issue URL`);
  }
  const externalIssue = externalNumber
    ? issues.find((issue) => issue.number === externalNumber && !issue.pull_request)
    : undefined;
  if (externalNumber && !externalIssue) {
    fail(`${task.id}.external_ref points to missing GitHub issue #${externalNumber}`);
  }
  if (externalIssue) {
    const externalTaskIds = beadsIdsFromIssue(externalIssue).sort();
    if (externalTaskIds.length > 1) {
      fail(
        `GitHub issue #${externalIssue.number} contains multiple Beads task IDs: ${externalTaskIds.join(', ')}`,
      );
    }
    if (!externalTaskIds.includes(task.id)) {
      fail(`${task.id}.external_ref points to an issue without the exact Beads ID marker`);
    }
  }
  const matches = new Map(markerMatches.map((issue) => [issue.number, issue]));
  if (externalIssue) {
    matches.set(externalIssue.number, externalIssue);
  }
  if (matches.size > 1) {
    fail(
      `${task.id} has duplicate GitHub mirrors: ${[...matches.keys()].map((n) => `#${n}`).join(', ')}`,
    );
  }
  return [...matches.values()][0];
}

export async function mirrorTaskById({
  taskId,
  repository = DEFAULT_GITHUB_REPOSITORY,
  cwd = process.cwd(),
  dryRun = false,
  evidence,
  issues,
  task: suppliedTask,
  adapters = {},
}) {
  const readTask = adapters.readTask ?? readBeadsTask;
  const listIssues = adapters.listIssues ?? listGitHubIssues;
  const ensureMirrorLabels = adapters.ensureLabels ?? ensureLabels;
  const persistMirrorExternalRef = adapters.persistExternalRef ?? persistExternalRef;
  const createIssue =
    adapters.createIssue ??
    ((payload) =>
      runJson('gh', ['api', '--method', 'POST', `repos/${repository}/issues`, '--input', '-'], {
        cwd,
        input: JSON.stringify(payload),
      }));
  const updateIssue =
    adapters.updateIssue ??
    ((issueNumber, payload) =>
      runJson(
        'gh',
        ['api', '--method', 'PATCH', `repos/${repository}/issues/${issueNumber}`, '--input', '-'],
        { cwd, input: JSON.stringify(payload) },
      ));
  const task = suppliedTask ?? readTask(taskId, cwd);
  const availableIssues = issues ?? listIssues(repository, cwd);
  const existingIssue = planIssueMatch(task, availableIssues, repository);
  const payload = buildIssuePayload(task, existingIssue, evidence);
  ensureMirrorLabels(repository, payload.labels.filter(isManagedLabel), { cwd, dryRun });

  if (dryRun) {
    const url = existingIssue
      ? (existingIssue.html_url ?? issueUrl(repository, existingIssue.number))
      : undefined;
    if (url) {
      await persistMirrorExternalRef(task, url, { cwd, dryRun: true });
    }
    console.log(
      `[dry-run] ${existingIssue ? `update #${existingIssue.number}` : 'create issue'} for ${task.id}`,
    );
    return {
      taskId: task.id,
      action: existingIssue ? 'update' : 'create',
      issueNumber: existingIssue?.number,
      url,
      externalRefAction: existingIssue
        ? task.external_ref === url
          ? 'unchanged'
          : 'persist'
        : 'persist-after-create',
      dryRun: true,
    };
  }

  let issue;
  if (!existingIssue) {
    issue = await createIssue(payload);
  } else if (issueEqual(existingIssue, payload)) {
    issue = existingIssue;
  } else {
    issue = await updateIssue(existingIssue.number, payload);
  }
  const url = issue.html_url ?? issueUrl(repository, issue.number);
  await persistMirrorExternalRef(task, url, { cwd, dryRun: false });
  return {
    taskId: task.id,
    action: existingIssue ? 'update' : 'create',
    issueNumber: issue.number,
    url,
  };
}

function readBackfillTasks(cwd) {
  const tasks = runJson(
    'bd',
    ['list', '--status', 'open,in_progress,blocked', '--limit', '0', '--json'],
    { cwd },
  );
  return selectBackfillTasks(tasks);
}

export function summarizeMirrorResults(results) {
  const failures = results.filter((result) => result.status === 'failed');
  return { total: results.length, failures: failures.length, ok: failures.length === 0 };
}

function parseArguments(argv) {
  const options = {
    repository: DEFAULT_GITHUB_REPOSITORY,
    cwd: process.cwd(),
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--task') {
      options.taskId = argv[++index];
    } else if (argument === '--backfill') {
      options.backfill = true;
    } else if (argument === '--repository') {
      options.repository = argv[++index];
    } else if (argument === '--repo') {
      options.cwd = argv[++index];
    } else if (argument === '--evidence-file') {
      options.evidenceFile = argv[++index];
    } else if (argument === '--dry-run') {
      options.dryRun = true;
    } else {
      fail(`unknown argument ${argument}`);
    }
  }
  if (Boolean(options.taskId) === Boolean(options.backfill)) {
    fail('select exactly one of --task TASK-ID or --backfill');
  }
  return options;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const evidence = options.evidenceFile
      ? JSON.parse(await readFile(path.resolve(options.cwd, options.evidenceFile), 'utf8'))
      : undefined;
    run('gh', ['auth', 'status', '--hostname', 'github.com'], { cwd: options.cwd });
    const issues = listGitHubIssues(options.repository, options.cwd);
    const taskIds = options.backfill
      ? readBackfillTasks(options.cwd).map((task) => task.id)
      : [options.taskId];
    const results = [];
    for (const taskId of taskIds) {
      try {
        const result = await mirrorTaskById({
          taskId,
          repository: options.repository,
          cwd: options.cwd,
          dryRun: options.dryRun,
          evidence,
          issues,
        });
        results.push({ status: 'ok', ...result });
      } catch (error) {
        results.push({ status: 'failed', taskId, error: error.message });
        console.error(`GitHub mirror partial failure for ${taskId}: ${error.message}`);
      }
    }
    const summary = summarizeMirrorResults(results);
    console.log(JSON.stringify({ summary, results }, null, 2));
    if (!summary.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`GitHub mirror failed: ${error.message}`);
    process.exitCode = 1;
  }
}
