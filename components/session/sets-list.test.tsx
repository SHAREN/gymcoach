import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Exercise, ProgramExercise } from '@/lib/prisma-client';
import type { PendingSet } from '@/lib/indexeddb';
import { SetsList } from './sets-list';

const exo: Exercise = {
  id: 'e1',
  userId: 'u',
  name: 'Squat',
  muscleGroup: 'QUADS',
  category: 'COMPOUND',
  defaultRestSec: 120,
  notes: null,
  usesBodyweight: false,
  equipmentType: 'BARBELL',
  catalogOrigin: null,
  loadProfile: {},
  createdAt: new Date(),
};

const pe: ProgramExercise & { exercise: Exercise } = {
  id: 'pe',
  workoutId: 'w',
  exerciseId: 'e1',
  order: 1,
  targetSets: 3,
  targetRepsMin: 6,
  targetRepsMax: 10,
  targetRIR: 2,
  restSec: 120,
  tempo: null,
  notes: null,
  supersetGroup: null,
  autoregulationMode: 'PRESERVE_RIR',
  fatigueRate: null,
  loadAdjustmentPct: null,
  exercise: exo,
};

function pendingSet(over: Partial<PendingSet>): PendingSet {
  return {
    localId: over.localId ?? 'l1',
    sessionId: 's1',
    exerciseId: 'e1',
    setNumber: over.setNumber ?? 1,
    weight: over.weight ?? 100,
    reps: over.reps ?? 5,
    rir: null,
    notes: null,
    isWarmup: over.isWarmup ?? false,
    isDropSet: false,
    createdAt: 0,
    status: 'synced',
    serverId: 'srv1',
    syncedAt: 0,
    attempts: 0,
    lastError: null,
    ...over,
  };
}

describe('SetsList', () => {
  it('shows a weight PR badge when a logged set beats the prior best load', () => {
    render(
      <SetsList
        programExercise={pe}
        sets={[pendingSet({ localId: 'a', setNumber: 1, weight: 110, reps: 5 })]}
        isInputActive={false}
        unit="KG"
        onDeleteSet={() => {}}
        priorSets={[{ weight: 100, reps: 5 }]}
      />,
    );
    expect(screen.getByText('Weight PR')).toBeTruthy();
  });

  it('does not show a PR badge when the set ties the prior best', () => {
    render(
      <SetsList
        programExercise={pe}
        sets={[pendingSet({ localId: 'a', setNumber: 1, weight: 100, reps: 5 })]}
        isInputActive={false}
        unit="KG"
        onDeleteSet={() => {}}
        priorSets={[{ weight: 100, reps: 5 }]}
      />,
    );
    expect(screen.queryByText('Weight PR')).toBeNull();
    expect(screen.queryByText('e1RM PR')).toBeNull();
  });

  it('switches between 1RM and 10RM while keeping volume independently selectable', async () => {
    window.localStorage.clear();
    const user = userEvent.setup();
    render(
      <SetsList
        programExercise={pe}
        sets={[pendingSet({ localId: 'metric', setNumber: 1, weight: 100, reps: 10 })]}
        isInputActive
        unit="KG"
        onDeleteSet={() => {}}
      />,
    );

    expect(screen.getByTestId('set-metric-selection')).toHaveTextContent('1RM');
    expect(screen.getByTestId('completed-set-1-metric-1RM')).toHaveTextContent('133.3');

    await user.click(screen.getByRole('button', { name: 'Choose set metrics' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Volume' }));
    expect(screen.getByTestId('completed-set-1-metric-VOLUME')).toHaveTextContent('1000');

    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Estimated 10RM' }));
    expect(screen.queryByTestId('completed-set-1-metric-1RM')).not.toBeInTheDocument();
    expect(screen.getByTestId('completed-set-1-metric-10RM')).toHaveTextContent('100');
    expect(screen.getByTestId('completed-set-1-metric-VOLUME')).toHaveTextContent('1000');
  });

  it('edits an existing strength row without changing its identity', async () => {
    const user = userEvent.setup();
    const set = pendingSet({
      localId: 'row-1',
      serverId: 'server-1',
      weight: 100,
      reps: 5,
      rir: 2,
    });
    const onEditSet = vi.fn().mockResolvedValue(undefined);
    render(
      <SetsList
        programExercise={pe}
        sets={[set]}
        isInputActive
        unit="KG"
        onDeleteSet={() => {}}
        onEditSet={onEditSet}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Edit the set' }));
    await user.click(screen.getByRole('button', { name: '5' }));
    await user.click(screen.getByRole('button', { name: '8 reps' }));
    await user.click(screen.getByRole('button', { name: 'Apply value' }));
    await user.selectOptions(screen.getByRole('combobox'), '1');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onEditSet).toHaveBeenCalledWith(set, { weight: 100, reps: 8, rir: 1 });
  });
  it('renders the current working input inside the active set row', () => {
    render(
      <SetsList
        programExercise={pe}
        sets={[]}
        isInputActive
        unit="KG"
        onDeleteSet={() => {}}
        currentInput={<button type="button">Draft control</button>}
      />,
    );

    const row = screen.getByTestId('current-set-row');
    expect(within(row).getByText('Set 1 · in progress')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Draft control' })).toBeInTheDocument();
  });

  it('offers an explicit undo for the latest completed set', async () => {
    const user = userEvent.setup();
    const onUndoLastSet = vi.fn().mockResolvedValue(undefined);
    render(
      <SetsList
        programExercise={pe}
        sets={[pendingSet({ localId: 'undo-me', setNumber: 1 })]}
        isInputActive
        unit="KG"
        onDeleteSet={() => {}}
        onUndoLastSet={onUndoLastSet}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Undo last set' }));
    expect(onUndoLastSet).toHaveBeenCalledTimes(1);
  });
  it('keeps all planned working rows when a warmup is present', () => {
    render(
      <SetsList
        programExercise={pe}
        sets={[pendingSet({ localId: 'warmup', setNumber: 1, isWarmup: true })]}
        isInputActive
        unit="KG"
        onDeleteSet={() => {}}
        currentInput={<button type="button">Working draft</button>}
      />,
    );

    expect(screen.getByTestId('current-set-row')).toHaveTextContent('Set 1 · in progress');
    expect(screen.getByText('Set 2 · upcoming')).toBeInTheDocument();
    expect(screen.getByText('Set 3 · upcoming')).toBeInTheDocument();
  });

  it('does not create an extra active row after all planned working sets are complete', () => {
    render(
      <SetsList
        programExercise={pe}
        sets={[
          pendingSet({ localId: 's1', setNumber: 1 }),
          pendingSet({ localId: 's2', setNumber: 2 }),
          pendingSet({ localId: 's3', setNumber: 3 }),
        ]}
        isInputActive
        unit="KG"
        onDeleteSet={() => {}}
        currentInput={<button type="button">Should not render</button>}
      />,
    );

    expect(screen.queryByTestId('current-set-row')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Should not render' })).not.toBeInTheDocument();
  });

  it('hides undo while the session is in rest mode', () => {
    render(
      <SetsList
        programExercise={pe}
        sets={[pendingSet({ localId: 'rest-set', setNumber: 1 })]}
        isInputActive={false}
        unit="KG"
        onDeleteSet={() => {}}
        onUndoLastSet={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Undo last set' })).not.toBeInTheDocument();
  });
});
