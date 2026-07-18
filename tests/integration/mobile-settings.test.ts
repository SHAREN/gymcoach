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
    expect((await getProfile(request('http://test/api/profile', 'GET', token))).status).toBe(200);

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

  it('round-trips the additive coaching profile without old partial writes erasing it', async () => {
    const { token } = await mobileUser('mobile-coaching-profile@test.dev');

    const initial = await getProfile(request('http://test/api/profile', 'GET', token));
    expect(initial.status).toBe(200);
    expect(await initial.json()).toMatchObject({
      coachingProfile: {
        version: 1,
        healthStatus: { state: 'UNKNOWN', value: null, updatedAt: null },
        limitations: { state: 'UNKNOWN', value: null, updatedAt: null },
      },
    });

    const saved = await patchProfile(
      request('http://test/api/profile', 'PATCH', token, {
        coachingProfile: {
          healthStatus: { state: 'KNOWN', value: 'TRAIN_WITH_LIMITATIONS' },
          trainingLevel: { state: 'KNOWN', value: 'INTERMEDIATE' },
          availableWeekdays: { state: 'KNOWN', value: [5, 1, 3] },
          maximumSessionDurationMin: { state: 'KNOWN', value: 75 },
          limitations: {
            state: 'KNOWN',
            value: {
              entries: [
                {
                  kind: 'DISCOURAGED_EXERCISE',
                  label: 'Self-reported pressing constraint',
                  affectedExerciseNames: ['Bench press'],
                },
              ],
            },
          },
          priorityMuscles: { state: 'KNOWN', value: ['BACK_WIDTH'] },
          priorityStrengthMovements: { state: 'KNOWN', value: ['Pull-up'] },
          outsideActivities: {
            state: 'KNOWN',
            value: [
              {
                type: 'CARDIO',
                name: 'Cycling',
                sessionsPerWeek: 2,
                minutesPerWeek: 90,
                intensity: 'MODERATE',
              },
            ],
          },
          likedExercises: { state: 'KNOWN', value: ['Pull-up'] },
          dislikedExercises: { state: 'NOT_APPLICABLE' },
          averageSleepHours: { state: 'KNOWN', value: 7.5 },
          baselineStress: { state: 'KNOWN', value: 3 },
          generalRecovery: { state: 'KNOWN', value: 4 },
        },
      }),
    );
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      coachingProfile: {
        availableWeekdays: { state: 'KNOWN', value: [1, 3, 5] },
        dislikedExercises: { state: 'NOT_APPLICABLE', value: null },
        updatedAt: expect.any(String),
      },
    });

    const legacyPartial = await patchProfile(
      request('http://test/api/profile', 'PATCH', token, { displayName: 'Legacy Android' }),
    );
    expect(legacyPartial.status).toBe(200);
    expect(await legacyPartial.json()).toMatchObject({
      displayName: 'Legacy Android',
      coachingProfile: {
        healthStatus: { state: 'KNOWN', value: 'TRAIN_WITH_LIMITATIONS' },
        availableWeekdays: { state: 'KNOWN', value: [1, 3, 5] },
      },
    });

    const [healthPatch, sleepPatch] = await Promise.all([
      patchProfile(
        request('http://test/api/profile', 'PATCH', token, {
          coachingProfile: {
            healthStatus: { state: 'KNOWN', value: 'NO_SIGNIFICANT_ISSUES' },
          },
        }),
      ),
      patchProfile(
        request('http://test/api/profile', 'PATCH', token, {
          coachingProfile: { averageSleepHours: { state: 'KNOWN', value: 8 } },
        }),
      ),
    ]);
    expect(healthPatch.status).toBe(200);
    expect(sleepPatch.status).toBe(200);
    const afterConcurrent = await getProfile(request('http://test/api/profile', 'GET', token));
    expect(await afterConcurrent.json()).toMatchObject({
      coachingProfile: {
        healthStatus: { state: 'KNOWN', value: 'NO_SIGNIFICANT_ISSUES' },
        averageSleepHours: { state: 'KNOWN', value: 8 },
        availableWeekdays: { state: 'KNOWN', value: [1, 3, 5] },
      },
    });
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
