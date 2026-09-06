import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PreviousSessionSets } from './previous-session-sets';

describe('PreviousSessionSets', () => {
  it('shows the selected equipment history and links to the workout and exercise progress', () => {
    render(
      <PreviousSessionSets
        performance={{
          sessionId: 'session-previous',
          sessionStartedAt: '2026-08-30T10:00:00.000Z',
          gymEquipmentId: 'machine-a',
          equipmentName: 'Press A',
          sets: [
            { weight: 70, reps: 10, rir: 2 },
            { weight: 75, reps: 8, rir: 1 },
          ],
          maxWeight: 75,
          repsAtMaxWeight: 8,
          cardio: null,
        }}
        exerciseId="exercise-1"
        unit="KG"
      />,
    );

    expect(screen.getByText('Equipment: Press A')).toBeInTheDocument();
    expect(screen.getByText('75 kg')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Full workout/ })).toHaveAttribute(
      'href',
      '/history/session-previous',
    );
    expect(screen.getByRole('link', { name: /Progress chart/ })).toHaveAttribute(
      'href',
      '/progress?exerciseId=exercise-1',
    );
  });

  it('renders nothing without prior sets', () => {
    const { container } = render(
      <PreviousSessionSets performance={undefined} exerciseId="exercise-1" unit="KG" />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
