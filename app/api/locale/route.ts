import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { localeCookieMaxAge, localeCookieName, locales } from '@/i18n/config';

const localeRequestSchema = z.object({
  locale: z.enum(locales),
});

function requestUsesHttps(request: NextRequest): boolean {
  const forwardedProtocol = request.headers
    .get('x-forwarded-proto')
    ?.split(',')[0]
    ?.trim()
    .toLowerCase();

  return forwardedProtocol ? forwardedProtocol === 'https' : request.nextUrl.protocol === 'https:';
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const parsed = localeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Unsupported locale.' }, { status: 400 });
  }

  const response = NextResponse.json(
    { locale: parsed.data.locale },
    { headers: { 'Cache-Control': 'no-store' } },
  );
  response.cookies.set(localeCookieName, parsed.data.locale, {
    path: '/',
    maxAge: localeCookieMaxAge,
    sameSite: 'lax',
    secure: requestUsesHttps(request),
  });

  return response;
}
