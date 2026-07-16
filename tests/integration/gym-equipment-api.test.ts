import { Buffer } from 'node:buffer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';
import {
  generateMobileToken,
  hashMobileToken,
  mobileTokenExpiry,
  visibleMobileTokenPrefix,
} from '@/lib/mobile-auth';

vi.mock('@/lib/auth', () => ({ getCurrentUserId: vi.fn() }));
const mockUserId = vi.mocked(getCurrentUserId);

import { GET as getInventory, POST as createEquipment } from '@/app/api/gyms/[id]/equipment/route';
import {
  DELETE as deleteEquipment,
  PUT as updateEquipment,
} from '@/app/api/gym-equipment/[id]/route';
import {
  DELETE as deleteImage,
  GET as getImage,
  PUT as setImage,
} from '@/app/api/gym-equipment/[id]/image/route';
import { PATCH as updateExerciseWeights } from '@/app/api/gyms/[id]/weights/route';
import { PATCH as updateInventoryMode } from '@/app/api/gyms/[id]/inventory/route';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

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

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function seedUser(email: string) {
  const user = await db.user.create({ data: { email, passwordHash: 'unused' } });
  const token = generateMobileToken();
  await db.mobileAccessToken.create({
    data: {
      userId: user.id,
      deviceId: `${user.id}-device`,
      deviceName: 'Equipment integration',
      tokenHash: hashMobileToken(token),
      tokenPrefix: visibleMobileTokenPrefix(token),
      expiresAt: mobileTokenExpiry(),
    },
  });
  const gym = await db.gym.create({ data: { userId: user.id, name: `${email} gym` } });
  await db.user.update({ where: { id: user.id }, data: { activeGymId: gym.id } });
  return { user, token, gym };
}

beforeEach(() => mockUserId.mockReset());

