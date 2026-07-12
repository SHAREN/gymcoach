// User preferences stored locally (not in the DB).
// Everything is single-user, so localStorage is enough. SSR-safe reads.

import { WeightUnit } from '@/lib/prisma-client';

const STORAGE_KEY = 'gymcoach.prefs.v1';

export const SET_TABLE_METRICS = ['1RM', '10RM', 'VOLUME'] as const;
export type SetTableMetric = (typeof SET_TABLE_METRICS)[number];

export interface UserPreferences {
  vibration: boolean;
  restTimerSound: boolean;
  // Auto-regulation (issue #61). When on (default), a recent readiness/soreness
  // check-in can make the deterministic next-weight suggestion more conservative
  // (hold the load or step it down). When off, readiness is ignored entirely and
  // the suggestion follows pure programmed progression (pre-#55 behavior).
  readinessAutoRegulation: boolean;
  // Legacy single rep-max preference kept for backward compatibility with
  // existing localStorage data. New code should use setTableMetrics.
  rmDisplay: '1RM' | '10RM';
  // Calculated columns shown while logging strength sets.
  setTableMetrics: SetTableMetric[];
  // Plate-loading calculator (issue #39). Bar weight and available plate
  // denominations are stored per unit, since a kg gym and a lb gym stock
  // different plates. Values are in the matching display unit.
  barWeightKg: number;
  barWeightLb: number;
  platesKg: number[];
  platesLb: number[];
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  vibration: true,
  restTimerSound: false,
  readinessAutoRegulation: true,
  rmDisplay: '1RM',
  setTableMetrics: ['1RM'],
  barWeightKg: 20,
  barWeightLb: 45,
  platesKg: [25, 20, 15, 10, 5, 2.5, 1.25],
  platesLb: [45, 35, 25, 10, 5, 2.5],
};

export function loadPreferences(): UserPreferences {
  if (typeof window === 'undefined') return DEFAULT_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<UserPreferences>;
    const legacyRm = parsed.rmDisplay === '10RM' ? '10RM' : '1RM';
    const setTableMetrics = normalizeSetTableMetrics(
      Object.prototype.hasOwnProperty.call(parsed, 'setTableMetrics')
        ? parsed.setTableMetrics
        : [legacyRm],
      legacyRm,
    );
    return {
      ...DEFAULT_PREFERENCES,
      ...parsed,
      rmDisplay: repMaxMetric(setTableMetrics) ?? legacyRm,
      setTableMetrics,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function savePreferences(prefs: UserPreferences): void {
  if (typeof window === 'undefined') return;
  try {
    const setTableMetrics = normalizeSetTableMetrics(prefs.setTableMetrics, prefs.rmDisplay);
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...prefs,
        rmDisplay: repMaxMetric(setTableMetrics) ?? prefs.rmDisplay,
        setTableMetrics,
      }),
    );
  } catch {
    // localStorage unavailable: silently accept.
  }
}

export function normalizeSetTableMetrics(
  value: unknown,
  fallbackRm: '1RM' | '10RM' = '1RM',
): SetTableMetric[] {
  const raw = Array.isArray(value)
    ? value.filter((metric): metric is SetTableMetric =>
        SET_TABLE_METRICS.includes(metric as SetTableMetric),
      )
    : [];
  const hasVolume = raw.includes('VOLUME');
  const rm = raw.includes('10RM') ? '10RM' : raw.includes('1RM') ? '1RM' : null;

  if (rm) return hasVolume ? [rm, 'VOLUME'] : [rm];
  if (hasVolume) return ['VOLUME'];
  return [fallbackRm];
}

export function setTableMetricEnabled(
  current: SetTableMetric[],
  metric: SetTableMetric,
  enabled: boolean,
): SetTableMetric[] {
  const normalized = normalizeSetTableMetrics(current);
  if (!enabled) {
    if (normalized.length === 1 && normalized[0] === metric) return normalized;
    return normalized.filter((value) => value !== metric);
  }

  if (metric === '1RM') {
    return normalized.includes('VOLUME') ? ['1RM', 'VOLUME'] : ['1RM'];
  }
  if (metric === '10RM') {
    return normalized.includes('VOLUME') ? ['10RM', 'VOLUME'] : ['10RM'];
  }
  const rm = repMaxMetric(normalized);
  return rm ? [rm, 'VOLUME'] : ['VOLUME'];
}

function repMaxMetric(metrics: SetTableMetric[]): '1RM' | '10RM' | null {
  if (metrics.includes('10RM')) return '10RM';
  if (metrics.includes('1RM')) return '1RM';
  return null;
}

// Targeted helpers (read without requiring the full signature).
export function isVibrationEnabled(): boolean {
  return loadPreferences().vibration;
}

export function isRestTimerSoundEnabled(): boolean {
  return loadPreferences().restTimerSound;
}

// Whether a recent readiness/soreness check-in is allowed to adjust the
// deterministic next-weight suggestion (issue #61). Defaults to true.
export function isReadinessAutoRegulationEnabled(): boolean {
  return loadPreferences().readinessAutoRegulation;
}

// The plate-loading config (bar weight + available plates) for the active unit.
export function plateConfigForUnit(unit: WeightUnit): {
  barWeight: number;
  plates: number[];
} {
  const prefs = loadPreferences();
  return unit === 'LB'
    ? { barWeight: prefs.barWeightLb, plates: prefs.platesLb }
    : { barWeight: prefs.barWeightKg, plates: prefs.platesKg };
}
