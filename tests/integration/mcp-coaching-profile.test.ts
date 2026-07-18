import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { createGymCoachMcpServer } from '@/lib/mcp/server';
import { applyCoachingProfilePatch } from '@/lib/schemas/coaching-profile';
import { Prisma } from '@/lib/prisma-client';

const servers: Array<ReturnType<typeof createGymCoachMcpServer>> = [];
const clients: Client[] = [];

async function connect(userId: string) {
  const server = createGymCoachMcpServer({
    principal: { tokenId: `token-${userId}`, userId, canWrite: false },
    baseUrl: 'https://gymcoach.example',
  });
  const client = new Client({ name: 'mcp-coaching-profile-test', version: '1.0.0' });
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

describe('MCP structured coaching profile', () => {
  it('returns the same normalized facts and program-design defaults in both context tools', async () => {
    const profile = applyCoachingProfilePatch(
      null,
      {
        healthStatus: { state: 'KNOWN', value: 'TRAIN_WITH_LIMITATIONS' },
        trainingLevel: { state: 'KNOWN', value: 'INTERMEDIATE' },
        availableWeekdays: { state: 'KNOWN', value: [1, 3, 5] },
        limitations: {
          state: 'KNOWN',
          value: {
            entries: [
              {
                kind: 'FORBIDDEN_EXERCISE',
                label: 'Self-reported exercise restriction',
                affectedExerciseNames: ['Bench press'],
              },
            ],
          },
        },
        maximumSessionDurationMin: { state: 'KNOWN', value: 60 },
        priorityStrengthMovements: { state: 'KNOWN', value: ['Pull-up'] },
        outsideActivities: {
          state: 'KNOWN',
          value: [{ type: 'PHYSICAL_WORK', name: 'Warehouse shifts', sessionsPerWeek: 3 }],
        },
      },
      new Date('2026-07-18T10:00:00.000Z'),
    );
    const user = await db.user.create({
      data: {
        email: 'mcp-coaching-profile@test.dev',
        passwordHash: 'x',
        goal: 'STRENGTH',
        coachingProfile: profile as Prisma.InputJsonValue,
        coachingProfileUpdatedAt: new Date(profile.updatedAt!),
      },
    });
    const gym = await db.gym.create({ data: { userId: user.id, name: 'MCP gym' } });
    await db.user.update({ where: { id: user.id }, data: { activeGymId: gym.id } });
    const client = await connect(user.id);

    const training = await client.callTool({ name: 'get_training_context', arguments: {} });
    expect(training.isError).not.toBe(true);
    expect(training.structuredContent).toMatchObject({
      instructionsVersion: 5,
      contextSchemaVersion: 5,
      coach: {
        userProfile: {
          coachingProfile: {
            healthStatus: { state: 'KNOWN', value: 'TRAIN_WITH_LIMITATIONS' },
            availableWeekdays: { state: 'KNOWN', value: [1, 3, 5] },
          },
        },
      },
    });

    const design = await client.callTool({
      name: 'get_program_design_context',
      arguments: {},
    });
    expect(design.isError).not.toBe(true);
    expect(design.structuredContent).toMatchObject({
      context: {
        goal: 'Improve strength',
        answers: {
          healthStatus: 'TRAIN_WITH_LIMITATIONS',
          trainingExperience: 'INTERMEDIATE',
          availableDays: [1, 3, 5],
          sessionDurationMin: 60,
          concurrentTraining: expect.stringContaining('Warehouse shifts'),
        },
        answerSources: {
          goal: 'profile',
          healthStatus: 'profile',
          availableDays: 'profile',
        },
        exerciseConstraints: [expect.objectContaining({ affectedExerciseNames: ['Bench press'] })],
        missingQuestions: [],
      },
    });
  });

  it('exposes the deterministic medical-clearance generation block', async () => {
    const profile = applyCoachingProfilePatch(
      null,
      {
        healthStatus: { state: 'KNOWN', value: 'MEDICAL_CLEARANCE_REQUIRED' },
        trainingLevel: { state: 'KNOWN', value: 'BEGINNER' },
        availableWeekdays: { state: 'KNOWN', value: [2, 4] },
        limitations: { state: 'NOT_APPLICABLE' },
        maximumSessionDurationMin: { state: 'KNOWN', value: 45 },
      },
      new Date('2026-07-18T10:00:00.000Z'),
    );
    const user = await db.user.create({
      data: {
        email: 'mcp-medical-clearance@test.dev',
        passwordHash: 'x',
        goal: 'GENERAL_FITNESS',
        coachingProfile: profile as Prisma.InputJsonValue,
        coachingProfileUpdatedAt: new Date(profile.updatedAt!),
      },
    });
    const gym = await db.gym.create({ data: { userId: user.id, name: 'Clearance gym' } });
    await db.user.update({ where: { id: user.id }, data: { activeGymId: gym.id } });
    const client = await connect(user.id);

    const design = await client.callTool({
      name: 'get_program_design_context',
      arguments: {},
    });
    expect(design.structuredContent).toMatchObject({
      context: {
        safety: {
          healthStatus: 'MEDICAL_CLEARANCE_REQUIRED',
          canGenerateProgram: false,
          blockingReasons: [expect.stringMatching(/qualified professional/i)],
        },
      },
    });
  });
});
