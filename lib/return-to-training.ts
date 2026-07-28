import type { Exercise, ProgramExercise, Set } from '@/lib/prisma-client';
import { gymWeightOptions, type GymLoadConstraints } from '@/lib/gym-loads';
import { weightIncrement } from '@/lib/progression';

// Source-backed principles from the project training-science notebook:
// - exercise skill and muscle readiness are separate qualities;
// - a forgotten movement should return with 1-2 working sets, RIR 3-4 and no failure;
// - related exercises can confirm that a muscle remained trained, but cannot
//   provide a reliable load conversion for a different movement.
//
// The exact time windows, volume ratio, Epley estimate and load fractions below
// are deterministic product heuristics. They are intentionally named so they
// are easy to revisit when the exercise model gains secondary-muscle and
// movement-pattern metadata.
export const RETURN_EXERCISE_GAP_DAYS = 42;
export const MAINTAINED_MUSCLE_RECENCY_DAYS = 14;
export const RECENT_MUSCLE_VOLUME_DAYS = 28;
export const BASELINE_MUSCLE_VOLUME_DAYS = 56;
export const MAINTAINED_MUSCLE_VOLUME_RATIO = 0.7;
export const MAINTAINED_EXERCISE_START_FRACTION = 0.85;
export const MODERATE_GAP_START_FRACTION = 0.8;
export const BROAD_RETURN_START_FRACTION = 0.75;
export const BROAD_RETURN_MODERATE_GAP_START_FRACTION = 0.7;
export const BROAD_RETURN_EXTENDED_GAP_START_FRACTION = 0.65;
export const RETURN_RECENT_EXACT_SESSION_DAYS = 14;
export const RETURN_MODERATE_GAP_DAYS = 84;
export const RETURN_EXTENDED_GAP_DAYS = 168;
export const RETURN_LONG_TERM_ANCHOR_SESSION_LIMIT = 8;
export const RETURN_ROBUST_ANCHOR_MIN_SESSIONS = 3;
export const RETURN_ESTABLISHED_ANCHOR_BLOCK_SESSIONS = 3;
export const RETURN_ESTABLISHED_HISTORY_FLOOR_RATIO = 0.85;
export const RETURN_RECENT_CAPACITY_WEIGHT = 0.75;
export const RETURN_LONG_TERM_CAPACITY_WEIGHT = 0.25;
export const RETURN_RECENT_ANCHOR_MIN_RATIO = 0.75;
export const RETURN_RECENT_ANCHOR_MAX_RATIO = 1.25;
export const EQUIPMENT_CALIBRATION_WORKING_SETS = 2;

export type ReturnMode = 'normal' | 'exercise-reintro' | 'muscle-reintro' | 'new-exercise';
export type ReturnConfidence = 'low' | 'medium' | 'high';
export type ReturnHistoryBasis =
  | 'none'
  | 'recent-exact'
  | 'long-term-exact'
  | 'recent-and-long-term';
export type CalibrationKind = 'none' | 'return' | 'equipment';
export type StrengthAnchorScope = 'none' | 'exact-equipment' | 'exact-exercise-unlinked';

export interface StrengthEvidenceSummary {
  sessionCount: number;
  workingSetCount: number;
  calibrationSetCount?: number;
  lastPerformedAt: string | null;
  lastReliableLoad: number | null;
  recentStrengthAnchor: number | null;
  historicalStrengthAnchor: number | null;
  confidence: ReturnConfidence;
}

export interface LongTermStrengthSummary {
  movement: StrengthEvidenceSummary;
  equipment: StrengthEvidenceSummary;
  anchorScope: StrengthAnchorScope;
}

export interface ReturnHistorySession {
  sessionId: string;
  performedAt: Date;
  sets: Pick<Set, 'weight' | 'reps' | 'rir' | 'isDropSet'>[];
}

export interface ReturnTrainingHistory {
  exerciseLastPerformedAt: Date | null;
  generalExerciseLastPerformedAt?: Date | null;
  muscleLastPerformedAt: Date | null;
  recentMuscleSets: number;
  baselineMuscleSetsPer28Days: number;
  exerciseSessions: ReturnHistorySession[];
  generalExerciseSessions?: ReturnHistorySession[];
  unlinkedExerciseSessions?: ReturnHistorySession[];
  hasConcreteEquipmentTarget?: boolean;
  nonComparableExerciseSessions?: number;
}

