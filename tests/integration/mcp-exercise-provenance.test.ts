import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { createGymCoachMcpServer } from '@/lib/mcp/server';

const servers: Array<ReturnType<typeof createGymCoachMcpServer>> = [];
const clients: Client[] = [];

async function connect(userId: string) {
  const server = createGymCoachMcpServer({
    principal: { tokenId: `token-${userId}`, userId, canWrite: true },
    baseUrl: 'https://gymcoach.example',
  });
  const client = new Client({ name: 'mcp-exercise-provenance-test', version: '1.0.0' });
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

describe('MCP exercise provenance', () => {
  it('does not persist reviewed metadata from a mismatched catalog name', async () => {
    const user = await db.user.create({
      data: { email: 'mcp-exercise-provenance@test.dev', passwordHash: 'x' },
    });
    const program = await db.program.create({
      data: { userId: user.id, name: 'MCP program', phase: 'Test' },
    });
    const workout = await db.workout.create({
      data: { programId: program.id, name: 'MCP workout', order: 1 },
    });
    const client = await connect(user.id);

    const response = await client.callTool({
      name: 'add_program_exercise',
      arguments: {
        confirmed: true,
        workoutId: workout.id,
        exercise: {
          name: 'Deadlift',
          muscleGroup: 'CHEST',
          category: 'ISOLATION',
          equipmentType: 'MACHINE',
          targetSets: 3,
          targetRepsMin: 10,
          targetRepsMax: 15,
          targetRIR: 2,
          restSec: 60,
        },
      },
    });
    expect(response.isError).not.toBe(true);

    expect(
      await db.exercise.findUniqueOrThrow({
        where: { userId_name: { userId: user.id, name: 'Deadlift' } },
      }),
    ).toMatchObject({
      muscleGroup: 'CHEST',
      category: 'ISOLATION',
      catalogOrigin: null,
      loadProfile: {
        classification: 'UNCLASSIFIED',
        provenance: 'UNCLASSIFIED',
        secondaryMuscles: { state: 'UNKNOWN', entries: [] },
      },
    });
  });
});
