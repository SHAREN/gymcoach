import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    user: { findUnique: vi.fn() },
    gym: { findMany: vi.fn(), findFirst: vi.fn() },
    exercise: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/gym-equipment', () => ({
  listOwnedGymEquipment: vi.fn(),
}));

import { db } from '@/lib/db';
import { listOwnedGymEquipment } from '@/lib/gym-equipment';
import { getMcpGymInventory, listMcpGyms } from './gym-inventory';

const findUser = vi.mocked(db.user.findUnique);
const findGyms = vi.mocked(db.gym.findMany);
const findGym = vi.mocked(db.gym.findFirst);
const findExercises = vi.mocked(db.exercise.findMany);
const listEquipment = vi.mocked(listOwnedGymEquipment);

beforeEach(() => {
  vi.resetAllMocks();
});

describe('MCP gym inventory reads', () => {
  it('lists only the supplied user gyms and marks the active one', async () => {
    findUser.mockResolvedValue({ activeGymId: 'gym-1' } as never);
    findGyms.mockResolvedValue([
      {
        id: 'gym-1',
        name: 'X-Fit',
        createdAt: new Date('2026-08-01T00:00:00Z'),
        updatedAt: new Date('2026-09-01T00:00:00Z'),
        _count: { equipment: 3, exerciseConfigs: 4, sessions: 5 },
      },
    ] as never);

    const result = await listMcpGyms('user-1');

    expect(findGyms).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'user-1' } }));
    expect(result).toMatchObject({
      activeGymId: 'gym-1',
      gyms: [
        {
          id: 'gym-1',
          isActive: true,
          physicalEquipmentCount: 3,
          exerciseConfigCount: 4,
          sessionCount: 5,
        },
      ],
    });
  });

  it('returns owned inventory and turns uploaded image paths into absolute MCP URLs', async () => {
    findUser.mockResolvedValue({ activeGymId: 'gym-1' } as never);
    findGym.mockResolvedValue({
      id: 'gym-1',
      name: 'X-Fit',
      dumbbellWeights: [10, 12],
      plateWeights: [5, 10],
      barWeights: [20],
      createdAt: new Date('2026-08-01T00:00:00Z'),
      updatedAt: new Date('2026-09-01T00:00:00Z'),
      exerciseConfigs: [
        {
          exerciseId: 'exercise-1',
          isAvailable: false,
          weightOptions: [25, 30],
          exercise: {
            id: 'exercise-1',
            name: 'Cable Row',
            muscleGroup: 'BACK_THICKNESS',
            category: 'COMPOUND',
            equipmentType: 'CABLE',
          },
        },
      ],
    } as never);
    findExercises.mockResolvedValue([
      {
        id: 'exercise-1',
        name: 'Cable Row',
        muscleGroup: 'BACK_THICKNESS',
        category: 'COMPOUND',
        equipmentType: 'CABLE',
      },
    ] as never);
    listEquipment.mockResolvedValue([
      {
        id: 'equipment-1',
        gymId: 'gym-1',
        name: 'Cable tower',
        image: { kind: 'uploaded', url: '/api/gym-equipment/equipment-1/image?v=1', mimeType: 'image/jpeg' },
        exerciseLinks: [],
      },
    ] as never);

    const result = await getMcpGymInventory('user-1', 'https://gymcoach.example', 'gym-1');

    expect(findGym).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'gym-1', userId: 'user-1' } }));
    expect(result.equipment[0]?.image?.url).toBe(
      'https://gymcoach.example/api/gym-equipment/equipment-1/image?v=1',
    );
    expect(result.exerciseAvailability[0]).toMatchObject({
      id: 'exercise-1',
      isAvailable: false,
      configuredWeightOptionsKg: [25, 30],
      explicitlyConfigured: true,
    });
  });

  it('rejects a gym that is not owned by the MCP user', async () => {
    findUser.mockResolvedValue({ activeGymId: null } as never);
    findGym.mockResolvedValue(null);
    findExercises.mockResolvedValue([] as never);

    await expect(getMcpGymInventory('user-1', 'https://gymcoach.example', 'other-gym')).rejects.toThrow(
      'Gym not found.',
    );
    expect(findGym).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'other-gym', userId: 'user-1' } }));
    expect(listEquipment).not.toHaveBeenCalled();
  });
});