export interface ReturnRecommendation {
  mode: ReturnMode;
  exerciseGapDays: number | null;
  returnGapDays: number | null;
  muscleGapDays: number | null;
  muscleMaintained: boolean;
  recentMuscleSets: number;
  baselineMuscleSetsPer28Days: number;
  recentVolumeRatio: number | null;
  targetSets: number;
  targetRIR: number;
  weightCeiling: number | null;
  suggestedWeight: number | null;
  startFraction: number | null;
  calibrationRequired: boolean;
  historySessionCount: number;
  recentHistorySessionCount: number;
  longTermHistorySessionCount: number;
  nonComparableHistorySessionCount: number;
  historyBasis: ReturnHistoryBasis;
  confidence: ReturnConfidence;
  calibrationKind: CalibrationKind;
  strengthSummary: LongTermStrengthSummary;
}

export type ReturnProgramExercise = Pick<
  ProgramExercise,
  'exerciseId' | 'targetSets' | 'targetRepsMin' | 'targetRIR'
> & {
  exercise: Pick<Exercise, 'category' | 'equipmentType' | 'usesBodyweight'>;
};

interface CalculateReturnRecommendationInput {
  programExercise: ReturnProgramExercise;
  history: ReturnTrainingHistory;
  now: Date;
  bodyweight?: number | null;
  loadConstraints?: GymLoadConstraints | null;
  safetyWeightCeiling?: number | null;
}

interface EquipmentCalibrationProgressInput {
  programExercise: Pick<ProgramExercise, 'targetSets' | 'targetRIR'>;
  recommendation: ReturnRecommendation | null | undefined;
  completedSets: Array<{
    gymEquipmentId?: string | null;
    weight: number;
    reps: number;
    rir?: number | null;
    isWarmup: boolean;
    isDropSet: boolean;
    deleted?: boolean;
  }>;
  gymEquipmentId: string | null;
}

export function resolveEquipmentCalibrationProgress({
  programExercise,
  recommendation,
  completedSets,
  gymEquipmentId,
}: EquipmentCalibrationProgressInput): ReturnRecommendation | undefined {
  if (
    !recommendation ||
    recommendation.calibrationKind !== 'equipment' ||
    !recommendation.calibrationRequired ||
    gymEquipmentId == null
  ) {
    return recommendation ?? undefined;
  }
  const currentValidSets = completedSets.filter(
    (set) =>
      set.gymEquipmentId === gymEquipmentId &&
      set.deleted !== true &&
      !set.isWarmup &&
      !set.isDropSet &&
      set.reps > 0 &&
      set.weight >= 0 &&
      set.rir != null,
  ).length;
  const confirmedSets =
    (recommendation.strengthSummary.equipment.calibrationSetCount ?? 0) + currentValidSets;
  if (confirmedSets < EQUIPMENT_CALIBRATION_WORKING_SETS) {
    return {
      ...recommendation,
      strengthSummary: {
        ...recommendation.strengthSummary,
        equipment: {
          ...recommendation.strengthSummary.equipment,
          calibrationSetCount: confirmedSets,
          confidence: confirmedSets === 1 ? 'medium' : 'low',
        },
      },
    };
  }
  return {
    ...recommendation,
    mode: 'normal',
    targetSets: programExercise.targetSets,
    targetRIR: programExercise.targetRIR,
    suggestedWeight: null,
    weightCeiling: null,
    startFraction: null,
    calibrationRequired: false,
    calibrationKind: 'none',
  };
}

