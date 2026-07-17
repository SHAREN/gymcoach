import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  deriveAcceptanceDeliveryRequirements,
  IntegrationEvidenceError,
  validateIntegrationEvidence,
} from './check-integration-evidence.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = path.join(root, 'scripts/fixtures/integration-evidence');

function git(repo, ...args) {
  const result = spawnSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function gitStatus(repo, ...args) {
  return spawnSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    windowsHide: true,
  }).status;
}

async function loadFixture(name, replacements) {
  const source = await readFile(path.join(fixtureRoot, name), 'utf8');
  let rendered = source;
  for (const [token, value] of Object.entries(replacements)) {
    rendered = rendered.replaceAll(`{{${token}}}`, value);
  }
  return JSON.parse(rendered);
}

async function commitFile(repo, relativePath, contents, message) {
  const filePath = path.join(repo, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
  git(repo, 'add', relativePath);
  git(repo, 'commit', '-m', message);
  return git(repo, 'rev-parse', 'HEAD');
}

async function createProductRepo({ android = false } = {}) {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'gymcoach-integration-evidence-'));
  git(repo, 'init', '-b', 'codex/integration-root-request');
  git(repo, 'config', 'user.name', 'GymCoach Test');
  git(repo, 'config', 'user.email', 'gymcoach-test@example.invalid');
  const base = await commitFile(repo, 'README.md', 'base\n', 'base');
  git(repo, 'switch', '-c', 'task/gymcoach-nrh');
  const taskCommit = await commitFile(
    repo,
    android ? 'android/app/change.txt' : 'task-change.txt',
    'verified task\n',
    'task',
  );
  git(repo, 'switch', 'codex/integration-root-request');
  const integrationHead = await commitFile(repo, 'integration.txt', 'integration\n', 'integration');
  return { repo, base, taskCommit, integrationHead };
}

function beadsTask(
  id,
  acceptanceCriteria = 'No installation or production deployment is required.',
) {
  return {
    id,
    status: 'in_progress',
    labels: ['stage:verified'],
    acceptance_criteria: acceptanceCriteria,
    notes: '',
  };
}

function beadsAuthority(rootTaskId, tasks, blockingDependencies = {}) {
  return {
    rootTaskId,
    tasks: Object.fromEntries(tasks.map((task) => [task.id, task])),
    blockingDependencies: Object.fromEntries(
      tasks.map((task) => [task.id, blockingDependencies[task.id] ?? []]),
    ),
  };
}

async function expectRejected(manifest, repo, authority, pattern) {
  await assert.rejects(
    () => validateIntegrationEvidence(manifest, { repo, beadsAuthority: authority }),
    (error) => error instanceof IntegrationEvidenceError && pattern.test(error.message),
  );
}

async function testTaskBranchOnlyRegression() {
  const state = await createProductRepo();
  try {
    const manifest = await loadFixture('task-branch-only.json', {
      BASE: state.base,
      TASK_COMMIT: state.taskCommit,
      INTEGRATION_HEAD: state.integrationHead,
    });
    const authority = beadsAuthority('gymcoach-nrh', [beadsTask('gymcoach-nrh')]);
    await expectRejected(manifest, state.repo, authority, /not an ancestor of integration head/);
  } finally {
    await rm(state.repo, { recursive: true, force: true });
  }
}

async function testBehaviorEquivalentMapping() {
  const state = await createProductRepo();
  try {
    git(state.repo, 'cherry-pick', state.taskCommit);
    const replacementCommit = git(state.repo, 'rev-parse', 'HEAD');
    assert.notEqual(
      gitStatus(state.repo, 'merge-base', '--is-ancestor', state.taskCommit, replacementCommit),
      0,
    );
    const manifest = await loadFixture('behavior-equivalent.json', {
      BASE: state.base,
      TASK_COMMIT: state.taskCommit,
      REPLACEMENT_COMMIT: replacementCommit,
      INTEGRATION_HEAD: replacementCommit,
    });
    const authority = beadsAuthority('gymcoach-vax', [beadsTask('gymcoach-vax')]);
    const result = await validateIntegrationEvidence(manifest, {
      repo: state.repo,
      beadsAuthority: authority,
    });
    assert.equal(result.mappings[0].method, 'behavior-equivalent');
    const incompleteManifest = structuredClone(manifest);
    incompleteManifest.integration.requiredTaskIds.push('gymcoach-missing');
    await expectRejected(
      incompleteManifest,
      state.repo,
      authority,
      /missing or contains an unexpected required task/,
    );
  } finally {
    await rm(state.repo, { recursive: true, force: true });
  }
}

