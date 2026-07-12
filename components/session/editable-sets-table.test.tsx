import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditableSetsTable } from './editable-sets-table';
import type { PendingSet } from '@/lib/indexeddb';
import type { IntraSetRecommendation } from '@/lib/intra-set-autoregulation';

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
  targetDropSets: 0,
  exercise: { id: 'exercise-1', name: 'Squat', category: 'COMPOUND' },
} as never;
const completedSet: PendingSet = {
  localId: 'local-1',
  sessionId: 'session-1',
  exerciseId: 'exercise-1',
  setNumber: 1,
  weight: 100,
  reps: 10,
  rir: 2,
  durationSec: null,
  distanceM: null,
  notes: null,
  isWarmup: false,
  isDropSet: false,
  createdAt: Date.parse('2026-07-12T10:00:00.000Z'),
  status: 'synced',
  serverId: 'server-1',
  syncedAt: Date.parse('2026-07-12T10:00:00.000Z'),
  attempts: 0,
  lastError: null,
};
const completedSet2: PendingSet = {
  ...completedSet,
  localId: 'local-2',
  setNumber: 2,
  weight: 95,
  reps: 9,
  rir: 1,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

const recommendation: IntraSetRecommendation = {
  mode: 'PRESERVE_RIR',
  weight: 92.5,
  reps: 9,
  rir: 1,
  reason: 'adjust-reps',
  predictedRepsAtSameLoad: 9,
  fatigueLoss: 1,
  confidence: 'medium',
};

describe('EditableSetsTable', () => {
  it('uses compact responsive columns without horizontal scrolling', () => {
    render(
      <EditableSetsTable
        programExercise={programExercise}
        sets={[]}
        lastPerformance={undefined}
        readiness={null}
        deloadActive={false}
        unit="KG"
        onSubmit={vi.fn()}
        onUpdateSet={vi.fn()}
      />,
    );

    const table = screen.getByTestId('editable-sets-table');
    const header = screen.getByTestId('editable-sets-header');

    expect(table.querySelector('[class~="overflow-x-auto"]')).not.toBeInTheDocument();
    expect(table.querySelector('[class*="min-w-[31rem]"]')).not.toBeInTheDocument();
    expect(header).toHaveClass(
      'grid-cols-[1.5rem_minmax(0,1.05fr)_minmax(2.75rem,0.72fr)_minmax(2.5rem,0.65fr)_minmax(3.75rem,0.9fr)_2.75rem]',
      'sm:grid-cols-[2.25rem_minmax(5rem,1.05fr)_minmax(3.5rem,0.72fr)_minmax(3.25rem,0.65fr)_minmax(4.5rem,0.9fr)_3rem]',
    );
  });

  it('edits and confirms the active set row through the value pickers', async () => {
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
        onUpdateSet={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /weight/i }));
    let keypad = within(screen.getByTestId('set-value-keypad'));
    fireEvent.click(keypad.getByRole('button', { name: '1' }));
    fireEvent.click(keypad.getByRole('button', { name: '0' }));
    fireEvent.click(keypad.getByRole('button', { name: '0' }));
    fireEvent.click(screen.getByRole('button', { name: /apply value/i }));

    fireEvent.click(screen.getByRole('button', { name: /repetitions/i }));
    keypad = within(screen.getByTestId('set-value-keypad'));
    fireEvent.click(screen.getByRole('button', { name: /delete last digit/i }));
    fireEvent.click(screen.getByRole('button', { name: /delete last digit/i }));
    fireEvent.click(keypad.getByRole('button', { name: '1' }));
    fireEvent.click(keypad.getByRole('button', { name: '0' }));
    fireEvent.click(screen.getByRole('button', { name: /apply value/i }));
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

  it('fills the active table row from an explicitly requested AI parse', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          parsed: { kind: 'strength', weight: 100, reps: 8, rir: 2 },
        }),
      }),
    );
    render(
      <EditableSetsTable
        programExercise={programExercise}
        sets={[]}
        lastPerformance={undefined}
        readiness={null}
        deloadActive={false}
        unit="KG"
        onSubmit={vi.fn()}
        onUpdateSet={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Describe the set (AI)' }));
    fireEvent.change(screen.getByLabelText('Describe the set (AI)'), {
      target: { value: '100 kg for 8, 2 in the tank' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Parse with AI' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Set 1 weight in KG' })).toHaveTextContent('100'),
    );
    expect(screen.getByRole('button', { name: 'Set 1 repetitions' })).toHaveTextContent('8');
    expect(screen.getByRole('combobox', { name: 'Set 1 reps in reserve' })).toHaveValue('2');
  });

  it('applies the recommendation and restores it after a manual change or next set', async () => {
    const view = render(
      <EditableSetsTable
        programExercise={programExercise}
        sets={[completedSet]}
        lastPerformance={undefined}
        readiness={null}
        deloadActive={false}
        unit="KG"
        recommendation={recommendation}
        onSubmit={vi.fn()}
        onUpdateSet={vi.fn()}
      />,
    );

    const recommendationButton = screen.getByRole('button', {
      name: 'Apply recommendation to set 2',
    });
    expect(screen.getByTestId('set-recommendation-dot')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set 2 weight in KG' })).toHaveTextContent('100');

    fireEvent.click(recommendationButton);

    expect(screen.getByRole('button', { name: 'Set 2 weight in KG' })).toHaveTextContent('92.5');
    expect(screen.getByRole('button', { name: 'Set 2 repetitions' })).toHaveTextContent('9');
    expect(screen.getByRole('combobox', { name: 'Set 2 reps in reserve' })).toHaveValue('1');
    expect(screen.queryByTestId('set-recommendation-dot')).not.toBeInTheDocument();
    expect(recommendationButton).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Set 2 weight in KG' }));
    for (let index = 0; index < 4; index += 1) {
      fireEvent.click(screen.getByRole('button', { name: /delete last digit/i }));
    }
    const keypad = within(screen.getByTestId('set-value-keypad'));
    fireEvent.click(keypad.getByRole('button', { name: '9' }));
    fireEvent.click(keypad.getByRole('button', { name: '7' }));
    fireEvent.click(keypad.getByRole('button', { name: '.' }));
    fireEvent.click(keypad.getByRole('button', { name: '5' }));
    fireEvent.click(screen.getByRole('button', { name: /apply value/i }));

    expect(screen.getByTestId('set-recommendation-dot')).toBeInTheDocument();
    expect(recommendationButton).not.toBeDisabled();
    fireEvent.click(recommendationButton);
    expect(screen.getByRole('button', { name: 'Set 2 weight in KG' })).toHaveTextContent('92.5');

    const nextRecommendation = { ...recommendation, weight: 90, reps: 8, rir: 2 };
    view.rerender(
      <EditableSetsTable
        programExercise={programExercise}
        sets={[completedSet, completedSet2]}
        lastPerformance={undefined}
        readiness={null}
        deloadActive={false}
        unit="KG"
        recommendation={nextRecommendation}
        onSubmit={vi.fn()}
        onUpdateSet={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Apply recommendation to set 3' })).toBeEnabled(),
    );
    expect(screen.getByTestId('set-recommendation-dot')).toBeInTheDocument();
  });

  it('saves completed-set edits immediately without a row confirmation button', async () => {
    const onUpdateSet = vi.fn().mockResolvedValue(undefined);
    render(
      <EditableSetsTable
        programExercise={programExercise}
        sets={[completedSet]}
        lastPerformance={undefined}
        readiness={null}
        deloadActive={false}
        unit="KG"
        onSubmit={vi.fn()}
        onUpdateSet={onUpdateSet}
      />,
    );

    expect(screen.queryByRole('button', { name: /delete set 1/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /save changes to set 1/i }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Set 1 weight in KG' }));
    for (let index = 0; index < 3; index += 1) {
      fireEvent.click(screen.getByRole('button', { name: /delete last digit/i }));
    }
    let keypad = within(screen.getByTestId('set-value-keypad'));
    fireEvent.click(keypad.getByRole('button', { name: '9' }));
    fireEvent.click(keypad.getByRole('button', { name: '5' }));
    fireEvent.click(screen.getByRole('button', { name: /apply value/i }));

    await waitFor(() =>
      expect(onUpdateSet).toHaveBeenLastCalledWith(completedSet, {
        weight: 95,
        reps: 10,
        rir: 2,
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Set 1 repetitions' }));
    for (let index = 0; index < 2; index += 1) {
      fireEvent.click(screen.getByRole('button', { name: /delete last digit/i }));
    }
    keypad = within(screen.getByTestId('set-value-keypad'));
    fireEvent.click(keypad.getByRole('button', { name: '9' }));
    fireEvent.click(screen.getByRole('button', { name: /apply value/i }));

    await waitFor(() =>
      expect(onUpdateSet).toHaveBeenLastCalledWith(completedSet, {
        weight: 95,
        reps: 9,
        rir: 2,
      }),
    );

    fireEvent.change(screen.getByRole('combobox', { name: 'Set 1 reps in reserve' }), {
      target: { value: '1' },
    });

    await waitFor(() =>
      expect(onUpdateSet).toHaveBeenLastCalledWith(completedSet, {
        weight: 95,
        reps: 9,
        rir: 1,
      }),
    );
    expect(
      screen.queryByRole('button', { name: /save changes to set 1/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm set 2' })).toBeInTheDocument();
  });

  it('prefills active and upcoming rows from matching previous-session sets', () => {
    render(
      <EditableSetsTable
        programExercise={programExercise}
        sets={[]}
        lastPerformance={{
          sessionId: 'previous-session',
          sessionStartedAt: '2026-07-01T10:00:00.000Z',
          sets: [
            { weight: 27.25, reps: 12, rir: 2 },
            { weight: 27.25, reps: 10, rir: 1 },
            { weight: 25, reps: 9, rir: 0 },
          ],
          maxWeight: 27.25,
          repsAtMaxWeight: 12,
          cardio: null,
        }}
        readiness={null}
        deloadActive={false}
        unit="KG"
        onSubmit={vi.fn()}
        onUpdateSet={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /weight/i })).toHaveTextContent('27.25');
    expect(screen.getByRole('button', { name: /repetitions/i })).toHaveTextContent('12');
    expect(screen.getByText('25 kg')).toBeInTheDocument();
  });

  it('prefills a conservative return load instead of copying stale history', () => {
    render(
      <EditableSetsTable
        programExercise={{ ...(programExercise as object), targetSets: 2, targetRIR: 3 } as never}
        sets={[]}
        lastPerformance={{
          sessionId: 'stale-session',
          sessionStartedAt: '2026-05-01T10:00:00.000Z',
          sets: [{ weight: 19, reps: 10, rir: 1 }],
          maxWeight: 19,
          repsAtMaxWeight: 10,
          cardio: null,
        }}
        returnRecommendation={{
          mode: 'exercise-reintro',
          exerciseGapDays: 60,
          muscleGapDays: 5,
          muscleMaintained: true,
          recentMuscleSets: 12,
          baselineMuscleSetsPer28Days: 12,
          recentVolumeRatio: 1,
          targetSets: 2,
          targetRIR: 3,
          weightCeiling: 19,
          suggestedWeight: 16,
          calibrationRequired: true,
          historySessionCount: 3,
        }}
        readiness={null}
        deloadActive={false}
        unit="KG"
        onSubmit={vi.fn()}
        onUpdateSet={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Set 1 weight in KG' })).toHaveTextContent('16');
    expect(screen.getByRole('button', { name: 'Set 1 repetitions' })).toHaveTextContent('8');
    expect(screen.getByRole('combobox', { name: 'Set 1 reps in reserve' })).toHaveValue('3');
  });

  it('adds planned drop-set rows after the regular working sets', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <EditableSetsTable
        programExercise={
          { ...(programExercise as object), targetSets: 1, targetDropSets: 1 } as never
        }
        sets={[completedSet]}
        lastPerformance={undefined}
        readiness={null}
        deloadActive={false}
        unit="KG"
        onSubmit={onSubmit}
        onUpdateSet={vi.fn()}
      />,
    );

    expect(screen.getByTitle('Drop set 2')).toBeInTheDocument();
    expect(screen.queryByTestId('apply-set-recommendation')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm set 2' }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          weight: 80,
          reps: 10,
          rir: 0,
          isDropSet: true,
        }),
      ),
    );
  });
});
