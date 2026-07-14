import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HistoryCalendar, type HistoryCalendarSession } from './history-calendar';

const push = vi.fn();
const replace = vi.fn();
const router = { push, replace };

vi.mock('next/navigation', () => ({
  useRouter: () => router,
}));

const sessions: HistoryCalendarSession[] = [
  {
    id: 'morning',
    startedAt: '2026-05-02T08:00:00.000Z',
    title: 'Push day',
    programName: 'Strength',
    workingSets: 5,
    volume: 3200,
    durationMin: 55,
    cardio: null,
  },
  {
    id: 'evening',
    startedAt: '2026-05-02T18:00:00.000Z',
    title: 'Running',
    programName: null,
    workingSets: 1,
    volume: 0,
    durationMin: 30,
    cardio: { distanceM: 5000, durationSec: 1800, avgHr: 151 },
  },
];

function renderCalendar() {
  return render(
    <HistoryCalendar
      sessions={sessions}
      visibleMonth="2026-05"
      initialDay="2026-05-02"
      selectedProgramId="program-1"
      monthWasProvided
      unit="KG"
    />,
  );
}

beforeEach(() => {
  push.mockClear();
  replace.mockClear();
});

describe('HistoryCalendar', () => {
  it('marks workout days accessibly and shows every session for the selected date', () => {
    renderCalendar();

    expect(screen.getByRole('button', { name: /May 2, 2026\. 2 workouts/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('link', { name: /Open Push day/ })).toHaveAttribute(
      'href',
      '/history/morning?month=2026-05&day=2026-05-02&programId=program-1',
    );
    expect(screen.getByRole('link', { name: /Open Running/ })).toHaveAttribute(
      'href',
      '/history/evening?month=2026-05&day=2026-05-02&programId=program-1',
    );
    expect(screen.getByText('5 km')).toBeInTheDocument();
    expect(screen.getByText('151 bpm')).toBeInTheDocument();
  });

  it('shows a compact empty message after selecting a day without a workout', async () => {
    const user = userEvent.setup({ delay: null });
    renderCalendar();

    await user.click(screen.getByRole('button', { name: /May 3, 2026\. No workouts/ }));
    expect(screen.getByText('No completed workouts on this day.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Open Push day/ })).not.toBeInTheDocument();
  });

  it('supports arrow-key movement between calendar days', async () => {
    const user = userEvent.setup({ delay: null });
    renderCalendar();
    const mayTwo = screen.getByRole('button', { name: /May 2, 2026\. 2 workouts/ });
    const mayThree = screen.getByRole('button', { name: /May 3, 2026\. No workouts/ });

    mayTwo.focus();
    await user.keyboard('{ArrowRight}');
    expect(mayThree).toHaveFocus();
  });

  it('preserves the program filter while changing months', async () => {
    const user = userEvent.setup({ delay: null });
    renderCalendar();

    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(push).toHaveBeenCalledWith('/history?month=2026-04&programId=program-1');
  });
});
