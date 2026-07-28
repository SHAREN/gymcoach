import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';

vi.mock('@/lib/auth', () => ({ getCurrentUserId: vi.fn() }));
const mockUserId = vi.mocked(getCurrentUserId);

import { POST as addHistoricalSet } from '@/app/api/sessions/[id]/historical-sets/route';
import { POST as addActiveSet } from '@/app/api/sessions/[id]/sets/route';
import { DELETE as deleteSet } from '@/app/api/sets/[id]/route';
import { getLastPerformancesForEquipmentTargets } from '@/lib/last-performance';

function jsonRequest(url: string, body: unknown) {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => mockUserId.mockReset());

describe('POST /api/sessions/[id]/historical-sets', () => {
  it('appends an owner set with the frozen finish time and equipment snapshot', async () => {
    const owner = await db.user.create({
      data: { email: 'history-set-owner@test.dev', passwordHash: 'x' },
    });
    const stranger = await db.user.create({
      data: { email: 'history-set-stranger@test.dev', passwordHash: 'x' },
    });
    const exercise = await db.exercise.create({
      data: {
        userId: owner.id,
        name: 'Historical cable pressdown',
        muscleGroup: 'TRICEPS',
        category: 'ISOLATION',
        equipmentType: 'CABLE',
      },
    });
    const program = await db.program.create({
      data: { userId: owner.id, name: 'History program', phase: 'Base' },
    });
    const workout = await db.workout.create({
      data: { programId: program.id, name: 'History workout', order: 1 },
    });
    const programExercise = await db.programExercise.create({
      data: {
        workoutId: workout.id,
        exerciseId: exercise.id,
        order: 1,
        targetSets: 3,
        targetRepsMin: 8,
        targetRepsMax: 12,
        targetRIR: 2,
        restSec: 90,
      },
    });
    const gym = await db.gym.create({
      data: { userId: owner.id, name: 'History equipment gym', inventoryMode: 'EQUIPMENT_FIRST' },
    });
    const equipment = await db.gymEquipment.create({
      data: {
        gymId: gym.id,
        name: 'History cable A',
        equipmentType: 'CABLE',
        loadType: 'SELECTORIZED',
        weightOptions: [10, 20, 30],
        selectedLoadMultiplier: 0.5,
        loadingSides: 1,
        exerciseLinks: { create: { exerciseId: exercise.id } },
      },
    });
    const startedAt = new Date('2026-06-01T10:00:00.000Z');
    const finishedAt = new Date('2026-06-01T11:00:00.000Z');
    const session = await db.session.create({
      data: {
        userId: owner.id,
        programId: program.id,
        workoutId: workout.id,
        gymId: gym.id,
        startedAt,
        finishedAt,
      },
    });
    await db.set.create({
      data: {
        sessionId: session.id,
        exerciseId: exercise.id,
        gymEquipmentId: equipment.id,
        equipmentNameSnapshot: equipment.name,
        selectedLoadKg: 10,
        selectedLoadMultiplierSnapshot: 0.5,
        nominalResistanceKg: 5,
        equipmentLoadSnapshot: { version: 1, loadType: 'SELECTORIZED' },
        setNumber: 1,
        weight: 10,
        reps: 10,
        rir: 2,
        completedAt: new Date('2026-06-01T10:30:00.000Z'),
      },
    });
    const newerSession = await db.session.create({
      data: {
        userId: owner.id,
        gymId: gym.id,
        startedAt: new Date('2026-07-01T10:00:00.000Z'),
        finishedAt: new Date('2026-07-01T11:00:00.000Z'),
      },
    });
    await db.set.create({
      data: {
        sessionId: newerSession.id,
        exerciseId: exercise.id,
        gymEquipmentId: equipment.id,
        setNumber: 1,
        weight: 30,
        reps: 8,
        completedAt: new Date('2026-07-01T10:30:00.000Z'),
      },
    });

    mockUserId.mockResolvedValue(owner.id);
    const clientSetId = 'mob_set_history_idempotent_01';
    const requestBody = {
      id: clientSetId,
      exerciseId: exercise.id,
      gymEquipmentId: equipment.id,
      weight: 20,
      reps: 9,
      rir: 1,
    };
    const response = await addHistoricalSet(
      jsonRequest(`http://test.local/api/sessions/${session.id}/historical-sets`, {
        ...requestBody,
      }),
      { params: Promise.resolve({ id: session.id }) },
    );

    expect(response.status).toBe(201);
    const created = await response.json();
    expect(created).toMatchObject({
      id: clientSetId,
      setNumber: 2,
      weight: 20,
      reps: 9,
      rir: 1,
      completedAt: finishedAt.toISOString(),
      gymEquipmentId: equipment.id,
      equipmentNameSnapshot: 'History cable A',
      selectedLoadKg: 20,
      selectedLoadMultiplierSnapshot: 0.5,
      nominalResistanceKg: 10,
      equipmentLoadSnapshot: expect.objectContaining({
        loadType: 'SELECTORIZED',
        selectedLoadKg: 20,
      }),
    });
    const retryResponse = await addHistoricalSet(
      jsonRequest(`http://test.local/api/sessions/${session.id}/historical-sets`, requestBody),
      { params: Promise.resolve({ id: session.id }) },
    );
    expect(retryResponse.status).toBe(201);
    expect(await retryResponse.json()).toMatchObject({ id: clientSetId, setNumber: 2 });
    expect(await db.set.count({ where: { id: clientSetId } })).toBe(1);
    const conflictingRetryResponse = await addHistoricalSet(
      jsonRequest(`http://test.local/api/sessions/${session.id}/historical-sets`, {
        ...requestBody,
        reps: 8,
      }),
      { params: Promise.resolve({ id: session.id }) },
    );
    expect(conflictingRetryResponse.status).toBe(409);
    expect(await db.set.count({ where: { id: clientSetId } })).toBe(1);
    const concurrentRequestBody = {
      ...requestBody,
      id: 'mob_set_history_concurrent_01',
      weight: 30,
    };
    const concurrentResponses = await Promise.all([
      addHistoricalSet(
        jsonRequest(
          `http://test.local/api/sessions/${session.id}/historical-sets`,
          concurrentRequestBody,
        ),
        { params: Promise.resolve({ id: session.id }) },
      ),
      addHistoricalSet(
        jsonRequest(
          `http://test.local/api/sessions/${session.id}/historical-sets`,
          concurrentRequestBody,
        ),
        { params: Promise.resolve({ id: session.id }) },
      ),
    ]);
    expect(concurrentResponses.map((response) => response.status)).toEqual([201, 201]);
    expect(await Promise.all(concurrentResponses.map((response) => response.json()))).toEqual([
      expect.objectContaining({ id: concurrentRequestBody.id }),
      expect.objectContaining({ id: concurrentRequestBody.id }),
    ]);
    expect(await db.set.count({ where: { id: concurrentRequestBody.id } })).toBe(1);
    expect(await db.session.findUniqueOrThrow({ where: { id: session.id } })).toMatchObject({
      startedAt,
      finishedAt,
      workoutId: workout.id,
    });
    expect(
      await db.programExercise.findUniqueOrThrow({ where: { id: programExercise.id } }),
    ).toMatchObject({ targetSets: 3 });

    const latest = await getLastPerformancesForEquipmentTargets(
      owner.id,
      [{ exerciseId: exercise.id, gymId: gym.id, gymEquipmentId: equipment.id }],
      null,
    );
    expect(latest[0]?.sessionId).toBe(newerSession.id);

    const oldSessionSets = await db.set.findMany({ where: { sessionId: session.id } });
    for (const row of oldSessionSets) {
      const deleteResponse = await deleteSet(
        new Request(`http://test.local/api/sets/${row.id}`, { method: 'DELETE' }),
        { params: Promise.resolve({ id: row.id }) },
      );
      expect(deleteResponse.status).toBe(200);
    }
    expect(await db.set.count({ where: { sessionId: session.id } })).toBe(0);
    expect(
      await db.sessionExercise.findUnique({
        where: {
          sessionId_exerciseId: { sessionId: session.id, exerciseId: exercise.id },
        },
      }),
    ).not.toBeNull();

    const readdedResponse = await addHistoricalSet(
      jsonRequest(`http://test.local/api/sessions/${session.id}/historical-sets`, {
        exerciseId: exercise.id,
        gymEquipmentId: equipment.id,
        weight: 20,
        reps: 9,
        rir: 1,
      }),
      { params: Promise.resolve({ id: session.id }) },
    );
    expect(readdedResponse.status).toBe(201);
    expect(await readdedResponse.json()).toMatchObject({
      setNumber: 1,
      completedAt: finishedAt.toISOString(),
    });

    const activeResponse = await addActiveSet(
      jsonRequest(`http://test.local/api/sessions/${session.id}/sets`, {
        exerciseId: exercise.id,
        gymEquipmentId: equipment.id,
        setNumber: 3,
        weight: 30,
        reps: 8,
        rir: 1,
      }),
      { params: Promise.resolve({ id: session.id }) },
    );
    expect(activeResponse.status).toBe(400);
    await expect(activeResponse.json()).resolves.toEqual({ error: 'Session already finished.' });

    mockUserId.mockResolvedValue(stranger.id);
    const strangerResponse = await addHistoricalSet(
      jsonRequest(`http://test.local/api/sessions/${session.id}/historical-sets`, {
        exerciseId: exercise.id,
        gymEquipmentId: equipment.id,
        weight: 20,
        reps: 9,
        rir: 1,
      }),
      { params: Promise.resolve({ id: session.id }) },
    );
    expect(strangerResponse.status).toBe(404);
  });

  it('rejects unfinished, cardio, missing-equipment, and unattainable-load writes', async () => {
    const user = await db.user.create({
      data: { email: 'history-set-validation@test.dev', passwordHash: 'x' },
    });
    const [strength, cardio, unlinkedStrength] = await Promise.all([
      db.exercise.create({
        data: {
          userId: user.id,
          name: 'Validation cable',
          muscleGroup: 'TRICEPS',
          category: 'ISOLATION',
          equipmentType: 'CABLE',
        },
      }),
      db.exercise.create({
        data: {
          userId: user.id,
          name: 'Validation run',
          muscleGroup: 'QUADS',
          category: 'CARDIO',
          equipmentType: 'CARDIO',
        },
      }),
      db.exercise.create({
        data: {
          userId: user.id,
          name: 'Unlinked validation machine',
          muscleGroup: 'CHEST',
          category: 'COMPOUND',
          equipmentType: 'MACHINE',
        },
      }),
    ]);
    const gym = await db.gym.create({
      data: { userId: user.id, name: 'Validation gym', inventoryMode: 'EQUIPMENT_FIRST' },
    });
    const equipment = await db.gymEquipment.create({
      data: {
        gymId: gym.id,
        name: 'Validation cable machine',
        equipmentType: 'CABLE',
        loadType: 'SELECTORIZED',
        weightOptions: [10, 20],
        exerciseLinks: { create: { exerciseId: strength.id } },
      },
    });
    const unfinished = await db.session.create({ data: { userId: user.id, gymId: gym.id } });
    await db.set.create({
      data: {
        sessionId: unfinished.id,
        exerciseId: strength.id,
        setNumber: 1,
        weight: 10,
        reps: 10,
      },
    });
    const finished = await db.session.create({
      data: { userId: user.id, gymId: gym.id, finishedAt: new Date('2026-06-01T11:00:00Z') },
    });
    await db.set.createMany({
      data: [
        {
          sessionId: finished.id,
          exerciseId: strength.id,
          setNumber: 1,
          weight: 10,
          reps: 10,
        },
        {
          sessionId: finished.id,
          exerciseId: cardio.id,
          setNumber: 1,
          weight: 0,
          reps: 1,
          durationSec: 600,
        },
        {
          sessionId: finished.id,
          exerciseId: unlinkedStrength.id,
          setNumber: 1,
          weight: 40,
          reps: 10,
        },
      ],
    });
    mockUserId.mockResolvedValue(user.id);

    const baseBody = {
      exerciseId: strength.id,
      gymEquipmentId: equipment.id,
      weight: 20,
      reps: 10,
      rir: 2,
    };
    const unfinishedResponse = await addHistoricalSet(
      jsonRequest('http://test.local/api', baseBody),
      { params: Promise.resolve({ id: unfinished.id }) },
    );
    expect(unfinishedResponse.status).toBe(400);

    const cardioResponse = await addHistoricalSet(
      jsonRequest('http://test.local/api', { ...baseBody, exerciseId: cardio.id }),
      { params: Promise.resolve({ id: finished.id }) },
    );
    expect(cardioResponse.status).toBe(400);

    const missingEquipmentResponse = await addHistoricalSet(
      jsonRequest('http://test.local/api', { ...baseBody, gymEquipmentId: null }),
      { params: Promise.resolve({ id: finished.id }) },
    );
    expect(missingEquipmentResponse.status).toBe(400);

    const noLinkedEquipmentResponse = await addHistoricalSet(
      jsonRequest('http://test.local/api', {
        ...baseBody,
        exerciseId: unlinkedStrength.id,
        gymEquipmentId: null,
        weight: 40,
      }),
      { params: Promise.resolve({ id: finished.id }) },
    );
    expect(noLinkedEquipmentResponse.status).toBe(400);
    await expect(noLinkedEquipmentResponse.json()).resolves.toEqual({
      error: 'Select linked equipment before saving this set.',
    });

    const unattainableResponse = await addHistoricalSet(
      jsonRequest('http://test.local/api', { ...baseBody, weight: 17 }),
      { params: Promise.resolve({ id: finished.id }) },
    );
    expect(unattainableResponse.status).toBe(400);
    await expect(unattainableResponse.json()).resolves.toEqual({
      error: 'Selected load is not achievable with this equipment.',
    });
  });

  it('keeps legacy finished sessions usable without equipment', async () => {
    const user = await db.user.create({
      data: { email: 'history-set-legacy@test.dev', passwordHash: 'x' },
    });
    const exercise = await db.exercise.create({
      data: {
        userId: user.id,
        name: 'Legacy history row',
        muscleGroup: 'CHEST',
        category: 'COMPOUND',
        equipmentType: 'BARBELL',
      },
    });
    const gym = await db.gym.create({
      data: { userId: user.id, name: 'Legacy history gym', inventoryMode: 'LEGACY' },
    });
    const finishedAt = new Date('2026-06-01T11:00:00.000Z');
    const session = await db.session.create({
      data: { userId: user.id, gymId: gym.id, finishedAt },
    });
    await db.set.create({
      data: {
        sessionId: session.id,
        exerciseId: exercise.id,
        setNumber: 1,
        weight: 60,
        reps: 10,
      },
    });
    mockUserId.mockResolvedValue(user.id);

    const response = await addHistoricalSet(
      jsonRequest('http://test.local/api', {
        exerciseId: exercise.id,
        gymEquipmentId: null,
        weight: 62.5,
        reps: 8,
        rir: 1,
      }),
      { params: Promise.resolve({ id: session.id }) },
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      gymEquipmentId: null,
      setNumber: 2,
      weight: 62.5,
      completedAt: finishedAt.toISOString(),
    });
  });
});
