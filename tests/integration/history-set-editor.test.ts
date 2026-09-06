import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';

vi.mock('@/lib/auth', () => ({ getCurrentUserId: vi.fn() }));
const mockUserId = vi.mocked(getCurrentUserId);

import { PATCH as patchSet } from '@/app/api/sets/[id]/route';
import { POST as appendHistoricalSet } from '@/app/api/sessions/[id]/historical-sets/route';

function jsonRequest(method: 'PATCH' | 'POST', body: unknown): Request {
  return new Request('http://test.local/api', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function seed() {
  const suffix = `${Date.now()}-${Math.random()}`;
  const user = await db.user.create({
    data: { email: `history-editor-${suffix}@test.dev`, passwordHash: 'x' },
  });
  const stranger = await db.user.create({
    data: { email: `history-editor-stranger-${suffix}@test.dev`, passwordHash: 'x' },
  });
  const exercise = await db.exercise.create({
    data: {
      userId: user.id,
      name: `Cable row ${suffix}`,
      muscleGroup: 'BACK_THICKNESS',
      category: 'COMPOUND',
      equipmentType: 'CABLE',
    },
  });
  const otherExercise = await db.exercise.create({
    data: {
      userId: user.id,
      name: `Unused exercise ${suffix}`,
      muscleGroup: 'CHEST',
      category: 'COMPOUND',
      equipmentType: 'MACHINE',
    },
  });
  const cardio = await db.exercise.create({
    data: {
      userId: user.id,
      name: `Cardio ${suffix}`,
      muscleGroup: 'OTHER',
      category: 'CARDIO',
      equipmentType: 'CARDIO',
    },
  });
  const gym = await db.gym.create({ data: { userId: user.id, name: `History gym ${suffix}` } });
  const equipment = await db.gymEquipment.create({
    data: {
      gymId: gym.id,
      name: `Cable station ${suffix}`,
      equipmentType: 'CABLE',
      manufacturer: 'HistoryCo',
      modelName: 'Frozen-1',
      loadType: 'SELECTORIZED',
      weightOptions: [10, 20, 30],
      exerciseLinks: { create: { exerciseId: exercise.id } },
    },
  });
  const finishedAt = new Date('2026-09-04T18:00:00.000Z');
  const finished = await db.session.create({
    data: {
      userId: user.id,
      gymId: gym.id,
      startedAt: new Date('2026-09-04T17:00:00Z'),
      finishedAt,
    },
  });
  const active = await db.session.create({ data: { userId: user.id, gymId: gym.id } });
  const historical = await db.set.create({
    data: {
      sessionId: finished.id,
      exerciseId: exercise.id,
      gymEquipmentId: equipment.id,
      equipmentNameSnapshot: 'Cable station original',
      equipmentLoadSnapshot: {
        version: 1,
        equipmentType: 'CABLE',
        manufacturer: 'HistoryCo',
        modelName: 'Frozen-1',
        weightOptions: [10, 20, 30],
      },
      setNumber: 1,
      weight: 20,
      reps: 10,
      rir: 2,
      completedAt: new Date('2026-09-04T17:30:00Z'),
    },
  });
  const cardioSet = await db.set.create({
    data: {
      sessionId: finished.id,
      exerciseId: cardio.id,
      setNumber: 1,
      weight: 0,
      reps: 1,
      durationSec: 600,
      completedAt: new Date('2026-09-04T17:40:00Z'),
    },
  });
  const activeSet = await db.set.create({
    data: {
      sessionId: active.id,
      exerciseId: exercise.id,
      gymEquipmentId: equipment.id,
      equipmentNameSnapshot: 'Cable station active',
      equipmentLoadSnapshot: {
        version: 1,
        equipmentType: 'CABLE',
        manufacturer: 'HistoryCo',
        modelName: 'Frozen-1',
        weightOptions: [10, 20, 30],
      },
      setNumber: 1,
      weight: 10,
      reps: 12,
    },
  });
  return {
    user,
    stranger,
    exercise,
    otherExercise,
    cardioSet,
    gym,
    equipment,
    finished,
    activeSet,
    historical,
    finishedAt,
  };
}

beforeEach(() => mockUserId.mockReset());

describe('completed workout strength set editor API', () => {
  it('PATCH changes only values and preserves frozen equipment/history identity', async () => {
    const { user, historical } = await seed();
    mockUserId.mockResolvedValue(user.id);
    const before = await db.set.findUniqueOrThrow({ where: { id: historical.id } });

    const response = await patchSet(
      jsonRequest('PATCH', { weight: 25, reps: 8, rir: 0.5 }),
      params(historical.id),
    );
    expect(response.status).toBe(200);

    const after = await db.set.findUniqueOrThrow({ where: { id: historical.id } });
    expect(after).toMatchObject({
      exerciseId: before.exerciseId,
      setNumber: before.setNumber,
      weight: 25,
      reps: 8,
      rir: 0.5,
      gymEquipmentId: before.gymEquipmentId,
      equipmentNameSnapshot: before.equipmentNameSnapshot,
      equipmentLoadSnapshot: before.equipmentLoadSnapshot,
    });
    expect(after.completedAt.getTime()).toBe(before.completedAt.getTime());
  });

  it('PATCH accepts active strength corrections while preserving frozen equipment', async () => {
    const { user, activeSet } = await seed();
    mockUserId.mockResolvedValue(user.id);
    const before = await db.set.findUniqueOrThrow({ where: { id: activeSet.id } });

    const active = await patchSet(
      jsonRequest('PATCH', { weight: 15, reps: 10, rir: 2 }),
      params(activeSet.id),
    );
    expect(active.status).toBe(200);
    const after = await db.set.findUniqueOrThrow({ where: { id: activeSet.id } });
    expect(after).toMatchObject({
      weight: 15,
      reps: 10,
      rir: 2,
      gymEquipmentId: before.gymEquipmentId,
      equipmentNameSnapshot: before.equipmentNameSnapshot,
      equipmentLoadSnapshot: before.equipmentLoadSnapshot,
    });
    expect(after.completedAt.getTime()).toBe(before.completedAt.getTime());
  });

  it('PATCH rejects cardio, foreign, and metadata-changing writes', async () => {
    const { user, stranger, historical, cardioSet } = await seed();
    mockUserId.mockResolvedValue(user.id);

    const cardio = await patchSet(
      jsonRequest('PATCH', { weight: 0, reps: 1, rir: null }),
      params(cardioSet.id),
    );
    expect(cardio.status).toBe(400);

    const metadata = await patchSet(
      jsonRequest('PATCH', { weight: 25, reps: 8, rir: 1, gymEquipmentId: 'other' }),
      params(historical.id),
    );
    expect(metadata.status).toBe(400);

    mockUserId.mockResolvedValue(stranger.id);
    const foreign = await patchSet(
      jsonRequest('PATCH', { weight: 25, reps: 8, rir: 1 }),
      params(historical.id),
    );
    expect(foreign.status).toBe(404);
  });

  it('POST appends the next row to a finished exercise and freezes current linked equipment', async () => {
    const { user, exercise, equipment, finished, finishedAt } = await seed();
    mockUserId.mockResolvedValue(user.id);

    const response = await appendHistoricalSet(
      jsonRequest('POST', {
        exerciseId: exercise.id,
        gymEquipmentId: equipment.id,
        weight: 30,
        reps: 6,
        rir: 1,
      }),
      params(finished.id),
    );
    expect(response.status).toBe(201);
    const created = await response.json();
    expect(created).toMatchObject({
      exerciseId: exercise.id,
      setNumber: 2,
      weight: 30,
      reps: 6,
      rir: 1,
      gymEquipmentId: equipment.id,
      equipmentNameSnapshot: expect.stringContaining('Cable station'),
      equipmentLoadSnapshot: {
        version: 2,
        equipmentType: 'CABLE',
        manufacturer: 'HistoryCo',
        modelName: 'Frozen-1',
        loadConfigurationKnown: true,
        loadFacts: {
          state: 'KNOWN',
          loadType: 'SELECTORIZED',
          weightOptions: [10, 20, 30],
          selectedLoadMultiplier: 1,
          baseLoadKg: 0,
          loadingSides: 2,
          platePool: null,
        },
      },
    });
    expect(new Date(created.completedAt).getTime()).toBe(finishedAt.getTime());
  });

  it('POST rejects an exercise not already represented in the finished session and foreign ownership', async () => {
    const { user, stranger, otherExercise, finished } = await seed();
    mockUserId.mockResolvedValue(user.id);

    const absent = await appendHistoricalSet(
      jsonRequest('POST', { exerciseId: otherExercise.id, weight: 20, reps: 10, rir: 2 }),
      params(finished.id),
    );
    expect(absent.status).toBe(400);

    mockUserId.mockResolvedValue(stranger.id);
    const foreign = await appendHistoricalSet(
      jsonRequest('POST', { exerciseId: otherExercise.id, weight: 20, reps: 10, rir: 2 }),
      params(finished.id),
    );
    expect(foreign.status).toBe(404);
  });
});
