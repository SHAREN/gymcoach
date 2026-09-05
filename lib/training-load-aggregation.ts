import { MuscleGroup } from '@/lib/prisma-client';
import {
  EXERCISE_LOAD_ALGORITHM_VERSION,
  normalizeExerciseLoadProfile,
  type ExerciseLoadConfidence,
  type ExerciseLoadProfile,
} from '@/lib/schemas/exercise-load-profile';

export const TRAINING_LOAD_AGGREGATION_VERSION = 1 as const;
export const EQUIVALENT_SETS_HEURISTIC_VERSION = '2026-07-18-equivalent-sets-v1' as const;

export const DEFAULT_EQUIVALENT_SET_COEFFICIENTS = {
  primary: 1,
  secondary: 0.5,
} as const;

export type HistoryReliability = 'RELIABLE' | 'UNRELIABLE' | 'UNKNOWN';
export type ModifierStatus = 'KNOWN' | 'UNRELIABLE' | 'UNKNOWN';

export interface TrainingLoadModifier {
  status: ModifierStatus;
  value?: number | null;
  provenance?: string | null;
  confidence?: ExerciseLoadConfidence;
}

export interface TrainingLoadSetInput {
  setId: string;
  exerciseId: string;
  legacyMuscleGroup: MuscleGroup;
  loadProfile: unknown;
  isWarmup: boolean;
  isDropSet: boolean;
  rir: number | null;
  historyReliability?: HistoryReliability;
  effortCoefficient?: TrainingLoadModifier;
  rangeOfMotionCoefficient?: TrainingLoadModifier;
}

export interface SetCountBreakdown {
  total: number;
  regular: number;
  drop: number;
  setsWithRir: number;
  setsWithoutRir: number;
  setsAtRir0To4: number;
  reliableHistory: number;
  unreliableHistory: number;
  unknownHistoryReliability: number;
}

export interface MuscleTrainingLoad {
  directSets: number;
  indirectSets: number;
  directSetBreakdown: SetCountBreakdown;
  indirectSetBreakdown: SetCountBreakdown;
  equivalentSets: number;
  confidence: ExerciseLoadConfidence;
}

export interface TrainingLoadAggregation {
  version: typeof TRAINING_LOAD_AGGREGATION_VERSION;
  algorithmVersion: typeof EXERCISE_LOAD_ALGORITHM_VERSION;
  confidence: ExerciseLoadConfidence;
  qualifyingSetCount: number;
  deduplicatedSetCount: number;
  unclassifiedSetCount: number;
  unknownSecondaryParticipationSetCount: number;
  muscles: Record<string, MuscleTrainingLoad>;
  movementPatterns: Record<string, number>;
  fatigueTags: Record<string, number>;
  jointStress: Record<string, number>;
  equivalentSetsHeuristic: {
    version: typeof EQUIVALENT_SETS_HEURISTIC_VERSION;
    classification: 'ENGINEERING_HEURISTIC';
    coefficients: { primary: number; secondary: number };
    provenance: 'OWNER_REQUESTED_INITIAL_HEURISTIC';
    confidence: 'LOW';
    appliesToUnknownParticipation: false;
    effortCoefficient: ModifierCoverage;
    rangeOfMotionCoefficient: ModifierCoverage;
  };
}

interface ModifierCoverage {
  appliedSetCount: number;
  unknownSetCount: number;
  unreliableSetCount: number;
  interpretation: string;
}

interface AggregateOptions {
  primaryCoefficient?: number;
  secondaryCoefficient?: number;
}

interface ResolvedModifier {
  value: number;
  confidence: ExerciseLoadConfidence;
}

type ContributionRole = 'direct' | 'indirect';

const confidenceRank: Record<ExerciseLoadConfidence, number> = {
  UNKNOWN: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
};

