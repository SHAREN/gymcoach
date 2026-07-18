import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { validateIntegrationEvidence } from './check-integration-evidence.mjs';
import { DEFAULT_GITHUB_REPOSITORY, mirrorTaskById } from './sync-beads-github.mjs';

function fail(message) {
  throw new Error(message);
}

function runBd(repo, args, { capture = false } = {}) {
  const result = spawnSync('bd', args, {
    cwd: repo,
    encoding: capture ? 'utf8' : undefined,
    stdio: capture ? 'pipe' : 'inherit',
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    fail(`bd ${args.join(' ')} failed${result.error ? `: ${result.error.message}` : ''}`);
  }
  return result.stdout;
}

function parseArguments(argv) {
  const options = { repo: process.cwd(), dryRun: false, mirrorOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--manifest') {
      options.manifest = argv[++index];
    } else if (argument === '--repo') {
      options.repo = argv[++index];
    } else if (argument === '--dry-run') {
      options.dryRun = true;
    } else if (argument === '--mirror-only') {
      options.mirrorOnly = true;
    } else {
      fail(`unknown argument ${argument}`);
    }
  }
  if (!options.manifest) {
    fail(
      'usage: node scripts/close-integrated-tasks.mjs --manifest PATH [--repo PATH] [--dry-run] [--mirror-only]',
    );
  }
  return options;
}

function readTask(repo, taskId) {
  return JSON.parse(runBd(repo, ['show', taskId, '--json'], { capture: true }))[0];
}

export function buildClosureNote(evidence, taskId) {
  if (evidence.mode === 'integration') {
    return `${evidence.coordinatorTaskIds.includes(taskId) ? 'Guarded integration root coordination closure' : 'Guarded integration closure'}: head ${evidence.head}; integrated=${evidence.delivery.integrated.status}; published=${evidence.delivery.published.status}; installed=${evidence.delivery.installed.status}; deployed=${evidence.delivery.deployed.status}.`;
  }
  return `Guarded no-runtime-artifact closure at verified commit ${evidence.head}.`;
}

export function buildClosureReason(evidence) {
  return evidence.mode === 'integration'
    ? 'Integrated evidence and required artifact gates passed'
    : 'Explicit no-runtime-artifact exception passed isolated verification';
}

function exactNoteCount(notes, expectedNote) {
  return String(notes ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line === expectedNote).length;
}

function taskStageLabels(issue) {
  return issue.labels?.filter((label) => label.startsWith('stage:')) ?? [];
}

export function planClosureTaskAction({ evidence, taskId, issue }) {
  if (!issue) fail(`${taskId} is absent from authoritative Beads state`);
  const expectedNote = buildClosureNote(evidence, taskId);
  const noteCount = exactNoteCount(issue.notes, expectedNote);
  const stageLabels = taskStageLabels(issue);
  const alreadyGuarded = new Set(evidence.alreadyGuardedTaskIds).has(taskId);

  if (alreadyGuarded || issue.status === 'closed') {
    if (issue.status !== 'closed' || noteCount !== 1 || stageLabels.length > 0) {
      fail(`${taskId} must have exactly one matching guarded closure note before it is skipped`);
    }
    return { taskId, action: 'skip', note: expectedNote, reason: buildClosureReason(evidence) };
  }

  if (issue.status !== 'in_progress') {
    fail(`${taskId} has invalid status ${issue.status} before guarded closure`);
  }
  if (noteCount > 1) {
    fail(`${taskId} has duplicate matching guarded closure notes`);
  }
  if (noteCount === 1) {
    if (stageLabels.length > 0) {
      fail(`${taskId} has a guarded closure note but still has stage labels`);
    }
    return {
      taskId,
      action: 'close-only',
      note: expectedNote,
      reason: buildClosureReason(evidence),
    };
  }

  if (evidence.coordinatorTaskIds.includes(taskId)) {
    if (stageLabels.length > 0) {
      fail(`${taskId} coordinator must be stage-less before guarded closure`);
    }
  } else {
    const expectedLabel = evidence.mode === 'integration' ? 'stage:verified' : 'stage:verify';
    if (stageLabels.length !== 1 || stageLabels[0] !== expectedLabel) {
      fail(`${taskId} must be in_progress with only ${expectedLabel} before guarded closure`);
    }
  }
  return {
    taskId,
    action: 'update-and-close',
    note: expectedNote,
    reason: buildClosureReason(evidence),
    stageLabels,
  };
}

export function planBeadsClosure({ evidence, repo, adapters = {} }) {
  const read = adapters.readTask ?? readTask;
  return evidence.closureTaskIds.map((taskId) =>
    planClosureTaskAction({ evidence, taskId, issue: read(repo, taskId) }),
  );
}

