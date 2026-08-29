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
  const client = new Client({ name: 'get-workouts-test', version: '1.0.0' });
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

describe('GymCoach MCP get_workouts', () => {
  it('filters by human gym name and date and exposes stale multi-day sessions', async () => {
    const user = await db.user.create({
      data: { email: 'mcp-get-workouts@test.dev', passwordHash: 'x' },
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
    const olymp = await db.gym.create({ data: { userId: user.id, name: 'Олимп' } });
    const xfit = await db.gym.create({ data: { userId: user.id, name: 'X-Fit' } });
    const stale = await db.session.create({
      data: {
        userId: user.id,
        gymId: olymp.id,
        startedAt: new Date('2026-08-09T10:00:00.000Z'),
        finishedAt: new Date('2026-08-13T10:00:00.000Z'),
        sets: {
          create: {
            exerciseId: exercise.id,
            setNumber: 1,
            weight: 70,
            reps: 10,
            rir: 1,
            completedAt: new Date('2026-08-09T10:05:00.000Z'),
          },
        },
      },
    });
    await db.session.create({
      data: {
        userId: user.id,
        gymId: xfit.id,
        startedAt: new Date('2026-08-09T15:00:00.000Z'),
        finishedAt: new Date('2026-08-09T16:00:00.000Z'),
      },
    });

    const client = await connect(user.id);
    const response = await client.callTool({
      name: 'get_workouts',
      arguments: { gym: 'олимп', dates: ['2026-08-09'] },
    });

    expect(response.isError).not.toBe(true);
    expect(response.structuredContent).toMatchObject({
      status: 'READY',
      returned: 1,
      gym: { id: olymp.id, canonicalName: 'Олимп' },
      workouts: [
        {
          sessionId: stale.id,
          gym: { id: olymp.id, name: 'Олимп' },
          exerciseCount: 1,
          setCount: 1,
          isStale: true,
          staleClassification: 'STALE_MULTI_DAY_SESSION',
        },
      ],
    });
  });

  it('classifies stale, overlapping, cross-gym and exact duplicate sessions server-side', async () => {
    const user = await db.user.create({
      data: { email: 'mcp-workout-conflicts@test.dev', passwordHash: 'x' },
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
    const olymp = await db.gym.create({ data: { userId: user.id, name: 'Олимп' } });
    const xfit = await db.gym.create({ data: { userId: user.id, name: 'X-Fit' } });
    const stale = await db.session.create({
      data: {
        userId: user.id,
        gymId: olymp.id,
        startedAt: new Date('2026-08-09T10:00:00.000Z'),
        finishedAt: new Date('2026-08-13T10:00:00.000Z'),
        sets: {
          create: {
            exerciseId: exercise.id,
            setNumber: 1,
            weight: 70,
            reps: 10,
            rir: 1,
            completedAt: new Date('2026-08-09T10:05:00.000Z'),
          },
        },
      },
    });
    const duplicate = await db.session.create({
      data: {
        userId: user.id,
        gymId: xfit.id,
        startedAt: new Date('2026-08-09T15:00:00.000Z'),
        finishedAt: new Date('2026-08-09T16:00:00.000Z'),
        sets: {
          create: {
            exerciseId: exercise.id,
            setNumber: 1,
            weight: 70,
            reps: 10,
            rir: 1,
            completedAt: new Date('2026-08-09T15:05:00.000Z'),
          },
        },
      },
    });
    const overlap = await db.session.create({
      data: {
        userId: user.id,
        gymId: olymp.id,
        startedAt: new Date('2026-08-13T09:00:00.000Z'),
        finishedAt: new Date('2026-08-13T11:00:00.000Z'),
      },
    });

    const client = await connect(user.id);
    const response = await client.callTool({
      name: 'analyze_historical_workout_conflicts',
      arguments: {
        dates: ['2026-08-09', '2026-08-13'],
        sourceGym: 'Олимп',
        targetGym: 'X-Fit',
      },
    });

    expect(response.isError).not.toBe(true);
    const content = response.structuredContent as {
      findings: Array<{ classification: string; sessionIds: string[] }>;
    };
    expect(content.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          classification: 'STALE_MULTI_DAY_SESSION',
          sessionIds: [stale.id],
        }),
        expect.objectContaining({
          classification: 'EXACT_DUPLICATE',
          sessionIds: expect.arrayContaining([stale.id, duplicate.id]),
        }),
        expect.objectContaining({
          classification: 'SAME_DATE_OTHER_GYM',
          sessionIds: expect.arrayContaining([stale.id, duplicate.id]),
        }),
        expect.objectContaining({
          classification: 'OVERLAPPING_SESSION',
          sessionIds: expect.arrayContaining([stale.id, overlap.id]),
        }),
      ]),
    );
  });

  it('deletes only a fully validated owned batch and returns deleted summaries', async () => {
    const user = await db.user.create({
      data: { email: 'mcp-delete-workouts@test.dev', passwordHash: 'x' },
    });
    const gym = await db.gym.create({ data: { userId: user.id, name: 'Олимп' } });
    const first = await db.session.create({
      data: {
        userId: user.id,
        gymId: gym.id,
        startedAt: new Date('2026-08-09T10:00:00.000Z'),
        finishedAt: new Date('2026-08-09T11:00:00.000Z'),
      },
    });
    const second = await db.session.create({
      data: {
        userId: user.id,
        gymId: gym.id,
        startedAt: new Date('2026-08-13T10:00:00.000Z'),
        finishedAt: new Date('2026-08-13T11:00:00.000Z'),
      },
    });

    const client = await connect(user.id);
    const rejected = await client.callTool({
      name: 'delete_workouts',
      arguments: {
        confirmed: true,
        sessionIds: [first.id, 'missing-session-id'],
        reason: 'Test stale duplicate cleanup',
      },
    });
    expect(rejected.structuredContent).toMatchObject({
      ok: false,
      errorCode: 'SESSION_NOT_FOUND_OR_NOT_OWNED',
      deleted: [],
    });
    expect(await db.session.count({ where: { id: { in: [first.id, second.id] } } })).toBe(2);

    const deleted = await client.callTool({
      name: 'delete_workouts',
      arguments: {
        confirmed: true,
        sessionIds: [first.id, second.id],
        reason: 'Confirmed erroneous historical duplicates',
      },
    });
    expect(deleted.structuredContent).toMatchObject({
      ok: true,
      status: 'DELETED',
      deletedCount: 2,
      deleted: expect.arrayContaining([
        expect.objectContaining({ sessionId: first.id, gym: { id: gym.id, name: 'Олимп' } }),
        expect.objectContaining({ sessionId: second.id, gym: { id: gym.id, name: 'Олимп' } }),
      ]),
    });
    expect(await db.session.count({ where: { id: { in: [first.id, second.id] } } })).toBe(0);
  });
});
