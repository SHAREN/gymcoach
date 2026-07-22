import { createHash, randomBytes } from 'node:crypto';
import { db } from '@/lib/db';
import { isValidMobileTokenShape, type MobileAuthOutcome } from '@/lib/mobile-settings-contract';

const MOBILE_TOKEN_PREFIX = 'gma_';
export const MOBILE_TOKEN_TTL_DAYS = 180;

export interface MobilePrincipal {
  tokenId: string;
  userId: string;
  deviceId: string;
}
export interface MobileAuthenticationResult {
  outcome: MobileAuthOutcome;
  principal: MobilePrincipal | null;
}

export function generateMobileToken(): string {
  return `${MOBILE_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
}

export function hashMobileToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function visibleMobileTokenPrefix(token: string): string {
  return `${token.slice(0, 12)}...`;
}

export function mobileTokenExpiry(now = new Date()): Date {
  return new Date(now.getTime() + MOBILE_TOKEN_TTL_DAYS * 86_400_000);
}

export function readMobileToken(req: Request): string | null {
  const parsed = parseMobileAuthorization(req);
  return parsed.outcome === 'valid' ? parsed.token : null;
}

function parseMobileAuthorization(
  req: Request,
): { outcome: 'missing' | 'malformed'; token: null } | { outcome: 'valid'; token: string } {
  const authorization = req.headers.get('authorization');
  if (!authorization) return { outcome: 'missing', token: null };
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  const token = match?.[1]?.trim();
  if (!token || !isValidMobileTokenShape(token)) {
    return { outcome: 'malformed', token: null };
  }
  return { outcome: 'valid', token };
}

export async function authenticateMobileRequestDetailed(
  req: Request,
): Promise<MobileAuthenticationResult> {
  const authorization = parseMobileAuthorization(req);
  if (authorization.outcome !== 'valid') {
    return { outcome: authorization.outcome, principal: null };
  }

  const row = await db.mobileAccessToken.findUnique({
    where: { tokenHash: hashMobileToken(authorization.token) },
    select: {
      id: true,
      userId: true,
      deviceId: true,
      expiresAt: true,
      revokedAt: true,
      lastUsedAt: true,
    },
  });
  if (!row) return { outcome: 'not-found', principal: null };
  if (row.revokedAt) return { outcome: 'revoked', principal: null };
  if (row.expiresAt.getTime() <= Date.now()) {
    return { outcome: 'expired', principal: null };
  }

  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 5 * 60_000) {
    void db.mobileAccessToken
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {});
  }
  return {
    outcome: 'valid',
    principal: { tokenId: row.id, userId: row.userId, deviceId: row.deviceId },
  };
}

export async function authenticateMobileRequest(req: Request): Promise<MobilePrincipal | null> {
  const result = await authenticateMobileRequestDetailed(req);
  return result.principal;
}
