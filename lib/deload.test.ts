import { describe, it, expect } from 'vitest';
import {
  DELOAD_READINESS_LOOKBACK,
  DELOAD_READINESS_MIN_CHECKINS,
  DELOAD_READINESS_THRESHOLD,
  DELOAD_STALLED_LIFTS_MIN,
  deloadReasonLine,
  isDeloadActive,
  recommendDeload,
  type DeloadActivityInput,
} from './deload';

const now = new Date('2026-07-30T12:00:00Z');
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);
const session = (id: string, days: number, workingSetCount = 10) => ({
  sessionId: id,
  performedAt: daysAgo(days),
  workingSetCount,
});
const continuedActivity = (): DeloadActivityInput => ({
  now,
  plannedWeeklyFrequency: 3,
  sessions: [
    session('recent', 2),
    session('baseline-1', 21),
    session('baseline-2', 28),
    session('baseline-3', 35),
    session('baseline-4', 42),
  ],
});

describe('recommendDeload', () => {
  it('recommends nothing when no lift is stalled and readiness is fine', () => {
    const result = recommendDeload({
      stalledExerciseNames: [],
      recentReadiness: [4, 5, 4, 3, 4],
      activity: continuedActivity(),
    });
    expect(result.recommended).toBe(false);
    expect(result.reasons).toEqual([]);
  });

  it('triggers on enough stalled lifts', () => {
    const result = recommendDeload({
      stalledExerciseNames: ['Bench press', 'Squat'],
      recentReadiness: [4, 4, 4],
      activity: continuedActivity(),
    });
    expect(result.recommended).toBe(true);
    expect(result.reasons).toEqual([
      { kind: 'stalled-lifts', exerciseNames: ['Bench press', 'Squat'] },
    ]);
  });

  it('does not trigger below the stalled-lifts minimum', () => {
    const result = recommendDeload({
      stalledExerciseNames: ['Bench press'],
      recentReadiness: [],
      activity: continuedActivity(),
    });
    expect(DELOAD_STALLED_LIFTS_MIN).toBeGreaterThan(1);
    expect(result.recommended).toBe(false);
  });

  it('triggers on chronically low readiness', () => {
    const result = recommendDeload({
      stalledExerciseNames: [],
      recentReadiness: [2, 1, 2, 2, 3],
      activity: continuedActivity(),
    });
    expect(result.recommended).toBe(true);
    expect(result.reasons).toEqual([{ kind: 'low-readiness', averageReadiness: 2, checkins: 5 }]);
  });

  it('averages only the most recent lookback window, newest first', () => {
    // Five recent low scores followed by old high ones: the old scores must
    // not dilute the average below the trigger.
    const result = recommendDeload({
      stalledExerciseNames: [],
      recentReadiness: [2, 2, 2, 2, 2, 5, 5, 5, 5],
      activity: continuedActivity(),
    });
    expect(result.reasons).toEqual([
      {
        kind: 'low-readiness',
        averageReadiness: 2,
        checkins: DELOAD_READINESS_LOOKBACK,
      },
    ]);
  });

  it('needs a minimum number of check-ins before the readiness trigger fires', () => {
    const tooFew = Array(DELOAD_READINESS_MIN_CHECKINS - 1).fill(1);
    const result = recommendDeload({
      stalledExerciseNames: [],
      recentReadiness: tooFew,
      activity: continuedActivity(),
    });
    expect(result.recommended).toBe(false);
  });

  it('does not trigger when the average sits above the threshold', () => {
    // Average 2.6 with threshold 2: close, but recovery is not chronic.
    const result = recommendDeload({
      stalledExerciseNames: [],
      recentReadiness: [3, 2, 3, 2, 3],
      activity: continuedActivity(),
    });
    expect(DELOAD_READINESS_THRESHOLD).toBe(2);
    expect(result.recommended).toBe(false);
  });

  it('reports both reasons when both triggers hold', () => {
    const result = recommendDeload({
      stalledExerciseNames: ['Bench press', 'Squat', 'Deadlift'],
      recentReadiness: [1, 2, 2],
      activity: continuedActivity(),
    });
    expect(result.recommended).toBe(true);
    expect(result.reasons.map((r) => r.kind)).toEqual(['stalled-lifts', 'low-readiness']);
  });

  it('rounds the reported average to one decimal', () => {
    const result = recommendDeload({
      stalledExerciseNames: [],
      recentReadiness: [1, 2, 2],
      activity: continuedActivity(),
    });
    expect(result.reasons).toEqual([{ kind: 'low-readiness', averageReadiness: 1.7, checkins: 3 }]);
  });

  it('routes the owner zero-load recovery week to return instead of another deload', () => {
    const result = recommendDeload({
      stalledExerciseNames: ['Bench Press', 'Squat'],
      recentReadiness: [4, 4, 4],
      latestRecovery: { sleepQuality: 4, soreness: {} },
      activity: {
        now,
        plannedWeeklyFrequency: 3,
        sessions: [
          session('last', 12.6, 10),
          session('within-28-2', 18, 10),
          session('within-28-3', 23, 10),
          session('within-28-4', 26, 10),
          session('within-28-5', 27, 10),
          session('baseline-1', 32, 10),
          session('baseline-2', 39, 10),
          session('baseline-3', 46, 10),
          session('baseline-4', 53, 10),
          session('baseline-5', 60, 10),
          session('baseline-6', 67, 10),
        ],
      },
    });

    expect(result.state).toBe('recovery-break-completed');
    expect(result.recommended).toBe(false);
    expect(result.activity).toMatchObject({
      daysSinceLastMeaningfulWorkout: 12.6,
      recent7DayCompletedWorkouts: 0,
      recent7DayWorkingSets: 0,
      actualWeeklyFrequency28Days: 1.25,
      plannedWeeklyFrequency: 3,
      averageReadiness: 4,
      latestSleepQuality: 4,
      maxReportedSoreness: null,
    });
  });

  it('keeps stalls as analysis-only when load evidence is insufficient', () => {
    const result = recommendDeload({
      stalledExerciseNames: ['Bench Press', 'Squat'],
      recentReadiness: [],
      activity: { now, sessions: [] },
    });

    expect(result.state).toBe('stall-signal');
    expect(result.recommended).toBe(false);
  });

  it('does not call a break recovered when current soreness still blocks recovery', () => {
    const result = recommendDeload({
      stalledExerciseNames: ['Bench Press', 'Squat'],
      recentReadiness: [4, 4, 4],
      latestRecovery: { sleepQuality: 4, soreness: { CHEST: 4 } },
      activity: {
        now,
        sessions: [
          session('last', 12.6, 10),
          session('baseline-1', 21, 10),
          session('baseline-2', 28, 10),
          session('baseline-3', 35, 10),
          session('baseline-4', 42, 10),
        ],
      },
    });

    expect(result.state).toBe('planned-deload');
    expect(result.activity.maxReportedSoreness).toBe(4);
  });

  it('recommends a planned deload when high load continues with fatigue signals', () => {
    const result = recommendDeload({
      stalledExerciseNames: ['Bench Press', 'Squat'],
      recentReadiness: [2, 2, 2],
      activity: continuedActivity(),
    });

    expect(result.state).toBe('planned-deload');
    expect(result.recommended).toBe(true);
    expect(result.activity.workingSetRatio).toBe(1);
    expect(result.activity.sessionFrequencyRatio).toBe(1);
  });

  it('deduplicates sessions and ignores invalid or zero-set rows', () => {
    const result = recommendDeload({
      stalledExerciseNames: [],
      recentReadiness: [4],
      activity: {
        now,
        sessions: [
          session('same', 2, 4),
          session('same', 2, 4),
          session('empty', 1, 0),
          { sessionId: 'future', performedAt: daysAgo(-1), workingSetCount: 10 },
        ],
      },
    });

    expect(result.activity.recent7DayCompletedWorkouts).toBe(1);
    expect(result.activity.recent7DayWorkingSets).toBe(4);
  });
});

