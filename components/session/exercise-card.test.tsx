import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Exercise, ProgramExercise } from '@/lib/prisma-client';
import { ExerciseCard } from './exercise-card';

const importedNote =
  '[alpha-progression-2026-07-10] Imported from Alpha Progression. Original exercise: Incline Bench Press.';

const exercise: Exercise = {
  id: 'e1',
  userId: 'u1',
  name: 'An exceptionally long incline dumbbell press exercise name',
  muscleGroup: 'CHEST',
  category: 'COMPOUND',
  defaultRestSec: 120,
  notes: importedNote,
  usesBodyweight: false,
  equipmentType: 'DUMBBELL',
  createdAt: new Date(),
};

const programExercise: ProgramExercise & { exercise: Exercise } = {
  id: 'pe1',
  workoutId: 'w1',
  exerciseId: exercise.id,
  order: 1,
  targetSets: 5,
  targetRepsMin: 10,
  targetRepsMax: 10,
  targetRIR: 2,
  restSec: 120,
  tempo: null,
  notes: 'Keep the chest lifted and control the lowering phase.',
  supersetGroup: null,
  autoregulationMode: 'PRESERVE_RIR',
  fatigueRate: null,
  loadAdjustmentPct: null,
  exercise,
};

describe('ExerciseCard', () => {
  it('keeps the title on one scrollable line and removes repeated session details', () => {
    render(<ExerciseCard programExercise={programExercise} />);

    expect(screen.getByTestId('exercise-title-scroll')).toHaveClass('overflow-x-auto');
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: 'An exceptionally long incline dumbbell press exercise name',
      }),
    ).toHaveClass('w-max', 'whitespace-nowrap');

    expect(screen.queryByRole('button', { name: /technique/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Chest')).not.toBeInTheDocument();
    expect(screen.queryByText('Compound')).not.toBeInTheDocument();
    expect(screen.queryByText(importedNote)).not.toBeInTheDocument();
    expect(screen.queryByText(/Last session/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Suggestion:/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/5 sets × 10 reps · RIR 2 · Rest 120s/i)).not.toBeInTheDocument();
  });

  it('keeps workout notes collapsible and shows only relevant gym context', () => {
    render(
      <ExerciseCard
        programExercise={programExercise}
        gymName="Olimp"
        loadConstraints={{ isAvailable: false } as never}
      />,
    );

    expect(screen.getByText('Olimp')).toBeInTheDocument();
    expect(screen.getByText('Not available in this gym')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Notes \/ mind-muscle cue/i }));
    expect(screen.getByText(programExercise.notes!)).toBeInTheDocument();
  });
});
