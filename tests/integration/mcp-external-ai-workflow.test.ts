import { describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import {
  bindCompatibleExerciseEquipment,
  getExternalAiImportContext,
  importOrUpdateWorkoutData,
  reuseOrCreatePhysicalEquipment,
} from '@/lib/mcp/external-ai-workflow';

async function seedUser(label: string) {
  const user = await db.user.create({
    data: { email: `mcp-external-${label}-${Date.now()}@test.dev`, passwordHash: 'unused' },
  });
  const gym = await db.gym.create({
    data: {
      userId: user.id,
      name: `${label} gym`,
      dumbbellWeights: [10, 12, 14],
      plateWeights: [5, 10, 20],
      barWeights: [20],
    },
  });
  await db.user.update({ where: { id: user.id }, data: { activeGymId: gym.id } });
  return { user, gym };
}

async function seedExercise(userId: string, name: string, equipmentType: 'MACHINE' | 'CABLE' = 'MACHINE') {
  return db.exercise.create({
    data: {
      userId,
      name,
      muscleGroup: 'BACK_WIDTH',
      category: 'COMPOUND',
      equipmentType,
    },
  });
}

describe('external AI over MCP workflow', () => {
  it('returns bounded user-scoped context for the selected gym only', async () => {
    const owner = await seedUser('owner-context');
    const foreign = await seedUser('foreign-context');
    const exercise = await seedExercise(owner.user.id, 'Upper pulldown');
    await seedExercise(foreign.user.id, 'Foreign pulldown');
    await db.gymEquipment.create({
      data: { gymId: owner.gym.id, name: 'Owner Hammer', equipmentType: 'MACHINE' },
    });
    await db.gymEquipment.create({
      data: { gymId: foreign.gym.id, name: 'Foreign Hammer', equipmentType: 'MACHINE' },
    });

    const context = await getExternalAiImportContext(owner.user.id, {
      gymId: owner.gym.id,
      exerciseIds: [exercise.id],
      exerciseLimit: 5,
      historySessionLimit: 2,
    });

    expect(context.selectedGymId).toBe(owner.gym.id);
    expect(context.exercises.map((item) => item.id)).toEqual([exercise.id]);
    expect(context.gym.equipment.map((item) => item.name)).toEqual(['Owner Hammer']);
    expect(JSON.stringify(context)).not.toContain('Foreign Hammer');
    expect(JSON.stringify(context)).not.toContain('Foreign pulldown');
    expect(context.bounds).toMatchObject({ exerciseLimit: 5, historySessionLimit: 2 });
  });

  it('rejects a foreign gym when requesting bounded context', async () => {
    const owner = await seedUser('owner-scope');
    const foreign = await seedUser('foreign-scope');
    await expect(
      getExternalAiImportContext(owner.user.id, { gymId: foreign.gym.id }),
    ).rejects.toThrow('Gym not found.');
  });

  it('stores an observed plate-loaded Hammer without inventing manufacturer, model or load mechanics', async () => {
    const { user, gym } = await seedUser('hammer');
    const result = await reuseOrCreatePhysicalEquipment(user.id, {
      gymId: gym.id,
      create: {
        name: 'Hammer upper pulldown (plate-loaded)',
        equipmentType: 'MACHINE',
        description: 'Observed plate-loaded upper-pulldown station.',
        loadConfigurationKnown: false,
        weightOptions: [],
      },
    });

    expect(result.action).toBe('created');
    const saved = await db.gymEquipment.findFirstOrThrow({ where: { gymId: gym.id } });
    expect(saved).toMatchObject({
      name: 'Hammer upper pulldown (plate-loaded)',
      manufacturer: null,
      modelName: null,
      loadConfigurationKnown: false,
      weightOptions: [],
    });

    const context = await getExternalAiImportContext(user.id, { gymId: gym.id });
    expect(context.gym.equipment[0]?.loadFacts).toMatchObject({ state: 'UNKNOWN' });
  });

  it('validates gym ownership and exercise/equipment compatibility before binding', async () => {
    const owner = await seedUser('owner-bind');
    const foreign = await seedUser('foreign-bind');
    const cableExercise = await seedExercise(owner.user.id, 'Cable pulldown', 'CABLE');
    const machine = await db.gymEquipment.create({
      data: { gymId: owner.gym.id, name: 'Machine pulldown', equipmentType: 'MACHINE' },
    });
    const foreignMachine = await db.gymEquipment.create({
      data: { gymId: foreign.gym.id, name: 'Foreign machine', equipmentType: 'CABLE' },
    });

    await expect(
      bindCompatibleExerciseEquipment(owner.user.id, {
        gymId: owner.gym.id,
        exerciseId: cableExercise.id,
        equipmentId: machine.id,
      }),
    ).rejects.toThrow('incompatible');

    await expect(
      bindCompatibleExerciseEquipment(owner.user.id, {
        gymId: owner.gym.id,
        exerciseId: cableExercise.id,
        equipmentId: foreignMachine.id,
      }),
    ).rejects.toThrow('Gym equipment not found.');
  });

  it('makes workout import idempotent and rejects operation-id payload changes', async () => {
    const { user, gym } = await seedUser('idempotency');
    const exercise = await seedExercise(user.id, 'Pulldown');
    const operation = {
      operationId: 'import-idempotency-001',
      gymId: gym.id,
      startedAt: '2026-09-05T09:00:00+05:00',
      finishedAt: '2026-09-05T09:45:00+05:00',
      sets: [{ exerciseId: exercise.id, setNumber: 1, weight: 25, reps: 9, rir: 1 }],
    };

    const first = await importOrUpdateWorkoutData(user.id, 'token-owner', operation);
    const replay = await importOrUpdateWorkoutData(user.id, 'token-owner', operation);
    expect(first.idempotentReplay).toBe(false);
    expect('sessionId' in first).toBe(true);
    if (!('sessionId' in first)) throw new Error('Expected a newly imported session.');
    expect(replay).toMatchObject({ sessionId: first.sessionId, idempotentReplay: true });
    expect(await db.session.count({ where: { userId: user.id } })).toBe(1);
    expect(await db.set.count({ where: { sessionId: first.sessionId } })).toBe(1);

    await expect(
      importOrUpdateWorkoutData(user.id, 'token-owner', {
        ...operation,
        sets: [{ exerciseId: exercise.id, setNumber: 1, weight: 30, reps: 9, rir: 1 }],
      }),
    ).rejects.toThrow('different payload');

    const concurrentOperation = { ...operation, operationId: 'import-idempotency-concurrent-001' };
    const [concurrentA, concurrentB] = await Promise.all([
      importOrUpdateWorkoutData(user.id, 'token-owner', concurrentOperation),
      importOrUpdateWorkoutData(user.id, 'token-owner', concurrentOperation),
    ]);
    expect([concurrentA.idempotentReplay, concurrentB.idempotentReplay].sort()).toEqual([
      false,
      true,
    ]);
    expect(await db.session.count({ where: { userId: user.id } })).toBe(2);
  });

  it('rejects an existing-session gym mismatch and explicit wrong-gym equipment', async () => {
    const owner = await seedUser('session-scope');
    const otherGym = await db.gym.create({ data: { userId: owner.user.id, name: 'Other owned gym' } });
    const exercise = await seedExercise(owner.user.id, 'Scoped pulldown');
    const session = await db.session.create({
      data: { userId: owner.user.id, gymId: owner.gym.id, startedAt: new Date('2026-09-05T04:00:00Z') },
    });
    const otherEquipment = await db.gymEquipment.create({
      data: { gymId: otherGym.id, name: 'Other gym machine', equipmentType: 'MACHINE' },
    });
    await db.gymEquipmentExercise.create({ data: { equipmentId: otherEquipment.id, exerciseId: exercise.id } });

    await expect(
      importOrUpdateWorkoutData(owner.user.id, 'token-owner', {
        operationId: 'session-gym-mismatch-001',
        sessionId: session.id,
        gymId: otherGym.id,
        startedAt: '2026-09-05T09:00:00+05:00',
        sets: [{ exerciseId: exercise.id, setNumber: 1, weight: 20, reps: 10 }],
      }),
    ).rejects.toThrow('session gym');

    await expect(
      importOrUpdateWorkoutData(owner.user.id, 'token-owner', {
        operationId: 'wrong-gym-equipment-001',
        sessionId: session.id,
        gymId: owner.gym.id,
        startedAt: '2026-09-05T09:00:00+05:00',
        sets: [{ exerciseId: exercise.id, gymEquipmentId: otherEquipment.id, setNumber: 1, weight: 20, reps: 10 }],
      }),
    ).rejects.toThrow('session gym');
  });

  it('clears stale equipment when an existing set changes to an incompatible exercise and equipment is omitted', async () => {
    const { user, gym } = await seedUser('stale-equipment');
    const machineExercise = await seedExercise(user.id, 'Machine upper pulldown', 'MACHINE');
    const cableExercise = await seedExercise(user.id, 'Cable upper pulldown', 'CABLE');
    const machine = await db.gymEquipment.create({
      data: { gymId: gym.id, name: 'Plate-loaded pulldown', equipmentType: 'MACHINE' },
    });
    await db.gymEquipmentExercise.create({ data: { equipmentId: machine.id, exerciseId: machineExercise.id } });
    const session = await db.session.create({
      data: { userId: user.id, gymId: gym.id, startedAt: new Date('2026-09-05T04:00:00Z') },
    });
    const set = await db.set.create({
      data: {
        sessionId: session.id,
        exerciseId: machineExercise.id,
        gymEquipmentId: machine.id,
        equipmentNameSnapshot: machine.name,
        equipmentLoadSnapshot: { version: 1 },
        setNumber: 1,
        weight: 25,
        reps: 9,
      },
    });

    await importOrUpdateWorkoutData(user.id, 'token-owner', {
      operationId: 'replace-exercise-clear-stale-equipment',
      sessionId: session.id,
      gymId: gym.id,
      startedAt: '2026-09-05T09:00:00+05:00',
      sets: [{ id: set.id, exerciseId: cableExercise.id, setNumber: 1, weight: 25, reps: 9 }],
    });

    const updated = await db.set.findUniqueOrThrow({ where: { id: set.id } });
    expect(updated.exerciseId).toBe(cableExercise.id);
    expect(updated.gymEquipmentId).toBeNull();
    expect(updated.equipmentNameSnapshot).toBeNull();
    expect(updated.equipmentLoadSnapshot).toBeNull();
  });
});
