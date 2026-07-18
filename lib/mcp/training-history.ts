import { db } from '@/lib/db';
import { isoWeekStart } from '@/lib/stats';
import { MuscleGroup, type Prisma } from '@/lib/prisma-client';
import { aggregateTrainingLoad } from '@/lib/training-load-aggregation';
import { normalizeExerciseLoadProfile } from '@/lib/schemas/exercise-load-profile';

export const MCP_HISTORY_SUMMARY_DAYS = 56;
export const MCP_HISTORY_BASELINE_DAYS = 42;
export const MCP_HISTORY_RECENT_DAYS = 7;
export const MCP_HISTORY_RECENT_SESSION_LIMIT = 12;

const DAY_MS = 24 * 60 * 60 * 1000;

const historySessionInclude = {
  program: { select: { id: true, name: true } },
  workout: { select: { id: true, name: true } },
  sets: {
    orderBy: [
      { completedAt: 'asc' as const },
      { setNumber: 'asc' as const },
      { id: 'asc' as const },
    ],
    include: {
      exercise: {
        select: {
          id: true,
          name: true,
          muscleGroup: true,
          category: true,
          equipmentType: true,
          usesBodyweight: true,
          loadProfile: true,
        },
      },
    },
  },
} satisfies Prisma.SessionInclude;

export type McpHistorySessionRow = Prisma.SessionGetPayload<{
  include: typeof historySessionInclude;
}>;

export interface McpHistoryQuery {
  programId?: string;
  from?: Date;
  to: Date;
  limit: number;
  cursorSessionId?: string;
}

interface MuscleSetSummary {
  workingSets: number;
  regularWorkingSets: number;
  dropSets: number;
  setsWithRir: number;
  setsAtRir0To4: number;
}

interface PeriodSummary {
  sessions: number;
  workingSets: number;
  regularWorkingSets: number;
  dropSets: number;
  setsWithRir: number;
  setsAtRir0To4: number;
  rirCoveragePct: number | null;
  directSetsByPrimaryMuscle: Record<string, MuscleSetSummary>;
  loadByMuscle: ReturnType<typeof aggregateTrainingLoad>['muscles'];
  loadProfileMetadata: Omit<ReturnType<typeof aggregateTrainingLoad>, 'muscles'>;
}

export async function buildMcpTrainingHistorySummary(userId: string, now = new Date()) {
  const from = new Date(now.getTime() - MCP_HISTORY_SUMMARY_DAYS * DAY_MS);
  const [sessions, latestSessionDates, user] = await Promise.all([
    db.session.findMany({
      where: { userId, startedAt: { gte: from, lte: now } },
      orderBy: { startedAt: 'asc' },
      include: historySessionInclude,
    }),
    db.session.findMany({
      where: {
        userId,
        startedAt: { lte: now },
        sets: { some: { isWarmup: false, exercise: { category: { not: 'CARDIO' } } } },
      },
      orderBy: { startedAt: 'desc' },
      take: MCP_HISTORY_RECENT_SESSION_LIMIT,
      select: { startedAt: true },
    }),
    db.user.findUnique({ where: { id: userId }, select: { weeklyFrequency: true } }),
  ]);

  return summarizeMcpTrainingHistory(sessions, {
    from,
    to: now,
    now,
    latestSessionDates: latestSessionDates.map((session) => session.startedAt),
    plannedWeeklyFrequency: user?.weeklyFrequency ?? null,
  });
}

export async function getMcpTrainingHistory(userId: string, query: McpHistoryQuery) {
  const where: Prisma.SessionWhereInput = {
    userId,
    ...(query.programId ? { programId: query.programId } : {}),
    startedAt: {
      ...(query.from ? { gte: query.from } : {}),
      lte: query.to,
    },
  };
  const [totalMatching, page] = await Promise.all([
    db.session.count({ where }),
    db.session.findMany({
      where,
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      ...(query.cursorSessionId ? { cursor: { id: query.cursorSessionId }, skip: 1 } : {}),
      take: query.limit + 1,
      include: historySessionInclude,
    }),
  ]);
  const hasMore = page.length > query.limit;
  const rows = page.slice(0, query.limit);
  const sessions = rows.map(serializeTrainingSession);
  return {
    range: {
      from: query.from?.toISOString() ?? null,
      to: query.to.toISOString(),
      programId: query.programId ?? null,
    },
    totalMatching,
    returned: sessions.length,
    hasMore,
    nextCursor: hasMore ? (rows.at(-1)?.id ?? null) : null,
    summaryOfReturnedSessions: summarizePeriod(rows),
    sessions,
  };
}

