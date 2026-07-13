import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

  it('opens set controls from the first header and hides undo before the first set', async () => {
    const onTargetSetsChange = vi.fn().mockResolvedValue(undefined);
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
        onTargetSetsChange={onTargetSetsChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Adjust set count' }));

    expect(screen.getByTestId('set-controls-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('set-count-value')).toHaveTextContent('3');
    expect(screen.queryByRole('button', { name: 'Undo last set' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Increase total sets' }));
    await waitFor(() => expect(onTargetSetsChange).toHaveBeenCalledWith(4));
  });

  it('uses grey completed-row checks to undo only the latest completed set', async () => {
    const onDeleteSet = vi.fn().mockResolvedValue(true);
    render(
      <EditableSetsTable
        programExercise={{ ...(programExercise as object), targetSets: 2 } as never}
        sets={[completedSet, completedSet2]}
        lastPerformance={undefined}
        readiness={null}
        deloadActive={false}
        unit="KG"
        onSubmit={vi.fn()}
        onUpdateSet={vi.fn()}
        onDeleteSet={onDeleteSet}
        onTargetSetsChange={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    const firstCompletedCheck = screen.getByRole('button', {
      name: 'Open set controls after set 1',
    });
    expect(firstCompletedCheck).toHaveClass('text-muted-foreground/60');
    expect(
      screen.getByRole('button', { name: 'Open set controls after set 2' }),
    ).toBeInTheDocument();

    fireEvent.click(firstCompletedCheck);

    expect(screen.getByTestId('set-count-value')).toHaveTextContent('2');
    expect(screen.getByRole('button', { name: 'Decrease total sets' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Undo last set' }));

    await waitFor(() => expect(onDeleteSet).toHaveBeenCalledWith(completedSet2));
    await waitFor(() =>
      expect(screen.queryByTestId('set-controls-dialog')).not.toBeInTheDocument(),
    );
  });

  it('shows volume alone or paired with one rep-max estimate', async () => {
    const user = userEvent.setup();
    render(
      <EditableSetsTable
        programExercise={programExercise}
        sets={[completedSet]}
        lastPerformance={undefined}
        readiness={null}
        deloadActive={false}
        unit="KG"
        onSubmit={vi.fn()}
        onUpdateSet={vi.fn()}
      />,
    );

    const openSelector = screen.getByRole('button', { name: 'Choose calculated columns' });
    await user.click(openSelector);
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'Volume' }));

    expect(screen.getByTestId('set-metric-header-1RM')).toBeInTheDocument();
    expect(screen.getByTestId('set-metric-header-VOLUME')).toBeInTheDocument();
    expect(screen.getByTestId('completed-set-1-metric-VOLUME')).toHaveTextContent('1000');
    expect(screen.getByTestId('editable-sets-header')).toHaveClass(
      'grid-cols-[1.35rem_minmax(0,0.95fr)_minmax(2.35rem,0.68fr)_minmax(2.1rem,0.58fr)_minmax(2.5rem,0.72fr)_minmax(2.5rem,0.72fr)_2.5rem]',
    );

    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Estimated 10RM' }));
    expect(screen.queryByTestId('set-metric-header-1RM')).not.toBeInTheDocument();
    expect(screen.getByTestId('set-metric-header-10RM')).toBeInTheDocument();
    expect(screen.getByTestId('set-metric-header-VOLUME')).toBeInTheDocument();
    expect(screen.getByTestId('completed-set-1-metric-10RM')).toHaveTextContent('100');

    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Volume' }));
    expect(screen.queryByTestId('set-metric-header-VOLUME')).not.toBeInTheDocument();
    expect(screen.getByTestId('editable-sets-header')).toHaveClass(
      'grid-cols-[1.5rem_minmax(0,1.05fr)_minmax(2.75rem,0.72fr)_minmax(2.5rem,0.65fr)_minmax(3.75rem,0.9fr)_2.75rem]',
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

    fireEvent.click(screen.getByRole('button', { name: 'Set 1 weight in KG' }));
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

    expect(screen.getByTestId('active-set-metric-1RM')).toHaveTextContent('133.3');
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

    expect(screen.getByRole('button', { name: 'Set 1 weight in KG' })).toHaveTextContent('27.25');
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

  it('normalizes the active draft when the gym inventory changes', () => {
    const lastPerformance = {
      sessionStartedAt: '2026-07-10T10:00:00.000Z',
      sets: [{ weight: 15, reps: 10, rir: 2 }],
      maxWeight: 15,
      repsAtMaxWeight: 10,
      cardio: null,
    } as never;
    const props = {
      programExercise,
      sets: [],
      lastPerformance,
      readiness: null,
      deloadActive: false,
      unit: 'KG' as const,
      onSubmit: vi.fn(),
      onUpdateSet: vi.fn(),
    };
    const { rerender } = render(
      <EditableSetsTable
        {...props}
        loadConstraints={{ equipmentType: 'DUMBBELL', dumbbellWeights: [10, 15] }}
      />,
    );

    expect(screen.getByRole('button', { name: 'Set 1 weight in KG' })).toHaveTextContent('15');
    rerender(
      <EditableSetsTable
        {...props}
        loadConstraints={{ equipmentType: 'DUMBBELL', dumbbellWeights: [10, 14] }}
      />,
    );

    expect(screen.getByRole('button', { name: 'Set 1 weight in KG' })).toHaveTextContent('14');
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
