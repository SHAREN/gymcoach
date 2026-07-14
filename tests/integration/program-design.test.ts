import { describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { buildProgramDesignContext } from '@/lib/program-design-context';

describe('buildProgramDesignContext', () => {
  it('combines the active program, gym inventory and required user answers', async () => {
    const user = await db.user.create({
      data: {
        email: 'program-design@test.dev',
        passwordHash: 'x',
        weeklyFrequency: 3,
        bodyweight: 80,
      },
    });
    const bench = await db.exercise.create({
      data: {
        userId: user.id,
        name: 'Bench press',
        muscleGroup: 'CHEST',
        category: 'COMPOUND',
        equipmentType: 'BARBELL',
      },
    });
    const gym = await db.gym.create({
      data: {
        userId: user.id,
        name: 'Olymp',
        barWeights: [20],
        plateWeights: [1.25, 2.5, 5, 10, 20],
        exerciseConfigs: {
          create: {
            exerciseId: bench.id,
            isAvailable: true,
            barWeights: [15],
            plateWeights: [1.25, 5],
          },
        },
      },
    });
    await db.user.update({ where: { id: user.id }, data: { activeGymId: gym.id } });
    const program = await db.program.create({
      data: {
        userId: user.id,
        name: 'Current',
        phase: 'Hypertrophy',
        isActive: true,
        workouts: {
          create: {
            name: 'Push',
            order: 1,
            exercises: {
              create: {
                exerciseId: bench.id,
                order: 1,
                targetSets: 4,
                targetRepsMin: 6,
                targetRepsMax: 10,
                targetRIR: 2,
                restSec: 150,
              },
            },
          },
        },
      },
    });

    const context = await buildProgramDesignContext({
      userId: user.id,
      goal: 'Continue hypertrophy while keeping bench press',
      mode: 'NEXT_MESOCYCLE',
      sourceProgramId: program.id,
      answers: {
        trainingExperience: 'INTERMEDIATE',
        healthStatus: 'NO_RELEVANT_CONCERNS',
        availableDays: [1, 3, 5],
        sessionDurationMin: 75,
        limitations: 'none',
        postBlockAssessment: {
          dreadingTraining: false,
          sleepWorse: false,
          performanceDecreasing: false,
          lifeStressHigher: false,
          achesAndPainsWorse: false,
        },
      },
    });

    expect(context.missingQuestions).toEqual([]);
    expect(context.program.source?.id).toBe(program.id);
    expect(context.program.targetVolumeByMuscle.CHEST).toMatchObject({
      weeklySets: 4,
      frequency: 1,
    });
    expect(context.gym?.name).toBe('Olymp');
    expect(context.availableExercises[0]).toMatchObject({
      name: 'Bench press',
      isAvailableInActiveGym: true,
      barWeights: [15],
      plateWeights: [1.25, 5],
    });
    expect(context.history.returnToTraining[0]?.mode).toBe('normal');
  });

  it('returns focused questions instead of letting the LLM guess', async () => {
    const user = await db.user.create({
      data: { email: 'questions@test.dev', passwordHash: 'x' },
    });
    const context = await buildProgramDesignContext({
      userId: user.id,
      goal: 'Create a three day strength program',
      mode: 'NEW_PROGRAM',
    });

    expect(context.missingQuestions.map((question) => question.id)).toEqual([
      'healthStatus',
      'trainingExperience',
      'weeklyFrequency',
      'availableDays',
      'sessionDurationMin',
      'limitations',
      'equipmentAccess',
    ]);
  });

  it('requires a post-block recovery assessment before extending a program', async () => {
    const user = await db.user.create({
      data: {
        email: 'post-block@test.dev',
        passwordHash: 'x',
        weeklyFrequency: 3,
      },
    });
    await db.program.create({
      data: { userId: user.id, name: 'Current', phase: 'Hypertrophy', isActive: true },
    });

    const context = await buildProgramDesignContext({
      userId: user.id,
      goal: 'Continue with a second hypertrophy block',
      mode: 'NEXT_MESOCYCLE',
      answers: {
        trainingExperience: 'INTERMEDIATE',
        healthStatus: 'NO_RELEVANT_CONCERNS',
        availableDays: [1, 3, 5],
        sessionDurationMin: 60,
        limitations: 'none',
        equipmentAccess: 'Home gym with barbell and dumbbells',
      },
    });

    expect(context.missingQuestions.map((question) => question.id)).toEqual([
      'postBlockAssessment',
    ]);
  });

  it('does not link an independent new program to the active program', async () => {
    const user = await db.user.create({
      data: {
        email: 'independent-program@test.dev',
        passwordHash: 'x',
      },
    });
    const active = await db.program.create({
      data: { userId: user.id, name: 'Current', phase: 'Hypertrophy', isActive: true },
    });

    const context = await buildProgramDesignContext({
      userId: user.id,
      goal: 'Create an independent strength program',
      mode: 'NEW_PROGRAM',
      answers: {
        trainingExperience: 'INTERMEDIATE',
        healthStatus: 'NO_RELEVANT_CONCERNS',
        availableDays: [1, 2, 4, 5],
        weeklyFrequency: 4,
        sessionDurationMin: 60,
        limitations: 'none',
        equipmentAccess: 'Barbell and rack',
      },
    });

    expect(context.program.source?.id).toBe(active.id);
    expect(context.sourceProgramId).toBeNull();
    expect(context.history.adherence.expectedSessions).toBe(8);
  });

  it('reduces load when multiple post-block recovery signals worsened', async () => {
    const user = await db.user.create({
      data: {
        email: 'recovery-checklist@test.dev',
        passwordHash: 'x',
        weeklyFrequency: 3,
      },
    });
    await db.program.create({
      data: { userId: user.id, name: 'Current', phase: 'Hypertrophy', isActive: true },
    });

    const context = await buildProgramDesignContext({
      userId: user.id,
      goal: 'Plan the next hypertrophy block',
      mode: 'NEXT_MESOCYCLE',
      answers: {
        trainingExperience: 'INTERMEDIATE',
        healthStatus: 'NO_RELEVANT_CONCERNS',
        availableDays: [1, 3, 5],
        sessionDurationMin: 60,
        limitations: 'none',
        equipmentAccess: 'Barbell and rack',
        postBlockAssessment: {
          dreadingTraining: false,
          sleepWorse: true,
          performanceDecreasing: true,
          lifeStressHigher: false,
          achesAndPainsWorse: false,
        },
      },
    });

    expect(context.recovery.systemic.level).toBe('reduce_load');
    expect(context.recovery.systemic.reasons.join(' ')).toMatch(/2 warning signals/);
  });
});