export function aggregateTrainingLoad(
  inputs: TrainingLoadSetInput[],
  options: AggregateOptions = {},
): TrainingLoadAggregation {
  const coefficients = {
    primary: options.primaryCoefficient ?? DEFAULT_EQUIVALENT_SET_COEFFICIENTS.primary,
    secondary: options.secondaryCoefficient ?? DEFAULT_EQUIVALENT_SET_COEFFICIENTS.secondary,
  };
  if (
    !Number.isFinite(coefficients.primary) ||
    !Number.isFinite(coefficients.secondary) ||
    coefficients.primary < 0 ||
    coefficients.primary > 2 ||
    coefficients.secondary < 0 ||
    coefficients.secondary > 2
  ) {
    throw new Error('Equivalent-set coefficients must be finite values between 0 and 2.');
  }

  const uniqueInputs = new Map<string, TrainingLoadSetInput>();
  let deduplicatedSetCount = 0;
  for (const input of inputs) {
    if (uniqueInputs.has(input.setId)) {
      deduplicatedSetCount += 1;
      continue;
    }
    uniqueInputs.set(input.setId, input);
  }

  const muscles: Record<string, MuscleTrainingLoad> = {};
  const movementPatterns: Record<string, number> = {};
  const fatigueTags: Record<string, number> = {};
  const jointStress: Record<string, number> = {};
  const modifierCoverage = {
    effortCoefficient: emptyModifierCoverage(
      'No effort coefficient is derived from RIR. Missing or unreliable effort data remains neutral and lowers confidence.',
    ),
    rangeOfMotionCoefficient: emptyModifierCoverage(
      'No range-of-motion coefficient is inferred. Missing or unreliable ROM remains neutral and lowers confidence.',
    ),
  };
  let qualifyingSetCount = 0;
  let unclassifiedSetCount = 0;
  let unknownSecondaryParticipationSetCount = 0;
  let aggregateConfidence: ExerciseLoadConfidence = 'HIGH';

  for (const input of uniqueInputs.values()) {
    if (input.isWarmup) continue;
    qualifyingSetCount += 1;
    const profile = normalizeExerciseLoadProfile(input.loadProfile, input.legacyMuscleGroup);
    aggregateConfidence = lowerConfidence(aggregateConfidence, profile.confidence);
    if (profile.classification === 'UNCLASSIFIED') unclassifiedSetCount += 1;
    if (profile.secondaryMuscles.state === 'UNKNOWN') {
      unknownSecondaryParticipationSetCount += 1;
    }

    const effort = resolveModifier(input.effortCoefficient, modifierCoverage.effortCoefficient);
    const rangeOfMotion = resolveModifier(
      input.rangeOfMotionCoefficient,
      modifierCoverage.rangeOfMotionCoefficient,
    );
    const modifier = effort.value * rangeOfMotion.value;
    aggregateConfidence = lowerConfidence(aggregateConfidence, effort.confidence);
    aggregateConfidence = lowerConfidence(aggregateConfidence, rangeOfMotion.confidence);

    for (const entry of profile.primaryMuscles.entries) {
      addMuscleContribution(
        muscles,
        entry.muscleGroup,
        'direct',
        input,
        coefficients.primary * modifier,
        entry.confidence,
      );
    }
    if (profile.secondaryMuscles.state === 'KNOWN') {
      for (const entry of profile.secondaryMuscles.entries) {
        addMuscleContribution(
          muscles,
          entry.muscleGroup,
          'indirect',
          input,
          coefficients.secondary * modifier,
          entry.confidence,
        );
      }
    }

    addTagCounts(movementPatterns, profile.movementPatterns, input);
    addTagCounts(fatigueTags, profile.fatigueTags, input);
    addTagCounts(jointStress, profile.jointStress, input);
  }

  if (qualifyingSetCount === 0) aggregateConfidence = 'UNKNOWN';

  return {
    version: TRAINING_LOAD_AGGREGATION_VERSION,
    algorithmVersion: EXERCISE_LOAD_ALGORITHM_VERSION,
    confidence: aggregateConfidence,
    qualifyingSetCount,
    deduplicatedSetCount,
    unclassifiedSetCount,
    unknownSecondaryParticipationSetCount,
    muscles,
    movementPatterns,
    fatigueTags,
    jointStress,
    equivalentSetsHeuristic: {
      version: EQUIVALENT_SETS_HEURISTIC_VERSION,
      classification: 'ENGINEERING_HEURISTIC',
      coefficients,
      provenance: 'OWNER_REQUESTED_INITIAL_HEURISTIC',
      confidence: 'LOW',
      appliesToUnknownParticipation: false,
      effortCoefficient: modifierCoverage.effortCoefficient,
      rangeOfMotionCoefficient: modifierCoverage.rangeOfMotionCoefficient,
    },
  };
}

