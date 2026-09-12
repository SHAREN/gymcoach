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

  it('keeps a saved gym option pending until the check button confirms it', () => {
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

  it('tracks the value under the fixed weight pointer while scrolling and only confirms on apply', () => {
    const onChoose = vi.fn();
    render(
      <SetValuePicker
        open
        kind="weight"
        value={60}
        options={[50, 60, 70]}
        unit="KG"
        onClose={vi.fn()}
        onChoose={onChoose}
      />,
    );

    const list = screen.getByTestId('weight-picker-list');
    const fifty = screen.getByRole('button', { name: '50 kg' });
    const sixty = screen.getByRole('button', { name: '60 kg' });
    const seventy = screen.getByRole('button', { name: '70 kg' });
    expect(screen.getByTestId('weight-picker-pointer-left')).toBeInTheDocument();
    expect(screen.getByTestId('weight-picker-pointer-right')).toBeInTheDocument();

    Object.defineProperty(list, 'clientHeight', { configurable: true, value: 300 });
    vi.spyOn(list, 'getBoundingClientRect').mockReturnValue({ top: 0, height: 300 } as DOMRect);
    vi.spyOn(fifty, 'getBoundingClientRect').mockReturnValue({ top: -48, height: 76 } as DOMRect);
    vi.spyOn(sixty, 'getBoundingClientRect').mockReturnValue({ top: 38, height: 76 } as DOMRect);
    vi.spyOn(seventy, 'getBoundingClientRect').mockReturnValue({ top: 112, height: 76 } as DOMRect);

    fireEvent.pointerDown(list);
    fireEvent.scroll(list);

    expect(onChoose).not.toHaveBeenCalled();
    expect(seventy).toHaveAttribute('data-picker-selected', 'true');
    expect(screen.getByRole('textbox', { name: 'Manual weight' })).toHaveTextContent('70');

    fireEvent.click(screen.getByRole('button', { name: 'Apply value' }));
    expect(onChoose).toHaveBeenCalledWith(70);
  });

  it('keeps a repetition option pending until the check button confirms it', () => {
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

    const option = screen.getByRole('button', { name: '12 reps' });
    fireEvent.click(option);

    expect(onChoose).not.toHaveBeenCalled();
    expect(option).toHaveAttribute('data-picker-selected', 'true');
    expect(screen.getByRole('textbox', { name: 'Manual repetitions' })).toHaveTextContent('12');

    fireEvent.click(screen.getByRole('button', { name: 'Apply value' }));
    expect(onChoose).toHaveBeenCalledWith(12);
  });
});
