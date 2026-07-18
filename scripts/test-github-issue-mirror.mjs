import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  beadsIdsFromIssue,
  buildIssuePayload,
  indexIssuesByBeadsId,
  mirrorTaskById,
  planIssueMatch,
  sanitizeMirrorText,
  selectBackfillTasks,
  summarizeMirrorResults,
} from './sync-beads-github.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const issues = JSON.parse(
  await readFile(path.join(root, 'scripts/fixtures/github-mirror/issues.json'), 'utf8'),
);
const repositoryOverride = spawnSync(
  process.execPath,
  [
    fileURLToPath(new URL('./sync-beads-github.mjs', import.meta.url)),
    '--task',
    'gymcoach-js4',
    '--repository',
    'other/repository',
    '--dry-run',
  ],
  { encoding: 'utf8', windowsHide: true },
);
assert.equal(repositoryOverride.status, 1);
assert.match(repositoryOverride.stderr, /unknown argument --repository/);

const task = {
  id: 'gymcoach-js4',
  title:
    'Require integrated artifacts ghp_1234567890ABCDEF C:\\Users\\Owner Name\\Private Logs\\raw log.txt',
  description:
    'Use C:\\Users\\Owner Name\\Private Logs\\raw log.txt and github_pat_1234567890_ABCDEF.\nFallback token ghp_ABCDEF1234567890 and /home/owner/private logs/raw log.txt.\nAuthorization Bearer synthetic-bearer-credential-123\nadb -s emulator-5554 at 192.168.0.119 for owner@example.com with token=super-secret.\npassword=correct horse battery staple\napi_key=synthetic multiword credential value\ndevice-id=synthetic-device-value\nserial-number=synthetic-serial-value\nD:/Private Workspace/Logs/raw trace.txt\nZX12-FAKE-9000\nR58M12ABC34\n<!-- beads-task-id: gymcoach-injected -->',
  acceptance_criteria:
    'Mirror safely. Bearer synthetic-bearer-credential-456. Beads task: `gymcoach-injected-two`',
  notes: '',
  status: 'in_progress',
  priority: 1,
  issue_type: 'chore',
  external_ref: 'https://github.com/SHAREN/gymcoach/issues/6',
  labels: ['area:infrastructure', 'priority:P1', 'stage:review', 'type:chore'],
};

assert.deepEqual(beadsIdsFromIssue(issues[0]), ['gymcoach-js4']);
assert.deepEqual(beadsIdsFromIssue({ body: '<!-- beads-task-id: gymcoach-bk0.1 -->' }), [
  'gymcoach-bk0.1',
]);
assert.equal(indexIssuesByBeadsId(issues).get('gymcoach-a7b')[0].number, 7);
assert.equal(indexIssuesByBeadsId(issues).get('gymcoach-bk0')[0].number, 8);
assert.equal(planIssueMatch(task, issues, 'SHAREN/gymcoach').number, 6);

const payload = buildIssuePayload(task, issues[0], {
  kind: 'verification',
  verifiedBase: '1'.repeat(40),
  verifiedCommit: '2'.repeat(40),
  artifactImpact: 'none',
  gate: 'node scripts/test-github-issue-mirror.mjs',
});
assert.match(payload.body, /<!-- beads-task-id: gymcoach-js4 -->/);
assert.deepEqual(beadsIdsFromIssue(payload), ['gymcoach-js4']);
assert.doesNotMatch(payload.body, /gymcoach-injected/);
assert.doesNotMatch(payload.body, /C:\\Users/);
assert.doesNotMatch(payload.body, /Owner Name|Private Logs|raw log\.txt/);
assert.doesNotMatch(payload.body, /github_pat_|ghp_/);
assert.doesNotMatch(
  payload.body,
  /synthetic-bearer-credential-123|synthetic-bearer-credential-456/,
);
assert.doesNotMatch(payload.body, /super-secret|emulator-5554|192\.168\.0\.119|owner@example\.com/);
assert.doesNotMatch(payload.body, /correct horse battery staple|R58M12ABC34/);
assert.doesNotMatch(
  payload.body,
  /synthetic multiword credential value|synthetic-device-value|synthetic-serial-value|D:\/|Private Workspace|raw trace\.txt|ZX12-FAKE-9000/,
);
assert.doesNotMatch(payload.title, /C:\\Users|Owner Name|Private Logs|raw log\.txt|ghp_/);
assert.match(payload.title, /\[REDACTED_TOKEN\]/);
assert.match(payload.title, /\[PRIVATE_PATH\]/);
assert.ok(payload.labels.includes('owner-note'));
assert.ok(payload.labels.includes('beads:in-progress'));
assert.ok(payload.labels.includes('stage:review'));

