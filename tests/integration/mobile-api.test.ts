import bcrypt from 'bcrypt';
import { describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { POST as login } from '@/app/api/mobile/auth/login/route';
import { GET as bootstrap } from '@/app/api/mobile/bootstrap/route';
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
  return { user, exercise, workout: program.workouts[0]!, gym, equipment };
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
      schemaVersion: 2,
      profile: { email: seeded.user.email, activeGymId: seeded.gym.id },
      activeProgram: { name: 'Offline block' },
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

  it('keeps an existing mobile set bound to its original session and exercise', async () => {
    const seeded = await seedUser('mobile-set-identity@test.dev');
    const otherExercise = await db.exercise.create({
      data: {
        userId: seeded.user.id,
        name: 'Cable Row',
        muscleGroup: 'BACK_THICKNESS',
        category: 'COMPOUND',
        equipmentType: 'CABLE',
      },
    });
    const otherGym = await db.gym.create({
      data: { userId: seeded.user.id, name: 'Other gym' },
    });
    const { accessToken } = await loginDevice(seeded.user.email);
    const originalSessionId = 'mob_identity_session_1';
    const otherSessionId = 'mob_identity_session_2';
    const setId = 'mob_identity_set_0001';

    const initial = await sync(
      jsonRequest(
        'http://test.local/api/mobile/sync',
        {
          operations: [
            {
              operationId: 'identity_start_original',
              type: 'START_SESSION',
              session: {
                id: originalSessionId,
                workoutId: seeded.workout.id,
                gymId: seeded.gym.id,
                startedAt: '2026-07-14T10:00:00.000Z',
              },
            },
            {
              operationId: 'identity_set_original',
              type: 'UPSERT_SET',
              set: {
                id: setId,
                sessionId: originalSessionId,
                exerciseId: seeded.exercise.id,
                gymEquipmentId: seeded.equipment.id,
                setNumber: 1,
                weight: 80,
                reps: 10,
                rir: 2,
                isWarmup: false,
                isDropSet: false,
                completedAt: '2026-07-14T10:05:00.000Z',
              },
            },
            {
              operationId: 'identity_start_other',
              type: 'START_SESSION',
              session: {
                id: otherSessionId,
                workoutId: seeded.workout.id,
                gymId: otherGym.id,
                startedAt: '2026-07-14T11:00:00.000Z',
              },
            },
          ],
        },
        accessToken,
      ),
    );
    expect((await initial.json()).results.map((item: { status: string }) => item.status)).toEqual([
      'APPLIED',
      'APPLIED',
      'APPLIED',
    ]);

    const crossSession = await sync(
      jsonRequest(
        'http://test.local/api/mobile/sync',
        {
          operations: [
            {
              operationId: 'identity_cross_session',
              type: 'UPSERT_SET',
              set: {
                id: setId,
                sessionId: otherSessionId,
                exerciseId: seeded.exercise.id,
                setNumber: 1,
                weight: 85,
                reps: 9,
                rir: 2,
                isWarmup: false,
                isDropSet: false,
                completedAt: '2026-07-14T11:05:00.000Z',
              },
            },
          ],
        },
        accessToken,
      ),
    );
    expect((await crossSession.json()).results[0]).toMatchObject({
      status: 'REJECTED',
      error: 'An existing set cannot change its session or exercise.',
    });

    const crossExercise = await sync(
      jsonRequest(
        'http://test.local/api/mobile/sync',
        {
          operations: [
            {
              operationId: 'identity_cross_exercise',
              type: 'UPSERT_SET',
              set: {
                id: setId,
                sessionId: originalSessionId,
                exerciseId: otherExercise.id,
                setNumber: 1,
                weight: 85,
                reps: 9,
                rir: 2,
                isWarmup: false,
                isDropSet: false,
                completedAt: '2026-07-14T10:06:00.000Z',
              },
            },
          ],
        },
        accessToken,
      ),
    );
    expect((await crossExercise.json()).results[0]).toMatchObject({
      status: 'REJECTED',
      error: 'An existing set cannot change its session or exercise.',
    });

    const validUpdate = await sync(
      jsonRequest(
        'http://test.local/api/mobile/sync',
        {
          operations: [
            {
              operationId: 'identity_valid_update',
              type: 'UPSERT_SET',
              set: {
                id: setId,
                sessionId: originalSessionId,
                exerciseId: seeded.exercise.id,
                gymEquipmentId: seeded.equipment.id,
                setNumber: 1,
                weight: 85,
                reps: 9,
                rir: 1,
                isWarmup: false,
                isDropSet: false,
                completedAt: '2026-07-14T10:07:00.000Z',
              },
            },
          ],
        },
        accessToken,
      ),
    );
    expect((await validUpdate.json()).results[0]).toMatchObject({ status: 'APPLIED' });
    expect(await db.set.findUniqueOrThrow({ where: { id: setId } })).toMatchObject({
      sessionId: originalSessionId,
      exerciseId: seeded.exercise.id,
      weight: 85,
      reps: 9,
      gymEquipmentId: seeded.equipment.id,
      equipmentNameSnapshot: 'Bench station',
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
