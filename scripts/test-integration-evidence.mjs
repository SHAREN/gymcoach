import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildImmutableVerificationNote,
  deriveAcceptanceDeliveryRequirements,
  IntegrationEvidenceError,
  isNoRuntimeArtifactPath,
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
    labels: ['stage:awaiting-integration'],
    acceptance_criteria: acceptanceCriteria,
    notes: '',
  };
}

function verifiedBeadsTask(
  manifest,
  id,
  {
    acceptanceCriteria = 'No installation or production deployment is required.',
    status = 'in_progress',
    labels = ['stage:awaiting-integration'],
    additionalNotes = '',
  } = {},
) {
  const task = manifest.tasks.find((entry) => entry.id === id);
  assert.ok(task, `manifest task ${id} is required`);
  const artifactImpact =
    task.classification === 'no-runtime-artifact'
      ? 'no-runtime-artifact'
      : task.affectsAndroid === true
        ? 'android'
        : 'runtime';
  return {
    ...beadsTask(id, acceptanceCriteria),
    status,
    labels,
    notes: [
      buildImmutableVerificationNote({
        verifiedBase: task.verified.base,
        verifiedCommit: task.verified.commit,
        gate: task.verified.gate,
        artifactImpact,
      }),
      additionalNotes,
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

function coordinatorTask(
  id,
  acceptanceCriteria = 'No installation or production deployment is required.',
) {
  return {
    ...beadsTask(id, acceptanceCriteria),
    status: 'in_progress',
    labels: ['role:integration-coordinator'],
  };
}

function createMinimalApk() {
  const entries = [
    ['AndroidManifest.xml', Buffer.from('manifest')],
    ['classes.dex', Buffer.from('dex')],
  ];
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [name, contents] of entries) {
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(contents.length, 18);
    local.writeUInt32LE(contents.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    localParts.push(local, nameBytes, contents);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(contents.length, 20);
    central.writeUInt32LE(contents.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBytes);
    offset += local.length + nameBytes.length + contents.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, eocd]);
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
    const authority = beadsAuthority('gymcoach-nrh', [verifiedBeadsTask(manifest, 'gymcoach-nrh')]);
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
    const authority = beadsAuthority('gymcoach-vax', [verifiedBeadsTask(manifest, 'gymcoach-vax')]);
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
      verifiedBeadsTask(manifest, 'gymcoach-js4', { labels: ['stage:verify'] }),
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
    authority.tasks['gymcoach-js4'] = verifiedBeadsTask(manifest, 'gymcoach-js4', {
      labels: ['stage:verify'],
    });
    await expectRejected(manifest, repo, authority, /includes runtime path app\/page\.tsx/);

    const runtimeOnlyPaths = [
      ['Dockerfile', 'FROM scratch\n'],
      ['.dockerignore', 'node_modules\n'],
      ['postcss.config.js', 'export default {};\n'],
      ['tailwind.config.ts', 'export default {};\n'],
      ['tsconfig.json', '{}\n'],
      ['prisma.config.ts', 'export default {};\n'],
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
      authority.tasks['gymcoach-js4'] = verifiedBeadsTask(manifest, 'gymcoach-js4', {
        labels: ['stage:verify'],
      });
      await expectRejected(
        manifest,
        repo,
        authority,
        new RegExp(`includes runtime path ${runtimePath.replaceAll('.', '\\.')}`),
      );
    }

    git(repo, 'switch', '-c', 'allowed-harness-publish', taskCommit);
    const publishHarnessCommit = await commitFile(
      repo,
      'scripts/publish-integration-draft.mjs',
      'export default {};\n',
      'harness publication workflow',
    );
    manifest.tasks[0].verified.base = taskCommit;
    manifest.tasks[0].verified.commit = publishHarnessCommit;
    manifest.tasks[0].verified.gate.head = publishHarnessCommit;
    manifest.tasks[0].noRuntimeArtifact.changedPaths = ['scripts/publish-integration-draft.mjs'];
    authority.tasks['gymcoach-js4'] = verifiedBeadsTask(manifest, 'gymcoach-js4', {
      labels: ['stage:verify'],
    });
    const allowedHarness = await validateIntegrationEvidence(manifest, {
      repo,
      beadsAuthority: authority,
    });
    assert.equal(allowedHarness.mode, 'no-runtime-artifact');
    assert.equal(isNoRuntimeArtifactPath('scripts/publish-integration-draft.mjs'), true);
    assert.equal(isNoRuntimeArtifactPath('scripts/harness-status.ps1'), true);
    assert.equal(isNoRuntimeArtifactPath('scripts/harness-status-core.mjs'), true);
    assert.equal(isNoRuntimeArtifactPath('scripts/fixtures/harness-status/complete.json'), true);
    assert.equal(isNoRuntimeArtifactPath('.dockerignore'), false);

    authority.tasks['gymcoach-js4'] = {
      ...authority.tasks['gymcoach-js4'],
      status: 'closed',
      labels: [],
      notes: `${authority.tasks['gymcoach-js4'].notes}\nGuarded no-runtime-artifact closure at verified commit ${publishHarnessCommit}.`,
    };
    const closedHarness = await validateIntegrationEvidence(manifest, {
      repo,
      beadsAuthority: authority,
    });
    assert.deepEqual(closedHarness.alreadyGuardedTaskIds, ['gymcoach-js4']);

    const verifiedHarnessTask = verifiedBeadsTask(manifest, 'gymcoach-js4', {
      labels: ['stage:verify'],
    });
    authority.tasks['gymcoach-js4'] = {
      ...verifiedHarnessTask,
      status: 'closed',
      labels: ['stage:verify'],
      notes: `${verifiedHarnessTask.notes}\nGuarded no-runtime-artifact closure with fabricated text.`,
    };
    await expectRejected(
      manifest,
      repo,
      authority,
      /closed without exactly one matching guarded closure note and no stage labels/,
    );

    authority.tasks['gymcoach-js4'] = {
      ...verifiedHarnessTask,
      status: 'closed',
      labels: [],
      notes: `${verifiedHarnessTask.notes}\nGuarded no-runtime-artifact closure at verified commit ${'f'.repeat(40)}.`,
    };
    await expectRejected(
      manifest,
      repo,
      authority,
      /closed without exactly one matching guarded closure note and no stage labels/,
    );

    const matchingClosureNote = `Guarded no-runtime-artifact closure at verified commit ${publishHarnessCommit}.`;
    authority.tasks['gymcoach-js4'] = {
      ...verifiedHarnessTask,
      status: 'closed',
      labels: [],
      notes: `${verifiedHarnessTask.notes}\n${matchingClosureNote}\n${matchingClosureNote}`,
    };
    await expectRejected(
      manifest,
      repo,
      authority,
      /closed without exactly one matching guarded closure note and no stage labels/,
    );
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
}

async function testAndroidArtifactEvidence() {
  const state = await createProductRepo({ android: true });
  try {
    git(state.repo, 'merge', '--no-ff', 'task/gymcoach-nrh', '-m', 'integrate task');
    const integrationHead = git(state.repo, 'rev-parse', 'HEAD');
    const apk = createMinimalApk();
    const sha256 = createHash('sha256').update(apk).digest('hex');
    const apkFile = `gymcoach-42-${sha256.slice(0, 12)}.apk`;
    await mkdir(path.join(state.repo, 'android/app/build/outputs/apk/debug'), { recursive: true });
    await mkdir(path.join(state.repo, 'data/android-release'), { recursive: true });
    const androidSdkRoot = path.join(state.repo, 'test-sdk');
    const buildTools = path.join(androidSdkRoot, 'build-tools', '35.0.0');
    await mkdir(buildTools, { recursive: true });
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
    const apksignerPath = path.join(buildTools, 'apksigner');
    const aaptPath = path.join(buildTools, 'aapt');
    await writeFile(apksignerPath, 'test tool fixture\n');
    await writeFile(aaptPath, 'test tool fixture\n');
    const certificate = 'ab'.repeat(32);
    const manifest = await loadFixture('android-integration.json', {
      BASE: state.base,
      TASK_COMMIT: state.taskCommit,
      INTEGRATION_HEAD: integrationHead,
      APK_FILE: apkFile,
      APKSIGNER_PATH: path.relative(state.repo, apksignerPath).replaceAll('\\', '/'),
      AAPT_PATH: path.relative(state.repo, aaptPath).replaceAll('\\', '/'),
    });
    const authority = beadsAuthority('gymcoach-android', [
      verifiedBeadsTask(manifest, 'gymcoach-android'),
    ]);
    const toolCalls = [];
    const androidToolRunner = (executable, args) => {
      toolCalls.push({ executable: path.basename(executable), args });
      if (path.basename(executable) === 'apksigner') {
        return args[0] === 'version'
          ? '0.9-test\n'
          : `Signer #1 certificate SHA-256 digest: ${certificate}\n`;
      }
      return args[0] === 'version'
        ? 'Android Asset Packaging Tool, v0.2-test\n'
        : "package: name='org.sharteman.gymcoach' versionCode='42' versionName='1.2.3'\n";
    };
    const result = await validateIntegrationEvidence(manifest, {
      repo: state.repo,
      beadsAuthority: authority,
      androidToolRunner,
      androidSdkRoot,
    });
    assert.equal(result.android.sha256, sha256);
    assert.equal(result.android.signingCertificateSha256, certificate);
    assert.deepEqual(
      toolCalls.map(({ executable, args }) => `${executable} ${args.slice(0, 2).join(' ')}`),
      [
        'apksigner version',
        'aapt version',
        'apksigner verify --print-certs',
        'apksigner verify --print-certs',
        'aapt dump badging',
        'aapt dump badging',
      ],
    );

    const fakeToolPath = path.join(state.repo, 'apksigner');
    await writeFile(fakeToolPath, 'not an SDK build tool\n');
    const fakeToolManifest = structuredClone(manifest);
    fakeToolManifest.android.apksignerPath = 'apksigner';
    await assert.rejects(
      () =>
        validateIntegrationEvidence(fakeToolManifest, {
          repo: state.repo,
          beadsAuthority: authority,
          androidToolRunner,
          androidSdkRoot,
        }),
      /must resolve under the configured Android SDK build-tools directory/,
    );

    const debugPath = path.join(state.repo, 'android/app/build/outputs/apk/debug/app-debug.apk');
    await writeFile(debugPath, Buffer.from('arbitrary bytes'));
    await assert.rejects(
      () =>
        validateIntegrationEvidence(manifest, {
          repo: state.repo,
          beadsAuthority: authority,
          androidToolRunner,
          androidSdkRoot,
        }),
      /not a structurally valid ZIP\/APK/,
    );
    await writeFile(debugPath, apk);

    const latestPath = path.join(state.repo, 'data/android-release/latest.json');
    const latest = JSON.parse(await readFile(latestPath, 'utf8'));
    latest.sha256 = '00'.repeat(32);
    await writeFile(latestPath, `${JSON.stringify(latest, null, 2)}\n`);
    await assert.rejects(
      () =>
        validateIntegrationEvidence(manifest, {
          repo: state.repo,
          beadsAuthority: authority,
          androidToolRunner,
          androidSdkRoot,
        }),
      /latest\.json does not match/,
    );
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
    const root = coordinatorTask('gymcoach-root');
    const authority = beadsAuthority(
      'gymcoach-root',
      [
        root,
        verifiedBeadsTask(manifest, 'gymcoach-vax'),
        {
          ...beadsTask('gymcoach-missing'),
          notes: buildImmutableVerificationNote({
            verifiedBase: state.base,
            verifiedCommit: state.taskCommit,
            gate: {
              head: state.taskCommit,
              command: 'bash scripts/verify.sh',
              exitCode: 0,
            },
            artifactImpact: 'runtime',
          }),
        },
      ],
      { 'gymcoach-root': ['gymcoach-vax', 'gymcoach-missing'] },
    );
    await expectRejected(
      manifest,
      state.repo,
      authority,
      /missing or contains an unexpected required task/,
    );

    const substituted = structuredClone(manifest);
    substituted.authority.rootTaskId = 'gymcoach-vax';
    substituted.tasks[0].verified.gate.command = 'npm test';
    await expectRejected(
      substituted,
      state.repo,
      beadsAuthority('gymcoach-vax', [verifiedBeadsTask(manifest, 'gymcoach-vax')]),
      /does not match exactly one immutable Beads note/,
    );

    for (const invalidRoot of [
      { ...coordinatorTask('gymcoach-root'), labels: ['stage:ready'] },
      { ...coordinatorTask('gymcoach-root'), status: 'blocked' },
      { ...coordinatorTask('gymcoach-root'), labels: [] },
    ]) {
      await expectRejected(
        manifest,
        state.repo,
        beadsAuthority(
          'gymcoach-root',
          [invalidRoot, verifiedBeadsTask(manifest, 'gymcoach-vax')],
          { 'gymcoach-root': ['gymcoach-vax'] },
        ),
        /must be stage:awaiting-integration|coordinator authority requires/,
      );
    }
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
    const rootTask = coordinatorTask('gymcoach-root');
    const legacyTask = {
      ...beadsTask('gymcoach-legacy'),
      status: 'closed',
      labels: [],
      notes: `Immutable verification evidence: verified-base ${state.base}; verified-commit ${legacyCommit}; gates passed.`,
    };
    const authority = beadsAuthority(
      'gymcoach-root',
      [rootTask, verifiedBeadsTask(manifest, 'gymcoach-vax'), legacyTask],
      { 'gymcoach-root': ['gymcoach-vax', 'gymcoach-legacy'] },
    );
    const mismatchedLegacy = structuredClone(manifest);
    mismatchedLegacy.legacyClosedTasks[0].verifiedCommit = state.taskCommit;
    await expectRejected(
      mismatchedLegacy,
      state.repo,
      authority,
      /does not match recorded legacy immutable verification notes/,
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
    const installRoot = coordinatorTask(
      'gymcoach-root',
      '1. The integrated APK is installed in place and installation evidence is recorded. 2. No production deployment occurs.',
    );
    const installAuthority = beadsAuthority(
      'gymcoach-root',
      [installRoot, verifiedBeadsTask(manifest, 'gymcoach-vax')],
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
          labels: ['role:integration-coordinator'],
          notes: `Guarded integration root coordination closure: head ${replacementCommit}; integrated=complete; published=not-required; installed=complete; deployed=not-authorized.`,
        },
        {
          ...verifiedBeadsTask(manifest, 'gymcoach-vax'),
          status: 'closed',
          labels: [],
          notes: `${verifiedBeadsTask(manifest, 'gymcoach-vax').notes}\nGuarded integration closure: head ${replacementCommit}; integrated=complete; published=not-required; installed=complete; deployed=not-authorized.`,
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

    const deployRoot = coordinatorTask(
      'gymcoach-root',
      '1. No physical installation is required. 2. The integration must be deployed to the canonical runtime.',
    );
    const deployAuthority = beadsAuthority(
      'gymcoach-root',
      [deployRoot, verifiedBeadsTask(manifest, 'gymcoach-vax')],
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
          'delivery-grammar-regression',
          '1. Deploy the integrated version. 2. For example, the app is deployed in a preview environment.',
        ),
      ]),
      { installed: false, deployed: true },
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

function testCurrentHarnessDiffIsExceptionEligible() {
  const paths = git(
    root,
    'diff',
    '--name-only',
    'bce854ab095480e3ff0f15fb3b032bc194af487a..HEAD',
  ).split(/\r?\n/);
  assert.equal(paths.length > 0, true);
  assert.deepEqual(
    paths.filter((file) => !isNoRuntimeArtifactPath(file)),
    [],
  );
}

await testTaskBranchOnlyRegression();
await testBehaviorEquivalentMapping();
await testNoRuntimeArtifactException();
await testAndroidArtifactEvidence();
await testAuthoritativeBeadsBinding();
await testLegacyBehaviorEquivalentAudit();
await testAcceptanceCriteriaDeliveryRequirements();
testCurrentHarnessDiffIsExceptionEligible();
console.log('Integration evidence regression tests passed.');
