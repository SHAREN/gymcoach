import { describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { buildProgramDesignContext } from '@/lib/program-design-context';
import { applyCoachingProfilePatch } from '@/lib/schemas/coaching-profile';
import { Prisma } from '@/lib/prisma-client';

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
        healthStatus: 'NO_SIGNIFICANT_ISSUES',
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

  it('keeps an explicitly removed Dumbbells profile exercise unavailable', async () => {
    const user = await db.user.create({
      data: { email: 'program-design-system-profile@test.dev', passwordHash: 'x' },
    });
    const exercise = await db.exercise.create({
      data: {
        userId: user.id,
        name: 'Dumbbell fly',
        muscleGroup: 'CHEST',
        category: 'ISOLATION',
        equipmentType: 'DUMBBELL',
      },
    });
    const gym = await db.gym.create({
      data: {
        userId: user.id,
        name: 'Profile exclusions',
        inventoryMode: 'EQUIPMENT_FIRST',
        dumbbellWeights: [10, 20],
        exerciseConfigs: {
          create: {
            exerciseId: exercise.id,
            isAvailable: true,
            systemProfileSupported: false,
          },
        },
      },
    });
    await db.user.update({ where: { id: user.id }, data: { activeGymId: gym.id } });

    const context = await buildProgramDesignContext({
      userId: user.id,
      goal: 'Build a balanced program',
      mode: 'NEW_PROGRAM',
      answers: {
        trainingExperience: 'INTERMEDIATE',
        healthStatus: 'NO_SIGNIFICANT_ISSUES',
        availableDays: [1, 3, 5],
        weeklyFrequency: 3,
        sessionDurationMin: 60,
        limitations: 'none',
        equipmentAccess: 'Dumbbells',
      },
    });

    expect(context.gym?.exerciseConfigs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          exerciseId: exercise.id,
          systemProfileSupported: false,
        }),
      ]),
    );
    expect(context.availableExercises.find((item) => item.id === exercise.id)).toMatchObject({
      isAvailableInActiveGym: false,
    });
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
      'availableDays',
      'limitations',
      'sessionDurationMin',
      'equipmentAccess',
    ]);
  });

  it('uses normalized profile defaults with provenance and keeps request overrides ephemeral', async () => {
    const profile = applyCoachingProfilePatch(
      null,
      {
        healthStatus: { state: 'KNOWN', value: 'TRAIN_WITH_LIMITATIONS' },
        trainingLevel: { state: 'KNOWN', value: 'INTERMEDIATE' },
        availableWeekdays: { state: 'KNOWN', value: [1, 3, 5] },
        maximumSessionDurationMin: { state: 'KNOWN', value: 70 },
        limitations: {
          state: 'KNOWN',
          value: {
            entries: [
              {
                kind: 'DISCOURAGED_EXERCISE',
                label: 'Self-reported pressing constraint',
                affectedExerciseNames: ['Bench press'],
              },
            ],
          },
        },
        priorityMuscles: { state: 'KNOWN', value: ['BACK_WIDTH'] },
        priorityStrengthMovements: { state: 'KNOWN', value: ['Pull-up'] },
        outsideActivities: {
          state: 'KNOWN',
          value: [{ type: 'SPORT', name: 'Tennis', sessionsPerWeek: 2 }],
        },
        likedExercises: { state: 'KNOWN', value: ['Pull-up'] },
        dislikedExercises: { state: 'KNOWN', value: ['Burpee'] },
      },
      new Date('2026-07-18T10:00:00.000Z'),
    );
    const user = await db.user.create({
      data: {
        email: 'profile-defaults@test.dev',
        passwordHash: 'x',
        goal: 'STRENGTH',
        coachingProfile: profile as Prisma.InputJsonValue,
        coachingProfileUpdatedAt: new Date(profile.updatedAt!),
      },
    });
    const gym = await db.gym.create({ data: { userId: user.id, name: 'Profile gym' } });
    await db.user.update({ where: { id: user.id }, data: { activeGymId: gym.id } });

    const context = await buildProgramDesignContext({
      userId: user.id,
      goal: '',
      mode: 'NEW_PROGRAM',
    });

    expect(context.missingQuestions).toEqual([]);
    expect(context.goal).toBe('Improve strength');
    expect(context.answers).toMatchObject({
      trainingExperience: 'INTERMEDIATE',
      weeklyFrequency: 3,
      sessionDurationMin: 70,
      healthStatus: 'TRAIN_WITH_LIMITATIONS',
      availableDays: [1, 3, 5],
      goalPriorities: expect.stringContaining('BACK_WIDTH'),
      concurrentTraining: expect.stringContaining('Tennis'),
      preferences: expect.stringContaining('Pull-up'),
    });
    expect(context.answerSources).toMatchObject({
      goal: 'profile',
      trainingExperience: 'profile',
      sessionDurationMin: 'profile',
      healthStatus: 'profile',
      availableDays: 'profile',
      limitations: 'profile',
      equipmentAccess: 'active-gym',
    });
    expect(context.exerciseConstraints).toEqual([
      expect.objectContaining({
        source: 'profile',
        affectedExerciseNames: ['Bench press'],
      }),
    ]);

    const overridden = await buildProgramDesignContext({
      userId: user.id,
      goal: 'Create a short general fitness plan',
      mode: 'NEW_PROGRAM',
      answers: {
        healthStatus: 'NO_SIGNIFICANT_ISSUES',
        trainingExperience: 'BEGINNER',
        availableDays: [2, 4],
        sessionDurationMin: 45,
        limitations: 'none for this cleared request',
        excludedExercises: [],
      },
    });
    expect(overridden.answerSources).toMatchObject({
      goal: 'request',
      trainingExperience: 'request',
      healthStatus: 'request',
      availableDays: 'request',
      limitations: 'request',
    });
    expect(overridden.exerciseConstraints).toEqual([]);
    expect(
      await db.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { coachingProfile: true },
      }),
    ).toMatchObject({ coachingProfile: profile });
  });

  it('does not infer a maximum duration or exact weekdays from training history', async () => {
    const user = await db.user.create({
      data: { email: 'no-schedule-inference@test.dev', passwordHash: 'x', goal: 'HYPERTROPHY' },
    });
    for (let day = 1; day <= 3; day += 1) {
      const startedAt = new Date(`2026-07-0${day}T10:00:00.000Z`);
      await db.session.create({
        data: {
          userId: user.id,
          startedAt,
          finishedAt: new Date(startedAt.getTime() + 60 * 60 * 1000),
        },
      });
    }

    const context = await buildProgramDesignContext({
      userId: user.id,
      goal: '',
      mode: 'NEW_PROGRAM',
      answers: {
        healthStatus: 'NO_SIGNIFICANT_ISSUES',
        trainingExperience: 'INTERMEDIATE',
        limitations: 'none',
        equipmentAccess: 'Home gym',
      },
    });

    expect(context.missingQuestions.map((question) => question.id)).toEqual([
      'availableDays',
      'sessionDurationMin',
    ]);
    expect(context.answers.sessionDurationMin).toBeNull();
    expect(context.answers.availableDays).toBeNull();
  });

  it('requires actual limitations when the self-reported status says to train with them', async () => {
    const profile = applyCoachingProfilePatch(
      null,
      {
        healthStatus: { state: 'KNOWN', value: 'TRAIN_WITH_LIMITATIONS' },
        trainingLevel: { state: 'KNOWN', value: 'INTERMEDIATE' },
        availableWeekdays: { state: 'KNOWN', value: [1, 3, 5] },
        maximumSessionDurationMin: { state: 'KNOWN', value: 60 },
        limitations: { state: 'NOT_APPLICABLE' },
      },
      new Date('2026-07-18T10:00:00.000Z'),
    );
    const user = await db.user.create({
      data: {
        email: 'limitations-required@test.dev',
        passwordHash: 'x',
        goal: 'HYPERTROPHY',
        coachingProfile: profile as Prisma.InputJsonValue,
        coachingProfileUpdatedAt: new Date(profile.updatedAt!),
      },
    });
    const gym = await db.gym.create({ data: { userId: user.id, name: 'Limitations gym' } });
    await db.user.update({ where: { id: user.id }, data: { activeGymId: gym.id } });

    const context = await buildProgramDesignContext({
      userId: user.id,
      goal: '',
      mode: 'NEW_PROGRAM',
    });

    expect(context.missingQuestions.map((question) => question.id)).toEqual(['limitations']);
    expect(context.answerSources.limitations).toBe('unknown');
  });

  it('requires exact request exercise names and turns them into hard constraints', async () => {
    const user = await db.user.create({
      data: {
        email: 'request-limitations@test.dev',
        passwordHash: 'x',
        goal: 'STRENGTH',
      },
    });
    const exercise = await db.exercise.create({
      data: {
        userId: user.id,
        name: 'Bench press',
        muscleGroup: 'CHEST',
        category: 'COMPOUND',
        equipmentType: 'BARBELL',
      },
    });
    const gym = await db.gym.create({ data: { userId: user.id, name: 'Request gym' } });
    await db.user.update({ where: { id: user.id }, data: { activeGymId: gym.id } });

    const incomplete = await buildProgramDesignContext({
      userId: user.id,
      goal: '',
      mode: 'NEW_PROGRAM',
      answers: {
        healthStatus: 'TRAIN_WITH_LIMITATIONS',
        trainingExperience: 'INTERMEDIATE',
        availableDays: [1, 3, 5],
        sessionDurationMin: 60,
        limitations: 'Self-reported request constraint',
        excludedExercises: [],
      },
    });

    expect(incomplete.missingQuestions.map((question) => question.id)).toEqual(['limitations']);
    expect(incomplete.exerciseConstraints).toEqual([]);

    const complete = await buildProgramDesignContext({
      userId: user.id,
      goal: '',
      mode: 'NEW_PROGRAM',
      answers: {
        healthStatus: 'TRAIN_WITH_LIMITATIONS',
        trainingExperience: 'INTERMEDIATE',
        availableDays: [1, 3, 5],
        sessionDurationMin: 60,
        limitations: 'Self-reported request constraint',
        excludedExercises: ['Bench press'],
      },
    });

    expect(complete.missingQuestions).toEqual([]);
    expect(complete.answerSources.limitations).toBe('request');
    expect(complete.exerciseConstraints).toEqual([
      expect.objectContaining({
        source: 'request',
        kind: 'REQUEST_EXCLUSION',
        affectedExerciseNames: ['Bench press'],
      }),
    ]);
    expect(complete.availableExercises.find((item) => item.id === exercise.id)).toMatchObject({
      isAllowedByProfile: false,
      limitationReasons: ['REQUEST_EXCLUSION: Excluded for this program request'],
    });
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
        healthStatus: 'NO_SIGNIFICANT_ISSUES',
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
        healthStatus: 'NO_SIGNIFICANT_ISSUES',
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
        healthStatus: 'NO_SIGNIFICANT_ISSUES',
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
