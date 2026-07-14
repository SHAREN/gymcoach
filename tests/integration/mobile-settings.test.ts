import { describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import {
  generateMobileToken,
  hashMobileToken,
  mobileTokenExpiry,
  visibleMobileTokenPrefix,
} from '@/lib/mobile-auth';
import { GET as getProfile, PATCH as patchProfile } from '@/app/api/profile/route';
import { GET as listGyms, POST as createGym } from '@/app/api/gyms/route';
import { PUT as updateGym } from '@/app/api/gyms/[id]/route';
import { GET as exportBackup } from '@/app/api/backup/route';

function request(url: string, method = 'GET', token?: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function mobileUser(email: string) {
  const user = await db.user.create({ data: { email, passwordHash: 'unused' } });
  const token = generateMobileToken();
  await db.mobileAccessToken.create({
    data: {
      userId: user.id,
      deviceId: `${email}-device`,
      deviceName: 'Settings integration test',
      tokenHash: hashMobileToken(token),
      tokenPrefix: visibleMobileTokenPrefix(token),
      expiresAt: mobileTokenExpiry(),
    },
  });
  return { user, token };
}

describe('Android native settings API compatibility', () => {
  it('uses the mobile bearer principal for profile, gyms and backup export', async () => {
    const { token } = await mobileUser('mobile-settings@test.dev');

    const profileResponse = await patchProfile(
      request('http://test/api/profile', 'PATCH', token, {
        displayName: 'Native settings',
        bodyweight: 82.5,
        heightCm: 180,
        weeklyFrequency: 4,
        goal: 'STRENGTH',
        sex: 'MALE',
        unit: 'KG',
      }),
    );
    expect(profileResponse.status).toBe(200);
    expect(await profileResponse.json()).toMatchObject({
      email: 'mobile-settings@test.dev',
      displayName: 'Native settings',
      weeklyFrequency: 4,
    });
    expect(
      (await getProfile(request('http://test/api/profile', 'GET', token))).status,
    ).toBe(200);

    const gymResponse = await createGym(
      request('http://test/api/gyms', 'POST', token, {
        name: 'Basement gym',
        dumbbellWeights: [10, 12.5, 20],
        plateWeights: [1.25, 2.5, 5, 10, 20],
        barWeights: [20],
        exerciseConfigs: [],
        makeActive: true,
      }),
    );
    expect(gymResponse.status).toBe(201);
    const gym = (await gymResponse.json()) as { id: string };
    const listResponse = await listGyms(request('http://test/api/gyms', 'GET', token));
    expect(listResponse.status).toBe(200);
    expect(await listResponse.json()).toMatchObject({
      activeGymId: gym.id,
      gyms: [{ id: gym.id, name: 'Basement gym' }],
    });

    const backupResponse = await exportBackup(request('http://test/api/backup', 'GET', token));
    expect(backupResponse.status).toBe(200);
    expect(await backupResponse.json()).toMatchObject({ version: expect.any(Number) });
  });

  it('does not allow one mobile account to edit another account gym', async () => {
    const owner = await mobileUser('settings-owner@test.dev');
    const attacker = await mobileUser('settings-attacker@test.dev');
    const gym = await db.gym.create({ data: { userId: owner.user.id, name: 'Private gym' } });

    const response = await updateGym(
      request(`http://test/api/gyms/${gym.id}`, 'PUT', attacker.token, {
        name: 'Changed',
        dumbbellWeights: [],
        plateWeights: [],
        barWeights: [],
        exerciseConfigs: [],
      }),
      { params: Promise.resolve({ id: gym.id }) },
    );
    expect(response.status).toBe(404);
    await expect(db.gym.findUnique({ where: { id: gym.id } })).resolves.toMatchObject({
      name: 'Private gym',
    });
  });
});
