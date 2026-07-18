import { db } from '@/lib/db';
import { buildCoachPayload, type CoachPayload } from '@/lib/coach';
import { getReturnToTrainingRecommendations } from '@/lib/return-to-training-history';
import { PROGRAM_DESIGN_METHODOLOGY_VERSION } from '@/lib/program-design-methodology';
import { buildMcpTrainingHistorySummary } from '@/lib/mcp/training-history';
import type {
  PostBlockAssessment,
  ProgramDesignAnswers,
  ProgramDesignMode,
  ProgramHealthStatus,
  TrainingExperience,
} from '@/lib/schemas/program-design';
import { MuscleGroup, type Prisma } from '@/lib/prisma-client';
import {
  resolveExerciseInventory,
  type EquipmentLoadProfile,
  type ResolvedEquipmentLoadProfile,
} from '@/lib/gym-loads';
import {
  hasKnownLimitations,
  knownCoachingValue,
  summarizeCoachingLimitations,
  type CoachingLimitation,
  type CoachingProfile,
} from '@/lib/schemas/coaching-profile';
import {
  aggregateTrainingLoad,
  type TrainingLoadAggregation,
} from '@/lib/training-load-aggregation';
import {
  normalizeExerciseLoadProfile,
  type ExerciseLoadProfile,
} from '@/lib/schemas/exercise-load-profile';

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
  exerciseConfigs: {
    include: { exercise: { select: { id: true, name: true } } },
  },
  equipment: {
    orderBy: { name: 'asc' as const },
    include: {
      exerciseLinks: true,
      platePool: { include: { plates: { orderBy: { weightKg: 'asc' as const } } } },
    },
  },
  platePools: { include: { plates: { orderBy: { weightKg: 'asc' as const } } } },
} satisfies Prisma.GymInclude;

type SourceProgramRow = Prisma.ProgramGetPayload<{ include: typeof sourceProgramInclude }>;
type ActiveGymRow = Prisma.GymGetPayload<{ include: typeof activeGymInclude }>;

export type RecoveryLevel = 'recovering' | 'watch' | 'reduce_load';

export interface ProgramDesignQuestion {
  id:
    | 'goal'
    | 'trainingExperience'
    | 'weeklyFrequency'
    | 'sessionDurationMin'
    | 'healthStatus'
    | 'availableDays'
    | 'scheduleConstraints'
    | 'limitations'
    | 'equipmentAccess'
    | 'preferences'
    | 'recentTrainingBackground'
    | 'goalPriorities'
    | 'concurrentTraining'
    | 'techniqueAndRirFamiliarity'
    | 'changesSinceLastProgram'
    | 'postBlockAssessment';
  prompt: string;
  input: 'select' | 'number' | 'text' | 'checklist' | 'multi-select';
  required: boolean;
  reason?: string;
  options?: Array<{ value: string; label: string }>;
  items?: Array<{ value: keyof PostBlockAssessment; label: string }>;
  min?: number;
  max?: number;
}

export interface ProgramDesignContext {
  methodologyVersion: string;
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
    techniqueAndRirFamiliarity: string | null;
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
  recommendedQuestions: ProgramDesignQuestion[];
  profile: CoachPayload['userProfile'];
  safety: {
    healthStatus: ProgramHealthStatus | null;
    canGenerateProgram: boolean;
    blockingReasons: string[];
  };
  recovery: {
    systemic: { level: RecoveryLevel; reasons: string[] };
    byMuscle: Record<string, { level: RecoveryLevel; reasons: string[] }>;
    latestReadiness: CoachPayload['latestReadiness'];
    fatigue: CoachPayload['fatigue'];
  };
  program: {
    source: SourceProgram | null;
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
        algorithmVersion: string;
        confidence: string;
      }
    >;
    personalVolumeTargets: Record<
      string,
      { minimumEffectiveVolume: number; maximumRecoverableVolume: number }
    >;
  };
  history: {
    rolling: Awaited<ReturnType<typeof buildMcpTrainingHistorySummary>>;
    currentWeek: CoachPayload['weekCurrent'];
    previousWeek: CoachPayload['weekPrevious'];
    actualHardSetsByMuscle: {
      currentWeek: Record<string, number>;
      previousWeek: Record<string, number>;
    };
    trainingLoad: {
      currentWeek: TrainingLoadAggregation;
      previousWeek: TrainingLoadAggregation | null;
    };
    adherence: {
      sessionsLogged: number;
      expectedSessions: number | null;
      rate: number | null;
    };
    rirAdherence: {
      setsWithRir: number;
      meanDeltaFromTarget: number | null;
      materiallyHarderSets: number;
      materiallyEasierSets: number;
      byExercise: Array<{
        exerciseName: string;
        setsWithRir: number;
        meanDeltaFromTarget: number;
      }>;
    };
    sessionMetrics: Array<{
      sessionId: string;
      startedAt: string;
      durationMin: number | null;
      workingSetCount: number;
      workingSetsPerHour: number | null;
    }>;
    exerciseTrends: Array<{
      exerciseId: string;
      exerciseName: string;
      muscleGroup: string;
      sessions: number;
      currentLoad: number | null;
      e1rmChangePct: number | null;
      stalled: boolean;
    }>;
    returnToTraining: Array<{
      programExerciseId: string;
      exerciseName: string;
      muscleGroup: string;
      mode: string;
      exerciseGapDays: number | null;
      returnGapDays: number | null;
      muscleGapDays: number | null;
      targetSets: number;
      targetRIR: number;
      suggestedWeight: number | null;
      historyBasis: string;
      confidence: string;
      recentHistorySessionCount: number;
      longTermHistorySessionCount: number;
      nonComparableHistorySessionCount: number;
    }>;
    unavailableMetrics: string[];
  };
  goals: CoachPayload['goals'];
  records: CoachPayload['records'];
  conditioning: CoachPayload['conditioning'];
  gym: ActiveGymSummary | null;
  availableExercises: AvailableExercise[];
  exerciseConstraints: Array<{
    source: 'profile' | 'request';
    kind: CoachingLimitation['kind'] | 'REQUEST_EXCLUSION';
    label: string;
    affectedExerciseNames: string[];
    details: string | null;
  }>;
  dataQuality: {
    sessionsInTwoWeeks: number;
    exercisesWithRecentProgress: number;
    historyWeeks: number;
    confidence: 'low' | 'medium' | 'high';
  };
}