export function calculateReturnRecommendation({
  programExercise,
  history,
  now,
  bodyweight = null,
  loadConstraints = null,
  safetyWeightCeiling = null,
}: CalculateReturnRecommendationInput): ReturnRecommendation {
  const generalExerciseSessions = history.generalExerciseSessions ?? history.exerciseSessions;
  const generalExerciseLastPerformedAt =
    history.generalExerciseLastPerformedAt === undefined
      ? history.exerciseLastPerformedAt
      : history.generalExerciseLastPerformedAt;
  const exerciseGapDays = daysSince(generalExerciseLastPerformedAt, now);
  const returnGapDays = resolveReturnGapDays(exerciseGapDays, generalExerciseSessions, now);
  const muscleGapDays = daysSince(history.muscleLastPerformedAt, now);
  const recentVolumeRatio = volumeRatio(
    history.recentMuscleSets,
    history.baselineMuscleSetsPer28Days,
  );
  const muscleMaintained =
    muscleGapDays != null &&
    muscleGapDays <= MAINTAINED_MUSCLE_RECENCY_DAYS &&
    history.recentMuscleSets > 0 &&
    (history.baselineMuscleSetsPer28Days <= 0 ||
      (recentVolumeRatio != null && recentVolumeRatio >= MAINTAINED_MUSCLE_VOLUME_RATIO));

  const exactEquipmentEvidence = historicalCapacityEvidence({
    programExercise,
    sessions: history.exerciseSessions,
    now,
    returnGapDays,
    bodyweight,
    nonComparableHistorySessionCount: history.nonComparableExerciseSessions ?? 0,
  });
  const unlinkedExerciseEvidence = historicalCapacityEvidence({
    programExercise,
    sessions: history.unlinkedExerciseSessions ?? [],
    now,
    returnGapDays,
    bodyweight,
    nonComparableHistorySessionCount: 0,
  });
  const exactEquipmentCalibrationSetCount = countCalibrationSets(history.exerciseSessions);
  const equipmentCalibrationRequired =
    history.hasConcreteEquipmentTarget === true &&
    exactEquipmentCalibrationSetCount < EQUIPMENT_CALIBRATION_WORKING_SETS;
  const strengthSummary = buildLongTermStrengthSummary({
    generalExerciseSessions,
    exactEquipmentSessions: history.exerciseSessions,
    unlinkedExerciseEvidence,
    exactEquipmentEvidence,
  });
  const strengthSummaryWithAnchorScope: LongTermStrengthSummary = {
    ...strengthSummary,
    anchorScope:
      exactEquipmentEvidence.capacity != null
        ? 'exact-equipment'
        : unlinkedExerciseEvidence.capacity != null
          ? 'exact-exercise-unlinked'
          : 'none',
  };
  const mode = resolveReturnMode(programExercise.exercise.category, returnGapDays, muscleGapDays);
  const calibrationKind: CalibrationKind =
    mode !== 'normal' ? 'return' : equipmentCalibrationRequired ? 'equipment' : 'none';
  if (calibrationKind === 'none') {
    return {
      mode,
      exerciseGapDays,
      returnGapDays,
      muscleGapDays,
      muscleMaintained,
      recentMuscleSets: history.recentMuscleSets,
      baselineMuscleSetsPer28Days: round(history.baselineMuscleSetsPer28Days),
      recentVolumeRatio,
      targetSets: programExercise.targetSets,
      targetRIR: programExercise.targetRIR,
      weightCeiling: null,
      suggestedWeight: null,
      startFraction: null,
      calibrationRequired: false,
      calibrationKind,
      strengthSummary: strengthSummaryWithAnchorScope,
      ...exactEquipmentEvidence.summary,
    };
  }

  const broadReturn = mode !== 'normal' && (mode === 'muscle-reintro' || !muscleMaintained);
  const calibrationSetTarget =
    calibrationKind === 'equipment'
      ? Math.max(1, EQUIPMENT_CALIBRATION_WORKING_SETS - exactEquipmentCalibrationSetCount)
      : broadReturn
        ? 1
        : 2;
  const targetSets = Math.min(programExercise.targetSets, calibrationSetTarget);
  const targetRIR = Math.max(programExercise.targetRIR, broadReturn ? 4 : 3);
  const startFraction = returnStartFraction(returnGapDays, broadReturn);
  const loadEvidence =
    exactEquipmentEvidence.capacity != null ? exactEquipmentEvidence : unlinkedExerciseEvidence;
  const loadTargets = historicalLoadTargets({
    programExercise,
    evidence: loadEvidence,
    targetRIR,
    startFraction,
    bodyweight,
    loadConstraints,
    safetyWeightCeiling,
  });

  const suggestedWeight =
    loadTargets.suggestedWeight ??
    fallbackCalibrationLoad(programExercise.exercise.usesBodyweight, loadConstraints);

  return {
    mode,
    exerciseGapDays,
    returnGapDays,
    muscleGapDays,
    muscleMaintained,
    recentMuscleSets: history.recentMuscleSets,
    baselineMuscleSetsPer28Days: round(history.baselineMuscleSetsPer28Days),
    recentVolumeRatio,
    targetSets,
    targetRIR,
    weightCeiling: loadTargets.weightCeiling,
    suggestedWeight,
    startFraction,
    calibrationRequired: true,
    calibrationKind,
    strengthSummary: strengthSummaryWithAnchorScope,
    ...exactEquipmentEvidence.summary,
  };
}

