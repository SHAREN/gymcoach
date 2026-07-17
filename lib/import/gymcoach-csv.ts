import { z } from 'zod';
import {
  AVG_HR_MAX,
  AVG_HR_MIN,
  MAX_DISTANCE_M,
  MAX_DURATION_SEC,
  MAX_HR_MAX,
  MAX_HR_MIN,
} from '@/lib/cardio';
import { getDateKeyInTimeZone } from '@/lib/history-calendar';
import {
  headerKey,
  IMPORT_CSV_MAX_BYTES,
  IMPORT_CSV_MAX_ROWS,
  readCsvRecords,
  type CsvLineError,
} from '@/lib/import/csv';
import { ExerciseCategory, MuscleGroup } from '@/lib/prisma-client';

export const GYMCOACH_CSV_MAX_BYTES = IMPORT_CSV_MAX_BYTES;
export const GYMCOACH_CSV_MAX_ROWS = IMPORT_CSV_MAX_ROWS;
// JSON can expand a text payload to six bytes per character through \uXXXX
// escaping. This bounds the envelope while the parser separately enforces the
// decoded CSV UTF-8 byte cap.
export const GYMCOACH_JSON_MAX_BYTES = GYMCOACH_CSV_MAX_BYTES * 6 + 1_024;

const muscleGroups = Object.values(MuscleGroup) as [MuscleGroup, ...MuscleGroup[]];
const exerciseCategories = Object.values(ExerciseCategory) as [
  ExerciseCategory,
  ...ExerciseCategory[],
];

export interface GymcoachCsvRow {
  line: number;
  sourceSessionId: string;
  dateKey: string;
  timeZone: string;
  sourceSetCount: number;
  startedAtIso: string;
  finishedAtIso: string;
  programName: string;
  workoutName: string;
  exerciseName: string;
  muscleGroup: MuscleGroup;
  category: ExerciseCategory;
  usesBodyweight: boolean;
  setOrder: number;
  weightKg: number;
  reps: number;
  rir: number | null;
  isWarmup: boolean;
  isDropSet: boolean;
  notes: string | null;
  durationSec: number | null;
  distanceM: number | null;
  avgHr: number | null;
  maxHr: number | null;
}

export interface GymcoachCsvParseResult {
  ok: boolean;
  fatalError: string | null;
  rows: GymcoachCsvRow[];
  errors: CsvLineError[];
}

interface HeaderMap {
  sourceSessionId: number;
  sessionDate: number;
  timeZone: number;
  sourceSetCount: number;
  startedAt: number;
  finishedAt: number;
  program: number;
  workout: number;
  exercise: number;
  muscleGroup: number;
  category: number;
  usesBodyweight: number;
  setNumber: number;
  weight: number;
  reps: number;
  rir: number;
  isWarmup: number;
  isDropSet: number;
  notes: number;
  durationSec: number;
  distanceM: number;
  avgHr: number;
  maxHr: number;
}

const sourceSessionIdSchema = z.string().trim().min(1).max(120);

const rowSchema = z.object({
  sourceSessionId: sourceSessionIdSchema,
  dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timeZone: z.string().trim().min(1).max(100),
  sourceSetCount: z.number().int().min(1).max(GYMCOACH_CSV_MAX_ROWS),
  startedAtIso: z.string().datetime({ offset: true }),
  finishedAtIso: z.string().datetime({ offset: true }),
  programName: z.string().trim().max(200),
  workoutName: z.string().trim().max(200),
  exerciseName: z.string().trim().min(1).max(120),
  muscleGroup: z.enum(muscleGroups),
  category: z.enum(exerciseCategories),
  usesBodyweight: z.boolean(),
  setOrder: z.number().int().min(1).max(50),
  weightKg: z.number().min(0).max(500),
  reps: z.number().int().min(0).max(100),
  rir: z.number().int().min(0).max(5).nullable(),
  isWarmup: z.boolean(),
  isDropSet: z.boolean(),
  notes: z.string().max(500).nullable(),
  durationSec: z.number().int().min(1).max(MAX_DURATION_SEC).nullable(),
  distanceM: z.number().min(0).max(MAX_DISTANCE_M).nullable(),
  avgHr: z.number().int().min(AVG_HR_MIN).max(AVG_HR_MAX).nullable(),
  maxHr: z.number().int().min(MAX_HR_MIN).max(MAX_HR_MAX).nullable(),
});

