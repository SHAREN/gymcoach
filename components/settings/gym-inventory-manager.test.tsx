import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GymInventoryManager, expandLoadRange } from './gym-inventory-manager';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GymInventoryManager', () => {
  it('expands an inclusive displayed stack range without inventing a ratio', () => {
    expect(expandLoadRange('5', '20', '5')).toEqual([5, 10, 15, 20]);
    expect(expandLoadRange('5', '21', '5')).toEqual([5, 10, 15, 20, 21]);
    expect(() => expandLoadRange('1', '1000', '1')).toThrow(RangeError);
  });

  it('submits and reloads a preferred item without removing alternative equipment', async () => {
    const inventoryResponse = (preferred: boolean) => ({
            gym: {
              id: 'gym-1',
              name: 'Olymp',
              inventoryMode: 'EQUIPMENT_FIRST',
              sharedFreeWeights: {
                dumbbellWeightsKg: [],
                plateWeightsKg: [],
                barWeightsKg: [],
              },
              platePools: [
                {
                  id: 'pool-olympic',
                  name: 'Olympic 50 mm',
                  compatibilityKey: 'olympic_50mm',
                  plates: [{ id: 'plate-20', weightKg: 20, quantity: 4 }],
                },
              ],
              equipment: [
                {
                  id: 'cable-1',
                  gymId: 'gym-1',
                  name: 'Cable tower A',
                  equipmentType: 'CABLE',
                  description: null,
                  manufacturer: null,
                  modelName: null,
                  quantity: 1,
                  loadType: 'SELECTORIZED',
                  weightOptions: [5, 10, 15],
                  selectedLoadMultiplier: 0.5,
                  baseLoadKg: 0,
                  platePoolId: null,
                  loadingSides: 2,
                  platePool: null,
                  preferredExerciseIds: preferred ? ['exercise-1'] : [],
                  exerciseLinks: [
                    {
                      id: 'exercise-1',
                      name: 'Lat Pulldown',
                      muscleGroup: 'BACK_WIDTH',
                      category: 'COMPOUND',
                      equipmentType: 'CABLE',
                      notes: null,
                    },
                  ],
                },
                {
                  id: 'cable-2',
                  gymId: 'gym-1',
                  name: 'Cable tower B',
                  equipmentType: 'CABLE',
                  description: null,
                  manufacturer: null,
                  modelName: null,
                  quantity: 1,
                  loadType: 'SELECTORIZED',
                  weightOptions: [7.5, 12.5, 17.5],
                  selectedLoadMultiplier: 1,
                  baseLoadKg: 0,
                  platePoolId: null,
                  loadingSides: 2,
                  platePool: null,
                  preferredExerciseIds: [],
                  exerciseLinks: [
                    {
                      id: 'exercise-1',
                      name: 'Lat Pulldown',
                      muscleGroup: 'BACK_WIDTH',
                      category: 'COMPOUND',
                      equipmentType: 'CABLE',
                      notes: null,
                    },
                  ],
                },
              ],
              exerciseCoverage: [
                {
                  id: 'exercise-1',
                  name: 'Lat Pulldown',
                  muscleGroup: 'BACK_WIDTH',
                  category: 'COMPOUND',
                  equipmentType: 'CABLE',
                  notes: null,
                  configured: false,
                  isAvailable: true,
                  availabilitySource: 'equipment',
                  requiresEquipmentSelection: true,
                  attainableLoadsKg: [5, 10, 15],
                  equipmentOptions: [],
                  equipmentIds: ['cable-1', 'cable-2'],
                  preferredEquipmentId: preferred ? 'cable-1' : null,
                },
              ],
            },
          });
    let getCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method || init.method === 'GET') {
        const body = inventoryResponse(getCount > 0);
        getCount += 1;
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<GymInventoryManager gymId="gym-1" onModeChanged={vi.fn()} />);

    expect(await screen.findByText('Olympic 50 mm')).toBeInTheDocument();
    expect(screen.getByText('20 kg x 4')).toBeInTheDocument();
    expect(screen.getByText('Cable tower A')).toBeInTheDocument();
    expect(screen.getByText('Cable tower B')).toBeInTheDocument();
    expect(screen.getByText(/displayed load x 0.5/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Linked physical equipment')).toBeInTheDocument());

    const user = userEvent.setup();
    const firstCard = screen
      .getByText('Cable tower A')
      .closest('.rounded-md.border') as HTMLElement | null;
    expect(firstCard).not.toBeNull();
    await user.click(within(firstCard!).getByRole('button', { name: 'Edit equipment' }));
    const preferredButton = screen.getByRole('button', {
      name: 'Use this equipment by default for Lat Pulldown',
    });
    await user.click(preferredButton);
    expect(preferredButton).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/gym-equipment/cable-1',
        expect.objectContaining({ method: 'PUT' }),
      ),
    );
    const putCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(JSON.parse(String(putCall?.[1]?.body))).toMatchObject({
      exerciseIds: ['exercise-1'],
      preferredExerciseIds: ['exercise-1'],
    });
    await waitFor(() => expect(getCount).toBe(2));
    expect(screen.getByText('Cable tower B')).toBeInTheDocument();

    const reloadedFirstCard = screen
      .getByText('Cable tower A')
      .closest('.rounded-md.border') as HTMLElement | null;
    expect(reloadedFirstCard).not.toBeNull();
    await user.click(within(reloadedFirstCard!).getByRole('button', { name: 'Edit equipment' }));
    expect(
      screen.getByRole('button', {
        name: 'Use this equipment by default for Lat Pulldown',
      }),
    ).toHaveAttribute('aria-pressed', 'true');
  });
});
