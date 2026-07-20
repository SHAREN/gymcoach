import type { GeneratedProgram } from '@/lib/schemas/program-generation';
import type { ProgramDesignContext } from '@/lib/program-design-context';
import { PROGRAM_DESIGN_RULES } from '@/lib/program-design-methodology';
import {
  aggregateTrainingLoad,
  type TrainingLoadAggregation,
  type TrainingLoadSetInput,
} from '@/lib/training-load-aggregation';
import { deriveServerExerciseClassification } from '@/lib/exercise-classification';

export interface ProgramDesignIssue {
  code: string;
  severity: 'warning' | 'error';
  message: string;
  path?: string;
}

export interface ProgramDesignValidation {
  valid: boolean;
  issues: ProgramDesignIssue[];
  weeklySetsByMuscle: Record<string, number>;
  weeklyLoadByMuscle: TrainingLoadAggregation['muscles'];
  loadProfileMetadata: Pick<
    TrainingLoadAggregation,
    | 'version'
    | 'algorithmVersion'
    | 'confidence'
    | 'unclassifiedSetCount'
    | 'unknownSecondaryParticipationSetCount'
    | 'equivalentSetsHeuristic'
  >;
  frequencyByMuscle: Record<string, number>;
  estimatedSessionMinutes: Array<{ workoutName: string; minutes: number }>;
}

