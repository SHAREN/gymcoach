import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildMobileSettingsDiagnosticEvent,
  mobileSettingsRoute,
} from '@/lib/mobile-settings-contract';
import {
  mobileSettingsDiagnosticSnapshot,
  resetMobileSettingsDiagnosticsForTests,
  rotateMobileSettingsDiagnosticEvents,
  withMobileSettingsDiagnostics,
} from '@/lib/mobile-settings-diagnostics';
import { setRequestAuthDiagnostic } from '@/lib/request-auth-diagnostics';

function event(correlationId: string, timestamp: string) {
  return buildMobileSettingsDiagnosticEvent({
    source: 'handler',
    timestamp: new Date(timestamp),
    correlationId,
    route: mobileSettingsRoute('profile'),
    method: 'GET',
    status: 200,
    durationMs: 4,
    errorCode: 'ok',
    authOutcome: 'valid',
    authScheme: 'bearer',
    authority: { runtime: 'runtime-1', image: 'image-1', commit: 'abc123' },
  });
}

describe('mobile Settings diagnostics', () => {
  beforeEach(() => {
    resetMobileSettingsDiagnosticsForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('propagates a safe correlation contract without logging headers, bodies or PII', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.stubEnv('GYMCOACH_RUNTIME_AUTHORITY', 'C:\\private\\runtime');
    vi.stubEnv('GYMCOACH_IMAGE_AUTHORITY', 'secret@example.test');
    vi.stubEnv('GYMCOACH_COMMIT_SHA', 'abc123');

    const wrapped = withMobileSettingsDiagnostics('profile', async (request) => {
      setRequestAuthDiagnostic(request, { outcome: 'valid', scheme: 'bearer' });
      return Response.json({
        email: 'private@example.test',
        profile: 'training-history-secret',
      });
    });
    const response = await wrapped(
      new Request('http://test.local/api/profile', {
        headers: {
          Authorization: 'Bearer gma_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          Cookie: 'gymcoach-session=private-cookie',
          'X-GymCoach-Correlation-ID': 'settings-safe-001',
          'X-Device-ID': 'private-device',
        },
      }),
    );

    expect(response.headers.get('x-gymcoach-correlation-id')).toBe('settings-safe-001');
    expect(response.headers.get('x-gymcoach-auth-outcome')).toBe('valid');
    expect(response.headers.get('x-gymcoach-auth-scheme')).toBe('bearer');
    const emitted = String(log.mock.calls[0]?.[0]);
    expect(emitted).toContain('settings-safe-001');
    expect(emitted).not.toMatch(
      /gma_|private-cookie|private@example|training-history|private-device|C:\\private/i,
    );
    expect(mobileSettingsDiagnosticSnapshot()).toHaveLength(1);
  });

  it('replaces token-hash-shaped correlations before response headers and diagnostic output', async () => {
    const tokenHash = 'a'.repeat(64);
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    const wrapped = withMobileSettingsDiagnostics('profile', async (request) => {
      setRequestAuthDiagnostic(request, { outcome: 'missing', scheme: 'none' });
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    });

    const response = await wrapped(
      new Request('http://test.local/api/profile', {
        headers: { 'X-GymCoach-Correlation-ID': tokenHash },
      }),
    );

    const correlationId = response.headers.get('x-gymcoach-correlation-id');
    expect(correlationId).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);
    expect(correlationId).not.toBe(tokenHash);
    expect(String(log.mock.calls[0]?.[0])).not.toContain(tokenHash);
    expect(mobileSettingsDiagnosticSnapshot()[0]?.correlationId).toBe(correlationId);
  });

  it('rotates by age, count and encoded size', () => {
    const now = Date.parse('2026-07-23T12:00:00.000Z');
    const old = event('old-event', '2026-07-20T12:00:00.000Z');
    const recent = [
      event('recent-1', '2026-07-23T11:57:00.000Z'),
      event('recent-2', '2026-07-23T11:58:00.000Z'),
      event('recent-3', '2026-07-23T11:59:00.000Z'),
    ];

    expect(
      rotateMobileSettingsDiagnosticEvents(
        [old, ...recent],
        {
          maxEvents: 2,
          maxBytes: 1_000_000,
          maxAgeMs: 60 * 60 * 1000,
        },
        now,
      ).map((item) => item.correlationId),
    ).toEqual(['recent-2', 'recent-3']);

    const oneEventBytes = new TextEncoder().encode(JSON.stringify(recent[2])).byteLength;
    expect(
      rotateMobileSettingsDiagnosticEvents(
        recent,
        {
          maxEvents: 10,
          maxBytes: oneEventBytes,
          maxAgeMs: 60 * 60 * 1000,
        },
        now,
      ).map((item) => item.correlationId),
    ).toEqual(['recent-3']);
  });
});
