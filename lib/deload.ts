import { READINESS_HOLD_AT_OR_BELOW } from '@/lib/progression';
import {
  BASELINE_MUSCLE_VOLUME_DAYS,
  MAINTAINED_MUSCLE_VOLUME_RATIO,
} from '@/lib/return-to-training';

// ============================================================
// Deload-week recommendation (program-level fatigue signal)
// ============================================================
// lib/progression.ts already deloads a single session's load on a bad
// readiness check-in; this module aggregates the program-level signals
// (several stalled lifts, chronically low readiness) into one display-only
// classification that separates a signal, a planned deload and a completed
// recovery break. Pure derivation - no clock or DB access.

// How many stalled lifts (per lib/stats.ts isStalled) it takes to read the
// plateau as systemic fatigue rather than a single lift needing a tweak.
export const DELOAD_STALLED_LIFTS_MIN = 2;

// How many of the most recent readiness check-ins the chronic-fatigue test
// averages over.
export const DELOAD_READINESS_LOOKBACK = 5;

// Minimum number of check-ins in the window before the readiness trigger can
// fire. One bad morning is noise; a short consistent run of low scores is not.
export const DELOAD_READINESS_MIN_CHECKINS = 3;

// Check-ins older than this are dead data for a "chronic, current" fatigue
// signal: the caller must not feed them in. Two weeks keeps the trigger about
// the present block, mirroring how lib/progression.ts bounds a single
// check-in's relevance with READINESS_RECENCY_HOURS.
export const DELOAD_READINESS_MAX_AGE_DAYS = 14;

// Average readiness (1 drained - 5 primed) at or below which recovery counts
// as chronically poor. Reuses the per-session "hold the load" boundary from
// lib/progression.ts: scores that hold a single session, sustained across the
// window, justify a planned week of reduced load instead.
export const DELOAD_READINESS_THRESHOLD = READINESS_HOLD_AT_OR_BELOW;

// Length of a one-tap planned deload week (issue #112): POST /api/deload sets
// User.deloadUntil this many days ahead.
export const DELOAD_DURATION_DAYS = 7;

// Activity classification deliberately reuses the established return-to-
// training windows instead of introducing a second fatigue calendar. The
// recent window matches current recovery evidence; the preceding 56 days are
// normalized back to the same 14-day span before comparison.
export const DELOAD_ACTIVITY_RECENT_DAYS = DELOAD_READINESS_MAX_AGE_DAYS;
export const DELOAD_ACTIVITY_BASELINE_DAYS = BASELINE_MUSCLE_VOLUME_DAYS;
export const DELOAD_MAINTAINED_LOAD_RATIO = MAINTAINED_MUSCLE_VOLUME_RATIO;

// Whether a planned deload is currently active. Null or a timestamp at/in the
// past means no active deload, so an expired deloadUntil silently returns the
// app to normal progression without any cleanup write.
export function isDeloadActive(deloadUntil: Date | null, now: Date): boolean {
  return deloadUntil != null && deloadUntil.getTime() > now.getTime();
}

export type DeloadReason =
  | { kind: 'stalled-lifts'; exerciseNames: string[] }
  | { kind: 'low-readiness'; averageReadiness: number; checkins: number };

export interface DeloadRecommendation {
  recommended: boolean;
  reasons: DeloadReason[];
  state?: DeloadState;
  activity?: DeloadActivitySummary;
}

export interface ResolvedDeloadRecommendation extends DeloadRecommendation {
  state: DeloadState;
  activity: DeloadActivitySummary;
}

export type DeloadState = 'none' | 'stall-signal' | 'planned-deload' | 'recovery-break-completed';

export interface MeaningfulTrainingSession {
  sessionId: string;
  performedAt: Date;
  workingSetCount: number;
}

export interface DeloadActivityInput {
  now: Date;
  sessions: MeaningfulTrainingSession[];
  plannedWeeklyFrequency?: number | null;
  loadAccounting?: DeloadCrossExerciseAccounting | null;
}

export interface DeloadCrossExerciseAccounting {
  recent: DeloadLoadWindowAccounting;
  baseline: DeloadLoadWindowAccounting;
}

export interface DeloadLoadWindowAccounting {
  confidence: string;
  qualifyingSetCount: number;
  unknownSecondaryParticipationSetCount: number;
  muscles: Record<string, { directSets: number; indirectSets: number }>;
  movementPatterns: Record<string, number>;
  fatigueTags: Record<string, number>;
  jointStress: Record<string, number>;
}

