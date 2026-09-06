import { describe, expect, it } from 'vitest';
import { Prisma } from '@/prisma/generated/client';
import { db } from '@/lib/db';
import { reviewedExerciseLoadProfile } from '@/lib/schemas/exercise-load-profile';
import { getMcpTrainingHistory } from '@/lib/mcp/training-history';
import { buildProgramDesignContext } from '@/lib/program-design-context';

const pressProfile = reviewedExerciseLoadProfile({
  primaryMuscles: ['CHEST'],
  secondaryMuscles: ['TRICEPS', 'SHOULDERS_FRONT'],
  movementPatterns: ['HORIZONTAL_PUSH'],
  fatigueTags: ['SYSTEMIC_COMPOUND'],
  jointStress: ['SHOULDER', 'ELBOW'],
});

describe('multi-muscle load profiles', () => {
  it('flows a reviewed profile through saved history and program-design context', async () => {
    const user = await db.user.create({
      data: {
        email: 'load-profile-flow@test.dev',
        passwordHash: 'x',
        goal: 'STRENGTH',
        weeklyFrequency: 3,
      },
    });
    const gym = await db.gym.create({ data: { userId: user.id, name: 'Load Profile Gym' } });
    await db.user.update({ where: { id: user.id }, data: { activeGymId: gym.id } });

    const exercise = await db.exercise.create({
      data: {
        userId: user.id,
        name: 'Load Profile Bench Press',
        muscleGroup: 'CHEST',
        category: 'COMPOUND',
        equipmentType: 'BARBELL',
        defaultRestSec: 120,
        catalogOrigin: null,
        loadProfile: pressProfile as Prisma.InputJsonValue,
      },
    });

    const program = await db.program.create({
      data: { userId: user.id, name: 'Load Profile Program', phase: 'base', isActive: true },
    });
    const workout = await db.workout.create({
      data: { programId: program.id, name: 'Upper', order: 1, dayOfWeek: 1 },
    });
    await db.programExercise.create({
      data: {
        workoutId: workout.id,
        exerciseId: exercise.id,
        order: 1,
        targetSets: 3,
        targetRepsMin: 5,
        targetRepsMax: 8,
        targetRIR: 2,
        restSec: 120,
      },
    });

    const session = await db.session.create({
      data: {
        userId: user.id,
        programId: program.id,
        workoutId: workout.id,
        gymId: gym.id,
        startedAt: new Date('2026-09-05T10:00:00.000Z'),
        finishedAt: new Date('2026-09-05T11:00:00.000Z'),
      },
    });
    await db.set.createMany({
      data: [
        {
          sessionId: session.id,
          exerciseId: exercise.id,
          setNumber: 1,
          weight: 80,
          reps: 8,
          rir: 2,
          isWarmup: false,
          isDropSet: false,
          completedAt: new Date('2026-09-05T10:15:00.000Z'),
        },
        {
          sessionId: session.id,
          exerciseId: exercise.id,
          setNumber: 2,
          weight: 80,
          reps: 7,
          rir: 2,
          isWarmup: false,
          isDropSet: false,
          completedAt: new Date('2026-09-05T10:20:00.000Z'),
        },
      ],
    });

    const history = await getMcpTrainingHistory(user.id, {
      to: new Date('2026-09-06T00:00:00.000Z'),
      limit: 20,
    });
    expect(history.summaryOfReturnedSessions.loadByMuscle.CHEST).toMatchObject({
      directSets: 2,
      indirectSets: 0,
      equivalentSets: 2,
    });
    expect(history.summaryOfReturnedSessions.loadByMuscle.TRICEPS).toMatchObject({
      directSets: 0,
      indirectSets: 2,
      equivalentSets: 1,
    });
    expect(history.summaryOfReturnedSessions.loadProfileMetadata.unclassifiedSetCount).toBe(0);
    expect(history.sessions[0]?.exercises[0]?.loadProfile).toMatchObject({
      classification: 'REVIEWED',
    });

    const context = await buildProgramDesignContext({
      userId: user.id,
      goal: 'Continue strength work',
      mode: 'NEXT_MESOCYCLE',
      sourceProgramId: program.id,
      answers: {
        healthStatus: 'NO_SIGNIFICANT_ISSUES',
        trainingExperience: 'INTERMEDIATE',
        availableDays: [1, 3, 5],
        sessionDurationMin: 90,
        limitations: 'none',
      },
    });
    expect(context.targetVolumeByMuscle.CHEST).toMatchObject({
      weeklySets: 3,
      directSets: 3,
      indirectSets: 0,
      equivalentSets: 3,
    });
    expect(context.targetVolumeByMuscle.TRICEPS).toMatchObject({
      directSets: 0,
      indirectSets: 3,
      equivalentSets: 1.5,
    });
  });
});
