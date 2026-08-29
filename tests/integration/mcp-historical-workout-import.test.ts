import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { createGymCoachMcpServer } from '@/lib/mcp/server';

const servers: Array<ReturnType<typeof createGymCoachMcpServer>> = [];
const clients: Client[] = [];

async function connect(userId: string, canWrite = true) {
  const server = createGymCoachMcpServer({
    principal: { tokenId: '[REDACTED_SECRET]', userId, canWrite },
    baseUrl: 'https://gymcoach.example',
  });
  const client = new Client({ name: 'historical-import-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  servers.push(server);
  clients.push(client);
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

afterEach(async () => {
  await Promise.allSettled(clients.splice(0).map((client) => client.close()));
  await Promise.allSettled(servers.splice(0).map((server) => server.close()));
});

describe('GymCoach MCP historical workout import', () => {
  it('atomically imports a completed strength workout and replays idempotently', async () => {
    const user = await db.user.create({
      data: { email: 'mcp-history-import@test.dev', passwordHash: 'x' },
    });
    const bench = await db.exercise.create({
      data: {
        userId: user.id,
        name: 'Bench press',
        muscleGroup: 'CHEST',
        category: 'COMPOUND',
        equipmentType: 'MACHINE',
      },
    });
    const curl = await db.exercise.create({
      data: {
        userId: user.id,
        name: 'Reverse curl',
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
        name: 'Chest press machine',
        equipmentType: 'MACHINE',
        loadType: 'SELECTORIZED',
        selectedLoadMultiplier: 0.5,
        weightOptions: [60, 65, 70, 75],
        exerciseLinks: { create: { exerciseId: bench.id } },
      },
    });

    const client = await connect(user.id);
    const args = {
      confirmed: true,
      importId: 'xfit-2026-08-09-strength-v1',
      startedAt: '2026-08-09T12:00:00+05:00',
      finishedAt: '2026-08-09T13:15:00+05:00',
      gymId: gym.id,
      notes: 'Imported from handwritten training notes.',
      sessionRpe: 8,
      exercises: [
        {
          exerciseId: bench.id,
          sets: [
            { weightKg: 70, reps: 10, rir: 1, gymEquipmentId: machine.id },
            { weightKg: 70, reps: 8, rir: 0.5, gymEquipmentId: machine.id },
          ],
        },
        {
          exerciseId: curl.id,
          sets: [
            {
              weightKg: 31,
              reps: 9,
              rir: 1,
              notes: 'EZ bar 11 kg.',
              isDropSet: true,
            },
          ],
        },
      ],
    } as const;

    const imported = await client.callTool({ name: 'import_historical_workout', arguments: args });
    expect(imported.isError).not.toBe(true);
    expect(imported.structuredContent).toMatchObject({
      ok: true,
      created: true,
      idempotentReplay: false,
      importId: args.importId,
      gymId: gym.id,
      exerciseCount: 2,
      setCount: 3,
    });

    const sessionId = (imported.structuredContent as { sessionId: string }).sessionId;
    const stored = await db.session.findUniqueOrThrow({
      where: { id: sessionId },
      include: {
        sets: { orderBy: [{ exerciseId: 'asc' }, { setNumber: 'asc' }] },
        exerciseMemberships: { orderBy: { ordinal: 'asc' } },
      },
    });
    expect(stored.finishedAt).not.toBeNull();
    expect(stored.gymId).toBe(gym.id);
    expect(stored.sets).toHaveLength(3);
    expect(stored.exerciseMemberships.map((membership) => membership.exerciseId)).toEqual([
      bench.id,
      curl.id,
    ]);

    const benchSets = stored.sets.filter((set) => set.exerciseId === bench.id);
    expect(benchSets[0]).toMatchObject({
      setNumber: 1,
      weight: 70,
      reps: 10,
      rir: 1,
      gymEquipmentId: machine.id,
      equipmentNameSnapshot: 'Chest press machine',
      selectedLoadKg: 70,
      selectedLoadMultiplierSnapshot: 0.5,
      nominalResistanceKg: 35,
    });
    expect(benchSets[1]).toMatchObject({
      setNumber: 2,
      weight: 70,
      reps: 8,
      rir: null,
      gymEquipmentId: machine.id,
    });
    expect(benchSets[1]?.notes).toContain('Reported RIR 0.5');

    const curlSet = stored.sets.find((set) => set.exerciseId === curl.id);
    expect(curlSet).toMatchObject({
      setNumber: 1,
      weight: 31,
      reps: 9,
      rir: 1,
      isDropSet: true,
      gymEquipmentId: null,
      notes: 'EZ bar 11 kg.',
    });

    const replay = await client.callTool({ name: 'import_historical_workout', arguments: args });
    expect(replay.isError).not.toBe(true);
    expect(replay.structuredContent).toMatchObject({
      created: false,
      idempotentReplay: true,
      sessionId,
    });
    expect(await db.session.count({ where: { userId: user.id, id: sessionId } })).toBe(1);
    expect(await db.set.count({ where: { sessionId } })).toBe(3);

    const conflicting = await client.callTool({
      name: 'import_historical_workout',
      arguments: {
        ...args,
        exercises: [
          {
            ...args.exercises[0],
            sets: [{ ...args.exercises[0].sets[0], weightKg: 72.5 }],
          },
          args.exercises[1],
        ],
      },
    });
    expect(conflicting.isError).toBe(true);
    expect(conflicting.content).toEqual([
      expect.objectContaining({
        type: 'text',
        text: expect.stringContaining('importId already exists with different data'),
      }),
    ]);
    expect(await db.set.count({ where: { sessionId } })).toBe(3);
  });

  it('rejects read-only writes and foreign exercises without creating a session', async () => {
    const owner = await db.user.create({
      data: { email: 'mcp-history-owner@test.dev', passwordHash: 'x' },
    });
    const foreign = await db.user.create({
      data: { email: 'mcp-history-foreign@test.dev', passwordHash: 'x' },
    });
    const foreignExercise = await db.exercise.create({
      data: {
        userId: foreign.id,
        name: 'Foreign exercise',
        muscleGroup: 'OTHER',
        category: 'ISOLATION',
      },
    });
    const readOnlyClient = await connect(owner.id, false);
    const payload = {
      confirmed: true,
      importId: 'readonly-history-import',
      startedAt: '2026-08-10T12:00:00+05:00',
      exercises: [
        {
          exerciseId: foreignExercise.id,
          sets: [{ weightKg: 10, reps: 10, rir: 2 }],
        },
      ],
    } as const;

    const denied = await readOnlyClient.callTool({
      name: 'import_historical_workout',
      arguments: payload,
    });
    expect(denied.isError).toBe(true);
    expect(denied.content).toEqual([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('read-only') }),
    ]);

    const writeClient = await connect(owner.id, true);
    const foreignAttempt = await writeClient.callTool({
      name: 'import_historical_workout',
      arguments: payload,
    });
    expect(foreignAttempt.isError).toBe(true);
    expect(foreignAttempt.content).toEqual([
      expect.objectContaining({
        type: 'text',
        text: expect.stringContaining('not found in the trainee exercise catalog'),
      }),
    ]);
    expect(await db.session.count({ where: { userId: owner.id } })).toBe(0);
  });
});
