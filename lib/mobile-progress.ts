import { db } from '@/lib/db';
import type { BodyMeasurementSite, MuscleGroup } from '@/lib/prisma-client';
import {
  applyBodyweight,
  exerciseProgress,
  trainingConsistency,
  weeklyConditioning,
  weeklyVolumeByMuscleGroup,
} from '@/lib/stats';

export const MOBILE_PROGRESS_SCHEMA_VERSION = 2;
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
  points: MobileProgressPoint[];
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
      points: points.map((point) => ({
        sessionStartedAt: point.sessionStartedAt.toISOString(),
        maxWeight: point.maxWeight,
        estimated1RM: point.estimated1RM,
        totalVolume: point.totalVolume,
        topSetReps: point.topSetReps,
        maxReps: point.maxReps,
        totalReps: point.totalReps,
      })),
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
): Promise<MobileProgressSnapshot> {
  const since = new Date(now);
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - MOBILE_PROGRESS_RECENT_WEEKS * 7);

  const [
    user,
    exercises,
    finishedSessions,
    weeklySets,
    bodyweightEntries,
    bodyMeasurements,
    hasCardioSets,
  ] = await Promise.all([
    db.user.findUnique({
      where: { id: userId },
      select: { bodyweight: true, weeklyFrequency: true },
    }),
    db.exercise.findMany({
      where: {
        userId,
        category: { not: 'CARDIO' },
        sets: {
          some: {
            isWarmup: false,
            completedAt: { gte: since },
            session: { userId },
          },
        },
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
          weeklySets.map((set) => ({
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

  return {
    schemaVersion: MOBILE_PROGRESS_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    exercises: buildMobileExerciseSeries(exercises, user.bodyweight),
    weeklyVolume: buildMobileWeeklyVolume(weeklySets, user.bodyweight),
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
  };
}
