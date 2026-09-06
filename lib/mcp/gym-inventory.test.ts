import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    user: { findUnique: vi.fn() },
    gym: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findFirstOrThrow: vi.fn(),
      update: vi.fn(),
    },
    exercise: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/gym-equipment', () => ({
  listOwnedGymEquipment: vi.fn(),
}));

vi.mock('@/lib/gym-plate-pools', () => ({
  listOwnedGymPlatePools: vi.fn(),
  upsertOwnedGymPlatePool: vi.fn(),
}));

vi.mock('@/lib/gym-system-profiles', () => ({
  getOwnedGymSystemProfiles: vi.fn(),
  saveOwnedBarbellSystemProfile: vi.fn(),
  saveOwnedDumbbellsSystemProfile: vi.fn(),
}));

import { db } from '@/lib/db';
import { listOwnedGymEquipment } from '@/lib/gym-equipment';
import { listOwnedGymPlatePools } from '@/lib/gym-plate-pools';
import {
  getOwnedGymSystemProfiles,
  saveOwnedBarbellSystemProfile,
  saveOwnedDumbbellsSystemProfile,
} from '@/lib/gym-system-profiles';
import { getMcpGymInventory, listMcpGyms, updateMcpGymFreeWeights } from './gym-inventory';

const findUser = vi.mocked(db.user.findUnique);
const findGyms = vi.mocked(db.gym.findMany);
const findGym = vi.mocked(db.gym.findFirst);
const findFinalGym = vi.mocked(db.gym.findFirstOrThrow);
const updateGym = vi.mocked(db.gym.update);
const findExercises = vi.mocked(db.exercise.findMany);
const listEquipment = vi.mocked(listOwnedGymEquipment);
const listPools = vi.mocked(listOwnedGymPlatePools);
const getProfiles = vi.mocked(getOwnedGymSystemProfiles);
const saveDumbbells = vi.mocked(saveOwnedDumbbellsSystemProfile);
const saveBarbell = vi.mocked(saveOwnedBarbellSystemProfile);

const systemProfiles = {
  gymId: 'gym-1',
  gymName: 'Test Gym',
  dumbbells: {
    id: 'system-profile-dumbbells-gym-1',
    kind: 'DUMBBELLS' as const,
    weightsKg: [10, 12],
    exerciseLinks: [{ id: 'dumbbell-exercise', name: 'Curl', equipmentType: 'DUMBBELL' }],
  },
  barbell: {
    id: 'system-profile-barbell-gym-1',
    kind: 'BARBELL' as const,
    exerciseLinks: [{ id: 'barbell-exercise', name: 'Bench', equipmentType: 'BARBELL' }],
    families: [
      {
        family: 'LARGE' as const,
        loadingSides: 2,
        pool: {
          id: 'pool-large',
          name: 'Large',
          compatibilityKey: 'system_barbell_large',
          systemBarbellFamily: 'LARGE' as const,
          plates: [{ id: 'plate-5', weightKg: 5, quantity: null }],
        },
        bars: [
          {
            id: 'bar-20',
            baseLoadKg: 20,
            loadingSides: 2,
            systemBarbellFamily: 'LARGE' as const,
          },
        ],
      },
      {
        family: 'SMALL' as const,
        loadingSides: 2,
        pool: {
          id: 'pool-small',
          name: 'Small',
          compatibilityKey: 'system_barbell_small',
          systemBarbellFamily: 'SMALL' as const,
          plates: [],
        },
        bars: [],
      },
    ],
  },
};

beforeEach(() => {
  vi.resetAllMocks();
  listPools.mockResolvedValue([] as never);
  getProfiles.mockResolvedValue(systemProfiles as never);
  saveDumbbells.mockResolvedValue(systemProfiles as never);
  saveBarbell.mockResolvedValue(systemProfiles as never);
});

