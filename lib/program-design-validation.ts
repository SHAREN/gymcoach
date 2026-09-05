import type { GeneratedProgram } from '@/lib/schemas/program-generation';
import type { ProgramDesignContext } from '@/lib/program-design-context';

export const PROGRAM_DESIGN_PRIMARY_MUSCLE_RULES = {
  perSessionSoftCapSets: 10,
  weeklyStartingRangeMaxSets: 20,
} as const;

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
  accounting: {
    mode: 'PRIMARY_MUSCLE_ONLY';
    note: string;
  };
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
    context.returnToTraining.map((item) => [item.exerciseName.toLocaleLowerCase(), item]),
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
    const sessionSets: Record<string, number> = {};
    const seenMuscles = new Set<string>();
    let seconds = 0;

    if (allowedDays.size > 0 && workout.dayOfWeek == null) {
      issues.push({
        code: 'training-day-unassigned',
        severity: 'warning',
        message: `${workout.name} is not assigned to one of the trainee's available weekdays.`,
        path: `workouts.${workoutIndex}.dayOfWeek`,
      });
    } else if (workout.dayOfWeek != null && !allowedDays.has(workout.dayOfWeek)) {
      issues.push({
        code: 'training-day-unavailable',
        severity: 'error',
        message: `${workout.name} is assigned to an unavailable weekday.`,
        path: `workouts.${workoutIndex}.dayOfWeek`,
      });
    } else if (workout.dayOfWeek != null && usedDays.has(workout.dayOfWeek)) {
      issues.push({
        code: 'duplicate-training-day',
        severity: 'warning',
        message: `More than one workout is assigned to weekday ${workout.dayOfWeek}.`,
        path: `workouts.${workoutIndex}.dayOfWeek`,
      });
    }
    if (workout.dayOfWeek != null) usedDays.add(workout.dayOfWeek);

    for (const [exerciseIndex, exercise] of workout.exercises.entries()) {
      const known = exerciseByName.get(exercise.name.toLocaleLowerCase());
      const muscleGroup = known?.muscleGroup ?? exercise.muscleGroup;
      const category = known?.category ?? exercise.category;
      const sets = exercise.targetSets;

      weeklySetsByMuscle[muscleGroup] = (weeklySetsByMuscle[muscleGroup] ?? 0) + sets;
      sessionSets[muscleGroup] = (sessionSets[muscleGroup] ?? 0) + sets;
      seenMuscles.add(muscleGroup);
      seconds += sets * (exercise.restSec + 45);

      if (!known) {
        issues.push({
          code: 'new-exercise',
          severity: 'warning',
          message: `${exercise.name} is not in the current exercise catalog and would be created as a new exercise.`,
          path: `workouts.${workoutIndex}.exercises.${exerciseIndex}.name`,
        });
      } else if (
        known.muscleGroup !== exercise.muscleGroup ||
        known.category !== exercise.category ||
        (exercise.equipmentType != null && known.equipmentType !== exercise.equipmentType)
      ) {
        issues.push({
          code: 'catalog-metadata-normalized',
          severity: 'warning',
          message: `${exercise.name} uses the existing catalog metadata for validation and persistence.`,
          path: `workouts.${workoutIndex}.exercises.${exerciseIndex}`,
        });
      }

      if (category === 'COMPOUND' && exercise.targetRIR === 0) {
        issues.push({
          code: 'compound-failure',
          severity: 'warning',
          message: `${exercise.name} is a compound movement programmed to RIR 0.`,
          path: `workouts.${workoutIndex}.exercises.${exerciseIndex}.targetRIR`,
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
      if (known && !known.isAllowedByProfile) {
        issues.push({
          code: 'profile-limitation-conflict',
          severity: 'error',
          message: `${exercise.name} conflicts with a self-reported exercise constraint: ${known.limitationReasons.join('; ')}.`,
          path: `workouts.${workoutIndex}.exercises.${exerciseIndex}.name`,
        });
      }

      const returnRecommendation = returnByName.get(exercise.name.toLocaleLowerCase());
      if (returnRecommendation && returnRecommendation.mode !== 'normal') {
        if (exercise.targetSets > returnRecommendation.targetSets) {
          issues.push({
            code: 'return-set-limit',
            severity: 'error',
            message: `${exercise.name} is in ${returnRecommendation.mode} and is limited to ${returnRecommendation.targetSets} set(s) for calibration.`,
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
      }
    }

    for (const muscle of seenMuscles) {
      frequencyByMuscle[muscle] = (frequencyByMuscle[muscle] ?? 0) + 1;
    }
    for (const [muscle, sets] of Object.entries(sessionSets)) {
      if (sets > PROGRAM_DESIGN_PRIMARY_MUSCLE_RULES.perSessionSoftCapSets) {
        issues.push({
          code: 'session-volume-soft-cap',
          severity: 'warning',
          message: `${workout.name} has ${sets} primary-muscle sets for ${muscle}; this exceeds the current soft session-volume rule.`,
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

  for (const [muscle, sets] of Object.entries(weeklySetsByMuscle)) {
    if (sets > PROGRAM_DESIGN_PRIMARY_MUSCLE_RULES.weeklyStartingRangeMaxSets) {
      issues.push({
        code: 'high-weekly-volume',
        severity: 'warning',
        message: `${muscle} has ${sets} primary-muscle sets per week; this exceeds the current starting-range rule.`,
      });
    }
    if (
      sets > PROGRAM_DESIGN_PRIMARY_MUSCLE_RULES.perSessionSoftCapSets &&
      (frequencyByMuscle[muscle] ?? 0) < 2
    ) {
      issues.push({
        code: 'volume-not-distributed',
        severity: 'warning',
        message: `${muscle} has ${sets} weekly primary-muscle sets in only one workout.`,
      });
    }
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
      severity: 'error',
      message: `The draft has ${program.workouts.length} workouts but the resolved weekly frequency is ${context.answers.weeklyFrequency}.`,
    });
  }
  if (!context.gym) {
    issues.push({
      code: 'no-active-gym',
      severity: 'warning',
      message: 'No active gym is selected, so exact equipment availability cannot be verified.',
    });
  }

  return {
    valid: !issues.some((issue) => issue.severity === 'error'),
    issues,
    weeklySetsByMuscle,
    frequencyByMuscle,
    estimatedSessionMinutes,
    accounting: {
      mode: 'PRIMARY_MUSCLE_ONLY',
      note: 'M12 validates only the current upstream primary-muscle model. Multi-muscle/equivalent-set accounting is intentionally deferred to M13.',
    },
  };
}