function mapHeader(cells: string[]): HeaderMap | null {
  const keys = cells.map(headerKey);
  const find = (name: string) => keys.indexOf(name);
  const map: HeaderMap = {
    sourceSessionId: find('session_id'),
    sessionDate: find('session_date'),
    timeZone: find('session_timezone'),
    sourceSetCount: find('session_set_count'),
    startedAt: find('session_started_at'),
    finishedAt: find('session_finished_at'),
    program: find('program'),
    workout: find('workout'),
    exercise: find('exercise'),
    muscleGroup: find('muscle_group'),
    category: find('exercise_category'),
    usesBodyweight: find('uses_bodyweight'),
    setNumber: find('set_number'),
    weight: find('external_load_kg'),
    reps: find('reps'),
    rir: find('rir'),
    isWarmup: find('is_warmup'),
    isDropSet: find('is_drop_set'),
    notes: find('set_notes'),
    durationSec: find('duration_sec'),
    distanceM: find('distance_m'),
    avgHr: find('avg_hr'),
    maxHr: find('max_hr'),
  };
  return Object.values(map).some((index) => index < 0) ? null : map;
}

export function stripFormulaGuard(value: string): string {
  return /^'+[=+\-@\t\r]/.test(value) ? value.slice(1) : value;
}

function parseDateKey(cell: string | undefined): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((cell ?? '').trim());
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return undefined;
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function parseTimeZone(cell: string | undefined): string | undefined {
  const value = (cell ?? '').trim();
  if (!value) return undefined;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format(new Date(0));
    return value;
  } catch {
    return undefined;
  }
}

