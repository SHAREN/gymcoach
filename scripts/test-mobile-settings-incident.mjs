#!/usr/bin/env node

import assert from 'node:assert/strict';
import {
  buildIncidentBundle,
  extractIncidentEvents,
  INCIDENT_POLICY,
} from './collect-mobile-settings-incident.mjs';

const now = new Date('2026-07-23T12:00:00.000Z');
const correlationId = 'collector-test-001';
const secretToken = 'gma_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const event = (index, overrides = {}) => ({
  schemaVersion: 1,
  kind: 'mobile-settings-request',
  source: 'handler',
  timestamp: new Date(now.getTime() - (150 - index) * 1000).toISOString(),
  correlationId,
  subrequest: 'profile',
  route: '/api/profile',
  method: 'GET',
  status: 401,
  durationMs: 8,
  errorCode: 'mobile_auth_expired',
  authOutcome: 'expired',
  authScheme: 'bearer',
  authority: {
    runtime: 'canonical-3030',
    image: 'gymcoach-app',
    commit: 'abc123',
  },
  rawToken: secretToken,
  email: 'private@example.test',
  body: 'training history',
  privatePath: 'C:\\private\\raw.log',
  ...overrides,
});

const logText = Array.from(
  { length: 150 },
  (_, index) => `container-prefix [gymcoach.mobile-settings] ${JSON.stringify(event(index))}`,
).join('\n');
const extracted = extractIncidentEvents(logText, correlationId, now);
assert.equal(extracted.length, INCIDENT_POLICY.maxEvents);
assert.equal(extracted[0].timestamp, event(50).timestamp);

const bundle = buildIncidentBundle({
  correlationId,
  subrequest: 'profile',
  logText,
  inspectRecord: {
    Id: 'a'.repeat(64),
    Image: 'sha256:' + 'b'.repeat(64),
    Config: {
      Image: 'gymcoach-app',
      Env: [`TOKEN=${secretToken}`, 'EMAIL=private@example.test'],
      Labels: { 'org.opencontainers.image.revision': 'abc123' },
    },
    State: { StartedAt: '2026-07-23T10:00:00.000Z' },
    Mounts: [{ Source: 'C:\\private\\database' }],
  },
  health: [
    { path: '/login', status: 200, category: 'ok' },
    { path: '/api/profile', status: 401, category: 'ok' },
  ],
  now,
});
assert.equal(bundle.failureCategory, 'auth_rejection');
assert.equal(bundle.failingSubrequest, 'profile');
assert.equal(bundle.runtime.containerId, 'aaaaaaaaaaaa');

const serialized = JSON.stringify(bundle);
for (const prohibited of [
  secretToken,
  'private@example.test',
  'training history',
  'private\\raw.log',
  'private\\database',
  'TOKEN=',
]) {
  assert.equal(serialized.includes(prohibited), false, prohibited);
}

assert.throws(
  () => buildIncidentBundle({ correlationId: secretToken, subrequest: 'profile', logText: '' }),
  /correlation ID/,
);

console.log('Mobile Settings incident collector tests passed.');
