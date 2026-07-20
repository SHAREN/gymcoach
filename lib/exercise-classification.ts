import { EquipmentType, ExerciseCategory, MuscleGroup } from '@/lib/prisma-client';
import {
  EXERCISE_CATALOG,
  SYSTEM_EXERCISE_CATALOG_ORIGIN,
  type CatalogExercise,
} from '@/lib/exercise-catalog';
import {
  legacyPrimaryExerciseLoadProfile,
  unclassifiedExerciseLoadProfile,
  type ExerciseLoadProfile,
} from '@/lib/schemas/exercise-load-profile';

export interface ExerciseClassificationIdentity {
  name: string;
  muscleGroup: MuscleGroup;
  category: ExerciseCategory;
  defaultRestSec: number;
  notes?: string | null;
  usesBodyweight: boolean;
  equipmentType: EquipmentType;
}

export interface ServerExerciseClassificationMetadata {
  catalogOrigin: typeof SYSTEM_EXERCISE_CATALOG_ORIGIN | null;
  loadProfile: ExerciseLoadProfile;
}

export function clientExerciseClassificationMetadata(): ServerExerciseClassificationMetadata {
  return {
    catalogOrigin: null,
    loadProfile: unclassifiedExerciseLoadProfile(),
  };
}

export function classificationMetadataAfterClientUpdate(
  current: ExerciseClassificationIdentity,
  next: ExerciseClassificationIdentity,
): Partial<ServerExerciseClassificationMetadata> {
  return exerciseClassificationIdentityChanged(current, next)
    ? clientExerciseClassificationMetadata()
    : {};
}

export function exerciseClassificationIdentityChanged(
  current: ExerciseClassificationIdentity,
  next: ExerciseClassificationIdentity,
): boolean {
  return (
    current.name !== next.name ||
    current.muscleGroup !== next.muscleGroup ||
    current.category !== next.category ||
    current.defaultRestSec !== next.defaultRestSec ||
    (current.notes ?? null) !== (next.notes ?? null) ||
    current.usesBodyweight !== next.usesBodyweight ||
    current.equipmentType !== next.equipmentType
  );
}

export function deriveBackupExerciseClassification(
  input: ExerciseClassificationIdentity & {
    loadProfile?: ExerciseLoadProfile;
  },
): ServerExerciseClassificationMetadata {
  const catalogExercise = findCatalogExerciseByFingerprint(input);
  if (catalogExercise) {
    return {
      catalogOrigin: SYSTEM_EXERCISE_CATALOG_ORIGIN,
      loadProfile: catalogExercise.loadProfile,
    };
  }

  if (input.loadProfile?.classification === 'LEGACY_PRIMARY_ONLY') {
    return {
      catalogOrigin: null,
      loadProfile: legacyPrimaryExerciseLoadProfile(input.muscleGroup),
    };
  }

  if (input.loadProfile) return clientExerciseClassificationMetadata();

  return {
    catalogOrigin: null,
    loadProfile: legacyPrimaryExerciseLoadProfile(input.muscleGroup),
  };
}

export function findCatalogExerciseByFingerprint(
  input: ExerciseClassificationIdentity,
): CatalogExercise | null {
  return (
    EXERCISE_CATALOG.find(
      (catalogExercise) =>
        catalogExercise.name === input.name &&
        catalogExercise.muscleGroup === input.muscleGroup &&
        catalogExercise.category === input.category &&
        catalogExercise.defaultRestSec === input.defaultRestSec &&
        (catalogExercise.notes ?? null) === (input.notes ?? null) &&
        (catalogExercise.usesBodyweight ?? false) === input.usesBodyweight &&
        catalogEquipmentTypes(catalogExercise).has(input.equipmentType),
    ) ?? null
  );
}

function catalogEquipmentTypes(catalogExercise: CatalogExercise): Set<EquipmentType> {
  return new Set<EquipmentType>([
    EquipmentType.OTHER,
    deterministicLegacyEquipmentType(catalogExercise),
  ]);
}

function deterministicLegacyEquipmentType(
  exercise: Pick<CatalogExercise, 'name' | 'category' | 'usesBodyweight'>,
): EquipmentType {
  if (exercise.category === ExerciseCategory.CARDIO) return EquipmentType.CARDIO;
  if (exercise.usesBodyweight) return EquipmentType.BODYWEIGHT;

  const name = exercise.name.toLowerCase();
  if (name.includes('barbell')) return EquipmentType.BARBELL;
  if (name.includes('machine') || name.includes('leg press')) return EquipmentType.MACHINE;
  if (name.includes('cable') || name.includes('pulldown') || name.includes('pushdown')) {
    return EquipmentType.CABLE;
  }
  if (name.includes('dumbbell')) return EquipmentType.DUMBBELL;
  return EquipmentType.OTHER;
}
