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
  it('allows an empty request goal so the server can use the saved profile goal', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: 'needs-input',
          questions: [],
          methodologyVersion: 'test',
          sourceProgramId: null,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    render(<ProgramGenerator />);

    const generate = screen.getByRole('button', { name: /Generate/i });
    expect(generate).toBeEnabled();
    await user.click(generate);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { goal: string };
    expect(body.goal).toBe('');
  });

  it('submits request limitation names as deterministic exercise exclusions', async () => {
    const user = userEvent.setup();
    const needsLimitations = {
      status: 'needs-input',
      questions: [
        {
          id: 'limitations',
          prompt: 'Name current constraints and every affected exercise.',
          input: 'text',
          required: true,
        },
      ],
      methodologyVersion: 'test',
      sourceProgramId: null,
    };
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify(needsLimitations), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(needsLimitations), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    render(<ProgramGenerator />);
    await user.click(screen.getByRole('button', { name: /Generate/i }));

    await user.type(
      await screen.findByLabelText('Training movement or load constraints'),
      'Self-reported request constraint',
    );
    await user.type(
      screen.getByLabelText('Affected exercise names'),
      'Bench press, Overhead press, bench PRESS',
    );
    await user.click(screen.getByRole('button', { name: /Generate/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const body = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as {
      answers: { limitations: string; excludedExercises: string[] };
    };
    expect(body.answers.limitations).toBe('Self-reported request constraint');
    expect(body.answers.excludedExercises).toEqual(['Bench press', 'Overhead press']);
  });

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
