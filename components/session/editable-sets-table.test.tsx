import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EditableSetsTable } from './editable-sets-table';

vi.mock('@/lib/preferences', async () => {
  const actual = await vi.importActual<typeof import('@/lib/preferences')>('@/lib/preferences');
  return {
    ...actual,
    loadPreferences: () => ({ ...actual.DEFAULT_PREFERENCES, rmDisplay: '1RM' }),
  };
});

const programExercise = {
  id: 'pe-1',
  exerciseId: 'exercise-1',
  targetSets: 3,
  targetRepsMin: 8,
  targetRepsMax: 12,
  targetRIR: 2,
  exercise: { id: 'exercise-1', name: 'Squat', category: 'COMPOUND' },
} as never;

describe('EditableSetsTable', () => {
  it('edits and confirms the active set row', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <EditableSetsTable
        programExercise={programExercise}
        sets={[]}
        lastPerformance={undefined}
        readiness={null}
        deloadActive={false}
        unit="KG"
        onSubmit={onSubmit}
        onDeleteSet={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByRole('spinbutton', { name: /weight/i }), {
      target: { value: '100' },
    });
    fireEvent.change(screen.getByRole('spinbutton', { name: /repetitions/i }), {
      target: { value: '10' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: /reps in reserve/i }), {
      target: { value: '1' },
    });

    expect(screen.getByText('133.3 kg')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /confirm set 1/i }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        weight: 100,
        reps: 10,
        rir: 1,
        durationSec: null,
        distanceM: null,
        isWarmup: false,
        isDropSet: false,
        notes: null,
      }),
    );
  });
});
