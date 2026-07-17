import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { history as englishHistory } from '@/messages/en/history';
import { history as russianHistory } from '@/messages/ru/history';
import { TrackDecoupling } from './track-decoupling';

const steady = Array.from({ length: 11 }, (_, index) => {
  const t = index * 120;
  return { t, d: t * 3, hr: 150 };
});

describe('TrackDecoupling', () => {
  it('renders neutral English copy and the applicability limitations', () => {
    render(<TrackDecoupling track={steady} locale="en" copy={englishHistory.detail.decoupling} />);

    expect(screen.getByTestId('track-decoupling')).toHaveTextContent(
      'Pace / heart-rate change estimate',
    );
    expect(screen.getByText('0.0%')).toBeInTheDocument();
    expect(screen.getByText(/two equal elapsed-time halves/)).toBeInTheDocument();
    expect(screen.getByText(/Positive means the recorded cost was higher/)).toBeInTheDocument();
    expect(screen.getByText(/does not prove aerobic fitness/)).toBeInTheDocument();
    expect(screen.queryByText(/lower is better|held steady|faded/i)).not.toBeInTheDocument();
  });

  it('renders the Russian copy and locale-specific number formatting', () => {
    render(<TrackDecoupling track={steady} locale="ru" copy={russianHistory.detail.decoupling} />);

    const readout = screen.getByTestId('track-decoupling');
    expect(readout).toHaveTextContent('Оценка изменения темпа относительно пульса');
    expect(readout).toHaveTextContent(/0,0\s?%/);
    expect(readout).toHaveTextContent(/Положительное значение означает/);
    expect(readout).toHaveTextContent(/Она не доказывает уровень аэробной формы/);
  });

  it('shows a large negative result without converting it into a verdict', () => {
    const negativeSplit = steady.map((point) => ({
      ...point,
      d: point.t <= 600 ? point.t : 600 + (point.t - 600) * 4,
    }));
    render(
      <TrackDecoupling track={negativeSplit} locale="en" copy={englishHistory.detail.decoupling} />,
    );

    expect(screen.getByText('-75.0%')).toBeInTheDocument();
    expect(screen.queryByText(/held steady|faded|improved|poor fitness/i)).not.toBeInTheDocument();
  });

  it('renders nothing when the track fails the calculation gates', () => {
    const { container } = render(
      <TrackDecoupling
        track={steady.map(({ t, d }) => ({ t, d }))}
        locale="en"
        copy={englishHistory.detail.decoupling}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
