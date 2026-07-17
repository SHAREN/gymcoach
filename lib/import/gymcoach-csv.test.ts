import { describe, expect, it } from 'vitest';
import { csvEscape, HISTORY_CSV_HEADERS } from '@/lib/csv';
import {
  GYMCOACH_CSV_MAX_BYTES,
  GYMCOACH_CSV_MAX_ROWS,
  parseGymcoachCsv,
  stripFormulaGuard,
} from './gymcoach-csv';

type Header = (typeof HISTORY_CSV_HEADERS)[number];

const defaults: Record<Header, string> = {
  session_id: 'source-session-1',
  session_date: '2026-05-02',
  session_started_at: '2026-05-02T09:13:00.000Z',
  session_finished_at: '2026-05-02T10:05:00.000Z',
  duration_min: '52',
  program: 'PPL',
  workout: 'Push Day',
  exercise: 'Bench Press',
  muscle_group: 'CHEST',
  uses_bodyweight: 'false',
  set_number: '1',
  external_load_kg: '80',
  effective_weight_kg: '80',
  reps: '8',
  rir: '2',
  is_warmup: 'false',
  is_drop_set: 'false',
  volume_kg: '640',
  estimated_1rm_kg: '101.28',
  set_notes: 'felt strong',
  duration_sec: '',
  distance_m: '',
  avg_hr: '',
  max_hr: '',
  session_timezone: 'UTC',
  session_set_count: '1',
  exercise_category: 'COMPOUND',
};

const header = HISTORY_CSV_HEADERS.join(',');

function row(over: Partial<Record<Header, string>> = {}): string {
  const cells = { ...defaults, ...over };
  return HISTORY_CSV_HEADERS.map((name) => csvEscape(cells[name])).join(',');
}

function csv(...rows: string[]): string {
  return [header, ...rows].join('\n');
}

describe('parseGymcoachCsv - native contract', () => {
  it('accepts the full BOM-prefixed export and preserves strength semantics', () => {
    const parsed = parseGymcoachCsv('﻿' + csv(row()));
    expect(parsed).toMatchObject({ ok: true, fatalError: null, errors: [] });
    expect(parsed.rows[0]).toEqual({
      line: 2,
      sourceSessionId: 'source-session-1',
      dateKey: '2026-05-02',
      timeZone: 'UTC',
      sourceSetCount: 1,
      startedAtIso: '2026-05-02T09:13:00.000Z',
      finishedAtIso: '2026-05-02T10:05:00.000Z',
      programName: 'PPL',
      workoutName: 'Push Day',
      exerciseName: 'Bench Press',
      muscleGroup: 'CHEST',
      category: 'COMPOUND',
      usesBodyweight: false,
      setOrder: 1,
      weightKg: 80,
      reps: 8,
      rir: 2,
      isWarmup: false,
      isDropSet: false,
      notes: 'felt strong',
      durationSec: null,
      distanceM: null,
      avgHr: null,
      maxHr: null,
    });
  });

  it('preserves bodyweight external load and cardio fields/categories', () => {
    const parsed = parseGymcoachCsv(
      csv(
        row({
          exercise: 'Weighted Pull-up',
          muscle_group: 'BACK_WIDTH',
          uses_bodyweight: 'true',
          exercise_category: 'COMPOUND',
          external_load_kg: '20',
        }),
        row({
          session_id: 'source-session-2',
          exercise: 'Running',
          muscle_group: 'OTHER',
          exercise_category: 'CARDIO',
          external_load_kg: '0',
          reps: '1',
          rir: '',
          set_notes: '',
          duration_sec: '1800',
          distance_m: '5000',
          avg_hr: '150',
          max_hr: '172',
        }),
      ),
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({
      usesBodyweight: true,
      category: 'COMPOUND',
      muscleGroup: 'BACK_WIDTH',
      weightKg: 20,
    });
    expect(parsed.rows[1]).toMatchObject({
      category: 'CARDIO',
      durationSec: 1800,
      distanceM: 5000,
      avgHr: 150,
      maxHr: 172,
    });
  });

  it('validates the exported local date against the exact instant and timezone', () => {
    const parsed = parseGymcoachCsv(
      csv(
        row({
          session_date: '2026-04-30',
          session_started_at: '2026-05-01T00:30:00.000Z',
          session_finished_at: '2026-05-01T01:00:00.000Z',
          session_timezone: 'America/Los_Angeles',
        }),
      ),
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows[0]?.dateKey).toBe('2026-04-30');
    expect(parsed.rows[0]?.startedAtIso).toBe('2026-05-01T00:30:00.000Z');
  });

  it('keeps two identical sessions separate when their source IDs differ', () => {
    const parsed = parseGymcoachCsv(csv(row(), row({ session_id: 'source-session-2' })));
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows.map((value) => value.sourceSessionId)).toEqual([
      'source-session-1',
      'source-session-2',
    ]);
  });

  it('requires the integrity columns from a fresh GymCoach export', () => {
    const parsed = parseGymcoachCsv(
      'session_id,session_date,exercise,set_number,external_load_kg,reps\n' +
        's1,2026-05-02,Bench,1,80,8',
    );
    expect(parsed.ok).toBe(false);
    expect(parsed.fatalError).toMatch(/fresh GymCoach history CSV/i);
  });
});

