import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildImmutableVerificationNote } from './check-integration-evidence.mjs';
import {
  buildClosureNote,
  closureExecutionPlan,
  executeBeadsClosure,
  mirrorClosureTasks,
  planBeadsClosure,
  runGuardedClosure,
} from './close-integrated-tasks.mjs';
import { mirrorTaskById } from './sync-beads-github.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const issues = JSON.parse(
  await readFile(path.join(root, 'scripts/fixtures/github-mirror/issues.json'), 'utf8'),
);

function git(repo, ...args) {
  const result = spawnSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

async function commitFile(repo, relativePath, contents, message) {
  const filePath = path.join(repo, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
  git(repo, 'add', relativePath);
  git(repo, 'commit', '-m', message);
  return git(repo, 'rev-parse', 'HEAD');
}

assert.deepEqual(closureExecutionPlan({ dryRun: true, mirrorOnly: false }), {
  mutateBeads: false,
  runMirrors: false,
  mirrorDryRun: true,
});
assert.deepEqual(closureExecutionPlan({ dryRun: true, mirrorOnly: true }), {
  mutateBeads: false,
  runMirrors: true,
  mirrorDryRun: true,
});
assert.deepEqual(closureExecutionPlan({ dryRun: false, mirrorOnly: false }), {
  mutateBeads: true,
  runMirrors: true,
  mirrorDryRun: false,
});
assert.deepEqual(closureExecutionPlan({ dryRun: false, mirrorOnly: true }), {
  mutateBeads: false,
  runMirrors: true,
  mirrorDryRun: false,
});

const integrationMirrorEvidence = {
  kind: 'integration',
  integrationHead: 'a'.repeat(40),
  delivery: {
    integrated: 'complete',
    published: 'not-required',
    installed: 'not-authorized',
    deployed: 'not-authorized',
  },
  coordinatorTaskIds: [],
};

function closedTask(id, externalRef) {
  return {
    id,
    title: `Closed ${id}`,
    description: 'Sanitized closure mirror fixture.',
    acceptance_criteria: 'Closure evidence is mirrored safely.',
    notes: `Guarded integration closure: head ${integrationMirrorEvidence.integrationHead}; integrated=complete; published=not-required; installed=not-authorized; deployed=not-authorized.`,
    status: 'closed',
    priority: 1,
    issue_type: 'chore',
    external_ref: externalRef,
    labels: ['area:infrastructure', 'priority:P1', 'type:chore'],
  };
}

const noOpAdapters = {
  ensureLabels() {},
  createIssue() {
    throw new Error('existing mirror must be reused');
  },
};

const plannedExternalRefs = [];
const dryRunReuse = await mirrorTaskById({
  taskId: 'gymcoach-js4',
  task: closedTask('gymcoach-js4'),
  issues,
  dryRun: true,
  evidence: integrationMirrorEvidence,
  adapters: {
    ...noOpAdapters,
    persistExternalRef(task, url, options) {
      plannedExternalRefs.push({ taskId: task.id, url, dryRun: options.dryRun });
    },
  },
});
assert.equal(dryRunReuse.action, 'update');
assert.equal(dryRunReuse.issueNumber, 6);
assert.equal(dryRunReuse.externalRefAction, 'persist');
assert.deepEqual(plannedExternalRefs, [
  {
    taskId: 'gymcoach-js4',
    url: 'https://github.com/SHAREN/gymcoach/issues/6',
    dryRun: true,
  },
]);

let updateCount = 0;
let createCount = 0;
const persistedExternalRefs = [];
const realReuse = await mirrorTaskById({
  taskId: 'gymcoach-js4',
  task: closedTask('gymcoach-js4'),
  issues,
  evidence: integrationMirrorEvidence,
  adapters: {
    ensureLabels() {},
    createIssue() {
      createCount += 1;
      throw new Error('existing mirror must not be duplicated');
    },
    updateIssue(issueNumber, payload) {
      updateCount += 1;
      return {
        ...issues.find((issue) => issue.number === issueNumber),
        ...payload,
        number: issueNumber,
        html_url: `https://github.com/SHAREN/gymcoach/issues/${issueNumber}`,
      };
    },
    persistExternalRef(task, url, options) {
      persistedExternalRefs.push({ taskId: task.id, url, dryRun: options.dryRun });
    },
  },
});
assert.equal(realReuse.issueNumber, 6);
assert.equal(createCount, 0);
assert.equal(updateCount, 1);
assert.deepEqual(persistedExternalRefs, [
  {
    taskId: 'gymcoach-js4',
    url: 'https://github.com/SHAREN/gymcoach/issues/6',
    dryRun: false,
  },
]);

await assert.rejects(
  () =>
    mirrorTaskById({
      taskId: 'gymcoach-js4',
      task: closedTask('gymcoach-js4', 'https://github.com/other/repo/issues/6'),
      issues,
      dryRun: true,
      evidence: integrationMirrorEvidence,
      adapters: noOpAdapters,
    }),
  /external_ref is not an exact SHAREN\/gymcoach GitHub issue URL/,
);
await assert.rejects(
  () =>
    mirrorTaskById({
      taskId: 'gymcoach-js4',
      task: closedTask('gymcoach-js4', 'https://github.com/SHAREN/gymcoach/issues/404'),
      issues,
      dryRun: true,
      evidence: integrationMirrorEvidence,
      adapters: noOpAdapters,
    }),
  /external_ref points to missing GitHub issue #404/,
);
await assert.rejects(
  () =>
    mirrorTaskById({
      taskId: 'gymcoach-js4',
      task: closedTask('gymcoach-js4', 'https://github.com/SHAREN/gymcoach/issues/7'),
      issues,
      dryRun: true,
      evidence: integrationMirrorEvidence,
      adapters: noOpAdapters,
    }),
  /external_ref points to an issue without the exact Beads ID marker/,
);

const multiIdIssue = {
  ...issues[0],
  number: 98,
  html_url: 'https://github.com/SHAREN/gymcoach/issues/98',
  body: '<!-- beads-task-id: gymcoach-js4 -->\n<!-- beads-task-id: gymcoach-a7b -->',
};
let multiIdMutationCount = 0;
await assert.rejects(
  () =>
    mirrorTaskById({
      taskId: 'gymcoach-js4',
      task: closedTask('gymcoach-js4', multiIdIssue.html_url),
      issues: [multiIdIssue],
      dryRun: true,
      evidence: integrationMirrorEvidence,
      adapters: {
        ensureLabels() {
          multiIdMutationCount += 1;
        },
        createIssue() {
          multiIdMutationCount += 1;
        },
        updateIssue() {
          multiIdMutationCount += 1;
        },
        persistExternalRef() {
          multiIdMutationCount += 1;
        },
      },
    }),
  /GitHub issue #98 contains multiple Beads task IDs: gymcoach-a7b, gymcoach-js4/,
);
assert.equal(multiIdMutationCount, 0);

const duplicate = {
  ...issues[0],
  number: 99,
  html_url: 'https://github.com/SHAREN/gymcoach/issues/99',
};
const batchCalls = [];
const batchExternalRefs = [];
const batchEvidence = {
  mode: 'integration',
  head: 'a'.repeat(40),
  closureTaskIds: ['gymcoach-js4', 'gymcoach-a7b'],
  coordinatorTaskIds: [],
  delivery: {
    integrated: { status: 'complete' },
    published: { status: 'not-required' },
    installed: { status: 'not-authorized' },
    deployed: { status: 'not-authorized' },
  },
};
await assert.rejects(
  () =>
    mirrorClosureTasks({
      evidence: batchEvidence,
      repo: root,
      dryRun: true,
      mirrorOnly: true,
      mirrorTask: async (options) => {
        batchCalls.push({ taskId: options.taskId, dryRun: options.dryRun });
        return mirrorTaskById({
          ...options,
          task: closedTask(
            options.taskId,
            options.taskId === 'gymcoach-js4'
              ? 'https://github.com/SHAREN/gymcoach/issues/6'
              : undefined,
          ),
          issues: options.taskId === 'gymcoach-js4' ? [...issues, duplicate] : issues,
          adapters: {
            ...noOpAdapters,
            persistExternalRef(task, url, persistOptions) {
              batchExternalRefs.push({
                taskId: task.id,
                url,
                dryRun: persistOptions.dryRun,
              });
            },
          },
        });
      },
    }),
  /gymcoach-js4 has duplicate GitHub mirrors: #6, #99/,
);
assert.deepEqual(batchCalls, [
  { taskId: 'gymcoach-js4', dryRun: true },
  { taskId: 'gymcoach-a7b', dryRun: true },
]);
assert.deepEqual(batchExternalRefs, [
  {
    taskId: 'gymcoach-a7b',
    url: 'https://github.com/SHAREN/gymcoach/issues/7',
    dryRun: true,
  },
]);

const retryEvidence = {
  mode: 'integration',
  head: 'b'.repeat(40),
  closureTaskIds: ['gymcoach-child', 'gymcoach-root'],
  coordinatorTaskIds: ['gymcoach-root'],
  alreadyGuardedTaskIds: [],
  delivery: {
    integrated: { status: 'complete' },
    published: { status: 'not-required' },
    installed: { status: 'not-authorized' },
    deployed: { status: 'not-authorized' },
  },
};
const retryTasks = new Map([
  [
    'gymcoach-child',
    {
      id: 'gymcoach-child',
      status: 'in_progress',
      labels: ['stage:awaiting-integration', 'area:infrastructure'],
      notes: '',
    },
  ],
  [
    'gymcoach-root',
    {
      id: 'gymcoach-root',
      status: 'in_progress',
      labels: ['area:infrastructure'],
      notes: '',
    },
  ],
]);
const mutationLog = [];
let failFirstChildClose = true;
const retryAdapters = {
  readTask(_repo, taskId) {
    return structuredClone(retryTasks.get(taskId));
  },
  updateTask(_repo, action) {
    mutationLog.push(`update:${action.taskId}`);
    const issue = retryTasks.get(action.taskId);
    issue.labels = issue.labels.filter((label) => !action.stageLabels.includes(label));
    issue.notes = [issue.notes, action.note].filter(Boolean).join('\n');
  },
  closeTask(_repo, action) {
    mutationLog.push(`close:${action.taskId}`);
    if (action.taskId === 'gymcoach-child' && failFirstChildClose) {
      failFirstChildClose = false;
      throw new Error('synthetic close failure');
    }
    retryTasks.get(action.taskId).status = 'closed';
  },
};

assert.deepEqual(
  planBeadsClosure({ evidence: retryEvidence, repo: root, adapters: retryAdapters }).map(
    ({ taskId, action }) => ({ taskId, action }),
  ),
  [
    { taskId: 'gymcoach-child', action: 'update-and-close' },
    { taskId: 'gymcoach-root', action: 'update-and-close' },
  ],
);
await assert.rejects(
  () => executeBeadsClosure({ evidence: retryEvidence, repo: root, adapters: retryAdapters }),
  /synthetic close failure/,
);
assert.deepEqual(mutationLog, ['update:gymcoach-child', 'close:gymcoach-child']);
assert.equal(retryTasks.get('gymcoach-child').status, 'in_progress');
assert.deepEqual(retryTasks.get('gymcoach-child').labels, ['area:infrastructure']);
assert.equal(
  retryTasks.get('gymcoach-child').notes,
  buildClosureNote(retryEvidence, 'gymcoach-child'),
);

assert.deepEqual(
  planBeadsClosure({ evidence: retryEvidence, repo: root, adapters: retryAdapters }).map(
    ({ taskId, action }) => ({ taskId, action }),
  ),
  [
    { taskId: 'gymcoach-child', action: 'close-only' },
    { taskId: 'gymcoach-root', action: 'update-and-close' },
  ],
);
await executeBeadsClosure({ evidence: retryEvidence, repo: root, adapters: retryAdapters });
assert.deepEqual(mutationLog, [
  'update:gymcoach-child',
  'close:gymcoach-child',
  'close:gymcoach-child',
  'update:gymcoach-root',
  'close:gymcoach-root',
]);
assert.equal(retryTasks.get('gymcoach-child').status, 'closed');
assert.equal(retryTasks.get('gymcoach-root').status, 'closed');
assert.equal(
  retryTasks.get('gymcoach-child').notes,
  buildClosureNote(retryEvidence, 'gymcoach-child'),
);

const stranded = structuredClone(retryTasks.get('gymcoach-child'));
stranded.status = 'in_progress';
stranded.notes = '';
assert.throws(
  () =>
    planBeadsClosure({
      evidence: { ...retryEvidence, closureTaskIds: ['gymcoach-child'] },
      repo: root,
      adapters: { readTask: () => stranded },
    }),
  /must be in_progress with only stage:awaiting-integration/,
);

async function testFullWrapperPartialCloseRetry() {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'gymcoach-guarded-retry-'));
  try {
    git(repo, 'init', '-b', 'chore/gymcoach-retry-harness');
    git(repo, 'config', 'user.name', 'GymCoach Test');
    git(repo, 'config', 'user.email', 'gymcoach-test@example.invalid');
    const base = await commitFile(repo, 'README.md', 'base\n', 'base');
    const commit = await commitFile(repo, 'docs/workflow.md', 'harness\n', 'harness');
    const gate = {
      head: commit,
      command: 'node scripts/test-guarded-closure.mjs',
      exitCode: 0,
    };
    const manifest = {
      schemaVersion: 1,
      mode: 'no-runtime-artifact',
      authority: { rootTaskId: 'gymcoach-retry' },
      tasks: [
        {
          id: 'gymcoach-retry',
          classification: 'no-runtime-artifact',
          verified: { base, commit, gate },
          noRuntimeArtifact: {
            reason: 'Pure harness retry regression.',
            reviewedBy: 'independent verifier',
            changedPaths: ['docs/workflow.md'],
          },
        },
      ],
      delivery: Object.fromEntries(
        ['integrated', 'published', 'installed', 'deployed'].map((stage) => [
          stage,
          { required: false, status: 'not-required' },
        ]),
      ),
    };
    const task = {
      id: 'gymcoach-retry',
      status: 'in_progress',
      labels: ['stage:verify', 'area:infrastructure'],
      acceptance_criteria: 'No installation or deployment is required.',
      notes: buildImmutableVerificationNote({
        verifiedBase: base,
        verifiedCommit: commit,
        gate,
        artifactImpact: 'no-runtime-artifact',
      }),
    };
    const authority = {
      rootTaskId: task.id,
      tasks: { [task.id]: task },
      blockingDependencies: { [task.id]: [] },
    };
    const wrapperLog = [];
    let firstClose = true;
    const closureAdapters = {
      readTask(_repo, taskId) {
        return structuredClone(authority.tasks[taskId]);
      },
      updateTask(_repo, action) {
        wrapperLog.push(`update:${action.taskId}`);
        task.labels = task.labels.filter((label) => !action.stageLabels.includes(label));
        task.notes = `${task.notes}\n${action.note}`;
      },
      closeTask(_repo, action) {
        wrapperLog.push(`close:${action.taskId}`);
        if (firstClose) {
          firstClose = false;
          throw new Error('synthetic bd close failure');
        }
        task.status = 'closed';
      },
    };
    const mirrorTask = async ({ taskId }) => ({ taskId, action: 'update' });

    await assert.rejects(
      () =>
        runGuardedClosure({
          manifest,
          repo,
          beadsAuthority: authority,
          closureAdapters,
          mirrorTask,
        }),
      /synthetic bd close failure/,
    );
    assert.deepEqual(wrapperLog, ['update:gymcoach-retry', 'close:gymcoach-retry']);
    assert.deepEqual(task.labels, ['area:infrastructure']);
    assert.match(task.notes, /Guarded no-runtime-artifact closure/);

    await runGuardedClosure({
      manifest,
      repo,
      beadsAuthority: authority,
      closureAdapters,
      mirrorTask,
    });
    assert.deepEqual(wrapperLog, [
      'update:gymcoach-retry',
      'close:gymcoach-retry',
      'close:gymcoach-retry',
    ]);
    assert.equal(task.status, 'closed');
    assert.equal((task.notes.match(/Guarded no-runtime-artifact closure/g) ?? []).length, 1);

    const immutableNote = buildImmutableVerificationNote({
      verifiedBase: base,
      verifiedCommit: commit,
      gate,
      artifactImpact: 'no-runtime-artifact',
    });
    const exactClosureNote = `Guarded no-runtime-artifact closure at verified commit ${commit}.`;
    const adversarialTasks = [
      {
        ...task,
        labels: ['stage:verify', 'area:infrastructure'],
        notes: `${immutableNote}\nGuarded no-runtime-artifact closure with fabricated text.`,
      },
      {
        ...task,
        labels: ['area:infrastructure'],
        notes: `${immutableNote}\nGuarded no-runtime-artifact closure at verified commit ${'f'.repeat(40)}.`,
      },
      {
        ...task,
        labels: ['stage:verify', 'area:infrastructure'],
        notes: `${immutableNote}\n${exactClosureNote}`,
      },
    ];
    for (const adversarialTask of adversarialTasks) {
      let downstreamCalled = false;
      await assert.rejects(
        () =>
          runGuardedClosure({
            manifest,
            repo,
            beadsAuthority: {
              rootTaskId: adversarialTask.id,
              tasks: { [adversarialTask.id]: adversarialTask },
              blockingDependencies: { [adversarialTask.id]: [] },
            },
            closureAdapters: {
              readTask() {
                downstreamCalled = true;
                return adversarialTask;
              },
            },
            mirrorTask: async () => {
              downstreamCalled = true;
            },
          }),
        /closed without exactly one matching guarded closure note and no stage labels/,
      );
      assert.equal(downstreamCalled, false);
    }
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
}

await testFullWrapperPartialCloseRetry();

console.log('Guarded closure and mirror-only retry regression tests passed.');
