import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';
import { buildMobileBootstrap } from '@/lib/mobile-bootstrap';
import {
  generateMobileToken,
  hashMobileToken,
  mobileTokenExpiry,
  visibleMobileTokenPrefix,
} from '@/lib/mobile-auth';

vi.mock('@/lib/auth', () => ({ getCurrentUserId: vi.fn() }));
const mockUserId = vi.mocked(getCurrentUserId);

import { GET as getInventory } from '@/app/api/gyms/[id]/equipment/route';
import {
  DELETE as deleteSystemProfile,
  PUT as updateSystemProfile,
} from '@/app/api/gyms/[id]/system-profiles/[profile]/route';
import {
  DELETE as deleteEquipment,
  PUT as updateEquipment,
} from '@/app/api/gym-equipment/[id]/route';
import { PUT as updateGym } from '@/app/api/gyms/[id]/route';
import { DELETE as deletePlatePool } from '@/app/api/gym-plate-pools/[id]/route';

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

function gymParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function profileParams(id: string, profile: string) {
  return { params: Promise.resolve({ id, profile }) };
}

async function seedOwner() {
  const user = await db.user.create({
    data: { email: `system-profiles-${crypto.randomUUID()}@test.dev`, passwordHash: 'unused' },
  });
  const token = generateMobileToken();
  await db.mobileAccessToken.create({
    data: {
      userId: user.id,
      deviceId: `${user.id}-device`,
      deviceName: 'System profile integration',
      tokenHash: hashMobileToken(token),
      tokenPrefix: visibleMobileTokenPrefix(token),
      expiresAt: mobileTokenExpiry(),
    },
  });
  const gym = await db.gym.create({
    data: {
      userId: user.id,
      name: 'Olymp',
      inventoryMode: 'EQUIPMENT_FIRST',
      dumbbellWeights: [10, 12.5, 20],
    },
  });
  await db.user.update({ where: { id: user.id }, data: { activeGymId: gym.id } });
  return { user, token, gym };
}

beforeEach(() => mockUserId.mockReset());