describe('gym equipment REST API', () => {
  it('supports bearer CRUD, exercise links, image URL and uploaded image replacement', async () => {
    const { user, token, gym } = await seedUser('equipment-mobile@test.dev');
    const exercise = await db.exercise.create({
      data: {
        userId: user.id,
        name: 'Cable row',
        muscleGroup: 'BACK_THICKNESS',
        category: 'COMPOUND',
        equipmentType: 'CABLE',
      },
    });

    const createdResponse = await createEquipment(
      request(`http://test.local/api/gyms/${gym.id}/equipment`, 'POST', token, {
        name: 'Dual cable station',
        equipmentType: 'CABLE',
        description: 'Two adjustable pulleys',
        manufacturer: 'GymCo',
        modelName: 'DC-2',
        quantity: 2,
        weightOptions: [20, 10, 20],
        exerciseIds: [exercise.id],
      }),
      params(gym.id),
    );
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as { equipment: { id: string } };

    const inventoryResponse = await getInventory(
      request(`http://test.local/api/gyms/${gym.id}/equipment`, 'GET', token),
      params(gym.id),
    );
    expect(inventoryResponse.status).toBe(200);
    expect(await inventoryResponse.json()).toMatchObject({
      gym: {
        id: gym.id,
        equipment: [
          {
            id: created.equipment.id,
            name: 'Dual cable station',
            quantity: 2,
            weightOptions: [10, 20],
            exerciseLinks: [{ id: exercise.id, name: 'Cable row' }],
          },
        ],
      },
    });
    expect(
      await db.gymExerciseConfig.findUniqueOrThrow({
        where: { gymId_exerciseId: { gymId: gym.id, exerciseId: exercise.id } },
      }),
    ).toMatchObject({ isAvailable: true, weightOptions: [], isEquipmentMirror: true });

    const updatedResponse = await updateEquipment(
      request(`http://test.local/api/gym-equipment/${created.equipment.id}`, 'PUT', token, {
        name: 'Cable crossover',
        equipmentType: 'CABLE',
        description: null,
        manufacturer: 'GymCo',
        modelName: 'DC-3',
        quantity: 1,
        weightOptions: [15, 25],
        exerciseIds: [exercise.id],
      }),
      params(created.equipment.id),
    );
    expect(updatedResponse.status).toBe(200);
    expect(
      await db.gymExerciseConfig.findUniqueOrThrow({
        where: { gymId_exerciseId: { gymId: gym.id, exerciseId: exercise.id } },
      }),
    ).toMatchObject({ isAvailable: true, weightOptions: [], isEquipmentMirror: true });

    expect(
      (
        await setImage(
          request(
            `http://test.local/api/gym-equipment/${created.equipment.id}/image`,
            'PUT',
            token,
            { imageUrl: 'https://images.example.test/cable.jpg' },
          ),
          params(created.equipment.id),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await setImage(
          request(
            `http://test.local/api/gym-equipment/${created.equipment.id}/image`,
            'PUT',
            token,
            { imageBase64: PNG.toString('base64'), mimeType: 'image/png' },
          ),
          params(created.equipment.id),
        )
      ).status,
    ).toBe(200);

    const imageResponse = await getImage(
      request(`http://test.local/api/gym-equipment/${created.equipment.id}/image`, 'GET', token),
      params(created.equipment.id),
    );
    expect(imageResponse.status).toBe(200);
    expect(Buffer.from(await imageResponse.arrayBuffer())).toEqual(PNG);

    expect(
      (
        await deleteImage(
          request(
            `http://test.local/api/gym-equipment/${created.equipment.id}/image`,
            'DELETE',
            token,
          ),
          params(created.equipment.id),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await deleteEquipment(
          request(`http://test.local/api/gym-equipment/${created.equipment.id}`, 'DELETE', token),
          params(created.equipment.id),
        )
      ).status,
    ).toBe(200);
    expect(await db.gymEquipment.count()).toBe(0);
  });

  it('reconciles legacy availability when REST equipment links are replaced or deleted', async () => {
    const { user, token, gym } = await seedUser('equipment-legacy-mirror@test.dev');
    const exercise = await db.exercise.create({
      data: {
        userId: user.id,
        name: 'Legacy mirrored cable row',
        muscleGroup: 'BACK_THICKNESS',
        category: 'COMPOUND',
        equipmentType: 'CABLE',
      },
    });

    const createLinked = async (name: string, weightOptions: number[]) => {
      const response = await createEquipment(
        request(`http://test.local/api/gyms/${gym.id}/equipment`, 'POST', token, {
          name,
          equipmentType: 'CABLE',
          loadType: 'SELECTORIZED',
          weightOptions,
          exerciseIds: [exercise.id],
        }),
        params(gym.id),
      );
      expect(response.status).toBe(201);
      return ((await response.json()) as { equipment: { id: string } }).equipment.id;
    };

    const firstId = await createLinked('Legacy cable A', [10, 20]);
    const secondId = await createLinked('Legacy cable B', [30, 40]);
    const unmirroredResponse = await createEquipment(
      request(`http://test.local/api/gyms/${gym.id}/equipment`, 'POST', token, {
        name: 'Link-only cable',
        equipmentType: 'CABLE',
        loadType: 'SELECTORIZED',
        weightOptions: [50, 60],
        exerciseIds: [exercise.id],
        markExercisesAvailable: false,
      }),
      params(gym.id),
    );
    expect(unmirroredResponse.status).toBe(201);
    const unmirroredId = ((await unmirroredResponse.json()) as { equipment: { id: string } })
      .equipment.id;
    expect(
      await db.gymExerciseConfig.findUniqueOrThrow({
        where: { gymId_exerciseId: { gymId: gym.id, exerciseId: exercise.id } },
      }),
    ).toMatchObject({ isAvailable: true, weightOptions: [], isEquipmentMirror: true });
    expect(
      await db.gymEquipmentExercise.findUniqueOrThrow({
        where: {
          equipmentId_exerciseId: { equipmentId: unmirroredId, exerciseId: exercise.id },
        },
      }),
    ).toMatchObject({ mirrorsLegacyConfig: false });

    const disableFirstMirror = await updateEquipment(
      request(`http://test.local/api/gym-equipment/${firstId}`, 'PUT', token, {
        name: 'Legacy cable A',
        equipmentType: 'CABLE',
        loadType: 'SELECTORIZED',
        weightOptions: [15, 25],
        exerciseIds: [exercise.id],
        markExercisesAvailable: false,
      }),
      params(firstId),
    );
    expect(disableFirstMirror.status).toBe(200);
    expect(
      await db.gymExerciseConfig.findUniqueOrThrow({
        where: { gymId_exerciseId: { gymId: gym.id, exerciseId: exercise.id } },
      }),
    ).toMatchObject({ isAvailable: true, weightOptions: [], isEquipmentMirror: true });

    mockUserId.mockResolvedValue(user.id);
    const legacyModeResponse = await updateInventoryMode(
      request(`http://test.local/api/gyms/${gym.id}/inventory`, 'PATCH', undefined, {
        inventoryMode: 'LEGACY',
      }),
      params(gym.id),
    );
    expect(legacyModeResponse.status).toBe(200);

    await db.gymExerciseConfig.delete({
      where: { gymId_exerciseId: { gymId: gym.id, exerciseId: exercise.id } },
    });
    const rebuiltEquipmentFirstResponse = await updateInventoryMode(
      request(`http://test.local/api/gyms/${gym.id}/inventory`, 'PATCH', undefined, {
        inventoryMode: 'EQUIPMENT_FIRST',
      }),
      params(gym.id),
    );
    expect(rebuiltEquipmentFirstResponse.status).toBe(200);
    expect(
      await db.gymExerciseConfig.findUniqueOrThrow({
        where: { gymId_exerciseId: { gymId: gym.id, exerciseId: exercise.id } },
      }),
    ).toMatchObject({ isAvailable: true, weightOptions: [], isEquipmentMirror: true });
    const legacyAgainResponse = await updateInventoryMode(
      request(`http://test.local/api/gyms/${gym.id}/inventory`, 'PATCH', undefined, {
        inventoryMode: 'LEGACY',
      }),
      params(gym.id),
    );
    expect(legacyAgainResponse.status).toBe(200);

    expect(
      (
        await deleteEquipment(
          request(`http://test.local/api/gym-equipment/${secondId}`, 'DELETE', token),
          params(secondId),
        )
      ).status,
    ).toBe(200);
    expect(
      await db.gymExerciseConfig.count({ where: { gymId: gym.id, exerciseId: exercise.id } }),
    ).toBe(0);
    expect(
      await db.gymEquipmentExercise.count({
        where: { equipmentId: unmirroredId, exerciseId: exercise.id },
      }),
    ).toBe(1);
    await db.gymExerciseConfig.create({
      data: {
        gymId: gym.id,
        exerciseId: exercise.id,
        isAvailable: true,
        isEquipmentMirror: true,
      },
    });
    const equipmentFirstResponse = await updateInventoryMode(
      request(`http://test.local/api/gyms/${gym.id}/inventory`, 'PATCH', undefined, {
        inventoryMode: 'EQUIPMENT_FIRST',
      }),
      params(gym.id),
    );
    expect(equipmentFirstResponse.status).toBe(200);
    expect(
      await db.gymExerciseConfig.findUnique({
        where: { gymId_exerciseId: { gymId: gym.id, exerciseId: exercise.id } },
      }),
    ).toBeNull();

    await deleteEquipment(
      request(`http://test.local/api/gym-equipment/${firstId}`, 'DELETE', token),
      params(firstId),
    );
    await deleteEquipment(
      request(`http://test.local/api/gym-equipment/${unmirroredId}`, 'DELETE', token),
      params(unmirroredId),
    );
  });

  it('never overwrites or deletes an authoritative LEGACY exercise config', async () => {
    const { user, token, gym } = await seedUser('equipment-authoritative-legacy@test.dev');
    await db.gym.update({ where: { id: gym.id }, data: { inventoryMode: 'LEGACY' } });
    const exercise = await db.exercise.create({
      data: {
        userId: user.id,
        name: 'Authoritative legacy cable row',
        muscleGroup: 'BACK_THICKNESS',
        category: 'COMPOUND',
        equipmentType: 'CABLE',
      },
    });
    const authoritativeConfig = {
      isAvailable: false,
      weightOptions: [7, 9],
      dumbbellWeights: [11],
      plateWeights: [1.25],
      barWeights: [10],
      isEquipmentMirror: false,
    };
    await db.gymExerciseConfig.create({
      data: { gymId: gym.id, exerciseId: exercise.id, ...authoritativeConfig },
    });

    const createResponse = await createEquipment(
      request(`http://test.local/api/gyms/${gym.id}/equipment`, 'POST', token, {
        name: 'Legacy gym cable',
        equipmentType: 'CABLE',
        loadType: 'SELECTORIZED',
        weightOptions: [20, 30],
        exerciseIds: [exercise.id],
      }),
      params(gym.id),
    );
    expect(createResponse.status).toBe(201);
    const equipmentId = ((await createResponse.json()) as { equipment: { id: string } }).equipment
      .id;
    expect(
      await db.gymExerciseConfig.findUniqueOrThrow({
        where: { gymId_exerciseId: { gymId: gym.id, exerciseId: exercise.id } },
      }),
    ).toMatchObject(authoritativeConfig);

    const updateResponse = await updateEquipment(
      request(`http://test.local/api/gym-equipment/${equipmentId}`, 'PUT', token, {
        name: 'Legacy gym cable updated',
        equipmentType: 'CABLE',
        loadType: 'SELECTORIZED',
        weightOptions: [25, 35],
        exerciseIds: [],
      }),
      params(equipmentId),
    );
    expect(updateResponse.status).toBe(200);
    expect(
      await db.gymExerciseConfig.findUniqueOrThrow({
        where: { gymId_exerciseId: { gymId: gym.id, exerciseId: exercise.id } },
      }),
    ).toMatchObject(authoritativeConfig);

    expect(
      (
        await deleteEquipment(
          request(`http://test.local/api/gym-equipment/${equipmentId}`, 'DELETE', token),
          params(equipmentId),
        )
      ).status,
    ).toBe(200);
    expect(
      await db.gymExerciseConfig.findUniqueOrThrow({
        where: { gymId_exerciseId: { gymId: gym.id, exerciseId: exercise.id } },
      }),
    ).toMatchObject(authoritativeConfig);
  });

  it('turns an edited compatibility mirror into a durable manual config', async () => {
    const { user, token, gym } = await seedUser('equipment-edit-mirror@test.dev');
    const exercise = await db.exercise.create({
      data: {
        userId: user.id,
        name: 'Editable mirrored cable row',
        muscleGroup: 'BACK_THICKNESS',
        category: 'COMPOUND',
        equipmentType: 'CABLE',
      },
    });
    const createResponse = await createEquipment(
      request(`http://test.local/api/gyms/${gym.id}/equipment`, 'POST', token, {
        name: 'Editable mirror cable',
        equipmentType: 'CABLE',
        loadType: 'SELECTORIZED',
        weightOptions: [10, 20],
        exerciseIds: [exercise.id],
      }),
      params(gym.id),
    );
    const equipmentId = ((await createResponse.json()) as { equipment: { id: string } }).equipment
      .id;

    const weightsResponse = await updateExerciseWeights(
      request(`http://test.local/api/gyms/${gym.id}/weights`, 'PATCH', token, {
        exerciseId: exercise.id,
        scope: 'exercise',
        weightOptions: [12, 24],
      }),
      params(gym.id),
    );
    expect(weightsResponse.status).toBe(200);
    expect(
      await db.gymExerciseConfig.findUniqueOrThrow({
        where: { gymId_exerciseId: { gymId: gym.id, exerciseId: exercise.id } },
      }),
    ).toMatchObject({
      isEquipmentMirror: false,
      isAvailable: true,
      weightOptions: [12, 24],
    });

    await deleteEquipment(
      request(`http://test.local/api/gym-equipment/${equipmentId}`, 'DELETE', token),
      params(equipmentId),
    );
    expect(
      await db.gymExerciseConfig.findUniqueOrThrow({
        where: { gymId_exerciseId: { gymId: gym.id, exerciseId: exercise.id } },
      }),
    ).toMatchObject({ isEquipmentMirror: false, weightOptions: [12, 24] });
  });

  it('edits a small bar preference and lets an older settings payload clear it on unlink', async () => {
    const { user, token, gym } = await seedUser('preferred-bar-settings@test.dev');
    const exercise = await db.exercise.create({
      data: {
        userId: user.id,
        name: 'EZ skull crusher',
        muscleGroup: 'TRICEPS',
        category: 'ISOLATION',
        equipmentType: 'BARBELL',
      },
    });
    const pool = await db.gymPlatePool.create({
      data: {
        gymId: gym.id,
        name: 'Olympic plates',
        compatibilityKey: 'olympic',
        plates: { createMany: { data: [{ weightKg: 5, quantity: 4 }] } },
      },
    });

    const createdResponse = await createEquipment(
      request(`http://test.local/api/gyms/${gym.id}/equipment`, 'POST', token, {
        name: '10 kg EZ bar',
        equipmentType: 'BARBELL',
        loadType: 'PLATE_LOADED',
        baseLoadKg: 10,
        platePoolId: pool.id,
        loadingSides: 2,
        exerciseIds: [exercise.id],
        preferredExerciseIds: [exercise.id],
      }),
      params(gym.id),
    );
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as { equipment: { id: string } };
    expect(
      await db.gymExerciseConfig.findUniqueOrThrow({
        where: { gymId_exerciseId: { gymId: gym.id, exerciseId: exercise.id } },
      }),
    ).toMatchObject({ preferredEquipmentId: created.equipment.id, isEquipmentMirror: false });

    const inventory = await (
      await getInventory(
        request(`http://test.local/api/gyms/${gym.id}/equipment`, 'GET', token),
        params(gym.id),
      )
    ).json();
    expect(inventory.gym.equipment[0]).toMatchObject({
      id: created.equipment.id,
      baseLoadKg: 10,
      loadingSides: 2,
      preferredExerciseIds: [exercise.id],
    });
    expect(
      inventory.gym.exerciseCoverage.find((item: { id: string }) => item.id === exercise.id),
    ).toMatchObject({ preferredEquipmentId: created.equipment.id });

    const updatedResponse = await updateEquipment(
      request(`http://test.local/api/gym-equipment/${created.equipment.id}`, 'PUT', token, {
        name: '10 kg EZ bar',
        equipmentType: 'BARBELL',
        loadType: 'PLATE_LOADED',
        baseLoadKg: 10,
        platePoolId: pool.id,
        loadingSides: 2,
        exerciseIds: [],
      }),
      params(created.equipment.id),
    );
    expect(updatedResponse.status).toBe(200);
    expect(
      await db.gymExerciseConfig.findUniqueOrThrow({
        where: { gymId_exerciseId: { gymId: gym.id, exerciseId: exercise.id } },
      }),
    ).toMatchObject({ preferredEquipmentId: null });
  });

  it('clears a live preferred foreign key on delete while retaining frozen set snapshots', async () => {
    const { user, token, gym } = await seedUser('preferred-delete@test.dev');
    const exercise = await db.exercise.create({
      data: {
        userId: user.id,
        name: 'Preferred curl',
        muscleGroup: 'BICEPS',
        category: 'ISOLATION',
        equipmentType: 'BARBELL',
      },
    });
    const equipment = await db.gymEquipment.create({
      data: { gymId: gym.id, name: 'Frozen EZ bar', equipmentType: 'BARBELL' },
    });
    await db.gymEquipmentExercise.create({
      data: { equipmentId: equipment.id, exerciseId: exercise.id },
    });
    await db.gymExerciseConfig.create({
      data: {
        gymId: gym.id,
        exerciseId: exercise.id,
        preferredEquipmentId: equipment.id,
      },
    });
    const session = await db.session.create({ data: { userId: user.id, gymId: gym.id } });
    const snapshot = {
      version: 1,
      equipmentId: equipment.id,
      equipmentName: equipment.name,
      equipmentType: 'BARBELL',
      loadType: 'PLATE_LOADED',
      selectedLoadKg: 30,
      selectedLoadMultiplier: 1,
      nominalResistanceKg: null,
      baseLoadKg: 10,
      loadingSides: 2,
      platePoolId: null,
      platePoolName: null,
      platePoolCompatibilityKey: null,
      plates: [],
    };
    const set = await db.set.create({
      data: {
        sessionId: session.id,
        exerciseId: exercise.id,
        gymEquipmentId: equipment.id,
        equipmentNameSnapshot: equipment.name,
        selectedLoadKg: 30,
        selectedLoadMultiplierSnapshot: 1,
        equipmentLoadSnapshot: snapshot,
        setNumber: 1,
        weight: 30,
        reps: 10,
      },
    });

    const response = await deleteEquipment(
      request(`http://test.local/api/gym-equipment/${equipment.id}`, 'DELETE', token),
      params(equipment.id),
    );
    expect(response.status).toBe(200);
    expect(
      await db.gymExerciseConfig.findUniqueOrThrow({
        where: { gymId_exerciseId: { gymId: gym.id, exerciseId: exercise.id } },
      }),
    ).toMatchObject({ preferredEquipmentId: null });
    expect(await db.set.findUniqueOrThrow({ where: { id: set.id } })).toMatchObject({
      gymEquipmentId: null,
      equipmentNameSnapshot: equipment.name,
      selectedLoadKg: 30,
      selectedLoadMultiplierSnapshot: 1,
      equipmentLoadSnapshot: snapshot,
    });
  });

  it('keeps cookie authentication and ownership boundaries', async () => {
    const owner = await seedUser('equipment-cookie@test.dev');
    const stranger = await seedUser('equipment-stranger@test.dev');
    const equipment = await db.gymEquipment.create({
      data: {
        gymId: owner.gym.id,
        name: 'Private machine',
        equipmentType: 'MACHINE',
      },
    });
    mockUserId.mockResolvedValue(owner.user.id);
    expect(
      (
        await getInventory(
          request(`http://test.local/api/gyms/${owner.gym.id}/equipment`),
          params(owner.gym.id),
        )
      ).status,
    ).toBe(200);

    mockUserId.mockResolvedValue(stranger.user.id);
    expect(
      (
        await updateEquipment(
          request(`http://test.local/api/gym-equipment/${equipment.id}`, 'PUT', undefined, {
            name: 'Stolen',
            equipmentType: 'MACHINE',
          }),
          params(equipment.id),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await setImage(
          request(`http://test.local/api/gym-equipment/${equipment.id}/image`, 'PUT', undefined, {
            imageUrl: 'https://images.example.test/private.jpg',
          }),
          params(equipment.id),
        )
      ).status,
    ).toBe(404);
  });

  it('rejects invalid equipment and image payloads', async () => {
    const { token, gym } = await seedUser('equipment-validation@test.dev');
    expect(
      (
        await createEquipment(
          request(`http://test.local/api/gyms/${gym.id}/equipment`, 'POST', token, {
            name: '',
            equipmentType: 'CABLE',
          }),
          params(gym.id),
        )
      ).status,
    ).toBe(400);

    const equipment = await db.gymEquipment.create({
      data: { gymId: gym.id, name: 'Machine', equipmentType: 'MACHINE' },
    });
    expect(
      (
        await setImage(
          request(`http://test.local/api/gym-equipment/${equipment.id}/image`, 'PUT', token, {
            imageBase64: 'not-an-image',
            mimeType: 'image/png',
          }),
          params(equipment.id),
        )
      ).status,
    ).toBe(400);
  });
});
