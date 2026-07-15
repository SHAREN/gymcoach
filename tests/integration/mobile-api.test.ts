import bcrypt from 'bcrypt';
import { describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { POST as login } from '@/app/api/mobile/auth/login/route';
import { GET as bootstrap } from '@/app/api/mobile/bootstrap/route';
import { POST as saveReadiness } from '@/app/api/mobile/readiness/route';
import { POST as sync } from '@/app/api/mobile/sync/route';

function jsonRequest(url: string, body: unknown, token?: string): Request {
  return new Request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function seedUser(email: string, password = 'secret123') {
  const user = await db.user.create({
    data: { email, passwordHash: await bcrypt.hash(password, 4) },
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
  const program = await db.program.create({
    data: {
      userId: user.id,
      name: 'Offline block',
      phase: 'base',
      isActive: true,
      workouts: {
        create: {
          name: 'Upper',
          order: 1,
          exercises: {
            create: {
              exerciseId: exercise.id,
              order: 1,
              targetSets: 3,
              targetRepsMin: 8,
              targetRepsMax: 12,
              targetRIR: 2,
              restSec: 120,
              fatigueRate: 0.75,
              loadAdjustmentPct: 2.5,
            },
          },
        },
      },
    },
    include: { workouts: true },
  });
  const gym = await db.gym.create({
    data: {
      id: `gym_${user.id}`,
      userId: user.id,
      name: 'Olymp',
      barWeights: [20],
      plateWeights: [1.25, 2.5, 5, 10, 20],
    },
  });
  const platePool = await db.gymPlatePool.create({
    data: {
      gymId: gym.id,
      name: 'Olympic plates',
      compatibilityKey: 'olympic_50mm',
      plates: {
        createMany: {
          data: [
            { weightKg: 20, quantity: 4 },
            { weightKg: 5, quantity: 4 },
          ],
        },
      },
    },
  });
  const equipment = await db.gymEquipment.create({
    data: {
      gymId: gym.id,
      name: 'Bench station',
      equipmentType: 'BARBELL',
      loadType: 'PLATE_LOADED',
      baseLoadKg: 20,
      platePoolId: platePool.id,
      loadingSides: 2,
      exerciseLinks: { create: { exerciseId: exercise.id } },
    },
  });
  await db.user.update({ where: { id: user.id }, data: { activeGymId: gym.id } });
  const programExercise = await db.programExercise.findFirstOrThrow({
    where: { workoutId: program.workouts[0]!.id },
  });
  return { user, exercise, workout: program.workouts[0]!, programExercise, gym, equipment };
}

async function loginDevice(email: string, password = 'secret123') {
  const response = await login(
    jsonRequest('http://test.local/api/mobile/auth/login', {
      email,
      password,
      deviceId: `device_${email}`,
      deviceName: 'Integration phone',
    }),
  );
  expect(response.status).toBe(200);
  return (await response.json()) as { accessToken: string };
}

describe('Android mobile API', () => {
  it('stores a bearer-authenticated readiness check-in and exposes it in bootstrap', async () => {
    const seeded = await seedUser('mobile-readiness@test.dev');
    const { accessToken } = await loginDevice(seeded.user.email);

    const unauthorized = await saveReadiness(
      jsonRequest('http://test.local/api/mobile/readiness', { readiness: 4, sleepQuality: 3 }),
    );
    expect(unauthorized.status).toBe(401);

    const saved = await saveReadiness(
      jsonRequest(
        'http://test.local/api/mobile/readiness',
        { readiness: 4, sleepQuality: 3, note: 'Ready after work' },
        accessToken,
      ),
    );
    expect(saved.status).toBe(201);

    const response = await bootstrap(
      new Request('http://test.local/api/mobile/bootstrap', {
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).readiness).toMatchObject({
      readiness: 4,
      sleepQuality: 3,
      note: 'Ready after work',
    });
  });

  it('deletes a session idempotently without crossing ownership and rederives goals', async () => {
    const owner = await seedUser('mobile-delete-session@test.dev');
    const stranger = await seedUser('mobile-delete-session-stranger@test.dev');
    const { accessToken } = await loginDevice(owner.user.email);
    const completedAt = new Date('2026-07-14T10:15:00Z');
    const session = await db.session.create({
      data: {
        id: 'mobile_delete_session_owner',
        userId: owner.user.id,
        workoutId: owner.workout.id,
        programId: owner.workout.programId,
        startedAt: new Date('2026-07-14T10:00:00Z'),
        sets: {
          create: {
            exerciseId: owner.exercise.id,
            setNumber: 1,
            weight: 100,
            reps: 10,
            rir: 1,
            completedAt,
          },
        },
      },
    });
    const goal = await db.exerciseGoal.create({
      data: {
        userId: owner.user.id,
        exerciseId: owner.exercise.id,
        targetWeight: 90,
        targetReps: 8,
        achievedAt: completedAt,
      },
    });
    const operation = {
      operationId: 'operation_delete_session_owner',
      type: 'DELETE_SESSION',
      sessionId: session.id,
    };

    const deleted = await sync(
      jsonRequest('http://test.local/api/mobile/sync', { operations: [operation] }, accessToken),
    );
    expect(deleted.status).toBe(200);
    expect((await deleted.json()).results[0]).toMatchObject({
      status: 'APPLIED',
      result: { entityId: session.id, deleted: true },
    });
    expect(await db.session.findUnique({ where: { id: session.id } })).toBeNull();
    expect((await db.exerciseGoal.findUniqueOrThrow({ where: { id: goal.id } })).achievedAt).toBeNull();

    const replay = await sync(
      jsonRequest('http://test.local/api/mobile/sync', { operations: [operation] }, accessToken),
    );
    expect((await replay.json()).results[0].status).toBe('DUPLICATE');

    const strangerSession = await db.session.create({
      data: {
        id: 'mobile_delete_session_stranger',
        userId: stranger.user.id,
        workoutId: stranger.workout.id,
        programId: stranger.workout.programId,
        startedAt: new Date('2026-07-14T11:00:00Z'),
      },
    });
    const foreignDelete = await sync(
      jsonRequest(
        'http://test.local/api/mobile/sync',
        {
          operations: [
            {
              operationId: 'operation_delete_session_foreign',
              type: 'DELETE_SESSION',
              sessionId: strangerSession.id,
            },
          ],
        },
        accessToken,
      ),
    );
    expect((await foreignDelete.json()).results[0]).toMatchObject({
      status: 'APPLIED',
      result: { deleted: false },
    });
    expect(await db.session.findUnique({ where: { id: strangerSession.id } })).not.toBeNull();
  });

  it('authenticates a device and returns a workout bootstrap for the device', async () => {
    const seeded = await seedUser('mobile-bootstrap@test.dev');
    const { accessToken } = await loginDevice(seeded.user.email);

    const response = await bootstrap(
      new Request('http://test.local/api/mobile/bootstrap', {
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      schemaVersion: 4,
      profile: { email: seeded.user.email, activeGymId: seeded.gym.id },
      activeProgram: { name: 'Offline block' },
      exerciseHistoryByExerciseId: {},
    });
    expect(body.activeProgram.workouts[0].exercises[0]).toMatchObject({
      exerciseId: seeded.exercise.id,
      targetSets: 3,
      targetRIR: 2,
    });
    expect(body.gyms[0]).toMatchObject({
      inventoryMode: 'EQUIPMENT_FIRST',
      equipment: [
        expect.objectContaining({
          id: seeded.equipment.id,
          loadType: 'PLATE_LOADED',
          platePoolId: expect.any(String),
        }),
      ],
    });
  });

  it('returns up to 12 recent completed sessions per exercise', async () => {
    const seeded = await seedUser('mobile-history@test.dev');
    const cardio = await db.exercise.create({
      data: {
        userId: seeded.user.id,
        name: 'Running',
        muscleGroup: 'OTHER',
        category: 'CARDIO',
        equipmentType: 'OTHER',
      },
    });

    for (let index = 0; index < 14; index += 1) {
      const startedAt = new Date(Date.UTC(2026, 0, index + 1, 10));
      await db.session.create({
        data: {
          id: `mobile_history_session_${index.toString().padStart(2, '0')}`,
          userId: seeded.user.id,
          workoutId: seeded.workout.id,
          startedAt,
          finishedAt: new Date(startedAt.getTime() + 3_600_000),
          sets: {
            create: [
              {
                exerciseId: seeded.exercise.id,
                setNumber: 1,
                weight: 20,
                reps: 10,
                rir: 4,
                isWarmup: true,
                completedAt: new Date(startedAt.getTime() + 60_000),
              },
              {
                exerciseId: seeded.exercise.id,
                setNumber: 3,
                weight: 80 + index,
                reps: 6,
                rir: 1,
                isDropSet: true,
                completedAt: new Date(startedAt.getTime() + 180_000),
              },
              {
                exerciseId: seeded.exercise.id,
                setNumber: 2,
                weight: 75 + index,
                reps: 8,
                rir: 2,
                completedAt: new Date(startedAt.getTime() + 120_000),
              },
              {
                exerciseId: cardio.id,
                setNumber: 1,
                weight: 0,
                reps: 1,
                durationSec: 1_800,
                distanceM: 5_000,
                avgHr: 142,
                maxHr: 166,
                completedAt: new Date(startedAt.getTime() + 240_000),
              },
            ],
          },
        },
      });
    }

    const openStartedAt = new Date('2026-02-01T10:00:00.000Z');
    await db.session.create({
      data: {
        id: 'mobile_history_open_session',
        userId: seeded.user.id,
        workoutId: seeded.workout.id,
        startedAt: openStartedAt,
        sets: {
          create: {
            exerciseId: seeded.exercise.id,
            setNumber: 1,
            weight: 100,
            reps: 5,
            rir: 0,
            completedAt: new Date(openStartedAt.getTime() + 60_000),
          },
        },
      },
    });

    const { accessToken } = await loginDevice(seeded.user.email);
    const response = await bootstrap(
      new Request('http://test.local/api/mobile/bootstrap', {
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    const history = body.exerciseHistoryByExerciseId[seeded.exercise.id];

    expect(history).toHaveLength(12);
    expect(history.map((session: { sessionId: string }) => session.sessionId)).toEqual(
      Array.from(
        { length: 12 },
        (_, offset) => `mobile_history_session_${(13 - offset).toString().padStart(2, '0')}`,
      ),
    );
    expect(history[0]).toEqual({
      sessionId: 'mobile_history_session_13',
      startedAt: '2026-01-14T10:00:00.000Z',
      sets: [
        {
          setNumber: 2,
          weight: 88,
          reps: 8,
          rir: 2,
          isDropSet: false,
          durationSec: null,
          distanceM: null,
          avgHr: null,
          maxHr: null,
        },
        {
          setNumber: 3,
          weight: 93,
          reps: 6,
          rir: 1,
          isDropSet: true,
          durationSec: null,
          distanceM: null,
          avgHr: null,
          maxHr: null,
        },
      ],
    });
    expect(body.exerciseHistoryByExerciseId[cardio.id]).toHaveLength(12);
    expect(body.exerciseHistoryByExerciseId[cardio.id][0]).toEqual({
      sessionId: 'mobile_history_session_13',
      startedAt: '2026-01-14T10:00:00.000Z',
      sets: [
        {
          setNumber: 1,
          weight: 0,
          reps: 1,
          rir: null,
          isDropSet: false,
          durationSec: 1_800,
          distanceM: 5_000,
          avgHr: 142,
          maxHr: 166,
        },
      ],
    });
    expect(
      history.some((session: { sessionId: string }) => session.sessionId.includes('open')),
    ).toBe(false);
  });

  it('applies an offline workout exactly once and preserves client timestamps', async () => {
    const seeded = await seedUser('mobile-sync@test.dev');
    const { accessToken } = await loginDevice(seeded.user.email);
    const sessionId = 'mob_session_00000001';
    const setId = 'mob_set_00000001';
    const operations = [
      {
        operationId: 'operation_start_0001',
        type: 'START_SESSION',
        session: {
          id: sessionId,
          workoutId: seeded.workout.id,
          gymId: seeded.gym.id,
          startedAt: '2026-07-13T10:00:00.000Z',
        },
      },
      {
        operationId: 'operation_set_000001',
        type: 'UPSERT_SET',
        set: {
          id: setId,
          sessionId,
          exerciseId: seeded.exercise.id,
          gymEquipmentId: seeded.equipment.id,
          setNumber: 1,
          weight: 80,
          reps: 10,
          rir: 2,
          notes: 'offline set',
          isWarmup: false,
          isDropSet: false,
          recoverySec: 135,
          completedAt: '2026-07-13T10:05:00.000Z',
        },
      },
      {
        operationId: 'operation_finish_01',
        type: 'FINISH_SESSION',
        sessionId,
        finishedAt: '2026-07-13T11:00:00.000Z',
        notes: 'completed offline',
        sessionRpe: 8,
      },
    ];

    const first = await sync(
      jsonRequest('http://test.local/api/mobile/sync', { operations }, accessToken),
    );
    expect(first.status).toBe(200);
    expect((await first.json()).results.map((item: { status: string }) => item.status)).toEqual([
      'APPLIED',
      'APPLIED',
      'APPLIED',
    ]);

    const repeated = await sync(
      jsonRequest('http://test.local/api/mobile/sync', { operations }, accessToken),
    );
    expect((await repeated.json()).results.map((item: { status: string }) => item.status)).toEqual([
      'DUPLICATE',
      'DUPLICATE',
      'DUPLICATE',
    ]);

    expect(await db.session.count({ where: { id: sessionId } })).toBe(1);
    expect(await db.set.count({ where: { id: setId } })).toBe(1);
    const session = await db.session.findUniqueOrThrow({ where: { id: sessionId } });
    const set = await db.set.findUniqueOrThrow({ where: { id: setId } });
    expect(session).toMatchObject({
      notes: 'completed offline',
      sessionRpe: 8,
      finishedAt: new Date('2026-07-13T11:00:00.000Z'),
    });
    expect(set).toMatchObject({
      weight: 80,
      reps: 10,
      rir: 2,
      recoverySec: 135,
      completedAt: new Date('2026-07-13T10:05:00.000Z'),
      gymEquipmentId: seeded.equipment.id,
      equipmentNameSnapshot: 'Bench station',
      selectedLoadKg: 80,
      selectedLoadMultiplierSnapshot: 1,
    });
    expect(set.equipmentLoadSnapshot).toMatchObject({
      version: 1,
      loadType: 'PLATE_LOADED',
      platePool: expect.objectContaining({ compatibilityKey: 'olympic_50mm' }),
    });

    const reusedOperation = await sync(
      jsonRequest(
        'http://test.local/api/mobile/sync',
        {
          operations: [
            {
              ...operations[1],
              set: { ...operations[1]!.set, reps: 9 },
            },
          ],
        },
        accessToken,
      ),
    );
    expect((await reusedOperation.json()).results[0]).toMatchObject({
      status: 'REJECTED',
      error: expect.stringContaining('different payload'),
    });

    await db.gymEquipment.update({
      where: { id: seeded.equipment.id },
      data: { name: 'Renamed bench', baseLoadKg: 99, loadingSides: 1 },
    });
    const updatedAfterConfigChange = await sync(
      jsonRequest(
        'http://test.local/api/mobile/sync',
        {
          operations: [
            {
              operationId: 'operation_set_update_1',
              type: 'UPSERT_SET',
              set: {
                ...operations[1]!.set,
                weight: 85,
                reps: 9,
                completedAt: '2026-07-13T10:06:00.000Z',
              },
            },
          ],
        },
        accessToken,
      ),
    );
    expect((await updatedAfterConfigChange.json()).results[0]).toMatchObject({
      status: 'APPLIED',
    });
    expect(await db.set.findUniqueOrThrow({ where: { id: setId } })).toMatchObject({
      gymEquipmentId: seeded.equipment.id,
      equipmentNameSnapshot: 'Bench station',
      selectedLoadKg: 85,
      selectedLoadMultiplierSnapshot: 1,
      equipmentLoadSnapshot: expect.objectContaining({
        loadType: 'PLATE_LOADED',
        baseLoadKg: 20,
        loadingSides: 2,
        selectedLoadKg: 85,
      }),
    });

    await db.gymEquipment.delete({ where: { id: seeded.equipment.id } });
    const updatedAfterEquipmentDelete = await sync(
      jsonRequest(
        'http://test.local/api/mobile/sync',
        {
          operations: [
            {
              operationId: 'operation_set_update_2',
              type: 'UPSERT_SET',
              set: {
                ...operations[1]!.set,
                gymEquipmentId: null,
                weight: 90,
                reps: 8,
                completedAt: '2026-07-13T10:07:00.000Z',
              },
            },
          ],
        },
        accessToken,
      ),
    );
    expect((await updatedAfterEquipmentDelete.json()).results[0]).toMatchObject({
      status: 'APPLIED',
    });
    expect(await db.set.findUniqueOrThrow({ where: { id: setId } })).toMatchObject({
      gymEquipmentId: null,
      equipmentNameSnapshot: 'Bench station',
      selectedLoadKg: 90,
      selectedLoadMultiplierSnapshot: 1,
      equipmentLoadSnapshot: expect.objectContaining({
        loadType: 'PLATE_LOADED',
        baseLoadKg: 20,
        loadingSides: 2,
        selectedLoadKg: 90,
      }),
    });
  });

  it('rejects references to another user workout or exercise', async () => {
    const owner = await seedUser('mobile-owner@test.dev');
    const stranger = await seedUser('mobile-stranger@test.dev');
    const { accessToken } = await loginDevice(owner.user.email);

    const response = await sync(
      jsonRequest(
        'http://test.local/api/mobile/sync',
        {
          operations: [
            {
              operationId: 'foreign_operation_01',
              type: 'START_SESSION',
              session: {
                id: 'mob_session_foreign',
                workoutId: stranger.workout.id,
                gymId: stranger.gym.id,
                startedAt: '2026-07-13T10:00:00.000Z',
              },
            },
          ],
        },
        accessToken,
      ),
    );
    expect((await response.json()).results[0]).toMatchObject({
      status: 'REJECTED',
      error: 'Invalid workout.',
    });
    expect(await db.session.count({ where: { userId: owner.user.id } })).toBe(0);
  });

  it('updates an owned planned set count exactly once without changing other fields', async () => {
    const seeded = await seedUser('mobile-target-sets@test.dev');
    const { accessToken } = await loginDevice(seeded.user.email);
    const operation = {
      operationId: 'target_sets_update_01',
      type: 'UPDATE_TARGET_SETS',
      programExerciseId: seeded.programExercise.id,
      previousTargetSets: 3,
      targetSets: 5,
    };

    const first = await sync(
      jsonRequest('http://test.local/api/mobile/sync', { operations: [operation] }, accessToken),
    );
    expect(first.status).toBe(200);
    expect((await first.json()).results[0]).toMatchObject({
      operationId: operation.operationId,
      status: 'APPLIED',
      result: {
        entityType: 'PROGRAM_EXERCISE',
        entityId: seeded.programExercise.id,
        previousTargetSets: 3,
        targetSets: 5,
        changed: true,
      },
    });

    const repeated = await sync(
      jsonRequest('http://test.local/api/mobile/sync', { operations: [operation] }, accessToken),
    );
    expect((await repeated.json()).results[0]).toMatchObject({
      status: 'DUPLICATE',
      result: { previousTargetSets: 3, targetSets: 5, changed: true },
    });

    const saved = await db.programExercise.findUniqueOrThrow({
      where: { id: seeded.programExercise.id },
    });
    expect(saved).toMatchObject({
      targetSets: 5,
      targetRepsMin: seeded.programExercise.targetRepsMin,
      targetRepsMax: seeded.programExercise.targetRepsMax,
      targetRIR: seeded.programExercise.targetRIR,
      restSec: seeded.programExercise.restSec,
    });
  });

  it('rejects stale or foreign planned set updates', async () => {
    const owner = await seedUser('mobile-target-owner@test.dev');
    const stranger = await seedUser('mobile-target-stranger@test.dev');
    const { accessToken } = await loginDevice(owner.user.email);

    const stale = await sync(
      jsonRequest(
        'http://test.local/api/mobile/sync',
        {
          operations: [
            {
              operationId: 'target_sets_stale_01',
              type: 'UPDATE_TARGET_SETS',
              programExerciseId: owner.programExercise.id,
              previousTargetSets: 4,
              targetSets: 5,
            },
          ],
        },
        accessToken,
      ),
    );
    expect((await stale.json()).results[0]).toMatchObject({
      status: 'REJECTED',
      error: expect.stringContaining('changed from 4 to 3'),
    });

    const foreign = await sync(
      jsonRequest(
        'http://test.local/api/mobile/sync',
        {
          operations: [
            {
              operationId: 'target_sets_foreign_01',
              type: 'UPDATE_TARGET_SETS',
              programExerciseId: stranger.programExercise.id,
              previousTargetSets: 3,
              targetSets: 5,
            },
          ],
        },
        accessToken,
      ),
    );
    expect((await foreign.json()).results[0]).toMatchObject({
      status: 'REJECTED',
      error: 'Program exercise not found.',
    });
    expect(
      (await db.programExercise.findUniqueOrThrow({ where: { id: owner.programExercise.id } }))
        .targetSets,
    ).toBe(3);
    expect(
      (await db.programExercise.findUniqueOrThrow({ where: { id: stranger.programExercise.id } }))
        .targetSets,
    ).toBe(3);
  });

  it('stops an ordered batch after the first rejected operation', async () => {
    const owner = await seedUser('mobile-ordered-owner@test.dev');
    const stranger = await seedUser('mobile-ordered-stranger@test.dev');
    const { accessToken } = await loginDevice(owner.user.email);

    const response = await sync(
      jsonRequest(
        'http://test.local/api/mobile/sync',
        {
          operations: [
            {
              operationId: 'ordered_rejected_01',
              type: 'START_SESSION',
              session: {
                id: 'mob_session_rejected',
                workoutId: stranger.workout.id,
                gymId: stranger.gym.id,
                startedAt: '2026-07-13T10:00:00.000Z',
              },
            },
            {
              operationId: 'ordered_not_applied_02',
              type: 'START_SESSION',
              session: {
                id: 'mob_session_not_applied',
                workoutId: owner.workout.id,
                gymId: owner.gym.id,
                startedAt: '2026-07-13T11:00:00.000Z',
              },
            },
          ],
        },
        accessToken,
      ),
    );
    const body = await response.json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toMatchObject({
      operationId: 'ordered_rejected_01',
      status: 'REJECTED',
    });
    expect(await db.session.count({ where: { id: 'mob_session_not_applied' } })).toBe(0);
  });

  it('classifies concurrent retries as applied plus duplicate', async () => {
    const seeded = await seedUser('mobile-concurrent@test.dev');
    const { accessToken } = await loginDevice(seeded.user.email);
    const operation = {
      operationId: 'concurrent_start_0001',
      type: 'START_SESSION',
      session: {
        id: 'mob_session_concurrent',
        workoutId: seeded.workout.id,
        gymId: seeded.gym.id,
        startedAt: '2026-07-13T10:00:00.000Z',
      },
    };

    const responses = await Promise.all(
      [1, 2].map(() =>
        sync(
          jsonRequest(
            'http://test.local/api/mobile/sync',
            { operations: [operation] },
            accessToken,
          ),
        ),
      ),
    );
    const statuses = await Promise.all(
      responses.map(async (response) => (await response.json()).results[0].status as string),
    );

    expect(statuses.sort()).toEqual(['APPLIED', 'DUPLICATE']);
    expect(await db.session.count({ where: { id: operation.session.id } })).toBe(1);
  });
});