describe('parseGymcoachCsv - strict values and atomic sessions', () => {
  it.each([
    ['set_number', ''],
    ['external_load_kg', ''],
    ['reps', ''],
    ['session_set_count', ''],
    ['external_load_kg', '0x10'],
  ] as Array<[Header, string]>)('rejects invalid required numeric %s', (name, value) => {
    const parsed = parseGymcoachCsv(csv(row({ [name]: value })));
    expect(parsed.rows).toEqual([]);
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0]?.line).toBe(2);
  });

  it.each(['yes', '1', 'nope'])('rejects invalid nonempty boolean token %s', (value) => {
    const parsed = parseGymcoachCsv(csv(row({ is_warmup: value })));
    expect(parsed.rows).toEqual([]);
    expect(parsed.errors[0]?.reason).toMatch(/true, false/i);
  });

  it('rejects malformed or zoneless timestamps and end-before-start', () => {
    const parsed = parseGymcoachCsv(
      csv(
        row({ session_id: 'bad-1', session_started_at: 'yesterday' }),
        row({ session_id: 'bad-2', session_started_at: '2026-05-02T09:13:00' }),
        row({
          session_id: 'bad-3',
          session_started_at: '2026-05-02T10:00:00.000Z',
          session_finished_at: '2026-05-02T09:00:00.000Z',
        }),
      ),
    );
    expect(parsed.rows).toEqual([]);
    expect(parsed.errors.map((error) => error.line)).toEqual([2, 3, 4]);
  });

  it.each([
    ['a non-leap February 29', '2026-02-29T09:00:00Z', '2026-03-01', '2026-03-01T10:00:00Z'],
    ['February 30', '2026-02-30T09:00:00Z', '2026-03-02', '2026-03-02T10:00:00Z'],
    ['April 31', '2026-04-31T09:00:00Z', '2026-05-01', '2026-05-01T10:00:00Z'],
    ['hour 24', '2026-05-02T24:00:00Z', '2026-05-03', '2026-05-03T01:00:00Z'],
    ['minute 60', '2026-05-02T09:60:00Z', '2026-05-02', '2026-05-02T11:00:00Z'],
    ['second 60', '2026-05-02T09:13:60Z', '2026-05-02', '2026-05-02T11:00:00Z'],
  ])('rejects impossible timestamp components: %s', (_, startedAt, dateKey, finishedAt) => {
    const parsed = parseGymcoachCsv(
      csv(
        row({
          session_date: dateKey,
          session_started_at: startedAt,
          session_finished_at: finishedAt,
        }),
      ),
    );
    expect(parsed.rows).toEqual([]);
    expect(parsed.errors).toEqual([
      expect.objectContaining({ line: 2, reason: expect.stringMatching(/startedAtIso/) }),
    ]);
  });

  it.each([
    [
      'UTC leap day',
      'UTC',
      '2024-02-29T09:13:00Z',
      '2024-02-29T10:05:00Z',
      '2024-02-29T09:13:00.000Z',
    ],
    [
      'explicit offset leap day',
      'Asia/Yekaterinburg',
      '2024-02-29T09:13:00+05:00',
      '2024-02-29T10:05:00+05:00',
      '2024-02-29T04:13:00.000Z',
    ],
  ])('accepts a valid %s timestamp', (_, timeZone, startedAt, finishedAt, expectedStartedAt) => {
    const parsed = parseGymcoachCsv(
      csv(
        row({
          session_date: '2024-02-29',
          session_timezone: timeZone,
          session_started_at: startedAt,
          session_finished_at: finishedAt,
        }),
      ),
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows[0]?.startedAtIso).toBe(expectedStartedAt);
  });

  it('rejects a local date/timezone mismatch and invalid timezone', () => {
    const parsed = parseGymcoachCsv(
      csv(
        row({ session_id: 'bad-date', session_date: '2026-05-01' }),
        row({ session_id: 'bad-zone', session_timezone: 'Mars/Olympus' }),
      ),
    );
    expect(parsed.rows).toEqual([]);
    expect(parsed.errors).toHaveLength(2);
  });

  it('rejects an incomplete source session instead of importing its valid fragment', () => {
    const parsed = parseGymcoachCsv(csv(row({ session_set_count: '2' })));
    expect(parsed.rows).toEqual([]);
    expect(parsed.errors[0]?.reason).toMatch(/Incomplete source session/i);
  });

  it('invalidates every remaining row when one row in the source session is malformed', () => {
    const parsed = parseGymcoachCsv(
      csv(
        row({ session_set_count: '2', set_number: '1' }),
        row({ session_set_count: '2', set_number: '2', reps: '' }),
      ),
    );
    expect(parsed.rows).toEqual([]);
    expect(parsed.errors.map((error) => error.line)).toEqual([2, 3]);
  });

  it('rejects inconsistent reused session metadata', () => {
    const parsed = parseGymcoachCsv(
      csv(
        row({ session_set_count: '2', set_number: '1' }),
        row({ session_set_count: '2', set_number: '2', workout: 'Different' }),
      ),
    );
    expect(parsed.rows).toEqual([]);
    expect(parsed.errors).toHaveLength(2);
    expect(parsed.errors[0]?.reason).toMatch(/inconsistent session metadata/i);
  });

  it('rejects reused exercise names with conflicting semantics across sessions', () => {
    const parsed = parseGymcoachCsv(
      csv(
        row(),
        row({
          session_id: 'source-session-2',
          muscle_group: 'BACK_WIDTH',
        }),
      ),
    );
    expect(parsed.rows).toEqual([]);
    expect(parsed.errors).toHaveLength(2);
    expect(parsed.errors[0]?.reason).toMatch(/Exercise name is reused/i);
  });

  it('preserves repeated exercise/set_number rows allowed by the database', () => {
    const parsed = parseGymcoachCsv(
      csv(row({ session_set_count: '2' }), row({ session_set_count: '2' })),
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toHaveLength(2);
  });

  it('enforces cardio/strength and bodyweight category semantics', () => {
    const parsed = parseGymcoachCsv(
      csv(
        row({ session_id: 'strength-duration', duration_sec: '10' }),
        row({
          session_id: 'cardio-missing',
          exercise_category: 'CARDIO',
          external_load_kg: '0',
          reps: '1',
        }),
        row({
          session_id: 'cardio-bodyweight',
          exercise_category: 'CARDIO',
          uses_bodyweight: 'true',
          external_load_kg: '0',
          reps: '1',
          duration_sec: '10',
        }),
      ),
    );
    expect(parsed.rows).toEqual([]);
    expect(parsed.errors).toHaveLength(3);
  });
});

