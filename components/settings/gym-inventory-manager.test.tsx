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
            id: 'pool-large',
            name: 'Large plates',
            compatibilityKey: 'legacy-default',
            systemBarbellFamily: 'LARGE',
            plates: [],
          },
          {
            id: 'pool-small',
            name: 'Small plates',
            compatibilityKey: 'small_diameter',
            systemBarbellFamily: 'SMALL',
            plates: [],
          },
          {
            id: 'pool-olympic',
            name: 'Olympic 50 mm',
            compatibilityKey: 'olympic_50mm',
            systemBarbellFamily: null,
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
            systemBarbellFamily: null,
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
            systemBarbellFamily: null,
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
        systemProfiles: {
          dumbbells: {
            id: 'system-profile-dumbbells-gym-1',
            kind: 'DUMBBELLS',
            weightsKg: [10, 12.5],
            exerciseLinks: [],
          },
          barbell: {
            id: 'system-profile-barbell-gym-1',
            kind: 'BARBELL',
            exerciseLinks: [],
            families: [
              {
                family: 'LARGE',
                pool: {
                  id: 'pool-large',
                  name: 'Large plates',
                  compatibilityKey: 'legacy-default',
                  systemBarbellFamily: 'LARGE',
                  plates: [],
                },
                bars: [],
                loadingSides: 2,
              },
              {
                family: 'SMALL',
                pool: {
                  id: 'pool-small',
                  name: 'Small plates',
                  compatibilityKey: 'small_diameter',
                  systemBarbellFamily: 'SMALL',
                  plates: [],
                },
                bars: [],
                loadingSides: 2,
              },
            ],
          },
        },
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
    expect(screen.getByTestId('system-profile-dumbbells')).toBeInTheDocument();
    expect(screen.getByTestId('system-profile-barbell')).toBeInTheDocument();
    expect(screen.queryByText('Derived exercise availability')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete Dumbbells/i })).not.toBeInTheDocument();

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

  it('edits the permanent Dumbbells profile and exposes both isolated Barbell families', async () => {
    const inventory = {
      gym: {
        id: 'gym-1',
        name: 'Olymp',
        inventoryMode: 'EQUIPMENT_FIRST',
        sharedFreeWeights: {
          dumbbellWeightsKg: [10],
          plateWeightsKg: [],
          barWeightsKg: [],
        },
        platePools: [
          {
            id: 'large-pool',
            name: 'Large pool',
            compatibilityKey: 'legacy-default',
            systemBarbellFamily: 'LARGE',
            plates: [{ id: 'large-10', weightKg: 10, quantity: 2 }],
          },
          {
            id: 'small-pool',
            name: 'Small pool',
            compatibilityKey: 'small_diameter',
            systemBarbellFamily: 'SMALL',
            plates: [{ id: 'small-3.5', weightKg: 3.5, quantity: 2 }],
          },
        ],
        equipment: [],
        systemProfiles: {
          dumbbells: {
            id: 'system-profile-dumbbells-gym-1',
            kind: 'DUMBBELLS',
            weightsKg: [10],
            exerciseLinks: [],
          },
          barbell: {
            id: 'system-profile-barbell-gym-1',
            kind: 'BARBELL',
            exerciseLinks: [],
            families: [
              {
                family: 'LARGE',
                pool: {
                  id: 'large-pool',
                  name: 'Large pool',
                  compatibilityKey: 'legacy-default',
                  systemBarbellFamily: 'LARGE',
                  plates: [{ id: 'large-10', weightKg: 10, quantity: 2 }],
                },
                bars: [],
                loadingSides: 2,
              },
              {
                family: 'SMALL',
                pool: {
                  id: 'small-pool',
                  name: 'Small pool',
                  compatibilityKey: 'small_diameter',
                  systemBarbellFamily: 'SMALL',
                  plates: [{ id: 'small-3.5', weightKg: 3.5, quantity: 2 }],
                },
                bars: [],
                loadingSides: 2,
              },
            ],
          },
        },
        exerciseCoverage: [
          {
            id: 'dumbbell-press',
            name: 'Dumbbell Press',
            muscleGroup: 'CHEST',
            category: 'COMPOUND',
            equipmentType: 'DUMBBELL',
            notes: null,
            configured: true,
            isAvailable: false,
            availabilitySource: 'none',
            requiresEquipmentSelection: false,
            attainableLoadsKg: [],
            equipmentOptions: [],
            equipmentIds: [],
            preferredEquipmentId: null,
          },
          {
            id: 'barbell-squat',
            name: 'Barbell Squat',
            muscleGroup: 'QUADS',
            category: 'COMPOUND',
            equipmentType: 'BARBELL',
            notes: null,
            configured: true,
            isAvailable: false,
            availabilitySource: 'none',
            requiresEquipmentSelection: false,
            attainableLoadsKg: [],
            equipmentOptions: [],
            equipmentIds: [],
            preferredEquipmentId: null,
          },
        ],
      },
    };
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        new Response(JSON.stringify(init?.method === 'PUT' ? inventory : inventory), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<GymInventoryManager gymId="gym-1" onModeChanged={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: 'Edit Dumbbells profile' }));
    await user.click(screen.getByRole('button', { name: 'Add all matching exercises' }));
    const weights = screen.getByLabelText('Available dumbbell weights (kg)');
    await user.clear(weights);
    await user.type(weights, '10, 12.5');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/gyms/gym-1/system-profiles/dumbbells',
        expect.objectContaining({ method: 'PUT' }),
      ),
    );
    const saveCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input).endsWith('/system-profiles/dumbbells') && init?.method === 'PUT',
    );
    expect(JSON.parse(String(saveCall?.[1]?.body))).toEqual({
      weightsKg: [10, 12.5],
      exerciseIds: ['dumbbell-press'],
    });

    await user.click(screen.getByRole('button', { name: 'Edit Barbell profile' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText('Large / thick diameter')).toBeInTheDocument();
    expect(dialog.getByText('Small / thin diameter')).toBeInTheDocument();
  });
});
