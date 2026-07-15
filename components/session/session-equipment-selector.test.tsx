import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SessionEquipmentSelector } from './session-equipment-selector';

const options = [
  {
    equipmentId: 'cable-a',
    equipmentName: 'Cable A',
    equipmentType: 'CABLE',
    loadType: 'SELECTORIZED',
    weightOptions: [10, 20],
    selectedLoadMultiplier: 0.5,
    baseLoadKg: 0,
    loadingSides: 2,
    platePoolId: null,
    platePoolName: null,
    plates: [],
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
    loadingSides: 2,
    platePoolId: null,
    platePoolName: null,
    plates: [],
    attainableLoads: [15, 25],
    inventoryPrecision: 'NOT_APPLICABLE',
  },
] as const;

describe('SessionEquipmentSelector', () => {
  it('explains the selected machine multiplier and exposes alternatives', () => {
    render(
      <SessionEquipmentSelector
        options={options as never}
        selectedId="cable-a"
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText(/displayed load x 0.5/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('combobox', { name: 'Equipment used' }));
    expect(screen.getByRole('option', { name: 'Cable B' })).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: 'Legacy / manual load (no equipment snapshot)' }),
    ).toBeInTheDocument();
  });
});
