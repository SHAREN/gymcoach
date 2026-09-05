import type { EquipmentType, MuscleGroup } from '@/lib/prisma-client';

export interface FilterableExercise {
  id: string;
  name: string;
  muscleGroup: MuscleGroup;
  equipmentType: EquipmentType;
}

export interface ExerciseFilterCriteria {
  query?: string;
  muscleGroup?: MuscleGroup | null;
  equipmentType?: EquipmentType | null;
  excludedExerciseIds?: ReadonlySet<string>;
  unavailableExerciseIds?: ReadonlySet<string>;
}

export function filterExercises<T extends FilterableExercise>(
  exercises: readonly T[],
  criteria: ExerciseFilterCriteria,
  localizeName: (name: string) => string = (name) => name,
): T[] {
  const normalizedQuery = criteria.query?.trim().toLocaleLowerCase() ?? '';

  return exercises.filter((exercise) => {
    if (criteria.excludedExerciseIds?.has(exercise.id)) return false;
    if (criteria.unavailableExerciseIds?.has(exercise.id)) return false;
    if (criteria.muscleGroup && exercise.muscleGroup !== criteria.muscleGroup) return false;
    if (criteria.equipmentType && exercise.equipmentType !== criteria.equipmentType) return false;
    if (!normalizedQuery) return true;

    return (
      exercise.name.toLocaleLowerCase().includes(normalizedQuery) ||
      localizeName(exercise.name).toLocaleLowerCase().includes(normalizedQuery)
    );
  });
}
