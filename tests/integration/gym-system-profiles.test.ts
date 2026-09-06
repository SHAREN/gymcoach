import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';

vi.mock('@/lib/auth', () => ({ getCurrentUserId: vi.fn() }));
const mockUserId = vi.mocked(getCurrentUserId);
import {
  getOwnedGymSystemProfiles,
  initializeOwnedGymSystemProfiles,
  saveOwnedBarbellSystemProfile,
  saveOwnedDumbbellsSystemProfile,
} from '@/lib/gym-system-profiles';
import { upsertOwnedGymEquipment } from '@/lib/gym-equipment';
import { upsertOwnedGymPlatePool } from '@/lib/gym-plate-pools';
import {
  gymBarbellSystemProfileInputSchema,
  gymDumbbellsSystemProfileInputSchema,
} from '@/lib/schemas/gym-equipment';
import { GET as getSystemProfiles } from '@/app/api/gyms/[id]/system-profiles/route';
import { PUT as putDumbbellsProfile } from '@/app/api/gyms/[id]/system-profiles/dumbbells/route';
import { PUT as putBarbellProfile } from '@/app/api/gyms/[id]/system-profiles/barbell/route';
import {
  GET as getPlatePools,
  POST as createPlatePool,
} from '@/app/api/gyms/[id]/plate-pools/route';
import {
  DELETE as deletePlatePool,
  PUT as updatePlatePool,
} from '@/app/api/gym-plate-pools/[id]/route';

async function seedOwnerGraph() {
  const owner = await db.user.create({
    data: { email: `m14-owner-${Date.now()}@test.dev`, passwordHash: 'unused' },
  });
  const stranger = await db.user.create({
    data: { email: `m14-stranger-${Date.now()}@test.dev`, passwordHash: 'unused' },
  });
  const [dumbbell, barbell, cable, strangerBarbell] = await Promise.all([
    db.exercise.create({
      data: {
        userId: owner.id,
        name: 'M14 Dumbbell Curl',
        muscleGroup: 'BICEPS',
        category: 'ISOLATION',
        equipmentType: 'DUMBBELL',
      },
    }),
    db.exercise.create({
      data: {
        userId: owner.id,
        name: 'M14 Bench Press',
        muscleGroup: 'CHEST',
        category: 'COMPOUND',
        equipmentType: 'BARBELL',
      },
    }),
    db.exercise.create({
      data: {
        userId: owner.id,
        name: 'M14 Cable Row',
        muscleGroup: 'BACK_THICKNESS',
        category: 'COMPOUND',
        equipmentType: 'CABLE',
      },
    }),
    db.exercise.create({
      data: {
        userId: stranger.id,
        name: 'Foreign Barbell Row',
        muscleGroup: 'BACK_THICKNESS',
        category: 'COMPOUND',
        equipmentType: 'BARBELL',
      },
    }),
  ]);
  const gym = await db.gym.create({
    data: {
      userId: owner.id,
      name: 'M14 Gym',
      dumbbellWeights: [10, 12],
      plateWeights: [5, 10],
      barWeights: [20],
    },
  });
  return { owner, stranger, gym, dumbbell, barbell, cable, strangerBarbell };
}

async function initialize(userId: string, gymId: string) {
  await db.$transaction((tx) => initializeOwnedGymSystemProfiles(tx, userId, gymId));
  return getOwnedGymSystemProfiles(userId, gymId);
}

function routeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function jsonRequest(url: string, method: string, body: unknown) {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => mockUserId.mockReset());

