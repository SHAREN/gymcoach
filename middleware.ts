import { NextResponse, type NextRequest } from 'next/server';
import { verifySession, SESSION_COOKIE } from '@/lib/auth';
import {
  MOBILE_SETTINGS_AUTH_OUTCOME_HEADER,
  MOBILE_SETTINGS_AUTH_SCHEME_HEADER,
  MOBILE_SETTINGS_CORRELATION_HEADER,
  MOBILE_SETTINGS_ERROR_CODE_HEADER,
  MOBILE_SETTINGS_LOG_PREFIX,
  MOBILE_SETTINGS_SUBREQUEST_HEADER,
  buildMobileSettingsDiagnosticEvent,
  matchMobileSettingsRoute,
  mobileAuthErrorCode,
  resolveMobileSettingsCorrelationId,
} from '@/lib/mobile-settings-contract';

// Routes reachable without a valid session.
// /api/auth/logout is public: replaying it without a cookie does nothing
// harmful and lets the client clear state even if the JWT has expired.
const PUBLIC_PATHS = new Set([
  '/login',
  '/signup',
  '/mcp',
  '/mcp/health',
  '/api/locale',
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/logout',
  '/api/android/latest',
  '/api/android/download',
]);

export async function middleware(req: NextRequest) {
  const startedAt = performance.now();
  const { pathname } = req.nextUrl;
  const settingsRoute = matchMobileSettingsRoute(pathname);
  const correlationId = settingsRoute
    ? resolveMobileSettingsCorrelationId(req.headers.get(MOBILE_SETTINGS_CORRELATION_HEADER))
    : null;
  const isPublic = PUBLIC_PATHS.has(pathname) || pathname.startsWith('/api/mobile/');
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

  if (settingsRoute && correlationId) {
    const authorization = req.headers.get('authorization');
    const canReachHandler =
      pathname.startsWith('/api/mobile/') || authorization !== null || session !== null;
    if (canReachHandler) {
      const requestHeaders = new Headers(req.headers);
      requestHeaders.set(MOBILE_SETTINGS_CORRELATION_HEADER, correlationId);
      requestHeaders.set(MOBILE_SETTINGS_SUBREQUEST_HEADER, settingsRoute.subrequest);
      const response = NextResponse.next({ request: { headers: requestHeaders } });
      response.headers.set(MOBILE_SETTINGS_CORRELATION_HEADER, correlationId);
      response.headers.set(MOBILE_SETTINGS_SUBREQUEST_HEADER, settingsRoute.subrequest);
      return response;
    }

    const errorCode = mobileAuthErrorCode('missing');
    const event = buildMobileSettingsDiagnosticEvent({
      source: 'middleware',
      correlationId,
      route: settingsRoute,
      method: req.method,
      status: 401,
      durationMs: performance.now() - startedAt,
      errorCode,
      authOutcome: 'missing',
      authScheme: 'none',
    });
    console.info(`${MOBILE_SETTINGS_LOG_PREFIX}${JSON.stringify(event)}`);
    return NextResponse.json(
      { error: 'Unauthorized', code: errorCode, correlationId },
      {
        status: 401,
        headers: {
          [MOBILE_SETTINGS_CORRELATION_HEADER]: correlationId,
          [MOBILE_SETTINGS_SUBREQUEST_HEADER]: settingsRoute.subrequest,
          [MOBILE_SETTINGS_AUTH_OUTCOME_HEADER]: 'missing',
          [MOBILE_SETTINGS_AUTH_SCHEME_HEADER]: 'none',
          [MOBILE_SETTINGS_ERROR_CODE_HEADER]: errorCode,
        },
      },
    );
  }

  if (isPublic) {
    // Already signed in and visiting /login or /signup: send to the dashboard.
    if (session && (pathname === '/login' || pathname === '/signup')) {
      const url = req.nextUrl.clone();
      url.pathname = '/';
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  if (!session) {
    // API: 401 JSON. Pages: redirect to /login.
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Exclude static resources and PWA assets.
    '/((?!_next/static|_next/image|icons|exercise-media|manifest.json|favicon.ico|sw.js|workbox-).*)',
  ],
};
