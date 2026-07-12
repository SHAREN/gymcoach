import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expandRanges, WeightInventoryEditor } from './weight-inventory-editor';

const baseGym = {
  id: 'gym-1',
  userId: 'user-1',
  name: 'Olymp',
  dumbbellWeights: [10, 12, 14],
  plateWeights: [1.25, 5, 10, 20],
  barWeights: [20],
  exerciseConfigs: [],
};

const barbellExercise = {
  id: 'barbell-1',
  name: 'Bench Press',
  equipmentType: 'BARBELL',
};

const dumbbellExercise = {
  id: 'dumbbell-1',
  name: 'Dumbbell Curl',
  equipmentType: 'DUMBBELL',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WeightInventoryEditor', () => {
  it('rejects ranges that would silently exceed the API inventory limit', () => {
    expect(() => expandRanges([{ id: 1, min: '1', max: '500', step: '1' }])).toThrow(RangeError);
  });

  it('edits shared bars and plates for the current gym', async () => {
    const onSaved = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => baseGym,
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <WeightInventoryEditor
        open
        gym={baseGym as never}
        exercise={barbellExercise as never}
        unit="KG"
        onOpenChange={vi.fn()}
        onSaved={onSaved}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'All barbell exercises in this gym' }));
    expect(screen.getByRole('textbox', { name: 'Bars 1' })).toHaveValue('20');
    expect(screen.getByDisplayValue('1.25')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add plate' }));
    expect(screen.getByDisplayValue('2.5')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const request = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      exerciseId: 'barbell-1',
      scope: 'equipment',
      barWeights: [20],
      plateWeights: [1.25, 2.5, 5, 10, 20],
    });
    expect(onSaved).toHaveBeenCalledWith(baseGym);
  });

  it('keeps inherited bars inherited when only plates are overridden', async () => {
    const gymWithPlateOverride = {
      ...baseGym,
      exerciseConfigs: [
        {
          exerciseId: 'barbell-1',
          isAvailable: true,
          weightOptions: [],
          dumbbellWeights: [],
          plateWeights: [1.25],
          barWeights: [],
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => gymWithPlateOverride,
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <WeightInventoryEditor
        open
        gym={gymWithPlateOverride as never}
        exercise={barbellExercise as never}
        unit="KG"
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'This exercise only' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const request = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      scope: 'exercise',
      barWeights: [],
      plateWeights: [1.25],
    });
  });

  it('saves an exercise-only override without changing the shared scope', async () => {
    const gymWithOverride = {
      ...baseGym,
      exerciseConfigs: [
        {
          exerciseId: 'dumbbell-1',
          isAvailable: true,
          weightOptions: [],
          dumbbellWeights: [15.5],
          plateWeights: [],
          barWeights: [],
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => gymWithOverride,
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <WeightInventoryEditor
        open
        gym={gymWithOverride as never}
        exercise={dumbbellExercise as never}
        unit="KG"
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'This exercise only' }));
    expect(screen.getByDisplayValue('15.5')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const request = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      exerciseId: 'dumbbell-1',
      scope: 'exercise',
      dumbbellWeights: [15.5],
    });
  });

  it('combines dumbbell ranges with an individual 15.5 kg weight', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => baseGym,
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <WeightInventoryEditor
        open
        gym={baseGym as never}
        exercise={dumbbellExercise as never}
        unit="KG"
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'All dumbbell exercises in this gym' }));
    expect(screen.getByLabelText('Min')).toHaveValue('10');
    expect(screen.getByLabelText('Max')).toHaveValue('14');
    expect(screen.getByLabelText('Step')).toHaveValue('2');
    fireEvent.click(screen.getByRole('button', { name: 'Add one weight' }));
    expect(screen.getByDisplayValue('15.5')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const request = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      exerciseId: 'dumbbell-1',
      scope: 'equipment',
      dumbbellWeights: [10, 12, 14, 15.5],
    });
  });
});
