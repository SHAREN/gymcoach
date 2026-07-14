import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';

vi.mock('@/lib/auth', () => ({ getCurrentUserId: vi.fn() }));
const mockUserId = vi.mocked(getCurrentUserId);

import { POST as postSet } from '@/app/api/sessions/[id]/sets/route';

beforeEach(() => {
  mockUserId.mockReset();
});

async function seedSession() {
  const user = await db.user.create({
    data: { email: 'web-set-idempotency@test.dev', passwordHash: 'x' },
  });
  const exercise = await db.exercise.create({
    data: {
      userId: user.id,
      name: 'Idempotent bench press',
      muscleGroup: 'CHEST',
      category: 'COMPOUND',
    },
  });
  const session = await db.session.create({ data: { userId: user.id } });
  return { user, exercise, session };
}

function request(exerciseId: string, reps = 8) {
  return new Request('http://test.local/api/sessions/session/sets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: 'loc_set_retry_1',
      exerciseId,
      setNumber: 1,
      weight: 100,
      reps,
      rir: 2,
      isWarmup: false,
      isDropSet: false,
    }),
  });
}

describe('POST /api/sessions/[id]/sets idempotency', () => {
  it('stores a retried client set exactly once', async () => {
    const { user, exercise, session } = await seedSession();
    mockUserId.mockResolvedValue(user.id);

    const first = await postSet(request(exercise.id), {
      params: Promise.resolve({ id: session.id }),
    });
    const repeated = await postSet(request(exercise.id), {
      params: Promise.resolve({ id: session.id }),
    });

    expect(first.status).toBe(201);
    expect(repeated.status).toBe(200);
    expect((await first.json()).id).toBe('loc_set_retry_1');
    expect((await repeated.json()).id).toBe('loc_set_retry_1');
    expect(await db.set.count({ where: { sessionId: session.id } })).toBe(1);
  });

  it('rejects reuse of a client set id with different values', async () => {
    const { user, exercise, session } = await seedSession();
    mockUserId.mockResolvedValue(user.id);

    await postSet(request(exercise.id), { params: Promise.resolve({ id: session.id }) });
    const conflicting = await postSet(request(exercise.id, 9), {
      params: Promise.resolve({ id: session.id }),
    });

    expect(conflicting.status).toBe(409);
    expect(await db.set.count({ where: { sessionId: session.id } })).toBe(1);
  });
});