function resolveReturnMode(
  category: Exercise['category'],
  exerciseGapDays: number | null,
  muscleGapDays: number | null,
): ReturnMode {
  if (category === 'CARDIO') return 'normal';
  // No history is not evidence of a break. Preserve the authored program for
  // a first-ever session instead of silently treating a new user as detrained.
  if (exerciseGapDays == null && muscleGapDays == null) return 'normal';
  if (muscleGapDays == null || muscleGapDays > RETURN_EXERCISE_GAP_DAYS) {
    return 'muscle-reintro';
  }
  if (exerciseGapDays == null) return 'new-exercise';
  if (exerciseGapDays > RETURN_EXERCISE_GAP_DAYS) return 'exercise-reintro';
  return 'normal';
}

function historicalLoadTargets({
  programExercise,
  evidence,
  targetRIR,
  startFraction,
  bodyweight,
  loadConstraints,
  safetyWeightCeiling,
}: {
  programExercise: ReturnProgramExercise;
  evidence: HistoricalCapacityEvidence;
  targetRIR: number;
  startFraction: number;
  bodyweight: number | null;
  loadConstraints: GymLoadConstraints | null;
  safetyWeightCeiling: number | null;
}): { weightCeiling: number | null; suggestedWeight: number | null } {
  if (loadConstraints?.isAvailable === false) {
    return { weightCeiling: null, suggestedWeight: null };
  }

  if (evidence.capacity == null) {
    return { weightCeiling: null, suggestedWeight: null };
  }

  const targetCapacityReps = programExercise.targetRepsMin + targetRIR;
  const effectiveWeightCeiling = evidence.capacity / (1 + targetCapacityReps / 30);
  const effectiveSuggestedWeight = effectiveWeightCeiling * startFraction;
  const externalWeightCeiling = externalLoad(
    effectiveWeightCeiling,
    programExercise.exercise.usesBodyweight,
    bodyweight,
  );
  const externalSuggestedWeight = externalLoad(
    effectiveSuggestedWeight,
    programExercise.exercise.usesBodyweight,
    bodyweight,
  );
  const weightCeiling = roundLoadDown(
    externalWeightCeiling,
    programExercise.exercise.category,
    loadConstraints,
  );
  const equipmentFloor = fallbackCalibrationLoad(
    programExercise.exercise.usesBodyweight,
    loadConstraints,
  );
  const achievableWeightCeiling =
    !programExercise.exercise.usesBodyweight && weightCeiling <= 0 && equipmentFloor != null
      ? equipmentFloor
      : weightCeiling;
  const roundedSuggestedWeight = Math.min(
    achievableWeightCeiling,
    roundLoadDown(externalSuggestedWeight, programExercise.exercise.category, loadConstraints),
  );
  const suggestedWeight =
    !programExercise.exercise.usesBodyweight &&
    roundedSuggestedWeight <= 0 &&
    equipmentFloor != null
      ? Math.min(achievableWeightCeiling, equipmentFloor)
      : roundedSuggestedWeight;

  if (safetyWeightCeiling != null && safetyWeightCeiling >= 0) {
    const safeCeiling = roundLoadDown(
      safetyWeightCeiling,
      programExercise.exercise.category,
      loadConstraints,
    );
    return {
      weightCeiling: Math.min(achievableWeightCeiling, safeCeiling),
      suggestedWeight: Math.min(suggestedWeight, safeCeiling),
    };
  }
  return { weightCeiling: achievableWeightCeiling, suggestedWeight };
}

