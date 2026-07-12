import { db } from '@/lib/db';
import { buildCoachPayload, type CoachPayload } from '@/lib/coach';
import { getReturnToTrainingRecommendations } from '@/lib/return-to-training-history';
import { PROGRAM_DESIGN_METHODOLOGY_VERSION } from '@/lib/program-design-methodology';
import type {
  PostBlockAssessment,
  ProgramDesignAnswers,
  ProgramDesignMode,
  TrainingExperience,
} from '@/lib/schemas/program-design';
import type { Prisma } from '@/lib/prisma-client';

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
} satisfies Prisma.GymInclude;

type SourceProgramRow = Prisma.ProgramGetPayload<{ include: typeof sourceProgramInclude }>;
type ActiveGymRow = Prisma.GymGetPayload<{ include: typeof activeGymInclude }>;

export type RecoveryLevel = 'recovering' | 'watch' | 'reduce_load';

export interface ProgramDesignQuestion {
  id:
    | 'trainingExperience'
    | 'weeklyFrequency'
    | 'sessionDurationMin'
    | 'limitations'
    | 'equipmentAccess'
    | 'postBlockAssessment';
  prompt: string;
  input: 'select' | 'number' | 'text' | 'checklist';
  required: true;
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
    phaseLengthWeeks: number;
    limitations: string | null;
    equipmentAccess: string | null;
    preferences: string | null;
    postBlockAssessment: PostBlockAssessment | null;
  };
  missingQuestions: ProgramDesignQuestion[];
  profile: CoachPayload['userProfile'];
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
      { weeklySets: number; frequency: number; maxSetsInOneWorkout: number }
    >;
  };
  history: {
    currentWeek: CoachPayload['weekCurrent'];
    previousWeek: CoachPayload['weekPrevious'];
    actualHardSetsByMuscle: {
      currentWeek: Record<string, number>;
      previousWeek: Record<string, number>;
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
      muscleGapDays: number | null;
      targetSets: number;
      targetRIR: number;
      suggestedWeight: number | null;
    }>;
    unavailableMetrics: string[];
  };
  goals: CoachPayload['goals'];
  records: CoachPayload['records'];
  conditioning: CoachPayload['conditioning'];
  gym: ActiveGymSummary | null;
  availableExercises: AvailableExercise[];
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
      muscleGroup: string;
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
  dumbbellWeights: number[];
  plateWeights: number[];
  barWeights: number[];
  exerciseConfigs: Array<{
    exerciseId: string;
    exerciseName: string;
    isAvailable: boolean;
    weightOptions: number[];
    dumbbellWeights: number[];
    plateWeights: number[];
    barWeights: number[];
  }>;
}

interface AvailableExercise {
  id: string;
  name: string;
  muscleGroup: string;
  category: string;
  equipmentType: string;
  usesBodyweight: boolean;
  defaultRestSec: number;
  notes: string | null;
  isAvailableInActiveGym: boolean | null;
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
  const sourceProgramPromise = db.program.findFirst({
    where: sourceProgramId ? { id: sourceProgramId, userId } : { userId, isActive: true },
    include: sourceProgramInclude,
  });
  const userContextPromise = db.user.findUnique({
    where: { id: userId },
    select: {
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
    },
  });

  const [coach, sourceRow, userContext, exercises] = await Promise.all([
    coachPromise,
    sourceProgramPromise,
    userContextPromise,
    exercisesPromise,
  ]);

  if ((mode === 'NEXT_MESOCYCLE' || mode === 'REVISE_CURRENT') && !sourceRow) {
    throw new Error('An active or explicitly selected source program is required for this mode.');
  }

  const source = sourceRow ? mapSourceProgram(sourceRow) : null;
  const gym = userContext?.activeGym ? mapGym(userContext.activeGym) : null;
  const configByExercise = new Map(
    gym?.exerciseConfigs.map((config) => [config.exerciseId, config]) ?? [],
  );
  const availableExercises = exercises.map((exercise) => {
    const config = configByExercise.get(exercise.id);
    return {
      id: exercise.id,
      name: exercise.name,
      muscleGroup: exercise.muscleGroup,
      category: exercise.category,
      equipmentType: exercise.equipmentType,
      usesBodyweight: exercise.usesBodyweight,
      defaultRestSec: exercise.defaultRestSec,
      notes: exercise.notes,
      isAvailableInActiveGym: gym ? (config?.isAvailable ?? true) : null,
      weightOptions: config?.weightOptions ?? [],
      dumbbellWeights: config?.dumbbellWeights.length
        ? config.dumbbellWeights
        : (gym?.dumbbellWeights ?? []),
      plateWeights: config?.plateWeights.length ? config.plateWeights : (gym?.plateWeights ?? []),
      barWeights: config?.barWeights.length ? config.barWeights : (gym?.barWeights ?? []),
    };
  });

  const durationSamples = [coach.weekCurrent, coach.weekPrevious]
    .filter((week): week is NonNullable<typeof week> => week != null)
    .flatMap((week) => week.sessions.map((session) => session.durationMin))
    .filter((value): value is number => value != null && value > 0);
  const inferredDuration = durationSamples.length >= 3 ? median(durationSamples) : null;
  const resolvedWeeklyFrequency = answers.weeklyFrequency ?? coach.userProfile.weeklyFrequency;
  const resolvedLimitations = nonEmpty(answers.limitations);
  const resolvedEquipmentAccess = nonEmpty(answers.equipmentAccess);
  const missingQuestions = buildMissingQuestions({
    mode,
    trainingExperience: answers.trainingExperience ?? null,
    weeklyFrequency: resolvedWeeklyFrequency,
    sessionDurationMin: answers.sessionDurationMin ?? inferredDuration,
    limitations: resolvedLimitations,
    equipmentAccess: gym || resolvedEquipmentAccess ? 'known' : null,
    postBlockAssessment: answers.postBlockAssessment ?? null,
  });

