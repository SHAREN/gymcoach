import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';

vi.mock('@/lib/auth', () => ({ getCurrentUserId: vi.fn() }));
const mockUserId = vi.mocked(getCurrentUserId);

import { POST as startSession } from '@/app/api/sessions/route';
import { POST as addSessionExercise } from '@/app/api/sessions/[id]/exercises/route';

function jsonReq(body: unknown): Request {
  return new Request('http://test.local/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function idParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  mockUserId.mockReset();
});

describe('free workout sessions', () => {
  it('creates a free session atomically with the first selected exercise', async () => {
    const user = await db.user.create({
      data: { email: 'free-start@test.dev', passwordHash: 'x' },
    });
    const exercise = await db.exercise.create({
      data: {
        userId: user.id,
        name: 'Initial free bench',
        muscleGroup: 'CHEST',
        category: 'COMPOUND',
        defaultRestSec: 140,
      },
    });
    mockUserId.mockResolvedValue(user.id);

    const response = await startSession(jsonReq({ initialExerciseId: exercise.id }));
    expect(response.status).toBe(201);
    const body = (await response.json()) as { id: string };
    const session = await db.session.findUnique({
      where: { id: body.id },
      include: { sessionExercises: true },
    });

    expect(session?.programId).toBeNull();
    expect(session?.workoutId).toBeNull();
    expect(session?.sessionExercises).toEqual([
      expect.objectContaining({
        exerciseId: exercise.id,
        ordinal: 0,
        targetSets: 4,
        targetRepsMin: 8,
        targetRepsMax: 12,
        targetRIR: 2,
        restSec: 140,
      }),
    ]);
  });

  it('does not create an empty free session when no first exercise was chosen', async () => {
    const user = await db.user.create({
      data: { email: 'free-empty@test.dev', passwordHash: 'x' },
    });
    mockUserId.mockResolvedValue(user.id);

    const before = await db.session.count({ where: { userId: user.id } });
    const response = await startSession(jsonReq({}));

    expect(response.status).toBe(400);
    expect(await db.session.count({ where: { userId: user.id } })).toBe(before);
  });

  it('rejects an invalid initial exercise without leaving a session behind', async () => {
    const user = await db.user.create({
      data: { email: 'free-invalid-start@test.dev', passwordHash: 'x' },
    });
    mockUserId.mockResolvedValue(user.id);

    const response = await startSession(jsonReq({ initialExerciseId: 'missing-exercise' }));

    expect(response.status).toBe(400);
    expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it('adds exercises to the free session without creating or changing ProgramExercise rows', async () => {
    const user = await db.user.create({ data: { email: 'free-add@test.dev', passwordHash: 'x' } });
    const exercise = await db.exercise.create({
      data: {
        userId: user.id,
        name: 'Free session bench',
        muscleGroup: 'CHEST',
        category: 'COMPOUND',
        defaultRestSec: 150,
      },
    });
    const session = await db.session.create({ data: { userId: user.id } });
    mockUserId.mockResolvedValue(user.id);

    const beforeProgramExercises = await db.programExercise.count();
    const response = await addSessionExercise(
      jsonReq({ exerciseId: exercise.id }),
      idParams(session.id),
    );
    expect(response.status).toBe(201);

    const created = await db.sessionExercise.findUnique({
      where: { sessionId_exerciseId: { sessionId: session.id, exerciseId: exercise.id } },
    });
    expect(created).toMatchObject({
      sessionId: session.id,
      exerciseId: exercise.id,
      ordinal: 0,
      targetSets: 4,
      targetRepsMin: 8,
      targetRepsMax: 12,
      targetRIR: 2,
      restSec: 150,
    });
    expect(await db.programExercise.count()).toBe(beforeProgramExercises);
  });

  it('does not allow the session-local endpoint to mutate a programmed workout', async () => {
    const user = await db.user.create({
      data: { email: 'free-guard@test.dev', passwordHash: 'x' },
    });
    const exercise = await db.exercise.create({
      data: { userId: user.id, name: 'Guard bench', muscleGroup: 'CHEST', category: 'COMPOUND' },
    });
    const program = await db.program.create({
      data: { userId: user.id, name: 'Program', phase: 'test' },
    });
    const workout = await db.workout.create({
      data: { programId: program.id, name: 'Day', order: 0 },
    });
    const session = await db.session.create({
      data: { userId: user.id, programId: program.id, workoutId: workout.id },
    });
    mockUserId.mockResolvedValue(user.id);

    const response = await addSessionExercise(
      jsonReq({ exerciseId: exercise.id }),
      idParams(session.id),
    );
    expect(response.status).toBe(400);
    expect(await db.sessionExercise.count()).toBe(0);
  });

  it('rejects adding an exercise through another user session id', async () => {
    const owner = await db.user.create({
      data: { email: 'free-owner@test.dev', passwordHash: 'x' },
    });
    const stranger = await db.user.create({
      data: { email: 'free-stranger@test.dev', passwordHash: 'x' },
    });
    const exercise = await db.exercise.create({
      data: {
        userId: stranger.id,
        name: 'Stranger exercise',
        muscleGroup: 'BACK_WIDTH',
        category: 'COMPOUND',
      },
    });
    const ownerSession = await db.session.create({ data: { userId: owner.id } });
    mockUserId.mockResolvedValue(stranger.id);

    const response = await addSessionExercise(
      jsonReq({ exerciseId: exercise.id }),
      idParams(ownerSession.id),
    );

    expect(response.status).toBe(404);
    expect(await db.sessionExercise.count()).toBe(0);
  });
});

// Backup v10 must preserve the free-session plan itself, not just logged sets.
describe('free workout backup', () => {
  it('round-trips selected exercises even when no sets were logged yet', async () => {
    const { GET: getBackup, POST: restoreBackup } = await import('@/app/api/backup/route');
    const source = await db.user.create({
      data: { email: 'free-backup-source@test.dev', passwordHash: 'x' },
    });
    const exercise = await db.exercise.create({
      data: {
        userId: source.id,
        name: 'Backup-only free bench',
        muscleGroup: 'CHEST',
        category: 'COMPOUND',
        defaultRestSec: 135,
      },
    });
    const sourceSession = await db.session.create({ data: { userId: source.id } });
    await db.sessionExercise.create({
      data: {
        sessionId: sourceSession.id,
        exerciseId: exercise.id,
        ordinal: 0,
        targetSets: 5,
        targetRepsMin: 6,
        targetRepsMax: 10,
        targetRIR: 1,
        restSec: 135,
        notes: 'coach picked this today',
      },
    });
    mockUserId.mockResolvedValue(source.id);

    const exportResponse = await getBackup();
    expect(exportResponse.status).toBe(200);
    const dump = await exportResponse.json();
    expect(dump.version).toBe(10);
    expect(dump.sessions).toHaveLength(1);
    expect(dump.sessions[0].workoutName).toBeNull();
    expect(dump.sessions[0].sets).toHaveLength(0);
    expect(dump.sessions[0].exercises).toEqual([
      expect.objectContaining({
        exerciseName: 'Backup-only free bench',
        order: 0,
        targetSets: 5,
        targetRepsMin: 6,
        targetRepsMax: 10,
        targetRIR: 1,
        restSec: 135,
        notes: 'coach picked this today',
      }),
    ]);

    const target = await db.user.create({
      data: { email: 'free-backup-target@test.dev', passwordHash: 'x' },
    });
    mockUserId.mockResolvedValue(target.id);
    const restoreResponse = await restoreBackup(
      new Request('http://test.local/api/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: dump, confirmReplace: true }),
      }),
    );
    expect(restoreResponse.status).toBe(200);

    const restoredSessions = await db.session.findMany({
      where: { userId: target.id },
      include: { sessionExercises: { include: { exercise: true } }, sets: true },
    });
    expect(restoredSessions).toHaveLength(1);
    expect(restoredSessions[0]?.programId).toBeNull();
    expect(restoredSessions[0]?.workoutId).toBeNull();
    expect(restoredSessions[0]?.sets).toHaveLength(0);
    expect(restoredSessions[0]?.sessionExercises).toHaveLength(1);
    expect(restoredSessions[0]?.sessionExercises[0]).toMatchObject({
      ordinal: 0,
      targetSets: 5,
      targetRepsMin: 6,
      targetRepsMax: 10,
      targetRIR: 1,
      restSec: 135,
      notes: 'coach picked this today',
    });
    expect(restoredSessions[0]?.sessionExercises[0]?.exercise.name).toBe('Backup-only free bench');
  });
});