export async function executeBeadsClosure({ evidence, repo, adapters = {} }) {
  const plan = planBeadsClosure({ evidence, repo, adapters });
  const updateTask =
    adapters.updateTask ??
    ((taskRepo, action) => {
      const updateArgs = ['update', action.taskId, '--append-notes', action.note];
      for (const label of action.stageLabels) updateArgs.push('--remove-label', label);
      runBd(taskRepo, updateArgs);
    });
  const closeTask =
    adapters.closeTask ??
    ((taskRepo, action) => runBd(taskRepo, ['close', action.taskId, '--reason', action.reason]));

  for (const action of plan) {
    if (action.action === 'skip') continue;
    if (action.action === 'update-and-close') await updateTask(repo, action);
    await closeTask(repo, action);
  }
  return plan;
}

export function buildMirrorEvidence(evidence) {
  return evidence.mode === 'integration'
    ? {
        kind: 'integration',
        integrationHead: evidence.head,
        delivery: Object.fromEntries(
          Object.entries(evidence.delivery).map(([stage, value]) => [stage, value.status]),
        ),
        android: evidence.android,
      }
    : {
        kind: 'no-runtime-artifact',
        verifiedCommit: evidence.head,
      };
}

export function closureExecutionPlan({ dryRun, mirrorOnly }) {
  return {
    mutateBeads: !dryRun && !mirrorOnly,
    runMirrors: !dryRun || mirrorOnly,
    mirrorDryRun: dryRun,
  };
}

export async function mirrorClosureTasks({
  evidence,
  repo,
  dryRun = false,
  mirrorOnly = false,
  mirrorTask = mirrorTaskById,
}) {
  const mirrorEvidence = buildMirrorEvidence(evidence);
  const mirrorFailures = [];
  const results = [];
  for (const taskId of evidence.closureTaskIds) {
    try {
      const result = await mirrorTask({
        taskId,
        repository: DEFAULT_GITHUB_REPOSITORY,
        cwd: repo,
        dryRun,
        evidence: mirrorEvidence,
      });
      results.push({ status: 'ok', ...result });
    } catch (error) {
      mirrorFailures.push(`${taskId}: ${error.message}`);
      results.push({ status: 'failed', taskId, error: error.message });
    }
  }
  if (mirrorFailures.length > 0) {
    fail(
      `${mirrorOnly ? 'Guarded Beads closure already existed' : 'Beads closure succeeded'}, but GitHub mirror had partial failures: ${mirrorFailures.join('; ')}`,
    );
  }
  return results;
}

export async function runGuardedClosure({
  manifest,
  repo = process.cwd(),
  dryRun = false,
  mirrorOnly = false,
  beadsAuthority,
  closureAdapters = {},
  mirrorTask = mirrorTaskById,
}) {
  const executionPlan = closureExecutionPlan({ dryRun, mirrorOnly });
  const repository = path.resolve(repo);
  const evidence = await validateIntegrationEvidence(manifest, {
    repo: repository,
    beadsAuthority,
    allowPartialClosure: !mirrorOnly,
  });
  if (mirrorOnly) {
    for (const taskId of evidence.closureTaskIds) {
      const issue = (closureAdapters.readTask ?? readTask)(repository, taskId);
      planClosureTaskAction({ evidence, taskId, issue });
      if (issue.status !== 'closed') {
        fail(`${taskId} must already have a guarded Beads closure for mirror-only retry`);
      }
    }
  } else {
    planBeadsClosure({ evidence, repo: repository, adapters: closureAdapters });
  }
  if (!executionPlan.mutateBeads && !executionPlan.runMirrors) {
    console.log(`Guarded closure dry-run passed for ${evidence.closureTaskIds.join(', ')}`);
    return { evidence, mirrors: [] };
  }
  if (executionPlan.mutateBeads) {
    await executeBeadsClosure({ evidence, repo: repository, adapters: closureAdapters });
  }
  let mirrors = [];
  if (executionPlan.runMirrors) {
    mirrors = await mirrorClosureTasks({
      evidence,
      repo: repository,
      dryRun: executionPlan.mirrorDryRun,
      mirrorOnly,
      mirrorTask,
    });
  }
  if (mirrorOnly && dryRun) {
    console.log(`Mirror-only retry dry-run passed for ${evidence.closureTaskIds.join(', ')}`);
  }
  return { evidence, mirrors };
}

async function main(argv) {
  const options = parseArguments(argv);
  const repo = path.resolve(options.repo);
  const manifestPath = path.resolve(repo, options.manifest);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  await runGuardedClosure({
    manifest,
    repo,
    dryRun: options.dryRun,
    mirrorOnly: options.mirrorOnly,
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(`Guarded closure rejected: ${error.message}`);
    process.exitCode = 1;
  }
}