describe('MCP gym inventory reads', () => {
  it('lists only the supplied user gyms and marks the active one', async () => {
    findUser.mockResolvedValue({ activeGymId: 'gym-1' } as never);
    findGyms.mockResolvedValue([
      {
        id: 'gym-1',
        name: 'Test Gym',
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

  it('returns owned permanent inventory and turns uploaded image paths into absolute MCP URLs', async () => {
    findUser.mockResolvedValue({ activeGymId: 'gym-1' } as never);
    findGym.mockResolvedValue({
      id: 'gym-1',
      name: 'Test Gym',
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
          preferredEquipmentId: 'equipment-1',
          systemProfileSupported: null,
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
    listPools.mockResolvedValue([
      {
        id: 'pool-custom',
        gymId: 'gym-1',
        name: 'Hammer plates',
        compatibilityKey: 'hammer_plates',
        systemBarbellFamily: null,
        plates: [{ id: 'p10', weightKg: 10, quantity: 4 }],
      },
    ] as never);
    listEquipment.mockResolvedValue([
      {
        id: 'equipment-1',
        gymId: 'gym-1',
        name: 'Cable tower',
        loadConfigurationKnown: true,
        loadType: 'SELECTORIZED',
        selectedLoadMultiplier: 1,
        baseLoadKg: 0,
        loadingSides: 2,
        platePoolId: null,
        weightOptions: [25, 30],
        image: {
          kind: 'uploaded',
          url: '/api/gym-equipment/equipment-1/image?v=1',
          mimeType: 'image/jpeg',
        },
        exerciseLinks: [],
      },
    ] as never);

    const result = await getMcpGymInventory('user-1', 'https://gymcoach.example', 'gym-1');

    expect(findGym).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'gym-1', userId: 'user-1' } }),
    );
    expect(result.systemProfiles).toEqual(systemProfiles);
    expect(result.platePools[0]).toMatchObject({
      id: 'pool-custom',
      compatibilityKey: 'hammer_plates',
    });
    expect(result.equipment[0]?.image?.url).toBe(
      'https://gymcoach.example/api/gym-equipment/equipment-1/image?v=1',
    );
    expect(result.equipment[0]?.loadFacts).toMatchObject({
      state: 'KNOWN',
      loadType: 'SELECTORIZED',
      weightOptionsKg: [25, 30],
    });
    expect(result.exerciseAvailability[0]).toMatchObject({
      id: 'exercise-1',
      isAvailable: false,
      configuredWeightOptionsKg: [25, 30],
      preferredEquipmentId: 'equipment-1',
      systemProfileSupported: null,
      explicitlyConfigured: true,
    });
  });

  it('rejects a gym that is not owned by the MCP user', async () => {
    findUser.mockResolvedValue({ activeGymId: null } as never);
    findGym.mockResolvedValue(null);
    findExercises.mockResolvedValue([] as never);

    await expect(
      getMcpGymInventory('user-1', 'https://gymcoach.example', 'other-gym'),
    ).rejects.toThrow('Gym not found.');
    expect(findGym).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'other-gym', userId: 'user-1' } }),
    );
    expect(listEquipment).not.toHaveBeenCalled();
    expect(getProfiles).not.toHaveBeenCalled();
  });

  it('updates legacy free-weight requests through permanent profile writers', async () => {
    findGym.mockResolvedValue({ id: 'gym-1' } as never);
    findFinalGym.mockResolvedValue({
      id: 'gym-1',
      name: 'Test Gym',
      dumbbellWeights: [10, 12],
      plateWeights: [5],
      barWeights: [20],
      updatedAt: new Date('2026-09-05T00:00:00Z'),
    } as never);

    await updateMcpGymFreeWeights('user-1', 'gym-1', { dumbbellWeights: [10, 12] });

    expect(findGym).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'gym-1', userId: 'user-1' } }),
    );
    expect(saveDumbbells).toHaveBeenCalledWith('user-1', 'gym-1', {
      weightsKg: [10, 12],
      exerciseIds: ['dumbbell-exercise'],
    });
    expect(saveBarbell).not.toHaveBeenCalled();
    expect(updateGym).not.toHaveBeenCalled();
  });

  it('does not update free weights when the requested gym is foreign', async () => {
    findGym.mockResolvedValue(null);

    await expect(
      updateMcpGymFreeWeights('user-1', 'other-gym', { plateWeights: [5, 10] }),
    ).rejects.toThrow('Gym not found.');

    expect(saveDumbbells).not.toHaveBeenCalled();
    expect(saveBarbell).not.toHaveBeenCalled();
    expect(updateGym).not.toHaveBeenCalled();
  });
});
