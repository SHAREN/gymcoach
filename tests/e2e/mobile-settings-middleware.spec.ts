import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type APIResponse,
} from '@playwright/test';
import { db } from '../../lib/db';
import {
  generateMobileToken,
  hashMobileToken,
  mobileTokenExpiry,
  visibleMobileTokenPrefix,
} from '../../lib/mobile-auth';

async function createStoredToken(userId: string, state: 'revoked' | 'expired'): Promise<string> {
  const token = generateMobileToken();
  await db.mobileAccessToken.create({
    data: {
      userId,
      deviceId: `settings-e2e-${state}-device`,
      deviceName: `Settings E2E ${state}`,
      tokenHash: hashMobileToken(token),
      tokenPrefix: visibleMobileTokenPrefix(token),
      expiresAt: state === 'expired' ? new Date(Date.now() - 60_000) : mobileTokenExpiry(),
      revokedAt: state === 'revoked' ? new Date() : null,
    },
  });
  return token;
}

async function expectAuthFailure(
  response: APIResponse,
  outcome: string,
  code: string,
): Promise<void> {
  expect(response.status()).toBe(401);
  expect(response.headers()['x-gymcoach-auth-outcome']).toBe(outcome);
  expect(response.headers()['x-gymcoach-error-code']).toBe(code);
  expect(await response.json()).toMatchObject({ error: 'Unauthorized', code });
}

test('Android Bearer Settings crosses the real middleware boundary with safe outcomes', async ({
  baseURL,
}) => {
  const origin = baseURL ?? 'http://localhost:3031';
  const anonymous = await playwrightRequest.newContext({ baseURL: origin });
  const web = await playwrightRequest.newContext({ baseURL: origin });
  const email = `e2e-mobile-settings-${Date.now()}@test.dev`;
  const password = 'supersecret';

  try {
    const register = await web.post('/api/auth/register', {
      headers: { 'x-forwarded-for': '10.111.0.81' },
      data: {
        displayName: 'Mobile Settings E2E',
        email,
        password,
      },
    });
    expect(register.ok()).toBeTruthy();

    const login = await anonymous.post('/api/mobile/auth/login', {
      headers: { 'x-forwarded-for': '10.111.0.82' },
      data: {
        email,
        password,
        deviceId: 'settings-e2e-valid-device',
        deviceName: 'Settings E2E Android',
      },
    });
    expect(login.ok()).toBeTruthy();
    const { accessToken } = (await login.json()) as { accessToken: string };

    const createGym = await anonymous.post('/api/gyms', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-GymCoach-Correlation-ID': 'settings-e2e-create-gym',
      },
      data: {
        name: 'Settings E2E Gym',
        dumbbellWeights: [],
        plateWeights: [],
        barWeights: [],
        exerciseConfigs: [],
        makeActive: true,
      },
    });
    expect(createGym.status()).toBe(201);
    expect(createGym.headers()['x-gymcoach-auth-outcome']).toBe('valid');
    const gym = (await createGym.json()) as { id: string };

    const validRequests: Array<[string, string, string]> = [
      ['/api/profile', 'profile', 'settings-e2e-profile'],
      ['/api/gyms', 'gyms', 'settings-e2e-gyms'],
      ['/api/mobile/exercises', 'exercises', 'settings-e2e-exercises'],
      [`/api/gyms/${gym.id}/equipment`, 'gym-equipment', 'settings-e2e-gym-equipment'],
    ];
    for (const [path, subrequest, correlationId] of validRequests) {
      const response = await anonymous.get(path, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-GymCoach-Correlation-ID': correlationId,
        },
      });
      expect(response.status()).toBe(200);
      expect(response.headers()['x-gymcoach-correlation-id']).toBe(correlationId);
      expect(response.headers()['x-gymcoach-settings-subrequest']).toBe(subrequest);
      expect(response.headers()['x-gymcoach-auth-outcome']).toBe('valid');
      expect(response.headers()['x-gymcoach-auth-scheme']).toBe('bearer');
      expect(response.headers()['x-gymcoach-error-code']).toBe('ok');
    }

    const cookieProfile = await web.get('/api/profile', {
      headers: { 'X-GymCoach-Correlation-ID': 'settings-e2e-cookie' },
    });
    expect(cookieProfile.status()).toBe(200);
    expect(cookieProfile.headers()['x-gymcoach-auth-scheme']).toBe('cookie');
    expect(await cookieProfile.json()).toMatchObject({ email });

    const cookieWithMalformedBearer = await web.get('/api/profile', {
      headers: {
        Authorization: 'Bearer malformed',
        'X-GymCoach-Correlation-ID': 'settings-e2e-cookie-coexistence',
      },
    });
    expect(cookieWithMalformedBearer.status()).toBe(200);
    expect(cookieWithMalformedBearer.headers()['x-gymcoach-auth-outcome']).toBe('valid');
    expect(cookieWithMalformedBearer.headers()['x-gymcoach-auth-scheme']).toBe('cookie');

    await expectAuthFailure(await anonymous.get('/api/profile'), 'missing', 'mobile_auth_missing');
    await expectAuthFailure(
      await anonymous.get('/api/profile', {
        headers: {
          Authorization: 'Bearer malformed',
          'X-GymCoach-Correlation-ID': 'settings-e2e-malformed',
        },
      }),
      'malformed',
      'mobile_auth_malformed',
    );
    await expectAuthFailure(
      await anonymous.get('/api/profile', {
        headers: {
          Authorization: `Bearer ${generateMobileToken()}`,
          'X-GymCoach-Correlation-ID': 'settings-e2e-not-found',
        },
      }),
      'not-found',
      'mobile_auth_not_found',
    );

    const user = await db.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
    const revokedToken = await createStoredToken(user.id, 'revoked');
    const expiredToken = await createStoredToken(user.id, 'expired');
    await expectAuthFailure(
      await anonymous.get('/api/profile', {
        headers: {
          Authorization: `Bearer ${revokedToken}`,
          'X-GymCoach-Correlation-ID': 'settings-e2e-revoked',
        },
      }),
      'revoked',
      'mobile_auth_revoked',
    );
    await expectAuthFailure(
      await anonymous.get('/api/profile', {
        headers: {
          Authorization: `Bearer ${expiredToken}`,
          'X-GymCoach-Correlation-ID': 'settings-e2e-expired',
        },
      }),
      'expired',
      'mobile_auth_expired',
    );

    const unrelated = await anonymous.get('/api/sessions', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(unrelated.status()).toBe(401);
    expect(unrelated.headers()['x-gymcoach-settings-subrequest']).toBeUndefined();
  } finally {
    await Promise.all([anonymous.dispose(), web.dispose()]);
  }
});
