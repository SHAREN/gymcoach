import { db } from '@/lib/db';
import { buildCoachPayload, type CoachPayload } from '@/lib/coach';
import { getReturnToTrainingRecommendations } from '@/lib/return-to-training-history';
import {
  hasKnownLimitations,
  knownCoachingValue,
  summarizeCoachingLimitations,
} from '@/lib/schemas/coaching-profile';
import type {
  PostBlockAssessment,
  ProgramDesignAnswers,
  ProgramDesignMode,
  ProgramHealthStatus,
  TrainingExperience,
} from '@/lib/schemas/program-design';
import type { Prisma } from '@/prisma/generated/client';
import type { MuscleGroup } from '@/lib/prisma-client';
import {
  normalizeExerciseLoadProfile,
  type ExerciseLoadProfile,
} from '@/lib/schemas/exercise-load-profile';
import { aggregateTrainingLoad } from '@/lib/training-load-aggregation';

export const PROGRAM_DESIGN_CONTRACT_VERSION = '2026-09-05.external-mcp-v1';

const sourceProgramInclude = {
  workouts: {
    orderBy: { order: 'asc' as const },
    include: {
      exercises: {
        orderBy: { order: 'asc' as const },
        include: { exercise: true },
      },
    },
  },
} satisfies Prisma.ProgramInclude;

const activeGymInclude = {
  exerciseConfigs: true,
  equipment: {
    select: {
      id: true,
      name: true,
      equipmentType: true,
      loadConfigurationKnown: true,
      loadType: true,
      weightOptions: true,
      selectedLoadMultiplier: true,
      baseLoadKg: true,
      platePoolId: true,
      loadingSides: true,
      systemBarbellFamily: true,
      platePool: {
        select: {
          id: true,
          name: true,
          compatibilityKey: true,
          systemBarbellFamily: true,
          plates: {
            orderBy: { weightKg: 'asc' as const },
            select: { weightKg: true, quantity: true },
          },
        },
      },
      exerciseLinks: { select: { exerciseId: true } },
    },
  },
} satisfies Prisma.GymInclude;

type SourceProgramRow = Prisma.ProgramGetPayload<{ include: typeof sourceProgramInclude }>;
type ActiveGymRow = Prisma.GymGetPayload<{ include: typeof activeGymInclude }>;

export interface ProgramDesignQuestion {
  id:
    | 'goal'
    | 'trainingExperience'
    | 'availableDays'
    | 'sessionDurationMin'
    | 'healthStatus'
    | 'limitations'
    | 'equipmentAccess'
    | 'postBlockAssessment';
  prompt: string;
  input: 'select' | 'multi-select' | 'number' | 'text' | 'checklist';
  required: true;
  options?: Array<{ value: string; label: string }>;
  items?: Array<{ value: keyof PostBlockAssessment; label: string }>;
  min?: number;
  max?: number;
}

