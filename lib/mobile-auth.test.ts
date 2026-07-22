import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    mobileAccessToken: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { db } from '@/lib/db';
import {
  authenticateMobileRequestDetailed,
  generateMobileToken,
  hashMobileToken,
} from '@/lib/mobile-auth';

const findToken = vi.mocked(db.mobileAccessToken.findUnique);
const updateToken = vi.mocked(db.mobileAccessToken.update);

function bearer(token?: string) {
  return new Request('http://test.local/api/profile', {
    headers: token === undefined ? {} : { Authorization: token },
  });
}

function tokenRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'token-id',
    userId: 'user-id',
    deviceId: 'device-id',
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    lastUsedAt: new Date(),
    ...overrides,
  };
}

describe('mobile Bearer outcome classification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateToken.mockResolvedValue(tokenRow() as never);
  });

  it.each([
    [undefined, 'missing'],
    ['Basic credential', 'malformed'],
    ['Bearer', 'malformed'],
    ['Bearer gma_short', 'malformed'],
  ])('classifies %s without querying token storage', async (authorization, outcome) => {
    await expect(authenticateMobileRequestDetailed(bearer(authorization))).resolves.toEqual({
      outcome,
      principal: null,
    });
    expect(findToken).not.toHaveBeenCalled();
  });

  it('distinguishes unknown, revoked, expired and valid credentials', async () => {
    const token = generateMobileToken();
    findToken
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(tokenRow({ revokedAt: new Date() }) as never)
      .mockResolvedValueOnce(tokenRow({ expiresAt: new Date(Date.now() - 1) }) as never)
      .mockResolvedValueOnce(tokenRow() as never);

    await expect(
      authenticateMobileRequestDetailed(bearer(`Bearer ${token}`)),
    ).resolves.toMatchObject({ outcome: 'not-found', principal: null });
    await expect(
      authenticateMobileRequestDetailed(bearer(`Bearer ${token}`)),
    ).resolves.toMatchObject({ outcome: 'revoked', principal: null });
    await expect(
      authenticateMobileRequestDetailed(bearer(`Bearer ${token}`)),
    ).resolves.toMatchObject({ outcome: 'expired', principal: null });
    await expect(authenticateMobileRequestDetailed(bearer(`Bearer ${token}`))).resolves.toEqual({
      outcome: 'valid',
      principal: { tokenId: 'token-id', userId: 'user-id', deviceId: 'device-id' },
    });

    const lookup = findToken.mock.calls[0]?.[0];
    expect(JSON.stringify(lookup)).not.toContain(token);
    expect(JSON.stringify(lookup)).toContain(hashMobileToken(token));
  });
});
