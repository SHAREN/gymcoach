import { describe, expect, it } from 'vitest';
import {
  serializeTrainingSession,
  summarizeMcpTrainingHistory,
  type McpHistorySessionRow,
} from './training-history';

const NOW = new Date('2026-07-13T12:00:00.000Z');

function session(
  id: string,
  startedAt: string,
  sets: Array<{
    muscleGroup?: string;
    category?: string;
    rir?: number | null;
    isWarmup?: boolean;
    isDropSet?: boolean;
    recoverySec?: number | null;
  }>,
): McpHistorySessionRow {
  return {
    id,
    userId: 'user-1',
    programId: '550e8400-e29b-41d4-a716-446655440000',
    workoutId: 'workout-1',
    startedAt: new Date(startedAt),
    finishedAt: new Date(new Date(startedAt).getTime() + 60 * 60 * 1000),
    notes: null,
    sessionRpe: 7,
    gymId: null,
    program: { id: '550e8400-e29b-41d4-a716-446655440000', name: 'Legacy plan' },
    workout: { id: 'workout-1', name: 'Full body' },
    sets: sets.map((set, index) => ({
      id: `${id}-set-${index}`,
      sessionId: id,
      exerciseId: `${id}-exercise-${index}`,
      gymEquipmentId: null,
      equipmentNameSnapshot: null,
      selectedLoadKg: null,
      selectedLoadMultiplierSnapshot: null,
      nominalResistanceKg: null,
      equipmentLoadSnapshot: null,
      setNumber: index + 1,
      weight: 60,
      reps: 10,
      rir: set.rir ?? null,
      durationSec: null,
      distanceM: null,
      avgHr: null,
      maxHr: null,
      track: null,
      notes: null,
      isWarmup: set.isWarmup ?? false,
      isDropSet: set.isDropSet ?? false,
      recoverySec: set.recoverySec ?? null,
      completedAt: new Date(new Date(startedAt).getTime() + index * 60_000),
      exercise: {
        id: `${id}-exercise-${index}`,
        name: set.category === 'CARDIO' ? 'Running' : 'Bench press',
        muscleGroup: (set.muscleGroup ?? 'CHEST') as never,
        category: (set.category ?? 'COMPOUND') as never,
        equipmentType: set.category === 'CARDIO' ? 'CARDIO' : 'BARBELL',
        usesBodyweight: false,
      },
    })),
  } as McpHistorySessionRow;
}

describe('MCP training history summary', () => {
  it('keeps calendar weeks visible and compares the last 7 days with a 42-day baseline', () => {
    const rows = [
      session('older-1', '2026-06-08T12:00:00.000Z', [{ rir: 2 }, { rir: 2 }]),
      session('older-2', '2026-06-22T12:00:00.000Z', [{ rir: 2 }, { rir: 2 }]),
      session('recent', '2026-07-10T12:00:00.000Z', [
        { isWarmup: true },
        { rir: 2 },
        { rir: null },
        { rir: 0, isDropSet: true },
        { category: 'CARDIO' },
      ]),
    ];

    const summary = summarizeMcpTrainingHistory(rows, {
      from: new Date('2026-05-18T12:00:00.000Z'),
      to: NOW,
      now: NOW,
      latestSessionDates: rows.map((row) => row.startedAt).reverse(),
      plannedWeeklyFrequency: 3,
    });

    expect(summary.weekly.length).toBe(9);
    expect(summary.weekly.some((week) => week.sessions === 0)).toBe(true);
    expect(summary.weekly[0]).toMatchObject({ coverageStatus: 'partial' });
    expect(summary.weekly.find((week) => week.sessions === 0)).toMatchObject({
      activityStatus: 'empty',
    });
    expect(summary.rollingComparison.recent7Days).toMatchObject({
      sessions: 1,
      workingSets: 3,
      regularWorkingSets: 2,
      dropSets: 1,
      setsWithRir: 1,
      setsAtRir0To4: 1,
      rirCoveragePct: 50,
    });
    expect(summary.rollingComparison.preceding42DaysWeeklyAverage).toEqual({
      sessions: 0.33,
      workingSets: 0.67,
      regularWorkingSets: 0.67,
    });
    expect(summary.rollingComparison.recentToBaselineRatio.regularWorkingSets).toBe(3);
    expect(summary.attendance).toMatchObject({
      plannedSessionsPerWeek: 3,
      sessionsLast28Days: 2,
      averageSessionsPerWeekLast28Days: 0.5,
    });
    expect(summary.dataQuality.directSetsByPrimaryMuscle.CHEST).toMatchObject({
      workingSets: 7,
      regularWorkingSets: 6,
      dropSets: 1,
    });
    expect(summary.dataQuality.indirectSetAccounting).toBe('unavailable');
    expect(summary.recentSessionDetails).toEqual({
      knownStrengthSessionsInCoverage: 3,
      returned: 3,
      truncated: false,
    });
  });

  it('reports exact attendance gaps without turning them into a diagnosis', () => {
    const rows = [session('may', '2026-05-21T12:00:00.000Z', [{ rir: null }])];
    const summary = summarizeMcpTrainingHistory(rows, {
      from: new Date('2026-05-18T12:00:00.000Z'),
      to: NOW,
      now: NOW,
      latestSessionDates: [
        new Date('2026-07-03T12:00:00.000Z'),
        new Date('2026-06-29T12:00:00.000Z'),
        new Date('2026-06-05T12:00:00.000Z'),
        new Date('2026-05-21T12:00:00.000Z'),
      ],
    });

    expect(summary.gaps).toMatchObject({
      lastSessionAt: '2026-07-03T12:00:00.000Z',
      daysSinceLastSession: 10,
      recentIntervalsDays: [4, 24, 15],
      longestRecentIntervalDays: 24,
    });
    expect(summary.gaps.interpretation).toMatch(/attendance only/i);
  });

  it('serializes recovery time, RIR and legacy program IDs as recorded', () => {
    const row = session('session-1', '2026-07-03T12:00:00.000Z', [{ rir: 2, recoverySec: 150 }]);

    expect(serializeTrainingSession(row)).toMatchObject({
      program: { id: '550e8400-e29b-41d4-a716-446655440000' },
      sessionRpe: 7,
      workingSetCount: 1,
      regularWorkingSetCount: 1,
      setsWithRir: 1,
      rirCoveragePct: 100,
      exercises: [
        {
          sets: [
            {
              weight: 60,
              reps: 10,
              rir: 2,
              recoverySec: 150,
            },
          ],
        },
      ],
    });
  });
});
