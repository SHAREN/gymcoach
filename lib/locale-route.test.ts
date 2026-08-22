import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/locale/route';
import { localeCookieName } from '@/i18n/config';

function cookieHeader(response: Response): string {
  return response.headers.get('set-cookie') ?? '';
}

describe('POST /api/locale', () => {
  it('writes a non-secure locale cookie for a plain HTTP host', async () => {
    const response = await POST(
      new NextRequest('http://192.168.0.119:3030/api/locale', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locale: 'ru' }),
      }),
    );

    expect(response.status).toBe(200);
    const cookie = cookieHeader(response);
    expect(cookie).toContain(localeCookieName + '=ru');
    expect(cookie.toLowerCase()).not.toContain('secure');
  });

  it('writes a secure locale cookie behind the public HTTPS reverse proxy', async () => {
    const response = await POST(
      new NextRequest('http://gymcoach-app:3000/api/locale', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-proto': 'https' },
        body: JSON.stringify({ locale: 'ru' }),
      }),
    );

    expect(response.status).toBe(200);
    expect(cookieHeader(response).toLowerCase()).toContain('secure');
  });

  it('rejects unsupported locales without writing a cookie', async () => {
    const response = await POST(
      new NextRequest('https://gym.example/api/locale', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locale: 'de' }),
      }),
    );

    expect(response.status).toBe(400);
    expect(cookieHeader(response)).toBe('');
  });
});
