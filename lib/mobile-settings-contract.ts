export const MOBILE_SETTINGS_CORRELATION_HEADER = 'x-gymcoach-correlation-id';
export const MOBILE_SETTINGS_SUBREQUEST_HEADER = 'x-gymcoach-settings-subrequest';
export const MOBILE_SETTINGS_AUTH_OUTCOME_HEADER = 'x-gymcoach-auth-outcome';
export const MOBILE_SETTINGS_AUTH_SCHEME_HEADER = 'x-gymcoach-auth-scheme';
export const MOBILE_SETTINGS_ERROR_CODE_HEADER = 'x-gymcoach-error-code';
export const MOBILE_SETTINGS_LOG_PREFIX = '[gymcoach.mobile-settings] ';

export const MOBILE_SETTINGS_DIAGNOSTIC_POLICY = {
  maxEvents: 500,
  maxBytes: 128 * 1024,
  maxAgeMs: 24 * 60 * 60 * 1000,
  persistentSweepIntervalMs: 60 * 1000,
  containerMaxFileSize: '5m',
  containerMaxFiles: 3,
  collectorMaxEvents: 100,
  collectorMaxBytes: 128 * 1024,
} as const;

export type MobileSettingsSubrequest = 'profile' | 'gyms' | 'exercises' | 'gym-equipment';

export type MobileAuthOutcome =
  | 'missing'
  | 'malformed'
  | 'not-found'
  | 'revoked'
  | 'expired'
  | 'valid'
  | 'unavailable';

export type MobileAuthScheme = 'none' | 'bearer' | 'cookie';

export type MobileSettingsErrorCode =
  | 'ok'
  | 'mobile_auth_missing'
  | 'mobile_auth_malformed'
  | 'mobile_auth_not_found'
  | 'mobile_auth_revoked'
  | 'mobile_auth_expired'
  | 'mobile_auth_unavailable'
  | 'auth_rejected'
  | 'endpoint_authority_mismatch'
  | 'request_rejected'
  | 'server_schema_failure';

export interface MobileSettingsRoute {
  subrequest: MobileSettingsSubrequest;
  route: string;
}

export interface MobileSettingsDiagnosticEvent {
  schemaVersion: 1;
  kind: 'mobile-settings-request';
  source: 'middleware' | 'handler';
  timestamp: string;
  correlationId: string;
  subrequest: MobileSettingsSubrequest;
  route: string;
  method: string;
  status: number;
  durationMs: number;
  errorCode: MobileSettingsErrorCode;
  authOutcome: MobileAuthOutcome;
  authScheme: MobileAuthScheme;
  authority: {
    runtime: string;
    image: string;
    commit: string;
  };
}

const CORRELATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MOBILE_TOKEN_PATTERN = /^gma_[A-Za-z0-9_-]{43}$/;
const TOKEN_HASH_PATTERN = /^[A-Fa-f0-9]{64}$/;
const SAFE_AUTHORITY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_METHOD_PATTERN = /^[A-Z]{1,12}$/;

const ROUTES: Record<MobileSettingsSubrequest, MobileSettingsRoute> = {
  profile: { subrequest: 'profile', route: '/api/profile' },
  gyms: { subrequest: 'gyms', route: '/api/gyms' },
  exercises: { subrequest: 'exercises', route: '/api/mobile/exercises' },
  'gym-equipment': {
    subrequest: 'gym-equipment',
    route: '/api/gyms/:gymId/equipment',
  },
};

export function mobileSettingsRoute(subrequest: MobileSettingsSubrequest): MobileSettingsRoute {
  return ROUTES[subrequest];
}

export function matchMobileSettingsRoute(pathname: string): MobileSettingsRoute | null {
  if (pathname === '/api/profile') return ROUTES.profile;
  if (pathname === '/api/gyms') return ROUTES.gyms;
  if (pathname === '/api/mobile/exercises') return ROUTES.exercises;
  if (/^\/api\/gyms\/[^/]+\/equipment$/.test(pathname)) return ROUTES['gym-equipment'];
  return null;
}

