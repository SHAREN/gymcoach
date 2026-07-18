import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { createGymCoachMcpServer } from '@/lib/mcp/server';
import { isoWeekStart } from '@/lib/stats';

const servers: Array<ReturnType<typeof createGymCoachMcpServer>> = [];
const clients: Client[] = [];

async function connect(userId: string) {
  const server = createGymCoachMcpServer({
    principal: { tokenId: `token-${userId}`, userId, canWrite: false },
    baseUrl: 'https://gymcoach.example',
  });
  const client = new Client({ name: 'mcp-history-test', version: '1.0.0' });
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

async function createLegacyProgramFixture(email: string) {
  const user = await db.user.create({
    data: { email, passwordHash: 'x', weeklyFrequency: 3 },
  });
  const program = await db.program.create({
    data: {
      id: '550e8400-e29b-41d4-a716-446655440000',
      userId: user.id,
      name: 'Imported legacy plan',
      phase: 'Hypertrophy',
    },
  });
  const workout = await db.workout.create({
    data: {
      id: '550e8400-e29b-41d4-a716-446655440001',
      programId: program.id,
      name: 'Full body',
      order: 1,
    },
  });
  const exercise = await db.exercise.create({
    data: {
      id: '550e8400-e29b-41d4-a716-446655440002',
      userId: user.id,
      name: 'Rows with Close Grip · Cable',
      muscleGroup: 'BACK_THICKNESS',
      category: 'COMPOUND',
      equipmentType: 'CABLE',
    },
  });
  await db.programExercise.create({
    data: {
      id: '550e8400-e29b-41d4-a716-446655440003',
      workoutId: workout.id,
      exerciseId: exercise.id,
      order: 1,
      targetSets: 3,
      targetRepsMin: 8,
      targetRepsMax: 12,
      targetRIR: 2,
      restSec: 120,
    },
  });
  return { user, program, workout, exercise };
}

async function addSession(
  fixture: Awaited<ReturnType<typeof createLegacyProgramFixture>>,
  id: string,
  startedAt: Date,
  rir: number | null,
) {
  const session = await db.session.create({
    data: {
      id,
      userId: fixture.user.id,
      programId: fixture.program.id,
      workoutId: fixture.workout.id,
      startedAt,
      finishedAt: new Date(startedAt.getTime() + 60 * 60 * 1000),
      sessionRpe: 7,
    },
  });
  await db.set.createMany({
    data: [
      {
        id: `${id}-warmup`,
        sessionId: session.id,
        exerciseId: fixture.exercise.id,
        setNumber: 1,
        weight: 30,
        reps: 10,
        isWarmup: true,
        completedAt: startedAt,
      },
      {
        id: `${id}-work`,
        sessionId: session.id,
        exerciseId: fixture.exercise.id,
        setNumber: 2,
        weight: 60,
        reps: 10,
        rir,
        recoverySec: 150,
        completedAt: new Date(startedAt.getTime() + 5 * 60 * 1000),
      },
      {
        id: `${id}-drop`,
        sessionId: session.id,
        exerciseId: fixture.exercise.id,
        setNumber: 3,
        weight: 40,
        reps: 12,
        rir: 1,
        isDropSet: true,
        completedAt: new Date(startedAt.getTime() + 10 * 60 * 1000),
      },
    ],
  });
  return session;
}

describe('GymCoach MCP training history', () => {
  it('round-trips legacy UUID programs and opens their exact session history', async () => {
    const fixture = await createLegacyProgramFixture('mcp-history-uuid@test.dev');
    const startedAt = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
    await addSession(fixture, '550e8400-e29b-41d4-a716-446655440004', startedAt, 2);
    const client = await connect(fixture.user.id);

    const listed = await client.callTool({ name: 'list_programs', arguments: {} });
    const listedData = listed.structuredContent as {
      programs: Array<{
        id: string;
        _count: { sessions: number };
        sessionRange: { firstSessionAt: string | null; lastSessionAt: string | null };
      }>;
    };
    expect(listedData.programs[0]).toMatchObject({
      id: fixture.program.id,
      _count: { sessions: 1 },
      sessionRange: {
        firstSessionAt: startedAt.toISOString(),
        lastSessionAt: startedAt.toISOString(),
      },
    });

    const opened = await client.callTool({
      name: 'get_program',
      arguments: { programId: fixture.program.id },
    });
    expect(opened.isError).not.toBe(true);
    expect(opened.structuredContent).toMatchObject({
      program: { id: fixture.program.id, workouts: [{ id: fixture.workout.id }] },
    });

    const history = await client.callTool({
      name: 'get_training_history',
      arguments: { programId: fixture.program.id },
    });
    expect(history.isError).not.toBe(true);
    expect(history.structuredContent).toMatchObject({
      totalMatching: 1,
      returned: 1,
      hasMore: false,
      sessions: [
        {
          sessionRpe: 7,
          workingSetCount: 2,
          regularWorkingSetCount: 1,
          dropSetCount: 1,
          setsWithRir: 1,
          exercises: [
            {
              exerciseName: 'Rows with Close Grip · Cable',
              muscleGroup: 'BACK_THICKNESS',
              sets: [
                { isWarmup: true },
                { weight: 60, reps: 10, rir: 2, recoverySec: 150 },
                { isDropSet: true },
              ],
            },
          ],
        },
      ],
    });
  });

  it('keeps older exact sessions visible when both exposed ISO weeks are empty', async () => {
    const fixture = await createLegacyProgramFixture('mcp-history-context@test.dev');
    const currentWeekStart = isoWeekStart(new Date());
    const first = new Date(currentWeekStart.getTime() - 15 * 24 * 60 * 60 * 1000);
    const second = new Date(currentWeekStart.getTime() - 39 * 24 * 60 * 60 * 1000);
    await addSession(fixture, '550e8400-e29b-41d4-a716-446655440010', first, null);
    await addSession(fixture, '550e8400-e29b-41d4-a716-446655440011', second, 3);
    const client = await connect(fixture.user.id);

    const response = await client.callTool({ name: 'get_training_context', arguments: {} });
    const context = response.structuredContent as {
      contextSchemaVersion: number;
      coach: { weekCurrent: { sessions: unknown[] }; weekPrevious: null };
      trainingHistory: {
        recentSessionDetails: { knownStrengthSessionsInCoverage: number; returned: number };
        recentSessions: Array<{ sessionId: string }>;
        dataQuality: { indirectSetAccounting: string; rirCoveragePct: number | null };
      };
    };
    expect(context.contextSchemaVersion).toBe(5);
    expect(context.coach.weekCurrent.sessions).toEqual([]);
    expect(context.coach.weekPrevious).toBeNull();
    expect(context.trainingHistory.recentSessionDetails).toEqual({
      knownStrengthSessionsInCoverage: 2,
      returned: 2,
      truncated: false,
    });
    expect(context.trainingHistory.recentSessions.map((session) => session.sessionId)).toEqual([
      '550e8400-e29b-41d4-a716-446655440010',
      '550e8400-e29b-41d4-a716-446655440011',
    ]);
    expect(context.trainingHistory.dataQuality).toMatchObject({
      indirectSetAccounting: 'unavailable',
      rirCoveragePct: 50,
    });
  });

  it('isolates owners, validates ranges and paginates without duplicates', async () => {
    const fixture = await createLegacyProgramFixture('mcp-history-pages@test.dev');
    for (let index = 0; index < 3; index += 1) {
      await addSession(
        fixture,
        `550e8400-e29b-41d4-a716-44665544002${index}`,
        new Date(Date.now() - (index < 2 ? 10 : 12) * 24 * 60 * 60 * 1000),
        2,
      );
    }
    const client = await connect(fixture.user.id);
    const page1 = await client.callTool({
      name: 'get_training_history',
      arguments: { programId: fixture.program.id, limit: 2 },
    });
    const first = page1.structuredContent as {
      hasMore: boolean;
      nextCursor: string;
      range: { from: string | null; to: string };
      sessions: Array<{ sessionId: string }>;
    };
    expect(first.hasMore).toBe(true);
    expect(first.sessions).toHaveLength(2);

    const unstablePage = await client.callTool({
      name: 'get_training_history',
      arguments: {
        programId: fixture.program.id,
        limit: 2,
        cursorSessionId: first.nextCursor,
      },
    });
    expect(unstablePage.isError).toBe(true);
    expect(unstablePage.content).toEqual([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('range.to') }),
    ]);

    const page2 = await client.callTool({
      name: 'get_training_history',
      arguments: {
        programId: fixture.program.id,
        limit: 2,
        cursorSessionId: first.nextCursor,
        to: first.range.to,
      },
    });
    const second = page2.structuredContent as {
      hasMore: boolean;
      sessions: Array<{ sessionId: string }>;
    };
    expect(second.hasMore).toBe(false);
    expect(second.sessions).toHaveLength(1);
    expect(new Set([...first.sessions, ...second.sessions].map((row) => row.sessionId)).size).toBe(
      3,
    );

    const invalidRange = await client.callTool({
      name: 'get_training_history',
      arguments: {
        from: '2026-07-10T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
    });
    expect(invalidRange.isError).toBe(true);
    expect(invalidRange.content).toEqual([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('earlier than') }),
    ]);

    const foreign = await db.user.create({
      data: { email: 'mcp-history-foreign@test.dev', passwordHash: 'x' },
    });
    const foreignClient = await connect(foreign.id);
    const foreignProgram = await foreignClient.callTool({
      name: 'get_program',
      arguments: { programId: fixture.program.id },
    });
    expect(foreignProgram.isError).toBe(true);
    const foreignHistory = await foreignClient.callTool({
      name: 'get_training_history',
      arguments: { programId: fixture.program.id },
    });
    expect(foreignHistory.isError).toBe(true);
  });
});
