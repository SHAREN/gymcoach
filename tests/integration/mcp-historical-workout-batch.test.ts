import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { createGymCoachMcpServer } from '@/lib/mcp/server';

const clients: Client[] = [];
const servers: Array<ReturnType<typeof createGymCoachMcpServer>> = [];

async function connect(userId: string) {
  const server = createGymCoachMcpServer({
    principal: { tokenId: '[REDACTED_SECRET]', userId, canWrite: true },
    baseUrl: 'https://gymcoach.example',
  });
  const client = new Client({ name: 'batch-import-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  clients.push(client);
  servers.push(server);
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

afterEach(async () => {
  await Promise.allSettled(clients.splice(0).map((client) => client.close()));
  await Promise.allSettled(servers.splice(0).map((server) => server.close()));
});

describe('GymCoach MCP historical workout batch', () => {
  it('previews human names without writes, then atomically imports the batch', async () => {
    const user = await db.user.create({
      data: { email: 'mcp-batch-import@test.dev', passwordHash: 'x' },
    });
    const bench = await db.exercise.create({
      data: {
        userId: user.id,
        name: 'Bench Press',
        muscleGroup: 'CHEST',
        category: 'COMPOUND',
        equipmentType: 'BARBELL',
      },
    });
    const curl = await db.exercise.create({
      data: {
        userId: user.id,
        name: 'Reverse Curls · EZ bar',
        muscleGroup: 'BICEPS',
        category: 'ISOLATION',
        equipmentType: 'BARBELL',
      },
    });
    const gym = await db.gym.create({
      data: { userId: user.id, name: 'X-Fit', inventoryMode: 'EQUIPMENT_FIRST' },
    });
    const machine = await db.gymEquipment.create({
      data: {
        gymId: gym.id,
        name: 'Hammer верхняя тяга',
        equipmentType: 'MACHINE',
        loadType: 'FIXED',
        weightOptions: [15, 25],
        exerciseLinks: { create: { exerciseId: bench.id } },
      },
    });
    const client = await connect(user.id);
    const workouts = [
      {
        importId: 'batch-2026-08-09-v1',
        startedAt: '2026-08-09T12:00:00+05:00',
        gym: { name: 'X-Fit' },
        exercises: [
          {
            exercise: { name: 'Жим лёжа' },
            sets: [{ weightKg: 70, reps: 10, rir: 1 }],
          },
          {
            exercise: { name: 'Подъём на бицепс обратным хватом' },
            sets: [{ weightKg: 31, reps: 9, rir: 0.5, isDropSet: true }],
          },
        ],
      },
      {
        importId: 'batch-2026-08-13-v1',
        startedAt: '2026-08-13T12:00:00+05:00',
        gym: { name: 'X-Fit' },
        exercises: [
          {
            exercise: { id: bench.id },
            sets: [
              {
                weightKg: 15,
                reps: 17,
                rir: 4,
                equipment: { name: 'Hammer верхняя тяга' },
              },
            ],
          },
        ],
      },
    ];

    const preview = await client.callTool({
      name: 'preview_historical_workout_import',
      arguments: { workouts },
    });
    expect(preview.isError).not.toBe(true);
    expect(preview.structuredContent).toMatchObject({
      status: 'READY',
      workoutCount: 2,
      issues: [],
    });
    expect(await db.session.count({ where: { userId: user.id } })).toBe(0);

    const imported = await client.callTool({
      name: 'import_historical_workouts',
      arguments: { confirmed: true, atomic: true, workouts },
    });
    expect(imported.isError).not.toBe(true);
    expect(imported.structuredContent).toMatchObject({
      ok: true,
      status: 'IMPORTED',
      atomic: true,
      imported: 2,
      failed: 0,
    });
    expect(await db.session.count({ where: { userId: user.id } })).toBe(2);
    expect(await db.set.count({ where: { session: { userId: user.id } } })).toBe(3);
    const equipmentSet = await db.set.findFirstOrThrow({
      where: { gymEquipmentId: machine.id },
    });
    expect(equipmentSet).toMatchObject({ weight: 15, reps: 17, gymEquipmentId: machine.id });
    const fractional = await db.set.findFirstOrThrow({
      where: { exerciseId: curl.id },
    });
    expect(fractional.rir).toBe(0.5);
  });

  it('preserves date-only precision, unknown reps, load basis and learns explicit aliases', async () => {
    const user = await db.user.create({
      data: { email: 'mcp-batch-p1-semantics@test.dev', passwordHash: 'x' },
    });
    const exercise = await db.exercise.create({
      data: {
        userId: user.id,
        name: 'Single-arm Hammer Row',
        muscleGroup: 'BACK_THICKNESS',
        category: 'COMPOUND',
        equipmentType: 'MACHINE',
      },
    });
    const gym = await db.gym.create({
      data: { userId: user.id, name: 'X-Fit', inventoryMode: 'EQUIPMENT_FIRST' },
    });
    const machine = await db.gymEquipment.create({
      data: {
        gymId: gym.id,
        name: 'Hammer Row Station',
        equipmentType: 'MACHINE',
        loadType: 'FIXED',
        exerciseLinks: { create: { exerciseId: exercise.id } },
      },
    });
    const client = await connect(user.id);
    const workout = {
      importId: 'p1-date-only-unknown-reps-v1',
      startedAt: '2026-08-20',
      gym: { id: gym.id },
      exercises: [
        {
          exercise: { id: exercise.id, alias: 'Хаммер на спину' },
          sets: [
            {
              weightKg: 35,
              reps: null,
              loadBasis: 'PER_HAND',
              equipment: { id: machine.id, alias: 'Хаммер спина' },
            },
          ],
        },
      ],
    } as const;

    const imported = await client.callTool({
      name: 'import_historical_workouts',
      arguments: { confirmed: true, atomic: true, workouts: [workout] },
    });
    expect(imported.isError).not.toBe(true);
    expect(imported.structuredContent).toMatchObject({
      ok: true,
      workouts: [
        expect.objectContaining({
          date: '2026-08-20',
          timePrecision: 'DATE_ONLY',
          startedAt: null,
          finishedAt: null,
          exercises: [
            expect.objectContaining({
              sets: [expect.objectContaining({ reps: null, loadBasis: 'PER_HAND' })],
            }),
          ],
        }),
      ],
    });

    const stored = await db.session.findFirstOrThrow({
      where: { userId: user.id },
      include: { sets: true },
    });
    expect(stored.timePrecision).toBe('DATE_ONLY');
    expect(stored.historicalDate?.toISOString().slice(0, 10)).toBe('2026-08-20');
    expect(stored.sets[0]).toMatchObject({ reps: 0, repsKnown: false, loadBasis: 'PER_HAND' });

    const resolved = await client.callTool({
      name: 'resolve_entities',
      arguments: {
        gymId: gym.id,
        exercises: ['Хаммер на спину'],
        equipment: ['Хаммер спина'],
      },
    });
    expect(resolved.structuredContent).toMatchObject({
      status: 'READY',
      exercises: [expect.objectContaining({ selected: expect.objectContaining({ id: exercise.id }) })],
      equipment: [expect.objectContaining({ selected: expect.objectContaining({ id: machine.id }) })],
    });

    const queried = await client.callTool({
      name: 'get_workouts',
      arguments: { dates: ['2026-08-20'] },
    });
    expect(queried.structuredContent).toMatchObject({
      status: 'READY',
      workouts: [
        expect.objectContaining({
          date: '2026-08-20',
          timePrecision: 'DATE_ONLY',
          startedAt: null,
          finishedAt: null,
          durationMin: null,
          exercises: [
            expect.objectContaining({
              sets: [expect.objectContaining({ reps: null, repsKnown: false, loadBasis: 'PER_HAND' })],
            }),
          ],
        }),
      ],
    });
  });

  it('reconciles cleanup deletes and replacement imports atomically', async () => {
    const user = await db.user.create({
      data: { email: 'mcp-reconcile-atomic@test.dev', passwordHash: 'x' },
    });
    const bench = await db.exercise.create({
      data: {
        userId: user.id,
        name: 'Bench Press',
        muscleGroup: 'CHEST',
        category: 'COMPOUND',
        equipmentType: 'BARBELL',
      },
    });
    const gym = await db.gym.create({ data: { userId: user.id, name: 'X-Fit' } });
    const stale = await db.session.create({
      data: {
        userId: user.id,
        gymId: gym.id,
        startedAt: new Date('2026-08-21T08:00:00.000Z'),
        finishedAt: new Date('2026-08-23T08:00:00.000Z'),
        sets: {
          create: {
            exerciseId: bench.id,
            setNumber: 1,
            weight: 60,
            reps: 10,
            repsKnown: true,
            loadBasis: 'TOTAL',
          },
        },
      },
    });
    const client = await connect(user.id);

    const result = await client.callTool({
      name: 'reconcile_historical_workouts',
      arguments: {
        confirmed: true,
        reason: 'Replace stale multi-day session with handwritten historical facts.',
        deleteSessionIds: [stale.id],
        workouts: [
          {
            importId: 'reconcile-2026-08-21-v1',
            startedAt: '2026-08-21',
            gym: { name: 'X-Fit' },
            exercises: [
              {
                exercise: { name: 'Жим лёжа' },
                sets: [{ weightKg: 70, reps: 10, rir: 1 }],
              },
            ],
          },
        ],
      },
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      ok: true,
      status: 'RECONCILED',
      recoverable: true,
      deletedCount: 1,
      importedCount: 1,
      deleted: [expect.objectContaining({ sessionId: stale.id })],
      workouts: [expect.objectContaining({ date: '2026-08-21', timePrecision: 'DATE_ONLY' })],
    });
    const operationId = (result.structuredContent as { operationId: string }).operationId;
    expect(operationId).toBeTruthy();
    const replacementSessionId = (
      result.structuredContent as { workouts: Array<{ sessionId: string }> }
    ).workouts[0]!.sessionId;
    expect(await db.session.findUnique({ where: { id: stale.id } })).toBeNull();
    expect(await db.session.count({ where: { userId: user.id } })).toBe(1);

    const audit = await client.callTool({
      name: 'get_operation_audit',
      arguments: { operationId },
    });
    expect(audit.structuredContent).toMatchObject({
      ok: true,
      operationId,
      operation: 'reconcile_historical_workouts',
      canUndo: true,
    });

    const undone = await client.callTool({
      name: 'undo_operation',
      arguments: { confirmed: true, operationId },
    });
    expect(undone.structuredContent).toMatchObject({
      ok: true,
      status: 'UNDONE',
      operationId,
      restoredSessionIds: [stale.id],
      removedCreatedSessionIds: [replacementSessionId],
    });
    const restored = await db.session.findUnique({
      where: { id: stale.id },
      include: { sets: true, exerciseMemberships: true },
    });
    expect(restored).not.toBeNull();
    expect(restored?.sets).toHaveLength(1);
    expect(restored?.sets[0]).toMatchObject({ weight: 60, reps: 10, exerciseId: bench.id });
    expect(restored?.exerciseMemberships).toHaveLength(1);
    expect(await db.session.findUnique({ where: { id: replacementSessionId } })).toBeNull();

    const secondUndo = await client.callTool({
      name: 'undo_operation',
      arguments: { confirmed: true, operationId },
    });
    expect(secondUndo.structuredContent).toMatchObject({
      ok: true,
      status: 'ALREADY_UNDONE',
      operationId,
    });
  });

  it('rolls back cleanup deletion when the replacement import fails', async () => {
    const user = await db.user.create({
      data: { email: 'mcp-reconcile-rollback@test.dev', passwordHash: 'x' },
    });
    const bench = await db.exercise.create({
      data: {
        userId: user.id,
        name: 'Bench Press',
        muscleGroup: 'CHEST',
        category: 'COMPOUND',
        equipmentType: 'BARBELL',
      },
    });
    const gym = await db.gym.create({ data: { userId: user.id, name: 'X-Fit' } });
    const stale = await db.session.create({
      data: {
        userId: user.id,
        gymId: gym.id,
        startedAt: new Date('2026-08-22T08:00:00.000Z'),
        finishedAt: new Date('2026-08-24T08:00:00.000Z'),
      },
    });
    const client = await connect(user.id);
    const seeded = await client.callTool({
      name: 'import_historical_workout',
      arguments: {
        confirmed: true,
        importId: 'reconcile-conflict-v1',
        startedAt: '2026-08-22T12:00:00+05:00',
        gymId: gym.id,
        exercises: [{ exerciseId: bench.id, sets: [{ weightKg: 70, reps: 10 }] }],
      },
    });
    expect(seeded.isError).not.toBe(true);

    const failed = await client.callTool({
      name: 'reconcile_historical_workouts',
      arguments: {
        confirmed: true,
        deleteSessionIds: [stale.id],
        workouts: [
          {
            importId: 'reconcile-conflict-v1',
            startedAt: '2026-08-22T12:00:00+05:00',
            gym: { id: gym.id },
            exercises: [
              {
                exercise: { id: bench.id },
                sets: [{ weightKg: 80, reps: 10 }],
              },
            ],
          },
        ],
      },
    });
    expect(failed.isError).not.toBe(true);
    expect(failed.structuredContent).toMatchObject({
      ok: false,
      status: 'ROLLED_BACK',
      deletedCount: 0,
      importedCount: 0,
      issues: [expect.objectContaining({ errorCode: 'IMPORT_ID_CONFLICT' })],
    });
    expect(await db.session.findUnique({ where: { id: stale.id } })).not.toBeNull();
  });

  it('rolls back all new workouts when a later importId conflicts', async () => {
    const user = await db.user.create({
      data: { email: 'mcp-batch-rollback@test.dev', passwordHash: 'x' },
    });
    const bench = await db.exercise.create({
      data: {
        userId: user.id,
        name: 'Bench Press',
        muscleGroup: 'CHEST',
        category: 'COMPOUND',
        equipmentType: 'BARBELL',
      },
    });
    const gym = await db.gym.create({ data: { userId: user.id, name: 'X-Fit' } });
    const client = await connect(user.id);
    const seeded = await client.callTool({
      name: 'import_historical_workout',
      arguments: {
        confirmed: true,
        importId: 'existing-conflict-v1',
        startedAt: '2026-08-13T12:00:00+05:00',
        gymId: gym.id,
        exercises: [{ exerciseId: bench.id, sets: [{ weightKg: 70, reps: 10, rir: 1 }] }],
      },
    });
    expect(seeded.isError).not.toBe(true);
    const before = await db.session.count({ where: { userId: user.id } });

    const batch = await client.callTool({
      name: 'import_historical_workouts',
      arguments: {
        confirmed: true,
        atomic: true,
        workouts: [
          {
            importId: 'new-before-conflict-v1',
            startedAt: '2026-08-09T12:00:00+05:00',
            gym: { name: 'X-Fit' },
            exercises: [{ exercise: { name: 'Жим лёжа' }, sets: [{ weightKg: 65, reps: 10, rir: 1 }] }],
          },
          {
            importId: 'existing-conflict-v1',
            startedAt: '2026-08-13T12:00:00+05:00',
            gym: { name: 'X-Fit' },
            exercises: [{ exercise: { name: 'Жим лёжа' }, sets: [{ weightKg: 72.5, reps: 10, rir: 1 }] }],
          },
        ],
      },
    });
    expect(batch.isError).not.toBe(true);
    expect(batch.structuredContent).toMatchObject({
      ok: false,
      status: 'ROLLED_BACK',
      atomic: true,
      imported: 0,
      issues: [expect.objectContaining({ errorCode: 'IMPORT_ID_CONFLICT' })],
    });
    expect(await db.session.count({ where: { userId: user.id } })).toBe(before);
  });
});
