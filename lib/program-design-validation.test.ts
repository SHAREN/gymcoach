import { describe, expect, it } from 'vitest';
import type { ProgramDesignContext } from './program-design-context';
import { validateProgramDesign } from './program-design-validation';
import {
  legacyPrimaryExerciseLoadProfile,
  reviewedExerciseLoadProfile,
} from './schemas/exercise-load-profile';
import type { GeneratedProgram } from './schemas/program-generation';

function context(overrides: Partial<ProgramDesignContext> = {}): ProgramDesignContext {
  return {
    designContractVersion: 'test',
    generatedAt: '2026-09-05T12:00:00.000Z',
    mode: 'NEW_PROGRAM',
    goal: 'Build strength safely',
    sourceProgramId: null,
    answers: {
      trainingExperience: 'INTERMEDIATE',
      weeklyFrequency: 3,
      sessionDurationMin: 90,
      healthStatus: 'NO_SIGNIFICANT_ISSUES',
      phaseLengthWeeks: 6,
      availableDays: [1, 3, 5],
      scheduleConstraints: null,
      limitations: 'none',
      equipmentAccess: null,
      preferences: null,
      recentTrainingBackground: null,
      goalPriorities: null,
      concurrentTraining: null,
      changesSinceLastProgram: null,
      postBlockAssessment: null,
    },
    answerSources: {
      goal: 'request',
      trainingExperience: 'request',
      weeklyFrequency: 'request',
      sessionDurationMin: 'request',
      healthStatus: 'request',
      availableDays: 'request',
      limitations: 'request',
      equipmentAccess: 'active-gym',
    },
    missingQuestions: [],
    safety: { healthStatus: 'NO_SIGNIFICANT_ISSUES', canCreateProgram: true, blockingReasons: [] },
    profile: {} as ProgramDesignContext['profile'],
    recent: {} as ProgramDesignContext['recent'],
    sourceProgram: null,
    targetVolumeByMuscle: {},
    gym: {
      id: 'gym-1',
      name: 'Gym',
      dumbbellWeights: [],
      plateWeights: [],
      barWeights: [],
      exerciseConfigs: [],
      equipment: [],
    },
    availableExercises: [
      {
        id: 'bench',
        name: 'Bench Press',
        muscleGroup: 'CHEST',
        loadProfile: legacyPrimaryExerciseLoadProfile('CHEST'),
        category: 'COMPOUND',
        equipmentType: 'BARBELL',
        usesBodyweight: false,
        defaultRestSec: 120,
        notes: null,
        isAvailableInActiveGym: true,
        preferredEquipmentId: null,
        linkedEquipmentIds: [],
        isAllowedByProfile: true,
        limitationReasons: [],
      },
    ],
    exerciseConstraints: [],
    returnToTraining: [],
    dataQuality: {
      sessionsInTwoWeeks: 4,
      exercisesWithRecentProgress: 1,
      historyWeeks: 4,
      confidence: 'medium',
    },
    ...overrides,
  };
}

function program(overrides: Partial<GeneratedProgram> = {}): GeneratedProgram {
  return {
    name: 'Draft',
    description: null,
    phase: 'base',
    workouts: [
      {
        name: 'Upper',
        dayOfWeek: 1,
        exercises: [
          {
            name: 'Bench Press',
            muscleGroup: 'CHEST',
            category: 'COMPOUND',
            equipmentType: 'BARBELL',
            targetSets: 3,
            targetRepsMin: 5,
            targetRepsMax: 8,
            targetRIR: 2,
            restSec: 120,
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe('validateProgramDesign', () => {
  it('blocks a draft when medical clearance is required', () => {
    const result = validateProgramDesign(
      program(),
      context({
        safety: {
          healthStatus: 'MEDICAL_CLEARANCE_REQUIRED',
          canCreateProgram: false,
          blockingReasons: ['Medical clearance required.'],
        },
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('medical-clearance-required');
  });

  it('enforces exact exercise constraints and gym availability', () => {
    const restricted = context();
    restricted.availableExercises[0] = {
      ...restricted.availableExercises[0]!,
      isAvailableInActiveGym: false,
      isAllowedByProfile: false,
      limitationReasons: ['PAIN: pressing discomfort'],
    };
    const result = validateProgramDesign(program(), restricted);
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['equipment-unavailable', 'profile-limitation-conflict']),
    );
  });

  it('enforces exact schedule and hard session-duration limits', () => {
    const result = validateProgramDesign(
      program({
        workouts: [
          {
            name: 'Too long',
            dayOfWeek: 2,
            exercises: [
              {
                name: 'Bench Press',
                muscleGroup: 'CHEST',
                category: 'COMPOUND',
                equipmentType: 'BARBELL',
                targetSets: 20,
                targetRepsMin: 5,
                targetRepsMax: 8,
                targetRIR: 2,
                restSec: 300,
              },
            ],
          },
        ],
      }),
      context({
        answers: { ...context().answers, sessionDurationMin: 30, availableDays: [1, 3, 5] },
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['training-day-unavailable', 'session-too-long']),
    );
  });

  it('enforces current return-calibration ceilings', () => {
    const result = validateProgramDesign(
      program(),
      context({
        returnToTraining: [
          {
            programExerciseId: 'pe-1',
            exerciseName: 'Bench Press',
            mode: 'reentry',
            targetSets: 2,
            targetRIR: 3,
            suggestedWeight: 60,
            exerciseGapDays: 45,
            muscleGapDays: 20,
          },
        ],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['return-set-limit', 'return-rir-limit']),
    );
  });

  it('labels multi-muscle accounting correctly and preserves direct counts', () => {
    const result = validateProgramDesign(program(), context());
    expect(result.accounting.mode).toBe('MULTI_MUSCLE_V1');
    expect(result.weeklyLoadByMuscle.CHEST).toMatchObject({ directSets: 3, indirectSets: 0 });
    expect(result.valid).toBe(true);
  });

  it('counts explicit secondary muscles separately and exposes the heuristic', () => {
    const multi = context();
    multi.availableExercises[0] = {
      ...multi.availableExercises[0]!,
      loadProfile: reviewedExerciseLoadProfile({
        primaryMuscles: ['CHEST'],
        secondaryMuscles: ['TRICEPS', 'SHOULDERS_FRONT'],
        movementPatterns: ['HORIZONTAL_PUSH'],
        fatigueTags: ['SYSTEMIC_COMPOUND'],
        jointStress: ['SHOULDER', 'ELBOW'],
      }),
    };
    const result = validateProgramDesign(program(), multi);
    expect(result.weeklyLoadByMuscle.TRICEPS).toMatchObject({
      directSets: 0,
      indirectSets: 3,
      equivalentSets: 1.5,
    });
    expect(result.loadProfileMetadata.equivalentSetsHeuristic.coefficients.secondary).toBe(0.5);
  });
});
