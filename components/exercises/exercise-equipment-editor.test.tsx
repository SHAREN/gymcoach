import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExerciseEquipmentEditor } from './exercise-equipment-editor';

const { refreshMock, toastErrorMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: toastErrorMock } }));

const gyms = [
  {
    id: 'gym-a',
    name: 'Test Gym',
    preferredEquipmentId: 'cable-a',
    equipment: [
      { id: 'cable-a', name: 'Cable A', equipmentType: 'CABLE' as const, linked: true },
      { id: 'cable-b', name: 'Cable B', equipmentType: 'CABLE' as const, linked: false },
      { id: 'machine-a', name: 'Machine A', equipmentType: 'MACHINE' as const, linked: false },
    ],
  },
];

afterEach(() => {
  vi.unstubAllGlobals();
  refreshMock.mockReset();
  toastErrorMock.mockReset();
});

describe('ExerciseEquipmentEditor', () => {
  it('disables incompatible items and saves linked/preferred state', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <ExerciseEquipmentEditor exerciseId="exercise-1" exerciseEquipmentType="CABLE" gyms={gyms} />,
    );

    expect(
      screen.getByRole('checkbox', { name: 'Use Machine A for this exercise in Test Gym' }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Use Cable B for this exercise in Test Gym' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Set Cable B as preferred in Test Gym' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save equipment' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith('/api/exercises/exercise-1/equipment', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gyms: [
          {
            gymId: 'gym-a',
            equipmentIds: ['cable-a', 'cable-b'],
            preferredEquipmentId: 'cable-b',
          },
        ],
      }),
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it('clears preferred state automatically when that equipment is unlinked', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <ExerciseEquipmentEditor exerciseId="exercise-1" exerciseEquipmentType="CABLE" gyms={gyms} />,
    );

    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Use Cable A for this exercise in Test Gym' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save equipment' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string)).toEqual({
      gyms: [{ gymId: 'gym-a', equipmentIds: [], preferredEquipmentId: null }],
    });
  });
});
