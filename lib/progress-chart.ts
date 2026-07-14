import type { ExerciseChartPoint } from '@/lib/stats';

const DAY_MS = 24 * 60 * 60 * 1000;

export const MAX_PROGRESS_CHART_GAP_RATIO = 3;

export const progressChartRanges = ['1w', '1m', '2m', '4m', '6m', '1y', 'all'] as const;

export type ProgressChartRange = (typeof progressChartRanges)[number];

const RANGE_DAYS: Record<Exclude<ProgressChartRange, 'all'>, number> = {
  '1w': 7,
  '1m': 30,
  '2m': 60,
  '4m': 120,
  '6m': 180,
  '1y': 365,
};

export interface CompressedExerciseChartPoint extends ExerciseChartPoint {
  chartX: number;
  gapDays: number | null;
  gapWasCompressed: boolean;
}

export function filterExercisePointsByRange(
  points: ExerciseChartPoint[],
  range: ProgressChartRange,
  now: Date = new Date(),
): ExerciseChartPoint[] {
  if (range === 'all') return points;

  const cutoff = now.getTime() - RANGE_DAYS[range] * DAY_MS;
  return points.filter((point) => new Date(point.sessionStartedAt).getTime() >= cutoff);
}

export function buildCompressedExerciseTimeline(
  points: ExerciseChartPoint[],
): CompressedExerciseChartPoint[] {
  if (points.length === 0) return [];

  const sorted = [...points].sort(
    (a, b) => new Date(a.sessionStartedAt).getTime() - new Date(b.sessionStartedAt).getTime(),
  );
  const positiveGaps = sorted
    .slice(1)
    .map((point, index) => {
      const previous = sorted[index]!;
      return (
        new Date(point.sessionStartedAt).getTime() - new Date(previous.sessionStartedAt).getTime()
      );
    })
    .filter((gap) => gap > 0)
    .sort((a, b) => a - b);

  // The lower median represents the ordinary active-training cadence while
  // keeping long layoffs from defining the baseline spacing themselves.
  const baselineGap = positiveGaps[Math.floor((positiveGaps.length - 1) / 2)] ?? DAY_MS;

  let chartX = 0;
  return sorted.map((point, index) => {
    if (index === 0) {
      return { ...point, chartX, gapDays: null, gapWasCompressed: false };
    }

    const previous = sorted[index - 1]!;
    const gap = Math.max(
      0,
      new Date(point.sessionStartedAt).getTime() - new Date(previous.sessionStartedAt).getTime(),
    );
    const gapRatio = gap / baselineGap;
    chartX += Math.min(gapRatio, MAX_PROGRESS_CHART_GAP_RATIO);

    return {
      ...point,
      chartX,
      gapDays: gap / DAY_MS,
      gapWasCompressed: gapRatio > MAX_PROGRESS_CHART_GAP_RATIO,
    };
  });
}

export function pickProgressChartTicks(
  points: Pick<CompressedExerciseChartPoint, 'chartX'>[],
  maxTicks = 5,
): number[] {
  if (points.length <= maxTicks) return points.map((point) => point.chartX);
  if (maxTicks <= 1) return [points[0]!.chartX];

  const first = points[0]!.chartX;
  const last = points[points.length - 1]!.chartX;
  const ticks = new Set<number>();

  for (let index = 0; index < maxTicks; index += 1) {
    const target = first + ((last - first) * index) / (maxTicks - 1);
    const nearest = points.reduce((best, point) =>
      Math.abs(point.chartX - target) < Math.abs(best.chartX - target) ? point : best,
    );
    ticks.add(nearest.chartX);
  }

  return [...ticks].sort((a, b) => a - b);
}
