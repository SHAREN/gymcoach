import type { WeightUnit } from '@/lib/prisma-client';
import type { TrackPoint } from '@/lib/import/track';

// ============================================================
// Cardio sets (issue #133) - duration/distance helpers
// ============================================================
// A cardio set is a Set row with durationSec != null (and reps = 1,
// weight = 0 by convention - the API normalizes them on write). These
// helpers keep parsing and formatting in one place: the set logger,
// the sets list, the post-session summary and the history page all
// render through them.

// Bounds shared by the Zod schema and the UI: at least 1 second, at
// most 24 hours; distance at most 1000 km (in meters).
export const MAX_DURATION_SEC = 86400;
export const MAX_DISTANCE_M = 1000000;

// Average heart rate bounds in bpm (issue #152): enforced by every writer
// of Set.avgHr (the set API schema and the TCX importer).
export const AVG_HR_MIN = 40;
export const AVG_HR_MAX = 250;

// Maximum heart rate bounds in bpm (issue #203): the peak heart-rate metric a
// watch records, carried by the same TCX exports alongside the average. Same
// 40..250 window as the average, enforced by every writer of Set.maxHr (the
// set API schema and the TCX importer).
export const MAX_HR_MIN = 40;
export const MAX_HR_MAX = 250;

// Statute mile in meters, for imports from imperial-unit exports.
export const MILES_TO_METERS = 1609.34;

// True when a set-like record is a cardio set.
export function isCardioSet(set: { durationSec?: number | null }): boolean {
  return set.durationSec != null;
}

// Sums duration and distance over the WORKING sets only (warmups excluded),
// matching the working-set / last-performance convention used everywhere else
// (issue #183). Used for the per-exercise cardio recap totals.
export function sumCardioWorkingSets(
  sets: { durationSec?: number | null; distanceM?: number | null; isWarmup: boolean }[],
): { durationSec: number; distanceM: number } {
  return sets
    .filter((s) => !s.isWarmup)
    .reduce(
      (acc, s) => ({
        durationSec: acc.durationSec + (s.durationSec ?? 0),
        distanceM: acc.distanceM + (s.distanceM ?? 0),
      }),
      { durationSec: 0, distanceM: 0 },
    );
}

// Parses a user-typed duration into seconds. Accepted formats:
//   "mm:ss"    -> minutes and seconds (e.g. "12:30")
//   "h:mm:ss"  -> hours, minutes, seconds (e.g. "1:05:00")
//   "mm"       -> plain minutes (e.g. "45")
// Returns null for anything else (empty, negative, out of bounds).
export function parseDurationToSec(input: string): number | null {
  const trimmed = input.trim();
  if (!/^\d{1,3}(:[0-5]?\d){0,2}$/.test(trimmed)) return null;
  const parts = trimmed.split(':').map((p) => parseInt(p, 10));
  let seconds: number;
  if (parts.length === 1) {
    seconds = parts[0]! * 60; // plain minutes
  } else if (parts.length === 2) {
    seconds = parts[0]! * 60 + parts[1]!;
  } else {
    seconds = parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  }
  if (seconds < 1 || seconds > MAX_DURATION_SEC) return null;
  return seconds;
}

