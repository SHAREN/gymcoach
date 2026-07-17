import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { closureExecutionPlan, mirrorClosureTasks } from './close-integrated-tasks.mjs';
import { mirrorTaskById } from './sync-beads-github.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const issues = JSON.parse(
  await readFile(path.join(root, 'scripts/fixtures/github-mirror/issues.json'), 'utf8'),
);

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

function closedTask(id, externalRef) {
  return {
    id,
    title: `Closed ${id}`,
    description: 'Sanitized closure mirror fixture.',
    acceptance_criteria: 'Closure evidence is mirrored safely.',
    notes: 'Guarded integration closure: head abc.',
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
  evidence: { kind: 'integration', integrationHead: 'a'.repeat(40), delivery: {} },
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
  evidence: { kind: 'integration', integrationHead: 'a'.repeat(40), delivery: {} },
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
  delivery: {},
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

console.log('Guarded closure and mirror-only retry regression tests passed.');