async function testNoRuntimeArtifactException() {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'gymcoach-no-runtime-'));
  try {
    git(repo, 'init', '-b', 'chore/gymcoach-js4');
    git(repo, 'config', 'user.name', 'GymCoach Test');
    git(repo, 'config', 'user.email', 'gymcoach-test@example.invalid');
    const base = await commitFile(repo, 'README.md', 'base\n', 'base');
    const taskCommit = await commitFile(repo, 'docs/workflow.md', 'workflow\n', 'harness');
    const manifest = await loadFixture('no-runtime-artifact.json', {
      BASE: base,
      TASK_COMMIT: taskCommit,
    });
    const authority = beadsAuthority('gymcoach-js4', [
      { ...beadsTask('gymcoach-js4'), labels: ['stage:verify'] },
    ]);
    const result = await validateIntegrationEvidence(manifest, { repo, beadsAuthority: authority });
    assert.equal(result.mode, 'no-runtime-artifact');

    const runtimeCommit = await commitFile(
      repo,
      'app/page.tsx',
      'export default null;\n',
      'runtime',
    );
    manifest.tasks[0].verified.commit = runtimeCommit;
    manifest.tasks[0].verified.gate.head = runtimeCommit;
    manifest.tasks[0].noRuntimeArtifact.changedPaths = ['app/page.tsx', 'docs/workflow.md'];
    await expectRejected(manifest, repo, authority, /includes runtime path app\/page\.tsx/);

    const runtimeOnlyPaths = [
      ['Dockerfile', 'FROM scratch\n'],
      ['scripts/build-runtime.mjs', 'export default {};\n'],
      ['scripts/release-apk.mjs', 'export default {};\n'],
      ['deployment/service.yml', 'service: gymcoach\n'],
      ['.github/actions/publish/action.yml', 'name: publish\n'],
    ];
    for (const [index, [runtimePath, contents]] of runtimeOnlyPaths.entries()) {
      git(repo, 'switch', '-c', `runtime-only-${index}`, taskCommit);
      const runtimeOnlyCommit = await commitFile(repo, runtimePath, contents, 'runtime path');
      manifest.tasks[0].verified.base = taskCommit;
      manifest.tasks[0].verified.commit = runtimeOnlyCommit;
      manifest.tasks[0].verified.gate.head = runtimeOnlyCommit;
      manifest.tasks[0].noRuntimeArtifact.changedPaths = [runtimePath];
      await expectRejected(
        manifest,
        repo,
        authority,
        new RegExp(`includes runtime path ${runtimePath.replaceAll('.', '\\.')}`),
      );
    }
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
}

