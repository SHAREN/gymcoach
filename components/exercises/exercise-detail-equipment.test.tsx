import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Exercise } from '@/lib/prisma-client';
import type { ExerciseEquipmentChoice } from '@/lib/gym-inventory-types';
import {
  ExerciseDetailEditTrigger,
  ExerciseDetailEquipment,
  ExerciseDetailEquipmentProvider,
  ExerciseEquipmentEditTrigger,
} from './exercise-detail-equipment';

const { refresh, toastError } = vi.hoisted(() => ({
  refresh: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: toastError },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  refresh.mockReset();
  toastError.mockReset();
});

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

Element.prototype.hasPointerCapture = vi.fn(() => false);
Element.prototype.setPointerCapture = vi.fn();
Element.prototype.releasePointerCapture = vi.fn();
Element.prototype.scrollIntoView = vi.fn();

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

const gyms = [
  { id: 'other-gym', name: 'Alpha other gym' },
  { id: 'active-gym', name: 'Zulu active gym' },
];

const equipmentChoices: ExerciseEquipmentChoice[] = [
  {
    id: 'small-bar',
    name: 'Small diameter 6 kg bar',
    gymId: 'active-gym',
    gymName: 'Zulu active gym',
    equipmentType: 'BARBELL',
    exerciseIds: [exercise.id],
    preferredExerciseIds: [exercise.id],
    loadType: 'PLATE_LOADED',
    baseLoadKg: 6,
    loadingSides: 2,
    systemBarbellFamily: 'SMALL',
    platePoolName: 'Small diameter plates',
  },
  {
    id: 'standard-bar',
    name: 'Large diameter 20 kg bar',
    gymId: 'active-gym',
    gymName: 'Zulu active gym',
    equipmentType: 'BARBELL',
    exerciseIds: [exercise.id],
    preferredExerciseIds: [],
    loadType: 'PLATE_LOADED',
    baseLoadKg: 20,
    loadingSides: 2,
    systemBarbellFamily: 'LARGE',
    platePoolName: 'Large diameter plates',
  },
  {
    id: 'other-bar',
    name: '15 kg other gym bar',
    gymId: 'other-gym',
    gymName: 'Alpha other gym',
    equipmentType: 'BARBELL',
    exerciseIds: [exercise.id],
    preferredExerciseIds: [exercise.id],
  },
];

function crossTypeEquipmentChoices(): ExerciseEquipmentChoice[] {
  return [
    ...equipmentChoices,
    {
      id: 'dumbbells',
      name: 'Adjustable dumbbells',
      gymId: 'active-gym',
      gymName: 'Zulu active gym',
      equipmentType: 'DUMBBELL',
      exerciseIds: [],
      loadType: 'FIXED',
      weightOptions: [5, 10, 20],
    },
    {
      id: 'cable',
      name: 'Cable stack',
      gymId: 'active-gym',
      gymName: 'Zulu active gym',
      equipmentType: 'CABLE',
      exerciseIds: [],
      loadType: 'SELECTORIZED',
      weightOptions: [10, 20],
      selectedLoadMultiplier: 0.5,
    },
    {
      id: 'crossover',
      name: 'Crossover',
      gymId: 'active-gym',
      gymName: 'Zulu active gym',
      equipmentType: 'CABLE',
      exerciseIds: [],
      loadType: 'SELECTORIZED',
      weightOptions: [5, 10, 15],
      selectedLoadMultiplier: 1,
    },
    {
      id: 'machine',
      name: 'Chest press machine',
      gymId: 'active-gym',
      gymName: 'Zulu active gym',
      equipmentType: 'MACHINE',
      exerciseIds: [],
      loadType: 'SELECTORIZED',
      weightOptions: [10, 20, 30],
      selectedLoadMultiplier: 1,
    },
  ];
}

function renderDetail({
  activeGymId = 'active-gym',
  choices = equipmentChoices,
  exerciseValue = exercise,
  equipmentTypeLabel = 'Barbell',
}: {
  activeGymId?: string | null;
  choices?: ExerciseEquipmentChoice[];
  exerciseValue?: Exercise;
  equipmentTypeLabel?: string;
} = {}) {
  return render(
    <ExerciseDetailEquipmentProvider
      exercise={exerciseValue}
      gyms={gyms}
      activeGymId={activeGymId}
      equipmentChoices={choices}
    >
      <ExerciseDetailEditTrigger />
      <ExerciseEquipmentEditTrigger kind="badge" equipmentTypeLabel={equipmentTypeLabel} />
      <ExerciseEquipmentEditTrigger kind="information" equipmentTypeLabel={equipmentTypeLabel} />
      <ExerciseDetailEquipment />
    </ExerciseDetailEquipmentProvider>,
  );
}