export interface DeloadActivitySummary {
  lastMeaningfulWorkoutAt: string | null;
  daysSinceLastMeaningfulWorkout: number | null;
  recent7DayCompletedWorkouts: number;
  recent7DayWorkingSets: number;
  recent14DayCompletedWorkouts: number;
  recent14DayWorkingSets: number;
  baselineCompletedWorkoutsPer14Days: number;
  baselineWorkingSetsPer14Days: number;
  sessionFrequencyRatio: number | null;
  workingSetRatio: number | null;
  actualWeeklyFrequency28Days: number;
  plannedWeeklyFrequency: number | null;
  averageReadiness: number | null;
  latestSleepQuality: number | null;
  maxReportedSoreness: number | null;
  loadAccounting: DeloadCrossExerciseAccounting | null;
}

// One short human-readable line per reason. Shared by the progress-page
// banner and the coach payload (issue #101) so the user and the AI coach read
// the exact same explanation.
export function deloadReasonLine(reason: DeloadReason): string {
  switch (reason.kind) {
    case 'stalled-lifts': {
      const count = reason.exerciseNames.length;
      const names = reason.exerciseNames.join(', ');
      return count === 1
        ? `1 lift has stalled: ${names}.`
        : `${count} lifts have stalled: ${names}.`;
    }
    case 'low-readiness':
      return `Your readiness has averaged ${reason.averageReadiness}/5 over your last ${reason.checkins} check-ins.`;
  }
}

export interface DeloadInput {
  // Names of the lifts currently flagged by isStalled, any order.
  stalledExerciseNames: string[];
  // Readiness scores (1-5) of the user's most recent check-ins, newest first.
  // The caller passes whatever it has; only the first
  // DELOAD_READINESS_LOOKBACK entries are considered.
  recentReadiness: number[];
  latestRecovery?: {
    sleepQuality?: number | null;
    soreness?: unknown;
  } | null;
  // Only completed sessions with at least one real, non-warm-up strength set.
  // Empty/unfinished sessions never enter this list.
  activity: DeloadActivityInput;
}

// Separates an analytical stall signal from accumulated fatigue and from a
// recovery break that already supplied the reduced-load week. A new planned
// deload requires both a fatigue/stall signal and evidence that training load
// continued. A seven-day zero-load break plus a sharp 14-day collapse against
// the user's own preceding baseline and recovered readiness routes to return
// calibration instead of adding another week off.
export function recommendDeload(input: DeloadInput): ResolvedDeloadRecommendation {
  const reasons: DeloadReason[] = [];

  if (input.stalledExerciseNames.length >= DELOAD_STALLED_LIFTS_MIN) {
    reasons.push({
      kind: 'stalled-lifts',
      exerciseNames: [...input.stalledExerciseNames],
    });
  }

  const window = input.recentReadiness.slice(0, DELOAD_READINESS_LOOKBACK);
  const averageReadiness =
    window.length > 0 ? +(window.reduce((acc, r) => acc + r, 0) / window.length).toFixed(1) : null;
  if (window.length >= DELOAD_READINESS_MIN_CHECKINS) {
    const average = averageReadiness!;
    if (average <= DELOAD_READINESS_THRESHOLD) {
      reasons.push({
        kind: 'low-readiness',
        averageReadiness: average,
        checkins: window.length,
      });
    }
  }

  const activity = summarizeDeloadActivity(input.activity, averageReadiness);
  const hasSignal = reasons.length > 0;
  const lowReadiness = reasons.some((reason) => reason.kind === 'low-readiness');
  const latestSleepQuality = input.latestRecovery?.sleepQuality ?? null;
  const maxReportedSoreness = maxSoreness(input.latestRecovery?.soreness);
  activity.latestSleepQuality = latestSleepQuality;
  activity.maxReportedSoreness = maxReportedSoreness;
  const recoveredReadiness =
    averageReadiness != null &&
    averageReadiness > DELOAD_READINESS_THRESHOLD &&
    (latestSleepQuality == null || latestSleepQuality > READINESS_HOLD_AT_OR_BELOW) &&
    (maxReportedSoreness == null || maxReportedSoreness < 4);
  const completedRecoveryWeek =
    activity.recent7DayCompletedWorkouts === 0 &&
    activity.recent7DayWorkingSets === 0 &&
    activity.daysSinceLastMeaningfulWorkout != null &&
    activity.daysSinceLastMeaningfulWorkout >= DELOAD_DURATION_DAYS;
  const loadCollapsed =
    activity.workingSetRatio != null &&
    activity.sessionFrequencyRatio != null &&
    activity.workingSetRatio < DELOAD_MAINTAINED_LOAD_RATIO &&
    activity.sessionFrequencyRatio < DELOAD_MAINTAINED_LOAD_RATIO;
  const recoveryBreakCompleted =
    hasSignal && completedRecoveryWeek && loadCollapsed && recoveredReadiness;
  const continuedLoad =
    activity.recent14DayWorkingSets > 0 &&
    ((activity.workingSetRatio != null &&
      activity.workingSetRatio >= DELOAD_MAINTAINED_LOAD_RATIO) ||
      (activity.sessionFrequencyRatio != null &&
        activity.sessionFrequencyRatio >= DELOAD_MAINTAINED_LOAD_RATIO));
  const plannedDeload =
    hasSignal &&
    !recoveryBreakCompleted &&
    (continuedLoad || (lowReadiness && activity.recent14DayWorkingSets > 0));
  const state: DeloadState = recoveryBreakCompleted
    ? 'recovery-break-completed'
    : plannedDeload
      ? 'planned-deload'
      : hasSignal
        ? 'stall-signal'
        : 'none';

  return { recommended: state === 'planned-deload', reasons, state, activity };
}

