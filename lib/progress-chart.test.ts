import { describe, expect, it } from 'vitest';
import type { ExerciseChartPoint } from './stats';
import {
  buildCompressedExerciseTimeline,
  filterExercisePointsByRange,
  MAX_PROGRESS_CHART_GAP_RATIO,
  pickProgressChartTicks,
} from './progress-chart';

function point(date: string): ExerciseChartPoint {
  return {
    date: date.slice(0, 10),
    sessionStartedAt: new Date(date),
    maxWeight: 100,
    topSetReps: 5,
    maxReps: 8,
    totalReps: 20,
    estimated1RM: 116.7,
    totalVolume: 1800,
  };
}

describe('filterExercisePointsByRange', () => {
  const now = new Date('2026-07-13T12:00:00Z');
  const points = [
    point('2025-07-13T12:00:00Z'),
    point('2026-01-14T12:00:00Z'),
    point('2026-06-13T12:00:00Z'),
    point('2026-07-06T12:00:00Z'),
  ];

  it('uses rolling day windows and includes the exact boundary', () => {
    expect(filterExercisePointsByRange(points, '1w', now)).toHaveLength(1);
    expect(filterExercisePointsByRange(points, '1m', now)).toHaveLength(2);
    expect(filterExercisePointsByRange(points, '6m', now)).toHaveLength(3);
    expect(filterExercisePointsByRange(points, '1y', now)).toHaveLength(4);
  });

  it('keeps all points for the all-history range', () => {
    expect(filterExercisePointsByRange(points, 'all', now)).toEqual(points);
  });
});

describe('buildCompressedExerciseTimeline', () => {
  it('keeps active clusters close and caps a long break at three ordinary gaps', () => {
    const timeline = buildCompressedExerciseTimeline([
      point('2026-01-01T10:00:00Z'),
      point('2026-01-04T10:00:00Z'),
      point('2026-01-07T10:00:00Z'),
      point('2026-02-07T10:00:00Z'),
      point('2026-02-10T10:00:00Z'),
      point('2026-02-13T10:00:00Z'),
    ]);

    expect(timeline.map((item) => item.chartX)).toEqual([0, 1, 2, 5, 6, 7]);
    expect(timeline[3]!.gapWasCompressed).toBe(true);
    expect(timeline[3]!.gapDays).toBe(31);
    expect(timeline[3]!.chartX - timeline[2]!.chartX).toBe(MAX_PROGRESS_CHART_GAP_RATIO);
  });

  it('preserves proportional gaps below the cap and sorts input chronologically', () => {
    const timeline = buildCompressedExerciseTimeline([
      point('2026-01-07T10:00:00Z'),
      point('2026-01-01T10:00:00Z'),
      point('2026-01-03T10:00:00Z'),
    ]);

    expect(timeline.map((item) => item.date)).toEqual(['2026-01-01', '2026-01-03', '2026-01-07']);
    expect(timeline.map((item) => item.chartX)).toEqual([0, 1, 3]);
    expect(timeline.every((item) => !item.gapWasCompressed)).toBe(true);
  });
});

describe('pickProgressChartTicks', () => {
  it('returns a bounded, ordered set that includes the endpoints', () => {
    const ticks = pickProgressChartTicks(
      [0, 1, 2, 5, 6, 7, 10].map((chartX) => ({ chartX })),
      4,
    );

    expect(ticks).toHaveLength(4);
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBe(10);
    expect(ticks).toEqual([...ticks].sort((a, b) => a - b));
  });
});
