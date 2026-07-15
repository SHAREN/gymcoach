import { db } from '@/lib/db';
import type { BodyMeasurementSite, MuscleGroup } from '@/lib/prisma-client';
import {
  applyBodyweight,
  best1RM,
  classifyWeeklySets,
  effectiveWeight,
  exerciseProgress,
  isStalled,
  isoWeekKey,
  resolveVolumeBand,
  trainingConsistency,
  weeklyConditioning,
  weeklyFrequencyByMuscleGroup,
  weeklySetsByMuscleGroup,
  weeklyVolumeByMuscleGroup,
  WEEKLY_SETS_MEV,
  WEEKLY_SETS_MRV,
} from '@/lib/stats';
import {
  DELOAD_READINESS_LOOKBACK,
  DELOAD_READINESS_MAX_AGE_DAYS,
  isDeloadActive,
  recommendDeload,
} from '@/lib/deload';
import { goalProgress, goalTargetE1RM } from '@/lib/goals';
import { computeLoadingTable } from '@/lib/loading-table';
import { exerciseRecords } from '@/lib/records';
import { toDisplayWeight } from '@/lib/units';

export const MOBILE_PROGRESS_SCHEMA_VERSION = 3;
export const MOBILE_PROGRESS_RECENT_WEEKS = 12;
export const MOBILE_PROGRESS_CONDITIONING_WEEKS = 8;

export interface MobileProgressPoint {
  sessionStartedAt: string;
  maxWeight: number;
  estimated1RM: number;
  totalVolume: number;
  topSetReps: number;
  maxReps: number;
  totalReps: number;
}

export interface MobileProgressExercise {
  id: string;
  name: string;
  muscleGroup: MuscleGroup;
  usesBodyweight: boolean;
  points: MobileProgressPoint[];
  bestEstimated1RM: number;
  loadingTable: Array<{ percent: number; weight: number }>;
  goal: MobileProgressGoal | null;
  recap: MobileProgressRecap;
}

export interface MobileProgressGoal {
  id: string;
  targetWeight: number;
  targetReps: number;
  targetEstimated1RM: number;
  progress: number;
  achievedAt: string | null;
}

export interface MobileProgressRecap {
  sessions: number;
  firstWeight: number;
  firstDate: string;
  lastWeight: number;
  lastDate: string;
  weightDelta: number;
  firstEstimated1RM: number;
  lastEstimated1RM: number;
  estimated1RMDelta: number;
  stalled: boolean;
}

export interface MobileWeeklyVolumePoint {
  weekKey: string;
  weekStartIso: string;
  byMuscleGroup: Record<string, number>;
  total: number;
}

export interface MobileConsistencyWeek {
  weekKey: string;
  weekStartIso: string;
  trainedDays: number;
  onStreak: boolean;
  isCurrent: boolean;
}

export interface MobileConsistencySummary {
  weeks: MobileConsistencyWeek[];
  currentStreak: number;
  weeklyFrequency: number | null;
}

export interface MobileBodyweightEntry {
  id: string;
  weightKg: number;
  measuredAt: string;
}

export interface MobileBodyMeasurement {
  id: string;
  site: BodyMeasurementSite;
  valueCm: number;
  measuredAt: string;
}

export interface MobileConditioningWeek {
  weekKey: string;
  weekStartIso: string;
  minutes: number;
  distanceKm: number;
  sessions: number;
}

export interface MobileProgressSnapshot {
  schemaVersion: typeof MOBILE_PROGRESS_SCHEMA_VERSION;
  generatedAt: string;
  exercises: MobileProgressExercise[];
  weeklyVolume: MobileWeeklyVolumePoint[];
  consistency: MobileConsistencySummary;
  bodyweightEntries: MobileBodyweightEntry[];
  bodyMeasurements: MobileBodyMeasurement[];
  conditioningWeeks: MobileConditioningWeek[] | null;
  unit: 'KG' | 'LB';
  volumeLandmarks: MobileVolumeLandmarks | null;
  records: MobileExerciseRecord[];
  deload: MobileDeloadStatus;
}