describe('ExerciseDetailEquipment', () => {
  it('edits general details, resets on cancel, and keeps an HTTP failure retryable', async () => {
    const updatedExercise = { ...exercise, name: 'Updated skull crusher' };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(updatedExercise), {
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
    renderDetail();

    const editButton = screen.getByRole('button', { name: 'Edit exercise' });
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();

    editButton.focus();
    fireEvent.click(editButton);
    const nameInput = screen.getByLabelText('Name');
    await waitFor(() => expect(nameInput).toHaveFocus());
    expect(nameInput).toHaveValue(exercise.name);
    fireEvent.change(nameInput, { target: { value: 'Cancelled edit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(fetchMock).not.toHaveBeenCalled();
    await waitFor(() => expect(editButton).toHaveFocus());

    fireEvent.click(editButton);
    expect(screen.getByLabelText('Name')).toHaveValue(exercise.name);
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: updatedExercise.name },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Could not save the exercise.'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue(updatedExercise.name);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`/api/exercises/${exercise.id}`);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({
      name: updatedExercise.name,
      muscleGroup: exercise.muscleGroup,
      category: exercise.category,
    });
    expect(fetchMock.mock.calls[2]?.[0]).toBe(`/api/exercises/${exercise.id}/equipment`);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(editButton).toHaveFocus());
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('keeps a rejected primary update retryable without an unhandled rejection', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Network request failed'))
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
    renderDetail();

    fireEvent.click(screen.getByRole('button', { name: 'Edit exercise' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('PUT');
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Could not save the exercise.'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('keeps a rejected equipment update retryable with the equipment-specific error', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(exercise), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockRejectedValueOnce(new TypeError('Network request failed'))
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
    renderDetail();

    fireEvent.click(screen.getByRole('button', { name: 'Edit exercise' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`/api/exercises/${exercise.id}/equipment`);
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('PATCH');
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'The exercise was saved, but its equipment links could not be updated.',
      ),
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('makes both summaries accessible, shows the concrete bar family, and preserves alternatives', async () => {
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
    const rendered = renderDetail();

    const entryName = 'Edit equipment. Type: Barbell. Selected: Small diameter 6 kg bar.';
    expect(screen.getAllByRole('button', { name: entryName })).toHaveLength(2);
    expect(screen.getByTestId('exercise-equipment-badge-trigger')).toHaveTextContent(
      'Small diameter 6 kg bar · 6 kg empty · Small / thin diameter',
    );
    expect(screen.getByTestId('exercise-equipment-information-trigger')).toHaveTextContent(
      'Broad equipment typeBarbellSelected concrete equipmentSmall diameter 6 kg bar',
    );
    expect(screen.getByText('Empty load: 6 kg')).toBeInTheDocument();
    expect(screen.getByText('Plate pool: Small diameter plates')).toBeInTheDocument();
    expect(screen.getAllByText('Small / thin diameter').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Large / thick diameter').length).toBeGreaterThan(0);

    const badgeTrigger = screen.getByTestId('exercise-equipment-badge-trigger');
    await user.click(badgeTrigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Equipment type' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(badgeTrigger).toHaveFocus());

    const informationTrigger = screen.getByTestId('exercise-equipment-information-trigger');
    await user.click(informationTrigger);
    const activeGymHeading = screen.getByText('Zulu active gym · Active gym');
    const otherGymHeading = screen.getByText('Alpha other gym');
    expect(
      activeGymHeading.compareDocumentPosition(otherGymHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const standardPreference = screen.getByRole('button', {
      name: 'Use Large diameter 20 kg bar by default in this gym',
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
    await waitFor(() => expect(informationTrigger).toHaveFocus());

    rendered.unmount();
    renderDetail({
      choices: equipmentChoices.map((item) => ({
        ...item,
        preferredExerciseIds:
          item.id === 'standard-bar' || item.id === 'other-bar' ? [exercise.id] : [],
      })),
    });
    const standardCard = screen.getByRole('button', {
      name: 'Edit exercise equipment starting from Large diameter 20 kg bar',
    });
    expect(within(standardCard).getByText('Preferred')).toBeInTheDocument();
    expect(screen.getByText('Small diameter 6 kg bar')).toBeInTheDocument();
  });

  it('stages broad type changes only through explicit preferred-item actions and resets on Cancel', async () => {
    const choices = crossTypeEquipmentChoices();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup({ delay: null });
    renderDetail({ choices });

    const informationTrigger = screen.getByTestId('exercise-equipment-information-trigger');
    await user.click(informationTrigger);
    expect(
      screen.getByText('Equipment changes apply only after you choose Save.'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('switch', { name: 'Adjustable dumbbells' }));
    expect(screen.getByRole('combobox', { name: 'Equipment type' })).toHaveTextContent('Barbell');
    await user.click(
      screen.getByRole('button', {
        name: 'Use Adjustable dumbbells by default and change the exercise type to Dumbbells',
      }),
    );
    expect(screen.getByRole('combobox', { name: 'Equipment type' })).toHaveTextContent('Dumbbells');

    await user.click(screen.getByRole('switch', { name: 'Cable stack' }));
    expect(screen.getByRole('combobox', { name: 'Equipment type' })).toHaveTextContent('Dumbbells');
    await user.click(
      screen.getByRole('button', {
        name: 'Use Cable stack by default and change the exercise type to Cable stack',
      }),
    );
    expect(screen.getByRole('combobox', { name: 'Equipment type' })).toHaveTextContent(
      'Cable stack',
    );

    await user.click(screen.getByRole('switch', { name: 'Chest press machine' }));
    expect(screen.getByRole('combobox', { name: 'Equipment type' })).toHaveTextContent(
      'Cable stack',
    );
    await user.click(
      screen.getByRole('button', {
        name: 'Use Chest press machine by default and change the exercise type to Machine',
      }),
    );
    expect(screen.getByRole('combobox', { name: 'Equipment type' })).toHaveTextContent('Machine');

    await user.click(screen.getByRole('switch', { name: 'Crossover' }));
    expect(screen.getByRole('combobox', { name: 'Equipment type' })).toHaveTextContent('Machine');
    await user.click(
      screen.getByRole('button', {
        name: 'Use Crossover by default and change the exercise type to Cable stack',
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(fetchMock).not.toHaveBeenCalled();
    await waitFor(() => expect(informationTrigger).toHaveFocus());

    await user.click(screen.getByTestId('exercise-equipment-badge-trigger'));
    expect(screen.getByRole('switch', { name: 'Crossover' })).not.toBeChecked();
    expect(screen.getByRole('combobox', { name: 'Equipment type' })).toHaveTextContent('Barbell');
  });

  it('saves the explicitly preferred item and its broad type together', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ...exercise, equipmentType: 'CABLE' }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup({ delay: null });
    renderDetail({ choices: crossTypeEquipmentChoices() });

    await user.click(screen.getByTestId('exercise-equipment-badge-trigger'));
    await user.click(screen.getByRole('switch', { name: 'Crossover' }));
    expect(screen.getByRole('combobox', { name: 'Equipment type' })).toHaveTextContent('Barbell');
    await user.click(
      screen.getByRole('button', {
        name: 'Use Crossover by default and change the exercise type to Cable stack',
      }),
    );
    expect(screen.getByRole('combobox', { name: 'Equipment type' })).toHaveTextContent(
      'Cable stack',
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      equipmentType: 'CABLE',
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      gyms: [
        {
          gymId: 'active-gym',
          equipmentIds: ['crossover'],
          preferredEquipmentId: 'crossover',
        },
        {
          gymId: 'other-gym',
          equipmentIds: ['other-bar'],
          preferredEquipmentId: null,
        },
      ],
    });
  });

  it('shows fixed and selectorized load facts for dumbbells, machines, cables, and crossovers', () => {
    renderDetail({
      exerciseValue: { ...exercise, equipmentType: 'CABLE' },
      equipmentTypeLabel: 'Cable stack',
      choices: [
        {
          id: 'cable',
          name: 'Cable stack',
          gymId: 'active-gym',
          gymName: 'Zulu active gym',
          equipmentType: 'CABLE',
          exerciseIds: [exercise.id],
          preferredExerciseIds: [exercise.id],
          loadType: 'SELECTORIZED',
          weightOptions: [10, 20],
          selectedLoadMultiplier: 0.5,
        },
        {
          id: 'crossover',
          name: 'Crossover',
          gymId: 'active-gym',
          gymName: 'Zulu active gym',
          equipmentType: 'CABLE',
          exerciseIds: [exercise.id],
          loadType: 'SELECTORIZED',
          weightOptions: [5, 10, 15],
          selectedLoadMultiplier: 1,
        },
        {
          id: 'dumbbells',
          name: 'Adjustable dumbbells',
          gymId: 'active-gym',
          gymName: 'Zulu active gym',
          equipmentType: 'DUMBBELL',
          exerciseIds: [exercise.id],
          loadType: 'FIXED',
          weightOptions: [5, 10, 20],
        },
        {
          id: 'machine',
          name: 'Chest press machine',
          gymId: 'active-gym',
          gymName: 'Zulu active gym',
          equipmentType: 'MACHINE',
          exerciseIds: [exercise.id],
          loadType: 'SELECTORIZED',
          weightOptions: [10, 20, 30],
          selectedLoadMultiplier: 1,
        },
      ],
    });

    expect(screen.getByTestId('exercise-equipment-badge-trigger')).toHaveTextContent(
      'Cable stack · 10, 20 kg',
    );
    expect(screen.getByText('Displayed loads: 10, 20 kg')).toBeInTheDocument();
    expect(screen.getByText('Displayed load x 0.5')).toBeInTheDocument();
    expect(screen.getByText('Displayed loads: 5, 10, 15 kg')).toBeInTheDocument();
    expect(screen.getByText('Available weights: 5, 10, 20 kg')).toBeInTheDocument();
    expect(screen.getByText('Displayed loads: 10, 20, 30 kg')).toBeInTheDocument();
  });

  it('links directly to gym settings when no active gym exists', () => {
    renderDetail({ activeGymId: null });

    expect(screen.getByText(/Choose an active gym/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open gym settings' })).toHaveAttribute(
      'href',
      '/settings',
    );
    expect(screen.getByTestId('exercise-equipment-badge-trigger')).toHaveTextContent(
      'No active gym',
    );
  });
});