export function validateProgramDesign(
  program: GeneratedProgram,
  context: ProgramDesignContext,
): ProgramDesignValidation {
  const issues: ProgramDesignIssue[] = [];
  const weeklySetsByMuscle: Record<string, number> = {};
  const frequencyByMuscle: Record<string, number> = {};
  const plannedLoadInputs: TrainingLoadSetInput[] = [];
  const exerciseByName = new Map(
    context.availableExercises.map((exercise) => [exercise.name.toLocaleLowerCase(), exercise]),
  );
  const limitationByExerciseName = new Map<string, string[]>();
  for (const constraint of context.exerciseConstraints) {
    for (const exerciseName of constraint.affectedExerciseNames) {
      const key = exerciseName.toLocaleLowerCase();
      const reasons = limitationByExerciseName.get(key) ?? [];
      reasons.push(`${constraint.kind}: ${constraint.label}`);
      limitationByExerciseName.set(key, reasons);
    }
  }
  const returnByName = new Map(
    context.history.returnToTraining.map((item) => [item.exerciseName.toLocaleLowerCase(), item]),
  );
  const estimatedSessionMinutes: Array<{ workoutName: string; minutes: number }> = [];
  const allowedDays = new Set(context.answers.availableDays ?? []);
  const usedDays = new Set<number>();

  for (const question of context.missingQuestions) {
    issues.push({
      code: 'missing-required-input',
      severity: 'error',
      message: question.prompt,
    });
  }

  for (const message of context.safety.blockingReasons) {
    issues.push({
      code: 'medical-clearance-required',
      severity: 'error',
      message,
      path: 'answers.healthStatus',
    });
  }

  for (const [workoutIndex, workout] of program.workouts.entries()) {
    if (allowedDays.size > 0 && workout.dayOfWeek == null) {
      issues.push({
        code: 'training-day-unassigned',
        severity: 'warning',
        message: workout.name + " is not assigned to one of the trainee's available weekdays.",
        path: 'workouts.' + workoutIndex + '.dayOfWeek',
      });
    } else if (workout.dayOfWeek != null && !allowedDays.has(workout.dayOfWeek)) {
      issues.push({
        code: 'training-day-unavailable',
        severity: 'error',
        message: workout.name + ' is assigned to an unavailable weekday.',
        path: 'workouts.' + workoutIndex + '.dayOfWeek',
      });
    } else if (workout.dayOfWeek != null && usedDays.has(workout.dayOfWeek)) {
      issues.push({
        code: 'duplicate-training-day',
        severity: 'warning',
        message: 'More than one workout is assigned to weekday ' + workout.dayOfWeek + '.',
        path: 'workouts.' + workoutIndex + '.dayOfWeek',
      });
    }
    if (workout.dayOfWeek != null) {
      usedDays.add(workout.dayOfWeek);
    }
    const sessionLoadInputs: TrainingLoadSetInput[] = [];
    let seconds = 0;
    for (const [exerciseIndex, exercise] of workout.exercises.entries()) {
      const known = exerciseByName.get(exercise.name.toLocaleLowerCase());
      const muscleGroup = known?.muscleGroup ?? exercise.muscleGroup;
      const category = known?.category ?? exercise.category;
      const limitationReasons = [
        ...(known?.limitationReasons ?? []),
        ...(limitationByExerciseName.get(exercise.name.toLocaleLowerCase()) ?? []),
      ].filter((reason, index, reasons) => reasons.indexOf(reason) === index);
      const dropSets = exercise.targetDropSets ?? 0;
      const totalSets = exercise.targetSets + dropSets;
      const loadProfile =
        known?.loadProfile ??
        deriveServerExerciseClassification({
          name: exercise.name,
          muscleGroup: exercise.muscleGroup,
          category: exercise.category,
          defaultRestSec: exercise.restSec,
          notes: null,
          usesBodyweight: false,
          equipmentType: exercise.equipmentType ?? 'OTHER',
        }).loadProfile;
      for (let setIndex = 0; setIndex < totalSets; setIndex += 1) {
        const loadInput: TrainingLoadSetInput = {
          setId: `draft:${workoutIndex}:${exerciseIndex}:${setIndex}`,
          exerciseId: known?.id ?? `draft:${exercise.name}`,
          legacyMuscleGroup: muscleGroup,
          loadProfile,
          isWarmup: false,
          isDropSet: setIndex >= exercise.targetSets,
          rir: exercise.targetRIR,
          historyReliability: 'UNKNOWN',
        };
        sessionLoadInputs.push(loadInput);
        plannedLoadInputs.push(loadInput);
      }
      seconds += exercise.targetSets * (exercise.restSec + 45) + dropSets * 60;

      if (
        known &&
        (known.muscleGroup !== exercise.muscleGroup ||
          known.category !== exercise.category ||
          (exercise.equipmentType != null && known.equipmentType !== exercise.equipmentType))
      ) {
        issues.push({
          code: 'catalog-metadata-normalized',
          severity: 'warning',
          message: `${exercise.name} uses the existing catalog exercise metadata for validation and persistence.`,
          path: `workouts.${workoutIndex}.exercises.${exerciseIndex}`,
        });
      }

      if (category === 'COMPOUND' && exercise.targetRIR === 0) {
        issues.push({
          code: 'compound-failure',
          severity: 'warning',
          message: `${exercise.name} is a compound lift programmed to failure. Keep failure selective and require an explicit reason.`,
          path: `workouts.${workoutIndex}.exercises.${exerciseIndex}.targetRIR`,
        });
      }
      if (category === 'COMPOUND' && dropSets > 0) {
        issues.push({
          code: 'compound-drop-set',
          severity: 'warning',
          message: `${exercise.name} uses planned drop sets on a compound movement.`,
          path: `workouts.${workoutIndex}.exercises.${exerciseIndex}.targetDropSets`,
        });
      }

      if (known?.isAvailableInActiveGym === false) {
        issues.push({
          code: 'equipment-unavailable',
          severity: 'error',
          message: `${exercise.name} is marked unavailable in the active gym.`,
          path: `workouts.${workoutIndex}.exercises.${exerciseIndex}.name`,
        });
      }
      if (limitationReasons.length > 0) {
        issues.push({
          code: 'profile-limitation-conflict',
          severity: 'error',
          message: `${exercise.name} conflicts with a self-reported exercise constraint: ${limitationReasons.join('; ')}. Remove it and ask the trainee to choose any substitution explicitly.`,
          path: `workouts.${workoutIndex}.exercises.${exerciseIndex}.name`,
        });
      }
      if (known?.requiresEquipmentSelection) {
        issues.push({
          code: 'equipment-selection-required',
          severity: 'warning',
          message: `${exercise.name} is available on multiple equipment instances. Select the concrete machine when logging so their loads are not treated as exact equivalents.`,
          path: `workouts.${workoutIndex}.exercises.${exerciseIndex}.name`,
        });
      }

      const returnRecommendation = returnByName.get(exercise.name.toLocaleLowerCase());
      if (returnRecommendation && returnRecommendation.mode !== 'normal') {
        if (exercise.targetSets > returnRecommendation.targetSets) {
          issues.push({
            code: 'return-set-limit',
            severity: 'error',
            message: `${exercise.name} is in ${returnRecommendation.mode} and is limited to ${returnRecommendation.targetSets} regular set(s) for calibration.`,
            path: `workouts.${workoutIndex}.exercises.${exerciseIndex}.targetSets`,
          });
        }
        if (exercise.targetRIR < returnRecommendation.targetRIR) {
          issues.push({
            code: 'return-rir-limit',
            severity: 'error',
            message: `${exercise.name} is in ${returnRecommendation.mode} and requires at least RIR ${returnRecommendation.targetRIR}.`,
            path: `workouts.${workoutIndex}.exercises.${exerciseIndex}.targetRIR`,
          });
        }
        if (dropSets > 0) {
          issues.push({
            code: 'return-drop-sets',
            severity: 'error',
            message: `${exercise.name} cannot use drop sets during return calibration.`,
            path: `workouts.${workoutIndex}.exercises.${exerciseIndex}.targetDropSets`,
          });
        }
      }
    }
    const sessionLoad = aggregateTrainingLoad(sessionLoadInputs);
    for (const [muscle, row] of Object.entries(sessionLoad.muscles)) {
      frequencyByMuscle[muscle] = (frequencyByMuscle[muscle] ?? 0) + 1;
      if (
        row.equivalentSets > PROGRAM_DESIGN_RULES.engineeringHeuristics.perMuscleSessionSoftCapSets
      ) {
        issues.push({
          code: 'session-volume-soft-cap',
          severity: 'warning',
          message: `${workout.name} has ${row.directSets} direct and ${row.indirectSets} indirect sets for ${muscle} (${row.equivalentSets} equivalent sets under ${sessionLoad.equivalentSetsHeuristic.version}); distribute volume because the existing session-volume policy was exceeded.`,
          path: `workouts.${workoutIndex}`,
        });
      }
    }
    const minutes = Math.ceil(seconds / 60);
    estimatedSessionMinutes.push({ workoutName: workout.name, minutes });
    if (context.answers.sessionDurationMin && minutes > context.answers.sessionDurationMin) {
      issues.push({
        code: 'session-too-long',
        severity: 'error',
        message: `${workout.name} is estimated at about ${minutes} minutes, above the trainee's ${context.answers.sessionDurationMin}-minute limit.`,
        path: `workouts.${workoutIndex}`,
      });
    }
  }

  const weeklyLoad = aggregateTrainingLoad(plannedLoadInputs);
  for (const [muscle, row] of Object.entries(weeklyLoad.muscles)) {
    weeklySetsByMuscle[muscle] = row.directSets;
    if (
      row.equivalentSets >
      PROGRAM_DESIGN_RULES.engineeringHeuristics.weeklyVolumeStartingRangeSets[1]
    ) {
      issues.push({
        code: 'high-weekly-volume',
        severity: 'warning',
        message: `${muscle} has ${row.directSets} direct and ${row.indirectSets} indirect sets (${row.equivalentSets} equivalent sets under ${weeklyLoad.equivalentSetsHeuristic.version}). This exceeds the existing starting-range policy and needs a data-backed reason.`,
      });
    }
    if (
      row.equivalentSets > PROGRAM_DESIGN_RULES.engineeringHeuristics.perMuscleSessionSoftCapSets &&
      (frequencyByMuscle[muscle] ?? 0) < 2
    ) {
      issues.push({
        code: 'volume-not-distributed',
        severity: 'warning',
        message: `${muscle} has ${row.directSets} direct and ${row.indirectSets} indirect weekly sets in only one workout. Split high overlap-adjusted volume across at least two sessions when practical.`,
      });
    }
  }

  const candidateTotal = Object.values(weeklyLoad.muscles).reduce(
    (sum, row) => sum + row.equivalentSets,
    0,
  );
  const sourceTotal = Object.values(context.program.targetVolumeByMuscle).reduce(
    (sum, row) => sum + row.equivalentSets,
    0,
  );
  if (
    context.recovery.systemic.level === 'reduce_load' &&
    sourceTotal > 0 &&
    candidateTotal > sourceTotal
  ) {
    issues.push({
      code: 'volume-increase-during-under-recovery',
      severity: 'error',
      message: `Systemic recovery is flagged for load reduction, but the draft raises total overlap-adjusted equivalent sets from ${sourceTotal} to ${candidateTotal}.`,
    });
  }

  if (
    context.answers.availableDays &&
    context.answers.weeklyFrequency &&
    context.answers.weeklyFrequency > context.answers.availableDays.length
  ) {
    issues.push({
      code: 'schedule-capacity-mismatch',
      severity: 'error',
      message: 'Weekly frequency exceeds the number of available weekdays.',
    });
  }
  if (
    context.answers.availableDays &&
    program.workouts.length > context.answers.availableDays.length
  ) {
    issues.push({
      code: 'workouts-exceed-available-days',
      severity: 'error',
      message: 'The draft contains more workouts than available weekdays.',
    });
  }

  if (
    context.answers.weeklyFrequency &&
    program.workouts.length > context.answers.weeklyFrequency
  ) {
    issues.push({
      code: 'frequency-mismatch',
      severity: 'warning',
      message: `The draft has ${program.workouts.length} workouts but the available schedule is ${context.answers.weeklyFrequency} per week.`,
    });
  }
  if (!context.gym) {
    issues.push({
      code: 'no-active-gym',
      severity: 'warning',
      message:
        'No active gym is selected, so exact equipment and load availability cannot be verified.',
    });
  }

  return {
    valid: !issues.some((issue) => issue.severity === 'error'),
    issues,
    weeklySetsByMuscle,
    weeklyLoadByMuscle: weeklyLoad.muscles,
    loadProfileMetadata: {
      version: weeklyLoad.version,
      algorithmVersion: weeklyLoad.algorithmVersion,
      confidence: weeklyLoad.confidence,
      unclassifiedSetCount: weeklyLoad.unclassifiedSetCount,
      unknownSecondaryParticipationSetCount: weeklyLoad.unknownSecondaryParticipationSetCount,
      equivalentSetsHeuristic: weeklyLoad.equivalentSetsHeuristic,
    },
    frequencyByMuscle,
    estimatedSessionMinutes,
  };
}
