import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({ getCurrentUserId: vi.fn() }));
vi.mock('@/lib/mobile-auth', () => ({ authenticateMobileRequest: vi.fn() }));

import { getCurrentUserId } from '@/lib/auth';
import { authenticateMobileRequest } from '@/lib/mobile-auth';
import { ApiError, requireApiUserId } from '@/lib/api';

const mockedCurrentUser = vi.mocked(getCurrentUserId);
const mockedMobileAuth = vi.mocked(authenticateMobileRequest);

describe('requireApiUserId request authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedMobileAuth.mockResolvedValue(null);
    mockedCurrentUser.mockResolvedValue(null);
  });

  it('accepts a valid mobile Bearer principal before checking the web session', async () => {
    mockedMobileAuth.mockResolvedValue({
      tokenId: 'token_1',
      userId: 'mobile_user',
      deviceId: 'device_1',
    });

    await expect(
      requireApiUserId(
        new Request('http://test.local/api/coach', {
          headers: { Authorization: 'Bearer gma_valid' },
        }),
      ),
    ).resolves.toBe('mobile_user');
    expect(mockedCurrentUser).not.toHaveBeenCalled();
  });

  it('preserves cookie-backed web authentication when no valid mobile token exists', async () => {
    mockedCurrentUser.mockResolvedValue('web_user');

    await expect(
      requireApiUserId(
        new Request('http://test.local/api/coach', {
          headers: { Cookie: 'authjs.session-token=web-session' },
        }),
      ),
    ).resolves.toBe('web_user');
  });

  it('rejects an invalid Bearer request without a valid web session', async () => {
    await expect(
      requireApiUserId(
        new Request('http://test.local/api/coach', {
          headers: { Authorization: 'Bearer gma_invalid' },
        }),
      ),
    ).rejects.toEqual(expect.objectContaining<Partial<ApiError>>({ status: 401 }));
  });
});