async function testAndroidArtifactEvidence() {
  const state = await createProductRepo({ android: true });
  try {
    git(state.repo, 'merge', '--no-ff', 'task/gymcoach-nrh', '-m', 'integrate task');
    const integrationHead = git(state.repo, 'rev-parse', 'HEAD');
    const apk = Buffer.from('fresh integrated apk fixture');
    const sha256 = createHash('sha256').update(apk).digest('hex');
    const apkFile = `gymcoach-42-${sha256.slice(0, 12)}.apk`;
    await mkdir(path.join(state.repo, 'android/app/build/outputs/apk/debug'), { recursive: true });
    await mkdir(path.join(state.repo, 'data/android-release'), { recursive: true });
    await mkdir(path.join(state.repo, 'evidence'), { recursive: true });
    await writeFile(
      path.join(state.repo, 'android/app/build/outputs/apk/debug/app-debug.apk'),
      apk,
    );
    await cp(
      path.join(state.repo, 'android/app/build/outputs/apk/debug/app-debug.apk'),
      path.join(state.repo, 'data/android-release', apkFile),
    );
    await writeFile(
      path.join(state.repo, 'android/app/build/outputs/apk/debug/output-metadata.json'),
      `${JSON.stringify({ elements: [{ versionCode: 42, versionName: '1.2.3' }] }, null, 2)}\n`,
    );
    await writeFile(
      path.join(state.repo, 'data/android-release/latest.json'),
      `${JSON.stringify(
        {
          versionCode: 42,
          versionName: '1.2.3',
          sha256,
          sizeBytes: apk.length,
          publishedAt: '2026-07-17T00:00:00.000Z',
          apkFile,
        },
        null,
        2,
      )}\n`,
    );
    const certificate = 'ab'.repeat(32);
    const signatureOutput = `Signer #1 certificate SHA-256 digest: ${certificate}\n`;
    await writeFile(path.join(state.repo, 'evidence/debug-apksigner.txt'), signatureOutput);
    await writeFile(path.join(state.repo, 'evidence/immutable-apksigner.txt'), signatureOutput);
    const manifest = await loadFixture('android-integration.json', {
      BASE: state.base,
      TASK_COMMIT: state.taskCommit,
      INTEGRATION_HEAD: integrationHead,
      APK_FILE: apkFile,
    });
    const authority = beadsAuthority('gymcoach-android', [beadsTask('gymcoach-android')]);
    const result = await validateIntegrationEvidence(manifest, {
      repo: state.repo,
      beadsAuthority: authority,
    });
    assert.equal(result.android.sha256, sha256);
    assert.equal(result.android.signingCertificateSha256, certificate);

    const latestPath = path.join(state.repo, 'data/android-release/latest.json');
    const latest = JSON.parse(await readFile(latestPath, 'utf8'));
    latest.sha256 = '00'.repeat(32);
    await writeFile(latestPath, `${JSON.stringify(latest, null, 2)}\n`);
    await expectRejected(manifest, state.repo, authority, /latest\.json does not match/);
  } finally {
    await rm(state.repo, { recursive: true, force: true });
  }
}

async function testAuthoritativeBeadsBinding() {
  const state = await createProductRepo();
  try {
    git(state.repo, 'cherry-pick', state.taskCommit);
    const replacementCommit = git(state.repo, 'rev-parse', 'HEAD');
    const manifest = await loadFixture('behavior-equivalent.json', {
      BASE: state.base,
      TASK_COMMIT: state.taskCommit,
      REPLACEMENT_COMMIT: replacementCommit,
      INTEGRATION_HEAD: replacementCommit,
    });
    manifest.authority.rootTaskId = 'gymcoach-root';
    const root = {
      ...beadsTask('gymcoach-root'),
      status: 'blocked',
      labels: ['stage:ready'],
    };
    const authority = beadsAuthority(
      'gymcoach-root',
      [root, beadsTask('gymcoach-vax'), beadsTask('gymcoach-missing')],
      { 'gymcoach-root': ['gymcoach-vax', 'gymcoach-missing'] },
    );
    await expectRejected(
      manifest,
      state.repo,
      authority,
      /missing or contains an unexpected required task/,
    );
  } finally {
    await rm(state.repo, { recursive: true, force: true });
  }
}