export interface MobileVolumeLandmarkRow {
  muscleGroup: string;
  sets: number;
  frequency: number;
  zone: 'BELOW_MEV' | 'WITHIN' | 'ABOVE_MRV';
  mev: number;
  mrv: number;
  custom: boolean;
}

export interface MobileVolumeLandmarks {
  weekKey: string;
  defaultMev: number;
  defaultMrv: number;
  rows: MobileVolumeLandmarkRow[];
}

export interface MobileExerciseRecord {
  exerciseName: string;
  maxWeight: number;
  maxWeightReps: number;
  maxWeightDate: string;
  bestEstimated1RM: number;
  bestEstimated1RMDate: string;
}

export interface MobileDeloadStatus {
  recommended: boolean;
  active: boolean;
  until: string | null;
  stalledExerciseNames: string[];
  averageReadiness: number | null;
  readinessCheckins: number | null;
}

interface MobileProgressExerciseSource {
  id: string;
  name: string;
  muscleGroup: MuscleGroup;
  usesBodyweight: boolean;
  sets: Array<{
    weight: number;
    reps: number;
    isWarmup: boolean;
    durationSec: number | null;
    completedAt?: Date;
    sessionId: string;
    session: { startedAt: Date };
  }>;
}

interface MobileWeeklySetSource {
  weight: number;
  reps: number;
  isWarmup: boolean;
  durationSec: number | null;
  distanceM: number | null;
  sessionId: string;
  exercise: {
    muscleGroup: MuscleGroup;
    usesBodyweight: boolean;
  };
  session: { startedAt: Date };
}

export function buildMobileExerciseSeries(
  exercises: MobileProgressExerciseSource[],
  bodyweight: number | null | undefined,
): MobileProgressExercise[] {
  return exercises.map((exercise) => {
    const points = exerciseProgress(
      applyBodyweight(
        exercise.sets.map((set) => ({
          weight: set.weight,
          reps: set.reps,
          isWarmup: set.isWarmup,
          durationSec: set.durationSec,
          sessionId: set.sessionId,
          sessionStartedAt: set.session.startedAt,
          usesBodyweight: exercise.usesBodyweight,
        })),
        bodyweight,
      ),
    );

    return {
      id: exercise.id,
      name: exercise.name,
      muscleGroup: exercise.muscleGroup,
      usesBodyweight: exercise.usesBodyweight,
      points: points.map((point) => ({
        sessionStartedAt: point.sessionStartedAt.toISOString(),
        maxWeight: point.maxWeight,
        estimated1RM: point.estimated1RM,
        totalVolume: point.totalVolume,
        topSetReps: point.topSetReps,
        maxReps: point.maxReps,
        totalReps: point.totalReps,
      })),
      bestEstimated1RM: 0,
      loadingTable: [],
      goal: null,
      recap: {
        sessions: 0,
        firstWeight: 0,
        firstDate: '',
        lastWeight: 0,
        lastDate: '',
        weightDelta: 0,
        firstEstimated1RM: 0,
        lastEstimated1RM: 0,
        estimated1RMDelta: 0,
        stalled: false,
      },
    };
  });
}

export function buildMobileWeeklyVolume(
  sets: MobileWeeklySetSource[],
  bodyweight: number | null | undefined,
): MobileWeeklyVolumePoint[] {
  return weeklyVolumeByMuscleGroup(
    applyBodyweight(
      sets.map((set) => ({
        weight: set.weight,
        reps: set.reps,
        isWarmup: set.isWarmup,
        durationSec: set.durationSec,
        muscleGroup: set.exercise.muscleGroup,
        sessionStartedAt: set.session.startedAt,
        usesBodyweight: set.exercise.usesBodyweight,
      })),
      bodyweight,
    ),
  ).map((point) => ({
    weekKey: point.weekKey,
    weekStartIso: point.weekStart.toISOString(),
    byMuscleGroup: point.byMuscleGroup,
    total: point.total,
  }));
}