describe('parseGymcoachCsv - hostile text and limits', () => {
  it('reverses formula guards without losing a legitimate leading apostrophe', () => {
    const parsed = parseGymcoachCsv(
      csv(
        row({
          exercise: '=Bench',
          workout: '+DDE',
          set_notes: "'=literal formula text",
        }),
      ),
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({
      exerciseName: '=Bench',
      workoutName: '+DDE',
      notes: "'=literal formula text",
    });
    expect(stripFormulaGuard("''=literal")).toBe("'=literal");
    expect(stripFormulaGuard("'''=literal")).toBe("''=literal");
  });

  it('keeps quoted commas and newlines as literal data', () => {
    const parsed = parseGymcoachCsv(
      csv(row({ exercise: 'Bench, Press', set_notes: 'line one\nline two' })),
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows[0]?.exerciseName).toBe('Bench, Press');
    expect(parsed.rows[0]?.notes).toBe('line one\nline two');
  });

  it('enforces UTF-8 bytes rather than JavaScript character count', () => {
    const multibyte = 'é'.repeat(Math.floor(GYMCOACH_CSV_MAX_BYTES / 2) + 1);
    expect(multibyte.length).toBeLessThan(GYMCOACH_CSV_MAX_BYTES);
    const parsed = parseGymcoachCsv(multibyte);
    expect(parsed.ok).toBe(false);
    expect(parsed.fatalError).toMatch(/UTF-8 limit/i);
  });

  it('enforces the logical row cap before parsing session contents', () => {
    // Row-count rejection happens before row validation, so empty fields keep
    // this fixture below the independent byte cap.
    const minimalRow = HISTORY_CSV_HEADERS.map(() => '').join(',');
    const text = [
      header,
      ...Array.from({ length: GYMCOACH_CSV_MAX_ROWS + 1 }, () => minimalRow),
    ].join('\n');
    expect(new TextEncoder().encode(text).byteLength).toBeLessThanOrEqual(
      GYMCOACH_CSV_MAX_BYTES,
    );
    const parsed = parseGymcoachCsv(text);
    expect(parsed.ok).toBe(false);
    expect(parsed.fatalError).toMatch(/Too many rows/i);
  });
});
