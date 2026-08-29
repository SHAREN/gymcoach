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
  const client = new Client({ name: 'resolver-test', version: '1.0.0' });
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

describe('GymCoach MCP entity resolver', () => {
  it('bulk-resolves Russian exercise names and equipment inside a named gym', async () => {
    const user = await db.user.create({
      data: { email: 'mcp-resolver@test.dev', passwordHash: 'x' },
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
    const reverseCurl = await db.exercise.create({
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
    await db.user.update({ where: { id: user.id }, data: { activeGymId: gym.id } });
    const equipment = await db.gymEquipment.create({
      data: {
        gymId: gym.id,
        name: 'Hammer верхняя тяга',
        equipmentType: 'MACHINE',
        loadType: 'PLATE_LOADED',
        exerciseLinks: { create: { exerciseId: bench.id } },
      },
    });

    const client = await connect(user.id);
    const response = await client.callTool({
      name: 'resolve_entities',
      arguments: {
        gym: 'x fit',
        exercises: ['Жим лёжа', 'Подъём на бицепс обратным хватом'],
        equipment: ['Hammer верхняя тяга'],
      },
    });

    expect(response.isError).not.toBe(true);
    expect(response.structuredContent).toMatchObject({
      status: 'READY',
      gym: { status: 'RESOLVED', selected: { id: gym.id } },
      equipment: [{ status: 'RESOLVED', selected: { id: equipment.id } }],
    });
    const exercises = (response.structuredContent as { exercises: Array<{ selected: { id: string } }> })
      .exercises;
    expect(exercises.map((row) => row.selected.id)).toEqual([bench.id, reverseCurl.id]);
  });
});
