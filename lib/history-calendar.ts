const MONTH_KEY_RE = /^(\d{4})-(\d{2})$/;
const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const QUERY_RANGE_PADDING_MS = 36 * 60 * 60 * 1000;

export interface CalendarDay {
  dateKey: string;
  day: number;
  inCurrentMonth: boolean;
}

export function parseMonthKey(month: string | null | undefined): {
  year: number;
  month: number;
} | null {
  const match = month?.match(MONTH_KEY_RE);
  if (!match) return null;

  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (year < 1000 || monthNumber < 1 || monthNumber > 12) return null;
  return { year, month: monthNumber };
}

export function isDateKeyInMonth(dateKey: string | null | undefined, monthKey: string): boolean {
  const match = dateKey?.match(DATE_KEY_RE);
  const month = parseMonthKey(monthKey);
  if (!match || !month) return false;

  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, monthNumber - 1, day));
  return (
    year === month.year &&
    monthNumber === month.month &&
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === monthNumber - 1 &&
    parsed.getUTCDate() === day
  );
}

export function getWeekStartsOn(locale: string): 0 | 1 {
  return locale.toLowerCase().startsWith('ru') ? 1 : 0;
}

export function formatUtcMonthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function shiftMonthKey(monthKey: string, offset: number): string {
  const parsed = parseMonthKey(monthKey);
  if (!parsed) throw new Error(`Invalid month key: ${monthKey}`);
  const date = new Date(Date.UTC(parsed.year, parsed.month - 1 + offset, 1));
  return formatUtcMonthKey(date);
}

export function buildMonthGrid(monthKey: string, weekStartsOn: 0 | 1): CalendarDay[] {
  const parsed = parseMonthKey(monthKey);
  if (!parsed) throw new Error(`Invalid month key: ${monthKey}`);

  const firstDay = new Date(Date.UTC(parsed.year, parsed.month - 1, 1));
  const leadingDays = (firstDay.getUTCDay() - weekStartsOn + 7) % 7;
  const gridStart = new Date(firstDay.getTime() - leadingDays * 24 * 60 * 60 * 1000);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart.getTime() + index * 24 * 60 * 60 * 1000);
    const dateKey = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    return {
      dateKey,
      day: date.getUTCDate(),
      inCurrentMonth:
        date.getUTCFullYear() === parsed.year && date.getUTCMonth() === parsed.month - 1,
    };
  });
}

export function addDaysToDateKey(dateKey: string, offset: number): string {
  const match = dateKey.match(DATE_KEY_RE);
  if (!match) throw new Error(`Invalid date key: ${dateKey}`);
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + offset),
  );
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function normalizeTimeZone(value: string | null | undefined): string {
  if (!value) return 'UTC';
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format(new Date(0));
    return value;
  } catch {
    return 'UTC';
  }
}

export function getDateKeyInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: normalizeTimeZone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function getMonthKeyInTimeZone(date: Date, timeZone: string): string {
  return getDateKeyInTimeZone(date, timeZone).slice(0, 7);
}

export function getMonthQueryRange(monthKey: string): { gte: Date; lt: Date } {
  const parsed = parseMonthKey(monthKey);
  if (!parsed) throw new Error(`Invalid month key: ${monthKey}`);

  return {
    gte: new Date(Date.UTC(parsed.year, parsed.month - 1, 1) - QUERY_RANGE_PADDING_MS),
    lt: new Date(Date.UTC(parsed.year, parsed.month, 1) + QUERY_RANGE_PADDING_MS),
  };
}

export function buildHistoryHref({
  month,
  programId,
  day,
}: {
  month: string;
  programId?: string;
  day?: string;
}): string {
  const params = new URLSearchParams({ month });
  if (programId) params.set('programId', programId);
  if (day && isDateKeyInMonth(day, month)) params.set('day', day);
  return `/history?${params.toString()}`;
}

export function buildHistoryCsvHref({
  month,
  programId,
  timeZone,
}: {
  month: string;
  programId?: string;
  timeZone?: string;
}): string {
  const params = new URLSearchParams({ month });
  if (programId) params.set('programId', programId);
  if (timeZone) params.set('timeZone', normalizeTimeZone(timeZone));
  return `/api/history/csv?${params.toString()}`;
}
