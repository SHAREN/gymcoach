import type { MobileAuthOutcome, MobileAuthScheme } from '@/lib/mobile-settings-contract';

export interface RequestAuthDiagnostic {
  outcome: MobileAuthOutcome;
  scheme: MobileAuthScheme;
}

const requestAuthDiagnostics = new WeakMap<Request, RequestAuthDiagnostic>();

export function setRequestAuthDiagnostic(
  request: Request,
  diagnostic: RequestAuthDiagnostic,
): void {
  requestAuthDiagnostics.set(request, diagnostic);
}

export function getRequestAuthDiagnostic(request: Request): RequestAuthDiagnostic | null {
  return requestAuthDiagnostics.get(request) ?? null;
}