export interface ProgramDesignContext {
  designContractVersion: string;
  generatedAt: string;
  mode: ProgramDesignMode;
  goal: string;
  sourceProgramId: string | null;
  answers: {
    trainingExperience: TrainingExperience | null;
    weeklyFrequency: number | null;
    sessionDurationMin: number | null;
    healthStatus: ProgramHealthStatus | null;
    phaseLengthWeeks: number;
    availableDays: number[] | null;
    scheduleConstraints: string | null;
    limitations: string | null;
    equipmentAccess: string | null;
    preferences: string | null;
    recentTrainingBackground: string | null;
    goalPriorities: string | null;
    concurrentTraining: string | null;
    changesSinceLastProgram: string | null;
    postBlockAssessment: PostBlockAssessment | null;
  };
  answerSources: {
    goal: 'request' | 'profile' | 'unknown';
    trainingExperience: 'request' | 'profile' | 'unknown';
    weeklyFrequency: 'request' | 'profile' | 'legacy-profile' | 'unknown';
    sessionDurationMin: 'request' | 'profile' | 'unknown';
    healthStatus: 'request' | 'profile' | 'unknown';
    availableDays: 'request' | 'profile' | 'unknown';
    limitations: 'request' | 'profile' | 'unknown';
    equipmentAccess: 'request' | 'active-gym' | 'unknown';
  };
  missingQuestions: ProgramDesignQuestion[];
  safety: {
    healthStatus: ProgramHealthStatus | null;
    canCreateProgram: boolean;
    blockingReasons: string[];
  };
  profile: CoachPayload['userProfile'];
  recent: Pick<
    CoachPayload,
    | 'weekCurrent'
    | 'weekPrevious'
    | 'latestReadiness'
    | 'goals'
    | 'fatigue'
    | 'conditioning'
    | 'records'
    | 'recentProgress'
  >;
  sourceProgram: ReturnType<typeof mapSourceProgram> | null;
  targetVolumeByMuscle: Record<
    string,
    {
      weeklySets: number;
      directSets: number;
      indirectSets: number;
      equivalentSets: number;
      frequency: number;
      maxSetsInOneWorkout: number;
      maxEquivalentSetsInOneWorkout: number;
      confidence: string;
    }
  >;
  gym: ReturnType<typeof mapGym> | null;
  availableExercises: Array<{
    id: string;
    name: string;
    muscleGroup: MuscleGroup;
    loadProfile: ExerciseLoadProfile;
    category: string;
    equipmentType: string;
    usesBodyweight: boolean;
    defaultRestSec: number;
    notes: string | null;
    isAvailableInActiveGym: boolean | null;
    preferredEquipmentId: string | null;
    linkedEquipmentIds: string[];
    isAllowedByProfile: boolean;
    limitationReasons: string[];
  }>;
  exerciseConstraints: Array<{
    source: 'profile' | 'request';
    kind: string;
    label: string;
    affectedExerciseNames: string[];
    details: string | null;
  }>;
  returnToTraining: Array<{
    programExerciseId: string;
    exerciseName: string;
    mode: string;
    targetSets: number;
    targetRIR: number;
    suggestedWeight: number | null;
    exerciseGapDays: number | null;
    muscleGapDays: number | null;
  }>;
  dataQuality: {
    sessionsInTwoWeeks: number;
    exercisesWithRecentProgress: number;
    historyWeeks: number;
    confidence: 'low' | 'medium' | 'high';
  };
}

interface BuildProgramDesignContextInput {
  userId: string;
  goal: string;
  mode: ProgramDesignMode;
  sourceProgramId?: string | null;
  answers?: ProgramDesignAnswers;
}