export function summarizeMcpTrainingHistory(
  sessions: McpHistorySessionRow[],
  options: {
    from: Date;
    to: Date;
    now: Date;
    latestSessionDates?: Date[];
    plannedWeeklyFrequency?: number | null;
  },
) {
  const ordered = [...sessions].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  const recentStart = new Date(options.now.getTime() - MCP_HISTORY_RECENT_DAYS * DAY_MS);
  const baselineStart = new Date(recentStart.getTime() - MCP_HISTORY_BASELINE_DAYS * DAY_MS);
  const recentRows = ordered.filter(
    (session) => session.startedAt >= recentStart && session.startedAt <= options.now,
  );
  const baselineRows = ordered.filter(
    (session) => session.startedAt >= baselineStart && session.startedAt < recentStart,
  );
  const last28Start = new Date(options.now.getTime() - 28 * DAY_MS);
  const last28Rows = ordered.filter(
    (session) => session.startedAt >= last28Start && session.startedAt <= options.now,
  );
  const recent = summarizePeriod(recentRows);
  const baseline = summarizePeriod(baselineRows);
  const baselineWeeks = MCP_HISTORY_BASELINE_DAYS / 7;
  const baselineWeeklySessions = baseline.sessions / baselineWeeks;
  const baselineWeeklyWorkingSets = baseline.workingSets / baselineWeeks;
  const baselineWeeklyRegularWorkingSets = baseline.regularWorkingSets / baselineWeeks;
  const baselineWeeklyAverage = {
    sessions: round(baselineWeeklySessions, 2),
    workingSets: round(baselineWeeklyWorkingSets, 2),
    regularWorkingSets: round(baselineWeeklyRegularWorkingSets, 2),
  };
  const plannedWeeklyFrequency = options.plannedWeeklyFrequency ?? null;
  const averageSessionsPerWeekLast28Days = round(countTrainingSessions(last28Rows) / 4, 2);

  const dates = (options.latestSessionDates ?? ordered.map((session) => session.startedAt))
    .map((date) => new Date(date))
    .sort((a, b) => b.getTime() - a.getTime());
  const intervals = dates.slice(0, MCP_HISTORY_RECENT_SESSION_LIMIT).flatMap((date, index) => {
    const older = dates[index + 1];
    return older ? [round((date.getTime() - older.getTime()) / DAY_MS, 1)] : [];
  });
  const lastSession = dates[0] ?? null;
  const strengthSessionsInCoverage = ordered.filter(hasStrengthWork);
  const returnedRecentSessions = strengthSessionsInCoverage.slice(
    -MCP_HISTORY_RECENT_SESSION_LIMIT,
  );

  return {
    coverage: {
      from: options.from.toISOString(),
      to: options.to.toISOString(),
      days: round((options.to.getTime() - options.from.getTime()) / DAY_MS, 1),
      currentIsoWeekIsPartial: true,
      weekSemantics:
        'weekCurrent and weekPrevious are exact UTC ISO calendar weeks. A null weekPrevious means no session in that one calendar week, not no recent training history.',
    },
    weekly: buildWeeklySummaries(ordered, options.from, options.to),
    rollingComparison: {
      recent7DaysRange: { from: recentStart.toISOString(), to: options.now.toISOString() },
      preceding42DaysRange: { from: baselineStart.toISOString(), to: recentStart.toISOString() },
      recent7Days: recent,
      preceding42Days: baseline,
      preceding42DaysWeeklyAverage: baselineWeeklyAverage,
      recentToBaselineRatio: {
        sessions:
          baselineWeeklySessions > 0 ? round(recent.sessions / baselineWeeklySessions, 2) : null,
        workingSets:
          baselineWeeklyWorkingSets > 0
            ? round(recent.workingSets / baselineWeeklyWorkingSets, 2)
            : null,
        regularWorkingSets:
          baselineWeeklyRegularWorkingSets > 0
            ? round(recent.regularWorkingSets / baselineWeeklyRegularWorkingSets, 2)
            : null,
      },
      interpretation:
        'Ratios are descriptive arithmetic, not validated overload, fatigue, detraining or injury thresholds.',
    },
    attendance: {
      plannedSessionsPerWeek: plannedWeeklyFrequency,
      sessionsLast28Days: countTrainingSessions(last28Rows),
      averageSessionsPerWeekLast28Days,
      percentOfPlan:
        plannedWeeklyFrequency && plannedWeeklyFrequency > 0
          ? round((averageSessionsPerWeekLast28Days / plannedWeeklyFrequency) * 100, 1)
          : null,
    },
    gaps: {
      lastSessionAt: lastSession?.toISOString() ?? null,
      daysSinceLastSession: lastSession
        ? round(Math.max(0, options.now.getTime() - lastSession.getTime()) / DAY_MS, 1)
        : null,
      recentIntervalsDays: intervals,
      longestRecentIntervalDays: intervals.length > 0 ? Math.max(...intervals) : null,
      interpretation:
        'Calendar gaps describe attendance only. They do not diagnose lost adaptation or determine a safe return after illness or injury.',
    },
    recentSessionDetails: {
      knownStrengthSessionsInCoverage: strengthSessionsInCoverage.length,
      returned: returnedRecentSessions.length,
      truncated: strengthSessionsInCoverage.length > returnedRecentSessions.length,
    },
    recentSessions: returnedRecentSessions.reverse().map(serializeTrainingSession),
    dataQuality: {
      ...summarizePeriod(ordered),
      indirectSetAccounting: 'available-from-explicit-profiles',
      indirectSetReason:
        'Indirect sets are counted only from explicit secondary-muscle entries. Unknown participation remains unknown and receives no coefficient.',
      rirRule:
        'setsAtRir0To4 counts regular working sets only when recorded RIR is 0-4. Missing RIR stays missing and is not assumed to be hard or easy.',
    },
  };
}

