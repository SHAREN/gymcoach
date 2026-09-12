import { Buffer } from 'node:buffer';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { createGymCoachMcpServer } from '@/lib/mcp/server';

const servers: Array<ReturnType<typeof createGymCoachMcpServer>> = [];
const clients: Client[] = [];
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function connect(userId: string, canWrite: boolean) {
  const server = createGymCoachMcpServer({
    principal: { tokenId: 'test-token', userId, canWrite },
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
  it('clones an owned gym inventory without changing the active gym', async () => {
    const user = await db.user.create({
      data: { email: 'mcp-gym-create@test.dev', passwordHash: 'x' },
    });
    const exercise = await db.exercise.create({
      data: {
        userId: user.id,
        name: 'Lat Pulldown',
        muscleGroup: 'BACK_WIDTH',
        category: 'COMPOUND',
        equipmentType: 'CABLE',
      },
    });
    const source = await db.gym.create({
      data: {
        userId: user.id,
        name: 'Olymp',
        dumbbellWeights: [10, 12.5, 15],
        plateWeights: [1.25, 2.5, 5, 10, 20],
        barWeights: [20],
        exerciseConfigs: {
          create: {
            exerciseId: exercise.id,
            isAvailable: true,
            weightOptions: [10, 20, 30],
          },
        },
      },
    });
    const sourceEquipment = await db.gymEquipment.create({
      data: {
        gymId: source.id,
        name: 'Lat pulldown station',
        equipmentType: 'CABLE',
        description: 'Selectorized cable station.',
        manufacturer: 'GymCo',
        modelName: 'Pulldown 100',
        quantity: 1,
        weightOptions: [10, 20, 30],
        imageData: PNG,
        imageMimeType: 'image/png',
        exerciseLinks: { create: { exerciseId: exercise.id } },
      },
    });
    await db.user.update({ where: { id: user.id }, data: { activeGymId: source.id } });
    const client = await connect(user.id, true);

    const created = await client.callTool({
      name: 'create_gym',
      arguments: {
        confirmed: true,
        name: 'Xfit',
        sourceGymId: source.id,
        makeActive: false,
      },
    });

    expect(created.isError).not.toBe(true);
    const createdData = created.structuredContent as {
      ok: boolean;
      gym: {
        id: string;
        name: string;
        isActive: boolean;
        _count: { equipment: number; exerciseConfigs: number; sessions: number };
      };
      clonedFromGym: { id: string; name: string } | null;
    };
    expect(createdData).toMatchObject({
      ok: true,
      gym: {
        name: 'Xfit',
        isActive: false,
        _count: { equipment: 1, exerciseConfigs: 1, sessions: 0 },
      },
      clonedFromGym: { id: source.id, name: source.name },
    });
    expect(createdData.gym.id).not.toBe(source.id);

    const clonedGym = await db.gym.findUniqueOrThrow({
      where: { id: createdData.gym.id },
      include: { exerciseConfigs: true, equipment: { include: { exerciseLinks: true } } },
    });
    expect(clonedGym).toMatchObject({
      name: 'Xfit',
      dumbbellWeights: [10, 12.5, 15],
      plateWeights: [1.25, 2.5, 5, 10, 20],
      barWeights: [20],
    });
    expect(clonedGym.exerciseConfigs).toEqual([
      expect.objectContaining({
        exerciseId: exercise.id,
        isAvailable: true,
        weightOptions: [10, 20, 30],
      }),
    ]);
    expect(clonedGym.equipment).toHaveLength(1);
    const clonedEquipment = clonedGym.equipment[0];
    expect(clonedEquipment).toBeDefined();
    if (!clonedEquipment) throw new Error('Cloned equipment was not saved.');
    expect(clonedEquipment).toMatchObject({
      name: sourceEquipment.name,
      equipmentType: sourceEquipment.equipmentType,
      description: sourceEquipment.description,
      manufacturer: sourceEquipment.manufacturer,
      modelName: sourceEquipment.modelName,
      weightOptions: [10, 20, 30],
      imageMimeType: 'image/png',
      exerciseLinks: [expect.objectContaining({ exerciseId: exercise.id })],
    });
    expect(clonedEquipment.id).not.toBe(sourceEquipment.id);
    expect(Buffer.from(clonedEquipment.imageData ?? [])).toEqual(PNG);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).activeGymId).toBe(source.id);
  });

  it('rejects creation for a read-only principal', async () => {
    const user = await db.user.create({
      data: { email: 'mcp-gym-create-readonly@test.dev', passwordHash: 'x' },
    });
    const client = await connect(user.id, false);

    const created = await client.callTool({
      name: 'create_gym',
      arguments: { confirmed: true, name: 'Xfit' },
    });

    expect(created.isError).toBe(true);
    expect(created.content).toEqual([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('read-only') }),
    ]);
    expect(await db.gym.count({ where: { userId: user.id } })).toBe(0);
  });

  it('does not clone a source gym owned by another trainee', async () => {
    const owner = await db.user.create({
      data: { email: 'mcp-gym-create-owner@test.dev', passwordHash: 'x' },
    });
    const other = await db.user.create({
      data: { email: 'mcp-gym-create-other@test.dev', passwordHash: 'x' },
    });
    const foreignGym = await db.gym.create({
      data: { userId: other.id, name: 'Foreign gym', dumbbellWeights: [20] },
    });
    const client = await connect(owner.id, true);

    const created = await client.callTool({
      name: 'create_gym',
      arguments: { confirmed: true, name: 'Xfit', sourceGymId: foreignGym.id },
    });

    expect(created.isError).toBe(true);
    expect(created.content).toEqual([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('Source gym not found') }),
    ]);
    expect(await db.gym.count({ where: { userId: owner.id } })).toBe(0);
  });
});