export function isValidMobileTokenShape(value: string): boolean {
  return MOBILE_TOKEN_PATTERN.test(value);
}

export function isSafeMobileSettingsCorrelationId(value: string): boolean {
  return (
    CORRELATION_ID_PATTERN.test(value) &&
    !MOBILE_TOKEN_PATTERN.test(value) &&
    !TOKEN_HASH_PATTERN.test(value)
  );
}

export function resolveMobileSettingsCorrelationId(
  value: string | null | undefined,
  generate: () => string = () => crypto.randomUUID(),
): string {
  if (value && isSafeMobileSettingsCorrelationId(value)) return value;
  const generated = generate();
  return isSafeMobileSettingsCorrelationId(generated) ? generated : crypto.randomUUID();
}

export function mobileAuthErrorCode(outcome: MobileAuthOutcome): MobileSettingsErrorCode {
  switch (outcome) {
    case 'missing':
      return 'mobile_auth_missing';
    case 'malformed':
      return 'mobile_auth_malformed';
    case 'not-found':
      return 'mobile_auth_not_found';
    case 'revoked':
      return 'mobile_auth_revoked';
    case 'expired':
      return 'mobile_auth_expired';
    case 'unavailable':
      return 'mobile_auth_unavailable';
    case 'valid':
      return 'ok';
  }
}

export function inferMobileSettingsErrorCode(status: number): MobileSettingsErrorCode {
  if (status < 400) return 'ok';
  if (status === 401 || status === 403) return 'auth_rejected';
  if (status === 404) return 'endpoint_authority_mismatch';
  if (status >= 500) return 'server_schema_failure';
  return 'request_rejected';
}

function safeAuthority(value: string | undefined, fallback: string): string {
  return value && SAFE_AUTHORITY_PATTERN.test(value) ? value : fallback;
}

export function mobileSettingsRuntimeAuthority(): MobileSettingsDiagnosticEvent['authority'] {
  return {
    runtime: safeAuthority(
      process.env.GYMCOACH_RUNTIME_AUTHORITY ?? process.env.HOSTNAME,
      'unknown-runtime',
    ),
    image: safeAuthority(process.env.GYMCOACH_IMAGE_AUTHORITY, 'unknown-image'),
    commit: safeAuthority(process.env.GYMCOACH_COMMIT_SHA, 'unknown-commit'),
  };
}

export function buildMobileSettingsDiagnosticEvent(input: {
  source: MobileSettingsDiagnosticEvent['source'];
  timestamp?: Date;
  correlationId: string;
  route: MobileSettingsRoute;
  method: string;
  status: number;
  durationMs: number;
  errorCode: MobileSettingsErrorCode;
  authOutcome: MobileAuthOutcome;
  authScheme: MobileAuthScheme;
  authority?: MobileSettingsDiagnosticEvent['authority'];
}): MobileSettingsDiagnosticEvent {
  const authority = input.authority ?? mobileSettingsRuntimeAuthority();
  return {
    schemaVersion: 1,
    kind: 'mobile-settings-request',
    source: input.source,
    timestamp: (input.timestamp ?? new Date()).toISOString(),
    correlationId: resolveMobileSettingsCorrelationId(input.correlationId),
    subrequest: input.route.subrequest,
    route: input.route.route,
    method: SAFE_METHOD_PATTERN.test(input.method.toUpperCase())
      ? input.method.toUpperCase()
      : 'UNKNOWN',
    status:
      Number.isInteger(input.status) && input.status >= 100 && input.status <= 599
        ? input.status
        : 500,
    durationMs: Math.max(0, Math.min(300_000, Math.round(input.durationMs))),
    errorCode: input.errorCode,
    authOutcome: input.authOutcome,
    authScheme: input.authScheme,
    authority: {
      runtime: safeAuthority(authority.runtime, 'unknown-runtime'),
      image: safeAuthority(authority.image, 'unknown-image'),
      commit: safeAuthority(authority.commit, 'unknown-commit'),
    },
  };
}
