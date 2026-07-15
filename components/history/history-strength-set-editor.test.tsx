import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HistoryStrengthSetEditor } from './history-strength-set-editor';
import type { ResolvedEquipmentLoadProfile } from '@/lib/gym-loads';

const { refreshMock, toastErrorMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: toastErrorMock },
}));

const equipmentOptions: ResolvedEquipmentLoadProfile[] = [
  {
    equipmentId: 'cable-a',
    equipmentName: 'Cable A',
    equipmentType: 'CABLE',
    loadType: 'SELECTORIZED',
    weightOptions: [10, 20],
    selectedLoadMultiplier: 0.5,
    baseLoadKg: 0,
    loadingSides: 1,
    platePoolId: null,
    platePoolName: null,
    attainableLoads: [10, 20],
    inventoryPrecision: 'NOT_APPLICABLE',
  },
  {
    equipmentId: 'cable-b',
    equipmentName: 'Cable B',
    equipmentType: 'CABLE',
    loadType: 'SELECTORIZED',
    weightOptions: [15, 25],
    selectedLoadMultiplier: 1,
    baseLoadKg: 0,
    loadingSides: 1,
    platePoolId: null,
    platePoolName: null,
    attainableLoads: [15, 25],
    inventoryPrecision: 'NOT_APPLICABLE',
  },
];

const set = {
  id: 'set-1',
  setNumber: 1,
  weight: 10,
  reps: 10,
  rir: 2,
  isWarmup: false,
  isDropSet: false,
  gymEquipmentId: 'cable-a',
  equipmentNameSnapshot: 'Cable A',
  frozenLoadConstraints: {
    equipmentType: 'CABLE' as const,
    isAvailable: true,
    equipmentId: 'cable-a',
    equipmentOptions: [equipmentOptions[0]!],
  },
};

const baseProps = {
  sessionId: 'session-1',
  exerciseId: 'exercise-1',
  exerciseName: 'Cable pressdown',
  sets: [set],
  unit: 'KG' as const,
  equipmentRequired: true,
  loadConstraints: {
    equipmentType: 'CABLE' as const,
    equipmentId: null,
    equipmentOptions,
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
  refreshMock.mockReset();
  toastErrorMock.mockReset();
});

describe('HistoryStrengthSetEditor', () => {
  it('keeps compact mobile columns and edits a row without replacing its snapshot', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    render(<HistoryStrengthSetEditor {...baseProps} />);

    expect(screen.getByTestId('history-strength-set-editor')).not.toHaveClass('overflow-x-auto');
    expect(screen.getByTestId('history-strength-set-header')).toHaveClass(
      'grid-cols-[1.5rem_minmax(4rem,1fr)_minmax(2.75rem,0.65fr)_minmax(2.5rem,0.55fr)_2.75rem]',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit set 1 weight in KG' }));
    const options = within(screen.getByTestId('set-value-options'));
    expect(options.getByText('10 kg')).toBeInTheDocument();
    expect(options.getByText('20 kg')).toBeInTheDocument();
    expect(options.queryByText('15 kg')).not.toBeInTheDocument();
    fireEvent.click(options.getByText('20 kg'));
    fireEvent.click(screen.getByRole('button', { name: 'Apply value' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/sets/set-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weight: 20, reps: 10, rir: 2 }),
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).not.toHaveProperty('gymEquipmentId');
    expect(refreshMock).toHaveBeenCalled();
  });

  it('uses frozen row loads after the original equipment is unlinked from the gym profile', () => {
    render(
      <HistoryStrengthSetEditor
        {...baseProps}
        loadConstraints={{
          equipmentType: 'CABLE',
          equipmentId: null,
          equipmentOptions: [equipmentOptions[1]!],
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit set 1 weight in KG' }));
    const options = within(screen.getByTestId('set-value-options'));
    expect(options.getByText('10 kg')).toBeInTheDocument();
    expect(options.getByText('20 kg')).toBeInTheDocument();
    expect(options.queryByText('15 kg')).not.toBeInTheDocument();
    expect(options.queryByText('25 kg')).not.toBeInTheDocument();
  });

  it('requires a linked machine for new rows and exposes only its achievable loads', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <HistoryStrengthSetEditor
        {...baseProps}
        sets={[
          {
            ...set,
            gymEquipmentId: null,
            equipmentNameSnapshot: null,
            frozenLoadConstraints: null,
          },
        ]}
      />,
    );

    expect(screen.getByRole('button', { name: 'Add historical set 2' })).toBeDisabled();
    fireEvent.click(screen.getByRole('combobox', { name: 'Equipment for the new historical set' }));
    fireEvent.click(screen.getByRole('option', { name: 'Cable B' }));

    fireEvent.click(screen.getByRole('button', { name: 'New set 2 weight in KG' }));
    const options = within(screen.getByTestId('set-value-options'));
    expect(options.getByText('15 kg')).toBeInTheDocument();
    expect(options.getByText('25 kg')).toBeInTheDocument();
    expect(options.queryByText('10 kg')).not.toBeInTheDocument();
    fireEvent.click(options.getByText('25 kg'));
    fireEvent.click(screen.getByRole('button', { name: 'Apply value' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add historical set 2' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/sessions/session-1/historical-sets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exerciseId: 'exercise-1',
          gymEquipmentId: 'cable-b',
          weight: 25,
          reps: 10,
          rir: 2,
        }),
      }),
    );
  });

  it('blocks new rows when an equipment-first exercise has no current linked equipment', () => {
    render(
      <HistoryStrengthSetEditor
        {...baseProps}
        sets={[
          {
            ...set,
            gymEquipmentId: null,
            equipmentNameSnapshot: null,
            frozenLoadConstraints: null,
          },
        ]}
        loadConstraints={{ equipmentType: 'CABLE', isAvailable: false }}
      />,
    );

    expect(screen.getByText(/has no linked equipment for the exercise/i)).toBeVisible();
    expect(screen.getByRole('button', { name: 'New set 2 weight in KG' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add historical set 2' })).toBeDisabled();
  });

  it('confirms deletion and keeps the old row values when a mutation fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    render(<HistoryStrengthSetEditor {...baseProps} />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Edit set 1 reps in reserve' }), {
      target: { value: '1' },
    });
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalled());
    expect(screen.getByRole('combobox', { name: 'Edit set 1 reps in reserve' })).toHaveValue('2');
    expect(screen.getByRole('button', { name: 'Edit set 1 weight in KG' })).toHaveTextContent('10');

    fireEvent.click(screen.getByRole('button', { name: 'Delete set 1' }));
    expect(screen.getByText(/permanently deleted from this completed workout/i)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Delete set' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith('/api/sets/set-1', {
        method: 'DELETE',
        headers: undefined,
        body: undefined,
      }),
    );
  });
});
