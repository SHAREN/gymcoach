#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const INCIDENT_POLICY = {
  maxAgeHours: 24,
  maxEvents: 100,
  maxBytes: 128 * 1024,
  persistentStoreMaxEvents: 500,
  persistentStoreMaxBytes: 128 * 1024,
  persistentSweepIntervalSeconds: 60,
  containerMaxFileSize: '5m',
  containerMaxFiles: 3,
};

const LOG_PREFIX = '[gymcoach.mobile-settings] ';
const CORRELATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SAFE_VALUE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_METHOD_PATTERN = /^[A-Z]{1,12}$/;
const SUBREQUEST_PATHS = {
  profile: '/api/profile',
  gyms: '/api/gyms',
  exercises: '/api/mobile/exercises',
  'gym-equipment': '/api/gyms/diagnostic-health-probe/equipment',
};
const MOBILE_TOKEN_PATTERN = /^gma_[A-Za-z0-9_-]{43}$/;
const TOKEN_HASH_PATTERN = /^[A-Fa-f0-9]{64}$/;
const ROUTES = new Set([
  '/api/profile',
  '/api/gyms',
  '/api/mobile/exercises',
  '/api/gyms/:gymId/equipment',
]);
const OUTCOMES = new Set([
  'missing',
  'malformed',
  'not-found',
  'revoked',
  'expired',
  'valid',
  'unavailable',
]);
const SCHEMES = new Set(['none', 'bearer', 'cookie']);
const ERROR_CODES = new Set([
  'ok',
  'mobile_auth_missing',
  'mobile_auth_malformed',
  'mobile_auth_not_found',
  'mobile_auth_revoked',
  'mobile_auth_expired',
  'mobile_auth_unavailable',
  'auth_rejected',
  'endpoint_authority_mismatch',
  'request_rejected',
  'server_schema_failure',
]);

function safeValue(value, fallback) {
  const text = typeof value === 'string' ? value : '';
  return SAFE_VALUE_PATTERN.test(text) ? text : fallback;
}

function isSafeCorrelationId(value) {
  return (
    CORRELATION_PATTERN.test(value) &&
    !MOBILE_TOKEN_PATTERN.test(value) &&
    !TOKEN_HASH_PATTERN.test(value)
  );
}

function safeTimestamp(value) {
  const timestamp = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function sanitizeEvent(value, correlationId, minimumTimestamp) {
  if (!value || typeof value !== 'object') return null;
  const timestamp = safeTimestamp(value.timestamp);
  if (
    value.schemaVersion !== 1 ||
    value.kind !== 'mobile-settings-request' ||
    !timestamp ||
    Date.parse(timestamp) < minimumTimestamp ||
    value.correlationId !== correlationId ||
    !Object.hasOwn(SUBREQUEST_PATHS, value.subrequest) ||
    !ROUTES.has(value.route) ||
    !SAFE_METHOD_PATTERN.test(value.method) ||
    !Number.isInteger(value.status) ||
    value.status < 100 ||
    value.status > 599 ||
    !Number.isInteger(value.durationMs) ||
    value.durationMs < 0 ||
    value.durationMs > 300_000 ||
    !ERROR_CODES.has(value.errorCode) ||
    !OUTCOMES.has(value.authOutcome) ||
    !SCHEMES.has(value.authScheme) ||
    (value.source !== 'middleware' && value.source !== 'handler')
  ) {
    return null;
  }
  return {
    schemaVersion: 1,
    kind: 'mobile-settings-request',
    source: value.source,
    timestamp,
    correlationId,
    subrequest: value.subrequest,
    route: value.route,
    method: value.method,
    status: value.status,
    durationMs: value.durationMs,
    errorCode: value.errorCode,
    authOutcome: value.authOutcome,
    authScheme: value.authScheme,
    authority: {
      runtime: safeValue(value.authority?.runtime, 'unknown-runtime'),
      image: safeValue(value.authority?.image, 'unknown-image'),
      commit: safeValue(value.authority?.commit, 'unknown-commit'),
    },
  };
}

function boundedNewest(events) {
  const kept = [];
  let bytes = 0;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    const size = Buffer.byteLength(JSON.stringify(event), 'utf8');
    if (kept.length >= INCIDENT_POLICY.maxEvents || bytes + size > INCIDENT_POLICY.maxBytes) {
      continue;
    }
    kept.push(event);
    bytes += size;
  }
  return kept.reverse();
}

export function extractIncidentEvents(logText, correlationId, now = new Date()) {
  if (!isSafeCorrelationId(correlationId)) {
    throw new Error('correlation ID must use 1-64 safe characters');
  }
  const minimumTimestamp = now.getTime() - INCIDENT_POLICY.maxAgeHours * 60 * 60 * 1000;
  const events = [];
  for (const line of String(logText).split(/\r?\n/)) {
    const marker = line.indexOf(LOG_PREFIX);
    const candidate = marker >= 0 ? line.slice(marker + LOG_PREFIX.length) : line.trim();
    if (!candidate.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(candidate);
      const sanitized = sanitizeEvent(parsed, correlationId, minimumTimestamp);
      if (sanitized) events.push(sanitized);
    } catch {
      // Ignore malformed or unrelated container output.
    }
  }
  events.sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
  return boundedNewest(events);
}

