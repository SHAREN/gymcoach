import { describe, expect, it, vi } from 'vitest';
import { buildMobileExerciseSeries, buildMobileWeeklyVolume } from '@/lib/mobile-progress';

vi.mock('@/lib/db', () => ({ db: {} }));

describe('buildMobileExerciseSeries', () => {
  it('serializes the same bodyweight-adjusted per-session points as exerciseProgress', () => {
    const result = buildMobileExerciseSeries(
      [
        {
          id: 'pullup',
          name: 'Pull-up',
          muscleGroup: 'BACK_WIDTH',
          usesBodyweight: true,
          sets: [
            {
              weight: 0,
              reps: 5,
              isWarmup: true,
              durationSec: null,
              sessionId: 'session-2',
              session: { startedAt: new Date('2026-07-08T10:00:00.000Z') },
            },
            {
              weight: 10,
              reps: 6,
              isWarmup: false,
              durationSec: null,
              sessionId: 'session-2',
              session: { startedAt: new Date('2026-07-08T10:00:00.000Z') },
            },
            {
              weight: 5,
              reps: 10,
              isWarmup: false,
              durationSec: null,
              sessionId: 'session-2',
              session: { startedAt: new Date('2026-07-08T10:00:00.000Z') },
            },
            {
              weight: 7.5,
              reps: 8,
              isWarmup: false,
              durationSec: null,
              sessionId: 'session-1',
              session: { startedAt: new Date('2026-07-01T10:00:00.000Z') },
            },
            {
              weight: 0,
              reps: 1,
              isWarmup: false,
              durationSec: 900,
              sessionId: 'session-cardio-marker',
              session: { startedAt: new Date('2026-07-09T10:00:00.000Z') },
            },
          ],
        },
      ],
      70,
    );

    expect(result).toEqual([
      {
        id: 'pullup',
        name: 'Pull-up',
        muscleGroup: 'BACK_WIDTH',
        points: [
          {
            sessionStartedAt: '2026-07-01T10:00:00.000Z',
            maxWeight: 77.5,
            estimated1RM: 98.2,
            totalVolume: 620,
            topSetReps: 8,
            maxReps: 8,
            totalReps: 8,
          },
          {
            sessionStartedAt: '2026-07-08T10:00:00.000Z',
            maxWeight: 80,
            estimated1RM: 96,
            totalVolume: 1230,
            topSetReps: 6,
            maxReps: 10,
            totalReps: 16,
          },
        ],
      },
    ]);
  });
});

describe('buildMobileWeeklyVolume', () => {
  it('uses bodyweight-effective load and preserves the web warmup/cardio exclusions', () => {
    const weekOne = new Date('2026-07-01T10:00:00.000Z');
    const weekTwo = new Date('2026-07-08T10:00:00.000Z');
    const result = buildMobileWeeklyVolume(
      [
        {
          weight: 80,
          reps: 10,
          isWarmup: false,
          durationSec: null,
          distanceM: null,
          sessionId: 'bench-1',
          exercise: { muscleGroup: 'CHEST', usesBodyweight: false },
          session: { startedAt: weekOne },
        },
        {
          weight: 20,
          reps: 10,
          isWarmup: true,
          durationSec: null,
          distanceM: null,
          sessionId: 'warmup',
          exercise: { muscleGroup: 'CHEST', usesBodyweight: false },
          session: { startedAt: weekOne },
        },
        {
          weight: 10,
          reps: 6,
          isWarmup: false,
          durationSec: null,
          distanceM: null,
          sessionId: 'pullup-1',
          exercise: { muscleGroup: 'BACK_WIDTH', usesBodyweight: true },
          session: { startedAt: weekTwo },
        },
        {
          weight: 0,
          reps: 1,
          isWarmup: false,
          durationSec: 1_800,
          distanceM: 5_000,
          sessionId: 'run-1',
          exercise: { muscleGroup: 'OTHER', usesBodyweight: false },
          session: { startedAt: weekTwo },
        },
      ],
      70,
    );

    expect(result).toEqual([
      {
        weekKey: '2026-W27',
        weekStartIso: '2026-06-29T00:00:00.000Z',
        byMuscleGroup: { CHEST: 800 },
        total: 800,
      },
      {
        weekKey: '2026-W28',
        weekStartIso: '2026-07-06T00:00:00.000Z',
        byMuscleGroup: { BACK_WIDTH: 480 },
        total: 480,
      },
    ]);
  });
});