export async function buildProgramDesignContext({
  userId,
  goal,
  mode,
  sourceProgramId = null,
  answers = {},
}: BuildProgramDesignContextInput): Promise<ProgramDesignContext> {
  const [coach, sourceRow, userContext, exercises] = await Promise.all([
    buildCoachPayload(userId),
    db.program.findFirst({
      where: sourceProgramId ? { id: sourceProgramId, userId } : { userId, isActive: true },
      include: sourceProgramInclude,
    }),
    db.user.findUnique({
      where: { id: userId },
      select: { activeGym: { include: activeGymInclude } },
    }),
    db.exercise.findMany({
      where: { userId },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        muscleGroup: true,
        category: true,
        equipmentType: true,
        usesBodyweight: true,
        defaultRestSec: true,
        notes: true,
        loadProfile: true,
      },
    }),
  ]);

  if ((mode === 'NEXT_MESOCYCLE' || mode === 'REVISE_CURRENT') && !sourceRow) {
    throw new Error('An active or explicitly selected source program is required for this mode.');
  }
  if (sourceProgramId && !sourceRow) throw new Error('Source program not found.');

  const sourceProgram = sourceRow ? mapSourceProgram(sourceRow) : null;
  const activeGym = userContext?.activeGym ?? null;
  const coachingProfile = coach.userProfile.coachingProfile;

  const requestLimitationsProvided =
    answers.excludedExercises !== undefined || nonEmpty(answers.limitations) != null;
  const exerciseConstraints: ProgramDesignContext['exerciseConstraints'] =
    requestLimitationsProvided
      ? (answers.excludedExercises ?? []).map((exerciseName) => ({
          source: 'request' as const,
          kind: 'REQUEST_EXCLUSION',
          label: 'Excluded for this program request',
          affectedExerciseNames: [exerciseName],
          details: nonEmpty(answers.limitations),
        }))
      : coachingProfile.limitations.state === 'KNOWN'
        ? coachingProfile.limitations.value.entries.map((entry) => ({
            source: 'profile' as const,
            kind: entry.kind,
            label: entry.label,
            affectedExerciseNames: entry.affectedExerciseNames,
            details: entry.details ?? null,
          }))
        : [];

  const reasonsByExercise = new Map<string, string[]>();
  for (const constraint of exerciseConstraints) {
    for (const exerciseName of constraint.affectedExerciseNames) {
      const key = exerciseName.toLocaleLowerCase();
      const reasons = reasonsByExercise.get(key) ?? [];
      reasons.push(`${constraint.kind}: ${constraint.label}`);
      reasonsByExercise.set(key, reasons);
    }
  }

  const configByExercise = new Map(
    activeGym?.exerciseConfigs.map((config) => [config.exerciseId, config]) ?? [],
  );
  const equipmentByExercise = new Map<string, string[]>();
  for (const item of activeGym?.equipment ?? []) {
    for (const link of item.exerciseLinks) {
      const ids = equipmentByExercise.get(link.exerciseId) ?? [];
      ids.push(item.id);
      equipmentByExercise.set(link.exerciseId, ids);
    }
  }

  const availableExercises = exercises.map((exercise) => {
    const config = configByExercise.get(exercise.id);
    const limitationReasons = reasonsByExercise.get(exercise.name.toLocaleLowerCase()) ?? [];
    return {
      ...exercise,
      loadProfile: normalizeExerciseLoadProfile(exercise.loadProfile, exercise.muscleGroup),
      isAvailableInActiveGym: activeGym ? (config?.isAvailable ?? true) : null,
      preferredEquipmentId: config?.preferredEquipmentId ?? null,
      linkedEquipmentIds: equipmentByExercise.get(exercise.id) ?? [],
      isAllowedByProfile: limitationReasons.length === 0,
      limitationReasons,
    };
  });

  const profileTrainingLevel = knownCoachingValue(coachingProfile.trainingLevel);
  const profileAvailableDays = knownCoachingValue(coachingProfile.availableWeekdays);
  const profileDuration = knownCoachingValue(coachingProfile.maximumSessionDurationMin);
  const profileHealthStatus = knownCoachingValue(coachingProfile.healthStatus);
  const resolvedGoal = nonEmpty(goal) ?? profileGoalDescription(coach.userProfile.goal);
  const resolvedTrainingExperience = answers.trainingExperience ?? profileTrainingLevel;
  const resolvedAvailableDays = answers.availableDays ?? profileAvailableDays;
  const resolvedSessionDuration = answers.sessionDurationMin ?? profileDuration;
  const resolvedWeeklyFrequency =
    answers.weeklyFrequency ?? resolvedAvailableDays?.length ?? coach.userProfile.weeklyFrequency;
  const resolvedHealthStatus = answers.healthStatus ?? profileHealthStatus;
  const limitationsKnown = requestLimitationsProvided
    ? resolvedHealthStatus === 'TRAIN_WITH_LIMITATIONS'
      ? (answers.excludedExercises?.length ?? 0) > 0
      : nonEmpty(answers.limitations)?.toLocaleLowerCase() === 'none' ||
        (answers.excludedExercises?.length ?? 0) > 0
    : hasKnownLimitations(coachingProfile);
  const resolvedLimitations =
    nonEmpty(answers.limitations) ??
    (answers.excludedExercises !== undefined
      ? answers.excludedExercises.length > 0
        ? `Exclude: ${answers.excludedExercises.join(', ')}`
        : 'none'
      : summarizeCoachingLimitations(coachingProfile));
  const resolvedEquipmentAccess = nonEmpty(answers.equipmentAccess);

  const missingQuestions = buildMissingQuestions({
    mode,
    goal: resolvedGoal,
    trainingExperience: resolvedTrainingExperience,
    sessionDurationMin: resolvedSessionDuration,
    availableDays: resolvedAvailableDays,
    healthStatus: resolvedHealthStatus,
    limitationsKnown,
    equipmentAccess: activeGym || resolvedEquipmentAccess ? 'known' : null,
    postBlockAssessment: answers.postBlockAssessment ?? null,
  });

  const blockingReasons =
    resolvedHealthStatus === 'MEDICAL_CLEARANCE_REQUIRED'
      ? [
          'The saved/requested health status requires medical clearance before ordinary program creation.',
        ]
      : [];

  const returnToTraining = await buildReturnRecommendations({
    userId,
    sourceRow,
    activeGym,
    bodyweight: coach.userProfile.bodyweight,
  });
  const sessionsInTwoWeeks =
    coach.weekCurrent.sessions.length + (coach.weekPrevious?.sessions.length ?? 0);
  const historyWeeks = distinctHistoryWeeks(coach.recentProgress);

  return {
    designContractVersion: PROGRAM_DESIGN_CONTRACT_VERSION,
    generatedAt: new Date().toISOString(),
    mode,
    goal: resolvedGoal ?? '',
    sourceProgramId: mode === 'NEW_PROGRAM' ? null : (sourceProgram?.id ?? null),
    answers: {
      trainingExperience: resolvedTrainingExperience,
      weeklyFrequency: resolvedWeeklyFrequency,
      sessionDurationMin: resolvedSessionDuration,
      healthStatus: resolvedHealthStatus,
      phaseLengthWeeks: answers.phaseLengthWeeks ?? 6,
      availableDays: resolvedAvailableDays,
      scheduleConstraints: nonEmpty(answers.scheduleConstraints),
      limitations: resolvedLimitations,
      equipmentAccess: resolvedEquipmentAccess,
      preferences: nonEmpty(answers.preferences) ?? summarizeExercisePreferences(coachingProfile),
      recentTrainingBackground: nonEmpty(answers.recentTrainingBackground),
      goalPriorities:
        nonEmpty(answers.goalPriorities) ?? summarizeProfilePriorities(coachingProfile),
      concurrentTraining:
        nonEmpty(answers.concurrentTraining) ?? summarizeOutsideActivities(coachingProfile),
      changesSinceLastProgram: nonEmpty(answers.changesSinceLastProgram),
      postBlockAssessment: answers.postBlockAssessment ?? null,
    },
    answerSources: {
      goal: nonEmpty(goal) ? 'request' : resolvedGoal ? 'profile' : 'unknown',
      trainingExperience: answers.trainingExperience
        ? 'request'
        : profileTrainingLevel
          ? 'profile'
          : 'unknown',
      weeklyFrequency: answers.weeklyFrequency
        ? 'request'
        : answers.availableDays || profileAvailableDays
          ? 'profile'
          : coach.userProfile.weeklyFrequency
            ? 'legacy-profile'
            : 'unknown',
      sessionDurationMin: answers.sessionDurationMin
        ? 'request'
        : profileDuration
          ? 'profile'
          : 'unknown',
      healthStatus: answers.healthStatus ? 'request' : profileHealthStatus ? 'profile' : 'unknown',
      availableDays: answers.availableDays
        ? 'request'
        : profileAvailableDays
          ? 'profile'
          : 'unknown',
      limitations: requestLimitationsProvided
        ? 'request'
        : limitationsKnown
          ? 'profile'
          : 'unknown',
      equipmentAccess: resolvedEquipmentAccess ? 'request' : activeGym ? 'active-gym' : 'unknown',
    },
    missingQuestions,
    safety: {
      healthStatus: resolvedHealthStatus,
      canCreateProgram: blockingReasons.length === 0,
      blockingReasons,
    },
    profile: coach.userProfile,
    recent: {
      weekCurrent: coach.weekCurrent,
      weekPrevious: coach.weekPrevious,
      latestReadiness: coach.latestReadiness,
      goals: coach.goals,
      fatigue: coach.fatigue,
      conditioning: coach.conditioning,
      records: coach.records,
      recentProgress: coach.recentProgress,
    },
    sourceProgram,
    targetVolumeByMuscle: sourceProgram ? targetVolume(sourceProgram) : {},
    gym: activeGym ? mapGym(activeGym) : null,
    availableExercises,
    exerciseConstraints,
    returnToTraining,
    dataQuality: {
      sessionsInTwoWeeks,
      exercisesWithRecentProgress: coach.recentProgress.length,
      historyWeeks,
      confidence: sessionsInTwoWeeks < 3 ? 'low' : sessionsInTwoWeeks < 8 ? 'medium' : 'high',
    },
  };
}

