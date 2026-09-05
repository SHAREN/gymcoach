import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';

vi.mock('@/lib/auth', () => ({ getCurrentUserId: vi.fn() }));
const mockUserId = vi.mocked(getCurrentUserId);

import { PATCH as patchEquipment } from '@/app/api/exercises/[id]/equipment/route';

function request(body: unknown): Request {
  return new Request('http://test.local/api/exercises/exercise/equipment', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function seed() {
  const suffix = `${Date.now()}-${Math.random()}`;
  const user = await db.user.create({ data: { email: `exercise-equipment-${suffix}@test.dev`, passwordHash: 'x' } });
  const stranger = await db.user.create({ data: { email: `exercise-equipment-other-${suffix}@test.dev`, passwordHash: 'x' } });
  const gymA = await db.gym.create({ data: { userId: user.id, name: `Gym A ${suffix}` } });
  const gymB = await db.gym.create({ data: { userId: user.id, name: `Gym B ${suffix}` } });
  const exercise = await db.exercise.create({
    data: {
      userId: user.id,
      name: `Cable row ${suffix}`,
      muscleGroup: 'BACK_THICKNESS',
      category: 'COMPOUND',
      equipmentType: 'CABLE',
    },
  });
  const cableA1 = await db.gymEquipment.create({ data: { gymId: gymA.id, name: `Cable A1 ${suffix}`, equipmentType: 'CABLE' } });
  const cableA2 = await db.gymEquipment.create({ data: { gymId: gymA.id, name: `Cable A2 ${suffix}`, equipmentType: 'CABLE' } });
  const cableB = await db.gymEquipment.create({ data: { gymId: gymB.id, name: `Cable B ${suffix}`, equipmentType: 'CABLE' } });
  const machineA = await db.gymEquipment.create({ data: { gymId: gymA.id, name: `Machine A ${suffix}`, equipmentType: 'MACHINE' } });
  return { user, stranger, gymA, gymB, exercise, cableA1, cableA2, cableB, machineA };
}

beforeEach(() => mockUserId.mockReset());

describe('PATCH /api/exercises/[id]/equipment', () => {
  it('atomically replaces per-gym links and stores one preferred equipment item', async () => {
    const { user, gymA, gymB, exercise, cableA1, cableA2, cableB } = await seed();
    mockUserId.mockResolvedValue(user.id);

    const first = await patchEquipment(
      request({
        gyms: [
          { gymId: gymA.id, equipmentIds: [cableA1.id, cableA2.id], preferredEquipmentId: cableA2.id },
          { gymId: gymB.id, equipmentIds: [cableB.id], preferredEquipmentId: cableB.id },
        ],
      }),
      params(exercise.id),
    );
    expect(first.status).toBe(200);
    expect(
      await db.gymEquipmentExercise.findMany({ where: { exerciseId: exercise.id }, orderBy: { equipmentId: 'asc' } }),
    ).toHaveLength(3);
    expect(
      await db.gymExerciseConfig.findUniqueOrThrow({
        where: { gymId_exerciseId: { gymId: gymA.id, exerciseId: exercise.id } },
      }),
    ).toMatchObject({ preferredEquipmentId: cableA2.id, isAvailable: true });

    const replace = await patchEquipment(
      request({ gyms: [{ gymId: gymA.id, equipmentIds: [cableA1.id], preferredEquipmentId: null }] }),
      params(exercise.id),
    );
    expect(replace.status).toBe(200);
    expect(
      await db.gymEquipmentExercise.findMany({
        where: { exerciseId: exercise.id, equipment: { gymId: gymA.id } },
      }),
    ).toEqual([expect.objectContaining({ equipmentId: cableA1.id })]);
    expect(
      (
        await db.gymExerciseConfig.findUniqueOrThrow({
          where: { gymId_exerciseId: { gymId: gymA.id, exerciseId: exercise.id } },
        })
      ).preferredEquipmentId,
    ).toBeNull();
    expect(
      await db.gymEquipmentExercise.findUnique({
        where: { equipmentId_exerciseId: { equipmentId: cableB.id, exerciseId: exercise.id } },
      }),
    ).not.toBeNull();
  });

  it('rejects foreign/cross-gym/incompatible/preferred-not-linked requests with zero mutation', async () => {
    const { user, stranger, gymA, gymB, exercise, cableA1, cableB, machineA } = await seed();
    mockUserId.mockResolvedValue(user.id);

    const cases = [
      { gyms: [{ gymId: gymA.id, equipmentIds: [cableB.id], preferredEquipmentId: null }] },
      { gyms: [{ gymId: gymA.id, equipmentIds: [machineA.id], preferredEquipmentId: null }] },
      { gyms: [{ gymId: gymA.id, equipmentIds: [], preferredEquipmentId: cableA1.id }] },
      {
        gyms: [
          { gymId: gymA.id, equipmentIds: [cableA1.id], preferredEquipmentId: null },
          { gymId: gymA.id, equipmentIds: [], preferredEquipmentId: null },
        ],
      },
    ];
    for (const body of cases) {
      const response = await patchEquipment(request(body), params(exercise.id));
      expect(response.status).toBe(400);
      expect(await db.gymEquipmentExercise.count({ where: { exerciseId: exercise.id } })).toBe(0);
      expect(await db.gymExerciseConfig.count({ where: { exerciseId: exercise.id } })).toBe(0);
    }

    mockUserId.mockResolvedValue(stranger.id);
    const foreign = await patchEquipment(
      request({ gyms: [{ gymId: gymB.id, equipmentIds: [cableB.id], preferredEquipmentId: cableB.id }] }),
      params(exercise.id),
    );
    expect(foreign.status).toBe(404);
    expect(await db.gymEquipmentExercise.count({ where: { exerciseId: exercise.id } })).toBe(0);
  });
});