interface SourceProgram {
  id: string;
  name: string;
  phase: string;
  description: string | null;
  startDate: string;
  endDate: string | null;
  workouts: Array<{
    id: string;
    name: string;
    dayOfWeek: number | null;
    order: number;
    exercises: Array<{
      id: string;
      order: number;
      exerciseId: string;
      exerciseName: string;
      muscleGroup: MuscleGroup;
      loadProfile: ExerciseLoadProfile;
      category: string;
      equipmentType: string;
      usesBodyweight: boolean;
      targetSets: number;
      targetDropSets: number;
      targetRepsMin: number;
      targetRepsMax: number;
      targetRIR: number;
      restSec: number;
      autoregulationMode: string;
      fatigueRate: number | null;
      loadAdjustmentPct: number | null;
      supersetGroup: number | null;
      tempo: string | null;
      notes: string | null;
    }>;
  }>;
}

interface ActiveGymSummary {
  id: string;
  name: string;
  inventoryMode: string;
  dumbbellWeights: number[];
  plateWeights: number[];
  barWeights: number[];
  exerciseConfigs: Array<{
    exerciseId: string;
    exerciseName: string;
    preferredEquipmentId: string | null;
    isAvailable: boolean;
    systemProfileSupported: boolean | null;
    weightOptions: number[];
    dumbbellWeights: number[];
    plateWeights: number[];
    barWeights: number[];
  }>;
  platePools: Array<{
    id: string;
    name: string;
    compatibilityKey: string;
    plates: Array<{ weightKg: number; quantity: number | null }>;
  }>;
  equipment: Array<{
    id: string;
    name: string;
    equipmentType: string;
    description: string | null;
    quantity: number;
    loadType: string;
    weightOptions: number[];
    selectedLoadMultiplier: number;
    baseLoadKg: number;
    loadingSides: number;
    exerciseIds: string[];
    platePoolId: string | null;
  }>;
}

interface AvailableExercise {
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
  isAllowedByProfile: boolean;
  limitationReasons: string[];
  availabilitySource: string | null;
  requiresEquipmentSelection: boolean;
  equipmentOptions: ResolvedEquipmentLoadProfile[];
  weightOptions: number[];
  dumbbellWeights: number[];
  plateWeights: number[];
  barWeights: number[];
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
  const coachPromise = buildCoachPayload(userId);
  const trainingHistoryPromise = buildMcpTrainingHistorySummary(userId);
  const sourceProgramPromise = db.program.findFirst({
    where: sourceProgramId ? { id: sourceProgramId, userId } : { userId, isActive: true },
    include: sourceProgramInclude,
  });
  const userContextPromise = db.user.findUnique({
    where: { id: userId },
    select: {
      volumeTargets: {
        orderBy: { muscleGroup: 'asc' },
        select: { muscleGroup: true, mev: true, mrv: true },
      },
      activeGym: {
        include: activeGymInclude,
      },
    },
  });
  const exercisesPromise = db.exercise.findMany({
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
  });

  const [coach, trainingHistory, sourceRow, userContext, exercises] = await Promise.all([
    coachPromise,
    trainingHistoryPromise,
    sourceProgramPromise,
    userContextPromise,
    exercisesPromise,
  ]);

