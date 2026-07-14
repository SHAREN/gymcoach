import { describe, expect, it } from 'vitest';
import {
  buildHistoryCsvHref,
  buildHistoryHref,
  buildMonthGrid,
  getDateKeyInTimeZone,
  getMonthQueryRange,
  getWeekStartsOn,
  shiftMonthKey,
} from './history-calendar';

describe('history calendar dates', () => {
  it.each([
    ['2026-02', 28],
    ['2024-02', 29],
    ['2026-04', 30],
    ['2026-05', 31],
  ])('builds a stable six-week grid for %s', (month, daysInMonth) => {
    const grid = buildMonthGrid(month, 1);
    expect(grid).toHaveLength(42);
    expect(grid.filter((day) => day.inCurrentMonth)).toHaveLength(daysInMonth);
  });

  it.each([
    ['2026-06', 1],
    ['2026-09', 2],
    ['2026-04', 3],
    ['2026-01', 4],
    ['2026-05', 5],
    ['2026-08', 6],
    ['2026-02', 0],
  ])('aligns a month beginning on weekday %s in a Monday-first grid', (month, weekday) => {
    const grid = buildMonthGrid(month, 1);
    const first = grid.findIndex((day) => day.inCurrentMonth);
    expect(first).toBe((weekday - 1 + 7) % 7);
  });

  it('shifts across year boundaries', () => {
    expect(shiftMonthKey('2026-01', -1)).toBe('2025-12');
    expect(shiftMonthKey('2026-12', 1)).toBe('2027-01');
  });

  it('starts Russian weeks on Monday and English weeks on Sunday', () => {
    expect(getWeekStartsOn('ru')).toBe(1);
    expect(getWeekStartsOn('ru-RU')).toBe(1);
    expect(getWeekStartsOn('en')).toBe(0);
  });

  it('rejects impossible selected dates', () => {
    expect(buildHistoryHref({ month: '2026-05', day: '2026-05-99' })).toBe(
      '/history?month=2026-05',
    );
  });

  it('groups a near-midnight session by the requested local timezone', () => {
    const session = new Date('2026-05-01T00:30:00.000Z');
    expect(getDateKeyInTimeZone(session, 'America/Los_Angeles')).toBe('2026-04-30');
    expect(getDateKeyInTimeZone(session, 'Asia/Yekaterinburg')).toBe('2026-05-01');
  });

  it('pads the database query enough to cover every browser timezone', () => {
    const range = getMonthQueryRange('2026-05');
    expect(range.gte.toISOString()).toBe('2026-04-29T12:00:00.000Z');
    expect(range.lt.toISOString()).toBe('2026-06-02T12:00:00.000Z');
  });
});

describe('history calendar URLs', () => {
  it('preserves the program while changing month and drops an unrelated day', () => {
    expect(buildHistoryHref({ month: '2026-06', programId: 'program-1', day: '2026-05-20' })).toBe(
      '/history?month=2026-06&programId=program-1',
    );
  });

  it('includes the visible month and browser timezone in CSV exports', () => {
    expect(
      buildHistoryCsvHref({
        month: '2026-05',
        programId: 'program-1',
        timeZone: 'Asia/Yekaterinburg',
      }),
    ).toBe('/api/history/csv?month=2026-05&programId=program-1&timeZone=Asia%2FYekaterinburg');
  });
});
