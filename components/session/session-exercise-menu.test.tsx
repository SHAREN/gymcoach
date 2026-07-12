import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionExerciseMenu } from './session-exercise-menu';

vi.mock('@/components/shared/use-exercise-name', () => ({
  useExerciseName: () => (name: string) => name,
}));

const bench = {
  id: 'bench',
  name: 'Bench Press',
  muscleGroup: 'CHEST',
  category: 'COMPOUND',
  equipmentType: 'BARBELL',
  defaultRestSec: 120,
} as never;
const incline = {
  id: 'incline',
  name: 'Incline Press',
  muscleGroup: 'CHEST',
  category: 'COMPOUND',
  equipmentType: 'DUMBBELL',
  defaultRestSec: 120,
} as never;
const row = {
  id: 'row',
  name: 'Cable Row',
  muscleGroup: 'BACK_THICKNESS',
  category: 'COMPOUND',
  equipmentType: 'CABLE',
  defaultRestSec: 90,
} as never;

const current = {
  id: 'pe-bench',
  workoutId: 'workout-1',
  exerciseId: 'bench',
  order: 1,
  targetSets: 4,
  targetDropSets: 0,
  targetRepsMin: 8,
  targetRepsMax: 10,
  targetRIR: 2,
  restSec: 120,
  autoregulationMode: 'PRESERVE_RIR',
  fatigueRate: null,
  loadAdjustmentPct: null,
  tempo: null,
  notes: null,
  supersetGroup: null,
  exercise: bench,
};
const next = {
  ...current,
  id: 'pe-row',
  exerciseId: 'row',
  order: 2,
  exercise: row,
} as never;

function renderMenu(overrides: Partial<Parameters<typeof SessionExerciseMenu>[0]> = {}) {
  return render(
    <SessionExerciseMenu
      open
      onOpenChange={vi.fn()}
      programExercise={current as never}
      programExercises={[current, next] as never}
      catalog={[bench, incline, row] as never}
      loggedSetCount={0}
      onChanged={vi.fn()}
      onOpenHelp={vi.fn()}
      {...overrides}
    />,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: async () => current } as unknown as Response),
  );
});

describe('SessionExerciseMenu', () => {
  it('updates target sets through the existing program-exercise route', async () => {
    renderMenu();

    fireEvent.click(screen.getByRole('button', { name: '4 sets' }));
    fireEvent.click(screen.getByRole('button', { name: '5 sets' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe('/api/program-exercises/pe-bench');
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(init?.body as string)).toMatchObject({
      targetSets: 5,
      targetDropSets: 0,
      exerciseId: 'bench',
    });
  });

  it('filters replacement choices to the current primary muscle group', () => {
    renderMenu();

    fireEvent.click(screen.getByRole('button', { name: 'Replace' }));

    expect(screen.getByRole('button', { name: /Incline Press/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cable Row/ })).not.toBeInTheDocument();
  });

  it('links the current exercise with its next neighbor atomically', async () => {
    renderMenu();

    fireEvent.click(screen.getByRole('button', { name: 'Supersets' }));
    fireEvent.click(screen.getByRole('button', { name: 'Link with next: Cable Row' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe('/api/program-exercises/pe-bench/superset');
    expect(JSON.parse(init?.body as string)).toEqual({ action: 'link', neighborId: 'pe-row' });
  });
});
