import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { validateIntegrationEvidence } from './check-integration-evidence.mjs';
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

export function validatePublicationBranch(branch, taskIds) {
  if (branch.startsWith('codex/')) {
    return branch;
  }
  const taskBranch = /^(?:feat|fix|chore)\/(gymcoach-[a-z0-9]+(?:\.[a-z0-9]+)*)-/.exec(branch);
  if (!taskBranch || !taskIds.includes(taskBranch[1])) {
    fail('publication branch must use codex/ or a dedicated branch for a guarded task');
  }
  return branch;
}

export function originMatchesRepository(originUrl, repository) {
  const normalized = originUrl.trim().replace(/\.git$/, '');
  return (
    normalized === `https://github.com/${repository}` ||
    normalized === `git@github.com:${repository}` ||
    normalized === `ssh://git@github.com/${repository}`
  );
}

export function buildDraftPrBody(evidence) {
  const delivery = Object.entries(evidence.delivery)
    .map(([stage, value]) => `- ${stage}: ${value.status}`)
    .join('\n');
  return `## Guarded integration

- Integration head: \`${evidence.head}\`
- Tasks: ${evidence.taskIds.map((id) => `\`${id}\``).join(', ')}

## Delivery state

${delivery}

This draft PR was created only after the repository integration guard passed. Beads remains authoritative. The PR must not be auto-merged, and it does not imply installation or deployment.
`;
}

function parseArguments(argv) {
  const options = {
    repo: process.cwd(),
    repository: DEFAULT_GITHUB_REPOSITORY,
    base: DEFAULT_GITHUB_BRANCH,
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--manifest') {
      options.manifest = argv[++index];
    } else if (argument === '--repo') {
      options.repo = argv[++index];
    } else if (argument === '--repository') {
      options.repository = argv[++index];
    } else if (argument === '--base') {
      options.base = argv[++index];
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
  const evidence = await validateIntegrationEvidence(manifest, { repo });
  if (evidence.mode !== 'integration') {
    fail('only guarded integrated product work may be published through this command');
  }
  const branch = validatePublicationBranch(
    run('git', ['branch', '--show-current'], { cwd: repo, capture: true }),
    evidence.taskIds,
  );
  const origin = run('git', ['remote', 'get-url', 'origin'], { cwd: repo, capture: true });
  if (!originMatchesRepository(origin, options.repository)) {
    fail(`origin does not target ${options.repository}`);
  }
  const originHead = run('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], {
    cwd: repo,
    capture: true,
  });
  if (
    originHead !== `refs/remotes/origin/${options.base}` ||
    options.base !== DEFAULT_GITHUB_BRANCH
  ) {
    fail('draft PR base must be the confirmed origin default branch main');
  }
  const title = `[integration] ${evidence.taskIds.join(', ')}`;
  const body = buildDraftPrBody(evidence);
  if (options.dryRun) {
    console.log(
      JSON.stringify(
        {
          action: 'publish-draft-pr',
          repository: options.repository,
          branch,
          base: options.base,
          head: evidence.head,
          taskIds: evidence.taskIds,
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
        options.repository,
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
        options.repository,
        '--draft',
        '--base',
        options.base,
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
        options.repository,
        '--base',
        options.base,
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
        ['pr', 'ready', String(pullRequest.number), '--repo', options.repository, '--undo'],
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
