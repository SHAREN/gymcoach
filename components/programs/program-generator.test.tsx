import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProgramGenerator } from './program-generator';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ProgramGenerator', () => {
  it('shows drop sets and clears stale validation after editing the draft', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: 'generated',
          methodologyVersion: 'test',
          sourceProgramId: null,
          validation: {
            valid: false,
            issues: [
              {
                code: 'equipment-unavailable',
                severity: 'error',
                message: 'Exercise is unavailable.',
              },
            ],
            weeklySetsByMuscle: { CHEST: 5 },
            frequencyByMuscle: { CHEST: 1 },
            estimatedSessionMinutes: [],
          },
          program: {
            name: 'Draft',
            phase: 'Hypertrophy',
            workouts: [
              {
                name: 'Push',
                exercises: [
                  {
                    name: 'Bench press',
                    muscleGroup: 'CHEST',
                    category: 'COMPOUND',
                    equipmentType: 'BARBELL',
                    targetSets: 3,
                    targetDropSets: 2,
                    targetRepsMin: 6,
                    targetRepsMax: 10,
                    targetRIR: 2,
                    restSec: 150,
                  },
                ],
              },
            ],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    render(<ProgramGenerator />);
    await user.type(
      screen.getByPlaceholderText(/Hypertrophy, 4 sessions\/week/i),
      'Build a balanced hypertrophy program',
    );
    await user.click(screen.getByRole('button', { name: /Generate/i }));

    const dropSetsLabel = await screen.findByText('Drop sets');
    expect(dropSetsLabel.parentElement?.querySelector('input')).toHaveValue(2);
    const save = screen.getByRole('button', { name: /Create program/i });
    expect(save).toBeDisabled();

    const exerciseName = screen.getByDisplayValue('Bench press');
    await user.clear(exerciseName);
    await user.type(exerciseName, 'Barbell bench press');

    await waitFor(() => expect(save).toBeEnabled());
    expect(screen.queryByText('Exercise is unavailable.')).not.toBeInTheDocument();
  });
});
