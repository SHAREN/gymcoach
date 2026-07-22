import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MOBILE_SETTINGS_DIAGNOSTIC_POLICY,
  buildMobileSettingsDiagnosticEvent,
  mobileSettingsRoute,
} from '@/lib/mobile-settings-contract';
import {
  persistMobileSettingsDiagnostic,
  prunePersistentMobileSettingsDiagnostics,
  type MobileSettingsPersistentPolicy,
} from '@/lib/mobile-settings-diagnostic-store';

function diagnostic(correlationId: string, timestamp: string) {
  return buildMobileSettingsDiagnosticEvent({
    source: 'handler',
    timestamp: new Date(timestamp),
    correlationId,
    route: mobileSettingsRoute('profile'),
    method: 'GET',
    status: 401,
    durationMs: 5,
    errorCode: 'mobile_auth_missing',
    authOutcome: 'missing',
    authScheme: 'none',
    authority: { runtime: 'canonical-3030', image: 'gymcoach-app', commit: 'abc123' },
  });
}

function storedCorrelations(directory: string): string[] {
  return readdirSync(directory)
    .filter((name) => name.startsWith('event-'))
    .map((name) => JSON.parse(readFileSync(join(directory, name), 'utf8')).correlationId as string)
    .sort();
}

describe('persistent mobile Settings diagnostic retention', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'gymcoach-mobile-settings-'));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('rejects token-hash-shaped correlations before persistent storage', () => {
    const unsafe = { ...diagnostic('safe-correlation', '2026-07-23T12:00:00.000Z') };
    unsafe.correlationId = 'a'.repeat(64);

    expect(
      persistMobileSettingsDiagnostic(unsafe, {
        directory,
        nowMs: Date.parse('2026-07-23T12:00:00.000Z'),
      }),
    ).toBe(false);
    expect(readdirSync(directory)).toEqual([]);
  });

  it('enforces age and count limits on disk at append/prune time', () => {
    const policy: MobileSettingsPersistentPolicy = {
      maxEvents: 2,
      maxBytes: 1_000_000,
      maxAgeMs: 60 * 60 * 1000,
    };
    const oldNow = Date.parse('2026-07-23T08:00:00.000Z');
    const now = Date.parse('2026-07-23T12:00:00.000Z');
    expect(
      persistMobileSettingsDiagnostic(diagnostic('old-event', '2026-07-23T08:00:00.000Z'), {
        directory,
        nowMs: oldNow,
        policy,
      }),
    ).toBe(true);
    expect(storedCorrelations(directory)).toEqual(['old-event']);

    const ageResult = prunePersistentMobileSettingsDiagnostics({ directory, nowMs: now, policy });
    expect(ageResult.removedFiles).toBe(1);
    expect(storedCorrelations(directory)).toEqual([]);

    for (const [correlationId, timestamp] of [
      ['recent-1', '2026-07-23T11:57:00.000Z'],
      ['recent-2', '2026-07-23T11:58:00.000Z'],
      ['recent-3', '2026-07-23T11:59:00.000Z'],
    ] as const) {
      expect(
        persistMobileSettingsDiagnostic(diagnostic(correlationId, timestamp), {
          directory,
          nowMs: now,
          policy,
        }),
      ).toBe(true);
    }
    expect(storedCorrelations(directory)).toEqual(['recent-2', 'recent-3']);
  });

  it('enforces the encoded byte limit on disk', () => {
    const first = diagnostic('size-1', '2026-07-23T11:58:00.000Z');
    const second = diagnostic('size-2', '2026-07-23T11:59:00.000Z');
    const oneEventBytes = Buffer.byteLength(`${JSON.stringify(first)}\n`, 'utf8');
    const policy: MobileSettingsPersistentPolicy = {
      maxEvents: 10,
      maxBytes: oneEventBytes + 8,
      maxAgeMs: 60 * 60 * 1000,
    };
    const now = Date.parse('2026-07-23T12:00:00.000Z');

    expect(persistMobileSettingsDiagnostic(first, { directory, nowMs: now, policy })).toBe(true);
    expect(persistMobileSettingsDiagnostic(second, { directory, nowMs: now, policy })).toBe(true);
    expect(storedCorrelations(directory)).toEqual(['size-2']);
  });

  it('wires production startup, volume and the bounded sweep policy', () => {
    const compose = readFileSync(join(process.cwd(), 'docker-compose.prod.yml'), 'utf8');
    const instrumentation = readFileSync(join(process.cwd(), 'instrumentation.ts'), 'utf8');

    expect(compose).toContain(
      'GYMCOACH_MOBILE_SETTINGS_DIAGNOSTIC_DIR: /app/data/mobile-settings-diagnostics',
    );
    expect(compose).toContain('mobile-settings-diagnostics:/app/data/mobile-settings-diagnostics');
    expect(instrumentation).toContain('startPersistentMobileSettingsDiagnosticRetention');
    expect(MOBILE_SETTINGS_DIAGNOSTIC_POLICY.persistentSweepIntervalMs).toBe(60_000);
    expect(MOBILE_SETTINGS_DIAGNOSTIC_POLICY.maxAgeMs).toBe(24 * 60 * 60 * 1000);
  });
});
