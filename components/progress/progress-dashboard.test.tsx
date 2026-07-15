import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProgressDashboard } from './progress-dashboard';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

Element.prototype.hasPointerCapture = vi.fn(() => false);
Element.prototype.setPointerCapture = vi.fn();
Element.prototype.releasePointerCapture = vi.fn();
Element.prototype.scrollIntoView = vi.fn();
vi.stubGlobal(
  'ResizeObserver',
  class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  LineChart: ({ children, data }: { children: ReactNode; data: { value: number }[] }) => (
    <div data-testid="exercise-line-chart" data-values={data.map((point) => point.value).join(',')}>
      {children}
    </div>
  ),
  Line: ({ name }: { name: string }) => <div data-testid="exercise-line-series">{name}</div>,
  BarChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Bar: () => null,
  CartesianGrid: () => null,
  Legend: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

function renderDashboard() {
  return render(
    <ProgressDashboard
      exercises={[{ id: 'bench', name: 'Bench Press', muscleGroup: 'CHEST' }]}
      selectedExerciseId="bench"
      exercisePoints={[
        {
          date: '2026-07-01',
          sessionStartedAt: new Date('2026-07-01T10:00:00.000Z'),
          maxWeight: 100,
          topSetReps: 5,
          maxReps: 5,
          totalReps: 15,
          estimated1RM: 116.7,
          totalVolume: 1500,
        },
      ]}
      weeklyPoints={[]}
      volumeLandmarks={null}
      defaultBand={{ mev: 10, mrv: 20 }}
      recap={[]}
      unit="KG"
      selectedGoal={null}
      selectedBestE1RM={0}
      selectedUsesBodyweight={false}
    />,
  );
}

describe('ProgressDashboard exercise metric', () => {
  it('defaults to estimated 1RM and still switches to maximum load', async () => {
    const user = userEvent.setup({ delay: null });
    const { unmount } = renderDashboard();

    const metric = screen.getByRole('combobox', { name: 'Metric' });
    expect(metric).toHaveTextContent('Estimated 1RM');
    expect(screen.getByTestId('exercise-line-series')).toHaveTextContent('Estimated 1RM (kg)');
    expect(screen.getByTestId('exercise-line-chart')).toHaveAttribute('data-values', '116.7');

    await user.click(metric);
    await user.click(screen.getByRole('option', { name: 'Maximum load' }));

    expect(metric).toHaveTextContent('Maximum load');
    expect(screen.getByTestId('exercise-line-series')).toHaveTextContent('Maximum load (kg)');
    expect(screen.getByTestId('exercise-line-chart')).toHaveAttribute('data-values', '100');

    unmount();
    renderDashboard();

    expect(screen.getByRole('combobox', { name: 'Metric' })).toHaveTextContent('Estimated 1RM');
    expect(screen.getByTestId('exercise-line-series')).toHaveTextContent('Estimated 1RM (kg)');
    expect(screen.getByTestId('exercise-line-chart')).toHaveAttribute('data-values', '116.7');
  });
});
