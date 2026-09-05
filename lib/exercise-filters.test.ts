import { describe, expect, it } from 'vitest';
import type { EquipmentType, MuscleGroup } from '@/lib/prisma-client';
import { filterExercises } from './exercise-filters';

interface ExerciseStub {
  id: string;
  name: string;
  muscleGroup: MuscleGroup;
  equipmentType: EquipmentType;
}

const exercises: ExerciseStub[] = [
  { id: 'bench', name: 'Bench Press', muscleGroup: 'CHEST', equipmentType: 'BARBELL' },
  { id: 'fly', name: 'Cable Fly', muscleGroup: 'CHEST', equipmentType: 'CABLE' },
  { id: 'row', name: 'Cable Row', muscleGroup: 'BACK_THICKNESS', equipmentType: 'CABLE' },
];

describe('filterExercises', () => {
  it('returns the full list when every optional filter is cleared', () => {
    expect(filterExercises(exercises, {})).toEqual(exercises);
  });

  it('composes muscle, equipment and localized-name search', () => {
    expect(
      filterExercises(
        exercises,
        { query: 'блочная', muscleGroup: 'CHEST', equipmentType: 'CABLE' },
        (name) => (name === 'Cable Fly' ? 'Блочная сводка' : name),
      ),
    ).toEqual([exercises[1]]);
  });

  it('applies unavailable and excluded exercise sets before search', () => {
    expect(
      filterExercises(exercises, {
        query: 'cable',
        excludedExerciseIds: new Set(['fly']),
        unavailableExerciseIds: new Set(['row']),
      }),
    ).toEqual([]);
  });
});