function sanitizeRuntimeInspect(record) {
  const containerId =
    typeof record?.Id === 'string' && /^[a-f0-9]{12,64}$/i.test(record.Id)
      ? record.Id.slice(0, 12).toLowerCase()
      : 'unknown';
  return {
    containerId,
    imageId: safeValue(record?.Image, 'unknown-image'),
    imageRef: safeValue(record?.Config?.Image, 'unknown-image-ref'),
    commit: safeValue(
      record?.Config?.Labels?.['org.opencontainers.image.revision'],
      'unknown-commit',
    ),
    startedAt: safeTimestamp(record?.State?.StartedAt),
  };
}

function failureCategory(events, health) {
  const failing = [...events].reverse().find((event) => event.status >= 400);
  if (failing) {
    if (['missing', 'malformed', 'not-found', 'revoked', 'expired'].includes(failing.authOutcome)) {
      return 'auth_rejection';
    }
    if (failing.status === 404) return 'endpoint_authority_mismatch';
    if (failing.status >= 500) return 'server_schema_failure';
    return 'request_rejected';
  }
  const unhealthy = health.find((item) => item.category !== 'ok');
  if (unhealthy) return unhealthy.category;
  return events.length > 0 ? 'none' : 'evidence_not_found';
}

export function buildIncidentBundle({
  correlationId,
  subrequest,
  logText,
  inspectRecord,
  health = [],
  now = new Date(),
}) {
  if (!isSafeCorrelationId(correlationId)) {
    throw new Error('correlation ID must use 1-64 safe characters');
  }
  if (!Object.hasOwn(SUBREQUEST_PATHS, subrequest)) {
    throw new Error('unknown Settings subrequest');
  }
  const events = extractIncidentEvents(logText, correlationId, now);
  const safeHealth = health.map((item) => ({
    path:
      Object.values(SUBREQUEST_PATHS).includes(item.path) || item.path === '/login'
        ? item.path
        : '/unknown',
    status:
      Number.isInteger(item.status) && item.status >= 100 && item.status <= 599
        ? item.status
        : null,
    category: ['ok', 'endpoint_authority_mismatch', 'transport_runtime_failure'].includes(
      item.category,
    )
      ? item.category
      : 'transport_runtime_failure',
  }));
  return {
    schemaVersion: 1,
    kind: 'gymcoach-mobile-settings-incident',
    generatedAt: now.toISOString(),
    correlationId,
    failingSubrequest: subrequest,
    failingPath: SUBREQUEST_PATHS[subrequest],
    failureCategory: failureCategory(events, safeHealth),
    retention: { ...INCIDENT_POLICY },
    runtime: sanitizeRuntimeInspect(inspectRecord),
    health: safeHealth,
    events,
  };
}

function runDocker(args) {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error('canonical Docker diagnostics are unavailable');
  }
  return result.stdout;
}

async function checkHealth(baseUrl, path) {
  try {
    const response = await fetch(new URL(path, baseUrl), {
      headers: {
        'X-GymCoach-Correlation-ID': `collector-health-${crypto.randomUUID()}`,
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
    const healthy =
      path === '/login'
        ? response.status === 200 || response.status === 307
        : response.status === 401;
    return {
      path,
      status: response.status,
      category: healthy ? 'ok' : 'endpoint_authority_mismatch',
    };
  } catch {
    return { path, status: null, category: 'transport_runtime_failure' };
  }
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--pretty') {
      options.pretty = true;
      continue;
    }
    if (!['--correlation-id', '--subrequest', '--base-url'].includes(argument)) {
      throw new Error('unsupported collector argument');
    }
    const value = argv[index + 1];
    if (!value) throw new Error(`${argument} requires a value`);
    options[argument.slice(2)] = value;
    index += 1;
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const correlationId = options['correlation-id'];
  const subrequest = options.subrequest;
  const baseUrl = options['base-url'] ?? 'http://127.0.0.1:3030';
  if (!isSafeCorrelationId(correlationId ?? '')) {
    throw new Error('--correlation-id is required and must be sanitized');
  }
  if (!Object.hasOwn(SUBREQUEST_PATHS, subrequest ?? '')) {
    throw new Error('--subrequest must name profile, gyms, exercises or gym-equipment');
  }
  if (!['http://127.0.0.1:3030', 'http://192.168.0.119:3030'].includes(baseUrl)) {
    throw new Error('--base-url must be a canonical local GymCoach authority');
  }

  const [inspectRecord] = JSON.parse(runDocker(['inspect', 'gymcoach-app']));
  const health = await Promise.all([
    checkHealth(baseUrl, '/login'),
    checkHealth(baseUrl, SUBREQUEST_PATHS[subrequest]),
  ]);
  const logText = runDocker([
    'exec',
    'gymcoach-app',
    'sh',
    '-c',
    'for file in /app/data/mobile-settings-diagnostics/event-*.json; do [ -f "$file" ] || continue; cat "$file"; done',
  ]);
  const bundle = buildIncidentBundle({
    correlationId,
    subrequest,
    logText,
    inspectRecord,
    health,
  });
  process.stdout.write(`${JSON.stringify(bundle, null, options.pretty ? 2 : 0)}\n`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'incident collector failed');
    process.exitCode = 1;
  });
}
