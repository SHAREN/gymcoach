import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SetValuePicker } from './set-value-picker';

describe('SetValuePicker', () => {
  it('keeps a saved option pending until explicit confirmation', () => {
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

    const option = screen.getByRole('button', { name: '67.5 kg' });
    fireEvent.click(option);
    expect(onChoose).not.toHaveBeenCalled();
    expect(option).toHaveAttribute('data-picker-selected', 'true');
    expect(screen.getByRole('textbox', { name: 'Manual weight' })).toHaveTextContent('67.5');

    fireEvent.click(screen.getByRole('button', { name: 'Apply value' }));
    expect(onChoose).toHaveBeenCalledWith(67.5);
  });

  it('uses the on-screen keypad and shows a barbell-side calculation', () => {
    const onChoose = vi.fn();
    render(
      <SetValuePicker
        open
        kind="weight"
        value={65}
        options={[65, 70]}
        unit="KG"
        loadConstraints={{
          equipmentType: 'BARBELL',
          barWeights: [20],
          plateWeights: [20, 5, 2.5],
        }}
        onClose={vi.fn()}
        onChoose={onChoose}
      />,
    );

    const diagram = screen.getByTestId('barbell-side-diagram');
    expect(diagram).toHaveTextContent('20');
    expect(diagram).toHaveTextContent('2.5');
    expect(diagram).toHaveTextContent('Bar 20 kg');

    fireEvent.click(screen.getByRole('button', { name: 'Delete last digit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete last digit' }));
    const keypad = within(screen.getByTestId('set-value-keypad'));
    fireEvent.click(keypad.getByRole('button', { name: '7' }));
    fireEvent.click(keypad.getByRole('button', { name: '0' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply value' }));

    expect(onChoose).toHaveBeenCalledWith(70);
  });

  it('rounds manual repetition values to a positive integer', () => {
    const onChoose = vi.fn();
    render(
      <SetValuePicker
        open
        kind="reps"
        value={10}
        options={[8, 10, 12]}
        unit="KG"
        onClose={vi.fn()}
        onChoose={onChoose}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '12 reps' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply value' }));
    expect(onChoose).toHaveBeenCalledWith(12);
  });
});