// Formats a duration in seconds as "m:ss" (or "h:mm:ss" over an hour).
export function formatDuration(durationSec: number): string {
  const total = Math.max(0, Math.round(durationSec));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const ss = String(seconds).padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${ss}`;
  }
  return `${minutes}:${ss}`;
}

// Formats a distance in meters as kilometers with up to 2 decimals
// (trailing zeros trimmed): 2500 -> "2.5 km", 10000 -> "10 km".
export function formatDistance(distanceM: number): string {
  const km = distanceM / 1000;
  const rounded = +km.toFixed(2);
  return `${rounded} km`;
}

// One-line label for a cardio set: "12:30 · 2.5 km" (duration only when
// there is no distance).
export function formatCardioSet(durationSec: number, distanceM: number | null | undefined): string {
  const duration = formatDuration(durationSec);
  if (distanceM != null && distanceM > 0) {
    return `${duration} · ${formatDistance(distanceM)}`;
  }
  return duration;
}

// ============================================================
// Pace and speed (issue #177) - pure, unit-aware derivations
// ============================================================
// The single number runners/cyclists train on. Both are derived from the
// stored duration and distance; both return null when there is no distance
// (e.g. a duration-only erg set) so callers never divide by zero or render
// NaN/Infinity. Storage stays metric (meters/seconds); the unit only affects
// the display helpers below.

// Pace as seconds per kilometer, or null when distance is absent/zero.
export function paceSecPerKm(
  durationSec: number,
  distanceM: number | null | undefined,
): number | null {
  if (distanceM == null || distanceM <= 0) return null;
  return durationSec / (distanceM / 1000);
}

// Speed in kilometers per hour, or null when distance is absent/zero.
export function speedKmh(durationSec: number, distanceM: number | null | undefined): number | null {
  if (distanceM == null || distanceM <= 0 || durationSec <= 0) return null;
  return distanceM / 1000 / (durationSec / 3600);
}

// Formats pace for display, respecting the user's unit: "6:00 /km" in metric,
// "9:39 /mi" in imperial. Returns null when distance is absent (no pace to
// show). The mm:ss part reuses formatDuration so it stays consistent.
export function formatPace(
  durationSec: number,
  distanceM: number | null | undefined,
  unit: WeightUnit,
): string | null {
  const secPerKm = paceSecPerKm(durationSec, distanceM);
  if (secPerKm == null) return null;
  if (unit === 'LB') {
    const secPerMile = secPerKm * (MILES_TO_METERS / 1000);
    return `${formatDuration(secPerMile)} /mi`;
  }
  return `${formatDuration(secPerKm)} /km`;
}

// Formats speed for display, respecting the user's unit: "10 km/h" in metric,
// "6.2 mph" in imperial. Returns null when distance is absent. One decimal,
// trailing zeros trimmed.
export function formatSpeed(
  durationSec: number,
  distanceM: number | null | undefined,
  unit: WeightUnit,
): string | null {
  const kmh = speedKmh(durationSec, distanceM);
  if (kmh == null) return null;
  if (unit === 'LB') {
    const mph = kmh * (1000 / MILES_TO_METERS);
    return `${+mph.toFixed(1)} mph`;
  }
  return `${+kmh.toFixed(1)} km/h`;
}

// ============================================================
// Pace / heart-rate change over an imported activity track
// ============================================================
// These are conservative product-quality gates, not physiological laws.
// The estimate is descriptive only and is intended for a known continuous,
// sustained aerobic effort. Track data alone cannot establish that the effort
// was steady, level, well paced or representative of aerobic fitness.
export const DECOUPLING_MIN_DURATION_SEC = 20 * 60;
export const DECOUPLING_MAX_SAMPLE_GAP_SEC = 2 * 60;
export const DECOUPLING_MAX_STATIONARY_GAP_SEC = 30;

interface TimedValue {
  t: number;
  value: number;
}

function interpolateAt(points: TimedValue[], t: number): number | null {
  for (let index = 0; index < points.length; index++) {
    const current = points[index]!;
    if (current.t === t) return current.value;
    if (current.t > t) {
      const previous = points[index - 1];
      if (!previous) return null;
      const fraction = (t - previous.t) / (current.t - previous.t);
      return previous.value + (current.value - previous.value) * fraction;
    }
  }
  return null;
}

function timeWeightedMean(points: TimedValue[], start: number, end: number): number | null {
  const startValue = interpolateAt(points, start);
  const endValue = interpolateAt(points, end);
  if (startValue == null || endValue == null || end <= start) return null;

  const window = [
    { t: start, value: startValue },
    ...points.filter((point) => point.t > start && point.t < end),
    { t: end, value: endValue },
  ];
  let integral = 0;
  for (let index = 1; index < window.length; index++) {
    const previous = window[index - 1]!;
    const current = window[index]!;
    integral += ((previous.value + current.value) / 2) * (current.t - previous.t);
  }
  return integral / (end - start);
}

function hasExcessiveGap(points: TimedValue[]): boolean {
  for (let index = 1; index < points.length; index++) {
    if (points[index]!.t - points[index - 1]!.t > DECOUPLING_MAX_SAMPLE_GAP_SEC) {
      return true;
    }
  }
  return false;
}

// Optional pace / heart-rate change estimate for an imported track. The
// analysis window is split at its exact elapsed-time midpoint. Distance is
// interpolated at the boundary and HR is averaged with trapezoidal time
// weighting so irregular sample density does not bias either half.
//
// cost = timeWeightedMeanHr / meanSpeed
// changePct = (secondHalfCost / firstHalfCost - 1) * 100
//
// Positive values mean the recorded HR cost relative to pace was higher in the
// second half; negative values mean it was lower. No fitness or workout-quality
// classification follows from the sign or magnitude alone.
export function trackDecoupling(track: TrackPoint[]): number | null {
  if (track.length < 2) return null;

  const distance: TimedValue[] = [];
  const heartRate: TimedValue[] = [];
  let previousTime: number | null = null;
  let previousDistance: TimedValue | null = null;
  let stationarySince: number | null = null;

  for (const point of track) {
    if (
      !Number.isFinite(point.t) ||
      point.t < 0 ||
      point.t > MAX_DURATION_SEC ||
      (previousTime != null && point.t <= previousTime)
    ) {
      return null;
    }
    previousTime = point.t;

    if (point.d !== undefined) {
      if (
        typeof point.d !== 'number' ||
        !Number.isFinite(point.d) ||
        point.d < 0 ||
        point.d > MAX_DISTANCE_M
      ) {
        return null;
      }
      const currentDistance = { t: point.t, value: point.d };
      if (previousDistance) {
        if (currentDistance.value < previousDistance.value) return null;
        if (currentDistance.value === previousDistance.value) {
          stationarySince ??= previousDistance.t;
          if (currentDistance.t - stationarySince > DECOUPLING_MAX_STATIONARY_GAP_SEC) {
            return null;
          }
        } else {
          stationarySince = null;
        }
      }
      distance.push(currentDistance);
      previousDistance = currentDistance;
    }

    if (point.hr !== undefined) {
      if (
        typeof point.hr !== 'number' ||
        !Number.isFinite(point.hr) ||
        point.hr < AVG_HR_MIN ||
        point.hr > AVG_HR_MAX
      ) {
        return null;
      }
      heartRate.push({ t: point.t, value: point.hr });
    }
  }

  const start = track[0]!.t;
  const end = track[track.length - 1]!.t;
  if (end - start < DECOUPLING_MIN_DURATION_SEC) return null;
  if (distance.length < 2 || heartRate.length < 2) return null;
  if (
    distance[0]!.t !== start ||
    distance[distance.length - 1]!.t !== end ||
    heartRate[0]!.t !== start ||
    heartRate[heartRate.length - 1]!.t !== end
  ) {
    return null;
  }
  if (hasExcessiveGap(distance) || hasExcessiveGap(heartRate)) return null;

  const midpoint = start + (end - start) / 2;
  const startDistance = distance[0]!.value;
  const midpointDistance = interpolateAt(distance, midpoint);
  const endDistance = distance[distance.length - 1]!.value;
  if (midpointDistance == null) return null;

  const halfDuration = (end - start) / 2;
  const firstDistance = midpointDistance - startDistance;
  const secondDistance = endDistance - midpointDistance;
  if (halfDuration <= 0 || firstDistance <= 0 || secondDistance <= 0) return null;

  const firstMeanHr = timeWeightedMean(heartRate, start, midpoint);
  const secondMeanHr = timeWeightedMean(heartRate, midpoint, end);
  if (firstMeanHr == null || secondMeanHr == null || firstMeanHr <= 0 || secondMeanHr <= 0) {
    return null;
  }

  const firstMeanSpeed = firstDistance / halfDuration;
  const secondMeanSpeed = secondDistance / halfDuration;
  const firstCost = firstMeanHr / firstMeanSpeed;
  const secondCost = secondMeanHr / secondMeanSpeed;
  const changePct = (secondCost / firstCost - 1) * 100;
  return Number.isFinite(changePct) ? changePct : null;
}
