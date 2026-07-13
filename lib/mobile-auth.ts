import { createHash, randomBytes } from 'node:crypto';
import { db } from '@/lib/db';

const MOBILE_TOKEN_PREFIX = 'gma_';
export const MOBILE_TOKEN_TTL_DAYS = 180;

export interface MobilePrincipal {
  tokenId: string;
  userId: string;
  deviceId: string;
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
  const authorization = req.headers.get('authorization');
  if (!authorization?.toLowerCase().startsWith('bearer ')) return null;
  const token = authorization.slice(7).trim();
  return token.startsWith(MOBILE_TOKEN_PREFIX) ? token : null;
}

export async function authenticateMobileRequest(req: Request): Promise<MobilePrincipal | null> {
  const token = readMobileToken(req);
  if (!token) return null;

  const row = await db.mobileAccessToken.findUnique({
    where: { tokenHash: hashMobileToken(token) },
    select: {
      id: true,
      userId: true,
      deviceId: true,
      expiresAt: true,
      revokedAt: true,
      lastUsedAt: true,
    },
  });
  if (!row || row.revokedAt || row.expiresAt.getTime() <= Date.now()) return null;

  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 5 * 60_000) {
    void db.mobileAccessToken
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {});
  }
  return { tokenId: row.id, userId: row.userId, deviceId: row.deviceId };
}
