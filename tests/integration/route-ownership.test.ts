import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';

// Auth is read through getCurrentUserId (via requireApiUserId in @/lib/api).
// Mock it so we can act as either user without real cookies/JWTs.
vi.mock('@/lib/auth', () => ({ getCurrentUserId: vi.fn() }));
const mockUserId = vi.mocked(getCurrentUserId);

import { DELETE as deleteSet, PATCH as patchSet } from '@/app/api/sets/[id]/route';
import { PUT as putSession } from '@/app/api/sessions/[id]/route';
import { GET as getExercise } from '@/app/api/exercises/[id]/route';
import { PATCH as patchExerciseEquipment } from '@/app/api/exercises/[id]/equipment/route';

function actAs(userId: string) {
  mockUserId.mockResolvedValue(userId);
}

function jsonReq(method: string, body: unknown): Request {
  return new Request('http://test.local/api', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Seed two users; user A owns an exercise, a session, and a set.
async function seed() {
  const [a, b] = await Promise.all([
    db.user.create({ data: { email: 'owner@test.dev', passwordHash: 'x' } }),
    db.user.create({ data: { email: 'stranger@test.dev', passwordHash: 'x' } }),
  ]);
  const exercise = await db.exercise.create({
    data: { userId: a.id, name: 'Bench', muscleGroup: 'CHEST', category: 'COMPOUND' },
  });
  const session = await db.session.create({ data: { userId: a.id, notes: 'original' } });
  const set = await db.set.create({
    data: { sessionId: session.id, exerciseId: exercise.id, setNumber: 1, weight: 60, reps: 10 },
  });
  return { a, b, exercise, session, set };
}

async function createSystemBars(gymId: string) {
  const [largePool, smallPool] = await Promise.all([
    db.gymPlatePool.create({
      data: {
        gymId,
        name: 'Large system plates',
        compatibilityKey: 'large-system',
        systemBarbellFamily: 'LARGE',
      },
    }),
    db.gymPlatePool.create({
      data: {
        gymId,
        name: 'Small system plates',
        compatibilityKey: 'small-system',
        systemBarbellFamily: 'SMALL',
      },
    }),
  ]);
  return Promise.all([
    db.gymEquipment.create({
      data: {
        gymId,
        name: '20 kg system bar',
        equipmentType: 'BARBELL',
        loadType: 'PLATE_LOADED',
        baseLoadKg: 20,
        platePoolId: largePool.id,
        systemBarbellFamily: 'LARGE',
      },
    }),
    db.gymEquipment.create({
      data: {
        gymId,
        name: '6 kg system bar',
        equipmentType: 'BARBELL',
        loadType: 'PLATE_LOADED',
        baseLoadKg: 6,
        platePoolId: smallPool.id,
        systemBarbellFamily: 'SMALL',
      },
    }),
  ]);
}

beforeEach(() => {
  mockUserId.mockReset();
});

describe('route ownership: DELETE /api/sets/[id]', () => {
  it('lets the owner delete their set', async () => {
    const { a, set } = await seed();
    actAs(a.id);
    const res = await deleteSet(new Request('http://t/api', { method: 'DELETE' }), {
      params: Promise.resolve({ id: set.id }),
    });
    expect(res.status).toBe(200);
    expect(await db.set.findUnique({ where: { id: set.id } })).toBeNull();
  });

  it('returns 404 and keeps the set when a stranger tries to delete it', async () => {
    const { b, set } = await seed();
    actAs(b.id);
    const res = await deleteSet(new Request('http://t/api', { method: 'DELETE' }), {
      params: Promise.resolve({ id: set.id }),
    });
    expect(res.status).toBe(404);
    // The set must still exist - no cross-user deletion.
    expect(await db.set.findUnique({ where: { id: set.id } })).not.toBeNull();
  });
});

describe('route ownership: PATCH /api/sets/[id]', () => {
  it('lets the owner correct their set', async () => {
    const { a, set } = await seed();
    actAs(a.id);
    const res = await patchSet(jsonReq('PATCH', { weight: 62.5, reps: 8, rir: 1 }), {
      params: Promise.resolve({ id: set.id }),
    });

    expect(res.status).toBe(200);
    expect(await db.set.findUnique({ where: { id: set.id } })).toMatchObject({
      weight: 62.5,
      reps: 8,
      rir: 1,
      setNumber: 1,
      exerciseId: set.exerciseId,
    });
  });

  it('returns 404 and keeps the set when a stranger tries to edit it', async () => {
    const { b, set } = await seed();
    actAs(b.id);
    const res = await patchSet(jsonReq('PATCH', { weight: 200, reps: 1, rir: 0 }), {
      params: Promise.resolve({ id: set.id }),
    });

    expect(res.status).toBe(404);
    expect(await db.set.findUnique({ where: { id: set.id } })).toMatchObject({
      weight: 60,
      reps: 10,
    });
  });

  it('rejects an exact legacy mobile snapshot outside completed history', async () => {
    const { a, set } = await seed();
    await db.set.update({
      where: { id: set.id },
      data: {
        gymEquipmentId: null,
        equipmentNameSnapshot: 'Legacy cable',
        selectedLoadKg: 60,
        selectedLoadMultiplierSnapshot: 0.5,
        nominalResistanceKg: 30,
        equipmentLoadSnapshot: {
          version: 1,
          loadType: 'SELECTORIZED',
          equipmentType: 'CABLE',
          selectedLoadKg: 60,
          selectedLoadMultiplier: 0.5,
          nominalResistanceKg: 30,
          baseLoadKg: 0,
          loadingSides: 1,
          platePool: null,
        },
      },
    });
    actAs(a.id);

    const response = await patchSet(jsonReq('PATCH', { weight: 65, reps: 8, rir: 1 }), {
      params: Promise.resolve({ id: set.id }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'The recorded equipment snapshot is unsupported or invalid.',
    });
  });
});

describe('route ownership: PUT /api/sessions/[id]', () => {
  it('lets the owner update their session', async () => {
    const { a, session } = await seed();
    actAs(a.id);
    const res = await putSession(jsonReq('PUT', { notes: 'mine' }), {
      params: Promise.resolve({ id: session.id }),
    });
    expect(res.status).toBe(200);
    expect((await db.session.findUnique({ where: { id: session.id } }))?.notes).toBe('mine');
  });

  it('returns 404 and leaves the session untouched for a stranger', async () => {
    const { b, session } = await seed();
    actAs(b.id);
    const res = await putSession(jsonReq('PUT', { notes: 'hacked' }), {
      params: Promise.resolve({ id: session.id }),
    });
    expect(res.status).toBe(404);
    expect((await db.session.findUnique({ where: { id: session.id } }))?.notes).toBe('original');
  });
});

describe('route ownership: PATCH /api/exercises/[id]/equipment', () => {
  it('accepts a barbell preference for a legacy OTHER exercise inferred from its name', async () => {
    const { a, exercise } = await seed();
    await db.exercise.update({
      where: { id: exercise.id },
      data: { name: 'EZ-bar curl from an old backup', equipmentType: 'OTHER' },
    });
    const gym = await db.gym.create({ data: { userId: a.id, name: 'Legacy gym' } });
    const [largeBar, smallBar] = await createSystemBars(gym.id);
    actAs(a.id);

    const partialResponse = await patchExerciseEquipment(
      jsonReq('PATCH', {
        gyms: [{ gymId: gym.id, equipmentIds: [smallBar.id] }],
      }),
      { params: Promise.resolve({ id: exercise.id }) },
    );
    expect(partialResponse.status).toBe(400);

    const response = await patchExerciseEquipment(
      jsonReq('PATCH', {
        gyms: [
          {
            gymId: gym.id,
            equipmentIds: [largeBar.id, smallBar.id],
            preferredEquipmentId: smallBar.id,
          },
        ],
      }),
      { params: Promise.resolve({ id: exercise.id }) },
    );

    expect(response.status).toBe(200);
    expect(
      await db.gymExerciseConfig.findUniqueOrThrow({
        where: { gymId_exerciseId: { gymId: gym.id, exerciseId: exercise.id } },
      }),
    ).toMatchObject({
      preferredEquipmentId: smallBar.id,
      isEquipmentMirror: false,
      systemProfileSupported: true,
    });
    expect(
      await db.gymEquipmentExercise.count({
        where: { exerciseId: exercise.id, equipmentId: { in: [largeBar.id, smallBar.id] } },
      }),
    ).toBe(2);

    const removeResponse = await patchExerciseEquipment(
      jsonReq('PATCH', { gyms: [{ gymId: gym.id, equipmentIds: [] }] }),
      { params: Promise.resolve({ id: exercise.id }) },
    );
    expect(removeResponse.status).toBe(200);
    expect(
      await db.gymExerciseConfig.findUniqueOrThrow({
        where: { gymId_exerciseId: { gymId: gym.id, exerciseId: exercise.id } },
      }),
    ).toMatchObject({ preferredEquipmentId: null, systemProfileSupported: false });
    expect(
      await db.gymEquipmentExercise.count({
        where: { exerciseId: exercise.id, equipmentId: { in: [largeBar.id, smallBar.id] } },
      }),
    ).toBe(0);

    await db.exercise.update({ where: { id: exercise.id }, data: { equipmentType: 'CABLE' } });
    const wrongTypeResponse = await patchExerciseEquipment(
      jsonReq('PATCH', {
        gyms: [{ gymId: gym.id, equipmentIds: [largeBar.id, smallBar.id] }],
      }),
      { params: Promise.resolve({ id: exercise.id }) },
    );
    expect(wrongTypeResponse.status).toBe(400);
  });

  it('enforces system-bar membership for the legacy equipmentIds payload', async () => {
    const { a, exercise } = await seed();
    await db.exercise.update({
      where: { id: exercise.id },
      data: { name: 'Barbell bench press', equipmentType: 'BARBELL' },
    });
    const gym = await db.gym.create({ data: { userId: a.id, name: 'Legacy payload gym' } });
    const [largeBar, smallBar] = await createSystemBars(gym.id);
    actAs(a.id);

    const partialResponse = await patchExerciseEquipment(
      jsonReq('PATCH', { equipmentIds: [largeBar.id] }),
      { params: Promise.resolve({ id: exercise.id }) },
    );
    expect(partialResponse.status).toBe(400);

    const response = await patchExerciseEquipment(
      jsonReq('PATCH', { equipmentIds: [largeBar.id, smallBar.id] }),
      { params: Promise.resolve({ id: exercise.id }) },
    );
    expect(response.status).toBe(200);
    expect(
      await db.gymExerciseConfig.findUniqueOrThrow({
        where: { gymId_exerciseId: { gymId: gym.id, exerciseId: exercise.id } },
      }),
    ).toMatchObject({ systemProfileSupported: true });

    const removeResponse = await patchExerciseEquipment(jsonReq('PATCH', { equipmentIds: [] }), {
      params: Promise.resolve({ id: exercise.id }),
    });
    expect(removeResponse.status).toBe(200);
    expect(
      await db.gymExerciseConfig.findUniqueOrThrow({
        where: { gymId_exerciseId: { gymId: gym.id, exerciseId: exercise.id } },
      }),
    ).toMatchObject({ systemProfileSupported: false });
    expect(
      await db.gymEquipmentExercise.count({
        where: { exerciseId: exercise.id, equipmentId: { in: [largeBar.id, smallBar.id] } },
      }),
    ).toBe(0);

    await db.exercise.update({ where: { id: exercise.id }, data: { equipmentType: 'CABLE' } });
    const wrongTypeResponse = await patchExerciseEquipment(
      jsonReq('PATCH', { equipmentIds: [largeBar.id, smallBar.id] }),
      { params: Promise.resolve({ id: exercise.id }) },
    );
    expect(wrongTypeResponse.status).toBe(400);
  });

  it('updates one gym preference without removing another gym links or frozen set facts', async () => {
    const { a, exercise, set } = await seed();
    await db.exercise.update({ where: { id: exercise.id }, data: { equipmentType: 'BARBELL' } });
    const [activeGym, otherGym] = await Promise.all([
      db.gym.create({ data: { userId: a.id, name: 'Active gym' } }),
      db.gym.create({ data: { userId: a.id, name: 'Other gym' } }),
    ]);
    const [smallBar, standardBar, otherBar] = await Promise.all([
      db.gymEquipment.create({
        data: { gymId: activeGym.id, name: '10 kg EZ bar', equipmentType: 'BARBELL' },
      }),
      db.gymEquipment.create({
        data: { gymId: activeGym.id, name: '20 kg bar', equipmentType: 'BARBELL' },
      }),
      db.gymEquipment.create({
        data: { gymId: otherGym.id, name: 'Other gym bar', equipmentType: 'BARBELL' },
      }),
    ]);
    await db.gymEquipmentExercise.createMany({
      data: [
        { equipmentId: standardBar.id, exerciseId: exercise.id },
        { equipmentId: otherBar.id, exerciseId: exercise.id },
      ],
    });
    await db.gymExerciseConfig.create({
      data: {
        gymId: otherGym.id,
        exerciseId: exercise.id,
        preferredEquipmentId: otherBar.id,
      },
    });
    const frozenSnapshot = {
      version: 1,
      equipmentId: standardBar.id,
      equipmentName: standardBar.name,
      equipmentType: 'BARBELL',
      loadType: 'PLATE_LOADED',
      selectedLoadKg: 40,
      selectedLoadMultiplier: 1,
      nominalResistanceKg: null,
      baseLoadKg: 20,
      loadingSides: 2,
      platePoolId: null,
      platePoolName: null,
      platePoolCompatibilityKey: null,
      plates: [],
    };
    await db.set.update({
      where: { id: set.id },
      data: {
        gymEquipmentId: standardBar.id,
        equipmentNameSnapshot: standardBar.name,
        selectedLoadKg: 40,
        selectedLoadMultiplierSnapshot: 1,
        equipmentLoadSnapshot: frozenSnapshot,
      },
    });
    actAs(a.id);

    const response = await patchExerciseEquipment(
      jsonReq('PATCH', {
        gyms: [
          {
            gymId: activeGym.id,
            equipmentIds: [smallBar.id, standardBar.id],
            preferredEquipmentId: smallBar.id,
          },
        ],
      }),
      { params: Promise.resolve({ id: exercise.id }) },
    );

    expect(response.status).toBe(200);
    expect(
      await db.gymExerciseConfig.findUniqueOrThrow({
        where: { gymId_exerciseId: { gymId: activeGym.id, exerciseId: exercise.id } },
      }),
    ).toMatchObject({ preferredEquipmentId: smallBar.id, isEquipmentMirror: false });
    expect(
      await db.gymEquipmentExercise.findUnique({
        where: {
          equipmentId_exerciseId: { equipmentId: otherBar.id, exerciseId: exercise.id },
        },
      }),
    ).not.toBeNull();
    expect(
      await db.gymExerciseConfig.findUniqueOrThrow({
        where: { gymId_exerciseId: { gymId: otherGym.id, exerciseId: exercise.id } },
      }),
    ).toMatchObject({ preferredEquipmentId: otherBar.id });
    expect(await db.set.findUniqueOrThrow({ where: { id: set.id } })).toMatchObject({
      gymEquipmentId: standardBar.id,
      equipmentNameSnapshot: standardBar.name,
      selectedLoadKg: 40,
      selectedLoadMultiplierSnapshot: 1,
      equipmentLoadSnapshot: frozenSnapshot,
    });
  });

  it('rejects a cross-gym or type-incompatible preferred item before changing links', async () => {
    const { a, exercise } = await seed();
    await db.exercise.update({ where: { id: exercise.id }, data: { equipmentType: 'BARBELL' } });
    const [gymA, gymB] = await Promise.all([
      db.gym.create({ data: { userId: a.id, name: 'Gym A' } }),
      db.gym.create({ data: { userId: a.id, name: 'Gym B' } }),
    ]);
    const [bar, cable] = await Promise.all([
      db.gymEquipment.create({
        data: { gymId: gymA.id, name: 'Bar', equipmentType: 'BARBELL' },
      }),
      db.gymEquipment.create({
        data: { gymId: gymB.id, name: 'Cable', equipmentType: 'CABLE' },
      }),
    ]);
    await db.gymEquipmentExercise.create({
      data: { equipmentId: bar.id, exerciseId: exercise.id },
    });
    actAs(a.id);

    const crossGym = await patchExerciseEquipment(
      jsonReq('PATCH', {
        gyms: [{ gymId: gymA.id, equipmentIds: [cable.id], preferredEquipmentId: cable.id }],
      }),
      { params: Promise.resolve({ id: exercise.id }) },
    );
    expect(crossGym.status).toBe(400);

    const wrongType = await patchExerciseEquipment(
      jsonReq('PATCH', {
        gyms: [{ gymId: gymB.id, equipmentIds: [cable.id], preferredEquipmentId: cable.id }],
      }),
      { params: Promise.resolve({ id: exercise.id }) },
    );
    expect(wrongType.status).toBe(400);
    expect(
      await db.gymEquipmentExercise.findUnique({
        where: { equipmentId_exerciseId: { equipmentId: bar.id, exerciseId: exercise.id } },
      }),
    ).not.toBeNull();
  });

  it('replaces only the owner exercise links with owner equipment', async () => {
    const { a, exercise } = await seed();
    const gym = await db.gym.create({ data: { userId: a.id, name: 'Owner gym' } });
    const equipment = await db.gymEquipment.create({
      data: { gymId: gym.id, name: 'Cable tower', equipmentType: 'CABLE' },
    });
    actAs(a.id);

    const response = await patchExerciseEquipment(
      jsonReq('PATCH', { equipmentIds: [equipment.id] }),
      { params: Promise.resolve({ id: exercise.id }) },
    );

    expect(response.status).toBe(200);
    expect(
      await db.gymEquipmentExercise.findUnique({
        where: {
          equipmentId_exerciseId: { equipmentId: equipment.id, exerciseId: exercise.id },
        },
      }),
    ).not.toBeNull();
  });

  it('cleans a removed REST mirror and keeps direct replacement links link-only', async () => {
    const { a, exercise } = await seed();
    const gym = await db.gym.create({
      data: { userId: a.id, name: 'Mirror cleanup gym', inventoryMode: 'EQUIPMENT_FIRST' },
    });
    const [mirroredEquipment, replacementEquipment] = await Promise.all([
      db.gymEquipment.create({
        data: { gymId: gym.id, name: 'Mirrored cable', equipmentType: 'CABLE' },
      }),
      db.gymEquipment.create({
        data: { gymId: gym.id, name: 'Replacement cable', equipmentType: 'CABLE' },
      }),
    ]);
    await db.gymEquipmentExercise.create({
      data: {
        equipmentId: mirroredEquipment.id,
        exerciseId: exercise.id,
        mirrorsLegacyConfig: true,
      },
    });
    await db.gymExerciseConfig.create({
      data: {
        gymId: gym.id,
        exerciseId: exercise.id,
        isAvailable: true,
        isEquipmentMirror: true,
      },
    });
    actAs(a.id);

    const response = await patchExerciseEquipment(
      jsonReq('PATCH', { equipmentIds: [replacementEquipment.id] }),
      { params: Promise.resolve({ id: exercise.id }) },
    );

    expect(response.status).toBe(200);
    expect(
      await db.gymExerciseConfig.findUnique({
        where: { gymId_exerciseId: { gymId: gym.id, exerciseId: exercise.id } },
      }),
    ).toBeNull();
    expect(
      await db.gymEquipmentExercise.findUniqueOrThrow({
        where: {
          equipmentId_exerciseId: {
            equipmentId: replacementEquipment.id,
            exerciseId: exercise.id,
          },
        },
      }),
    ).toMatchObject({ mirrorsLegacyConfig: false });
  });

  it('rejects another user equipment before changing existing links', async () => {
    const { a, b, exercise } = await seed();
    const [ownerGym, strangerGym] = await Promise.all([
      db.gym.create({ data: { userId: a.id, name: 'Owner gym' } }),
      db.gym.create({ data: { userId: b.id, name: 'Stranger gym' } }),
    ]);
    const [ownerEquipment, strangerEquipment] = await Promise.all([
      db.gymEquipment.create({
        data: { gymId: ownerGym.id, name: 'Owner cable', equipmentType: 'CABLE' },
      }),
      db.gymEquipment.create({
        data: { gymId: strangerGym.id, name: 'Stranger cable', equipmentType: 'CABLE' },
      }),
    ]);
    await db.gymEquipmentExercise.create({
      data: { equipmentId: ownerEquipment.id, exerciseId: exercise.id },
    });
    actAs(a.id);

    const response = await patchExerciseEquipment(
      jsonReq('PATCH', { equipmentIds: [strangerEquipment.id] }),
      { params: Promise.resolve({ id: exercise.id }) },
    );

    expect(response.status).toBe(400);
    expect(
      await db.gymEquipmentExercise.findUnique({
        where: {
          equipmentId_exerciseId: {
            equipmentId: ownerEquipment.id,
            exerciseId: exercise.id,
          },
        },
      }),
    ).not.toBeNull();
  });
});

describe('route ownership: GET /api/exercises/[id]', () => {
  it('lets the owner read their exercise', async () => {
    const { a, exercise } = await seed();
    actAs(a.id);
    const res = await getExercise(new Request('http://t/api'), {
      params: Promise.resolve({ id: exercise.id }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe(exercise.id);
  });

  it("returns 404 for a stranger reading someone else's exercise", async () => {
    const { b, exercise } = await seed();
    actAs(b.id);
    const res = await getExercise(new Request('http://t/api'), {
      params: Promise.resolve({ id: exercise.id }),
    });
    expect(res.status).toBe(404);
  });
});