interface SessionCapacityEvidence {
  performedAt: Date;
  capacity: number;
  hasRecordedRIR: boolean;
}

interface HistoricalCapacityEvidence {
  capacity: number | null;
  recentAnchor: number | null;
  longTermAnchor: number | null;
  lastReliableLoad: number | null;
  lastPerformedAt: Date | null;
  workingSetCount: number;
  summary: Pick<
    ReturnRecommendation,
    | 'historySessionCount'
    | 'recentHistorySessionCount'
    | 'longTermHistorySessionCount'
    | 'nonComparableHistorySessionCount'
    | 'historyBasis'
    | 'confidence'
  >;
}

function historicalCapacityEvidence({
  programExercise,
  sessions,
  now,
  returnGapDays,
  bodyweight,
  nonComparableHistorySessionCount,
}: {
  programExercise: ReturnProgramExercise;
  sessions: ReturnHistorySession[];
  now: Date;
  returnGapDays: number | null;
  bodyweight: number | null;
  nonComparableHistorySessionCount: number;
}): HistoricalCapacityEvidence {
  const estimates = sessions
    .map((session) => {
      const capacity = bestSessionCapacity(
        session,
        programExercise.exercise.usesBodyweight,
        bodyweight,
      );
      if (capacity == null) return null;
      return {
        performedAt: session.performedAt,
        capacity,
        hasRecordedRIR: session.sets
          .filter((set) => !set.isDropSet && set.reps > 0 && set.weight >= 0)
          .every((set) => set.rir != null),
      } satisfies SessionCapacityEvidence;
    })
    .filter((value): value is SessionCapacityEvidence => value != null)
    .sort((left, right) => right.performedAt.getTime() - left.performedAt.getTime());
  const recent = estimates.filter(
    (item) => daysSince(item.performedAt, now)! <= RETURN_RECENT_EXACT_SESSION_DAYS,
  );
  const longTerm = estimates.filter(
    (item) => daysSince(item.performedAt, now)! > RETURN_RECENT_EXACT_SESSION_DAYS,
  );
  const anchorPool = (longTerm.length > 0 ? longTerm : estimates).slice(
    0,
    RETURN_LONG_TERM_ANCHOR_SESSION_LIMIT,
  );
  const recentBiasedLongTermAnchor =
    anchorPool.length > 0 ? median(anchorPool.map((item) => item.capacity)) : null;
  const establishedAnchor = strongestEstablishedAnchor(longTerm);
  const longTermAnchor =
    recentBiasedLongTermAnchor != null && establishedAnchor != null
      ? Math.max(
          recentBiasedLongTermAnchor,
          establishedAnchor * RETURN_ESTABLISHED_HISTORY_FLOOR_RATIO,
        )
      : (recentBiasedLongTermAnchor ?? establishedAnchor);
  const recentAnchor = recent.length > 0 ? median(recent.map((item) => item.capacity)) : null;
  const hasRobustLongTermAnchor = longTerm.length >= RETURN_ROBUST_ANCHOR_MIN_SESSIONS;
  const boundedRecentAnchor =
    recentAnchor != null && longTermAnchor != null && hasRobustLongTermAnchor
      ? clamp(
          recentAnchor,
          longTermAnchor * RETURN_RECENT_ANCHOR_MIN_RATIO,
          longTermAnchor * RETURN_RECENT_ANCHOR_MAX_RATIO,
        )
      : recentAnchor;
  const sparseLongTermHistory =
    longTerm.length > 0 && longTerm.length < RETURN_ROBUST_ANCHOR_MIN_SESSIONS;
  const sparseLongTermSupportsRecent =
    recentAnchor != null &&
    sparseLongTermHistory &&
    longTerm.every(
      (item) =>
        item.capacity >= recentAnchor * RETURN_RECENT_ANCHOR_MIN_RATIO &&
        item.capacity <= recentAnchor * RETURN_RECENT_ANCHOR_MAX_RATIO,
    );
  // One or two older observations cannot identify whether the old or recent
  // value is the outlier. They never enter the numerical blend. When the
  // recent sample is also sparse, a conflict deliberately falls back to an
  // equipment-floor calibration instead of inventing a precise anchor.
  const sparseHistoryRequiresCalibration =
    sparseLongTermHistory &&
    recentAnchor != null &&
    recent.length < RETURN_ROBUST_ANCHOR_MIN_SESSIONS &&
    !sparseLongTermSupportsRecent;
  const capacity = sparseHistoryRequiresCalibration
    ? null
    : boundedRecentAnchor != null && longTermAnchor != null && hasRobustLongTermAnchor
      ? boundedRecentAnchor * RETURN_RECENT_CAPACITY_WEIGHT +
        longTermAnchor * RETURN_LONG_TERM_CAPACITY_WEIGHT
      : (boundedRecentAnchor ?? longTermAnchor);
  const historyBasis: ReturnHistoryBasis =
    recent.length > 0 && longTerm.length > 0
      ? 'recent-and-long-term'
      : recent.length > 0
        ? 'recent-exact'
        : longTerm.length > 0
          ? 'long-term-exact'
          : 'none';
  let confidence: ReturnConfidence =
    recent.length >= 2 && longTerm.length >= RETURN_ROBUST_ANCHOR_MIN_SESSIONS
      ? 'high'
      : recent.length >= 1 || longTerm.length >= RETURN_ROBUST_ANCHOR_MIN_SESSIONS
        ? 'medium'
        : 'low';
  if (sparseHistoryRequiresCalibration) confidence = 'low';
  const rirComplete = estimates.length > 0 && estimates.every((item) => item.hasRecordedRIR);
  if (!rirComplete || nonComparableHistorySessionCount > 0) {
    confidence = confidence === 'high' ? 'medium' : 'low';
  }
  const gapPenalty =
    returnGapDays != null && returnGapDays >= RETURN_EXTENDED_GAP_DAYS
      ? 2
      : returnGapDays != null && returnGapDays >= RETURN_MODERATE_GAP_DAYS
        ? 1
        : 0;
  confidence = lowerConfidence(confidence, gapPenalty);

  return {
    capacity,
    recentAnchor,
    longTermAnchor,
    lastReliableLoad: latestReliableLoad(sessions),
    lastPerformedAt: estimates[0]?.performedAt ?? null,
    workingSetCount: countWorkingSets(sessions),
    summary: {
      historySessionCount: estimates.length,
      recentHistorySessionCount: recent.length,
      longTermHistorySessionCount: longTerm.length,
      nonComparableHistorySessionCount,
      historyBasis,
      confidence,
    },
  };
}