  if ((mode === 'NEXT_MESOCYCLE' || mode === 'REVISE_CURRENT') && !sourceRow) {
    throw new Error('An active or explicitly selected source program is required for this mode.');
  }

  const source = sourceRow ? mapSourceProgram(sourceRow) : null;
  const activeGym = userContext?.activeGym ?? null;
  const gym = activeGym ? mapGym(activeGym) : null;
  const coachingProfile = coach.userProfile.coachingProfile;
  const exerciseConstraints: ProgramDesignContext['exerciseConstraints'] =
    answers.excludedExercises !== undefined
      ? answers.excludedExercises.map((exerciseName) => ({
          source: 'request' as const,
          kind: 'REQUEST_EXCLUSION' as const,
          label: 'Excluded for this program request',
          affectedExerciseNames: [exerciseName],
          details: null,
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
  const constraintReasonsByExerciseName = new Map<string, string[]>();
  for (const constraint of exerciseConstraints) {
    for (const exerciseName of constraint.affectedExerciseNames) {
      const key = exerciseName.toLocaleLowerCase();
      const reasons = constraintReasonsByExerciseName.get(key) ?? [];
      reasons.push(`${constraint.kind}: ${constraint.label}`);
      constraintReasonsByExerciseName.set(key, reasons);
    }
  }
  const configByExercise = new Map(
    gym?.exerciseConfigs.map((config) => [config.exerciseId, config]) ?? [],
  );
  const availableExercises = exercises.map((exercise) => {
    const config = configByExercise.get(exercise.id);
    const resolved = activeGym
      ? resolveExerciseInventory({
          inventoryMode: activeGym.inventoryMode,
          exercise,
          linkedEquipment: activeGym.equipment
            .filter((item) => item.exerciseLinks.some((link) => link.exerciseId === exercise.id))
            .map(toEquipmentLoadProfile),
          preferredEquipmentId: config?.preferredEquipmentId ?? null,
          legacyConfig: config,
          sharedDumbbellWeights: activeGym.dumbbellWeights,
          legacyPlateWeights: activeGym.plateWeights,
          legacyBarWeights: activeGym.barWeights,
        })
      : null;
    const limitationReasons =
      constraintReasonsByExerciseName.get(exercise.name.toLocaleLowerCase()) ?? [];
    return {
      id: exercise.id,
      name: exercise.name,
      muscleGroup: exercise.muscleGroup,
      loadProfile: normalizeExerciseLoadProfile(exercise.loadProfile, exercise.muscleGroup),
      category: exercise.category,
      equipmentType: exercise.equipmentType,
      usesBodyweight: exercise.usesBodyweight,
      defaultRestSec: exercise.defaultRestSec,
      notes: exercise.notes,
      isAvailableInActiveGym: resolved?.isAvailable ?? null,
      isAllowedByProfile: limitationReasons.length === 0,
      limitationReasons,
      availabilitySource: resolved?.source ?? null,
      requiresEquipmentSelection: resolved?.requiresEquipmentSelection ?? false,
      equipmentOptions: resolved?.equipment ?? [],
      weightOptions: resolved?.weightOptions ?? config?.weightOptions ?? [],
      dumbbellWeights: config?.dumbbellWeights.length
        ? config.dumbbellWeights
        : (gym?.dumbbellWeights ?? []),
      plateWeights: config?.plateWeights.length ? config.plateWeights : (gym?.plateWeights ?? []),
      barWeights: config?.barWeights.length ? config.barWeights : (gym?.barWeights ?? []),
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
  const resolvedLimitations =
    nonEmpty(answers.limitations) ??
    (answers.excludedExercises !== undefined
      ? answers.excludedExercises.length > 0
        ? `Exclude: ${answers.excludedExercises.join(', ')}`
        : 'none'
      : summarizeCoachingLimitations(coachingProfile));
  const resolvedEquipmentAccess = nonEmpty(answers.equipmentAccess);
  const resolvedGoalPriorities =
    nonEmpty(answers.goalPriorities) ?? summarizeProfilePriorities(coachingProfile);
  const resolvedConcurrentTraining =
    nonEmpty(answers.concurrentTraining) ?? summarizeOutsideActivities(coachingProfile);
  const resolvedPreferences =
    nonEmpty(answers.preferences) ?? summarizeExercisePreferences(coachingProfile);
  const resolvedHealthStatus = answers.healthStatus ?? profileHealthStatus;
  const limitationsKnown =
    nonEmpty(answers.limitations) != null ||
    answers.excludedExercises !== undefined ||
    (resolvedHealthStatus === 'TRAIN_WITH_LIMITATIONS'
      ? coachingProfile.limitations.state === 'KNOWN' &&
        coachingProfile.limitations.value.entries.length > 0
      : hasKnownLimitations(coachingProfile));
  const missingQuestions = buildMissingQuestions({
    mode,
    goal: resolvedGoal,
    trainingExperience: resolvedTrainingExperience,
    sessionDurationMin: resolvedSessionDuration,
    availableDays: resolvedAvailableDays,
    healthStatus: resolvedHealthStatus,
    limitationsKnown,
    equipmentAccess: gym || resolvedEquipmentAccess ? 'known' : null,
    postBlockAssessment: answers.postBlockAssessment ?? null,
  });

  const targetVolumeByMuscle = source ? targetVolume(source) : {};
  const currentHardSets = hardSetsFromTrainingLoad(coach.trainingLoad.currentWeek);
  const previousHardSets = coach.trainingLoad.previousWeek
    ? hardSetsFromTrainingLoad(coach.trainingLoad.previousWeek)
    : {};
  const sessionsLogged =
    coach.weekCurrent.sessions.length + (coach.weekPrevious?.sessions.length ?? 0);
  const expectedSessions = resolvedWeeklyFrequency ? resolvedWeeklyFrequency * 2 : null;
  const historyWeeks = distinctHistoryWeeks(coach.recentProgress);
  const rirAdherence = calculateRirAdherence(coach, source);
  const recommendedQuestions = buildRecommendedQuestions({
    mode,
    answers,
    historyWeeks,
    setsWithRir: rirAdherence.setsWithRir,
  });
  const safety = programSafety(resolvedHealthStatus);
  const personalVolumeTargets = Object.fromEntries(
    (userContext?.volumeTargets ?? []).map((target) => [
      target.muscleGroup,
      { minimumEffectiveVolume: target.mev, maximumRecoverableVolume: target.mrv },
    ]),
  );
  const returnToTraining = await buildReturnRecommendations({
    userId,
    sourceRow,
    gym: userContext?.activeGym ?? null,
    bodyweight: coach.userProfile.bodyweight,
  });
  const byMuscle = localRecovery(coach, returnToTraining);

  return {
    methodologyVersion: PROGRAM_DESIGN_METHODOLOGY_VERSION,
    generatedAt: new Date().toISOString(),
    mode,
    goal: resolvedGoal ?? '',
    sourceProgramId: mode === 'NEW_PROGRAM' ? null : (source?.id ?? null),
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
      preferences: resolvedPreferences,
      recentTrainingBackground: nonEmpty(answers.recentTrainingBackground),
      goalPriorities: resolvedGoalPriorities,
      concurrentTraining: resolvedConcurrentTraining,
      techniqueAndRirFamiliarity: nonEmpty(answers.techniqueAndRirFamiliarity),
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
        : answers.availableDays
          ? 'request'
          : profileAvailableDays
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
      limitations:
        nonEmpty(answers.limitations) || answers.excludedExercises !== undefined
          ? 'request'
          : limitationsKnown
            ? 'profile'
            : 'unknown',
      equipmentAccess: resolvedEquipmentAccess ? 'request' : gym ? 'active-gym' : 'unknown',
    },
    missingQuestions,
    recommendedQuestions,
    profile: coach.userProfile,
    safety,
    recovery: {
      systemic: systemicRecovery(coach, answers.postBlockAssessment ?? null),
      byMuscle,
      latestReadiness: coach.latestReadiness,
      fatigue: coach.fatigue,
    },
    program: { source, targetVolumeByMuscle, personalVolumeTargets },
    history: {
      rolling: trainingHistory,
      currentWeek: coach.weekCurrent,
      previousWeek: coach.weekPrevious,
      actualHardSetsByMuscle: {
        currentWeek: currentHardSets,
        previousWeek: previousHardSets,
      },
      trainingLoad: coach.trainingLoad,
      adherence: {
        sessionsLogged,
        expectedSessions,
        rate: expectedSessions ? round(Math.min(1, sessionsLogged / expectedSessions), 2) : null,
      },
      rirAdherence,
      sessionMetrics: sessionMetrics(coach),
      exerciseTrends: coach.recentProgress.map((exercise) => ({
        exerciseId: exercise.exerciseId,
        exerciseName: exercise.exerciseName,
        muscleGroup: exercise.muscleGroup,
        sessions: exercise.sessions.length,
        currentLoad: exercise.currentLoad,
        e1rmChangePct: trendPct(exercise.sessions.map((session) => session.estimated1RM)),
        stalled: coach.fatigue.stalledExercises.includes(exercise.exerciseName),
      })),
      returnToTraining,
      unavailableMetrics: [
        'Life stress is only available when the trainee reports it in notes or the post-block checklist.',
        'Effort and range-of-motion coefficients remain unknown unless a reliable explicit source supplies them.',
      ],
    },
    goals: coach.goals,
    records: coach.records,
    conditioning: coach.conditioning,
    gym,
    availableExercises,
    exerciseConstraints,
    dataQuality: {
      sessionsInTwoWeeks: sessionsLogged,
      exercisesWithRecentProgress: coach.recentProgress.length,
      historyWeeks,
      confidence: sessionsLogged < 3 ? 'low' : sessionsLogged < 8 ? 'medium' : 'high',
    },
  };
}

function mapSourceProgram(program: SourceProgramRow): SourceProgram {
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
        targetDropSets: pe.targetDropSets,
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

function mapGym(gym: ActiveGymRow): ActiveGymSummary {
  return {
    id: gym.id,
    name: gym.name,
    inventoryMode: gym.inventoryMode,
    dumbbellWeights: gym.dumbbellWeights,
    plateWeights: gym.plateWeights,
    barWeights: gym.barWeights,
    exerciseConfigs: gym.exerciseConfigs.map((config) => ({
      exerciseId: config.exerciseId,
      exerciseName: config.exercise.name,
      preferredEquipmentId: config.preferredEquipmentId,
      isAvailable: config.isAvailable,
      systemProfileSupported: config.systemProfileSupported,
      weightOptions: config.weightOptions,
      dumbbellWeights: config.dumbbellWeights,
      plateWeights: config.plateWeights,
      barWeights: config.barWeights,
    })),
    platePools: gym.platePools.map((pool) => ({
      id: pool.id,
      name: pool.name,
      compatibilityKey: pool.compatibilityKey,
      plates: pool.plates.map((plate) => ({
        weightKg: plate.weightKg,
        quantity: plate.quantity,
      })),
    })),
    equipment: gym.equipment.map((item) => ({
      id: item.id,
      name: item.name,
      equipmentType: item.equipmentType,
      description: item.description,
      quantity: item.quantity,
      loadType: item.loadType,
      weightOptions: item.weightOptions,
      selectedLoadMultiplier: item.selectedLoadMultiplier,
      baseLoadKg: item.baseLoadKg,
      loadingSides: item.loadingSides,
      exerciseIds: item.exerciseLinks.map((link) => link.exerciseId),
      platePoolId: item.platePoolId,
    })),
  };
}

function toEquipmentLoadProfile(item: ActiveGymRow['equipment'][number]): EquipmentLoadProfile {
  return {
    equipmentId: item.id,
    equipmentName: item.name,
    equipmentType: item.equipmentType,
    loadType: item.loadType,
    weightOptions: item.weightOptions,
    selectedLoadMultiplier: item.selectedLoadMultiplier,
    baseLoadKg: item.baseLoadKg,
    loadingSides: item.loadingSides,
    platePoolId: item.platePoolId,
    platePoolName: item.platePool?.name ?? null,
    plates: item.platePool?.plates ?? [],
  };
}

function targetVolume(source: SourceProgram) {
  const result: ProgramDesignContext['program']['targetVolumeByMuscle'] = {};
  for (const workout of source.workouts) {
    const sessionLoad = aggregateTrainingLoad(
      workout.exercises.flatMap((exercise) =>
        Array.from({ length: exercise.targetSets + exercise.targetDropSets }, (_, index) => ({
          setId: `${workout.id}:${exercise.id}:${index}`,
          exerciseId: exercise.exerciseId,
          legacyMuscleGroup: exercise.muscleGroup,
          loadProfile: exercise.loadProfile,
          isWarmup: false,
          isDropSet: index >= exercise.targetSets,
          rir: exercise.targetRIR,
          historyReliability: 'UNKNOWN' as const,
        })),
      ),
    );
    for (const [muscle, sessionRow] of Object.entries(sessionLoad.muscles)) {
      const row = (result[muscle] ??= {
        weeklySets: 0,
        directSets: 0,
        indirectSets: 0,
        equivalentSets: 0,
        frequency: 0,
        maxSetsInOneWorkout: 0,
        maxEquivalentSetsInOneWorkout: 0,
        algorithmVersion: sessionLoad.algorithmVersion,
        confidence: sessionRow.confidence,
      });
      row.weeklySets += sessionRow.directSets;
      row.directSets += sessionRow.directSets;
      row.indirectSets += sessionRow.indirectSets;
      row.equivalentSets = round(row.equivalentSets + sessionRow.equivalentSets, 2);
      row.frequency += 1;
      row.maxSetsInOneWorkout = Math.max(row.maxSetsInOneWorkout, sessionRow.directSets);
      row.maxEquivalentSetsInOneWorkout = Math.max(
        row.maxEquivalentSetsInOneWorkout,
        sessionRow.equivalentSets,
      );
    }
  }
  return result;
}

function hardSetsFromTrainingLoad(load: TrainingLoadAggregation): Record<string, number> {
  return Object.fromEntries(
    Object.entries(load.muscles).map(([muscle, row]) => [
      muscle,
      row.directSetBreakdown.setsAtRir0To4,
    ]),
  );
}

function calculateRirAdherence(
  coach: CoachPayload,
  source: SourceProgram | null,
): ProgramDesignContext['history']['rirAdherence'] {
  const targetByExercise = new Map<string, number>();
  for (const workout of source?.workouts ?? []) {
    for (const exercise of workout.exercises) {
      if (!targetByExercise.has(exercise.exerciseName)) {
        targetByExercise.set(exercise.exerciseName, exercise.targetRIR);
      }
    }
  }

  const deltasByExercise = new Map<string, number[]>();
  for (const week of [coach.weekCurrent, coach.weekPrevious]) {
    if (!week) continue;
    for (const session of week.sessions) {
      for (const exercise of session.exercises) {
        const target = targetByExercise.get(exercise.exerciseName);
        if (target == null) continue;
        for (const set of exercise.sets) {
          if (set.isWarmup || set.isDropSet || set.rir == null) continue;
          const rows = deltasByExercise.get(exercise.exerciseName) ?? [];
          rows.push(set.rir - target);
          deltasByExercise.set(exercise.exerciseName, rows);
        }
      }
    }
  }

  const all = [...deltasByExercise.values()].flat();
  return {
    setsWithRir: all.length,
    meanDeltaFromTarget: all.length > 0 ? round(mean(all), 2) : null,
    materiallyHarderSets: all.filter((delta) => delta <= -2).length,
    materiallyEasierSets: all.filter((delta) => delta >= 2).length,
    byExercise: [...deltasByExercise.entries()]
      .map(([exerciseName, deltas]) => ({
        exerciseName,
        setsWithRir: deltas.length,
        meanDeltaFromTarget: round(mean(deltas), 2),
      }))
      .sort((a, b) => a.exerciseName.localeCompare(b.exerciseName)),
  };
}

function sessionMetrics(coach: CoachPayload): ProgramDesignContext['history']['sessionMetrics'] {
  return [coach.weekCurrent, coach.weekPrevious]
    .filter((week): week is NonNullable<typeof week> => week != null)
    .flatMap((week) => week.sessions)
    .map((session) => ({
      sessionId: session.sessionId,
      startedAt: session.startedAt,
      durationMin: session.durationMin,
      workingSetCount: session.workingSetCount,
      workingSetsPerHour:
        session.durationMin && session.durationMin > 0
          ? round((session.workingSetCount * 60) / session.durationMin, 1)
          : null,
    }));
}

function systemicRecovery(
  coach: CoachPayload,
  assessment: PostBlockAssessment | null,
): { level: RecoveryLevel; reasons: string[] } {
  const reasons: string[] = [];
  if (coach.fatigue.deloadActive) reasons.push('A planned deload is active.');
  if (coach.fatigue.deloadRecommended) reasons.push(...coach.fatigue.deloadReasons);
  if (coach.latestReadiness?.readiness === 1) reasons.push('Latest readiness is 1/5.');
  if (reasons.length > 0) return { level: 'reduce_load', reasons };

  const postBlockReasons = assessment ? postBlockRecoveryReasons(assessment) : [];
  if (postBlockReasons.length >= 2) {
    return {
      level: 'reduce_load',
      reasons: [
        `Post-block recovery checklist has ${postBlockReasons.length} warning signals.`,
        ...postBlockReasons,
      ],
    };
  }

  if (coach.latestReadiness && coach.latestReadiness.readiness <= 2)
    reasons.push(`Latest readiness is ${coach.latestReadiness.readiness}/5.`);
  if (coach.latestReadiness && coach.latestReadiness.sleepQuality <= 2)
    reasons.push(`Latest sleep quality is ${coach.latestReadiness.sleepQuality}/5.`);
  if (coach.fatigue.stalledExercises.length > 0)
    reasons.push(`${coach.fatigue.stalledExercises.length} exercise(s) are stalled.`);
  reasons.push(...postBlockReasons);
  return reasons.length > 0 ? { level: 'watch', reasons } : { level: 'recovering', reasons: [] };
}

function postBlockRecoveryReasons(assessment: PostBlockAssessment): string[] {
  return [
    assessment.dreadingTraining ? 'Motivation to train has worsened.' : null,
    assessment.sleepWorse ? 'Sleep has worsened during the block.' : null,
    assessment.performanceDecreasing ? 'Performance has been decreasing.' : null,
    assessment.lifeStressHigher ? 'Life stress is higher than usual.' : null,
    assessment.achesAndPainsWorse ? 'Aches or pains have worsened.' : null,
  ].filter((reason): reason is string => reason != null);
}

function localRecovery(
  coach: CoachPayload,
  returns: ProgramDesignContext['history']['returnToTraining'],
): ProgramDesignContext['recovery']['byMuscle'] {
  const result: ProgramDesignContext['recovery']['byMuscle'] = {};
  const soreness = coach.latestReadiness?.soreness ?? {};
  for (const [muscle, value] of Object.entries(soreness)) {
    result[muscle] = {
      level: value >= 5 ? 'reduce_load' : value >= 4 ? 'watch' : 'recovering',
      reasons: value >= 4 ? [`Reported soreness is ${value}/5.`] : [],
    };
  }
  for (const item of returns) {
    if (item.mode === 'normal') continue;
    const row = result[item.muscleGroup] ?? { level: 'recovering' as const, reasons: [] };
    row.level = row.level === 'reduce_load' ? 'reduce_load' : 'watch';
    row.reasons.push(`Return calibration is active for ${item.exerciseName}.`);
    result[item.muscleGroup] = row;
  }
  return result;
}

async function buildReturnRecommendations({
  userId,
  sourceRow,
  gym,
  bodyweight,
}: {
  userId: string;
  sourceRow: SourceProgramRow | null;
  gym: ActiveGymRow | null;
  bodyweight: number | null;
}): Promise<ProgramDesignContext['history']['returnToTraining']> {
  if (!sourceRow) return [];
  const programExercises = sourceRow.workouts.flatMap((workout) => workout.exercises);
  const recommendations = await getReturnToTrainingRecommendations({
    userId,
    programExercises,
    excludeSessionId: null,
    now: new Date(),
    bodyweight,
    gym,
  });
  return programExercises.map((pe) => {
    const recommendation = recommendations[pe.id]!;
    return {
      programExerciseId: pe.id,
      exerciseName: pe.exercise.name,
      muscleGroup: pe.exercise.muscleGroup,
      mode: recommendation.mode,
      exerciseGapDays: recommendation.exerciseGapDays,
      returnGapDays: recommendation.returnGapDays,
      muscleGapDays: recommendation.muscleGapDays,
      targetSets: recommendation.targetSets,
      targetRIR: recommendation.targetRIR,
      suggestedWeight: recommendation.suggestedWeight,
      historyBasis: recommendation.historyBasis,
      confidence: recommendation.confidence,
      recentHistorySessionCount: recommendation.recentHistorySessionCount,
      longTermHistorySessionCount: recommendation.longTermHistorySessionCount,
      nonComparableHistorySessionCount: recommendation.nonComparableHistorySessionCount,
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
      prompt:
        'Which safety status applies before ordinary training programming? Do not self-diagnose; choose medical clearance when illness, injury, surgery, unusual pain, or clinician restrictions may affect training.',
      input: 'select',
      required: true,
      options: [
        { value: 'NO_SIGNIFICANT_ISSUES', label: 'No significant issues for ordinary training' },
        {
          value: 'TRAIN_WITH_LIMITATIONS',
          label: 'Train with known limitations',
        },
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
      options: [
        { value: '1', label: 'Monday' },
        { value: '2', label: 'Tuesday' },
        { value: '3', label: 'Wednesday' },
        { value: '4', label: 'Thursday' },
        { value: '5', label: 'Friday' },
        { value: '6', label: 'Saturday' },
        { value: '7', label: 'Sunday' },
      ],
    });
  }
  if (!input.limitationsKnown) {
    questions.push({
      id: 'limitations',
      prompt:
        'Are there current pain, injury, movement, or exercise constraints? Name every affected exercise so GymCoach can enforce the restriction, or enter "none" when there are none.',
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

function buildRecommendedQuestions(input: {
  mode: ProgramDesignMode;
  answers: ProgramDesignAnswers;
  historyWeeks: number;
  setsWithRir: number;
}): ProgramDesignQuestion[] {
  const questions: ProgramDesignQuestion[] = [];
  if (!nonEmpty(input.answers.scheduleConstraints)) {
    questions.push({
      id: 'scheduleConstraints',
      prompt:
        'Are back-to-back days, variable session lengths, travel, or fixed unavailable times relevant?',
      input: 'text',
      required: false,
      reason: 'Improves schedule fit without blocking a draft.',
    });
  }
  if (!nonEmpty(input.answers.goalPriorities)) {
    questions.push({
      id: 'goalPriorities',
      prompt: 'Which muscles, lifts, outcomes, or dates have the highest priority?',
      input: 'text',
      required: false,
      reason: 'Makes a broad goal specific enough to rank trade-offs.',
    });
  }
  if (!nonEmpty(input.answers.preferences)) {
    questions.push({
      id: 'preferences',
      prompt: 'Which exercises should be kept, preferred, or avoided for non-medical reasons?',
      input: 'text',
      required: false,
      reason: 'Improves adherence and avoids confusing preference with pain.',
    });
  }
  if (!nonEmpty(input.answers.concurrentTraining)) {
    questions.push({
      id: 'concurrentTraining',
      prompt:
        'What other sport, cardio, or physically demanding work must this program fit around?',
      input: 'text',
      required: false,
      reason: 'Captures recovery demands that GymCoach may not have logged.',
    });
  }
  if (input.historyWeeks === 0 && !nonEmpty(input.answers.recentTrainingBackground)) {
    questions.push({
      id: 'recentTrainingBackground',
      prompt: 'What training was completed recently outside the available GymCoach history?',
      input: 'text',
      required: false,
      reason: 'Missing recent exposure lowers confidence in starting volume and load.',
    });
  }
  if (
    (input.answers.trainingExperience === 'BEGINNER' || input.setsWithRir === 0) &&
    !nonEmpty(input.answers.techniqueAndRirFamiliarity)
  ) {
    questions.push({
      id: 'techniqueAndRirFamiliarity',
      prompt: 'Which key movements are familiar, and how comfortable are you estimating RIR?',
      input: 'text',
      required: false,
      reason: 'New movements and unfamiliar RIR need more conservative calibration.',
    });
  }
  if (input.mode !== 'NEW_PROGRAM' && !nonEmpty(input.answers.changesSinceLastProgram)) {
    questions.push({
      id: 'changesSinceLastProgram',
      prompt:
        'What changed in goals, schedule, equipment, symptoms, or preferences since the source program?',
      input: 'text',
      required: false,
      reason: 'Keeps revisions minimal and tied to an explicit reason.',
    });
  }
  return questions;
}

function programSafety(healthStatus: ProgramHealthStatus | null): ProgramDesignContext['safety'] {
  if (healthStatus === 'MEDICAL_CLEARANCE_REQUIRED') {
    return {
      healthStatus,
      canGenerateProgram: false,
      blockingReasons: [
        'Automatic training programming is unavailable until an appropriate qualified professional has cleared ordinary training.',
      ],
    };
  }
  return {
    healthStatus,
    canGenerateProgram: healthStatus != null,
    blockingReasons: [],
  };
}

function profileGoalDescription(goal: string | null): string | null {
  switch (goal) {
    case 'HYPERTROPHY':
      return 'Build muscle and hypertrophy';
    case 'STRENGTH':
      return 'Improve strength';
    case 'FAT_LOSS':
      return 'Support fat loss while training';
    case 'RECOMP':
      return 'Body recomposition';
    case 'GENERAL_FITNESS':
      return 'Improve general fitness';
    default:
      return null;
  }
}

function summarizeProfilePriorities(profile: CoachingProfile): string | null {
  const parts: string[] = [];
  const muscles = knownCoachingValue(profile.priorityMuscles);
  const movements = knownCoachingValue(profile.priorityStrengthMovements);
  if (muscles?.length) parts.push(`Priority muscles: ${muscles.join(', ')}`);
  if (movements?.length) parts.push(`Priority strength movements: ${movements.join(', ')}`);
  return parts.length > 0 ? parts.join('; ') : null;
}

function summarizeOutsideActivities(profile: CoachingProfile): string | null {
  const activities = knownCoachingValue(profile.outsideActivities);
  if (!activities?.length) return null;
  return activities
    .map((activity) => {
      const workload = [
        activity.sessionsPerWeek != null ? `${activity.sessionsPerWeek} sessions/week` : null,
        activity.minutesPerWeek != null ? `${activity.minutesPerWeek} min/week` : null,
        activity.intensity ? `${activity.intensity.toLocaleLowerCase()} intensity` : null,
      ]
        .filter(Boolean)
        .join(', ');
      return `${activity.type}: ${activity.name}${workload ? ` (${workload})` : ''}${activity.details ? ` - ${activity.details}` : ''}`;
    })
    .join('; ');
}

function summarizeExercisePreferences(profile: CoachingProfile): string | null {
  const liked = knownCoachingValue(profile.likedExercises);
  const disliked = knownCoachingValue(profile.dislikedExercises);
  const parts: string[] = [];
  if (liked?.length) parts.push(`Liked exercises: ${liked.join(', ')}`);
  if (disliked?.length) parts.push(`Disliked exercises: ${disliked.join(', ')}`);
  return parts.length > 0 ? parts.join('; ') : null;
}

function distinctHistoryWeeks(progress: CoachPayload['recentProgress']): number {
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

function trendPct(values: number[]): number | null {
  if (values.length < 2) return null;
  const first = values[0]!;
  const last = values.at(-1)!;
  if (!(first > 0)) return null;
  return round(((last - first) / first) * 100, 1);
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function nonEmpty(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