async function testLegacyBehaviorEquivalentAudit() {
  const state = await createProductRepo();
  try {
    git(state.repo, 'cherry-pick', state.taskCommit);
    const activeReplacementCommit = git(state.repo, 'rev-parse', 'HEAD');
    git(state.repo, 'switch', '-c', 'task/gymcoach-legacy', state.base);
    const legacyCommit = await commitFile(
      state.repo,
      'legacy-change.txt',
      'legacy verified change\n',
      'legacy task',
    );
    git(state.repo, 'switch', 'codex/integration-root-request');
    assert.notEqual(
      gitStatus(state.repo, 'merge-base', '--is-ancestor', legacyCommit, activeReplacementCommit),
      0,
    );
    const manifest = await loadFixture('behavior-equivalent.json', {
      BASE: state.base,
      TASK_COMMIT: state.taskCommit,
      REPLACEMENT_COMMIT: activeReplacementCommit,
      INTEGRATION_HEAD: activeReplacementCommit,
    });
    manifest.authority.rootTaskId = 'gymcoach-root';
    manifest.legacyClosedTasks = [
      {
        id: 'gymcoach-legacy',
        note: 'Closed before guarded integration existed.',
        auditStatus: 'behavior-equivalent',
        verifiedCommit: legacyCommit,
      },
    ];
    const rootTask = {
      ...beadsTask('gymcoach-root'),
      status: 'blocked',
      labels: ['stage:ready'],
    };
    const legacyTask = {
      ...beadsTask('gymcoach-legacy'),
      status: 'closed',
      labels: [],
      notes: 'Legacy closure without guarded integration evidence.',
    };
    const authority = beadsAuthority(
      'gymcoach-root',
      [rootTask, beadsTask('gymcoach-vax'), legacyTask],
      { 'gymcoach-root': ['gymcoach-vax', 'gymcoach-legacy'] },
    );
    await expectRejected(
      manifest,
      state.repo,
      authority,
      /legacy closed task gymcoach-legacy behavior-equivalent mapping needs replacement commits/,
    );
    manifest.legacyClosedTasks[0].replacementCommits = [legacyCommit];
    await expectRejected(
      manifest,
      state.repo,
      authority,
      /legacy closed task gymcoach-legacy replacement commit .* is absent from the integration head/,
    );
    manifest.legacyClosedTasks[0].replacementCommits = [activeReplacementCommit];
    await expectRejected(
      manifest,
      state.repo,
      authority,
      /gymcoach-legacy\.legacyAudit\.reviewedBy must be a non-empty string/,
    );
    manifest.legacyClosedTasks[0].reviewedBy = 'independent integration verifier';
    await expectRejected(
      manifest,
      state.repo,
      authority,
      /gymcoach-legacy\.legacyAudit\.reviewEvidence must be a non-empty string/,
    );
    manifest.legacyClosedTasks[0].reviewEvidence =
      'Legacy verified behavior and replacement were reviewed explicitly.';
    await expectRejected(
      manifest,
      state.repo,
      authority,
      /gymcoach-legacy\.legacyAudit\.mappingId must be a non-empty string/,
    );

    const legacyReplacementCommit = await commitFile(
      state.repo,
      'legacy-equivalent.txt',
      'reviewed equivalent legacy behavior\n',
      'map legacy behavior',
    );
    manifest.integration.head = legacyReplacementCommit;
    manifest.integration.combinedGate.head = legacyReplacementCommit;
    manifest.integration.review.head = legacyReplacementCommit;
    manifest.delivery.integrated.head = legacyReplacementCommit;
    Object.assign(manifest.legacyClosedTasks[0], {
      replacementCommits: [legacyReplacementCommit],
      mappingId: 'gymcoach-legacy-reviewed-equivalent',
    });
    const result = await validateIntegrationEvidence(manifest, {
      repo: state.repo,
      beadsAuthority: authority,
    });
    assert.match(result.warnings[0], /gymcoach-legacy audited as behavior-equivalent/);
  } finally {
    await rm(state.repo, { recursive: true, force: true });
  }
}

