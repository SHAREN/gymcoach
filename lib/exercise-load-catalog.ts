import { ExerciseCategory, MuscleGroup } from '@/lib/prisma-client';
import {
  reviewedExerciseLoadProfile,
  type ExerciseLoadProfile,
  type FatigueTag,
  type JointStressTag,
  type MovementPattern,
} from '@/lib/schemas/exercise-load-profile';
import { unclassifiedExerciseLoadProfile } from '@/lib/schemas/exercise-load-profile';

type CatalogLoadProfile = {
  primaryMuscles: MuscleGroup[] | null;
  secondaryMuscles: MuscleGroup[];
  movementPatterns: MovementPattern[];
  fatigueTags?: FatigueTag[];
  jointStress?: JointStressTag[];
};

const PUSH_JOINTS: JointStressTag[] = ['SHOULDER', 'ELBOW', 'WRIST'];
const PULL_JOINTS: JointStressTag[] = ['SHOULDER', 'ELBOW', 'WRIST'];
const LOWER_JOINTS: JointStressTag[] = ['HIP', 'KNEE'];

const CORE_CATALOG_LOAD_PROFILES: Record<string, CatalogLoadProfile> = {
  'Barbell bench press': {
    primaryMuscles: [MuscleGroup.CHEST],
    secondaryMuscles: [MuscleGroup.TRICEPS, MuscleGroup.SHOULDERS_FRONT],
    movementPatterns: ['HORIZONTAL_PUSH'],
    fatigueTags: ['SYSTEMIC_COMPOUND'],
    jointStress: PUSH_JOINTS,
  },
  'Flat dumbbell bench press': {
    primaryMuscles: [MuscleGroup.CHEST],
    secondaryMuscles: [MuscleGroup.TRICEPS, MuscleGroup.SHOULDERS_FRONT],
    movementPatterns: ['HORIZONTAL_PUSH'],
    fatigueTags: ['SYSTEMIC_COMPOUND'],
    jointStress: PUSH_JOINTS,
  },
  'Incline dumbbell press (30 deg)': {
    primaryMuscles: [MuscleGroup.CHEST],
    secondaryMuscles: [MuscleGroup.TRICEPS, MuscleGroup.SHOULDERS_FRONT],
    movementPatterns: ['HORIZONTAL_PUSH'],
    fatigueTags: ['SYSTEMIC_COMPOUND'],
    jointStress: PUSH_JOINTS,
  },
  'Machine chest press': {
    primaryMuscles: [MuscleGroup.CHEST],
    secondaryMuscles: [MuscleGroup.TRICEPS, MuscleGroup.SHOULDERS_FRONT],
    movementPatterns: ['HORIZONTAL_PUSH'],
    fatigueTags: ['SYSTEMIC_COMPOUND'],
    jointStress: ['SHOULDER', 'ELBOW'],
  },
  'Close-grip bench press': {
    primaryMuscles: [MuscleGroup.TRICEPS],
    secondaryMuscles: [MuscleGroup.CHEST, MuscleGroup.SHOULDERS_FRONT],
    movementPatterns: ['HORIZONTAL_PUSH', 'ELBOW_EXTENSION'],
    fatigueTags: ['SYSTEMIC_COMPOUND'],
    jointStress: PUSH_JOINTS,
  },
  'Machine dips or parallel bars': {
    primaryMuscles: [MuscleGroup.TRICEPS],
    secondaryMuscles: [MuscleGroup.CHEST, MuscleGroup.SHOULDERS_FRONT],
    movementPatterns: ['VERTICAL_PUSH', 'ELBOW_EXTENSION'],
    fatigueTags: ['SYSTEMIC_COMPOUND'],
    jointStress: PUSH_JOINTS,
  },
  'Seated dumbbell overhead press': {
    primaryMuscles: [MuscleGroup.SHOULDERS_FRONT],
    secondaryMuscles: [MuscleGroup.TRICEPS, MuscleGroup.SHOULDERS_LATERAL],
    movementPatterns: ['VERTICAL_PUSH'],
    fatigueTags: ['SYSTEMIC_COMPOUND'],
    jointStress: PUSH_JOINTS,
  },
  'Standing barbell overhead press': {
    primaryMuscles: [MuscleGroup.SHOULDERS_FRONT],
    secondaryMuscles: [MuscleGroup.TRICEPS, MuscleGroup.SHOULDERS_LATERAL, MuscleGroup.LOWER_BACK],
    movementPatterns: ['VERTICAL_PUSH', 'TRUNK_STABILIZATION'],
    fatigueTags: ['SYSTEMIC_COMPOUND', 'AXIAL_LOAD', 'LUMBAR_ISOMETRIC'],
    jointStress: [...PUSH_JOINTS, 'LUMBAR_SPINE'],
  },
  'Pronated pull-ups (weighted if possible)': {
    primaryMuscles: [MuscleGroup.BACK_WIDTH],
    secondaryMuscles: [MuscleGroup.BICEPS, MuscleGroup.FOREARMS],
    movementPatterns: ['VERTICAL_PULL', 'ELBOW_FLEXION'],
    fatigueTags: ['SYSTEMIC_COMPOUND', 'GRIP'],
    jointStress: PULL_JOINTS,
  },
  'Lat pulldown (wide grip)': {
    primaryMuscles: [MuscleGroup.BACK_WIDTH],
    secondaryMuscles: [MuscleGroup.BICEPS, MuscleGroup.FOREARMS],
    movementPatterns: ['VERTICAL_PULL', 'ELBOW_FLEXION'],
    fatigueTags: ['SYSTEMIC_COMPOUND', 'GRIP'],
    jointStress: PULL_JOINTS,
  },
  'Neutral-grip lat pulldown': {
    primaryMuscles: [MuscleGroup.BACK_WIDTH],
    secondaryMuscles: [MuscleGroup.BICEPS, MuscleGroup.FOREARMS],
    movementPatterns: ['VERTICAL_PULL', 'ELBOW_FLEXION'],
    fatigueTags: ['SYSTEMIC_COMPOUND', 'GRIP'],
    jointStress: PULL_JOINTS,
  },
  'Bent-over barbell row': {
    primaryMuscles: [MuscleGroup.BACK_THICKNESS],
    secondaryMuscles: [
      MuscleGroup.BACK_WIDTH,
      MuscleGroup.BICEPS,
      MuscleGroup.SHOULDERS_REAR,
      MuscleGroup.FOREARMS,
      MuscleGroup.LOWER_BACK,
    ],
    movementPatterns: ['HORIZONTAL_PULL', 'ROW', 'HIP_HINGE', 'TRUNK_STABILIZATION'],
    fatigueTags: ['SYSTEMIC_COMPOUND', 'AXIAL_LOAD', 'LUMBAR_ISOMETRIC', 'GRIP'],
    jointStress: [...PULL_JOINTS, 'LUMBAR_SPINE', 'HIP'],
  },
  'Seated cable row (close handles)': {
    primaryMuscles: [MuscleGroup.BACK_THICKNESS],
    secondaryMuscles: [
      MuscleGroup.BACK_WIDTH,
      MuscleGroup.BICEPS,
      MuscleGroup.SHOULDERS_REAR,
      MuscleGroup.FOREARMS,
    ],
    movementPatterns: ['HORIZONTAL_PULL', 'ROW', 'ELBOW_FLEXION'],
    fatigueTags: ['SYSTEMIC_COMPOUND', 'GRIP'],
    jointStress: PULL_JOINTS,
  },
  'Chest-supported machine row': {
    primaryMuscles: [MuscleGroup.BACK_THICKNESS],
    secondaryMuscles: [MuscleGroup.BACK_WIDTH, MuscleGroup.BICEPS, MuscleGroup.SHOULDERS_REAR],
    movementPatterns: ['HORIZONTAL_PULL', 'ROW', 'ELBOW_FLEXION'],
    fatigueTags: ['SYSTEMIC_COMPOUND', 'GRIP'],
    jointStress: ['SHOULDER', 'ELBOW'],
  },
  'Single-arm dumbbell row': {
    primaryMuscles: [MuscleGroup.BACK_THICKNESS],
    secondaryMuscles: [
      MuscleGroup.BACK_WIDTH,
      MuscleGroup.BICEPS,
      MuscleGroup.SHOULDERS_REAR,
      MuscleGroup.FOREARMS,
    ],
    movementPatterns: ['HORIZONTAL_PULL', 'ROW', 'ELBOW_FLEXION'],
    fatigueTags: ['SYSTEMIC_COMPOUND', 'GRIP'],
    jointStress: PULL_JOINTS,
  },
  'Machine squat (or Hack squat)': {
    primaryMuscles: [MuscleGroup.QUADS],
    secondaryMuscles: [MuscleGroup.GLUTES, MuscleGroup.HAMSTRINGS],
    movementPatterns: ['SQUAT_KNEE_DOMINANT'],
    fatigueTags: ['SYSTEMIC_COMPOUND', 'AXIAL_LOAD'],
    jointStress: [...LOWER_JOINTS, 'LUMBAR_SPINE'],
  },
  'Leg press (45 deg)': {
    primaryMuscles: [MuscleGroup.QUADS],
    secondaryMuscles: [MuscleGroup.GLUTES, MuscleGroup.HAMSTRINGS],
    movementPatterns: ['SQUAT_KNEE_DOMINANT'],
    fatigueTags: ['SYSTEMIC_COMPOUND'],
    jointStress: LOWER_JOINTS,
  },
  'Goblet squat': {
    primaryMuscles: [MuscleGroup.QUADS],
    secondaryMuscles: [MuscleGroup.GLUTES, MuscleGroup.HAMSTRINGS],
    movementPatterns: ['SQUAT_KNEE_DOMINANT', 'TRUNK_STABILIZATION'],
    fatigueTags: ['SYSTEMIC_COMPOUND'],
    jointStress: [...LOWER_JOINTS, 'LUMBAR_SPINE'],
  },
  'Walking lunges with dumbbells': {
    primaryMuscles: [MuscleGroup.QUADS],
    secondaryMuscles: [MuscleGroup.GLUTES, MuscleGroup.HAMSTRINGS],
    movementPatterns: ['LUNGE', 'SQUAT_KNEE_DOMINANT'],
    fatigueTags: ['SYSTEMIC_COMPOUND', 'GRIP'],
    jointStress: LOWER_JOINTS,
  },
  'Bulgarian split squat': {
    primaryMuscles: [MuscleGroup.QUADS],
    secondaryMuscles: [MuscleGroup.GLUTES, MuscleGroup.HAMSTRINGS],
    movementPatterns: ['LUNGE', 'SQUAT_KNEE_DOMINANT'],
    fatigueTags: ['SYSTEMIC_COMPOUND'],
    jointStress: LOWER_JOINTS,
  },
  'Dumbbell Romanian Deadlift': {
    primaryMuscles: [MuscleGroup.HAMSTRINGS],
    secondaryMuscles: [MuscleGroup.GLUTES, MuscleGroup.LOWER_BACK, MuscleGroup.FOREARMS],
    movementPatterns: ['HIP_HINGE', 'TRUNK_STABILIZATION'],
    fatigueTags: ['SYSTEMIC_COMPOUND', 'AXIAL_LOAD', 'LUMBAR_ISOMETRIC', 'GRIP'],
    jointStress: ['HIP', 'KNEE', 'LUMBAR_SPINE', 'WRIST'],
  },
  'Romanian Deadlift': {
    primaryMuscles: [MuscleGroup.HAMSTRINGS],
    secondaryMuscles: [MuscleGroup.GLUTES, MuscleGroup.LOWER_BACK, MuscleGroup.FOREARMS],
    movementPatterns: ['HIP_HINGE', 'TRUNK_STABILIZATION'],
    fatigueTags: ['SYSTEMIC_COMPOUND', 'AXIAL_LOAD', 'LUMBAR_ISOMETRIC', 'GRIP'],
    jointStress: ['HIP', 'KNEE', 'LUMBAR_SPINE', 'WRIST'],
  },
  Deadlift: {
    primaryMuscles: [MuscleGroup.BACK_THICKNESS],
    secondaryMuscles: [
      MuscleGroup.GLUTES,
      MuscleGroup.HAMSTRINGS,
      MuscleGroup.QUADS,
      MuscleGroup.LOWER_BACK,
      MuscleGroup.FOREARMS,
    ],
    movementPatterns: ['HIP_HINGE', 'TRUNK_STABILIZATION'],
    fatigueTags: ['SYSTEMIC_COMPOUND', 'AXIAL_LOAD', 'LUMBAR_ISOMETRIC', 'GRIP'],
    jointStress: ['HIP', 'KNEE', 'LUMBAR_SPINE', 'WRIST'],
  },
  'Barbell good morning': {
    primaryMuscles: [MuscleGroup.HAMSTRINGS],
    secondaryMuscles: [MuscleGroup.GLUTES, MuscleGroup.LOWER_BACK],
    movementPatterns: ['HIP_HINGE', 'TRUNK_STABILIZATION'],
    fatigueTags: ['SYSTEMIC_COMPOUND', 'AXIAL_LOAD', 'LUMBAR_ISOMETRIC'],
    jointStress: ['HIP', 'KNEE', 'LUMBAR_SPINE'],
  },
  'Barbell hip thrust (or machine)': {
    primaryMuscles: [MuscleGroup.GLUTES],
    secondaryMuscles: [MuscleGroup.HAMSTRINGS],
    movementPatterns: ['HIP_EXTENSION', 'HIP_HINGE'],
    fatigueTags: ['SYSTEMIC_COMPOUND'],
    jointStress: ['HIP', 'LUMBAR_SPINE'],
  },
  'Back extension (hyperextension)': {
    primaryMuscles: [MuscleGroup.LOWER_BACK],
    secondaryMuscles: [MuscleGroup.GLUTES, MuscleGroup.HAMSTRINGS],
    movementPatterns: ['HIP_HINGE', 'TRUNK_STABILIZATION'],
    fatigueTags: ['LUMBAR_ISOMETRIC'],
    jointStress: ['LUMBAR_SPINE', 'HIP'],
  },
};