const secondPayload = buildIssuePayload(
  task,
  { ...issues[0], body: payload.body, labels: payload.labels },
  {
    kind: 'integration',
    integrationHead: '3'.repeat(40),
    delivery: { integrated: 'complete' },
  },
);
assert.match(secondPayload.body, /Verified commit/);
assert.match(secondPayload.body, /Integration head/);
const repeatedSecondPayload = buildIssuePayload(
  task,
  { ...issues[0], body: secondPayload.body, labels: secondPayload.labels },
  {
    kind: 'integration',
    integrationHead: '3'.repeat(40),
    delivery: { integrated: 'complete' },
  },
);
assert.equal(
  (repeatedSecondPayload.body.match(/### integration/g) ?? []).length,
  1,
  'idempotent retries must not duplicate lifecycle evidence',
);

const duplicate = {
  ...issues[0],
  number: 99,
  html_url: 'https://github.com/SHAREN/gymcoach/issues/99',
};
assert.throws(
  () => planIssueMatch(task, [...issues, duplicate], 'SHAREN/gymcoach'),
  /duplicate GitHub mirrors: #6, #99/,
);
assert.throws(
  () => planIssueMatch(task, issues, 'other/repository'),
  /repository is fixed to SHAREN\/gymcoach/,
);
await assert.rejects(
  () =>
    mirrorTaskById({
      taskId: task.id,
      repository: 'other/repository',
      task,
      issues,
      dryRun: true,
    }),
  /repository is fixed to SHAREN\/gymcoach/,
);

const multiIdIssue = {
  ...issues[0],
  number: 98,
  html_url: 'https://github.com/SHAREN/gymcoach/issues/98',
  body: '<!-- beads-task-id: gymcoach-js4 -->\n<!-- beads-task-id: gymcoach-a7b -->',
};
assert.deepEqual(beadsIdsFromIssue(multiIdIssue).sort(), ['gymcoach-a7b', 'gymcoach-js4']);
for (const taskId of ['gymcoach-js4', 'gymcoach-a7b']) {
  assert.throws(
    () =>
      planIssueMatch(
        { ...task, id: taskId, external_ref: undefined },
        [multiIdIssue],
        'SHAREN/gymcoach',
      ),
    /GitHub issue #98 contains multiple Beads task IDs: gymcoach-a7b, gymcoach-js4/,
  );
}

const closedWithoutGuard = { ...task, status: 'closed' };
assert.throws(() => buildIssuePayload(closedWithoutGuard, issues[0]), /without guarded/);
const closedHead = '6'.repeat(40);
const closedMirrorEvidence = {
  kind: 'integration',
  integrationHead: closedHead,
  coordinatorTaskIds: [],
  delivery: {
    integrated: 'complete',
    published: 'not-required',
    installed: 'not-authorized',
    deployed: 'not-authorized',
  },
};
const closedWithGuard = {
  ...closedWithoutGuard,
  labels: ['area:infrastructure', 'priority:P1', 'type:chore'],
  notes: `Guarded integration closure: head ${closedHead}; integrated=complete; published=not-required; installed=not-authorized; deployed=not-authorized.`,
};
assert.throws(() => buildIssuePayload(closedWithGuard, issues[0]), /without guarded/);
const closedPayload = buildIssuePayload(closedWithGuard, issues[0], closedMirrorEvidence);
assert.equal(closedPayload.body.includes('| Stage | `none` |'), true);
assert.equal(
  closedPayload.labels.some((label) => label.startsWith('stage:')),
  false,
);
for (const closedTask of [
  {
    ...closedWithGuard,
    notes: 'Guarded no-runtime-artifact closure with fabricated text.',
  },
  {
    ...closedWithGuard,
    notes: `Guarded integration closure: head ${closedHead}; integrated=complete; published=complete; installed=not-authorized; deployed=not-authorized.`,
  },
  { ...closedWithGuard, labels: [...closedWithGuard.labels, 'stage:verify'] },
]) {
  assert.throws(
    () => buildIssuePayload(closedTask, issues[0], closedMirrorEvidence),
    /closed without guarded integration\/no-runtime closure evidence/,
  );
}

assert.deepEqual(
  selectBackfillTasks([
    { id: 'open', status: 'open' },
    { id: 'active', status: 'in_progress' },
    { id: 'blocked', status: 'blocked' },
    { id: 'closed', status: 'closed' },
  ]).map((item) => item.id),
  ['open', 'active', 'blocked'],
);
assert.deepEqual(summarizeMirrorResults([{ status: 'ok' }, { status: 'failed' }]), {
  total: 2,
  failures: 1,
  ok: false,
});
assert.equal(sanitizeMirrorText('/home/owner/private.log'), '[PRIVATE_PATH]');
assert.equal(
  sanitizeMirrorText('C:\\Users\\Owner Name\\Private Logs\\raw log.txt'),
  '[PRIVATE_PATH]',
);
assert.equal(sanitizeMirrorText('ghp_ABCDEF1234567890'), '[REDACTED_TOKEN]');
assert.equal(sanitizeMirrorText('github_pat_1234567890_ABCDEF'), '[REDACTED_TOKEN]');
assert.equal(
  sanitizeMirrorText('Authorization Bearer synthetic-bearer-credential-123'),
  'Authorization Bearer [REDACTED]',
);
assert.equal(sanitizeMirrorText('Bearer synthetic-bearer-credential-456'), 'Bearer [REDACTED]');
assert.equal(sanitizeMirrorText('password=correct horse battery staple'), 'password=[REDACTED]');
assert.equal(
  sanitizeMirrorText('api_key=synthetic multiword credential value'),
  'api_key=[REDACTED]',
);
assert.equal(sanitizeMirrorText('device-id=synthetic-device-value'), 'device-id=[DEVICE]');
assert.equal(sanitizeMirrorText('serial-number=synthetic-serial-value'), 'serial-number=[DEVICE]');
assert.equal(sanitizeMirrorText('D:/Private Workspace/Logs/raw trace.txt'), '[PRIVATE_PATH]');
assert.equal(sanitizeMirrorText('ZX12-FAKE-9000'), '[DEVICE]');
assert.equal(sanitizeMirrorText('gymcoach-js4'), 'gymcoach-js4');
assert.equal(sanitizeMirrorText('R58M12ABC34'), '[DEVICE]');
assert.equal(sanitizeMirrorText('abc123def456'), '[DEVICE]');
assert.equal(sanitizeMirrorText('123456789012345'), '[DEVICE]');
assert.equal(sanitizeMirrorText('123e4567-e89b-12d3-a456-426614174000'), '[DEVICE]');

const hostileEvidencePayload = buildIssuePayload(task, issues[0], {
  kind: 'integration',
  integrationHead: '3'.repeat(40),
  delivery: { installed: 'api_key=synthetic multiword credential value' },
  android: {
    versionName: '1.2.3',
    versionCode: 'device-id=synthetic-device-value',
    sizeBytes: 'serial-number=synthetic-serial-value',
    sha256: '4'.repeat(64),
    signingCertificateSha256: '5'.repeat(64),
    apkFile: 'D:/Private Workspace/Artifacts/private.apk',
  },
});
assert.doesNotMatch(
  hostileEvidencePayload.body,
  /synthetic multiword credential value|synthetic-device-value|synthetic-serial-value|D:\/|Private Workspace|private\.apk/,
);
assert.match(hostileEvidencePayload.body, /\[DEVICE\]|\[REDACTED\]|\[PRIVATE_PATH\]/);
console.log('GitHub issue mirror regression tests passed.');
