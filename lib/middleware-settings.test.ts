import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({
  SESSION_COOKIE: 'gymcoach-session',
  verifySession: vi.fn(),
}));

import { verifySession } from '@/lib/auth';
import { middleware } from '@/middleware';

const mockedVerifySession = vi.mocked(verifySession);

function request(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(`http://test.local${path}`, { headers });
}

describe('Settings middleware Bearer boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedVerifySession.mockResolvedValue(null);
  });

  it.each(['/api/profile', '/api/gyms', '/api/mobile/exercises', '/api/gyms/gym_123/equipment'])(
    'dispatches the exact Bearer-capable Settings route %s to handler auth',
    async (path) => {
      const response = await middleware(
        request(path, {
          Authorization: 'Bearer gma_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          'X-GymCoach-Correlation-ID': 'middleware-regression-001',
        }),
      );

      expect(response.headers.get('x-middleware-next')).toBe('1');
      expect(response.headers.get('x-gymcoach-correlation-id')).toBe('middleware-regression-001');
    },
  );

  it.each([
    '/api/sessions',
    '/api/profile/extra',
    '/api/gyms/gym_123/inventory',
    '/api/gyms/gym_123/equipment/extra',
  ])('does not broaden Bearer dispatch to %s', async (path) => {
    const response = await middleware(
      request(path, {
        Authorization: 'Bearer gma_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get('x-middleware-next')).toBeNull();
  });

  it('dispatches missing auth to handler validation and replaces token-hash correlations', async () => {
    const tokenHash = 'a'.repeat(64);
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    const response = await middleware(
      request('/api/profile', {
        'X-GymCoach-Correlation-ID': tokenHash,
      }),
    );

    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.get('x-gymcoach-correlation-id')).toMatch(
      /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/,
    );
    expect(response.headers.get('x-gymcoach-correlation-id')).not.toBe(tokenHash);
    expect(response.headers.get('x-gymcoach-settings-subrequest')).toBe('profile');
    expect(log).not.toHaveBeenCalled();
  });

  it('preserves cookie-authenticated web Settings requests', async () => {
    mockedVerifySession.mockResolvedValue({
      userId: 'web-user',
      email: 'web@test.dev',
    });

    const response = await middleware(
      request('/api/profile', { Cookie: 'gymcoach-session=valid-session' }),
    );

    expect(response.headers.get('x-middleware-next')).toBe('1');
  });
});
