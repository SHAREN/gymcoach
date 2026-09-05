import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';

vi.mock('@/lib/auth', () => ({ getCurrentUserId: vi.fn() }));
const mockUserId = vi.mocked(getCurrentUserId);

import { POST as createSet } from '@/app/api/sessions/[id]/sets/route';

function request(body: unknown): Request {
  return new Request('http://test.local/api/session/sets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function seed() {
  const suffix = `${Date.now()}-${Math.random()}`;
  const user = await db.user.create({
    data: { email: `web-idempotency-${suffix}@test.dev`, passwordHash: 'x' },
  });
  const exercise = await db.exercise.create({
    data: {
      userId: user.id,
      name: `Cable row ${suffix}`,
      muscleGroup: 'BACK_THICKNESS',
      category: 'COMPOUND',
      equipmentType: 'CABLE',
    },
  });
  const gym = await db.gym.create({ data: { userId: user.id, name: `Replay gym ${suffix}` } });
  const equipment = await db.gymEquipment.create({
    data: {
      gymId: gym.id,
      name: `Replay cable ${suffix}`,
      equipmentType: 'CABLE',
      exerciseLinks: { create: { exerciseId: exercise.id } },
    },
  });
  const session = await db.session.create({ data: { userId: user.id, gymId: gym.id } });
  return { user, exercise, equipment, session };
}

beforeEach(() => mockUserId.mockReset());

describe('web set idempotency', () => {
  it('returns the original row for an exact client-ID replay and rejects a conflicting replay', async () => {
    const { user, exercise, equipment, session } = await seed();
    mockUserId.mockResolvedValue(user.id);
    const body = {
      id: 'loc_replay_exact',
      exerciseId: exercise.id,
      gymEquipmentId: equipment.id,
      setNumber: 1,
      weight: 80,
      reps: 8,
      rir: 2,
    };

    const first = await createSet(request(body), params(session.id));
    expect(first.status).toBe(201);
    expect((await first.json()).id).toBe(body.id);

    const replay = await createSet(request(body), params(session.id));
    expect(replay.status).toBe(200);
    expect((await replay.json()).id).toBe(body.id);
    expect(await db.set.count({ where: { sessionId: session.id } })).toBe(1);

    const conflict = await createSet(request({ ...body, reps: 9 }), params(session.id));
    expect(conflict.status).toBe(409);
    expect(await db.set.count({ where: { sessionId: session.id } })).toBe(1);
  });

  it('still acknowledges the original equipment identity after that equipment is deleted', async () => {
    const { user, exercise, equipment, session } = await seed();
    mockUserId.mockResolvedValue(user.id);
    const body = {
      id: 'loc_replay_deleted_equipment',
      exerciseId: exercise.id,
      gymEquipmentId: equipment.id,
      setNumber: 1,
      weight: 70,
      reps: 10,
      rir: 1,
    };

    expect((await createSet(request(body), params(session.id))).status).toBe(201);
    await db.gymEquipment.delete({ where: { id: equipment.id } });
    const persisted = await db.set.findUniqueOrThrow({ where: { id: body.id } });
    expect(persisted.gymEquipmentId).toBeNull();
    expect(persisted.equipmentLoadSnapshot).toMatchObject({ gymEquipmentId: equipment.id });

    const replay = await createSet(request(body), params(session.id));
    expect(replay.status).toBe(200);
    expect((await replay.json()).id).toBe(body.id);
    expect(await db.set.count({ where: { sessionId: session.id } })).toBe(1);
  });

  it('replays a stale optional equipment reference as the same canonical no-equipment set', async () => {
    const { user, exercise, session } = await seed();
    mockUserId.mockResolvedValue(user.id);
    const body = {
      id: 'loc_replay_stale_equipment',
      exerciseId: exercise.id,
      gymEquipmentId: 'equipment-that-never-existed',
      setNumber: 1,
      weight: 60,
      reps: 12,
      rir: 2,
    };

    const first = await createSet(request(body), params(session.id));
    expect(first.status).toBe(201);
    expect((await first.json()).gymEquipmentId).toBeNull();

    const replay = await createSet(request(body), params(session.id));
    expect(replay.status).toBe(200);
    expect((await replay.json()).gymEquipmentId).toBeNull();
    expect(await db.set.count({ where: { sessionId: session.id } })).toBe(1);
  });
});
