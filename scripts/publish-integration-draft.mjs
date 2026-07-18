import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  taskHasGuardedClosure,
  validateIntegrationEvidence,
} from './check-integration-evidence.mjs';
import { DEFAULT_GITHUB_BRANCH, DEFAULT_GITHUB_REPOSITORY } from './sync-beads-github.mjs';

function fail(message) {
  throw new Error(message);
}

function run(command, args, { cwd, capture = false } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: capture ? 'utf8' : undefined,
    stdio: capture ? 'pipe' : 'inherit',
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    fail(`${command} ${args.join(' ')} failed${result.error ? `: ${result.error.message}` : ''}`);
  }
  return capture ? result.stdout.trim() : '';
}

export function validatePublicationBranch(branch, { rootTaskId, closureTaskIds }) {
  const guardedTaskIds = new Set([rootTaskId, ...closureTaskIds]);
  const codexTask = /^codex\/(?:integration-)?(gymcoach-[a-z0-9]+(?:\.[a-z0-9]+)*)(?:-|$)/.exec(
    branch,
  );
  if (codexTask) {
    if (!guardedTaskIds.has(codexTask[1])) {
      fail('codex publication branch is not bound to a guarded Beads task');
    }
    return branch;
  }
  const taskBranch = /^(?:feat|fix|chore)\/(gymcoach-[a-z0-9]+(?:\.[a-z0-9]+)*)-/.exec(branch);
  if (!taskBranch || !guardedTaskIds.has(taskBranch[1])) {
    fail('publication branch must be dedicated to a guarded Beads task');
  }
  return branch;
}

export function originMatchesRepository(originUrl) {
  const normalized = originUrl.trim().replace(/\.git$/, '');
  return (
    normalized === `https://github.com/${DEFAULT_GITHUB_REPOSITORY}` ||
    normalized === `git@github.com:${DEFAULT_GITHUB_REPOSITORY}` ||
    normalized === `ssh://git@github.com/${DEFAULT_GITHUB_REPOSITORY}`
  );
}

export function buildDraftPrBody(evidence) {
  const delivery = Object.entries(evidence.delivery)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([stage, value]) => `- ${stage}: ${value.status}`)
    .join('\n');
  return `## Guarded ${evidence.mode === 'integration' ? 'integration' : 'verified harness task'}

- ${evidence.mode === 'integration' ? 'Integration' : 'Verified'} head: \`${evidence.head}\`
- Tasks: ${evidence.closureTaskIds.map((id) => `\`${id}\``).join(', ')}

## Delivery state

${delivery}

This draft PR was created only after guarded closure and immutable verification passed. Beads remains authoritative. The PR must not be auto-merged, and it does not imply installation or deployment.
`;
}

export function validatePublicationEvidence(evidence) {
  if (
    !Array.isArray(evidence?.closureTaskIds) ||
    !Array.isArray(evidence?.alreadyGuardedTaskIds) ||
    !evidence.closureTaskIds.every((taskId) => evidence.alreadyGuardedTaskIds.includes(taskId))
  ) {
    fail('publication requires every guarded task to be closed first');
  }
  for (const taskId of evidence.closureTaskIds) {
    const task = evidence.authoritativeTaskStates?.[taskId];
    if (!taskHasGuardedClosure(task, evidence, taskId)) {
      fail(
        `${taskId} publication requires exactly one matching guarded closure note and no stage labels`,
      );
    }
  }
  return evidence;
}

function parseArguments(argv) {
  const options = {
    repo: process.cwd(),
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--manifest') {
      options.manifest = argv[++index];
    } else if (argument === '--repo') {
      options.repo = argv[++index];
    } else if (argument === '--dry-run') {
      options.dryRun = true;
    } else {
      fail(`unknown argument ${argument}`);
    }
  }
  if (!options.manifest) {
    fail('usage: node scripts/publish-integration-draft.mjs --manifest PATH [--dry-run]');
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const repo = path.resolve(options.repo);
  const manifest = JSON.parse(await readFile(path.resolve(repo, options.manifest), 'utf8'));
  const evidence = validatePublicationEvidence(
    await validateIntegrationEvidence(manifest, { repo }),
  );
  const branch = validatePublicationBranch(
    run('git', ['branch', '--show-current'], { cwd: repo, capture: true }),
    evidence,
  );
  const origin = run('git', ['remote', 'get-url', 'origin'], { cwd: repo, capture: true });
  if (!originMatchesRepository(origin)) {
    fail(`origin does not target ${DEFAULT_GITHUB_REPOSITORY}`);
  }
  const originHead = run('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], {
    cwd: repo,
    capture: true,
  });
  if (originHead !== `refs/remotes/origin/${DEFAULT_GITHUB_BRANCH}`) {
    fail('draft PR base must be the confirmed origin default branch main');
  }
  const title = `[${evidence.mode === 'integration' ? 'integration' : 'verified'}] ${evidence.closureTaskIds.join(', ')}`;
  const body = buildDraftPrBody(evidence);
  if (options.dryRun) {
    console.log(
      JSON.stringify(
        {
          action: 'publish-draft-pr',
          repository: DEFAULT_GITHUB_REPOSITORY,
          branch,
          base: DEFAULT_GITHUB_BRANCH,
          head: evidence.head,
          taskIds: evidence.closureTaskIds,
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }

  run('gh', ['auth', 'status', '--hostname', 'github.com'], { cwd: repo });
  run('git', ['push', '--set-upstream', 'origin', `HEAD:${branch}`], { cwd: repo });
  const pullRequests = JSON.parse(
    run(
      'gh',
      [
        'pr',
        'list',
        '--repo',
        DEFAULT_GITHUB_REPOSITORY,
        '--head',
        branch,
        '--state',
        'open',
        '--json',
        'number,isDraft,url',
      ],
      { cwd: repo, capture: true },
    ),
  );
  if (pullRequests.length > 1) {
    fail(`multiple open pull requests already target ${branch}`);
  }
  if (pullRequests.length === 0) {
    run(
      'gh',
      [
        'pr',
        'create',
        '--repo',
        DEFAULT_GITHUB_REPOSITORY,
        '--draft',
        '--base',
        DEFAULT_GITHUB_BRANCH,
        '--head',
        branch,
        '--title',
        title,
        '--body',
        body,
      ],
      { cwd: repo },
    );
  } else {
    const pullRequest = pullRequests[0];
    run(
      'gh',
      [
        'pr',
        'edit',
        String(pullRequest.number),
        '--repo',
        DEFAULT_GITHUB_REPOSITORY,
        '--base',
        DEFAULT_GITHUB_BRANCH,
        '--title',
        title,
        '--body',
        body,
      ],
      { cwd: repo },
    );
    if (!pullRequest.isDraft) {
      run(
        'gh',
        ['pr', 'ready', String(pullRequest.number), '--repo', DEFAULT_GITHUB_REPOSITORY, '--undo'],
        { cwd: repo },
      );
    }
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    await main();
  } catch (error) {
    console.error(`Integration publication rejected: ${error.message}`);
    process.exitCode = 1;
  }
}
