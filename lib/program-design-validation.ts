import type { GeneratedProgram } from '@/lib/schemas/program-generation';
import type { ProgramDesignContext } from '@/lib/program-design-context';
import { PROGRAM_DESIGN_RULES } from '@/lib/program-design-methodology';

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
  const exerciseByName = new Map(
    context.availableExercises.map((exercise) => [exercise.name.toLocaleLowerCase(), exercise]),
  );
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
    const sessionSets: Record<string, number> = {};
    const seenMuscles = new Set<string>();
    let seconds = 0;
    for (const [exerciseIndex, exercise] of workout.exercises.entries()) {
      const known = exerciseByName.get(exercise.name.toLocaleLowerCase());
      const muscleGroup = known?.muscleGroup ?? exercise.muscleGroup;
      const category = known?.category ?? exercise.category;
      const dropSets = exercise.targetDropSets ?? 0;
      const totalSets = exercise.targetSets + dropSets;
      weeklySetsByMuscle[muscleGroup] = (weeklySetsByMuscle[muscleGroup] ?? 0) + totalSets;
      sessionSets[muscleGroup] = (sessionSets[muscleGroup] ?? 0) + totalSets;
      seenMuscles.add(muscleGroup);
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
    for (const muscle of seenMuscles) {
      frequencyByMuscle[muscle] = (frequencyByMuscle[muscle] ?? 0) + 1;
    }
    for (const [muscle, sets] of Object.entries(sessionSets)) {
      if (sets > PROGRAM_DESIGN_RULES.engineeringHeuristics.perMuscleSessionSoftCapSets) {
        issues.push({
          code: 'session-volume-soft-cap',
          severity: 'warning',
          message: `${workout.name} has ${sets} primary-muscle sets for ${muscle}; distribute volume because returns often diminish above about 10 hard sets in one session.`,
          path: `workouts.${workoutIndex}`,
        });
      }
    }
    const minutes = Math.ceil(seconds / 60);
    estimatedSessionMinutes.push({ workoutName: workout.name, minutes });
    if (context.answers.sessionDurationMin && minutes > context.answers.sessionDurationMin * 1.15) {
      issues.push({
        code: 'session-too-long',
        severity: 'warning',
        message: `${workout.name} is estimated at about ${minutes} minutes, above the trainee's ${context.answers.sessionDurationMin}-minute limit.`,
        path: `workouts.${workoutIndex}`,
      });
    }
  }

  for (const [muscle, sets] of Object.entries(weeklySetsByMuscle)) {
    if (sets > 20) {
      issues.push({
        code: 'high-weekly-volume',
        severity: 'warning',
        message: `${muscle} has ${sets} primary-muscle sets per week. This is above the normal starting range and needs a data-backed reason.`,
      });
    }
    if (sets > 10 && (frequencyByMuscle[muscle] ?? 0) < 2) {
      issues.push({
        code: 'volume-not-distributed',
        severity: 'warning',
        message: `${muscle} has ${sets} weekly sets in only one workout. Split high volume across at least two sessions when practical.`,
      });
    }
  }

  const candidateTotal = Object.values(weeklySetsByMuscle).reduce((sum, sets) => sum + sets, 0);
  const sourceTotal = Object.values(context.program.targetVolumeByMuscle).reduce(
    (sum, row) => sum + row.weeklySets,
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
      message: `Systemic recovery is flagged for load reduction, but the draft raises total primary-muscle sets from ${sourceTotal} to ${candidateTotal}.`,
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
    frequencyByMuscle,
    estimatedSessionMinutes,
  };
}