export function serializeTrainingSession(session: McpHistorySessionRow) {
  const grouped = new Map<
    string,
    {
      exerciseId: string;
      exerciseName: string;
      muscleGroup: MuscleGroup;
      loadProfile: unknown;
      category: string;
      equipmentType: string;
      usesBodyweight: boolean;
      sets: McpHistorySessionRow['sets'];
    }
  >();
  for (const set of session.sets) {
    const current = grouped.get(set.exerciseId);
    if (current) current.sets.push(set);
    else {
      grouped.set(set.exerciseId, {
        exerciseId: set.exercise.id,
        exerciseName: set.exercise.name,
        muscleGroup: set.exercise.muscleGroup,
        loadProfile: set.exercise.loadProfile,
        category: set.exercise.category,
        equipmentType: set.exercise.equipmentType,
        usesBodyweight: set.exercise.usesBodyweight,
        sets: [set],
      });
    }
  }
  const period = summarizePeriod([session]);
  return {
    sessionId: session.id,
    program: session.program,
    workout: session.workout,
    startedAt: session.startedAt.toISOString(),
    finishedAt: session.finishedAt?.toISOString() ?? null,
    durationMin:
      session.finishedAt == null
        ? null
        : round((session.finishedAt.getTime() - session.startedAt.getTime()) / 60000, 1),
    sessionRpe: session.sessionRpe,
    notes: session.notes,
    workingSetCount: period.workingSets,
    regularWorkingSetCount: period.regularWorkingSets,
    dropSetCount: period.dropSets,
    setsWithRir: period.setsWithRir,
    rirCoveragePct: period.rirCoveragePct,
    exerciseOrder:
      'Best effort by first recorded set timestamp, set number and opaque set ID. Identical legacy timestamps do not establish the actual performed exercise order.',
    exercises: [...grouped.values()].map((exercise) => ({
      exerciseId: exercise.exerciseId,
      exerciseName: exercise.exerciseName,
      muscleGroup: exercise.muscleGroup,
      loadProfile: normalizeExerciseLoadProfile(exercise.loadProfile, exercise.muscleGroup),
      category: exercise.category,
      equipmentType: exercise.equipmentType,
      usesBodyweight: exercise.usesBodyweight,
      sets: exercise.sets.map((set) => ({
        setNumber: set.setNumber,
        weight: set.weight,
        reps: set.reps,
        rir: set.rir,
        isWarmup: set.isWarmup,
        isDropSet: set.isDropSet,
        recoverySec: set.recoverySec,
        notes: set.notes,
        completedAt: set.completedAt.toISOString(),
      })),
    })),
  };
}

