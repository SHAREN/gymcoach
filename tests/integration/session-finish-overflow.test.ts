import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';

vi.mock('@/lib/auth', () => ({ getCurrentUserId: vi.fn() }));
const mockUserId = vi.mocked(getCurrentUserId);

import { PUT as updateSession } from '@/app/api/sessions/[id]/route';

beforeEach(() => {
  mockUserId.mockReset();
});

describe('PUT /api/sessions/[id] finish overflow', () => {
  it('deletes only the explicitly discarded sets from the owned session', async () => {
    const user = await db.user.create({
      data: { email: 'session-finish-owner@test.dev', passwordHash: 'x' },
    });
    const otherUser = await db.user.create({
      data: { email: 'session-finish-other@test.dev', passwordHash: 'x' },
    });
    const exercise = await db.exercise.create({
      data: {
        userId: user.id,
        name: 'Session finish bench',
        muscleGroup: 'CHEST',
        category: 'COMPOUND',
      },
    });
    const session = await db.session.create({ data: { userId: user.id } });
    const otherSession = await db.session.create({ data: { userId: otherUser.id } });
    const sets = await Promise.all(
      [1, 2, 3, 4].map((setNumber) =>
        db.set.create({
          data: {
            sessionId: session.id,
            exerciseId: exercise.id,
            setNumber,
            weight: 100,
            reps: 8,
          },
        }),
      ),
    );
    const otherSet = await db.set.create({
      data: {
        sessionId: otherSession.id,
        exerciseId: exercise.id,
        setNumber: 1,
        weight: 50,
        reps: 10,
      },
    });
    mockUserId.mockResolvedValue(user.id);

    const response = await updateSession(
      new Request(`http://test.local/api/sessions/${session.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          finish: true,
          discardSetIds: [sets[3]!.id, otherSet.id],
        }),
      }),
      { params: Promise.resolve({ id: session.id }) },
    );

    expect(response.status).toBe(200);
    expect(
      await db.set.findMany({ where: { sessionId: session.id }, orderBy: { setNumber: 'asc' } }),
    ).toHaveLength(3);
    expect(await db.set.findUnique({ where: { id: sets[3]!.id } })).toBeNull();
    expect(await db.set.findUnique({ where: { id: otherSet.id } })).not.toBeNull();
    expect(
      (await db.session.findUniqueOrThrow({ where: { id: session.id } })).finishedAt,
    ).not.toBeNull();
  });
});
