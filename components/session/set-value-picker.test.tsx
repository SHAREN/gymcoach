import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SetValuePicker } from './set-value-picker';

describe('SetValuePicker', () => {
  it('uses the on-screen keypad and renders one side of the saved barbell', () => {
    const onChoose = vi.fn();
    render(
      <SetValuePicker
        open
        kind="weight"
        value={65}
        options={[62.5, 65, 67.5, 70]}
        unit="KG"
        loadConstraints={{
          equipmentType: 'BARBELL',
          barWeights: [20],
          plateWeights: [20, 2.5, 1.25],
        }}
        onClose={vi.fn()}
        onChoose={onChoose}
      />,
    );

    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    const diagram = screen.getByTestId('barbell-side-diagram');
    expect(diagram).toHaveTextContent('20');
    expect(diagram).toHaveTextContent('2.5');
    expect(diagram).toHaveTextContent('Bar 20 kg');
    expect(within(diagram).getByTestId('barbell-shaft')).toHaveClass('inset-x-1', 'rounded-full');
    expect(within(diagram).getByTestId('barbell-layout')).toHaveClass(
      'grid-cols-[minmax(2.25rem,1.45fr)_max-content_minmax(1rem,0.85fr)]',
    );
    expect(within(diagram).getByTestId('barbell-plates')).toBeInTheDocument();
    expect(within(diagram).getByTestId('barbell-weight-label')).toHaveClass('text-center');
    expect(diagram.querySelector('svg')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Delete last digit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete last digit' }));
    const keypad = within(screen.getByTestId('set-value-keypad'));
    fireEvent.click(keypad.getByRole('button', { name: '7' }));
    fireEvent.click(keypad.getByRole('button', { name: '0' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply value' }));

    expect(onChoose).toHaveBeenCalledWith(70);
  });

  it('selects a saved gym option directly from the scrolling list', () => {
    const onChoose = vi.fn();
    render(
      <SetValuePicker
        open
        kind="weight"
        value={65}
        options={[62.5, 65, 67.5]}
        unit="KG"
        onClose={vi.fn()}
        onChoose={onChoose}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '67.5 kg' }));
    expect(onChoose).toHaveBeenCalledWith(67.5);
  });
});
