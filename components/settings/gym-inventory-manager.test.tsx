import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

  it('shows shared plate pools, per-machine multiplier, and derived coverage', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
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
                  name: 'Lat pulldown',
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
                  requiresEquipmentSelection: false,
                  attainableLoadsKg: [5, 10, 15],
                  equipmentOptions: [],
                  equipmentIds: ['cable-1'],
                  preferredEquipmentId: null,
                },
              ],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    render(<GymInventoryManager gymId="gym-1" onModeChanged={vi.fn()} />);

    expect(await screen.findByText('Olympic 50 mm')).toBeInTheDocument();
    expect(screen.getByText('20 kg x 4')).toBeInTheDocument();
    expect(screen.getByText('Lat pulldown')).toBeInTheDocument();
    expect(screen.getByText(/displayed load x 0.5/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Linked physical equipment')).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Edit equipment' }));
    const preferredButton = screen.getByRole('button', {
      name: 'Use this equipment by default for Lat Pulldown',
    });
    await user.click(preferredButton);
    expect(preferredButton).toHaveAttribute('aria-pressed', 'true');
  });
});