function buildLongTermStrengthSummary({
  generalExerciseSessions,
  exactEquipmentSessions,
  unlinkedExerciseEvidence,
  exactEquipmentEvidence,
}: {
  generalExerciseSessions: ReturnHistorySession[];
  exactEquipmentSessions: ReturnHistorySession[];
  unlinkedExerciseEvidence: HistoricalCapacityEvidence;
  exactEquipmentEvidence: HistoricalCapacityEvidence;
}): LongTermStrengthSummary {
  const movementSessionCount = countUsableSessions(generalExerciseSessions);
  const movementWorkingSetCount = countWorkingSets(generalExerciseSessions);
  const movementLastPerformedAt = latestPerformedAt(generalExerciseSessions);
  return {
    movement: {
      sessionCount: movementSessionCount,
      workingSetCount: movementWorkingSetCount,
      calibrationSetCount: countCalibrationSets(generalExerciseSessions),
      lastPerformedAt:
        (unlinkedExerciseEvidence.lastPerformedAt ?? movementLastPerformedAt)?.toISOString() ??
        null,
      lastReliableLoad: unlinkedExerciseEvidence.lastReliableLoad,
      recentStrengthAnchor: roundNullable(unlinkedExerciseEvidence.recentAnchor),
      historicalStrengthAnchor: roundNullable(unlinkedExerciseEvidence.longTermAnchor),
      confidence: confidenceFromMovementSessions(movementSessionCount),
    },
    equipment: {
      sessionCount: countUsableSessions(exactEquipmentSessions),
      workingSetCount: exactEquipmentEvidence.workingSetCount,
      calibrationSetCount: countCalibrationSets(exactEquipmentSessions),
      lastPerformedAt: exactEquipmentEvidence.lastPerformedAt?.toISOString() ?? null,
      lastReliableLoad: exactEquipmentEvidence.lastReliableLoad,
      recentStrengthAnchor: roundNullable(exactEquipmentEvidence.recentAnchor),
      historicalStrengthAnchor: roundNullable(exactEquipmentEvidence.longTermAnchor),
      confidence: confidenceFromEquipmentSets(countCalibrationSets(exactEquipmentSessions)),
    },
    anchorScope: 'none',
  };
}

