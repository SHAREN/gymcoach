import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';
import { MAX_FREEFORM_EXERCISES } from '@/lib/schemas/session';

vi.mock('@/lib/auth', () => ({ getCurrentUserId: vi.fn() }));
const mockUserId = vi.mocked(getCurrentUserId);

import { POST as startSession } from '@/app/api/sessions/route';
import { POST as addExercise } from '@/app/api/sessions/[id]/exercises/route';
import { POST as createSet } from '@/app/api/sessions/[id]/sets/route';

function jsonReq(body: unknown): Request {
  return new Request('http://test.local/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  mockUserId.mockReset();
});

describe('freeform sessions', () => {
  it('starts without creating or attaching a program workout', async () => {
    const user = await db.user.create({ data: { email: 'free@test.dev', passwordHash: 'x' } });
    mockUserId.mockResolvedValue(user.id);

    const response = await startSession(jsonReq({ freeform: true }));
    expect(response.status).toBe(201);
    const body = (await response.json()) as { id: string };
    const session = await db.session.findUnique({ where: { id: body.id } });

    expect(session).toMatchObject({
      userId: user.id,
      programId: null,
      workoutId: null,
      freeExerciseIds: [],
    });
  });

  it('resumes the existing unfinished freeform session', async () => {
    const user = await db.user.create({
      data: { email: 'free-resume@test.dev', passwordHash: 'x' },
    });
    const existing = await db.session.create({ data: { userId: user.id } });
    mockUserId.mockResolvedValue(user.id);

    const response = await startSession(jsonReq({ freeform: true }));
    expect(response.status).toBe(200);
    expect(((await response.json()) as { id: string }).id).toBe(existing.id);
    expect(await db.session.count({ where: { userId: user.id, finishedAt: null } })).toBe(1);
  });

  it('adds owned exercises in order and ignores duplicate adds', async () => {
    const user = await db.user.create({
      data: { email: 'free-add@test.dev', passwordHash: 'x' },
    });
    const exercise = await db.exercise.create({
      data: {
        userId: user.id,
        name: 'Bench Press',
        muscleGroup: 'CHEST',
        category: 'COMPOUND',
      },
    });
    const session = await db.session.create({ data: { userId: user.id } });
    mockUserId.mockResolvedValue(user.id);

    expect(
      (await addExercise(jsonReq({ exerciseId: exercise.id }), params(session.id))).status,
    ).toBe(201);
    expect(
      (await addExercise(jsonReq({ exerciseId: exercise.id }), params(session.id))).status,
    ).toBe(200);

    expect((await db.session.findUnique({ where: { id: session.id } }))?.freeExerciseIds).toEqual([
      exercise.id,
    ]);
  });

  it('preserves distinct exercises added concurrently', async () => {
    const user = await db.user.create({
      data: { email: 'free-concurrent@test.dev', passwordHash: 'x' },
    });
    const exercises = await Promise.all(
      ['Concurrent Press', 'Concurrent Row'].map((name, index) =>
        db.exercise.create({
          data: {
            userId: user.id,
            name,
            muscleGroup: index === 0 ? 'CHEST' : 'BACK_WIDTH',
            category: 'COMPOUND',
          },
        }),
      ),
    );
    const session = await db.session.create({ data: { userId: user.id } });
    mockUserId.mockResolvedValue(user.id);

    const responses = await Promise.all(
      exercises.map((exercise) =>
        addExercise(jsonReq({ exerciseId: exercise.id }), params(session.id)),
      ),
    );
    expect(responses.map((response) => response.status)).toEqual([201, 201]);

    const stored = (await db.session.findUnique({ where: { id: session.id } }))?.freeExerciseIds ?? [];
    expect(new Set(stored)).toEqual(new Set(exercises.map((exercise) => exercise.id)));
    expect(stored).toHaveLength(2);
  });

  it('does not allow adding another user exercise', async () => {
    const owner = await db.user.create({
      data: { email: 'owner-free@test.dev', passwordHash: 'x' },
    });
    const stranger = await db.user.create({
      data: { email: 'stranger-free@test.dev', passwordHash: 'x' },
    });
    const exercise = await db.exercise.create({
      data: {
        userId: stranger.id,
        name: 'Private Row',
        muscleGroup: 'BACK_WIDTH',
        category: 'COMPOUND',
      },
    });
    const session = await db.session.create({ data: { userId: owner.id } });
    mockUserId.mockResolvedValue(owner.id);

    const response = await addExercise(jsonReq({ exerciseId: exercise.id }), params(session.id));
    expect(response.status).toBe(404);
    expect((await db.session.findUnique({ where: { id: session.id } }))?.freeExerciseIds).toEqual([]);
  });

  it('does not allow adding to another user session', async () => {
    const owner = await db.user.create({
      data: { email: 'foreign-session-owner@test.dev', passwordHash: 'x' },
    });
    const attacker = await db.user.create({
      data: { email: 'foreign-session-attacker@test.dev', passwordHash: 'x' },
    });
    const exercise = await db.exercise.create({
      data: {
        userId: attacker.id,
        name: 'Attacker Press',
        muscleGroup: 'CHEST',
        category: 'COMPOUND',
      },
    });
    const session = await db.session.create({ data: { userId: owner.id } });
    mockUserId.mockResolvedValue(attacker.id);

    const response = await addExercise(jsonReq({ exerciseId: exercise.id }), params(session.id));
    expect(response.status).toBe(404);
    expect((await db.session.findUnique({ where: { id: session.id } }))?.freeExerciseIds).toEqual([]);
  });

  it('rejects additions after the freeform exercise cap', async () => {
    const user = await db.user.create({
      data: { email: 'free-cap@test.dev', passwordHash: 'x' },
    });
    const exercise = await db.exercise.create({
      data: {
        userId: user.id,
        name: 'One Too Many',
        muscleGroup: 'OTHER',
        category: 'ISOLATION',
      },
    });
    const session = await db.session.create({
      data: {
        userId: user.id,
        freeExerciseIds: Array.from(
          { length: MAX_FREEFORM_EXERCISES },
          (_, index) => `existing-${index}`,
        ),
      },
    });
    mockUserId.mockResolvedValue(user.id);

    const response = await addExercise(jsonReq({ exerciseId: exercise.id }), params(session.id));
    expect(response.status).toBe(400);
    expect((await db.session.findUnique({ where: { id: session.id } }))?.freeExerciseIds).toHaveLength(
      MAX_FREEFORM_EXERCISES,
    );
  });

  it('does not add exercises to programmed sessions', async () => {
    const user = await db.user.create({
      data: { email: 'programmed-add@test.dev', passwordHash: 'x' },
    });
    const exercise = await db.exercise.create({
      data: {
        userId: user.id,
        name: 'Programmed Press',
        muscleGroup: 'CHEST',
        category: 'COMPOUND',
      },
    });
    const program = await db.program.create({
      data: {
        userId: user.id,
        name: 'Programmed Guard',
        phase: 'base',
        workouts: { create: { name: 'Day A', order: 0 } },
      },
      include: { workouts: true },
    });
    const session = await db.session.create({
      data: {
        userId: user.id,
        programId: program.id,
        workoutId: program.workouts[0]!.id,
      },
    });
    mockUserId.mockResolvedValue(user.id);

    const response = await addExercise(jsonReq({ exerciseId: exercise.id }), params(session.id));
    expect(response.status).toBe(400);
  });

  it('does not add exercises to finished freeform sessions', async () => {
    const user = await db.user.create({
      data: { email: 'free-finished@test.dev', passwordHash: 'x' },
    });
    const exercise = await db.exercise.create({
      data: {
        userId: user.id,
        name: 'Late Press',
        muscleGroup: 'CHEST',
        category: 'COMPOUND',
      },
    });
    const session = await db.session.create({
      data: { userId: user.id, finishedAt: new Date() },
    });
    mockUserId.mockResolvedValue(user.id);

    const response = await addExercise(jsonReq({ exerciseId: exercise.id }), params(session.id));
    expect(response.status).toBe(400);
  });

  it('logs sets only for exercises explicitly added to the freeform session', async () => {
    const user = await db.user.create({
      data: { email: 'free-set@test.dev', passwordHash: 'x' },
    });
    const selected = await db.exercise.create({
      data: {
        userId: user.id,
        name: 'Selected Press',
        muscleGroup: 'CHEST',
        category: 'COMPOUND',
      },
    });
    const unselected = await db.exercise.create({
      data: {
        userId: user.id,
        name: 'Unselected Row',
        muscleGroup: 'BACK_WIDTH',
        category: 'COMPOUND',
      },
    });
    const session = await db.session.create({
      data: { userId: user.id, freeExerciseIds: [selected.id] },
    });
    mockUserId.mockResolvedValue(user.id);

    const selectedResponse = await createSet(
      jsonReq({
        exerciseId: selected.id,
        setNumber: 1,
        weight: 80,
        reps: 8,
        rir: 2,
      }),
      params(session.id),
    );
    expect(selectedResponse.status).toBe(201);

    const unselectedResponse = await createSet(
      jsonReq({
        exerciseId: unselected.id,
        setNumber: 1,
        weight: 60,
        reps: 10,
        rir: 2,
      }),
      params(session.id),
    );
    expect(unselectedResponse.status).toBe(400);

    expect(await db.set.count({ where: { sessionId: session.id } })).toBe(1);
  });
});