describe('system free-weight profiles', () => {
  it('normalizes Olymp in place, saves idempotently, and rejects direct deletion or conversion', async () => {
    const { user, token, gym } = await seedOwner();
    const [dumbbellExercise, barbellExercise, inferredDumbbellExercise, inferredBarbellExercise] =
      await Promise.all([
        db.exercise.create({
          data: {
            userId: user.id,
            name: 'Dumbbell press',
            muscleGroup: 'CHEST',
            category: 'COMPOUND',
            equipmentType: 'DUMBBELL',
          },
        }),
        db.exercise.create({
          data: {
            userId: user.id,
            name: 'Barbell squat',
            muscleGroup: 'QUADS',
            category: 'COMPOUND',
            equipmentType: 'BARBELL',
          },
        }),
        db.exercise.create({
          data: {
            userId: user.id,
            name: 'Dumbbell fly from an old backup',
            muscleGroup: 'CHEST',
            category: 'ISOLATION',
            equipmentType: 'OTHER',
          },
        }),
        db.exercise.create({
          data: {
            userId: user.id,
            name: 'EZ-bar curl from an old backup',
            muscleGroup: 'BICEPS',
            category: 'ISOLATION',
            equipmentType: 'OTHER',
          },
        }),
      ]);
    const largePool = await db.gymPlatePool.create({
      data: {
        gymId: gym.id,
        name: 'Блины большого диаметра',
        compatibilityKey: 'legacy-default',
        plates: {
          createMany: {
            data: [1.25, 2.5, 5, 10, 15, 20].map((weightKg) => ({
              weightKg,
              quantity: null,
            })),
          },
        },
      },
    });
    const smallPool = await db.gymPlatePool.create({
      data: {
        gymId: gym.id,
        name: 'Блины малого диаметра',
        compatibilityKey: 'small_diameter',
        plates: {
          createMany: {
            data: [1.25, 2.5, 3.5, 5].map((weightKg) => ({
              weightKg,
              quantity: null,
            })),
          },
        },
      },
    });
    const bars = await Promise.all(
      [
        ['large-12', 12, largePool.id],
        ['large-17.5', 17.5, largePool.id],
        ['large-20', 20, largePool.id],
        ['small-6', 6, smallPool.id],
      ].map(([name, baseLoadKg, platePoolId]) =>
        db.gymEquipment.create({
          data: {
            gymId: gym.id,
            name: String(name),
            equipmentType: 'BARBELL',
            loadType: 'PLATE_LOADED',
            baseLoadKg: Number(baseLoadKg),
            platePoolId: String(platePoolId),
            loadingSides: 2,
          },
        }),
      ),
    );
    const customCable = await db.gymEquipment.create({
      data: {
        gymId: gym.id,
        name: 'Custom cable',
        equipmentType: 'CABLE',
        loadType: 'SELECTORIZED',
        weightOptions: [10, 20],
      },
    });
    const barbellConfig = await db.gymExerciseConfig.create({
      data: {
        gymId: gym.id,
        exerciseId: barbellExercise.id,
        preferredEquipmentId: bars[2]!.id,
        isEquipmentMirror: true,
      },
    });
    const session = await db.session.create({
      data: { userId: user.id, gymId: gym.id, finishedAt: new Date() },
    });
    const historicalSet = await db.set.create({
      data: {
        sessionId: session.id,
        exerciseId: barbellExercise.id,
        gymEquipmentId: bars[2]!.id,
        equipmentNameSnapshot: bars[2]!.name,
        equipmentLoadSnapshot: { version: 2, platePoolId: largePool.id },
        setNumber: 1,
        weight: 20,
        reps: 5,
      },
    });

    const normalizedResponse = await getInventory(
      request(`http://test.local/api/gyms/${gym.id}/equipment`, 'GET', token),
      gymParams(gym.id),
    );
    expect(normalizedResponse.status).toBe(200);
    const normalized = await normalizedResponse.json();
    expect(normalized.gym.systemProfiles.dumbbells.exerciseLinks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: dumbbellExercise.id }),
        expect.objectContaining({ id: inferredDumbbellExercise.id }),
      ]),
    );
    expect(normalized.gym.systemProfiles.barbell.exerciseLinks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: barbellExercise.id }),
        expect.objectContaining({ id: inferredBarbellExercise.id }),
      ]),
    );
    expect(normalized.gym.systemProfiles.barbell.families).toEqual([
      expect.objectContaining({
        family: 'LARGE',
        pool: expect.objectContaining({ id: largePool.id }),
        bars: expect.arrayContaining([
          expect.objectContaining({ id: bars[0]!.id, baseLoadKg: 12 }),
          expect.objectContaining({ id: bars[1]!.id, baseLoadKg: 17.5 }),
          expect.objectContaining({ id: bars[2]!.id, baseLoadKg: 20 }),
        ]),
      }),
      expect.objectContaining({
        family: 'SMALL',
        pool: expect.objectContaining({ id: smallPool.id }),
        bars: [expect.objectContaining({ id: bars[3]!.id, baseLoadKg: 6 })],
      }),
    ]);
    expect(
      await db.gymEquipmentExercise.count({
        where: {
          exerciseId: inferredBarbellExercise.id,
          equipment: { gymId: gym.id, systemBarbellFamily: { not: null } },
        },
      }),
    ).toBe(4);

    const removeDumbbellSupport = await updateSystemProfile(
      request(`http://test.local/api/gyms/${gym.id}/system-profiles/dumbbells`, 'PUT', token, {
        weightsKg: [10, 12.5, 20],
        exerciseIds: [],
      }),
      profileParams(gym.id, 'dumbbells'),
    );
    expect(removeDumbbellSupport.status).toBe(200);
    expect(
      await db.gymExerciseConfig.findUnique({
        where: { gymId_exerciseId: { gymId: gym.id, exerciseId: dumbbellExercise.id } },
        select: { systemProfileSupported: true },
      }),
    ).toEqual({ systemProfileSupported: false });
    const restoreDumbbellSupport = await updateSystemProfile(
      request(`http://test.local/api/gyms/${gym.id}/system-profiles/dumbbells`, 'PUT', token, {
        weightsKg: [10, 12.5, 20],
        exerciseIds: [dumbbellExercise.id],
      }),
      profileParams(gym.id, 'dumbbells'),
    );
    expect(restoreDumbbellSupport.status).toBe(200);

    const body = {
      exerciseIds: [barbellExercise.id],
      families: [
        {
          family: 'LARGE',
          loadingSides: 2,
          bars: bars.slice(0, 3).map((bar) => ({
            equipmentId: bar.id,
            weightKg: bar.baseLoadKg,
          })),
          plates: [1.25, 2.5, 5, 10, 15, 20].map((weightKg) => ({
            weightKg,
            quantity: null,
          })),
        },
        {
          family: 'SMALL',
          loadingSides: 2,
          bars: [{ equipmentId: bars[3]!.id, weightKg: 6 }],
          plates: [1.25, 2.5, 3.5, 5].map((weightKg) => ({
            weightKg,
            quantity: null,
          })),
        },
      ],
    };
    const activeSession = await db.session.create({
      data: { userId: user.id, gymId: gym.id },
    });
    const activeSet = await db.set.create({
      data: {
        sessionId: activeSession.id,
        exerciseId: barbellExercise.id,
        gymEquipmentId: bars[0]!.id,
        equipmentNameSnapshot: bars[0]!.name,
        equipmentLoadSnapshot: { version: 2, platePoolId: largePool.id },
        setNumber: 1,
        weight: 12,
        reps: 5,
      },
    });
    const removeActiveBarResponse = await updateSystemProfile(
      request(`http://test.local/api/gyms/${gym.id}/system-profiles/barbell`, 'PUT', token, {
        ...body,
        families: body.families.map((family) =>
          family.family === 'LARGE'
            ? {
                ...family,
                bars: family.bars.filter((bar) => bar.equipmentId !== bars[0]!.id),
              }
            : family,
        ),
      }),
      profileParams(gym.id, 'barbell'),
    );
    expect(removeActiveBarResponse.status).toBe(409);
    await expect(removeActiveBarResponse.json()).resolves.toEqual({
      error: 'A system bar used by an active session cannot be removed.',
    });
    expect(await db.set.findUniqueOrThrow({ where: { id: activeSet.id } })).toMatchObject({
      gymEquipmentId: bars[0]!.id,
      equipmentNameSnapshot: bars[0]!.name,
      equipmentLoadSnapshot: { version: 2, platePoolId: largePool.id },
    });
    expect(await db.gymEquipment.findUnique({ where: { id: bars[0]!.id } })).not.toBeNull();

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await updateSystemProfile(
        request(`http://test.local/api/gyms/${gym.id}/system-profiles/barbell`, 'PUT', token, body),
        profileParams(gym.id, 'barbell'),
      );
      expect(response.status).toBe(200);
    }

    expect(
      await db.gymEquipment.findMany({
        where: { gymId: gym.id, systemBarbellFamily: { not: null } },
        orderBy: { baseLoadKg: 'asc' },
        select: { id: true, baseLoadKg: true, systemBarbellFamily: true },
      }),
    ).toEqual([
      { id: bars[3]!.id, baseLoadKg: 6, systemBarbellFamily: 'SMALL' },
      { id: bars[0]!.id, baseLoadKg: 12, systemBarbellFamily: 'LARGE' },
      { id: bars[1]!.id, baseLoadKg: 17.5, systemBarbellFamily: 'LARGE' },
      { id: bars[2]!.id, baseLoadKg: 20, systemBarbellFamily: 'LARGE' },
    ]);
    expect(await db.gymEquipment.findUnique({ where: { id: customCable.id } })).not.toBeNull();
    expect(
      await db.gymExerciseConfig.findUnique({
        where: { gymId_exerciseId: { gymId: gym.id, exerciseId: barbellExercise.id } },
        select: {
          id: true,
          preferredEquipmentId: true,
          isEquipmentMirror: true,
          systemProfileSupported: true,
        },
      }),
    ).toEqual({
      id: barbellConfig.id,
      preferredEquipmentId: bars[2]!.id,
      isEquipmentMirror: false,
      systemProfileSupported: true,
    });
    const renameResponse = await updateGym(
      request(`http://test.local/api/gyms/${gym.id}`, 'PUT', token, {
        name: 'Olymp renamed',
        inventoryMode: 'EQUIPMENT_FIRST',
        exerciseConfigs: [],
      }),
      gymParams(gym.id),
    );
    expect(renameResponse.status).toBe(200);
    expect(
      await db.gymExerciseConfig.findUnique({
        where: { gymId_exerciseId: { gymId: gym.id, exerciseId: barbellExercise.id } },
        select: { preferredEquipmentId: true, systemProfileSupported: true },
      }),
    ).toEqual({ preferredEquipmentId: bars[2]!.id, systemProfileSupported: true });
    expect((await db.gym.findUniqueOrThrow({ where: { id: gym.id } })).dumbbellWeights).toEqual([
      10, 12.5, 20,
    ]);
    expect(await db.set.findUnique({ where: { id: historicalSet.id } })).toMatchObject({
      gymEquipmentId: bars[2]!.id,
      equipmentNameSnapshot: bars[2]!.name,
      equipmentLoadSnapshot: { version: 2, platePoolId: largePool.id },
    });
    const mobileGym = (await buildMobileBootstrap(user.id)).gyms.find((item) => item.id === gym.id);
    expect(mobileGym).toMatchObject({
      dumbbellWeights: [10, 12.5, 20],
      exerciseConfigs: expect.arrayContaining([
        expect.objectContaining({
          exerciseId: dumbbellExercise.id,
          systemProfileSupported: true,
        }),
        expect.objectContaining({
          exerciseId: barbellExercise.id,
          systemProfileSupported: true,
        }),
      ]),
      equipment: expect.arrayContaining([
        expect.objectContaining({ id: bars[0]!.id, systemBarbellFamily: 'LARGE' }),
        expect.objectContaining({ id: bars[3]!.id, systemBarbellFamily: 'SMALL' }),
      ]),
    });

    const coverageResponse = await getInventory(
      request(`http://test.local/api/gyms/${gym.id}/equipment`, 'GET', token),
      gymParams(gym.id),
    );
    const coverage = (await coverageResponse.json()).gym.exerciseCoverage.find(
      (item: { id: string }) => item.id === barbellExercise.id,
    );
    const largeLoads = coverage.equipmentOptions.find(
      (item: { equipmentId: string }) => item.equipmentId === bars[0]!.id,
    ).attainableLoads;
    const smallLoads = coverage.equipmentOptions.find(
      (item: { equipmentId: string }) => item.equipmentId === bars[3]!.id,
    ).attainableLoads;
    expect(largeLoads).toContain(32);
    expect(smallLoads).toContain(13);
    expect(
      coverage.equipmentOptions.find(
        (item: { equipmentId: string }) => item.equipmentId === bars[0]!.id,
      ),
    ).toMatchObject({
      platePoolId: largePool.id,
      plates: expect.arrayContaining([expect.objectContaining({ weightKg: 20 })]),
    });
    expect(
      coverage.equipmentOptions.find(
        (item: { equipmentId: string }) => item.equipmentId === bars[3]!.id,
      ),
    ).toMatchObject({
      platePoolId: smallPool.id,
      plates: expect.arrayContaining([expect.objectContaining({ weightKg: 3.5 })]),
    });

    const virtualProfileId = `system-profile-barbell-${gym.id}`;
    const deleteProfileResponse = await deleteSystemProfile(
      request(`http://test.local/api/gyms/${gym.id}/system-profiles/barbell`, 'DELETE', token),
      profileParams(gym.id, 'barbell'),
    );
    expect(deleteProfileResponse.status).toBe(409);
    expect(
      (
        await updateEquipment(
          request(`http://test.local/api/gym-equipment/${virtualProfileId}`, 'PUT', token, {
            name: 'Converted machine',
            equipmentType: 'MACHINE',
          }),
          gymParams(virtualProfileId),
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await deleteEquipment(
          request(`http://test.local/api/gym-equipment/${bars[0]!.id}`, 'DELETE', token),
          gymParams(bars[0]!.id),
        )
      ).status,
    ).toBe(409);
    mockUserId.mockResolvedValue(user.id);
    expect(
      (
        await deletePlatePool(
          request(`http://test.local/api/gym-plate-pools/${largePool.id}`, 'DELETE', token),
          gymParams(largePool.id),
        )
      ).status,
    ).toBe(409);
  });
});
