import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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

  it('edits an existing strength row without changing its identity', async () => {
    const user = userEvent.setup();
    const set = pendingSet({ localId: 'row-1', serverId: 'server-1', weight: 100, reps: 5, rir: 2 });
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
});