function confidenceFromMovementSessions(sessionCount: number): ReturnConfidence {
  if (sessionCount >= RETURN_ROBUST_ANCHOR_MIN_SESSIONS) return 'high';
  return sessionCount > 0 ? 'medium' : 'low';
}

function confidenceFromEquipmentSets(workingSetCount: number): ReturnConfidence {
  if (workingSetCount >= EQUIPMENT_CALIBRATION_WORKING_SETS) return 'high';
  return workingSetCount === 1 ? 'medium' : 'low';
}

function countUsableSessions(sessions: ReturnHistorySession[]): number {
  return sessions.filter(hasUsableWorkingSet).length;
}

function countWorkingSets(sessions: ReturnHistorySession[]): number {
  return sessions.reduce(
    (total, session) =>
      total +
      session.sets.filter((set) => !set.isDropSet && set.reps > 0 && set.weight >= 0).length,
    0,
  );
}

function countCalibrationSets(sessions: ReturnHistorySession[]): number {
  return sessions.reduce(
    (total, session) =>
      total +
      session.sets.filter(
        (set) => !set.isDropSet && set.reps > 0 && set.weight >= 0 && set.rir != null,
      ).length,
    0,
  );
}

function latestPerformedAt(sessions: ReturnHistorySession[]): Date | null {
  return sessions
    .filter(hasUsableWorkingSet)
    .reduce<Date | null>(
      (latest, session) =>
        latest == null || session.performedAt > latest ? session.performedAt : latest,
      null,
    );
}

function latestReliableLoad(sessions: ReturnHistorySession[]): number | null {
  const latest = [...sessions]
    .filter(hasUsableWorkingSet)
    .sort((left, right) => right.performedAt.getTime() - left.performedAt.getTime())[0];
  if (!latest) return null;
  const weights = latest.sets
    .filter((set) => !set.isDropSet && set.reps > 0 && set.weight >= 0)
    .map((set) => set.weight);
  return weights.length > 0 ? Math.max(...weights) : null;
}

function roundNullable(value: number | null): number | null {
  return value == null ? null : round(value);
}

function strongestEstablishedAnchor(estimates: SessionCapacityEvidence[]): number | null {
  if (estimates.length < RETURN_ESTABLISHED_ANCHOR_BLOCK_SESSIONS) return null;
  const blockMedians: number[] = [];
  for (
    let index = 0;
    index <= estimates.length - RETURN_ESTABLISHED_ANCHOR_BLOCK_SESSIONS;
    index += 1
  ) {
    blockMedians.push(
      median(
        estimates
          .slice(index, index + RETURN_ESTABLISHED_ANCHOR_BLOCK_SESSIONS)
          .map((item) => item.capacity),
      ),
    );
  }
  return Math.max(...blockMedians);
}

function lowerConfidence(confidence: ReturnConfidence, levels: number): ReturnConfidence {
  const values: ReturnConfidence[] = ['low', 'medium', 'high'];
  const index = values.indexOf(confidence);
  return values[Math.max(0, index - levels)]!;
}