function summarizePeriod(sessions: McpHistorySessionRow[]): PeriodSummary {
  const load = aggregateTrainingLoad(
    sessions.flatMap((session) =>
      session.sets
        .filter((set) => set.exercise.category !== 'CARDIO')
        .map((set) => ({
          setId: set.id,
          exerciseId: set.exerciseId,
          legacyMuscleGroup: set.exercise.muscleGroup,
          loadProfile: set.exercise.loadProfile,
          isWarmup: set.isWarmup,
          isDropSet: set.isDropSet,
          rir: set.rir,
          historyReliability: 'UNKNOWN' as const,
        })),
    ),
  );
  const directSetsByPrimaryMuscle: Record<string, MuscleSetSummary> = Object.fromEntries(
    Object.entries(load.muscles).flatMap(([muscle, row]) =>
      row.directSets > 0
        ? [
            [
              muscle,
              {
                workingSets: row.directSets,
                regularWorkingSets: row.directSetBreakdown.regular,
                dropSets: row.directSetBreakdown.drop,
                setsWithRir: row.directSetBreakdown.setsWithRir,
                setsAtRir0To4: row.directSetBreakdown.setsAtRir0To4,
              },
            ] as const,
          ]
        : [],
    ),
  );
  let workingSets = 0;
  let regularWorkingSets = 0;
  let dropSets = 0;
  let setsWithRir = 0;
  let setsAtRir0To4 = 0;
  for (const session of sessions) {
    for (const set of session.sets) {
      if (set.isWarmup || set.exercise.category === 'CARDIO') continue;
      workingSets += 1;
      if (set.isDropSet) {
        dropSets += 1;
      } else {
        regularWorkingSets += 1;
        if (set.rir != null) {
          setsWithRir += 1;
          if (set.rir <= 4) {
            setsAtRir0To4 += 1;
          }
        }
      }
    }
  }
  return {
    sessions: countTrainingSessions(sessions),
    workingSets,
    regularWorkingSets,
    dropSets,
    setsWithRir,
    setsAtRir0To4,
    rirCoveragePct:
      regularWorkingSets > 0 ? round((setsWithRir / regularWorkingSets) * 100, 1) : null,
    directSetsByPrimaryMuscle,
    loadByMuscle: load.muscles,
    loadProfileMetadata: {
      version: load.version,
      algorithmVersion: load.algorithmVersion,
      confidence: load.confidence,
      qualifyingSetCount: load.qualifyingSetCount,
      deduplicatedSetCount: load.deduplicatedSetCount,
      unclassifiedSetCount: load.unclassifiedSetCount,
      unknownSecondaryParticipationSetCount: load.unknownSecondaryParticipationSetCount,
      movementPatterns: load.movementPatterns,
      fatigueTags: load.fatigueTags,
      jointStress: load.jointStress,
      equivalentSetsHeuristic: load.equivalentSetsHeuristic,
    },
  };
}

function buildWeeklySummaries(sessions: McpHistorySessionRow[], from: Date, to: Date) {
  const weeks = [];
  for (let start = isoWeekStart(from); start <= to; start = addDays(start, 7)) {
    const end = addDays(start, 7);
    const period = summarizePeriod(
      sessions.filter((session) => session.startedAt >= start && session.startedAt < end),
    );
    weeks.push({
      weekStart: start.toISOString(),
      weekEndExclusive: end.toISOString(),
      isPartial: start < from || end > to,
      coverageStatus: start < from || end > to ? 'partial' : 'complete',
      activityStatus: period.sessions === 0 ? 'empty' : 'recorded',
      ...period,
    });
  }
  return weeks;
}

function countTrainingSessions(sessions: McpHistorySessionRow[]) {
  return sessions.filter(hasStrengthWork).length;
}

function hasStrengthWork(session: McpHistorySessionRow) {
  return session.sets.some((set) => !set.isWarmup && set.exercise.category !== 'CARDIO');
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
