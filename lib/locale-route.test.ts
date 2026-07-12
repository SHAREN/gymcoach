import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { POST } from '@/app/api/locale/route';

function request(url: string, locale: string, forwardedProtocol?: string) {
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
  it('sets a non-secure cookie for the local HTTP panel', async () => {
    const response = await POST(request('http://192.168.0.119:3030/api/locale', 'ru'));
    const cookie = response.headers.get('set-cookie');

    expect(response.status).toBe(200);
    expect(cookie).toContain('gymcoach.locale=ru');
    expect(cookie).not.toContain('Secure');
  });

  it('sets a secure cookie behind the public HTTPS proxy', async () => {
    const response = await POST(
      request('http://192.168.0.119:3030/api/locale', 'en', 'https'),
    );
    const cookie = response.headers.get('set-cookie');

    expect(response.status).toBe(200);
    expect(cookie).toContain('gymcoach.locale=en');
    expect(cookie).toContain('Secure');
  });

  it('rejects unsupported locales', async () => {
    const response = await POST(request('https://gymcoach7.sharteman.duckdns.org/api/locale', 'de'));
    expect(response.status).toBe(400);
  });
});