function mapSourceProgram(program: SourceProgramRow) {
  return {
    id: program.id,
    name: program.name,
    phase: program.phase,
    description: program.description,
    startDate: program.startDate.toISOString(),
    endDate: program.endDate?.toISOString() ?? null,
    workouts: program.workouts.map((workout) => ({
      id: workout.id,
      name: workout.name,
      dayOfWeek: workout.dayOfWeek,
      order: workout.order,
      exercises: workout.exercises.map((pe) => ({
        id: pe.id,
        order: pe.order,
        exerciseId: pe.exerciseId,
        exerciseName: pe.exercise.name,
        muscleGroup: pe.exercise.muscleGroup,
        loadProfile: normalizeExerciseLoadProfile(pe.exercise.loadProfile, pe.exercise.muscleGroup),
        category: pe.exercise.category,
        equipmentType: pe.exercise.equipmentType,
        usesBodyweight: pe.exercise.usesBodyweight,
        targetSets: pe.targetSets,
        targetRepsMin: pe.targetRepsMin,
        targetRepsMax: pe.targetRepsMax,
        targetRIR: pe.targetRIR,
        restSec: pe.restSec,
        autoregulationMode: pe.autoregulationMode,
        fatigueRate: pe.fatigueRate,
        loadAdjustmentPct: pe.loadAdjustmentPct,
        supersetGroup: pe.supersetGroup,
        tempo: pe.tempo,
        notes: pe.notes,
      })),
    })),
  };
}

