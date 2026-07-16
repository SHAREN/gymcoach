import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Exercise } from '@/lib/prisma-client';
import { ExerciseDetailEquipment } from './exercise-detail-equipment';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
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

const exercise: Exercise = {
  id: 'exercise-1',
  userId: 'user-1',
  name: 'EZ skull crusher',
  muscleGroup: 'TRICEPS',
  category: 'ISOLATION',
  defaultRestSec: 90,
  notes: null,
  usesBodyweight: false,
  equipmentType: 'BARBELL',
  createdAt: new Date('2026-07-16T00:00:00Z'),
};

const equipmentChoices = [
  {
    id: 'small-bar',
    name: '10 kg EZ bar',
    gymId: 'active-gym',
    gymName: 'Active gym',
    equipmentType: 'BARBELL' as const,
    exerciseIds: [exercise.id],
    preferredExerciseIds: [exercise.id],
    loadType: 'PLATE_LOADED' as const,
    baseLoadKg: 10,
    loadingSides: 2,
    platePoolName: 'Olympic plates',
  },
  {
    id: 'standard-bar',
    name: '20 kg standard bar',
    gymId: 'active-gym',
    gymName: 'Active gym',
    equipmentType: 'BARBELL' as const,
    exerciseIds: [exercise.id],
    preferredExerciseIds: [],
  },
];

describe('ExerciseDetailEquipment', () => {
  it('shows the active preferred item, exact load facts, and opens edit in place', async () => {
    const user = userEvent.setup();
    render(
      <ExerciseDetailEquipment
        exercise={exercise}
        gyms={[{ id: 'active-gym', name: 'Active gym' }]}
        activeGymId="active-gym"
        equipmentChoices={equipmentChoices}
      />,
    );

    expect(screen.getByText('Active gym equipment')).toBeInTheDocument();
    expect(screen.getByText('10 kg EZ bar')).toBeInTheDocument();
    expect(screen.getByText('Preferred')).toBeInTheDocument();
    expect(screen.getByText('Empty load: 10 kg')).toBeInTheDocument();
    expect(screen.getByText('Plate pool: Olympic plates')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Edit exercise' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Edit exercise' })).toBeInTheDocument();
    expect(screen.getByText(/Active gym · Active gym/)).toBeInTheDocument();
    const standardPreference = screen.getByRole('button', {
      name: 'Use 20 kg standard bar by default in this gym',
    });
    await user.click(standardPreference);
    expect(standardPreference).toHaveAttribute('aria-pressed', 'true');
  });

  it('links directly to gym settings when no active gym exists', () => {
    render(
      <ExerciseDetailEquipment
        exercise={exercise}
        gyms={[{ id: 'gym-1', name: 'Gym' }]}
        activeGymId={null}
        equipmentChoices={equipmentChoices}
      />,
    );

    expect(screen.getByText(/Choose an active gym/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open gym settings' })).toHaveAttribute(
      'href',
      '/settings',
    );
  });
});