  const targetVolumeByMuscle = source ? targetVolume(source) : {};
  const currentHardSets = hardSetsByMuscle(coach.weekCurrent);
  const previousHardSets = coach.weekPrevious ? hardSetsByMuscle(coach.weekPrevious) : {};
  const sessionsLogged =
    coach.weekCurrent.sessions.length + (coach.weekPrevious?.sessions.length ?? 0);
  const expectedSessions = resolvedWeeklyFrequency ? resolvedWeeklyFrequency * 2 : null;
  const historyWeeks = distinctHistoryWeeks(coach.recentProgress);
  const rirAdherence = calculateRirAdherence(coach, source);
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
    goal,
    sourceProgramId: mode === 'NEW_PROGRAM' ? null : (source?.id ?? null),
    answers: {
      trainingExperience: answers.trainingExperience ?? null,
      weeklyFrequency: resolvedWeeklyFrequency,
      sessionDurationMin: answers.sessionDurationMin ?? inferredDuration,
      phaseLengthWeeks: answers.phaseLengthWeeks ?? 6,
      limitations: resolvedLimitations,
      equipmentAccess: resolvedEquipmentAccess,
      preferences: nonEmpty(answers.preferences),
      postBlockAssessment: answers.postBlockAssessment ?? null,
    },
    missingQuestions,
    profile: coach.userProfile,
    recovery: {
      systemic: systemicRecovery(coach, answers.postBlockAssessment ?? null),
      byMuscle,
      latestReadiness: coach.latestReadiness,
      fatigue: coach.fatigue,
    },
    program: { source, targetVolumeByMuscle },
    history: {
      currentWeek: coach.weekCurrent,
      previousWeek: coach.weekPrevious,
      actualHardSetsByMuscle: {
        currentWeek: currentHardSets,
        previousWeek: previousHardSets,
      },
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
        'Session RPE and session training impulse are not recorded yet.',
        'Life stress is only available when the trainee reports it in notes or the post-block checklist.',
        'Actual inter-set rest is not included in the program-design payload yet.',
        'Movement-pattern overlap and lumbar-fatigue load are not modeled yet.',
      ],
    },
    goals: coach.goals,
    records: coach.records,
    conditioning: coach.conditioning,
    gym,
    availableExercises,
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
    dumbbellWeights: gym.dumbbellWeights,
    plateWeights: gym.plateWeights,
    barWeights: gym.barWeights,
    exerciseConfigs: gym.exerciseConfigs.map((config) => ({
      exerciseId: config.exerciseId,
      exerciseName: config.exercise.name,
      isAvailable: config.isAvailable,
      weightOptions: config.weightOptions,
      dumbbellWeights: config.dumbbellWeights,
      plateWeights: config.plateWeights,
      barWeights: config.barWeights,
    })),
  };
}

function targetVolume(source: SourceProgram) {
  const result: ProgramDesignContext['program']['targetVolumeByMuscle'] = {};
  for (const workout of source.workouts) {
    const seen = new Set<string>();
    const sessionSets = new Map<string, number>();
    for (const exercise of workout.exercises) {
      const muscle = exercise.muscleGroup;
      const row = result[muscle] ?? { weeklySets: 0, frequency: 0, maxSetsInOneWorkout: 0 };
      const totalSets = exercise.targetSets + exercise.targetDropSets;
      row.weeklySets += totalSets;
      result[muscle] = row;
      seen.add(muscle);
      sessionSets.set(muscle, (sessionSets.get(muscle) ?? 0) + totalSets);
    }
    for (const muscle of seen) result[muscle]!.frequency += 1;
    for (const [muscle, sets] of sessionSets) {
      result[muscle]!.maxSetsInOneWorkout = Math.max(result[muscle]!.maxSetsInOneWorkout, sets);
    }
  }
  return result;
}

function hardSetsByMuscle(week: CoachPayload['weekCurrent']): Record<string, number> {
  const result: Record<string, number> = {};
  for (const session of week.sessions) {
    for (const exercise of session.exercises) {
      const count = exercise.sets.filter(
        (set) => !set.isWarmup && (set.rir == null || set.rir <= 4),
      ).length;
      result[exercise.muscleGroup] = (result[exercise.muscleGroup] ?? 0) + count;
    }
  }
  return result;
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
      muscleGapDays: recommendation.muscleGapDays,
      targetSets: recommendation.targetSets,
      targetRIR: recommendation.targetRIR,
      suggestedWeight: recommendation.suggestedWeight,
    };
  });
}

function buildMissingQuestions(input: {
  mode: ProgramDesignMode;
  trainingExperience: TrainingExperience | null;
  weeklyFrequency: number | null;
  sessionDurationMin: number | null;
  limitations: string | null;
  equipmentAccess: string | null;
  postBlockAssessment: PostBlockAssessment | null;
}): ProgramDesignQuestion[] {
  const questions: ProgramDesignQuestion[] = [];
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
  if (!input.weeklyFrequency) {
    questions.push({
      id: 'weeklyFrequency',
      prompt: 'How many training days per week are realistically available?',
      input: 'number',
      required: true,
      min: 1,
      max: 7,
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
  if (!input.limitations) {
    questions.push({
      id: 'limitations',
      prompt:
        'Are there current pains, movements to avoid, or other constraints? Enter "none" when there are none.',
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

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return Math.round(
    sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!,
  );
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
