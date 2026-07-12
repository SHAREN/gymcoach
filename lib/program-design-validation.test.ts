import { describe, expect, it } from 'vitest';
import { validateProgramDesign } from '@/lib/program-design-validation';
import type { ProgramDesignContext } from '@/lib/program-design-context';
import type { GeneratedProgram } from '@/lib/schemas/program-generation';

function context(overrides: Partial<ProgramDesignContext> = {}): ProgramDesignContext {
  return {
    methodologyVersion: 'test',
    generatedAt: '2026-07-13T00:00:00.000Z',
    mode: 'NEW_PROGRAM',
    goal: 'Build muscle',
    sourceProgramId: null,
    answers: {
      trainingExperience: 'INTERMEDIATE',
      weeklyFrequency: 3,
      sessionDurationMin: 75,
      phaseLengthWeeks: 6,
      limitations: 'none',
      equipmentAccess: null,
      preferences: null,
      postBlockAssessment: null,
    },
    missingQuestions: [],
    profile: {
      displayName: null,
      sex: null,
      heightCm: null,
      bodyweight: 80,
      goal: 'HYPERTROPHY',
      weeklyFrequency: 3,
      coachNote: null,
    },
    recovery: {
      systemic: { level: 'recovering', reasons: [] },
      byMuscle: {},
      latestReadiness: null,
      fatigue: {
        stalledExercises: [],
        deloadRecommended: false,
        deloadReasons: [],
        deloadActive: false,
      },
    },
    program: { source: null, targetVolumeByMuscle: {} },
    history: {
      currentWeek: { weekStart: '2026-07-13', sessions: [] },
      previousWeek: null,
      actualHardSetsByMuscle: { currentWeek: {}, previousWeek: {} },
      adherence: { sessionsLogged: 0, expectedSessions: 6, rate: 0 },
      rirAdherence: {
        setsWithRir: 0,
        meanDeltaFromTarget: null,
        materiallyHarderSets: 0,
        materiallyEasierSets: 0,
        byExercise: [],
      },
      sessionMetrics: [],
      exerciseTrends: [],
      returnToTraining: [],
      unavailableMetrics: [],
    },
    goals: [],
    records: [],
    conditioning: {
      weekCurrent: { minutes: 0, km: 0, sessions: 0 },
      weekPrevious: null,
      days: [],
      weeklyTargetMin: 150,
    },
    gym: {
      id: 'gym-1',
      name: 'Olymp',
      dumbbellWeights: [10, 12, 14],
      plateWeights: [1.25, 2.5, 5],
      barWeights: [20],
      exerciseConfigs: [],
    },
    availableExercises: [
      {
        id: 'bench',
        name: 'Bench press',
        muscleGroup: 'CHEST',
        category: 'COMPOUND',
        equipmentType: 'BARBELL',
        usesBodyweight: false,
        defaultRestSec: 120,
        notes: null,
        isAvailableInActiveGym: true,
        weightOptions: [],
      },
      {
        id: 'fly',
        name: 'Machine fly',
        muscleGroup: 'CHEST',
        category: 'ISOLATION',
        equipmentType: 'MACHINE',
        usesBodyweight: false,
        defaultRestSec: 60,
        notes: null,
        isAvailableInActiveGym: false,
        weightOptions: [],
      },
    ],
    dataQuality: {
      sessionsInTwoWeeks: 0,
      exercisesWithRecentProgress: 0,
      historyWeeks: 0,
      confidence: 'low',
    },
    ...overrides,
  };
}

function program(exercises: GeneratedProgram['workouts'][number]['exercises']): GeneratedProgram {
  return {
    name: 'Draft',
    phase: 'Hypertrophy',
    workouts: [{ name: 'Push', exercises }],
  };
}