function mapGym(gym: ActiveGymRow) {
  return {
    id: gym.id,
    name: gym.name,
    dumbbellWeights: gym.dumbbellWeights,
    plateWeights: gym.plateWeights,
    barWeights: gym.barWeights,
    exerciseConfigs: gym.exerciseConfigs.map((config) => ({
      exerciseId: config.exerciseId,
      isAvailable: config.isAvailable,
      weightOptions: config.weightOptions,
      preferredEquipmentId: config.preferredEquipmentId,
    })),
    equipment: gym.equipment.map((item) => ({
      id: item.id,
      name: item.name,
      equipmentType: item.equipmentType,
      loadConfigurationKnown: item.loadConfigurationKnown,
      loadType: item.loadType,
      weightOptions: item.weightOptions,
      selectedLoadMultiplier: item.selectedLoadMultiplier,
      baseLoadKg: item.baseLoadKg,
      platePoolId: item.platePoolId,
      loadingSides: item.loadingSides,
      systemBarbellFamily: item.systemBarbellFamily,
      platePool: item.platePool,
      exerciseIds: item.exerciseLinks.map((link) => link.exerciseId),
    })),
  };
}

function targetVolume(source: NonNullable<ProgramDesignContext['sourceProgram']>) {
  const result: ProgramDesignContext['targetVolumeByMuscle'] = {};
  const weeklyInputs = [];
  for (const [workoutIndex, workout] of source.workouts.entries()) {
    const workoutInputs = [];
    for (const [exerciseIndex, exercise] of workout.exercises.entries()) {
      for (let setIndex = 0; setIndex < exercise.targetSets; setIndex += 1) {
        const input = {
          setId: ['target', workoutIndex, exerciseIndex, setIndex].join(':'),
          exerciseId: exercise.exerciseId,
          legacyMuscleGroup: exercise.muscleGroup,
          loadProfile: exercise.loadProfile,
          isWarmup: false,
          isDropSet: false,
          rir: exercise.targetRIR,
          historyReliability: 'UNKNOWN' as const,
        };
        workoutInputs.push(input);
        weeklyInputs.push(input);
      }
    }
    const workoutLoad = aggregateTrainingLoad(workoutInputs);
    for (const [muscle, load] of Object.entries(workoutLoad.muscles)) {
      const row = result[muscle] ?? {
        weeklySets: 0,
        directSets: 0,
        indirectSets: 0,
        equivalentSets: 0,
        frequency: 0,
        maxSetsInOneWorkout: 0,
        maxEquivalentSetsInOneWorkout: 0,
        confidence: load.confidence,
      };
      row.frequency += 1;
      row.maxSetsInOneWorkout = Math.max(row.maxSetsInOneWorkout, load.directSets);
      row.maxEquivalentSetsInOneWorkout = Math.max(
        row.maxEquivalentSetsInOneWorkout,
        load.equivalentSets,
      );
      result[muscle] = row;
    }
  }
  const weeklyLoad = aggregateTrainingLoad(weeklyInputs);
  for (const [muscle, load] of Object.entries(weeklyLoad.muscles)) {
    const row = result[muscle] ?? {
      weeklySets: 0,
      directSets: 0,
      indirectSets: 0,
      equivalentSets: 0,
      frequency: 0,
      maxSetsInOneWorkout: 0,
      maxEquivalentSetsInOneWorkout: 0,
      confidence: load.confidence,
    };
    row.weeklySets = load.directSets;
    row.directSets = load.directSets;
    row.indirectSets = load.indirectSets;
    row.equivalentSets = load.equivalentSets;
    row.confidence = load.confidence;
    result[muscle] = row;
  }
  return result;
}

