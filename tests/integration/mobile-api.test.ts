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
  const request = jsonRequest('http://test.local/api/mobile/auth/login', {
    email,
    password,
    deviceId: `device_${email}`,
    deviceName: 'Integration phone',
  });
  request.headers.set('x-forwarded-for', `integration-${email}`);
  const response = await login(request);
  expect(response.status).toBe(200);
  return (await response.json()) as { accessToken: string };
}

interface BootstrapEquipment {
  id: string;
  gymId: string;
  name: string;
  equipmentType: string;
  loadType: string;
  selectedLoadMultiplier: number;
  baseLoadKg: number;
  loadingSides: number;
  weightOptions: number[];
  snapshotRevisionId: string;
  platePool: {
    id: string;
    name: string;
    compatibilityKey: string;
    plates: { weightKg: number; quantity: number | null }[];
  } | null;
}

async function getMobileBootstrap(accessToken: string) {
  const response = await bootstrap(
    new Request('http://test.local/api/mobile/bootstrap', {
      headers: { Authorization: `Bearer ${accessToken}` },
    }),
  );
  expect(response.status).toBe(200);
  return (await response.json()) as {
    schemaVersion: number;
    gyms: { id: string; equipment: BootstrapEquipment[] }[];
  };
}

function frozenSnapshot(equipment: BootstrapEquipment, selectedLoadKg: number) {
  const nominalResistanceKg =
    equipment.loadType === 'SELECTORIZED'
      ? Math.round(selectedLoadKg * equipment.selectedLoadMultiplier * 100) / 100
      : null;
  return {
    equipmentNameSnapshot: equipment.name,
    selectedLoadKg,
    selectedLoadMultiplierSnapshot: equipment.selectedLoadMultiplier,
    nominalResistanceKg,
    equipmentLoadSnapshot: {
      version: 2,
      revisionId: equipment.snapshotRevisionId,
      gymEquipmentId: equipment.id,
      loadType: equipment.loadType,
      equipmentType: equipment.equipmentType,
      selectedLoadKg,
      selectedLoadMultiplier: equipment.selectedLoadMultiplier,
      nominalResistanceKg,
      baseLoadKg: equipment.baseLoadKg,
      loadingSides: equipment.loadingSides,
      weightOptions: equipment.weightOptions,
      platePool: equipment.platePool
        ? {
            id: equipment.platePool.id,
            name: equipment.platePool.name,
            compatibilityKey: equipment.platePool.compatibilityKey,
            plates: equipment.platePool.plates.map((plate) => ({
              weightKg: plate.weightKg,
              quantity: plate.quantity,
            })),
          }
        : null,
    },
  };
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
      schemaVersion: 3,
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
          snapshotRevisionId: expect.any(String),
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
    const bootstrapBody = await getMobileBootstrap(accessToken);
    const equipmentRevision = bootstrapBody.gyms
      .flatMap((gym) => gym.equipment)
      .find((item) => item.id === seeded.equipment.id)!;
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

    const frozenRewrite = await sync(
      jsonRequest(
        'http://test.local/api/mobile/sync',
        {
          operations: [
            {
              operationId: 'identity_frozen_rewrite',
              type: 'UPSERT_SET',
              set: {
                id: setId,
                sessionId: originalSessionId,
                exerciseId: seeded.exercise.id,
                gymEquipmentId: seeded.equipment.id,
                frozenEquipmentSnapshot: frozenSnapshot(equipmentRevision, 90),
                setNumber: 1,
                weight: 90,
                reps: 8,
                rir: 1,
                isWarmup: false,
                isDropSet: false,
                completedAt: '2026-07-14T10:08:00.000Z',
              },
            },
          ],
        },
        accessToken,
      ),
    );
    expect((await frozenRewrite.json()).results[0]).toMatchObject({
      status: 'REJECTED',
      error: 'Frozen equipment snapshots are accepted only for new sets.',
    });
    expect(await db.set.findUniqueOrThrow({ where: { id: setId } })).toMatchObject({
      weight: 85,
      reps: 9,
      equipmentNameSnapshot: 'Bench station',
    });
  });

  it('persists the client-frozen snapshot after equipment changes before first sync', async () => {
    const seeded = await seedUser('mobile-frozen-mutation@test.dev');
    const { accessToken } = await loginDevice(seeded.user.email);
    const bootstrapBody = await getMobileBootstrap(accessToken);
    const equipment = bootstrapBody.gyms
      .flatMap((gym) => gym.equipment)
      .find((item) => item.id === seeded.equipment.id)!;
    const snapshot = frozenSnapshot(equipment, 80);

    await db.gymEquipment.update({
      where: { id: equipment.id },
      data: {
        name: 'Changed after offline bootstrap',
        baseLoadKg: 99,
        loadingSides: 1,
        selectedLoadMultiplier: 1.5,
      },
    });
    const refreshedEquipment = (await getMobileBootstrap(accessToken)).gyms
      .flatMap((gym) => gym.equipment)
      .find((item) => item.id === seeded.equipment.id)!;
    expect(refreshedEquipment.snapshotRevisionId).not.toBe(equipment.snapshotRevisionId);

    const response = await sync(
      jsonRequest(
        'http://test.local/api/mobile/sync',
        {
          operations: [
            {
              operationId: 'frozen_mutation_start',
              type: 'START_SESSION',
              session: {
                id: 'frozen_mutation_session',
                workoutId: seeded.workout.id,
                gymId: seeded.gym.id,
                startedAt: '2026-07-15T10:00:00.000Z',
              },
            },
            {
              operationId: 'frozen_mutation_set',
              type: 'UPSERT_SET',
              set: {
                id: 'frozen_mutation_set_0001',
                sessionId: 'frozen_mutation_session',
                exerciseId: seeded.exercise.id,
                gymEquipmentId: equipment.id,
                frozenEquipmentSnapshot: snapshot,
                setNumber: 1,
                weight: 80,
                reps: 10,
                rir: 2,
                isWarmup: false,
                isDropSet: false,
                completedAt: '2026-07-15T10:05:00.000Z',
              },
            },
          ],
        },
        accessToken,
      ),
    );
    expect((await response.json()).results.map((item: { status: string }) => item.status)).toEqual([
      'APPLIED',
      'APPLIED',
    ]);
    const savedBeforeDelete = await db.set.findUniqueOrThrow({
      where: { id: 'frozen_mutation_set_0001' },
    });
    expect(savedBeforeDelete).toMatchObject({
      gymEquipmentId: equipment.id,
      equipmentNameSnapshot: 'Bench station',
      selectedLoadKg: 80,
      selectedLoadMultiplierSnapshot: 1,
      nominalResistanceKg: null,
    });
    expect(savedBeforeDelete.equipmentLoadSnapshot).toEqual(snapshot.equipmentLoadSnapshot);

    await db.gymEquipment.delete({ where: { id: equipment.id } });
    const savedAfterDelete = await db.set.findUniqueOrThrow({
      where: { id: 'frozen_mutation_set_0001' },
    });
    expect(savedAfterDelete).toMatchObject({
      gymEquipmentId: null,
      equipmentNameSnapshot: 'Bench station',
    });
    expect(savedAfterDelete.equipmentLoadSnapshot).toEqual(snapshot.equipmentLoadSnapshot);
  });

  it('keeps existing-set equipment immutable unless REPLACE or CLEAR is explicit', async () => {
    const seeded = await seedUser('mobile-equipment-actions@test.dev');
    const replacement = await db.gymEquipment.create({
      data: {
        gymId: seeded.gym.id,
        name: 'Replacement bench',
        equipmentType: 'BARBELL',
        loadType: 'PLATE_LOADED',
        baseLoadKg: 25,
        platePoolId: seeded.equipment.platePoolId,
        loadingSides: 2,
        exerciseLinks: { create: { exerciseId: seeded.exercise.id } },
      },
    });
    const { accessToken } = await loginDevice(seeded.user.email);
    const sessionId = 'equipment_action_session';
    const setId = 'equipment_action_set_0001';
    const initial = await sync(
      jsonRequest(
        'http://test.local/api/mobile/sync',
        {
          operations: [
            {
              operationId: 'equipment_action_start',
              type: 'START_SESSION',
              session: {
                id: sessionId,
                workoutId: seeded.workout.id,
                gymId: seeded.gym.id,
                startedAt: '2026-07-15T10:20:00.000Z',
              },
            },
            {
              operationId: 'equipment_action_initial_set',
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
                isWarmup: false,
                isDropSet: false,
                completedAt: '2026-07-15T10:25:00.000Z',
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
    ]);

    const implicitChange = await sync(
      jsonRequest(
        'http://test.local/api/mobile/sync',
        {
          operations: [
            {
              operationId: 'equipment_action_implicit',
              type: 'UPSERT_SET',
              set: {
                id: setId,
                sessionId,
                exerciseId: seeded.exercise.id,
                gymEquipmentId: replacement.id,
                setNumber: 1,
                weight: 85,
                reps: 9,
                rir: 2,
                isWarmup: false,
                isDropSet: false,
                completedAt: '2026-07-15T10:26:00.000Z',
              },
            },
          ],
        },
        accessToken,
      ),
    );
    expect((await implicitChange.json()).results[0]).toMatchObject({
      status: 'REJECTED',
      error: 'Changing set equipment requires equipmentSnapshotAction REPLACE or CLEAR.',
    });

    const replaced = await sync(
      jsonRequest(
        'http://test.local/api/mobile/sync',
        {
          operations: [
            {
              operationId: 'equipment_action_replace',
              type: 'UPSERT_SET',
              set: {
                id: setId,
                sessionId,
                exerciseId: seeded.exercise.id,
                gymEquipmentId: replacement.id,
                equipmentSnapshotAction: 'REPLACE',
                setNumber: 1,
                weight: 85,
                reps: 9,
                rir: 2,
                isWarmup: false,
                isDropSet: false,
                completedAt: '2026-07-15T10:27:00.000Z',
              },
            },
          ],
        },
        accessToken,
      ),
    );
    expect((await replaced.json()).results[0]).toMatchObject({ status: 'APPLIED' });
    expect(await db.set.findUniqueOrThrow({ where: { id: setId } })).toMatchObject({
      gymEquipmentId: replacement.id,
      equipmentNameSnapshot: 'Replacement bench',
      selectedLoadKg: 85,
    });

    const cleared = await sync(
      jsonRequest(
        'http://test.local/api/mobile/sync',
        {
          operations: [
            {
              operationId: 'equipment_action_clear',
              type: 'UPSERT_SET',
              set: {
                id: setId,
                sessionId,
                exerciseId: seeded.exercise.id,
                gymEquipmentId: null,
                equipmentSnapshotAction: 'CLEAR',
                setNumber: 1,
                weight: 85,
                reps: 9,
                rir: 2,
                isWarmup: false,
                isDropSet: false,
                completedAt: '2026-07-15T10:28:00.000Z',
              },
            },
          ],
        },
        accessToken,
      ),
    );
    expect((await cleared.json()).results[0]).toMatchObject({ status: 'APPLIED' });
    expect(await db.set.findUniqueOrThrow({ where: { id: setId } })).toMatchObject({
      gymEquipmentId: null,
      equipmentNameSnapshot: null,
      selectedLoadKg: null,
      selectedLoadMultiplierSnapshot: null,
      equipmentLoadSnapshot: null,
    });
  });

  it('persists exact historical identity after equipment deletion before first sync', async () => {
    const seeded = await seedUser('mobile-frozen-deletion@test.dev');
    const { accessToken } = await loginDevice(seeded.user.email);
    const bootstrapBody = await getMobileBootstrap(accessToken);
    const equipment = bootstrapBody.gyms
      .flatMap((gym) => gym.equipment)
      .find((item) => item.id === seeded.equipment.id)!;
    const snapshot = frozenSnapshot(equipment, 80);
    await db.gymEquipment.delete({ where: { id: equipment.id } });

    const response = await sync(
      jsonRequest(
        'http://test.local/api/mobile/sync',
        {
          operations: [
            {
              operationId: 'frozen_deletion_start',
              type: 'START_SESSION',
              session: {
                id: 'frozen_deletion_session',
                workoutId: seeded.workout.id,
                gymId: seeded.gym.id,
                startedAt: '2026-07-15T11:00:00.000Z',
              },
            },
            {
              operationId: 'frozen_deletion_set',
              type: 'UPSERT_SET',
              set: {
                id: 'frozen_deletion_set_0001',
                sessionId: 'frozen_deletion_session',
                exerciseId: seeded.exercise.id,
                gymEquipmentId: equipment.id,
                frozenEquipmentSnapshot: snapshot,
                setNumber: 1,
                weight: 80,
                reps: 10,
                rir: 2,
                isWarmup: false,
                isDropSet: false,
                completedAt: '2026-07-15T11:05:00.000Z',
              },
            },
          ],
        },
        accessToken,
      ),
    );
    expect((await response.json()).results.map((item: { status: string }) => item.status)).toEqual([
      'APPLIED',
      'APPLIED',
    ]);
    const saved = await db.set.findUniqueOrThrow({
      where: { id: 'frozen_deletion_set_0001' },
    });
    expect(saved).toMatchObject({
      gymEquipmentId: null,
      equipmentNameSnapshot: 'Bench station',
      selectedLoadKg: 80,
      selectedLoadMultiplierSnapshot: 1,
    });
    expect(saved.equipmentLoadSnapshot).toEqual(snapshot.equipmentLoadSnapshot);
  });

  it('preserves non-unit selector multiplier precision in a valid frozen snapshot', async () => {
    const seeded = await seedUser('mobile-frozen-precision@test.dev');
    const selector = await db.gymEquipment.create({
      data: {
        gymId: seeded.gym.id,
        name: 'Precision cable',
        equipmentType: 'CABLE',
        loadType: 'SELECTORIZED',
        weightOptions: [20],
        selectedLoadMultiplier: 0.005,
        loadingSides: 1,
        exerciseLinks: { create: { exerciseId: seeded.exercise.id } },
      },
    });
    const { accessToken } = await loginDevice(seeded.user.email);
    const equipment = (await getMobileBootstrap(accessToken)).gyms
      .flatMap((gym) => gym.equipment)
      .find((item) => item.id === selector.id)!;
    const snapshot = frozenSnapshot(equipment, 20);

    const response = await sync(
      jsonRequest(
        'http://test.local/api/mobile/sync',
        {
          operations: [
            {
              operationId: 'frozen_precision_start',
              type: 'START_SESSION',
              session: {
                id: 'frozen_precision_session',
                workoutId: seeded.workout.id,
                gymId: seeded.gym.id,
                startedAt: '2026-07-15T11:30:00.000Z',
              },
            },
            {
              operationId: 'frozen_precision_set',
              type: 'UPSERT_SET',
              set: {
                id: 'frozen_precision_set_0001',
                sessionId: 'frozen_precision_session',
                exerciseId: seeded.exercise.id,
                gymEquipmentId: selector.id,
                frozenEquipmentSnapshot: snapshot,
                setNumber: 1,
                weight: 20,
                reps: 10,
                rir: 2,
                isWarmup: false,
                isDropSet: false,
                completedAt: '2026-07-15T11:35:00.000Z',
              },
            },
          ],
        },
        accessToken,
      ),
    );
    expect((await response.json()).results.map((item: { status: string }) => item.status)).toEqual([
      'APPLIED',
      'APPLIED',
    ]);
    const saved = await db.set.findUniqueOrThrow({ where: { id: 'frozen_precision_set_0001' } });
    expect(saved).toMatchObject({
      selectedLoadMultiplierSnapshot: 0.005,
      nominalResistanceKg: 0.1,
    });
    expect(saved.equipmentLoadSnapshot).toEqual(snapshot.equipmentLoadSnapshot);
  });

  it('rejects frozen selector and plate loads that are not attainable', async () => {
    const seeded = await seedUser('mobile-frozen-loads@test.dev');
    const selector = await db.gymEquipment.create({
      data: {
        gymId: seeded.gym.id,
        name: 'Discrete cable',
        equipmentType: 'CABLE',
        loadType: 'SELECTORIZED',
        weightOptions: [40, 45, 50],
        selectedLoadMultiplier: 0.5,
        loadingSides: 1,
        exerciseLinks: { create: { exerciseId: seeded.exercise.id } },
      },
    });
    const { accessToken } = await loginDevice(seeded.user.email);
    const equipment = (await getMobileBootstrap(accessToken)).gyms.flatMap((gym) => gym.equipment);
    const plateLoaded = equipment.find((item) => item.id === seeded.equipment.id)!;
    const selectorized = equipment.find((item) => item.id === selector.id)!;

    const start = await sync(
      jsonRequest(
        'http://test.local/api/mobile/sync',
        {
          operations: [
            {
              operationId: 'frozen_load_start',
              type: 'START_SESSION',
              session: {
                id: 'frozen_load_session',
                workoutId: seeded.workout.id,
                gymId: seeded.gym.id,
                startedAt: '2026-07-15T11:40:00.000Z',
              },
            },
          ],
        },
        accessToken,
      ),
    );
    expect((await start.json()).results[0]).toMatchObject({ status: 'APPLIED' });

    for (const [index, attempt] of [
      { equipment: selectorized, selectedLoadKg: 47.33 },
      { equipment: plateLoaded, selectedLoadKg: 35 },
    ].entries()) {
      const response = await sync(
        jsonRequest(
          'http://test.local/api/mobile/sync',
          {
            operations: [
              {
                operationId: `frozen_impossible_load_${index}`,
                type: 'UPSERT_SET',
                set: {
                  id: `frozen_impossible_set_${index}`,
                  sessionId: 'frozen_load_session',
                  exerciseId: seeded.exercise.id,
                  gymEquipmentId: attempt.equipment.id,
                  frozenEquipmentSnapshot: frozenSnapshot(
                    attempt.equipment,
                    attempt.selectedLoadKg,
                  ),
                  setNumber: index + 1,
                  weight: attempt.selectedLoadKg,
                  reps: 10,
                  rir: 2,
                  isWarmup: false,
                  isDropSet: false,
                  completedAt: `2026-07-15T11:4${index + 1}:00.000Z`,
                },
              },
            ],
          },
          accessToken,
        ),
      );
      expect((await response.json()).results[0]).toMatchObject({
        status: 'REJECTED',
        error: 'Frozen equipment snapshot is invalid for this session and exercise.',
      });
    }
  });

  it('rejects a frozen snapshot after the entire session gym is deleted', async () => {
    const seeded = await seedUser('mobile-frozen-gym-delete@test.dev');
    const { accessToken } = await loginDevice(seeded.user.email);
    const equipment = (await getMobileBootstrap(accessToken)).gyms
      .flatMap((gym) => gym.equipment)
      .find((item) => item.id === seeded.equipment.id)!;
    const start = await sync(
      jsonRequest(
        'http://test.local/api/mobile/sync',
        {
          operations: [
            {
              operationId: 'frozen_gym_delete_start',
              type: 'START_SESSION',
              session: {
                id: 'frozen_gym_delete_session',
                workoutId: seeded.workout.id,
                gymId: seeded.gym.id,
                startedAt: '2026-07-15T11:50:00.000Z',
              },
            },
          ],
        },
        accessToken,
      ),
    );
    expect((await start.json()).results[0]).toMatchObject({ status: 'APPLIED' });
    await db.gym.delete({ where: { id: seeded.gym.id } });

    const response = await sync(
      jsonRequest(
        'http://test.local/api/mobile/sync',
        {
          operations: [
            {
              operationId: 'frozen_gym_delete_set',
              type: 'UPSERT_SET',
              set: {
                id: 'frozen_gym_delete_set_0001',
                sessionId: 'frozen_gym_delete_session',
                exerciseId: seeded.exercise.id,
                gymEquipmentId: equipment.id,
                frozenEquipmentSnapshot: frozenSnapshot(equipment, 80),
                setNumber: 1,
                weight: 80,
                reps: 10,
                rir: 2,
                isWarmup: false,
                isDropSet: false,
                completedAt: '2026-07-15T11:55:00.000Z',
              },
            },
          ],
        },
        accessToken,
      ),
    );
    expect((await response.json()).results[0]).toMatchObject({
      status: 'REJECTED',
      error: 'Frozen equipment snapshot is invalid for this session and exercise.',
    });
  });

  it('rejects forged frozen snapshots across users, gyms, exercises, and config fields', async () => {
    const owner = await seedUser('mobile-frozen-owner@test.dev');
    const stranger = await seedUser('mobile-frozen-stranger@test.dev');
    const otherExercise = await db.exercise.create({
      data: {
        userId: owner.user.id,
        name: 'Owner cable row',
        muscleGroup: 'BACK_THICKNESS',
        category: 'COMPOUND',
        equipmentType: 'CABLE',
      },
    });
    const sameGymEquipment = await db.gymEquipment.create({
      data: {
        gymId: owner.gym.id,
        name: 'Same gym cable',
        equipmentType: 'CABLE',
        loadType: 'SELECTORIZED',
        weightOptions: [10, 20, 30],
        selectedLoadMultiplier: 0.5,
        loadingSides: 1,
        exerciseLinks: { create: { exerciseId: owner.exercise.id } },
      },
    });
    const otherGym = await db.gym.create({
      data: { userId: owner.user.id, name: 'Owner other gym' },
    });
    const otherGymEquipment = await db.gymEquipment.create({
      data: {
        gymId: otherGym.id,
        name: 'Other gym cable',
        equipmentType: 'CABLE',
        loadType: 'SELECTORIZED',
        weightOptions: [10, 20, 30],
        selectedLoadMultiplier: 0.5,
        loadingSides: 1,
        exerciseLinks: { create: { exerciseId: owner.exercise.id } },
      },
    });
    const { accessToken } = await loginDevice(owner.user.email);
    const ownerBootstrap = await getMobileBootstrap(accessToken);
    const { accessToken: strangerToken } = await loginDevice(stranger.user.email);
    const strangerBootstrap = await getMobileBootstrap(strangerToken);
    const ownerEquipment = ownerBootstrap.gyms
      .flatMap((gym) => gym.equipment)
      .find((item) => item.id === owner.equipment.id)!;
    const sameGymRevision = ownerBootstrap.gyms
      .flatMap((gym) => gym.equipment)
      .find((item) => item.id === sameGymEquipment.id)!;
    const crossGymEquipment = ownerBootstrap.gyms
      .flatMap((gym) => gym.equipment)
      .find((item) => item.id === otherGymEquipment.id)!;
    const strangerEquipment = strangerBootstrap.gyms
      .flatMap((gym) => gym.equipment)
      .find((item) => item.id === stranger.equipment.id)!;

    const start = await sync(
      jsonRequest(
        'http://test.local/api/mobile/sync',
        {
          operations: [
            {
              operationId: 'frozen_attack_start',
              type: 'START_SESSION',
              session: {
                id: 'frozen_attack_session',
                workoutId: owner.workout.id,
                gymId: owner.gym.id,
                startedAt: '2026-07-15T12:00:00.000Z',
              },
            },
          ],
        },
        accessToken,
      ),
    );
    expect((await start.json()).results[0]).toMatchObject({ status: 'APPLIED' });

    const attempts = [
      {
        operationId: 'frozen_attack_user',
        exerciseId: owner.exercise.id,
        equipment: strangerEquipment,
        snapshot: frozenSnapshot(strangerEquipment, 80),
      },
      {
        operationId: 'frozen_attack_gym',
        exerciseId: owner.exercise.id,
        equipment: crossGymEquipment,
        snapshot: frozenSnapshot(crossGymEquipment, 20),
      },
      {
        operationId: 'frozen_attack_exercise',
        exerciseId: otherExercise.id,
        equipment: ownerEquipment,
        snapshot: frozenSnapshot(ownerEquipment, 80),
      },
      {
        operationId: 'frozen_attack_config',
        exerciseId: owner.exercise.id,
        equipment: ownerEquipment,
        snapshot: {
          ...frozenSnapshot(ownerEquipment, 80),
          equipmentNameSnapshot: 'Forged equipment name',
        },
      },
      {
        operationId: 'frozen_attack_revision',
        exerciseId: owner.exercise.id,
        equipment: ownerEquipment,
        snapshot: {
          ...frozenSnapshot(ownerEquipment, 80),
          equipmentLoadSnapshot: {
            ...frozenSnapshot(ownerEquipment, 80).equipmentLoadSnapshot,
            revisionId: sameGymRevision.snapshotRevisionId,
          },
        },
      },
      {
        operationId: 'frozen_attack_plates',
        exerciseId: owner.exercise.id,
        equipment: ownerEquipment,
        snapshot: {
          ...frozenSnapshot(ownerEquipment, 80),
          equipmentLoadSnapshot: {
            ...frozenSnapshot(ownerEquipment, 80).equipmentLoadSnapshot,
            platePool: {
              ...frozenSnapshot(ownerEquipment, 80).equipmentLoadSnapshot.platePool!,
              plates: frozenSnapshot(
                ownerEquipment,
                80,
              ).equipmentLoadSnapshot.platePool!.plates.map((plate, plateIndex) =>
                plateIndex === 0 ? { ...plate, quantity: 999 } : plate,
              ),
            },
          },
        },
      },
    ];

    for (const [index, attempt] of attempts.entries()) {
      const response = await sync(
        jsonRequest(
          'http://test.local/api/mobile/sync',
          {
            operations: [
              {
                operationId: attempt.operationId,
                type: 'UPSERT_SET',
                set: {
                  id: `frozen_attack_set_${index}`,
                  sessionId: 'frozen_attack_session',
                  exerciseId: attempt.exerciseId,
                  gymEquipmentId: attempt.equipment.id,
                  frozenEquipmentSnapshot: attempt.snapshot,
                  setNumber: index + 1,
                  weight: attempt.snapshot.selectedLoadKg,
                  reps: 10,
                  rir: 2,
                  isWarmup: false,
                  isDropSet: false,
                  completedAt: `2026-07-15T12:0${index + 1}:00.000Z`,
                },
              },
            ],
          },
          accessToken,
        ),
      );
      expect((await response.json()).results[0]).toMatchObject({
        status: 'REJECTED',
        error: 'Frozen equipment snapshot is invalid for this session and exercise.',
      });
    }
    expect(await db.set.count({ where: { sessionId: 'frozen_attack_session' } })).toBe(0);
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
