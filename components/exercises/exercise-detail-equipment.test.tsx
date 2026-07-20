import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Exercise } from '@/lib/prisma-client';
import { ExerciseDetailEquipment } from './exercise-detail-equipment';

const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  refresh.mockReset();
});

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
  catalogOrigin: null,
  loadProfile: {},
  createdAt: new Date('2026-07-16T00:00:00Z'),
};

const equipmentChoices = [
  {
    id: 'small-bar',
    name: '10 kg EZ bar',
    gymId: 'active-gym',
    gymName: 'Zulu active gym',
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
    gymName: 'Zulu active gym',
    equipmentType: 'BARBELL' as const,
    exerciseIds: [exercise.id],
    preferredExerciseIds: [],
  },
  {
    id: 'other-bar',
    name: '15 kg other gym bar',
    gymId: 'other-gym',
    gymName: 'Alpha other gym',
    equipmentType: 'BARBELL' as const,
    exerciseIds: [exercise.id],
    preferredExerciseIds: [exercise.id],
  },
];

describe('ExerciseDetailEquipment', () => {
  it('sorts the active gym first, persists a new preference, and reloads without losing alternatives', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(exercise), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    const rendered = render(
      <ExerciseDetailEquipment
        exercise={exercise}
        gyms={[
          { id: 'other-gym', name: 'Alpha other gym' },
          { id: 'active-gym', name: 'Zulu active gym' },
        ]}
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
    const activeGymHeading = screen.getByText('Zulu active gym · Active gym');
    const otherGymHeading = screen.getByText('Alpha other gym');
    expect(
      activeGymHeading.compareDocumentPosition(otherGymHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const standardPreference = screen.getByRole('button', {
      name: 'Use 20 kg standard bar by default in this gym',
    });
    await user.click(standardPreference);
    expect(standardPreference).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`/api/exercises/${exercise.id}`);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`/api/exercises/${exercise.id}/equipment`);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      gyms: [
        {
          gymId: 'active-gym',
          equipmentIds: ['small-bar', 'standard-bar'],
          preferredEquipmentId: 'standard-bar',
        },
        {
          gymId: 'other-gym',
          equipmentIds: ['other-bar'],
          preferredEquipmentId: 'other-bar',
        },
      ],
    });
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    rendered.unmount();
    render(
      <ExerciseDetailEquipment
        exercise={exercise}
        gyms={[
          { id: 'other-gym', name: 'Alpha other gym' },
          { id: 'active-gym', name: 'Zulu active gym' },
        ]}
        activeGymId="active-gym"
        equipmentChoices={equipmentChoices.map((item) => ({
          ...item,
          preferredExerciseIds:
            item.id === 'standard-bar' || item.id === 'other-bar' ? [exercise.id] : [],
        }))}
      />,
    );

    const standardCard = screen
      .getByText('20 kg standard bar')
      .closest('.rounded-md.border') as HTMLElement | null;
    expect(standardCard).not.toBeNull();
    expect(within(standardCard!).getByText('Preferred')).toBeInTheDocument();
    expect(screen.getByText('10 kg EZ bar')).toBeInTheDocument();
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
