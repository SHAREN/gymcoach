import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ReturnToTrainingNotice } from './return-to-training-notice';
import type { ReturnRecommendation } from '@/lib/return-to-training';

const recommendation: ReturnRecommendation = {
  mode: 'exercise-reintro',
  exerciseGapDays: 3,
  returnGapDays: 87,
  muscleGapDays: 3,
  muscleMaintained: true,
  recentMuscleSets: 4,
  baselineMuscleSetsPer28Days: 10,
  recentVolumeRatio: 0.4,
  targetSets: 2,
  targetRIR: 3,
  weightCeiling: 70,
  suggestedWeight: 60,
  startFraction: 0.8,
  calibrationRequired: true,
  historySessionCount: 4,
  recentHistorySessionCount: 1,
  longTermHistorySessionCount: 3,
  nonComparableHistorySessionCount: 2,
  historyBasis: 'recent-and-long-term',
  confidence: 'medium',
};

describe('ReturnToTrainingNotice', () => {
  it('shows confidence, recent and long-term evidence, the preserved gap, and calibration limits', () => {
    render(
      <ReturnToTrainingNotice recommendation={recommendation} unit="KG" usesBodyweight={false} />,
    );

    expect(screen.getByTestId('return-history-confidence')).toHaveTextContent(
      'History confidence: medium.',
    );
    expect(
      screen.getByText(
        '1 recent exact-equipment session(s) are primary and checked against 3 older exact-equipment session(s).',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'The latest exact session was recent, but it followed a 87-day gap, so calibration remains active.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        '2 session(s) from other or unlinked equipment were not converted into this load.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Sets today: 2. Target RIR: 3.')).toBeInTheDocument();
    expect(screen.getByText('Conservative starting load: 60 kg.')).toBeInTheDocument();
    expect(
      screen.getByText('Do not exceed the history-based ceiling today: 70 kg.'),
    ).toBeInTheDocument();
  });
});