export function catalogExerciseLoadProfile(
  name: string,
  muscleGroup: MuscleGroup,
  category: ExerciseCategory,
): ExerciseLoadProfile {
  const mapped = CORE_CATALOG_LOAD_PROFILES[name];
  if (mapped) {
    return reviewedExerciseLoadProfile({
      ...mapped,
      fatigueTags: mapped.fatigueTags ?? [],
      jointStress: mapped.jointStress ?? [],
      confidence: 'MEDIUM',
    });
  }

  if (category === ExerciseCategory.CARDIO) {
    return reviewedExerciseLoadProfile({
      primaryMuscles: null,
      secondaryMuscles: [],
      movementPatterns: ['CARDIO'],
      fatigueTags: null,
      jointStress: null,
      confidence: 'LOW',
    });
  }

  return reviewedExerciseLoadProfile({
    primaryMuscles: muscleGroup === MuscleGroup.OTHER ? null : [muscleGroup],
    secondaryMuscles: null,
    movementPatterns: null,
    fatigueTags: null,
    jointStress: null,
    confidence: muscleGroup === MuscleGroup.OTHER ? 'LOW' : 'MEDIUM',
  });
}

export function defaultExerciseLoadProfile(
  name: string,
  _muscleGroup: MuscleGroup,
  _category: ExerciseCategory,
): ExerciseLoadProfile {
  const mapped = CORE_CATALOG_LOAD_PROFILES[name];
  return mapped
    ? reviewedExerciseLoadProfile({
        ...mapped,
        fatigueTags: mapped.fatigueTags ?? [],
        jointStress: mapped.jointStress ?? [],
        confidence: 'MEDIUM',
      })
    : unclassifiedExerciseLoadProfile();
}