export function trainingLoadInputsFromProfile(
  input: Omit<TrainingLoadSetInput, 'loadProfile'> & { loadProfile: ExerciseLoadProfile },
): TrainingLoadSetInput {
  return input;
}

function emptyBreakdown(): SetCountBreakdown {
  return {
    total: 0,
    regular: 0,
    drop: 0,
    setsWithRir: 0,
    setsWithoutRir: 0,
    setsAtRir0To4: 0,
    reliableHistory: 0,
    unreliableHistory: 0,
    unknownHistoryReliability: 0,
  };
}

function emptyModifierCoverage(interpretation: string): ModifierCoverage {
  return { appliedSetCount: 0, unknownSetCount: 0, unreliableSetCount: 0, interpretation };
}

function resolveModifier(
  input: TrainingLoadModifier | undefined,
  coverage: ModifierCoverage,
): ResolvedModifier {
  if (!input || input.status === 'UNKNOWN' || input.value == null) {
    coverage.unknownSetCount += 1;
    return { value: 1, confidence: 'LOW' };
  }
  if (input.status === 'UNRELIABLE') {
    coverage.unreliableSetCount += 1;
    return { value: 1, confidence: 'LOW' };
  }
  if (
    !Number.isFinite(input.value) ||
    input.value < 0.5 ||
    input.value > 1.5 ||
    !input.provenance?.trim() ||
    !input.confidence ||
    input.confidence === 'UNKNOWN'
  ) {
    coverage.unreliableSetCount += 1;
    return { value: 1, confidence: 'LOW' };
  }
  coverage.appliedSetCount += 1;
  return { value: input.value, confidence: input.confidence };
}

function addMuscleContribution(
  muscles: Record<string, MuscleTrainingLoad>,
  muscle: MuscleGroup,
  role: ContributionRole,
  input: TrainingLoadSetInput,
  equivalentContribution: number,
  confidence: ExerciseLoadConfidence,
) {
  const row = (muscles[muscle] ??= {
    directSets: 0,
    indirectSets: 0,
    directSetBreakdown: emptyBreakdown(),
    indirectSetBreakdown: emptyBreakdown(),
    equivalentSets: 0,
    confidence,
  });
  row.confidence = lowerConfidence(row.confidence, confidence);
  row.equivalentSets = round(row.equivalentSets + equivalentContribution, 2);
  if (role === 'direct') {
    row.directSets += 1;
    addBreakdown(row.directSetBreakdown, input);
  } else {
    row.indirectSets += 1;
    addBreakdown(row.indirectSetBreakdown, input);
  }
}

function addBreakdown(breakdown: SetCountBreakdown, input: TrainingLoadSetInput) {
  breakdown.total += 1;
  if (input.isDropSet) {
    breakdown.drop += 1;
  } else {
    breakdown.regular += 1;
    if (input.rir == null) {
      breakdown.setsWithoutRir += 1;
    } else {
      breakdown.setsWithRir += 1;
      if (input.rir >= 0 && input.rir <= 4) breakdown.setsAtRir0To4 += 1;
    }
  }
  const reliability = input.historyReliability ?? 'UNKNOWN';
  if (reliability === 'RELIABLE') breakdown.reliableHistory += 1;
  else if (reliability === 'UNRELIABLE') breakdown.unreliableHistory += 1;
  else breakdown.unknownHistoryReliability += 1;
}

function addTagCounts<T extends { state: 'KNOWN' | 'UNKNOWN'; entries: Array<{ value: string }> }>(
  target: Record<string, number>,
  dimension: T,
  _input: TrainingLoadSetInput,
) {
  if (dimension.state !== 'KNOWN') return;
  for (const entry of dimension.entries) {
    target[entry.value] = (target[entry.value] ?? 0) + 1;
  }
}

function lowerConfidence(
  current: ExerciseLoadConfidence,
  candidate: ExerciseLoadConfidence,
): ExerciseLoadConfidence {
  return confidenceRank[candidate] < confidenceRank[current] ? candidate : current;
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
