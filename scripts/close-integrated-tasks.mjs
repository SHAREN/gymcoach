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

function requireTaskStage(repo, taskId, expectedLabel) {
  const issue = readTask(repo, taskId);
  if (!issue || issue.status !== 'in_progress' || !issue.labels?.includes(expectedLabel)) {
    fail(`${taskId} must be in_progress with ${expectedLabel} before guarded closure`);
  }
}

function readTask(repo, taskId) {
  return JSON.parse(runBd(repo, ['show', taskId, '--json'], { capture: true }))[0];
}

function requireCoordinatorState(repo, taskId) {
  const issue = readTask(repo, taskId);
  if (!issue || !['open', 'in_progress', 'blocked'].includes(issue.status)) {
    fail(`${taskId} must remain open, in_progress, or blocked before root coordination closure`);
  }
  if (
    issue.labels?.some((label) =>
      ['stage:review', 'stage:verify', 'stage:verified'].includes(label),
    )
  ) {
    fail(`${taskId} has an implementation stage and must be verified as a mapped task`);
  }
}

function requireClosedTask(repo, taskId) {
  const issue = readTask(repo, taskId);
  if (
    !issue ||
    issue.status !== 'closed' ||
    !/Guarded (?:integration(?: root coordination)?|no-runtime-artifact) closure/.test(
      issue.notes ?? '',
    )
  ) {
    fail(`${taskId} must already have a guarded Beads closure for mirror-only retry`);
  }
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

async function main(argv) {
  const options = parseArguments(argv);
  const executionPlan = closureExecutionPlan(options);
  const repo = path.resolve(options.repo);
  const manifestPath = path.resolve(repo, options.manifest);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const evidence = await validateIntegrationEvidence(manifest, { repo });
  const expectedLabel = evidence.mode === 'integration' ? 'stage:verified' : 'stage:verify';
  const alreadyGuarded = new Set(evidence.alreadyGuardedTaskIds);
  for (const taskId of evidence.closureTaskIds) {
    if (options.mirrorOnly) {
      requireClosedTask(repo, taskId);
    } else if (alreadyGuarded.has(taskId)) {
      requireClosedTask(repo, taskId);
    } else if (evidence.coordinatorTaskIds.includes(taskId)) {
      requireCoordinatorState(repo, taskId);
    } else {
      requireTaskStage(repo, taskId, expectedLabel);
    }
  }
  if (!executionPlan.mutateBeads && !executionPlan.runMirrors) {
    console.log(`Guarded closure dry-run passed for ${evidence.closureTaskIds.join(', ')}`);
    return;
  }
  if (executionPlan.mutateBeads) {
    for (const taskId of evidence.closureTaskIds) {
      if (alreadyGuarded.has(taskId)) {
        continue;
      }
      const note =
        evidence.mode === 'integration'
          ? `${evidence.coordinatorTaskIds.includes(taskId) ? 'Guarded integration root coordination closure' : 'Guarded integration closure'}: head ${evidence.head}; integrated=${evidence.delivery.integrated.status}; published=${evidence.delivery.published.status}; installed=${evidence.delivery.installed.status}; deployed=${evidence.delivery.deployed.status}.`
          : `Immutable verification evidence: verified-commit ${evidence.head}. Guarded no-runtime-artifact closure at verified commit ${evidence.head}.`;
      const issue = readTask(repo, taskId);
      const stageLabels = issue.labels?.filter((label) => label.startsWith('stage:')) ?? [];
      const updateArgs = ['update', taskId, '--append-notes', note];
      for (const label of stageLabels) {
        updateArgs.push('--remove-label', label);
      }
      runBd(repo, updateArgs);
      runBd(repo, [
        'close',
        taskId,
        '--reason',
        evidence.mode === 'integration'
          ? 'Integrated evidence and required artifact gates passed'
          : 'Explicit no-runtime-artifact exception passed isolated verification',
      ]);
    }
  }
  if (executionPlan.runMirrors) {
    await mirrorClosureTasks({
      evidence,
      repo,
      dryRun: executionPlan.mirrorDryRun,
      mirrorOnly: options.mirrorOnly,
    });
  }
  if (options.mirrorOnly && options.dryRun) {
    console.log(`Mirror-only retry dry-run passed for ${evidence.closureTaskIds.join(', ')}`);
  }
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
