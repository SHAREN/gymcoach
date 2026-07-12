import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';

// Supersets slice 1 (issue #146): the supersetGroup column rides the existing
// program-exercise routes. Pinned here: persistence on create and update, the
// absent-vs-null update semantics (absent preserves, null unpairs), the Zod
// bounds, and that ownership still gates the write.

vi.mock('@/lib/auth', () => ({ getCurrentUserId: vi.fn() }));
const mockUserId = vi.mocked(getCurrentUserId);

import { POST as postProgramExercise } from '@/app/api/workouts/[id]/program-exercises/route';
import { PUT as putProgramExercise } from '@/app/api/program-exercises/[id]/route';
import { POST as mutateSuperset } from '@/app/api/program-exercises/[id]/superset/route';

function actAs(userId: string) {
  mockUserId.mockResolvedValue(userId);
}

function jsonReq(method: string, body: unknown): Request {
  return new Request('http://test.local/api', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const targets = {
  targetSets: 3,
  targetRepsMin: 8,
  targetRepsMax: 12,
  targetRIR: 2,
  restSec: 90,
};

async function seed(email: string) {
  const user = await db.user.create({ data: { email, passwordHash: 'x' } });
  const bench = await db.exercise.create({
    data: { userId: user.id, name: 'Bench', muscleGroup: 'CHEST', category: 'COMPOUND' },
  });
  const row = await db.exercise.create({
    data: { userId: user.id, name: 'Row', muscleGroup: 'BACK_THICKNESS', category: 'COMPOUND' },
  });
  const program = await db.program.create({
    data: { userId: user.id, name: 'P', phase: 'Base' },
  });
  const workout = await db.workout.create({
    data: { programId: program.id, name: 'Day A', order: 1 },
  });
  return { user, bench, row, workout };
}

beforeEach(() => {
  mockUserId.mockReset();
});

describe('program-exercise routes - supersetGroup (issue #146)', () => {
  it('creates with a group, and defaults to null (standalone) when absent', async () => {
    const { user, bench, row, workout } = await seed('superset-create@test.dev');
    actAs(user.id);

    const standalone = await postProgramExercise(
      jsonReq('POST', { exerciseId: bench.id, ...targets }),
      { params: Promise.resolve({ id: workout.id }) },
    );
    expect(standalone.status).toBe(201);
    expect((await standalone.json()).supersetGroup).toBeNull();

    const paired = await postProgramExercise(
      jsonReq('POST', { exerciseId: row.id, ...targets, targetDropSets: 2, supersetGroup: 2 }),
      { params: Promise.resolve({ id: workout.id }) },
    );
    expect(paired.status).toBe(201);
    const pairedBody = await paired.json();
    expect(pairedBody.supersetGroup).toBe(2);
    expect(pairedBody.targetDropSets).toBe(2);
  });

  it('updates: number pairs, absent preserves, null unpairs', async () => {
    const { user, bench, workout } = await seed('superset-update@test.dev');
    actAs(user.id);
    const pe = await db.programExercise.create({
      data: { workoutId: workout.id, exerciseId: bench.id, order: 1, ...targets },
    });

    // Pair and configure planned drop sets.
    const pairRes = await putProgramExercise(
      jsonReq('PUT', { exerciseId: bench.id, ...targets, targetDropSets: 2, supersetGroup: 1 }),
      { params: Promise.resolve({ id: pe.id }) },
    );
    expect(pairRes.status).toBe(200);
    const paired = await pairRes.json();
    expect(paired.supersetGroup).toBe(1);
    expect(paired.targetDropSets).toBe(2);

    // An update WITHOUT either optional field must preserve both.
    const editRes = await putProgramExercise(
      jsonReq('PUT', { exerciseId: bench.id, ...targets, targetSets: 4 }),
      { params: Promise.resolve({ id: pe.id }) },
    );
    expect(editRes.status).toBe(200);
    const edited = await editRes.json();
    expect(edited.targetSets).toBe(4);
    expect(edited.supersetGroup).toBe(1);
    expect(edited.targetDropSets).toBe(2);

    // Explicit null unpairs.
    const unpairRes = await putProgramExercise(
      jsonReq('PUT', { exerciseId: bench.id, ...targets, supersetGroup: null }),
      { params: Promise.resolve({ id: pe.id }) },
    );
    expect(unpairRes.status).toBe(200);
    expect((await unpairRes.json()).supersetGroup).toBeNull();
  });

  it('rejects out-of-bounds groups with a 400', async () => {
    const { user, bench, workout } = await seed('superset-bounds@test.dev');
    actAs(user.id);

    const res = await postProgramExercise(
      jsonReq('POST', { exerciseId: bench.id, ...targets, supersetGroup: 10 }),
      { params: Promise.resolve({ id: workout.id }) },
    );
    expect(res.status).toBe(400);
  });

  it('still gates the update on ownership (404 for another user)', async () => {
    const { user, bench, workout } = await seed('superset-owner@test.dev');
    const intruder = await db.user.create({
      data: { email: 'superset-intruder@test.dev', passwordHash: 'x' },
    });
    const pe = await db.programExercise.create({
      data: { workoutId: workout.id, exerciseId: bench.id, order: 1, ...targets },
    });

    actAs(intruder.id);
    const res = await putProgramExercise(
      jsonReq('PUT', { exerciseId: bench.id, ...targets, supersetGroup: 1 }),
      { params: Promise.resolve({ id: pe.id }) },
    );
    expect(res.status).toBe(404);
    expect(
      (await db.programExercise.findUnique({ where: { id: pe.id } }))?.supersetGroup,
    ).toBeNull();
    void user;
  });
});

describe('atomic in-session superset actions', () => {
  it('links two standalone neighbors with one fresh group', async () => {
    const { user, bench, row, workout } = await seed('superset-link@test.dev');
    actAs(user.id);
    const first = await db.programExercise.create({
      data: { workoutId: workout.id, exerciseId: bench.id, order: 1, ...targets },
    });
    const second = await db.programExercise.create({
      data: { workoutId: workout.id, exerciseId: row.id, order: 2, ...targets },
    });

    const res = await mutateSuperset(jsonReq('POST', { action: 'link', neighborId: second.id }), {
      params: Promise.resolve({ id: first.id }),
    });

    expect(res.status).toBe(200);
    const rows = await db.programExercise.findMany({
      where: { workoutId: workout.id },
      orderBy: { order: 'asc' },
    });
    expect(rows.map((item) => item.supersetGroup)).toEqual([1, 1]);
  });

  it('merges two existing groups without leaving partial membership', async () => {
    const { user, bench, row, workout } = await seed('superset-merge@test.dev');
    actAs(user.id);
    const extraA = await db.exercise.create({
      data: { userId: user.id, name: 'Curl', muscleGroup: 'BICEPS', category: 'ISOLATION' },
    });
    const extraB = await db.exercise.create({
      data: { userId: user.id, name: 'Extension', muscleGroup: 'TRICEPS', category: 'ISOLATION' },
    });
    const members = await Promise.all([
      db.programExercise.create({
        data: {
          workoutId: workout.id,
          exerciseId: bench.id,
          order: 1,
          supersetGroup: 1,
          ...targets,
        },
      }),
      db.programExercise.create({
        data: { workoutId: workout.id, exerciseId: row.id, order: 2, supersetGroup: 1, ...targets },
      }),
      db.programExercise.create({
        data: {
          workoutId: workout.id,
          exerciseId: extraA.id,
          order: 3,
          supersetGroup: 2,
          ...targets,
        },
      }),
      db.programExercise.create({
        data: {
          workoutId: workout.id,
          exerciseId: extraB.id,
          order: 4,
          supersetGroup: 2,
          ...targets,
        },
      }),
    ]);

    const res = await mutateSuperset(
      jsonReq('POST', { action: 'link', neighborId: members[2]!.id }),
      { params: Promise.resolve({ id: members[1]!.id }) },
    );

    expect(res.status).toBe(200);
    const rows = await db.programExercise.findMany({ where: { workoutId: workout.id } });
    expect(new Set(rows.map((item) => item.supersetGroup))).toEqual(new Set([2]));
  });

  it('dissolves the whole current superset and enforces ownership', async () => {
    const { user, bench, row, workout } = await seed('superset-dissolve@test.dev');
    const stranger = await db.user.create({
      data: { email: 'superset-action-stranger@test.dev', passwordHash: 'x' },
    });
    const first = await db.programExercise.create({
      data: {
        workoutId: workout.id,
        exerciseId: bench.id,
        order: 1,
        supersetGroup: 3,
        ...targets,
      },
    });
    await db.programExercise.create({
      data: {
        workoutId: workout.id,
        exerciseId: row.id,
        order: 2,
        supersetGroup: 3,
        ...targets,
      },
    });

    actAs(stranger.id);
    const denied = await mutateSuperset(jsonReq('POST', { action: 'dissolve' }), {
      params: Promise.resolve({ id: first.id }),
    });
    expect(denied.status).toBe(404);

    actAs(user.id);
    const res = await mutateSuperset(jsonReq('POST', { action: 'dissolve' }), {
      params: Promise.resolve({ id: first.id }),
    });
    expect(res.status).toBe(200);
    const rows = await db.programExercise.findMany({ where: { workoutId: workout.id } });
    expect(rows.every((item) => item.supersetGroup == null)).toBe(true);
  });
});