describe('program-design validation', () => {
  it('flags unavailable equipment, compound failure and excessive session volume', () => {
    const result = validateProgramDesign(
      program([
        {
          name: 'Bench press',
          muscleGroup: 'CHEST',
          category: 'COMPOUND',
          equipmentType: 'BARBELL',
          targetSets: 8,
          targetRepsMin: 4,
          targetRepsMax: 6,
          targetRIR: 0,
          restSec: 180,
        },
        {
          name: 'Machine fly',
          muscleGroup: 'CHEST',
          category: 'ISOLATION',
          equipmentType: 'MACHINE',
          targetSets: 4,
          targetRepsMin: 10,
          targetRepsMax: 15,
          targetRIR: 1,
          restSec: 60,
        },
      ]),
      context(),
    );

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'compound-failure',
        'equipment-unavailable',
        'session-volume-soft-cap',
        'volume-not-distributed',
      ]),
    );
  });

  it('rejects a volume increase while systemic recovery says reduce load', () => {
    const ctx = context({
      recovery: {
        ...context().recovery,
        systemic: { level: 'reduce_load', reasons: ['Deload recommended.'] },
      },
      program: {
        source: null,
        targetVolumeByMuscle: {
          CHEST: { weeklySets: 6, frequency: 2, maxSetsInOneWorkout: 3 },
        },
      },
    });
    const result = validateProgramDesign(
      program([
        {
          name: 'Bench press',
          muscleGroup: 'CHEST',
          category: 'COMPOUND',
          equipmentType: 'BARBELL',
          targetSets: 8,
          targetRepsMin: 6,
          targetRepsMax: 10,
          targetRIR: 3,
          restSec: 150,
        },
      ]),
      ctx,
    );

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain(
      'volume-increase-during-under-recovery',
    );
  });

  it('accepts a balanced draft that respects the active gym', () => {
    const result = validateProgramDesign(
      program([
        {
          name: 'Bench press',
          muscleGroup: 'CHEST',
          category: 'COMPOUND',
          equipmentType: 'BARBELL',
          targetSets: 4,
          targetRepsMin: 6,
          targetRepsMax: 10,
          targetRIR: 2,
          restSec: 150,
        },
      ]),
      context(),
    );

    expect(result.valid).toBe(true);
    expect(result.weeklySetsByMuscle.CHEST).toBe(4);
  });

  it('enforces return-to-training set, RIR and drop-set limits', () => {
    const ctx = context({
      history: {
        ...context().history,
        returnToTraining: [
          {
            programExerciseId: 'pe-1',
            exerciseName: 'Bench press',
            muscleGroup: 'CHEST',
            mode: 'exercise-reintro',
            exerciseGapDays: 60,
            muscleGapDays: 5,
            targetSets: 2,
            targetRIR: 3,
            suggestedWeight: 60,
          },
        ],
      },
    });
    const result = validateProgramDesign(
      program([
        {
          name: 'Bench press',
          muscleGroup: 'CHEST',
          category: 'COMPOUND',
          equipmentType: 'BARBELL',
          targetSets: 3,
          targetDropSets: 1,
          targetRepsMin: 6,
          targetRepsMax: 10,
          targetRIR: 1,
          restSec: 150,
        },
      ]),
      ctx,
    );

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['return-set-limit', 'return-rir-limit', 'return-drop-sets']),
    );
  });

  it('counts drop sets in volume and normalizes known exercise metadata', () => {
    const result = validateProgramDesign(
      program([
        {
          name: 'Bench press',
          muscleGroup: 'BICEPS',
          category: 'ISOLATION',
          equipmentType: 'DUMBBELL',
          targetSets: 3,
          targetDropSets: 2,
          targetRepsMin: 6,
          targetRepsMax: 10,
          targetRIR: 0,
          restSec: 150,
        },
      ]),
      context(),
    );

    expect(result.weeklySetsByMuscle).toMatchObject({ CHEST: 5 });
    expect(result.weeklySetsByMuscle.BICEPS).toBeUndefined();
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'catalog-metadata-normalized',
        'compound-failure',
        'compound-drop-set',
      ]),
    );
  });
});
