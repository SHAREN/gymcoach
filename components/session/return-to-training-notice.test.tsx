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
  calibrationKind: 'return',
  strengthSummary: {
    movement: {
      sessionCount: 4,
      workingSetCount: 12,
      lastPerformedAt: '2026-07-09T10:00:00.000Z',
      lastReliableLoad: 70,
      recentStrengthAnchor: 80,
      historicalStrengthAnchor: 78,
      confidence: 'medium',
    },
    equipment: {
      sessionCount: 4,
      workingSetCount: 12,
      lastPerformedAt: '2026-07-09T10:00:00.000Z',
      lastReliableLoad: 70,
      recentStrengthAnchor: 80,
      historicalStrengthAnchor: 78,
      confidence: 'medium',
    },
    anchorScope: 'exact-equipment',
  },
};

describe('ReturnToTrainingNotice', () => {
  it('shows confidence, recent and long-term evidence, the preserved gap, and calibration limits', () => {
    render(
      <ReturnToTrainingNotice recommendation={recommendation} unit="KG" usesBodyweight={false} />,
    );

    expect(screen.getByTestId('return-history-confidence')).toHaveTextContent(
      'Movement familiarity: medium confidence.',
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

  it('separates familiar movement confidence from unknown current-equipment load', () => {
    render(
      <ReturnToTrainingNotice
        recommendation={{
          ...recommendation,
          mode: 'normal',
          calibrationKind: 'equipment',
          exerciseGapDays: 14,
          returnGapDays: 14,
          historySessionCount: 0,
          recentHistorySessionCount: 0,
          longTermHistorySessionCount: 0,
          historyBasis: 'none',
          confidence: 'low',
          strengthSummary: {
            anchorScope: 'exact-exercise-unlinked',
            movement: {
              ...recommendation.strengthSummary.movement,
              sessionCount: 25,
              workingSetCount: 117,
              confidence: 'high',
            },
            equipment: {
              sessionCount: 0,
              workingSetCount: 0,
              lastPerformedAt: null,
              lastReliableLoad: null,
              recentStrengthAnchor: null,
              historicalStrengthAnchor: null,
              confidence: 'low',
            },
          },
        }}
        unit="KG"
        usesBodyweight={false}
      />,
    );

    expect(screen.getByText('Calibration on current equipment')).toBeInTheDocument();
    expect(
      screen.getByText(
        'This movement is well known from 25 recorded session(s), but the stored loads cannot be treated as exact values for this specific machine.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Movement familiarity: high confidence.')).toBeInTheDocument();
    expect(screen.getByText('Load on this equipment: low confidence.')).toBeInTheDocument();
    expect(screen.queryByText('History confidence: low.')).not.toBeInTheDocument();
  });
});
