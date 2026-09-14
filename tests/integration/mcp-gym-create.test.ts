import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { createGymCoachMcpServer } from '@/lib/mcp/server';

const servers: Array<ReturnType<typeof createGymCoachMcpServer>> = [];
const clients: Client[] = [];

async function connect(userId: string, canWrite: boolean) {
  const server = createGymCoachMcpServer({
    principal: { tokenId: 'token-test', userId, canWrite },
    baseUrl: 'https://gymcoach.example',
  });
  const client = new Client({ name: 'gym-create-test', version: '1.0.0' });
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

describe('GymCoach MCP create_gym', () => {
  it('requires explicit confirmation and a write-enabled principal', async () => {
    const user = await db.user.create({
      data: { email: `mcp-gym-create-${Date.now()}@test.dev`, passwordHash: 'x' },
    });
    const readOnlyClient = await connect(user.id, false);

    const missingConfirmation = await readOnlyClient.callTool({
      name: 'create_gym',
      arguments: { name: 'New gym' },
    });
    expect(missingConfirmation.isError).toBe(true);

    const deniedWrite = await readOnlyClient.callTool({
      name: 'create_gym',
      arguments: { confirmed: true, name: 'New gym' },
    });
    expect(deniedWrite.isError).toBe(true);
    expect(deniedWrite.content).toEqual([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('read-only') }),
    ]);
    expect(await db.gym.count({ where: { userId: user.id } })).toBe(0);
  });

  it('clones only an owned source gym and returns the new gym identity', async () => {
    const suffix = Date.now();
    const owner = await db.user.create({
      data: { email: `mcp-gym-owner-${suffix}@test.dev`, passwordHash: 'x' },
    });
    const other = await db.user.create({
      data: { email: `mcp-gym-other-${suffix}@test.dev`, passwordHash: 'x' },
    });
    const source = await db.gym.create({
      data: { userId: owner.id, name: 'Source', dumbbellWeights: [10, 12.5] },
    });
    const foreign = await db.gym.create({ data: { userId: other.id, name: 'Foreign' } });
    await db.user.update({ where: { id: owner.id }, data: { activeGymId: source.id } });

    const client = await connect(owner.id, true);
    const foreignClone = await client.callTool({
      name: 'create_gym',
      arguments: {
        confirmed: true,
        name: 'Forbidden clone',
        sourceGymId: foreign.id,
      },
    });
    expect(foreignClone.isError).toBe(true);
    expect(foreignClone.content).toEqual([
      expect.objectContaining({
        type: 'text',
        text: expect.stringContaining('Source gym not found'),
      }),
    ]);

    const created = await client.callTool({
      name: 'create_gym',
      arguments: {
        confirmed: true,
        name: 'Owned clone',
        sourceGymId: source.id,
        makeActive: false,
      },
    });
    expect(created.isError).not.toBe(true);
    const data = created.structuredContent as {
      ok: boolean;
      gym: { id: string; name: string; isActive: boolean };
      clonedFromGym: { id: string; name: string } | null;
    };
    expect(data).toMatchObject({
      ok: true,
      gym: { name: 'Owned clone', isActive: false },
      clonedFromGym: { id: source.id, name: 'Source' },
    });
    expect(data.gym.id).not.toBe(source.id);
    expect(
      await db.gym.findUniqueOrThrow({
        where: { id: data.gym.id },
        select: { dumbbellWeights: true },
      }),
    ).toEqual({ dumbbellWeights: [10, 12.5] });
    expect((await db.user.findUniqueOrThrow({ where: { id: owner.id } })).activeGymId).toBe(
      source.id,
    );
  });
});
