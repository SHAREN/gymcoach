import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionExerciseMenu } from './session-exercise-menu';

vi.mock('@/components/shared/use-exercise-name', () => ({
  useExerciseName: () => (name: string) => name,
}));

Element.prototype.hasPointerCapture = vi.fn(() => false);
Element.prototype.setPointerCapture = vi.fn();
Element.prototype.releasePointerCapture = vi.fn();
Element.prototype.scrollIntoView = vi.fn();
vi.stubGlobal(
  'ResizeObserver',
  class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

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

  it('defaults replacement to the current muscle and all equipment', () => {
    renderMenu();

    fireEvent.click(screen.getByRole('button', { name: 'Replace' }));

    expect(screen.getByRole('combobox', { name: 'Muscle group' })).toHaveTextContent('Chest');
    expect(screen.getByRole('combobox', { name: 'Equipment type' })).toHaveTextContent(
      'All equipment',
    );
    expect(screen.getByRole('button', { name: /Incline Press/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cable Row/ })).not.toBeInTheDocument();
  });

  it('changes, clears and composes replacement filters with search', async () => {
    const user = userEvent.setup({ delay: null });
    renderMenu();

    await user.click(screen.getByRole('button', { name: 'Replace' }));
    await user.click(screen.getByRole('combobox', { name: 'Muscle group' }));
    await user.click(screen.getByRole('option', { name: 'All muscles' }));
    await user.click(screen.getByRole('combobox', { name: 'Equipment type' }));
    await user.click(screen.getByRole('option', { name: 'Cable stack' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search exercises' }), 'row');

    expect(screen.getByRole('button', { name: /Cable Row/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Incline Press/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Bench Press/ })).not.toBeInTheDocument();

    await user.clear(screen.getByRole('searchbox', { name: 'Search exercises' }));
    await user.click(screen.getByRole('button', { name: 'Reset filters' }));

    expect(screen.getByRole('button', { name: /Incline Press/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cable Row/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Bench Press/ })).not.toBeInTheDocument();
  });

  it('resets replacement filters after leaving and reopening the picker', async () => {
    const user = userEvent.setup({ delay: null });
    renderMenu();

    await user.click(screen.getByRole('button', { name: 'Replace' }));
    await user.click(screen.getByRole('combobox', { name: 'Muscle group' }));
    await user.click(screen.getByRole('option', { name: 'All muscles' }));
    await user.click(screen.getByRole('button', { name: 'Replace' }));
    await user.click(screen.getByRole('button', { name: 'Replace' }));

    expect(screen.getByRole('combobox', { name: 'Muscle group' })).toHaveTextContent('Chest');
    expect(screen.getByRole('combobox', { name: 'Equipment type' })).toHaveTextContent(
      'All equipment',
    );
  });

  it('shows a compact accessible trained-day count for replacement choices', () => {
    renderMenu({
      trainingDatesByExercise: {
        incline: [
          '2026-07-01T08:00:00.000Z',
          '2026-07-01T18:00:00.000Z',
          '2026-07-03T08:00:00.000Z',
        ],
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Replace' }));

    expect(
      screen.getByRole('button', { name: /Incline Press Chest Training days: 2/ }),
    ).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.queryByText('Training days: 2')).not.toBeInTheDocument();
  });

  it('keeps the logged-set replacement confirmation before updating the exercise', async () => {
    renderMenu({ loggedSetCount: 1 });

    fireEvent.click(screen.getByRole('button', { name: 'Replace' }));
    fireEvent.click(screen.getByRole('button', { name: /Incline Press/ }));

    expect(
      screen.getByText(
        'Sets already logged in this session stay attached to the original exercise. Replace it for the remaining work?',
      ),
    ).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();

    const replaceButtons = screen.getAllByRole('button', { name: 'Replace' });
    fireEvent.click(replaceButtons.at(-1)!);

    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe('/api/program-exercises/pe-bench');
    expect(JSON.parse(init?.body as string)).toMatchObject({ exerciseId: 'incline' });
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