async function buildReturnRecommendations(input: {
  userId: string;
  sourceRow: SourceProgramRow | null;
  activeGym: ActiveGymRow | null;
  bodyweight: number | null;
}): Promise<ProgramDesignContext['returnToTraining']> {
  if (!input.sourceRow) return [];
  const programExercises = input.sourceRow.workouts.flatMap((workout) => workout.exercises);
  const recommendations = await getReturnToTrainingRecommendations({
    userId: input.userId,
    programExercises,
    excludeSessionId: null,
    now: new Date(),
    bodyweight: input.bodyweight,
    gym: input.activeGym,
  });
  return programExercises.map((pe) => {
    const recommendation = recommendations[pe.id];
    return {
      programExerciseId: pe.id,
      exerciseName: pe.exercise.name,
      mode: recommendation?.mode ?? 'normal',
      targetSets: recommendation?.targetSets ?? pe.targetSets,
      targetRIR: recommendation?.targetRIR ?? pe.targetRIR,
      suggestedWeight: recommendation?.suggestedWeight ?? null,
      exerciseGapDays: recommendation?.exerciseGapDays ?? null,
      muscleGapDays: recommendation?.muscleGapDays ?? null,
    };
  });
}

function buildMissingQuestions(input: {
  mode: ProgramDesignMode;
  goal: string | null;
  trainingExperience: TrainingExperience | null;
  sessionDurationMin: number | null;
  availableDays: number[] | null;
  healthStatus: ProgramHealthStatus | null;
  limitationsKnown: boolean;
  equipmentAccess: string | null;
  postBlockAssessment: PostBlockAssessment | null;
}): ProgramDesignQuestion[] {
  const questions: ProgramDesignQuestion[] = [];
  if (!input.healthStatus) {
    questions.push({
      id: 'healthStatus',
      prompt: 'Which safety status applies before ordinary training programming?',
      input: 'select',
      required: true,
      options: [
        { value: 'NO_SIGNIFICANT_ISSUES', label: 'No significant issues for ordinary training' },
        { value: 'TRAIN_WITH_LIMITATIONS', label: 'Train with known limitations' },
        { value: 'MEDICAL_CLEARANCE_REQUIRED', label: 'Medical clearance is required' },
      ],
    });
  }
  if (!input.trainingExperience) {
    questions.push({
      id: 'trainingExperience',
      prompt: 'What is your resistance-training experience?',
      input: 'select',
      required: true,
      options: [
        { value: 'BEGINNER', label: 'Beginner' },
        { value: 'INTERMEDIATE', label: 'Intermediate' },
        { value: 'ADVANCED', label: 'Advanced' },
      ],
    });
  }
  if (!input.availableDays) {
    questions.push({
      id: 'availableDays',
      prompt: 'Which specific weekdays are realistically available for training?',
      input: 'multi-select',
      required: true,
      options: [1, 2, 3, 4, 5, 6, 7].map((day) => ({ value: String(day), label: String(day) })),
    });
  }
  if (!input.limitationsKnown) {
    questions.push({
      id: 'limitations',
      prompt:
        'Are there current pain, injury, movement, or exercise constraints? Name affected exercises, or answer none.',
      input: 'text',
      required: true,
    });
  }
  if (!input.sessionDurationMin) {
    questions.push({
      id: 'sessionDurationMin',
      prompt: 'How many minutes can one training session usually take?',
      input: 'number',
      required: true,
      min: 20,
      max: 240,
    });
  }
  if (!input.goal) {
    questions.push({
      id: 'goal',
      prompt: 'What is the primary training goal for this program?',
      input: 'text',
      required: true,
    });
  }
  if (!input.equipmentAccess) {
    questions.push({
      id: 'equipmentAccess',
      prompt: 'What equipment is available when no active gym inventory is configured?',
      input: 'text',
      required: true,
    });
  }
  if (
    (input.mode === 'NEXT_MESOCYCLE' || input.mode === 'REVISE_CURRENT') &&
    !input.postBlockAssessment
  ) {
    questions.push({
      id: 'postBlockAssessment',
      prompt: 'Which recovery signals worsened during the current block?',
      input: 'checklist',
      required: true,
      items: [
        { value: 'dreadingTraining', label: 'Less desire to train or dreading sessions' },
        { value: 'sleepWorse', label: 'Sleep quality worsened' },
        { value: 'performanceDecreasing', label: 'Performance decreased repeatedly' },
        { value: 'lifeStressHigher', label: 'Life stress increased' },
        { value: 'achesAndPainsWorse', label: 'Aches or pains worsened' },
      ],
    });
  }
  return questions;
}