export function summarizeDeloadActivity(
  input: DeloadActivityInput,
  averageReadiness: number | null = null,
): DeloadActivitySummary {
  const nowMs = input.now.getTime();
  const valid = input.sessions.filter(
    (session) =>
      session.workingSetCount > 0 &&
      Number.isFinite(session.performedAt.getTime()) &&
      session.performedAt.getTime() <= nowMs,
  );
  const unique = new Map<string, MeaningfulTrainingSession>();
  for (const session of valid) {
    const previous = unique.get(session.sessionId);
    if (!previous || previous.performedAt < session.performedAt)
      unique.set(session.sessionId, session);
  }
  const sessions = [...unique.values()];
  const ageDays = (date: Date) => (nowMs - date.getTime()) / 86_400_000;
  const inWindow = (days: number) =>
    sessions.filter((session) => ageDays(session.performedAt) < days);
  const recent7 = inWindow(DELOAD_DURATION_DAYS);
  const recent14 = inWindow(DELOAD_ACTIVITY_RECENT_DAYS);
  const recent28 = inWindow(28);
  const baseline = sessions.filter((session) => {
    const age = ageDays(session.performedAt);
    return (
      age >= DELOAD_ACTIVITY_RECENT_DAYS &&
      age < DELOAD_ACTIVITY_RECENT_DAYS + DELOAD_ACTIVITY_BASELINE_DAYS
    );
  });
  const normalization = DELOAD_ACTIVITY_RECENT_DAYS / DELOAD_ACTIVITY_BASELINE_DAYS;
  const baselineSessions = baseline.length * normalization;
  const baselineSets = sumWorkingSets(baseline) * normalization;
  const latest = sessions.reduce<MeaningfulTrainingSession | null>(
    (current, session) =>
      !current || session.performedAt > current.performedAt ? session : current,
    null,
  );

  return {
    lastMeaningfulWorkoutAt: latest?.performedAt.toISOString() ?? null,
    daysSinceLastMeaningfulWorkout: latest ? +ageDays(latest.performedAt).toFixed(1) : null,
    recent7DayCompletedWorkouts: recent7.length,
    recent7DayWorkingSets: sumWorkingSets(recent7),
    recent14DayCompletedWorkouts: recent14.length,
    recent14DayWorkingSets: sumWorkingSets(recent14),
    baselineCompletedWorkoutsPer14Days: +baselineSessions.toFixed(2),
    baselineWorkingSetsPer14Days: +baselineSets.toFixed(2),
    sessionFrequencyRatio: ratio(recent14.length, baselineSessions),
    workingSetRatio: ratio(sumWorkingSets(recent14), baselineSets),
    actualWeeklyFrequency28Days: +(recent28.length / 4).toFixed(2),
    plannedWeeklyFrequency: input.plannedWeeklyFrequency ?? null,
    averageReadiness,
    latestSleepQuality: null,
    maxReportedSoreness: null,
    loadAccounting: input.loadAccounting ?? null,
  };
}

function sumWorkingSets(sessions: MeaningfulTrainingSession[]): number {
  return sessions.reduce((total, session) => total + session.workingSetCount, 0);
}

function ratio(value: number, baseline: number): number | null {
  return baseline > 0 ? +(value / baseline).toFixed(2) : null;
}

function maxSoreness(value: unknown): number | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;
  const ratings = Object.values(value).filter(
    (entry): entry is number => typeof entry === 'number' && Number.isFinite(entry),
  );
  return ratings.length > 0 ? Math.max(...ratings) : null;
}
