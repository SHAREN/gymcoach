#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import net from 'node:net';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE_PROJECT = 'gymcoach-test';
const COMPOSE_FILE = 'docker-compose.test.yml';
const TEST_SERVICE = 'test-db';
const TEST_CONTAINER = 'gymcoach-test-db';
const TEST_SCOPE_LABEL = 'org.gymcoach.scope';
const TEST_SCOPE_VALUE = 'test-only';
const TEST_PORT = 5434;
const CANONICAL_PROJECT = 'gymcoach';

function run(command, args, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.error && !allowFailure) {
    throw result.error;
  }
  if ((result.status ?? 1) !== 0 && !allowFailure) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(`${command} ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
  }
  return result;
}

function detectDocker() {
  const direct = run('docker', ['version', '--format', '{{.Server.Version}}'], {
    allowFailure: true,
  });
  if ((direct.status ?? 1) === 0) {
    return { command: 'docker', prefix: [] };
  }

  if (process.platform === 'win32') {
    const wsl = run(
      'wsl.exe',
      ['--cd', ROOT, 'docker', 'version', '--format', '{{.Server.Version}}'],
      { allowFailure: true },
    );
    if ((wsl.status ?? 1) === 0) {
      return { command: 'wsl.exe', prefix: ['--cd', ROOT, 'docker'] };
    }
  }

  throw new Error('Docker is unavailable through both the local CLI and WSL Docker.');
}

const dockerRunner = detectDocker();

function docker(args, options) {
  return run(dockerRunner.command, [...dockerRunner.prefix, ...args], options);
}

function compose(args) {
  return docker(['compose', '--project-name', COMPOSE_PROJECT, '--file', COMPOSE_FILE, ...args]);
}

function parseJson(output, context) {
  try {
    return JSON.parse(output);
  } catch (error) {
    throw new Error(
      `Could not parse ${context}: ${error instanceof Error ? error.message : error}`,
    );
  }
}

function inspectOptional(name) {
  const result = docker(['inspect', name], { allowFailure: true });
  if ((result.status ?? 1) !== 0) {
    const detail = `${result.stderr || ''}${result.stdout || ''}`;
    if (/no such (object|container)/i.test(detail)) return null;
    throw new Error(`Could not inspect ${name}: ${detail.trim()}`);
  }
  const records = parseJson(result.stdout, `docker inspect output for ${name}`);
  return records[0] ?? null;
}

function inspectIds(ids) {
  return ids.map((id) => {
    const record = inspectOptional(id);
    if (!record) throw new Error(`Container ${id} disappeared during safety validation.`);
    return record;
  });
}

function listIds(args) {
  const output = docker([...args, '--format', '{{.ID}}']).stdout.trim();
  return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

function labels(record) {
  return record.Config?.Labels ?? {};
}

function containerName(record) {
  return String(record.Name ?? '').replace(/^\//, '');
}

function publishedPorts(record) {
  return Object.values(record.NetworkSettings?.Ports ?? {})
    .flatMap((bindings) => bindings ?? [])
    .map((binding) => Number(binding.HostPort));
}

function validateComposeConfig() {
  const output = compose(['config', '--format', 'json']).stdout;
  const config = parseJson(output, 'resolved test Compose config');
  const serviceNames = Object.keys(config.services ?? {});
  if (
    config.name !== COMPOSE_PROJECT ||
    serviceNames.length !== 1 ||
    serviceNames[0] !== TEST_SERVICE
  ) {
    throw new Error(
      'Resolved test Compose scope is ambiguous; expected only gymcoach-test/test-db.',
    );
  }

  const service = config.services[TEST_SERVICE];
  const ports = service?.ports ?? [];
  const hasExpectedPort =
    ports.length === 1 &&
    Number(ports[0]?.target) === 5432 &&
    Number(ports[0]?.published) === TEST_PORT;
  const tmpfs = service?.tmpfs ?? [];
  const serviceLabels = service?.labels ?? {};

  if (
    service?.container_name !== TEST_CONTAINER ||
    !hasExpectedPort ||
    !tmpfs.includes('/var/lib/postgresql/data') ||
    (service?.volumes?.length ?? 0) !== 0 ||
    serviceLabels[TEST_SCOPE_LABEL] !== TEST_SCOPE_VALUE
  ) {
    throw new Error(
      'Resolved test Compose config is not the expected test-only Postgres contract.',
    );
  }
}

function validateTestContainer(record) {
  const recordLabels = labels(record);
  if (
    containerName(record) !== TEST_CONTAINER ||
    recordLabels['com.docker.compose.project'] !== COMPOSE_PROJECT ||
    recordLabels['com.docker.compose.service'] !== TEST_SERVICE ||
    recordLabels[TEST_SCOPE_LABEL] !== TEST_SCOPE_VALUE
  ) {
    throw new Error(
      `Refusing to manage ambiguous test container ${containerName(record) || record.Id}.`,
    );
  }

  const ports = [...new Set(publishedPorts(record))];
  if (ports.length !== 1 || ports[0] !== TEST_PORT || ports.includes(3030)) {
    throw new Error(`Refusing to manage ${TEST_CONTAINER} with unexpected published ports.`);
  }

  const mounts = record.Mounts ?? [];
  const tmpfs = record.HostConfig?.Tmpfs ?? {};
  if (
    mounts.some((mount) => mount.Type === 'volume') ||
    !Object.prototype.hasOwnProperty.call(tmpfs, '/var/lib/postgresql/data')
  ) {
    throw new Error(`Refusing to manage ${TEST_CONTAINER} without the expected tmpfs database.`);
  }
}

function projectResourceIds(resource) {
  return listIds([
    resource,
    'ls',
    '--filter',
    `label=com.docker.compose.project=${COMPOSE_PROJECT}`,
  ]);
}

function validateCurrentTestScope() {
  const projectContainers = inspectIds(
    listIds(['ps', '-a', '--filter', `label=com.docker.compose.project=${COMPOSE_PROJECT}`]),
  );
  for (const record of projectContainers) validateTestContainer(record);

  const namedContainer = inspectOptional(TEST_CONTAINER);
  if (namedContainer) validateTestContainer(namedContainer);

  const publishedOnTestPort = inspectIds(listIds(['ps', '-a', '--filter', `publish=${TEST_PORT}`]));
  for (const record of publishedOnTestPort) validateTestContainer(record);

  const networks = projectResourceIds('network');
  for (const id of networks) {
    const records = parseJson(docker(['network', 'inspect', id]).stdout, `network ${id}`);
    const network = records[0];
    if (
      network?.Name !== `${COMPOSE_PROJECT}_default` ||
      network?.Labels?.['com.docker.compose.project'] !== COMPOSE_PROJECT
    ) {
      throw new Error(`Refusing to manage ambiguous test network ${network?.Name ?? id}.`);
    }
  }

  const volumes = projectResourceIds('volume');
  if (volumes.length > 0) {
    throw new Error('Refusing to manage a test Compose project with persistent volumes.');
  }

  return {
    hasResources: projectContainers.length > 0 || networks.length > 0,
  };
}

async function isPortOpen(port) {
  return await new Promise((resolveOpen) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const finish = (open) => {
      socket.destroy();
      resolveOpen(open);
    };
    socket.setTimeout(500);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function requireHealth(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (response.status !== 200) {
    throw new Error(`${url} returned HTTP ${response.status}; expected 200.`);
  }
}

async function captureCanonical() {
  const app = inspectOptional('gymcoach-app');
  const db = inspectOptional('gymcoach-db');
  if (!app && !db) {
    console.error('Canonical containers are absent; test isolation will still be enforced.');
    return null;
  }
  if (!app || !db) {
    throw new Error(
      'Canonical runtime identity is ambiguous: gymcoach-app and gymcoach-db must both exist.',
    );
  }

  const appLabels = labels(app);
  const dbLabels = labels(db);
  if (
    appLabels['com.docker.compose.project'] !== CANONICAL_PROJECT ||
    appLabels['com.docker.compose.service'] !== 'app' ||
    dbLabels['com.docker.compose.project'] !== CANONICAL_PROJECT ||
    dbLabels['com.docker.compose.service'] !== 'db' ||
    !app.State?.Running ||
    !db.State?.Running ||
    !publishedPorts(app).includes(3030)
  ) {
    throw new Error(
      'Canonical runtime labels, state, or port 3030 do not match the safety contract.',
    );
  }

  const dbMount = (db.Mounts ?? []).find(
    (mount) => mount.Destination === '/var/lib/postgresql/data',
  );
  if (dbMount?.Type !== 'volume' || !dbMount.Name) {
    throw new Error('Canonical database volume identity is missing or ambiguous.');
  }

  await requireHealth('http://127.0.0.1:3030/login');
  await requireHealth('http://192.168.0.119:3030/login');

  const snapshot = {
    app: {
      id: app.Id,
      startedAt: app.State.StartedAt,
      imageId: app.Image,
    },
    db: {
      id: db.Id,
      startedAt: db.State.StartedAt,
      imageId: db.Image,
      volume: {
        name: dbMount.Name,
        source: dbMount.Source,
        destination: dbMount.Destination,
      },
    },
  };

  console.error(
    `Canonical snapshot: app=${snapshot.app.id.slice(0, 12)} started=${snapshot.app.startedAt} ` +
      `image=${snapshot.app.imageId}; db=${snapshot.db.id.slice(0, 12)} ` +
      `started=${snapshot.db.startedAt} image=${snapshot.db.imageId} ` +
      `volume=${snapshot.db.volume.name}.`,
  );
  return snapshot;
}

function encodeSnapshot(canonical) {
  return Buffer.from(JSON.stringify({ canonical }), 'utf8').toString('base64url');
}

function decodeSnapshot(value) {
  if (!value) throw new Error('A canonical snapshot token is required.');
  return parseJson(Buffer.from(value, 'base64url').toString('utf8'), 'canonical snapshot token');
}

async function assertCanonical(expected) {
  const current = await captureCanonical();
  if (JSON.stringify(current) !== JSON.stringify(expected)) {
    throw new Error('Canonical container ID, start time, image, or database volume changed.');
  }
}

async function snapshot() {
  validateComposeConfig();
  validateCurrentTestScope();
  process.stdout.write(encodeSnapshot(await captureCanonical()));
}

async function up(snapshotToken) {
  const { canonical } = decodeSnapshot(snapshotToken);
  validateComposeConfig();
  const currentScope = validateCurrentTestScope();
  await assertCanonical(canonical);

  if (currentScope.hasResources || inspectOptional(TEST_CONTAINER)) {
    compose(['down', '--volumes', '--timeout', '10']);
    validateCurrentTestScope();
  }
  if (await isPortOpen(TEST_PORT)) {
    throw new Error(`Port ${TEST_PORT} is still occupied after scoped test cleanup.`);
  }

  compose(['up', '-d', '--wait', TEST_SERVICE]);
  const container = inspectOptional(TEST_CONTAINER);
  if (!container) throw new Error(`${TEST_CONTAINER} was not created.`);
  validateTestContainer(container);
  if (!(await isPortOpen(TEST_PORT))) {
    throw new Error(`Port ${TEST_PORT} did not become available.`);
  }
  await assertCanonical(canonical);
}

async function down(snapshotToken) {
  const { canonical } = decodeSnapshot(snapshotToken);
  validateComposeConfig();
  validateCurrentTestScope();
  compose(['down', '--volumes', '--timeout', '10']);

  const remaining = validateCurrentTestScope();
  if (remaining.hasResources || inspectOptional(TEST_CONTAINER)) {
    throw new Error('Scoped test Compose resources remain after cleanup.');
  }
  if (await isPortOpen(TEST_PORT)) {
    throw new Error(`Port ${TEST_PORT} remains occupied after scoped test cleanup.`);
  }
  await assertCanonical(canonical);
}

const [command, snapshotToken] = process.argv.slice(2);

try {
  if (command === 'snapshot') await snapshot();
  else if (command === 'up') await up(snapshotToken);
  else if (command === 'down') await down(snapshotToken);
  else if (command === 'assert') {
    validateComposeConfig();
    validateCurrentTestScope();
    await assertCanonical(decodeSnapshot(snapshotToken).canonical);
  } else {
    throw new Error('Usage: test-compose-safety.mjs snapshot|up|down|assert [snapshot-token]');
  }
} catch (error) {
  console.error(
    `Test Compose safety check failed: ${error instanceof Error ? error.message : error}`,
  );
  process.exitCode = 1;
}