describe('M14 permanent free-weight system profiles', () => {
  it('keeps system-profile reads read-only and does not hide missing initialization', async () => {
    const { owner, gym } = await seedOwnerGraph();
    expect(await db.gymPlatePool.count({ where: { gymId: gym.id } })).toBe(0);

    await expect(getOwnedGymSystemProfiles(owner.id, gym.id)).rejects.toThrow(
      'Gym system profile invariant is missing the LARGE Barbell plate pool.',
    );

    expect(await db.gymPlatePool.count({ where: { gymId: gym.id } })).toBe(0);
    expect(
      await db.gymEquipment.count({ where: { gymId: gym.id, systemBarbellFamily: { not: null } } }),
    ).toBe(0);
  });

  it('rolls back initialization and writes when a foreign or wrong-type exercise is requested', async () => {
    const { owner, gym, cable, strangerBarbell } = await seedOwnerGraph();

    await expect(
      saveOwnedDumbbellsSystemProfile(
        owner.id,
        gym.id,
        gymDumbbellsSystemProfileInputSchema.parse({
          weightsKg: [8, 10],
          exerciseIds: [strangerBarbell.id],
        }),
      ),
    ).rejects.toThrow('One or more system-profile exercises do not belong to the trainee.');
    expect(await db.gymPlatePool.count({ where: { gymId: gym.id } })).toBe(0);

    await expect(
      saveOwnedDumbbellsSystemProfile(
        owner.id,
        gym.id,
        gymDumbbellsSystemProfileInputSchema.parse({
          weightsKg: [8, 10],
          exerciseIds: [cable.id],
        }),
      ),
    ).rejects.toThrow('System dumbbell exercises must match its type.');
    expect(await db.gymPlatePool.count({ where: { gymId: gym.id } })).toBe(0);
  });

  it('keeps LARGE and SMALL bars and plate inventories isolated while preserving nullable counts', async () => {
    const { owner, gym, dumbbell, barbell } = await seedOwnerGraph();
    const initial = await initialize(owner.id, gym.id);
    const largeInitialBar = initial.barbell.families.find((family) => family.family === 'LARGE')!.bars[0]!;

    await saveOwnedDumbbellsSystemProfile(
      owner.id,
      gym.id,
      gymDumbbellsSystemProfileInputSchema.parse({
        weightsKg: [7, 8, 9, 10],
        exerciseIds: [dumbbell.id],
      }),
    );

    const saved = await saveOwnedBarbellSystemProfile(
      owner.id,
      gym.id,
      gymBarbellSystemProfileInputSchema.parse({
        exerciseIds: [barbell.id],
        families: [
          {
            family: 'LARGE',
            loadingSides: 2,
            bars: [{ equipmentId: largeInitialBar.id, weightKg: 20 }],
            plates: [
              { weightKg: 5, quantity: 4 },
              { weightKg: 10, quantity: null },
            ],
          },
          {
            family: 'SMALL',
            loadingSides: 2,
            bars: [{ weightKg: 10 }],
            plates: [
              { weightKg: 1.25, quantity: 8 },
              { weightKg: 2.5, quantity: 4 },
            ],
          },
        ],
      }),
    );

    expect(saved.dumbbells).toMatchObject({ weightsKg: [7, 8, 9, 10] });
    expect(saved.dumbbells.exerciseLinks.map((exercise) => exercise.id)).toEqual([dumbbell.id]);
    expect(saved.barbell.exerciseLinks.map((exercise) => exercise.id)).toEqual([barbell.id]);

    const large = saved.barbell.families.find((family) => family.family === 'LARGE')!;
    const small = saved.barbell.families.find((family) => family.family === 'SMALL')!;
    expect(large.bars.map((bar) => bar.baseLoadKg)).toEqual([20]);
    expect(small.bars.map((bar) => bar.baseLoadKg)).toEqual([10]);
    expect(large.pool.plates.map(({ weightKg, quantity }) => ({ weightKg, quantity }))).toEqual([
      { weightKg: 5, quantity: 4 },
      { weightKg: 10, quantity: null },
    ]);
    expect(small.pool.plates.map(({ weightKg, quantity }) => ({ weightKg, quantity }))).toEqual([
      { weightKg: 1.25, quantity: 8 },
      { weightKg: 2.5, quantity: 4 },
    ]);

    const gymProjection = await db.gym.findUniqueOrThrow({ where: { id: gym.id } });
    expect(gymProjection.dumbbellWeights).toEqual([7, 8, 9, 10]);
    expect(gymProjection.plateWeights).toEqual([5, 10]);
    const support = await db.gymExerciseConfig.findMany({
      where: { gymId: gym.id, exerciseId: { in: [dumbbell.id, barbell.id] } },
      orderBy: { exerciseId: 'asc' },
    });
    expect(support.every((config) => config.isAvailable && config.systemProfileSupported)).toBe(true);
  });

  it('rejects cross-family bar ids transactionally and protects system bars and pools from generic mutation', async () => {
    const { owner, gym, barbell } = await seedOwnerGraph();
    const before = await initialize(owner.id, gym.id);
    const large = before.barbell.families.find((family) => family.family === 'LARGE')!;
    const small = before.barbell.families.find((family) => family.family === 'SMALL')!;
    const largeBar = large.bars[0]!;

    await expect(
      saveOwnedBarbellSystemProfile(
        owner.id,
        gym.id,
        gymBarbellSystemProfileInputSchema.parse({
          exerciseIds: [barbell.id],
          families: [
            {
              family: 'LARGE',
              loadingSides: 2,
              bars: [{ equipmentId: largeBar.id, weightKg: 20 }],
              plates: [{ weightKg: 5, quantity: null }],
            },
            {
              family: 'SMALL',
              loadingSides: 2,
              bars: [{ equipmentId: largeBar.id, weightKg: 10 }],
              plates: [],
            },
          ],
        }),
      ),
    ).rejects.toThrow('A system bar does not belong to the selected Barbell family.');

    const afterRejected = await getOwnedGymSystemProfiles(owner.id, gym.id);
    expect(afterRejected).toEqual(before);

    await expect(
      upsertOwnedGymEquipment(owner.id, gym.id, {
        equipmentId: largeBar.id,
        name: 'Attempted generic rename',
        equipmentType: 'BARBELL',
      }),
    ).rejects.toThrow('System Barbell members must be edited through the Barbell profile.');

    await expect(
      upsertOwnedGymPlatePool(owner.id, gym.id, {
        poolId: small.pool.id,
        name: 'Attempted pool rename',
        compatibilityKey: small.pool.compatibilityKey,
        plates: [],
      }),
    ).rejects.toThrow('System Barbell pools must be edited through the Barbell profile.');
  });

  it('does not remove a managed bar that is selected by an active session', async () => {
    const { owner, gym, barbell } = await seedOwnerGraph();
    const profiles = await initialize(owner.id, gym.id);
    const large = profiles.barbell.families.find((family) => family.family === 'LARGE')!;
    const largeBar = large.bars[0]!;

    const session = await db.session.create({ data: { userId: owner.id, gymId: gym.id } });
    await db.set.create({
      data: {
        sessionId: session.id,
        exerciseId: barbell.id,
        gymEquipmentId: largeBar.id,
        setNumber: 1,
        weight: 20,
        reps: 8,
        completedAt: new Date(),
      },
    });

    await expect(
      saveOwnedBarbellSystemProfile(
        owner.id,
        gym.id,
        gymBarbellSystemProfileInputSchema.parse({
          exerciseIds: [barbell.id],
          families: [
            { family: 'LARGE', loadingSides: 2, bars: [], plates: [{ weightKg: 5, quantity: null }] },
            { family: 'SMALL', loadingSides: 2, bars: [], plates: [] },
          ],
        }),
      ),
    ).rejects.toThrow('A system bar used by an active session cannot be removed.');

    expect(await db.gymEquipment.findUnique({ where: { id: largeBar.id } })).not.toBeNull();
    const after = await getOwnedGymSystemProfiles(owner.id, gym.id);
    expect(after.barbell.families.find((family) => family.family === 'LARGE')!.bars).toHaveLength(1);
  });

  it('returns 404 and makes no changes when another user addresses M14 routes', async () => {
    const { owner, stranger, gym, dumbbell, barbell } = await seedOwnerGraph();
    const profiles = await initialize(owner.id, gym.id);
    const large = profiles.barbell.families.find((family) => family.family === 'LARGE')!;
    const customPool = await upsertOwnedGymPlatePool(owner.id, gym.id, {
      name: 'Owner custom plates',
      compatibilityKey: 'owner_custom_plates',
      plates: [{ weightKg: 5, quantity: 4 }],
    });
    const before = await getOwnedGymSystemProfiles(owner.id, gym.id);

    mockUserId.mockResolvedValue(stranger.id);

    const readResponse = await getSystemProfiles(
      new Request(`http://test.local/api/gyms/${gym.id}/system-profiles`),
      routeParams(gym.id),
    );
    expect(readResponse.status).toBe(404);

    const dumbbellsResponse = await putDumbbellsProfile(
      jsonRequest(`http://test.local/api/gyms/${gym.id}/system-profiles/dumbbells`, 'PUT', {
        weightsKg: [8, 10],
        exerciseIds: [dumbbell.id],
      }),
      routeParams(gym.id),
    );
    expect(dumbbellsResponse.status).toBe(404);

    const barbellResponse = await putBarbellProfile(
      jsonRequest(`http://test.local/api/gyms/${gym.id}/system-profiles/barbell`, 'PUT', {
        exerciseIds: [barbell.id],
        families: [
          {
            family: 'LARGE',
            loadingSides: 2,
            bars: large.bars.map((item) => ({ equipmentId: item.id, weightKg: item.baseLoadKg })),
            plates: large.pool.plates.map(({ weightKg, quantity }) => ({ weightKg, quantity })),
          },
          { family: 'SMALL', loadingSides: 2, bars: [], plates: [] },
        ],
      }),
      routeParams(gym.id),
    );
    expect(barbellResponse.status).toBe(404);

    const listPoolsResponse = await getPlatePools(
      new Request(`http://test.local/api/gyms/${gym.id}/plate-pools`),
      routeParams(gym.id),
    );
    expect(listPoolsResponse.status).toBe(404);

    const createPoolResponse = await createPlatePool(
      jsonRequest(`http://test.local/api/gyms/${gym.id}/plate-pools`, 'POST', {
        name: 'Foreign attempt',
        compatibilityKey: 'foreign_attempt',
        plates: [],
      }),
      routeParams(gym.id),
    );
    expect(createPoolResponse.status).toBe(404);

    const updatePoolResponse = await updatePlatePool(
      jsonRequest(`http://test.local/api/gym-plate-pools/${customPool.id}`, 'PUT', {
        name: 'Foreign rename',
        compatibilityKey: customPool.compatibilityKey,
        plates: [],
      }),
      routeParams(customPool.id),
    );
    expect(updatePoolResponse.status).toBe(404);

    const deletePoolResponse = await deletePlatePool(
      new Request(`http://test.local/api/gym-plate-pools/${customPool.id}`, { method: 'DELETE' }),
      routeParams(customPool.id),
    );
    expect(deletePoolResponse.status).toBe(404);

    mockUserId.mockResolvedValue(owner.id);
    expect(await getOwnedGymSystemProfiles(owner.id, gym.id)).toEqual(before);
    expect(await db.gymPlatePool.findUnique({ where: { id: customPool.id } })).toMatchObject({
      name: 'Owner custom plates',
      compatibilityKey: 'owner_custom_plates',
    });
    expect(await db.gymPlatePool.count({ where: { gymId: gym.id, name: 'Foreign attempt' } })).toBe(0);
  });
});
