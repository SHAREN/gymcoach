import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@/prisma/generated/client';
import { getCurrentUserId } from '@/lib/auth';
import { authenticateMobileRequestDetailed } from '@/lib/mobile-auth';
import {
  MOBILE_SETTINGS_AUTH_OUTCOME_HEADER,
  MOBILE_SETTINGS_ERROR_CODE_HEADER,
  mobileAuthErrorCode,
  type MobileAuthOutcome,
  type MobileSettingsErrorCode,
} from '@/lib/mobile-settings-contract';
import { setRequestAuthDiagnostic } from '@/lib/request-auth-diagnostics';

// ============================================================
// Helpers for the API routes
// ============================================================
// Centralizes the recurring patterns: auth, Zod body parsing,
// turning Prisma errors into JSON responses.

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public safeCode?: MobileSettingsErrorCode,
    public authOutcome?: MobileAuthOutcome,
  ) {
    super(message);
  }
}

export async function requireApiUserId(req?: Request): Promise<string> {
  let mobileOutcome: MobileAuthOutcome = 'missing';
  if (req) {
    try {
      const mobile = await authenticateMobileRequestDetailed(req);
      mobileOutcome = mobile.outcome;
      if (mobile.principal) {
        setRequestAuthDiagnostic(req, { outcome: 'valid', scheme: 'bearer' });
        return mobile.principal.userId;
      }
    } catch (error) {
      setRequestAuthDiagnostic(req, { outcome: 'unavailable', scheme: 'bearer' });
      throw error;
    }
  }
  const userId = await getCurrentUserId();
  if (userId) {
    if (req) setRequestAuthDiagnostic(req, { outcome: 'valid', scheme: 'cookie' });
    return userId;
  }
  if (req) {
    setRequestAuthDiagnostic(req, {
      outcome: mobileOutcome,
      scheme: mobileOutcome === 'missing' ? 'none' : 'bearer',
    });
  }
  throw new ApiError(401, 'Unauthorized', mobileAuthErrorCode(mobileOutcome), mobileOutcome);
}

export async function parseJsonBody<T extends z.ZodTypeAny>(
  req: Request,
  schema: T,
  opts?: { maxBytes?: number },
): Promise<z.infer<T>> {
  let body: unknown;
  try {
    if (opts?.maxBytes !== undefined) {
      body = JSON.parse(await readBodyWithCap(req, opts.maxBytes));
    } else {
      body = await req.json();
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(400, 'Invalid JSON');
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(400, parsed.error.issues[0]?.message ?? 'Invalid data');
  }
  return parsed.data;
}

// Reads the request body as text while enforcing a hard byte cap DURING the
// read. The Content-Length header is attacker-controlled (absent on chunked
// bodies, or malformed), and App Router route handlers have no built-in body
// size limit, so `req.json()` would buffer an arbitrarily large body into
// memory before any schema check runs. Aborts with 413 as soon as the
// cumulative byte count exceeds the cap.
export async function readBodyWithCap(req: Request, maxBytes: number): Promise<string> {
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        throw new ApiError(413, 'Request body too large.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
    if (received > maxBytes) {
      // Stop pulling the rest of an oversized body.
      await req.body.cancel().catch(() => {});
    }
  }
  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

export function handleApiError(err: unknown): NextResponse {
  function apiErrorResponse(
    error: string,
    status: number,
    safeCode?: MobileSettingsErrorCode,
    authOutcome?: MobileAuthOutcome,
    includeCode = false,
  ): NextResponse {
    const headers = new Headers();
    if (safeCode) headers.set(MOBILE_SETTINGS_ERROR_CODE_HEADER, safeCode);
    if (authOutcome) headers.set(MOBILE_SETTINGS_AUTH_OUTCOME_HEADER, authOutcome);
    return NextResponse.json(
      { error, ...(includeCode && safeCode ? { code: safeCode } : {}) },
      { status, headers },
    );
  }

  if (err instanceof ApiError) {
    return apiErrorResponse(
      err.message,
      err.status,
      err.safeCode,
      err.authOutcome,
      err.authOutcome !== undefined,
    );
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return apiErrorResponse(
        'Conflict: an entry with this value already exists.',
        409,
        'request_rejected',
      );
    }
    if (err.code === 'P2025') {
      return apiErrorResponse('Not found.', 404, 'endpoint_authority_mismatch');
    }
  }

  console.error('[api] unhandled error type:', err instanceof Error ? err.name : 'UnknownError');
  return apiErrorResponse('Server error.', 500, 'server_schema_failure');
}
