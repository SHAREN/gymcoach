import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HistoryStrengthSetEditor } from './history-strength-set-editor';

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

const set = {
  id: 'set-1',
  setNumber: 1,
  weight: 20,
  reps: 10,
  rir: 2,
  isWarmup: false,
  isDropSet: false,
  equipmentNameSnapshot: 'Cable station original',
  gymEquipmentId: 'cable-a',
};

const props = {
  sessionId: 'session-1',
  exerciseId: 'exercise-1',
  exerciseName: 'Cable pressdown',
  sets: [set],
  unit: 'KG' as const,
  equipmentOptions: [
    { id: 'cable-a', name: 'Cable station current' },
    { id: 'cable-b', name: 'Cable B' },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
  refreshMock.mockReset();
  toastErrorMock.mockReset();
});

describe('HistoryStrengthSetEditor', () => {
  it('edits only strength values and keeps the frozen equipment snapshot out of PATCH', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    render(<HistoryStrengthSetEditor {...props} />);

    expect(screen.getByText('Cable station original')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Edit set 1 weight in KG' }), {
      target: { value: '25' },
    });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Edit set 1 repetitions' }), {
      target: { value: '8' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Edit set 1 reps in reserve' }), {
      target: { value: '1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save set 1' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith('/api/sets/set-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weight: 25, reps: 8, rir: 1 }),
    });
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body).not.toHaveProperty('gymEquipmentId');
    expect(body).not.toHaveProperty('equipmentNameSnapshot');
    expect(body).not.toHaveProperty('exerciseId');
    expect(refreshMock).toHaveBeenCalled();
  });

  it('appends a historical row using the current linked equipment only for the new row', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    render(<HistoryStrengthSetEditor {...props} />);

    fireEvent.change(screen.getByRole('spinbutton', { name: 'New set 2 weight in KG' }), {
      target: { value: '22.5' },
    });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'New set 2 repetitions' }), {
      target: { value: '12' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Equipment' }), {
      target: { value: 'cable-b' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add historical set 2' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/session-1/historical-sets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        exerciseId: 'exercise-1',
        gymEquipmentId: 'cable-b',
        weight: 22.5,
        reps: 12,
        rir: 2,
      }),
    });
  });

  it('restores original row values when a historical PATCH fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    render(<HistoryStrengthSetEditor {...props} />);

    const weight = screen.getByRole('spinbutton', { name: 'Edit set 1 weight in KG' });
    fireEvent.change(weight, { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save set 1' }));

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalled());
    expect(weight).toHaveValue(20);
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
