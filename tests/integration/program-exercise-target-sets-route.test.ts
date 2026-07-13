import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';

vi.mock('@/lib/auth', () => ({ getCurrentUserId: vi.fn() }));
const mockUserId = vi.mocked(getCurrentUserId);

import { PATCH as patchProgramExercise } from '@/app/api/program-exercises/[id]/route';

beforeEach(() => {
  mockUserId.mockReset();
});

function request(targetSets: unknown): Request {
  return new Request('http://test.local/api/program-exercises/pe', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetSets }),
  });
}

async function seedProgramExercise(email: string) {
  const user = await db.user.create({ data: { email, passwordHash: 'x' } });
  const exercise = await db.exercise.create({
    data: {
      userId: user.id,
      name: `Bench ${email}`,
      muscleGroup: 'CHEST',
      category: 'COMPOUND',
    },
  });
  const program = await db.program.create({
    data: { userId: user.id, name: `Program ${email}`, phase: 'Base' },
  });
  const workout = await db.workout.create({
    data: { programId: program.id, name: 'Push', order: 1 },
  });
  const programExercise = await db.programExercise.create({
    data: {
      workoutId: workout.id,
      exerciseId: exercise.id,
      order: 1,
      targetSets: 3,
      targetRepsMin: 8,
      targetRepsMax: 12,
      targetRIR: 2,
      restSec: 120,
    },
  });
  return { user, programExercise };
}

describe('PATCH /api/program-exercises/[id]', () => {
  it('updates only the owned exercise target set count', async () => {
    const { user, programExercise } = await seedProgramExercise('pe-owner@test.dev');
    mockUserId.mockResolvedValue(user.id);

    const response = await patchProgramExercise(request('5'), {
      params: Promise.resolve({ id: programExercise.id }),
    });

    expect(response.status).toBe(200);
    expect((await response.json()).targetSets).toBe(5);
    expect(
      (await db.programExercise.findUniqueOrThrow({ where: { id: programExercise.id } }))
        .targetSets,
    ).toBe(5);
  });

  it('rejects invalid counts and exercises owned by another user', async () => {
    const owner = await seedProgramExercise('pe-owner-2@test.dev');
    const stranger = await db.user.create({
      data: { email: 'pe-stranger@test.dev', passwordHash: 'x' },
    });

    mockUserId.mockResolvedValue(owner.user.id);
    const invalid = await patchProgramExercise(request(0), {
      params: Promise.resolve({ id: owner.programExercise.id }),
    });
    expect(invalid.status).toBe(400);

    mockUserId.mockResolvedValue(stranger.id);
    const forbidden = await patchProgramExercise(request(5), {
      params: Promise.resolve({ id: owner.programExercise.id }),
    });
    expect(forbidden.status).toBe(404);
  });
});
