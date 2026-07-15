import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';

vi.mock('@/lib/auth', () => ({ getCurrentUserId: vi.fn() }));
const mockUserId = vi.mocked(getCurrentUserId);

import { GET as getInventory } from '@/app/api/gyms/[id]/inventory/route';
import { POST as createEquipment } from '@/app/api/gyms/[id]/equipment/route';
import { POST as createPlatePool } from '@/app/api/gyms/[id]/plate-pools/route';
import { POST as createSet } from '@/app/api/sessions/[id]/sets/route';

function jsonRequest(url: string, body: unknown, method = 'POST') {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('equipment-first REST domain', () => {
  beforeEach(() => mockUserId.mockReset());

  it('shares compatible plates, keeps machines separate, and snapshots cable conversion', async () => {
    const user = await db.user.create({
      data: { email: 'equipment-domain@test.dev', passwordHash: 'x' },
    });
    const bench = await db.exercise.create({
      data: {
        userId: user.id,
        name: 'Bench press',
        muscleGroup: 'CHEST',
        category: 'COMPOUND',
        equipmentType: 'BARBELL',
      },
    });
    const pushdown = await db.exercise.create({
      data: {
        userId: user.id,
        name: 'Cable pushdown',
        muscleGroup: 'TRICEPS',
        category: 'ISOLATION',
        equipmentType: 'CABLE',
      },
    });
    const gym = await db.gym.create({
      data: { userId: user.id, name: 'Olymp', inventoryMode: 'EQUIPMENT_FIRST' },
    });
    mockUserId.mockResolvedValue(user.id);

    const poolResponse = await createPlatePool(
      jsonRequest(`http://test.local/api/gyms/${gym.id}/plate-pools`, {
        name: 'Olympic plates',
        compatibilityKey: 'olympic_50mm',
        plates: [
          { weightKg: 20, quantity: 2 },
          { weightKg: 5, quantity: 4 },
        ],
      }),
      { params: Promise.resolve({ id: gym.id }) },
    );
    expect(poolResponse.status).toBe(201);
    const pool = await poolResponse.json();

    for (const item of [
      { name: 'Bench station', baseLoadKg: 20 },
      { name: 'Smith machine', baseLoadKg: 15 },
    ]) {
      const response = await createEquipment(
        jsonRequest(`http://test.local/api/gyms/${gym.id}/equipment`, {
          ...item,
          equipmentType: 'BARBELL',
          loadType: 'PLATE_LOADED',
          platePoolId: pool.id,
          loadingSides: 2,
          exerciseIds: [bench.id],
        }),
        { params: Promise.resolve({ id: gym.id }) },
      );
      expect(response.status).toBe(201);
    }

    const cableResponse = await createEquipment(
      jsonRequest(`http://test.local/api/gyms/${gym.id}/equipment`, {
        name: 'Upper cable',
        equipmentType: 'CABLE',
        loadType: 'SELECTORIZED',
        weightOptions: [40, 45, 50],
        selectedLoadMultiplier: 0.5,
        loadingSides: 1,
        exerciseIds: [pushdown.id],
      }),
      { params: Promise.resolve({ id: gym.id }) },
    );
    expect(cableResponse.status).toBe(201);
    const cable = (await cableResponse.json()).equipment;

    const inventoryResponse = await getInventory(
      new Request(`http://test.local/api/gyms/${gym.id}/inventory`),
      { params: Promise.resolve({ id: gym.id }) },
    );
    expect(inventoryResponse.status).toBe(200);
    const inventory = (await inventoryResponse.json()).gym;
    const benchCoverage = inventory.exerciseCoverage.find(
      (item: { id: string }) => item.id === bench.id,
    );
    expect(benchCoverage).toMatchObject({
      availabilitySource: 'equipment',
      requiresEquipmentSelection: true,
      attainableLoadsKg: [],
    });
    expect(benchCoverage.equipmentOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          platePoolId: pool.id,
          inventoryPrecision: 'KNOWN',
          attainableLoads: expect.arrayContaining([20, 30, 70]),
        }),
        expect.objectContaining({
          platePoolId: pool.id,
          inventoryPrecision: 'KNOWN',
          attainableLoads: expect.arrayContaining([15, 25, 65]),
        }),
      ]),
    );

    const session = await db.session.create({
      data: { userId: user.id, gymId: gym.id },
    });
    const setResponse = await createSet(
      jsonRequest(`http://test.local/api/sessions/${session.id}/sets`, {
        exerciseId: pushdown.id,
        gymEquipmentId: cable.id,
        setNumber: 1,
        weight: 50,
        reps: 12,
        rir: 2,
      }),
      { params: Promise.resolve({ id: session.id }) },
    );
    expect(setResponse.status).toBe(201);
    expect(await setResponse.json()).toMatchObject({
      gymEquipmentId: cable.id,
      equipmentNameSnapshot: 'Upper cable',
      selectedLoadKg: 50,
      selectedLoadMultiplierSnapshot: 0.5,
      nominalResistanceKg: 25,
      equipmentLoadSnapshot: expect.objectContaining({ loadType: 'SELECTORIZED' }),
    });
  });

  it('rejects another user exercise link', async () => {
    const owner = await db.user.create({
      data: { email: 'equipment-owner@test.dev', passwordHash: 'x' },
    });
    const stranger = await db.user.create({
      data: { email: 'equipment-stranger@test.dev', passwordHash: 'x' },
    });
    const gym = await db.gym.create({ data: { userId: owner.id, name: 'Owner gym' } });
    const foreignExercise = await db.exercise.create({
      data: {
        userId: stranger.id,
        name: 'Foreign row',
        muscleGroup: 'BACK_THICKNESS',
        category: 'COMPOUND',
      },
    });
    mockUserId.mockResolvedValue(owner.id);
    const response = await createEquipment(
      jsonRequest(`http://test.local/api/gyms/${gym.id}/equipment`, {
        name: 'Row machine',
        equipmentType: 'MACHINE',
        loadType: 'SELECTORIZED',
        weightOptions: [10, 20],
        exerciseIds: [foreignExercise.id],
      }),
      { params: Promise.resolve({ id: gym.id }) },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'One or more exercise IDs do not belong to the trainee.',
    });
  });
});
