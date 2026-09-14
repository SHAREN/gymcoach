import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/locale/route';

function request(url: string, locale: unknown, forwardedProtocol?: string) {
  return new NextRequest(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(forwardedProtocol ? { 'x-forwarded-proto': forwardedProtocol } : {}),
    },
    body: JSON.stringify({ locale }),
  });
}

describe('POST /api/locale', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('sets a non-secure cookie when the existing self-host HTTP opt-out is disabled', async () => {
    vi.stubEnv('SESSION_COOKIE_SECURE', 'false');
    const response = await POST(request('http://gymcoach.local:3030/api/locale', 'ru'));
    const cookie = response.headers.get('set-cookie');

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(cookie).toContain('gymcoach.locale=ru');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('SameSite=lax');
    expect(cookie).not.toContain('Secure');
  });

  it('sets a secure cookie when the existing secure-cookie policy is enabled', async () => {
    vi.stubEnv('SESSION_COOKIE_SECURE', 'true');
    const response = await POST(request('http://gymcoach.internal:3030/api/locale', 'en'));
    const cookie = response.headers.get('set-cookie');

    expect(response.status).toBe(200);
    expect(cookie).toContain('gymcoach.locale=en');
    expect(cookie).toContain('Secure');
  });

  it('does not let x-forwarded-proto downgrade a secure locale cookie', async () => {
    vi.stubEnv('SESSION_COOKIE_SECURE', 'true');
    const response = await POST(
      request('https://gymcoach.example/api/locale', 'fr', 'http'),
    );
    const cookie = response.headers.get('set-cookie');

    expect(response.status).toBe(200);
    expect(cookie).toContain('gymcoach.locale=fr');
    expect(cookie).toContain('Secure');
  });

  it('does not let x-forwarded-proto upgrade an explicit HTTP opt-out', async () => {
    vi.stubEnv('SESSION_COOKIE_SECURE', 'false');
    const response = await POST(
      request('http://gymcoach.local:3030/api/locale', 'ru', 'https'),
    );
    const cookie = response.headers.get('set-cookie');

    expect(response.status).toBe(200);
    expect(cookie).not.toContain('Secure');
  });

  it('rejects malformed JSON without setting a locale cookie', async () => {
    const response = await POST(
      new NextRequest('https://gymcoach.example/api/locale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{',
      }),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('rejects unsupported locales without setting a cookie', async () => {
    const response = await POST(request('https://gymcoach.example/api/locale', 'de'));
    expect(response.status).toBe(400);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('rejects null JSON bodies without throwing or setting a cookie', async () => {
    const response = await POST(request('https://gymcoach.example/api/locale', null));
    expect(response.status).toBe(400);
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});
