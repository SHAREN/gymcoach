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
    expect(fractional.rir).toBeNull();
    expect(fractional.notes).toContain('Reported RIR 0.5');
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
