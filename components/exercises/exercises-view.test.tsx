import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Exercise } from '@/lib/prisma-client';
import { ExercisesView } from './exercises-view';

// The catalog renders the create/edit dialogs and the delete button, which call
// useRouter; mock it so the component mounts under jsdom.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

// Radix Select uses pointer-capture and scrolling APIs that jsdom does not
// implement. Provide the browser methods so the test exercises the real menu.
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

function exercise(over: Partial<Exercise>): Exercise {
  return {
    id: over.id ?? 'e1',
    userId: 'u',
    name: over.name ?? 'Exercise',
    muscleGroup: over.muscleGroup ?? 'CHEST',
    category: over.category ?? 'COMPOUND',
    defaultRestSec: 120,
    notes: null,
    usesBodyweight: false,
    equipmentType: over.equipmentType ?? 'OTHER',
    loadProfile: over.loadProfile ?? {},
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  };
}

const exercises: Exercise[] = [
  exercise({ id: 'e1', name: 'Barbell Bench Press', muscleGroup: 'CHEST' }),
  exercise({ id: 'e2', name: 'Back Squat', muscleGroup: 'QUADS' }),
  exercise({ id: 'e3', name: 'Romanian Deadlift', muscleGroup: 'HAMSTRINGS' }),
];

describe('ExercisesView search (issue #238)', () => {
  it('renders compact rows with the image first, name, and distinct training-day count', () => {
    const bench = exercise({
      id: 'bench',
      name: 'Barbell Bench Press',
      notes: 'This note should not appear in the compact catalog row.',
    });
    render(
      <ExercisesView
        exercises={[bench]}
        gyms={[]}
        activeGymId={null}
        trainingDatesByExercise={{
          bench: [
            '2026-07-01T08:00:00.000Z',
            '2026-07-01T18:00:00.000Z',
            '2026-07-03T08:00:00.000Z',
          ],
        }}
      />,
    );

    const thumbnail = screen.getByRole('button', {
      name: 'View technique for Barbell Bench Press',
    });
    const details = screen.getByRole('link', {
      name: 'Barbell Bench Press Training days: 2',
    });
    expect(details).toHaveAttribute('href', '/exercises/bench');
    expect(thumbnail.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(screen.queryByText('Compound')).not.toBeInTheDocument();
    expect(screen.queryByText('Barbell', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText('rest 120s')).not.toBeInTheDocument();
    expect(screen.queryByText(/This note should not appear/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit exercise' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('shows every exercise when the query is empty', () => {
    render(<ExercisesView exercises={exercises} gyms={[]} activeGymId={null} />);
    expect(screen.getByText('Barbell Bench Press')).toBeInTheDocument();
    expect(screen.getByText('Back Squat')).toBeInTheDocument();
    expect(screen.getByText('Romanian Deadlift')).toBeInTheDocument();
  });

  it('narrows the list to name matches, case-insensitively', async () => {
    const user = userEvent.setup({ delay: null });
    render(<ExercisesView exercises={exercises} gyms={[]} activeGymId={null} />);
    await user.type(screen.getByLabelText('Search exercises by name'), 'squat');
    expect(screen.getByText('Back Squat')).toBeInTheDocument();
    expect(screen.queryByText('Barbell Bench Press')).not.toBeInTheDocument();
    expect(screen.queryByText('Romanian Deadlift')).not.toBeInTheDocument();
  });

  it('shows a no-match empty state when nothing matches', async () => {
    const user = userEvent.setup({ delay: null });
    render(<ExercisesView exercises={exercises} gyms={[]} activeGymId={null} />);
    await user.type(screen.getByLabelText('Search exercises by name'), 'zzz');
    expect(screen.getByText('No exercises match')).toBeInTheDocument();
    expect(screen.queryByText('Back Squat')).not.toBeInTheDocument();
  });

  it('restores the full list when the query is cleared', async () => {
    const user = userEvent.setup({ delay: null });
    render(<ExercisesView exercises={exercises} gyms={[]} activeGymId={null} />);
    const input = screen.getByLabelText('Search exercises by name');
    await user.type(input, 'squat');
    expect(screen.queryByText('Barbell Bench Press')).not.toBeInTheDocument();
    await user.clear(input);
    expect(screen.getByText('Barbell Bench Press')).toBeInTheDocument();
    expect(screen.getByText('Romanian Deadlift')).toBeInTheDocument();
  });

  it('renders the catalog-empty state and no search box when there are no exercises', () => {
    render(<ExercisesView exercises={[]} gyms={[]} activeGymId={null} />);
    expect(screen.getByText('No exercises')).toBeInTheDocument();
    expect(screen.queryByLabelText('Search exercises by name')).not.toBeInTheDocument();
  });

  it('shows physical equipment choices in the create form without removing compact rows', async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <ExercisesView
        exercises={exercises}
        gyms={[]}
        activeGymId={null}
        equipmentChoices={[
          {
            id: 'equipment-1',
            name: 'Cable tower',
            gymId: 'gym-1',
            gymName: 'Olymp',
            equipmentType: 'CABLE',
            exerciseIds: ['e1'],
          },
        ]}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(screen.getByText('Available on physical equipment')).toBeInTheDocument();
    expect(screen.getByText('Olymp')).toBeInTheDocument();
    expect(screen.getByText('Cable tower')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Cable tower' })).not.toBeChecked();
    expect(screen.queryByRole('button', { name: 'Edit exercise' })).not.toBeInTheDocument();
  });
});

describe('ExercisesView gym filter', () => {
  const gyms = [
    {
      id: 'olymp',
      name: 'Olymp',
      exerciseConfigs: [{ exerciseId: 'e2', isAvailable: false }],
    },
    {
      id: 'garage',
      name: 'Garage',
      exerciseConfigs: [{ exerciseId: 'e1', isAvailable: false }],
    },
  ];

  it('starts with the active gym and only excludes explicitly unavailable exercises', () => {
    render(<ExercisesView exercises={exercises} gyms={gyms} activeGymId="olymp" />);

    expect(screen.getByRole('combobox', { name: 'Gym' })).toHaveTextContent('Olymp');
    expect(screen.getByText('Barbell Bench Press')).toBeInTheDocument();
    expect(screen.queryByText('Back Squat')).not.toBeInTheDocument();
    expect(screen.getByText('Romanian Deadlift')).toBeInTheDocument();
  });

  it('switches between gyms and can return to the full catalog', async () => {
    const user = userEvent.setup({ delay: null });
    render(<ExercisesView exercises={exercises} gyms={gyms} activeGymId="olymp" />);

    const filter = screen.getByRole('combobox', { name: 'Gym' });
    await user.click(filter);
    await user.click(screen.getByRole('option', { name: 'Garage' }));

    expect(screen.queryByText('Barbell Bench Press')).not.toBeInTheDocument();
    expect(screen.getByText('Back Squat')).toBeInTheDocument();

    await user.click(filter);
    await user.click(screen.getByRole('option', { name: 'All gyms' }));

    expect(screen.getByText('Barbell Bench Press')).toBeInTheDocument();
    expect(screen.getByText('Back Squat')).toBeInTheDocument();
    expect(screen.getByText('Romanian Deadlift')).toBeInTheDocument();
  });

  it('shows a gym-specific empty state when every exercise is unavailable', () => {
    const closedGym = {
      id: 'closed',
      name: 'Closed gym',
      exerciseConfigs: exercises.map((item) => ({ exerciseId: item.id, isAvailable: false })),
    };
    render(<ExercisesView exercises={exercises} gyms={[closedGym]} activeGymId="closed" />);

    expect(screen.getByText('No exercises available')).toBeInTheDocument();
    expect(
      screen.getByText('No exercises are marked as available at Closed gym.'),
    ).toBeInTheDocument();
  });
});
