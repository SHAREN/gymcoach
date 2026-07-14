import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionControlsDialog } from './session-controls-dialog';

afterEach(() => {
  vi.useRealTimers();
});

function renderControls(overrides: Partial<Parameters<typeof SessionControlsDialog>[0]> = {}) {
  const props: Parameters<typeof SessionControlsDialog>[0] = {
    workoutName: 'Monday',
    startedAt: new Date('2026-07-13T10:00:00.000Z'),
    onComplete: vi.fn(),
    onPause: vi.fn(),
    onReset: vi.fn().mockResolvedValue(true),
    ...overrides,
  };

  render(<SessionControlsDialog {...props} />);
  return props;
}

describe('SessionControlsDialog', () => {
  it('moves completion and pause into the day controls dialog', () => {
    const props = renderControls();

    fireEvent.click(screen.getByRole('button', { name: 'Manage Monday' }));
    fireEvent.click(screen.getByRole('button', { name: 'Complete' }));
    expect(props.onComplete).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'Manage Monday' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(props.onPause).toHaveBeenCalledOnce();
  });

  it('keeps reset confirmation disabled for three seconds', () => {
    vi.useFakeTimers();
    const props = renderControls();

    fireEvent.click(screen.getByRole('button', { name: 'Manage Monday' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

    expect(screen.getByRole('button', { name: 'Reset in 3s' })).toBeDisabled();

    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByRole('button', { name: 'Reset in 1s' })).toBeDisabled();

    act(() => vi.advanceTimersByTime(1000));
    const confirm = screen.getByRole('button', { name: 'Reset session' });
    expect(confirm).toBeEnabled();

    fireEvent.click(confirm);
    expect(props.onReset).toHaveBeenCalledOnce();
  });
});