async function testAcceptanceCriteriaDeliveryRequirements() {
  const state = await createProductRepo();
  try {
    git(state.repo, 'cherry-pick', state.taskCommit);
    const replacementCommit = git(state.repo, 'rev-parse', 'HEAD');
    const manifest = await loadFixture('behavior-equivalent.json', {
      BASE: state.base,
      TASK_COMMIT: state.taskCommit,
      REPLACEMENT_COMMIT: replacementCommit,
      INTEGRATION_HEAD: replacementCommit,
    });
    manifest.authority.rootTaskId = 'gymcoach-root';
    const installRoot = {
      ...beadsTask(
        'gymcoach-root',
        '1. The integrated APK is installed in place and installation evidence is recorded. 2. No production deployment occurs.',
      ),
      status: 'blocked',
      labels: ['stage:ready'],
    };
    const installAuthority = beadsAuthority(
      'gymcoach-root',
      [installRoot, beadsTask('gymcoach-vax')],
      { 'gymcoach-root': ['gymcoach-vax'] },
    );
    await expectRejected(
      manifest,
      state.repo,
      installAuthority,
      /delivery\.installed\.required must match task acceptance requirements/,
    );

    const completedInstallManifest = structuredClone(manifest);
    completedInstallManifest.delivery.installed = {
      required: true,
      status: 'complete',
      evidence: 'Sanitized installation evidence.',
    };
    const completed = await validateIntegrationEvidence(completedInstallManifest, {
      repo: state.repo,
      beadsAuthority: installAuthority,
    });
    assert.deepEqual(completed.taskIds, ['gymcoach-vax']);
    assert.deepEqual(completed.coordinatorTaskIds, ['gymcoach-root']);
    assert.deepEqual(completed.closureTaskIds, ['gymcoach-vax', 'gymcoach-root']);

    const postClosureAuthority = beadsAuthority(
      'gymcoach-root',
      [
        {
          ...installRoot,
          status: 'closed',
          labels: [],
          notes: 'Guarded integration root coordination closure: head abc.',
        },
        {
          ...beadsTask('gymcoach-vax'),
          status: 'closed',
          labels: [],
          notes:
            'Immutable verification evidence: verified-base abc; verified-commit def.\nGuarded integration closure: head abc.',
        },
      ],
      { 'gymcoach-root': ['gymcoach-vax'] },
    );
    const postClosure = await validateIntegrationEvidence(completedInstallManifest, {
      repo: state.repo,
      beadsAuthority: postClosureAuthority,
    });
    assert.deepEqual(postClosure.taskIds, completed.taskIds);
    assert.deepEqual(postClosure.closureTaskIds, completed.closureTaskIds);
    assert.deepEqual(postClosure.alreadyGuardedTaskIds, ['gymcoach-root', 'gymcoach-vax']);

    const deployRoot = {
      ...beadsTask(
        'gymcoach-root',
        '1. No physical installation is required. 2. The integration must be deployed to the canonical runtime.',
      ),
      status: 'blocked',
      labels: ['stage:ready'],
    };
    const deployAuthority = beadsAuthority(
      'gymcoach-root',
      [deployRoot, beadsTask('gymcoach-vax')],
      { 'gymcoach-root': ['gymcoach-vax'] },
    );
    await expectRejected(
      manifest,
      state.repo,
      deployAuthority,
      /delivery\.deployed\.required must match task acceptance requirements/,
    );

    assert.deepEqual(
      deriveAcceptanceDeliveryRequirements([
        beadsTask(
          'safe-negative',
          'No installation is required and production deployment is prohibited.',
        ),
      ]),
      { installed: false, deployed: false },
    );
    assert.deepEqual(
      deriveAcceptanceDeliveryRequirements([
        beadsTask(
          'gymcoach-js4-shape',
          '5. Integrated, published, installed and deployed states are reported separately. Unauthorized physical installation or production deployment is never inferred; when installation/deployment is an acceptance criterion, the parent request remains visibly pending until evidence exists.',
        ),
      ]),
      { installed: false, deployed: false },
    );
    assert.deepEqual(
      deriveAcceptanceDeliveryRequirements([
        beadsTask(
          'post-verb-conditions',
          '1. Install only if separately authorized. 2. Deploy only when production authority exists. 3. Install and deploy must not occur.',
        ),
      ]),
      { installed: false, deployed: false },
    );
    assert.deepEqual(
      deriveAcceptanceDeliveryRequirements([
        beadsTask(
          'direct-delivery-obligations',
          '1. The APK must be installed. 2. The app must be deployed.',
        ),
      ]),
      { installed: true, deployed: true },
    );
    assert.deepEqual(
      deriveAcceptanceDeliveryRequirements([
        beadsTask(
          'metadata-only-delivery-terms',
          '1. Install and deploy appear only as metadata fields. 2. Install and deploy are status labels, not delivery requirements.',
        ),
      ]),
      { installed: false, deployed: false },
    );
    assert.deepEqual(
      deriveAcceptanceDeliveryRequirements([
        beadsTask(
          'direct-imperative-delivery',
          '1. Install the integrated APK in place. 2. Deploy the service to production.',
        ),
      ]),
      { installed: true, deployed: true },
    );
  } finally {
    await rm(state.repo, { recursive: true, force: true });
  }
}

await testTaskBranchOnlyRegression();
await testBehaviorEquivalentMapping();
await testNoRuntimeArtifactException();
await testAndroidArtifactEvidence();
await testAuthoritativeBeadsBinding();
await testLegacyBehaviorEquivalentAudit();
await testAcceptanceCriteriaDeliveryRequirements();
console.log('Integration evidence regression tests passed.');