function profileGoalDescription(goal: string | null): string | null {
  if (!goal) return null;
  const labels: Record<string, string> = {
    HYPERTROPHY: 'Hypertrophy',
    STRENGTH: 'Strength',
    FAT_LOSS: 'Fat loss',
    RECOMP: 'Body recomposition',
    GENERAL_FITNESS: 'General fitness',
  };
  return labels[goal] ?? goal;
}

function summarizeProfilePriorities(profile: CoachPayload['userProfile']['coachingProfile']) {
  const muscles = knownCoachingValue(profile.priorityMuscles);
  const movements = knownCoachingValue(profile.priorityStrengthMovements);
  const parts: string[] = [];
  if (muscles?.length) parts.push(`Priority muscles: ${muscles.join(', ')}`);
  if (movements?.length) parts.push(`Priority movements: ${movements.join(', ')}`);
  return parts.length ? parts.join('; ') : null;
}

function summarizeOutsideActivities(profile: CoachPayload['userProfile']['coachingProfile']) {
  const activities = knownCoachingValue(profile.outsideActivities);
  if (!activities?.length) return null;
  return activities
    .map((activity) => {
      const details = [
        activity.sessionsPerWeek != null ? `${activity.sessionsPerWeek}/week` : null,
        activity.minutesPerWeek != null ? `${activity.minutesPerWeek} min/week` : null,
        activity.intensity ?? null,
      ].filter(Boolean);
      return `${activity.type}: ${activity.name}${details.length ? ` (${details.join(', ')})` : ''}`;
    })
    .join('; ');
}

function summarizeExercisePreferences(profile: CoachPayload['userProfile']['coachingProfile']) {
  const liked = knownCoachingValue(profile.likedExercises);
  const disliked = knownCoachingValue(profile.dislikedExercises);
  const parts: string[] = [];
  if (liked?.length) parts.push(`Likes: ${liked.join(', ')}`);
  if (disliked?.length) parts.push(`Dislikes: ${disliked.join(', ')}`);
  return parts.length ? parts.join('; ') : null;
}

function distinctHistoryWeeks(progress: CoachPayload['recentProgress']) {
  const weeks = new Set<string>();
  for (const exercise of progress) {
    for (const session of exercise.sessions) {
      const date = new Date(session.date);
      const day = date.getUTCDay() || 7;
      date.setUTCDate(date.getUTCDate() - day + 1);
      weeks.add(date.toISOString().slice(0, 10));
    }
  }
  return weeks.size;
}

function nonEmpty(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
