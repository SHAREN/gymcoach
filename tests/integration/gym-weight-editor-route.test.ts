import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';

vi.mock('@/lib/auth', () => ({ getCurrentUserId: vi.fn() }));
const mockUserId = vi.mocked(getCurrentUserId);

import { PATCH } from '@/app/api/gyms/[id]/weights/route';

function request(body: unknown): Request {
  return new Request('http://test.local/api/gyms/gym-1/weights', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('PATCH /api/gyms/:id/weights', () => {
  beforeEach(() => {
    mockUserId.mockReset();
  });

  it('updates shared barbell inventory without replacing exercise configs', async () => {
    const user = await db.user.create({
      data: { email: 'gym-weights-barbell@test.dev', passwordHash: 'x' },
    });
    const exercise = await db.exercise.create({
      data: {
        userId: user.id,
        name: 'Bench Press',
        muscleGroup: 'CHEST',
        category: 'COMPOUND',
        equipmentType: 'BARBELL',
      },
    });
    const gym = await db.gym.create({
      data: {
        userId: user.id,
        name: 'Olymp',
        barWeights: [20],
        plateWeights: [1.25, 2.5],
        exerciseConfigs: {
          create: {
            exerciseId: exercise.id,
            isAvailable: false,
            weightOptions: [30],
            barWeights: [10],
            plateWeights: [1.25],
          },
        },
      },
    });
    mockUserId.mockResolvedValue(user.id);

    const response = await PATCH(
      request({
        exerciseId: exercise.id,
        scope: 'equipment',
        barWeights: [15, 20],
        plateWeights: [1.25, 2.5, 5, 10, 20],
      }),
      { params: Promise.resolve({ id: gym.id }) },
    );

    expect(response.status).toBe(200);
    const saved = await db.gym.findUniqueOrThrow({
      where: { id: gym.id },
      include: { exerciseConfigs: true },
    });
    expect(saved.barWeights).toEqual([15, 20]);
    expect(saved.plateWeights).toEqual([1.25, 2.5, 5, 10, 20]);
    expect(saved.exerciseConfigs[0]).toMatchObject({
      isAvailable: false,
      weightOptions: [30],
      barWeights: [10],
      plateWeights: [1.25],
    });
  });

  it('stores a dumbbell override only for the selected exercise', async () => {
    const user = await db.user.create({
      data: { email: 'gym-weights-dumbbell@test.dev', passwordHash: 'x' },
    });
    const exercise = await db.exercise.create({
      data: {
        userId: user.id,
        name: 'Dumbbell Curl',
        muscleGroup: 'BICEPS',
        category: 'ISOLATION',
        equipmentType: 'DUMBBELL',
      },
    });
    const gym = await db.gym.create({
      data: { userId: user.id, name: 'Basement', dumbbellWeights: [10, 12, 14, 16, 19] },
    });
    mockUserId.mockResolvedValue(user.id);

    const response = await PATCH(
      request({
        exerciseId: exercise.id,
        scope: 'exercise',
        dumbbellWeights: [10, 12, 14, 15.5, 19],
      }),
      { params: Promise.resolve({ id: gym.id }) },
    );

    expect(response.status).toBe(200);
    const saved = await db.gym.findUniqueOrThrow({
      where: { id: gym.id },
      include: { exerciseConfigs: true },
    });
    expect(saved.dumbbellWeights).toEqual([10, 12, 14, 16, 19]);
    expect(saved.exerciseConfigs[0]?.dumbbellWeights).toEqual([10, 12, 14, 15.5, 19]);
  });
});
