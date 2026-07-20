import { describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import {
  generateMobileToken,
  hashMobileToken,
  mobileTokenExpiry,
  visibleMobileTokenPrefix,
} from '@/lib/mobile-auth';
import { GET as listPrograms, POST as createProgram } from '@/app/api/mobile/programs/route';
import {
  DELETE as deleteProgram,
  GET as getProgram,
  PUT as updateProgram,
} from '@/app/api/mobile/programs/[id]/route';
import { POST as activateProgram } from '@/app/api/mobile/programs/[id]/activate/route';
import { POST as createWorkout } from '@/app/api/mobile/programs/[id]/workouts/route';
import {
  DELETE as deleteWorkout,
  PUT as updateWorkout,
} from '@/app/api/mobile/workouts/[id]/route';
import { POST as createProgramExercise } from '@/app/api/mobile/workouts/[id]/program-exercises/route';
import {
  DELETE as deleteProgramExercise,
  PUT as updateProgramExercise,
} from '@/app/api/mobile/program-exercises/[id]/route';
import { GET as listExercises, POST as createExercise } from '@/app/api/mobile/exercises/route';
import {
  DELETE as deleteExercise,
  PUT as updateExercise,
} from '@/app/api/mobile/exercises/[id]/route';
import { reviewedExerciseLoadProfile } from '@/lib/schemas/exercise-load-profile';

function request(url: string, method = 'GET', token?: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function idempotentRequest(
  url: string,
  token: string,
  body: unknown,
  operationId: string,
  clientEntityId: string,
): Request {
  return new Request(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': operationId,
      'X-Client-Entity-Id': clientEntityId,
    },
    body: JSON.stringify(body),
  });
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function seedMobileUser(email = 'mobile-programs@test.dev') {
  const user = await db.user.create({
    data: { email, passwordHash: 'unused' },
  });
  const token = generateMobileToken();
  await db.mobileAccessToken.create({
    data: {
      userId: user.id,
      deviceId: 'mobile-programs-device',
      deviceName: 'Integration Android',
      tokenHash: hashMobileToken(token),
      tokenPrefix: visibleMobileTokenPrefix(token),
      expiresAt: mobileTokenExpiry(),
    },
  });
  return { user, token };
}

describe('Android programs and exercise catalog API', () => {
  it('requires a mobile bearer token', async () => {
    expect((await listPrograms(request('http://test/api/mobile/programs'))).status).toBe(401);
    expect((await listExercises(request('http://test/api/mobile/exercises'))).status).toBe(401);
  });

  it('returns one training timestamp per finished session and exercise', async () => {
    const { user, token } = await seedMobileUser('mobile-exercise-days@test.dev');
    const exercise = await db.exercise.create({
      data: {
        userId: user.id,
        name: 'Training day bench',
        muscleGroup: 'CHEST',
        category: 'COMPOUND',
      },
    });
    const firstFinished = await db.session.create({
      data: {
        userId: user.id,
        startedAt: new Date('2026-07-01T08:00:00.000Z'),
        finishedAt: new Date('2026-07-01T09:00:00.000Z'),
      },
    });
    const secondFinished = await db.session.create({
      data: {
        userId: user.id,
        startedAt: new Date('2026-07-01T18:00:00.000Z'),
        finishedAt: new Date('2026-07-01T19:00:00.000Z'),
      },
    });
    const unfinished = await db.session.create({
      data: {
        userId: user.id,
        startedAt: new Date('2026-07-03T08:00:00.000Z'),
      },
    });
    await db.set.createMany({
      data: [
        {
          sessionId: firstFinished.id,
          exerciseId: exercise.id,
          setNumber: 1,
          weight: 100,
          reps: 8,
        },
        {
          sessionId: firstFinished.id,
          exerciseId: exercise.id,
          setNumber: 2,
          weight: 100,
          reps: 8,
        },
        {
          sessionId: secondFinished.id,
          exerciseId: exercise.id,
          setNumber: 1,
          weight: 102.5,
          reps: 8,
        },
        { sessionId: unfinished.id, exerciseId: exercise.id, setNumber: 1, weight: 105, reps: 8 },
      ],
    });

    const response = await listExercises(request('http://test/api/mobile/exercises', 'GET', token));
    const catalog = (await response.json()) as Array<{ id: string; trainingDates: string[] }>;

    expect(response.status).toBe(200);
    expect(catalog.find((item) => item.id === exercise.id)?.trainingDates.sort()).toEqual([
      '2026-07-01T08:00:00.000Z',
      '2026-07-01T18:00:00.000Z',
    ]);
  });

  it('supports the complete native program and catalog editing flow', async () => {
    const { user, token } = await seedMobileUser();
    const exerciseResponse = await createExercise(
      request('http://test/api/mobile/exercises', 'POST', token, {
        name: 'Native bench press',
        muscleGroup: 'CHEST',
        category: 'COMPOUND',
        defaultRestSec: 120,
        equipmentType: 'BARBELL',
        usesBodyweight: false,
        notes: 'Catalog notes',
      }),
    );
    expect(exerciseResponse.status).toBe(201);
    const exercise = (await exerciseResponse.json()) as {
      id: string;
      loadProfile: { classification: string };
    };
    expect(exercise.loadProfile.classification).toBe('UNCLASSIFIED');
    await db.exercise.update({
      where: { id: exercise.id },
      data: {
        loadProfile: reviewedExerciseLoadProfile({
          primaryMuscles: ['CHEST'],
          secondaryMuscles: ['TRICEPS', 'SHOULDERS_FRONT'],
          movementPatterns: ['HORIZONTAL_PUSH'],
          fatigueTags: ['SYSTEMIC_COMPOUND'],
          jointStress: ['SHOULDER', 'ELBOW'],
        }),
      },
    });

    const programResponse = await createProgram(
      request('http://test/api/mobile/programs', 'POST', token, {
        name: 'Native program',
        phase: 'Base',
        description: 'Created on Android',
      }),
    );
    expect(programResponse.status).toBe(201);
    const program = (await programResponse.json()) as { id: string };

    const workoutResponse = await createWorkout(
      request(`http://test/api/mobile/programs/${program.id}/workouts`, 'POST', token, {
        name: 'Upper A',
        dayOfWeek: 1,
      }),
      params(program.id),
    );
    expect(workoutResponse.status).toBe(201);
    const workout = (await workoutResponse.json()) as { id: string };

    const targetResponse = await createProgramExercise(
      request(`http://test/api/mobile/workouts/${workout.id}/program-exercises`, 'POST', token, {
        exerciseId: exercise.id,
        targetSets: 4,
        targetDropSets: 1,
        targetRepsMin: 8,
        targetRepsMax: 10,
        targetRIR: 2,
        restSec: 120,
        tempo: '3-1-1-0',
        notes: 'Pause on chest',
        supersetGroup: 1,
      }),
      params(workout.id),
    );
    expect(targetResponse.status).toBe(201);
    const target = (await targetResponse.json()) as { id: string };

    const detailResponse = await getProgram(
      request(`http://test/api/mobile/programs/${program.id}`, 'GET', token),
      params(program.id),
    );
    expect(detailResponse.status).toBe(200);
    expect(await detailResponse.json()).toMatchObject({
      id: program.id,
      name: 'Native program',
      workouts: [
        {
          id: workout.id,
          name: 'Upper A',
          exercises: [
            {
              id: target.id,
              targetSets: 4,
              targetDropSets: 1,
              tempo: '3-1-1-0',
              supersetGroup: 1,
              exercise: { id: exercise.id, name: 'Native bench press' },
            },
          ],
        },
      ],
    });

    expect(
      (
        await activateProgram(
          request(`http://test/api/mobile/programs/${program.id}/activate`, 'POST', token, {
            active: true,
          }),
          params(program.id),
        )
      ).status,
    ).toBe(200);
    expect((await db.program.findUniqueOrThrow({ where: { id: program.id } })).isActive).toBe(true);

    expect(
      (
        await updateProgram(
          request(`http://test/api/mobile/programs/${program.id}`, 'PUT', token, {
            name: 'Native program 2',
            phase: 'Build',
            description: null,
          }),
          params(program.id),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await updateWorkout(
          request(`http://test/api/mobile/workouts/${workout.id}`, 'PUT', token, {
            name: 'Upper B',
            dayOfWeek: 2,
          }),
          params(workout.id),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await updateProgramExercise(
          request(`http://test/api/mobile/program-exercises/${target.id}`, 'PUT', token, {
            exerciseId: exercise.id,
            targetSets: 5,
            targetDropSets: 0,
            targetRepsMin: 6,
            targetRepsMax: 8,
            targetRIR: 1,
            restSec: 150,
            tempo: null,
            notes: null,
            supersetGroup: null,
          }),
          params(target.id),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await updateExercise(
          request(`http://test/api/mobile/exercises/${exercise.id}`, 'PUT', token, {
            name: 'Native incline press',
            muscleGroup: 'CHEST',
            category: 'COMPOUND',
            defaultRestSec: 150,
            equipmentType: 'DUMBBELL',
            usesBodyweight: false,
            notes: null,
          }),
          params(exercise.id),
        )
      ).status,
    ).toBe(200);
    expect(await db.exercise.findUnique({ where: { id: exercise.id } })).toMatchObject({
      loadProfile: {
        classification: 'REVIEWED',
        secondaryMuscles: {
          entries: expect.arrayContaining([expect.objectContaining({ muscleGroup: 'TRICEPS' })]),
        },
      },
    });

    expect(
      (await listPrograms(request('http://test/api/mobile/programs', 'GET', token))).status,
    ).toBe(200);
    expect(
      (await listExercises(request('http://test/api/mobile/exercises', 'GET', token))).status,
    ).toBe(200);
    expect(
      (
        await deleteExercise(
          request(`http://test/api/mobile/exercises/${exercise.id}`, 'DELETE', token),
          params(exercise.id),
        )
      ).status,
    ).toBe(409);

    expect(
      (
        await deleteProgramExercise(
          request(`http://test/api/mobile/program-exercises/${target.id}`, 'DELETE', token),
          params(target.id),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await deleteExercise(
          request(`http://test/api/mobile/exercises/${exercise.id}`, 'DELETE', token),
          params(exercise.id),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await deleteWorkout(
          request(`http://test/api/mobile/workouts/${workout.id}`, 'DELETE', token),
          params(workout.id),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await deleteProgram(
          request(`http://test/api/mobile/programs/${program.id}`, 'DELETE', token),
          params(program.id),
        )
      ).status,
    ).toBe(200);
    expect(await db.exercise.count({ where: { userId: user.id } })).toBe(0);
    expect(await db.program.count({ where: { userId: user.id } })).toBe(0);
  });

  it('keeps a user-created load-profile name collision unclassified', async () => {
    const { token } = await seedMobileUser();
    const response = await createExercise(
      request('http://test/api/mobile/exercises', 'POST', token, {
        name: 'Deadlift',
        muscleGroup: 'BACK_THICKNESS',
        category: 'COMPOUND',
        defaultRestSec: 180,
        equipmentType: 'BARBELL',
        usesBodyweight: false,
        notes: 'User-created deadlift entry.',
      }),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      name: 'Deadlift',
      catalogOrigin: null,
      loadProfile: {
        classification: 'UNCLASSIFIED',
        secondaryMuscles: { state: 'UNKNOWN', entries: [] },
      },
    });
  });

  it('replays client generated creates without duplicates and validates both headers', async () => {
    const { user, token } = await seedMobileUser();
    const programId = 'mob_program_00000000000000000000000000000001';
    const operationId = 'op_00000000000000000000000000000001';
    const payload = { name: 'Offline replay', phase: 'Base', description: null };

    const first = await createProgram(
      idempotentRequest('http://test/api/mobile/programs', token, payload, operationId, programId),
    );
    const replay = await createProgram(
      idempotentRequest('http://test/api/mobile/programs', token, payload, operationId, programId),
    );

    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ id: programId, userId: user.id });
    expect(await db.program.count({ where: { id: programId } })).toBe(1);

    const exerciseId = 'mob_exercise_00000000000000000000000000000001';
    const exercisePayload = {
      name: 'Offline press',
      muscleGroup: 'CHEST',
      category: 'COMPOUND',
      defaultRestSec: 120,
      equipmentType: 'BARBELL',
      usesBodyweight: false,
      notes: null,
    };
    for (const expectedStatus of [201, 200]) {
      const response = await createExercise(
        idempotentRequest(
          'http://test/api/mobile/exercises',
          token,
          exercisePayload,
          'op_00000000000000000000000000000002',
          exerciseId,
        ),
      );
      expect(response.status).toBe(expectedStatus);
    }

    const workoutId = 'mob_workout_00000000000000000000000000000001';
    for (const expectedStatus of [201, 200]) {
      const response = await createWorkout(
        idempotentRequest(
          `http://test/api/mobile/programs/${programId}/workouts`,
          token,
          { name: 'Offline day', dayOfWeek: 1 },
          'op_00000000000000000000000000000003',
          workoutId,
        ),
        params(programId),
      );
      expect(response.status).toBe(expectedStatus);
    }

    const targetId = 'mob_program_exercise_00000000000000000000000000000001';
    const targetPayload = {
      exerciseId,
      targetSets: 4,
      targetDropSets: 0,
      targetRepsMin: 8,
      targetRepsMax: 10,
      targetRIR: 2,
      restSec: 120,
    };
    for (const expectedStatus of [201, 200]) {
      const response = await createProgramExercise(
        idempotentRequest(
          `http://test/api/mobile/workouts/${workoutId}/program-exercises`,
          token,
          targetPayload,
          'op_00000000000000000000000000000004',
          targetId,
        ),
        params(workoutId),
      );
      expect(response.status).toBe(expectedStatus);
    }
    expect(await db.exercise.count({ where: { id: exerciseId } })).toBe(1);
    expect(await db.workout.count({ where: { id: workoutId } })).toBe(1);
    expect(await db.programExercise.count({ where: { id: targetId } })).toBe(1);

    const secondAccount = await seedMobileUser('mobile-programs-second@test.dev');
    const crossAccountReplay = await createProgram(
      idempotentRequest(
        'http://test/api/mobile/programs',
        secondAccount.token,
        payload,
        operationId,
        programId,
      ),
    );
    expect(crossAccountReplay.status).toBe(409);

    const missingPair = await createProgram(
      new Request('http://test/api/mobile/programs', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': operationId,
        },
        body: JSON.stringify(payload),
      }),
    );
    expect(missingPair.status).toBe(400);
  });
});
