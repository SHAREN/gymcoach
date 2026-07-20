import { describe, expect, it } from 'vitest';
import { summarizeMcpTrainingHistory } from '@/lib/mcp/training-history';
import { validateProgramDesign } from '@/lib/program-design-validation';
import type { ProgramDesignContext } from '@/lib/program-design-context';
import type { GeneratedProgram } from '@/lib/schemas/program-generation';
import { emptyCoachingProfile } from '@/lib/schemas/coaching-profile';

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
      techniqueAndRirFamiliarity: null,
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
    recommendedQuestions: [],
    safety: {
      healthStatus: 'NO_SIGNIFICANT_ISSUES',
      canGenerateProgram: true,
      blockingReasons: [],
    },
    profile: {
      displayName: null,
      sex: null,
      heightCm: null,
      bodyweight: 80,
      goal: 'HYPERTROPHY',
      weeklyFrequency: 3,
      coachingProfile: emptyCoachingProfile(),
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
    program: { source: null, targetVolumeByMuscle: {}, personalVolumeTargets: {} },
    history: {
      rolling: summarizeMcpTrainingHistory([], {
        from: new Date('2026-05-15T00:00:00.000Z'),
        to: new Date('2026-07-13T00:00:00.000Z'),
        now: new Date('2026-07-13T00:00:00.000Z'),
        plannedWeeklyFrequency: 3,
      }),
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
      inventoryMode: 'EQUIPMENT_FIRST',
      dumbbellWeights: [10, 12, 14],
      plateWeights: [1.25, 2.5, 5],
      barWeights: [20],
      equipment: [],
      exerciseConfigs: [],
      platePools: [],
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
        isAllowedByProfile: true,
        limitationReasons: [],
        availabilitySource: 'legacy-config',
        requiresEquipmentSelection: false,
        equipmentOptions: [],
        weightOptions: [],
        dumbbellWeights: [],
        plateWeights: [],
        barWeights: [],
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
        isAllowedByProfile: true,
        limitationReasons: [],
        availabilitySource: 'none',
        requiresEquipmentSelection: false,
        equipmentOptions: [],
        weightOptions: [],
        dumbbellWeights: [],
        plateWeights: [],
        barWeights: [],
      },
    ],
    exerciseConstraints: [],
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
        personalVolumeTargets: {},
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
            returnGapDays: 60,
            muscleGapDays: 5,
            targetSets: 2,
            targetRIR: 3,
            suggestedWeight: 60,
            historyBasis: 'long-term-exact',
            confidence: 'medium',
            recentHistorySessionCount: 0,
            longTermHistorySessionCount: 3,
            nonComparableHistorySessionCount: 0,
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

  it('blocks automatic programming when medical clearance is needed', () => {
    const result = validateProgramDesign(
      program([]),
      context({
        safety: {
          healthStatus: 'MEDICAL_CLEARANCE_REQUIRED',
          canGenerateProgram: false,
          blockingReasons: ['Medical clearance is required.'],
        },
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('medical-clearance-required');
  });

  it('treats named profile limitations as hard exercise-selection constraints', () => {
    const result = validateProgramDesign(
      program([
        {
          name: 'Bench press',
          muscleGroup: 'CHEST',
          category: 'COMPOUND',
          equipmentType: 'BARBELL',
          targetSets: 3,
          targetRepsMin: 6,
          targetRepsMax: 10,
          targetRIR: 3,
          restSec: 150,
        },
      ]),
      context({
        exerciseConstraints: [
          {
            source: 'profile',
            kind: 'PAIN',
            label: 'Self-reported pressing constraint',
            affectedExerciseNames: ['Bench press'],
            details: null,
          },
        ],
      }),
    );

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'profile-limitation-conflict', severity: 'error' }),
      ]),
    );
  });

  it('enforces maximum session duration without a hidden tolerance', () => {
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
      context({ answers: { ...context().answers, sessionDurationMin: 12 } }),
    );

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'session-too-long', severity: 'error' }),
      ]),
    );
  });

  it('rejects a workout assigned outside the available weekdays', () => {
    const draft = program([]);
    draft.workouts[0]!.dayOfWeek = 2;
    const result = validateProgramDesign(draft, context());
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('training-day-unavailable');
  });
});