function parseTimestamp(cell: string | undefined): string | undefined {
  const value = (cell ?? '').trim();
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(?:Z|([+-])(\d{2}):(\d{2}))$/i.exec(
      value,
    );
  if (!match) {
    return undefined;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const millisecond = Number((match[7] ?? '').padEnd(3, '0') || '0');
  const localTime = new Date(0);
  localTime.setUTCFullYear(year, month - 1, day);
  localTime.setUTCHours(hour, minute, second, millisecond);
  if (
    localTime.getUTCFullYear() !== year ||
    localTime.getUTCMonth() !== month - 1 ||
    localTime.getUTCDate() !== day ||
    localTime.getUTCHours() !== hour ||
    localTime.getUTCMinutes() !== minute ||
    localTime.getUTCSeconds() !== second ||
    localTime.getUTCMilliseconds() !== millisecond
  ) {
    return undefined;
  }

  if (match[8] && (Number(match[9]) > 23 || Number(match[10]) > 59)) {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function parseNumber(
  cell: string | undefined,
  { optional = false }: { optional?: boolean } = {},
): number | null {
  const value = (cell ?? '').trim();
  if (!value) return optional ? null : Number.NaN;
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) return Number.NaN;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function parseBoolean(
  cell: string | undefined,
  { optional = false }: { optional?: boolean } = {},
): boolean | undefined {
  const value = (cell ?? '').trim().toLowerCase();
  if (!value && optional) return false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue ? `${issue.path.join('.')}: ${issue.message}` : 'Invalid row.';
}

export function gymcoachSessionMetadata(row: GymcoachCsvRow): string {
  return JSON.stringify([
    row.dateKey,
    row.timeZone,
    row.sourceSetCount,
    row.startedAtIso,
    row.finishedAtIso,
    row.programName,
    row.workoutName,
  ]);
}

function exerciseMetadata(row: GymcoachCsvRow): string {
  return JSON.stringify([
    row.exerciseName.trim().toLowerCase(),
    row.muscleGroup,
    row.category,
    row.usesBodyweight,
  ]);
}

export function parseGymcoachCsv(text: string): GymcoachCsvParseResult {
  const fail = (fatalError: string): GymcoachCsvParseResult => ({
    ok: false,
    fatalError,
    rows: [],
    errors: [],
  });

  if (new TextEncoder().encode(text).byteLength > GYMCOACH_CSV_MAX_BYTES) {
    return fail('File too large: the UTF-8 limit is 5 MB.');
  }

  const records = readCsvRecords(text.replace(/^﻿/, ''));
  const header = records[0];
  if (!header) return fail('Empty file.');
  const map = mapHeader(header.fields);
  if (!map) {
    return fail(
      'Unrecognized format: export a fresh GymCoach history CSV with session_id, ' +
        'session_date, session_timezone, session_set_count, exercise_category and set fields.',
    );
  }

  const dataRecords = records.slice(1);
  if (dataRecords.length > GYMCOACH_CSV_MAX_ROWS) {
    return fail(
      `Too many rows: ${dataRecords.length} (the limit is ${GYMCOACH_CSV_MAX_ROWS}). Split only between complete sessions.`,
    );
  }

  const candidates: GymcoachCsvRow[] = [];
  const errorByLine = new Map<number, string>();
  const sourceSessionIdByLine = new Map<number, string>();
  const addError = (line: number, reason: string) => {
    if (!errorByLine.has(line)) errorByLine.set(line, reason);
  };

  for (const record of dataRecords) {
    const get = (index: number) => record.fields[index];
    const sourceSessionIdValue = stripFormulaGuard(get(map.sourceSessionId) ?? '');
    const sourceSessionId = sourceSessionIdSchema.safeParse(sourceSessionIdValue);
    if (sourceSessionId.success) {
      sourceSessionIdByLine.set(record.line, sourceSessionId.data);
    }
    const notesValue = stripFormulaGuard(get(map.notes) ?? '');
    const usesBodyweight = parseBoolean(get(map.usesBodyweight));
    const isWarmup = parseBoolean(get(map.isWarmup), { optional: true });
    const isDropSet = parseBoolean(get(map.isDropSet), { optional: true });
    if (usesBodyweight === undefined) {
      addError(record.line, 'uses_bodyweight must be true or false.');
      continue;
    }
    if (isWarmup === undefined) {
      addError(record.line, 'is_warmup must be true, false or empty.');
      continue;
    }
    if (isDropSet === undefined) {
      addError(record.line, 'is_drop_set must be true, false or empty.');
      continue;
    }
    const parsed = rowSchema.safeParse({
      sourceSessionId: sourceSessionIdValue,
      dateKey: parseDateKey(get(map.sessionDate)),
      timeZone: parseTimeZone(get(map.timeZone)),
      sourceSetCount: parseNumber(get(map.sourceSetCount)),
      startedAtIso: parseTimestamp(get(map.startedAt)),
      finishedAtIso: parseTimestamp(get(map.finishedAt)),
      programName: stripFormulaGuard(get(map.program) ?? ''),
      workoutName: stripFormulaGuard(get(map.workout) ?? ''),
      exerciseName: stripFormulaGuard(get(map.exercise) ?? ''),
      muscleGroup: (get(map.muscleGroup) ?? '').trim().toUpperCase(),
      category: (get(map.category) ?? '').trim().toUpperCase(),
      usesBodyweight,
      setOrder: parseNumber(get(map.setNumber)),
      weightKg: parseNumber(get(map.weight)),
      reps: parseNumber(get(map.reps)),
      rir: parseNumber(get(map.rir), { optional: true }),
      isWarmup,
      isDropSet,
      notes: notesValue === '' ? null : notesValue,
      durationSec: parseNumber(get(map.durationSec), { optional: true }),
      distanceM: parseNumber(get(map.distanceM), { optional: true }),
      avgHr: parseNumber(get(map.avgHr), { optional: true }),
      maxHr: parseNumber(get(map.maxHr), { optional: true }),
    });
    if (!parsed.success) {
      addError(record.line, firstIssue(parsed.error));
      continue;
    }

    const row: GymcoachCsvRow = { line: record.line, ...parsed.data };
    const startedAt = new Date(row.startedAtIso);
    const finishedAt = new Date(row.finishedAtIso);
    if (finishedAt.getTime() < startedAt.getTime()) {
      addError(record.line, 'session_finished_at must not be before session_started_at.');
      continue;
    }
    if (getDateKeyInTimeZone(startedAt, row.timeZone) !== row.dateKey) {
      addError(record.line, 'session_date does not match session_started_at in session_timezone.');
      continue;
    }
    if (row.category === 'CARDIO') {
      if (row.durationSec === null) {
        addError(record.line, 'A CARDIO row requires duration_sec.');
        continue;
      }
      if (row.weightKg !== 0 || row.reps !== 1) {
        addError(record.line, 'A CARDIO row must use external_load_kg 0 and reps 1.');
        continue;
      }
      if (row.usesBodyweight) {
        addError(record.line, 'A CARDIO exercise cannot use bodyweight load semantics.');
        continue;
      }
    } else if (
      row.durationSec !== null ||
      row.distanceM !== null ||
      row.avgHr !== null ||
      row.maxHr !== null
    ) {
      addError(
        record.line,
        'duration_sec, distance_m, avg_hr and max_hr are only valid for CARDIO rows.',
      );
      continue;
    }
    if (row.maxHr !== null && row.avgHr !== null && row.maxHr < row.avgHr) {
      addError(record.line, 'max_hr must be greater than or equal to avg_hr.');
      continue;
    }
    candidates.push(row);
  }

  const sessions = new Map<string, GymcoachCsvRow[]>();
  const exercises = new Map<string, GymcoachCsvRow[]>();
  for (const row of candidates) {
    const sessionRows = sessions.get(row.sourceSessionId) ?? [];
    sessionRows.push(row);
    sessions.set(row.sourceSessionId, sessionRows);
    const exerciseKey = row.exerciseName.trim().toLowerCase();
    const exerciseRows = exercises.get(exerciseKey) ?? [];
    exerciseRows.push(row);
    exercises.set(exerciseKey, exerciseRows);
  }

  for (const rows of sessions.values()) {
    const metadata = new Set(rows.map(gymcoachSessionMetadata));
    if (metadata.size !== 1) {
      for (const row of rows) {
        addError(row.line, 'session_id is reused with inconsistent session metadata.');
      }
      continue;
    }
    if (rows.length !== rows[0]!.sourceSetCount) {
      for (const row of rows) {
        addError(
          row.line,
          `Incomplete source session: expected ${rows[0]!.sourceSetCount} rows, received ${rows.length}.`,
        );
      }
    }
  }

  for (const rows of exercises.values()) {
    if (new Set(rows.map(exerciseMetadata)).size === 1) continue;
    for (const row of rows) {
      addError(
        row.line,
        'Exercise name is reused with inconsistent muscle_group, exercise_category or uses_bodyweight.',
      );
    }
  }

  // A source session is atomic. Track a schema-valid source ID before the rest
  // of row validation so even a row that never becomes a candidate can
  // quarantine every parsed sibling with the same identity.
  const invalidSourceSessionIds = new Set<string>();
  for (const line of errorByLine.keys()) {
    const sourceSessionId = sourceSessionIdByLine.get(line);
    if (sourceSessionId) invalidSourceSessionIds.add(sourceSessionId);
  }
  for (const row of candidates) {
    if (invalidSourceSessionIds.has(row.sourceSessionId)) {
      addError(row.line, 'Source session skipped because one or more rows are invalid.');
    }
  }

  const rows = candidates.filter((row) => !errorByLine.has(row.line));
  const errors = [...errorByLine.entries()]
    .sort(([left], [right]) => left - right)
    .map(([line, reason]) => ({ line, reason }));
  return { ok: true, fatalError: null, rows, errors };
}