function resolveReturnGapDays(
  exerciseGapDays: number | null,
  sessions: ReturnHistorySession[],
  now: Date,
): number | null {
  if (exerciseGapDays == null || exerciseGapDays > RETURN_EXERCISE_GAP_DAYS) {
    return exerciseGapDays;
  }
  const validSessions = sessions
    .filter(hasUsableWorkingSet)
    .sort((left, right) => right.performedAt.getTime() - left.performedAt.getTime());
  const latest = validSessions[0];
  const previous = validSessions[1];
  if (
    !latest ||
    !previous ||
    daysSince(latest.performedAt, now)! > RETURN_RECENT_EXACT_SESSION_DAYS
  ) {
    return exerciseGapDays;
  }
  const priorGapDays = Math.max(
    0,
    Math.floor((latest.performedAt.getTime() - previous.performedAt.getTime()) / 86_400_000),
  );
  return priorGapDays > RETURN_EXERCISE_GAP_DAYS ? priorGapDays : exerciseGapDays;
}

function hasUsableWorkingSet(session: ReturnHistorySession): boolean {
  return session.sets.some((set) => !set.isDropSet && set.reps > 0 && set.weight >= 0);
}

function returnStartFraction(returnGapDays: number | null, broadReturn: boolean): number {
  if (broadReturn) {
    return returnGapDays != null && returnGapDays >= RETURN_EXTENDED_GAP_DAYS
      ? BROAD_RETURN_EXTENDED_GAP_START_FRACTION
      : returnGapDays != null && returnGapDays >= RETURN_MODERATE_GAP_DAYS
        ? BROAD_RETURN_MODERATE_GAP_START_FRACTION
        : BROAD_RETURN_START_FRACTION;
  }
  const gapFraction =
    returnGapDays != null && returnGapDays >= RETURN_EXTENDED_GAP_DAYS
      ? BROAD_RETURN_START_FRACTION
      : returnGapDays != null && returnGapDays >= RETURN_MODERATE_GAP_DAYS
        ? MODERATE_GAP_START_FRACTION
        : MAINTAINED_EXERCISE_START_FRACTION;
  return gapFraction;
}

function bestSessionCapacity(
  session: ReturnHistorySession,
  usesBodyweight: boolean,
  bodyweight: number | null,
): number | null {
  const estimates = session.sets
    .filter((set) => !set.isDropSet && set.reps > 0 && set.weight >= 0)
    .map((set) => {
      const effectiveLoad =
        usesBodyweight && bodyweight != null && bodyweight > 0
          ? bodyweight + set.weight
          : set.weight;
      if (effectiveLoad <= 0) return null;
      const rir = clamp(set.rir ?? 0, 0, 5);
      const repsAtFailure = clamp(set.reps + rir, 1, 30);
      return effectiveLoad * (1 + repsAtFailure / 30);
    })
    .filter((value): value is number => value != null);
  return estimates.length > 0 ? Math.max(...estimates) : null;
}

function externalLoad(
  effectiveLoad: number,
  usesBodyweight: boolean,
  bodyweight: number | null,
): number {
  if (!usesBodyweight || bodyweight == null || bodyweight <= 0) return Math.max(0, effectiveLoad);
  return Math.max(0, effectiveLoad - bodyweight);
}

function roundLoadDown(
  targetWeight: number,
  category: Exercise['category'],
  loadConstraints: GymLoadConstraints | null,
): number {
  if (!(targetWeight > 0)) return 0;

  const options = gymWeightOptions(loadConstraints, targetWeight);
  if (options.length > 0) {
    const available = options.filter((weight) => weight <= targetWeight + Number.EPSILON);
    return available.at(-1) ?? 0;
  }

  const step = weightIncrement(category);
  return round(Math.floor(targetWeight / step) * step);
}

function fallbackCalibrationLoad(
  usesBodyweight: boolean,
  loadConstraints: GymLoadConstraints | null,
): number | null {
  if (usesBodyweight) return 0;
  if (loadConstraints?.isAvailable === false) return null;
  const options = gymWeightOptions(loadConstraints, 0);
  return options[0] ?? null;
}

function daysSince(value: Date | null, now: Date): number | null {
  if (!value) return null;
  return Math.max(0, Math.floor((now.getTime() - value.getTime()) / 86_400_000));
}

function volumeRatio(recent: number, baseline: number): number | null {
  if (baseline <= 0) return recent > 0 ? 1 : null;
  return round(recent / baseline);
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