describe('deloadReasonLine', () => {
  it('formats a single stalled lift', () => {
    expect(deloadReasonLine({ kind: 'stalled-lifts', exerciseNames: ['Bench'] })).toBe(
      '1 lift has stalled: Bench.',
    );
  });

  it('formats several stalled lifts', () => {
    expect(deloadReasonLine({ kind: 'stalled-lifts', exerciseNames: ['Bench', 'Squat'] })).toBe(
      '2 lifts have stalled: Bench, Squat.',
    );
  });

  it('formats chronically low readiness', () => {
    expect(deloadReasonLine({ kind: 'low-readiness', averageReadiness: 2.3, checkins: 4 })).toBe(
      'Your readiness has averaged 2.3/5 over your last 4 check-ins.',
    );
  });
});

// One-tap planned deload week (issue #112): activity window semantics.
describe('isDeloadActive', () => {
  const now = new Date('2026-06-11T12:00:00Z');

  it('is inactive when deloadUntil is null', () => {
    expect(isDeloadActive(null, now)).toBe(false);
  });

  it('is active while deloadUntil is in the future', () => {
    expect(isDeloadActive(new Date('2026-06-18T12:00:00Z'), now)).toBe(true);
    expect(isDeloadActive(new Date('2026-06-11T12:00:01Z'), now)).toBe(true);
  });

  it('expires: a past or exactly-now deloadUntil has no effect', () => {
    expect(isDeloadActive(new Date('2026-06-04T12:00:00Z'), now)).toBe(false);
    expect(isDeloadActive(new Date('2026-06-11T12:00:00Z'), now)).toBe(false);
  });
});
