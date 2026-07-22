import {
  MOBILE_SETTINGS_AUTH_OUTCOME_HEADER,
  MOBILE_SETTINGS_AUTH_SCHEME_HEADER,
  MOBILE_SETTINGS_CORRELATION_HEADER,
  MOBILE_SETTINGS_DIAGNOSTIC_POLICY,
  MOBILE_SETTINGS_ERROR_CODE_HEADER,
  MOBILE_SETTINGS_LOG_PREFIX,
  MOBILE_SETTINGS_SUBREQUEST_HEADER,
  buildMobileSettingsDiagnosticEvent,
  inferMobileSettingsErrorCode,
  mobileSettingsRoute,
  resolveMobileSettingsCorrelationId,
  type MobileSettingsDiagnosticEvent,
  type MobileSettingsErrorCode,
  type MobileSettingsSubrequest,
} from '@/lib/mobile-settings-contract';
import { getRequestAuthDiagnostic } from '@/lib/request-auth-diagnostics';
import { persistMobileSettingsDiagnostic } from '@/lib/mobile-settings-diagnostic-store';

type RouteHandler<Args extends unknown[]> = (request: Request, ...args: Args) => Promise<Response>;

let retainedEvents: MobileSettingsDiagnosticEvent[] = [];

function eventBytes(event: MobileSettingsDiagnosticEvent): number {
  return Buffer.byteLength(JSON.stringify(event), 'utf8');
}

export function rotateMobileSettingsDiagnosticEvents(
  events: readonly MobileSettingsDiagnosticEvent[],
  policy: { maxEvents: number; maxBytes: number; maxAgeMs: number },
  nowMs = Date.now(),
): MobileSettingsDiagnosticEvent[] {
  const minimumTimestamp = nowMs - policy.maxAgeMs;
  const recent = events.filter((event) => {
    const timestamp = Date.parse(event.timestamp);
    return (
      Number.isFinite(timestamp) && timestamp >= minimumTimestamp && timestamp <= nowMs + 60_000
    );
  });
  const kept: MobileSettingsDiagnosticEvent[] = [];
  let bytes = 0;
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const event = recent[index];
    if (!event) continue;
    const size = eventBytes(event);
    if (kept.length >= policy.maxEvents || bytes + size > policy.maxBytes) continue;
    kept.push(event);
    bytes += size;
  }
  return kept.reverse();
}

export function appendMobileSettingsDiagnostic(
  event: MobileSettingsDiagnosticEvent,
  options: { emit?: boolean; nowMs?: number } = {},
): void {
  retainedEvents = rotateMobileSettingsDiagnosticEvents(
    [...retainedEvents, event],
    MOBILE_SETTINGS_DIAGNOSTIC_POLICY,
    options.nowMs ?? Date.now(),
  );
  const persisted = persistMobileSettingsDiagnostic(event, { nowMs: options.nowMs });
  if (!persisted && options.emit !== false && process.env.NODE_ENV !== 'production') {
    console.info(`${MOBILE_SETTINGS_LOG_PREFIX}${JSON.stringify(event)}`);
  }
}

export function mobileSettingsDiagnosticSnapshot(): readonly MobileSettingsDiagnosticEvent[] {
  return retainedEvents.map((event) => ({ ...event, authority: { ...event.authority } }));
}

export function resetMobileSettingsDiagnosticsForTests(): void {
  retainedEvents = [];
}

function responseErrorCode(response: Response): MobileSettingsErrorCode {
  const value = response.headers.get(MOBILE_SETTINGS_ERROR_CODE_HEADER);
  const allowed = new Set<MobileSettingsErrorCode>([
    'ok',
    'mobile_auth_missing',
    'mobile_auth_malformed',
    'mobile_auth_not_found',
    'mobile_auth_revoked',
    'mobile_auth_expired',
    'mobile_auth_unavailable',
    'auth_rejected',
    'endpoint_authority_mismatch',
    'request_rejected',
    'server_schema_failure',
  ]);
  return value && allowed.has(value as MobileSettingsErrorCode)
    ? (value as MobileSettingsErrorCode)
    : inferMobileSettingsErrorCode(response.status);
}

export function withMobileSettingsDiagnostics<Args extends unknown[]>(
  subrequest: MobileSettingsSubrequest,
  handler: RouteHandler<Args>,
): RouteHandler<Args> {
  const route = mobileSettingsRoute(subrequest);
  return async (request, ...args) => {
    const startedAt = performance.now();
    const correlationId = resolveMobileSettingsCorrelationId(
      request.headers.get(MOBILE_SETTINGS_CORRELATION_HEADER),
    );
    const response = await handler(request, ...args);
    const auth = getRequestAuthDiagnostic(request) ?? { outcome: 'unavailable', scheme: 'none' };
    const errorCode = responseErrorCode(response);

    response.headers.set(MOBILE_SETTINGS_CORRELATION_HEADER, correlationId);
    response.headers.set(MOBILE_SETTINGS_SUBREQUEST_HEADER, subrequest);
    response.headers.set(MOBILE_SETTINGS_AUTH_OUTCOME_HEADER, auth.outcome);
    response.headers.set(MOBILE_SETTINGS_AUTH_SCHEME_HEADER, auth.scheme);
    response.headers.set(MOBILE_SETTINGS_ERROR_CODE_HEADER, errorCode);

    appendMobileSettingsDiagnostic(
      buildMobileSettingsDiagnosticEvent({
        source: 'handler',
        correlationId,
        route,
        method: request.method,
        status: response.status,
        durationMs: performance.now() - startedAt,
        errorCode,
        authOutcome: auth.outcome,
        authScheme: auth.scheme,
      }),
    );
    return response;
  };
}