export async function buildMobileProgress(
  userId: string,
  now: Date = new Date(),
  includeExerciseId?: string,
): Promise<MobileProgressSnapshot> {
  const since = new Date(now);
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - MOBILE_PROGRESS_RECENT_WEEKS * 7);

  const [
    user,
    exercises,
    finishedSessions,
    weeklySetsRaw,
    bodyweightEntries,
    bodyMeasurements,
    hasCardioSets,
    volumeTargetRows,
    goals,
    recentCheckins,
    recordSetsRaw,
  ] = await Promise.all([
    db.user.findUnique({
      where: { id: userId },
      select: {
        bodyweight: true,
        weeklyFrequency: true,
        unit: true,
        deloadUntil: true,
      },
    }),
    db.exercise.findMany({
      where: {
        userId,
        category: { not: 'CARDIO' },
        OR: [
          {
            sets: {
              some: {
                isWarmup: false,
                completedAt: { gte: since },
                session: { userId },
              },
            },
          },
          ...(includeExerciseId
            ? [
                {
                  id: includeExerciseId,
                  sets: { some: { isWarmup: false, session: { userId } } },
                },
              ]
            : []),
        ],
      },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        muscleGroup: true,
        usesBodyweight: true,
        sets: {
          where: {
            isWarmup: false,
            session: { userId },
          },
          orderBy: { completedAt: 'asc' },
          select: {
            weight: true,
            reps: true,
            isWarmup: true,
            durationSec: true,
            completedAt: true,
            sessionId: true,
            session: { select: { startedAt: true } },
          },
        },
      },
    }),
    db.session.findMany({
      where: {
        userId,
        finishedAt: { not: null },
        startedAt: { gte: since },
      },
      select: { startedAt: true },
    }),
    db.set.findMany({
      where: {
        isWarmup: false,
        completedAt: { gte: since },
        session: { userId },
      },
      select: {
        weight: true,
        reps: true,
        isWarmup: true,
        durationSec: true,
        distanceM: true,
        sessionId: true,
        exercise: { select: { muscleGroup: true, usesBodyweight: true } },
        session: { select: { startedAt: true } },
      },
    }),
    db.bodyweightEntry.findMany({
      where: { userId, measuredAt: { gte: since } },
      orderBy: { measuredAt: 'desc' },
      select: { id: true, weightKg: true, measuredAt: true },
    }),
    db.bodyMeasurement.findMany({
      where: { userId, measuredAt: { gte: since } },
      orderBy: { measuredAt: 'desc' },
      select: { id: true, site: true, valueCm: true, measuredAt: true },
    }),
    db.set.count({
      where: { durationSec: { not: null }, session: { userId } },
    }),
    db.volumeTarget.findMany({
      where: { userId },
      select: { muscleGroup: true, mev: true, mrv: true },
    }),
    db.exerciseGoal.findMany({
      where: { userId },
      select: {
        id: true,
        exerciseId: true,
        targetWeight: true,
        targetReps: true,
        achievedAt: true,
      },
    }),
    db.readinessCheckin.findMany({
      where: {
        userId,
        createdAt: {
          gte: new Date(now.getTime() - DELOAD_READINESS_MAX_AGE_DAYS * 86_400_000),
        },
      },
      orderBy: { createdAt: 'desc' },
      take: DELOAD_READINESS_LOOKBACK,
      select: { readiness: true },
    }),
    db.set.findMany({
      where: {
        isWarmup: false,
        session: { userId },
        exercise: { category: { not: 'CARDIO' } },
      },
      orderBy: { session: { startedAt: 'asc' } },
      select: {
        weight: true,
        reps: true,
        isWarmup: true,
        durationSec: true,
        exercise: { select: { name: true, usesBodyweight: true } },
        session: { select: { startedAt: true } },
      },
    }),
  ]);

  if (!user) throw new Error('User not found.');

  const consistency = trainingConsistency(
    finishedSessions.map((session) => session.startedAt),
    {
      weeklyFrequency: user.weeklyFrequency,
      windowWeeks: MOBILE_PROGRESS_RECENT_WEEKS,
      now,
    },
  );
  const conditioningWeeks =
    hasCardioSets > 0
      ? weeklyConditioning(
          weeklySetsRaw.map((set) => ({
            durationSec: set.durationSec,
            distanceM: set.distanceM,
            isWarmup: set.isWarmup,
            sessionId: set.sessionId,
            sessionStartedAt: set.session.startedAt,
          })),
          { windowWeeks: MOBILE_PROGRESS_CONDITIONING_WEEKS, now },
        ).map((point) => ({
          weekKey: point.weekKey,
          weekStartIso: point.weekStart.toISOString(),
          minutes: point.minutes,
          distanceKm: point.distanceKm,
          sessions: point.sessions,
        }))
      : null;

  const goalByExerciseId = new Map(goals.map((goal) => [goal.exerciseId, goal]));
  const fullSeries = buildMobileExerciseSeries(exercises, user.bodyweight);
  const exercisesWithDashboard = fullSeries.map((series) => {
    const source = exercises.find((exercise) => exercise.id === series.id)!;
    const recent = buildMobileExerciseSeries(
      [
        {
          ...source,
          sets: source.sets.filter(
            (set) => (set.completedAt ?? set.session.startedAt).getTime() >= since.getTime(),
          ),
        },
      ],
      user.bodyweight,
    )[0]!;
    const first = recent.points[0];
    const last = recent.points.at(-1);
    const adjustedAll = applyBodyweight(
      source.sets.map((set) => ({
        weight: set.weight,
        reps: set.reps,
        isWarmup: set.isWarmup,
        durationSec: set.durationSec,
        usesBodyweight: source.usesBodyweight,
      })),
      user.bodyweight,
    );
    const bestEstimated1RM = +best1RM(adjustedAll).toFixed(1);
    const goal = goalByExerciseId.get(series.id);

    return {
      ...series,
      bestEstimated1RM,
      loadingTable: computeLoadingTable(toDisplayWeight(bestEstimated1RM, user.unit), user.unit),
      goal: goal
        ? {
            id: goal.id,
            targetWeight: goal.targetWeight,
            targetReps: goal.targetReps,
            targetEstimated1RM: +goalTargetE1RM(goal).toFixed(1),
            progress: +goalProgress(bestEstimated1RM, goal).toFixed(4),
            achievedAt: goal.achievedAt?.toISOString() ?? null,
          }
        : null,
      recap:
        first && last
          ? {
              sessions: recent.points.length,
              firstWeight: first.maxWeight,
              firstDate: first.sessionStartedAt.slice(0, 10),
              lastWeight: last.maxWeight,
              lastDate: last.sessionStartedAt.slice(0, 10),
              weightDelta: +(last.maxWeight - first.maxWeight).toFixed(2),
              firstEstimated1RM: first.estimated1RM,
              lastEstimated1RM: last.estimated1RM,
              estimated1RMDelta: +(last.estimated1RM - first.estimated1RM).toFixed(1),
              stalled: isStalled(
                recent.points.map((point) => ({
                  estimated1RM: point.estimated1RM,
                  sessionStartedAt: new Date(point.sessionStartedAt),
                })),
                now,
              ),
            }
          : series.recap,
    };
  });

  const volumeTargets = Object.fromEntries(
    volumeTargetRows.map((target) => [target.muscleGroup, { mev: target.mev, mrv: target.mrv }]),
  );
  const weeklySetPoints = weeklySetsByMuscleGroup(
    weeklySetsRaw.map((set) => ({
      isWarmup: set.isWarmup,
      durationSec: set.durationSec,
      muscleGroup: set.exercise.muscleGroup,
      sessionStartedAt: set.session.startedAt,
    })),
  );
  const weeklyFrequency = weeklyFrequencyByMuscleGroup(
    weeklySetsRaw.map((set) => ({
      isWarmup: set.isWarmup,
      durationSec: set.durationSec,
      muscleGroup: set.exercise.muscleGroup,
      sessionStartedAt: set.session.startedAt,
    })),
  );
  const currentWeekKey = isoWeekKey(now);
  const landmarkWeek =
    [...weeklySetPoints].reverse().find((week) => week.weekKey !== currentWeekKey) ??
    weeklySetPoints.at(-1);
  const frequencyForWeek = landmarkWeek
    ? (weeklyFrequency.find((week) => week.weekKey === landmarkWeek.weekKey)?.byMuscleGroup ?? {})
    : {};
  const volumeLandmarks = landmarkWeek
    ? {
        weekKey: landmarkWeek.weekKey,
        defaultMev: WEEKLY_SETS_MEV,
        defaultMrv: WEEKLY_SETS_MRV,
        rows: Object.entries(landmarkWeek.byMuscleGroup)
          .map(([muscleGroup, sets]) => {
            const band = resolveVolumeBand(muscleGroup, volumeTargets);
            return {
              muscleGroup,
              sets,
              frequency: frequencyForWeek[muscleGroup] ?? 0,
              zone: classifyWeeklySets(sets, band.mev, band.mrv),
              mev: band.mev,
              mrv: band.mrv,
              custom: band.custom,
            };
          })
          .sort((a, b) => b.sets - a.sets),
      }
    : null;

  const stalledExerciseNames = exercisesWithDashboard
    .filter((exercise) => exercise.recap.stalled)
    .map((exercise) => exercise.name);
  const deloadRecommendation = recommendDeload({
    stalledExerciseNames,
    recentReadiness: recentCheckins.map((checkin) => checkin.readiness),
  });
  const readinessReason = deloadRecommendation.reasons.find(
    (reason) => reason.kind === 'low-readiness',
  );
  const deloadActive = isDeloadActive(user.deloadUntil, now);

  return {
    schemaVersion: MOBILE_PROGRESS_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    exercises: exercisesWithDashboard,
    weeklyVolume: buildMobileWeeklyVolume(weeklySetsRaw, user.bodyweight),
    consistency,
    bodyweightEntries: bodyweightEntries.map((entry) => ({
      id: entry.id,
      weightKg: entry.weightKg,
      measuredAt: entry.measuredAt.toISOString(),
    })),
    bodyMeasurements: bodyMeasurements.map((entry) => ({
      id: entry.id,
      site: entry.site,
      valueCm: entry.valueCm,
      measuredAt: entry.measuredAt.toISOString(),
    })),
    conditioningWeeks,
    unit: user.unit,
    volumeLandmarks,
    records: exerciseRecords(
      recordSetsRaw.map((set) => ({
        weight: effectiveWeight(set.weight, set.exercise.usesBodyweight, user.bodyweight),
        reps: set.reps,
        isWarmup: set.isWarmup,
        durationSec: set.durationSec,
        exerciseName: set.exercise.name,
        sessionStartedAt: set.session.startedAt,
      })),
    ).map((record) => ({
      exerciseName: record.exerciseName,
      maxWeight: record.maxWeight,
      maxWeightReps: record.maxWeightReps,
      maxWeightDate: record.maxWeightDate,
      bestEstimated1RM: record.bestE1RM,
      bestEstimated1RMDate: record.bestE1RMDate,
    })),
    deload: {
      recommended: deloadRecommendation.recommended,
      active: deloadActive,
      until: deloadActive ? user.deloadUntil!.toISOString() : null,
      stalledExerciseNames,
      averageReadiness:
        readinessReason?.kind === 'low-readiness' ? readinessReason.averageReadiness : null,
      readinessCheckins:
        readinessReason?.kind === 'low-readiness' ? readinessReason.checkins : null,
    },
  };
}
