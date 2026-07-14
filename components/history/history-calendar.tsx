'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight, Clock, LoaderCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { formatDistance, formatDuration } from '@/lib/cardio';
import { formatWeight } from '@/lib/units';
import type { WeightUnit } from '@/lib/prisma-client';
import {
  addDaysToDateKey,
  buildHistoryHref,
  buildMonthGrid,
  getDateKeyInTimeZone,
  getMonthKeyInTimeZone,
  getWeekStartsOn,
  isDateKeyInMonth,
  parseMonthKey,
  shiftMonthKey,
} from '@/lib/history-calendar';

export interface HistoryCalendarSession {
  id: string;
  startedAt: string;
  title: string;
  programName: string | null;
  workingSets: number;
  volume: number;
  durationMin: number | null;
  cardio: {
    distanceM: number;
    durationSec: number;
    avgHr: number | null;
  } | null;
}

interface Props {
  sessions: HistoryCalendarSession[];
  visibleMonth: string;
  initialDay?: string;
  selectedProgramId?: string;
  monthWasProvided: boolean;
  unit: WeightUnit;
}

export function HistoryCalendar({
  sessions,
  visibleMonth,
  initialDay,
  selectedProgramId,
  monthWasProvided,
  unit,
}: Props) {
  const t = useTranslations('history.calendar');
  const historyT = useTranslations('history');
  const common = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [timeZone, setTimeZone] = useState('UTC');
  const [selectedDay, setSelectedDay] = useState(
    isDateKeyInMonth(initialDay, visibleMonth) ? initialDay! : `${visibleMonth}-01`,
  );
  const weekStartsOn = getWeekStartsOn(locale);
  const grid = useMemo(
    () => buildMonthGrid(visibleMonth, weekStartsOn),
    [visibleMonth, weekStartsOn],
  );

  const sessionsByDay = useMemo(() => {
    const grouped = new Map<string, HistoryCalendarSession[]>();
    for (const session of sessions) {
      const dateKey = getDateKeyInTimeZone(new Date(session.startedAt), timeZone);
      if (!isDateKeyInMonth(dateKey, visibleMonth)) continue;
      const existing = grouped.get(dateKey) ?? [];
      existing.push(session);
      grouped.set(dateKey, existing);
    }
    for (const values of grouped.values()) {
      values.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    }
    return grouped;
  }, [sessions, timeZone, visibleMonth]);

  const todayKey = getDateKeyInTimeZone(new Date(), timeZone);
  const monthTitle = formatMonthTitle(visibleMonth, locale);
  const weekdayLabels = getWeekdayLabels(locale, weekStartsOn);
  const selectedSessions = sessionsByDay.get(selectedDay) ?? [];

  useEffect(() => {
    const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    setTimeZone(browserTimeZone);

    const browserToday = getDateKeyInTimeZone(new Date(), browserTimeZone);
    const browserMonth = getMonthKeyInTimeZone(new Date(), browserTimeZone);
    if (!monthWasProvided && browserMonth !== visibleMonth) {
      startTransition(() => {
        router.replace(
          buildHistoryHref({
            month: browserMonth,
            programId: selectedProgramId,
            day: browserToday,
          }),
        );
      });
      return;
    }

    const groupedDays = sessions
      .map((session) => getDateKeyInTimeZone(new Date(session.startedAt), browserTimeZone))
      .filter((dateKey) => isDateKeyInMonth(dateKey, visibleMonth))
      .sort();
    const defaultDay =
      isDateKeyInMonth(initialDay, visibleMonth) && initialDay
        ? initialDay
        : browserMonth === visibleMonth
          ? browserToday
          : (groupedDays.at(-1) ?? `${visibleMonth}-01`);

    setSelectedDay(defaultDay);
    const href = buildHistoryHref({
      month: visibleMonth,
      programId: selectedProgramId,
      day: defaultDay,
    });
    window.history.replaceState(window.history.state, '', href);
  }, [initialDay, monthWasProvided, router, selectedProgramId, sessions, visibleMonth]);

  function navigateMonth(offset: number) {
    startTransition(() => {
      router.push(
        buildHistoryHref({
          month: shiftMonthKey(visibleMonth, offset),
          programId: selectedProgramId,
        }),
      );
    });
  }

  function selectDay(dateKey: string) {
    setSelectedDay(dateKey);
    const href = buildHistoryHref({
      month: visibleMonth,
      programId: selectedProgramId,
      day: dateKey,
    });
    window.history.replaceState(window.history.state, '', href);
  }

  function goToToday() {
    const currentDay = getDateKeyInTimeZone(new Date(), timeZone);
    const currentMonth = currentDay.slice(0, 7);
    if (currentMonth === visibleMonth) {
      selectDay(currentDay);
      document.querySelector<HTMLButtonElement>(`[data-calendar-date="${currentDay}"]`)?.focus();
      return;
    }
    startTransition(() => {
      router.push(
        buildHistoryHref({
          month: currentMonth,
          programId: selectedProgramId,
          day: currentDay,
        }),
      );
    });
  }

  function handleDayKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, dateKey: string) {
    const offset =
      event.key === 'ArrowLeft'
        ? -1
        : event.key === 'ArrowRight'
          ? 1
          : event.key === 'ArrowUp'
            ? -7
            : event.key === 'ArrowDown'
              ? 7
              : null;
    if (offset == null) return;

    event.preventDefault();
    const nextDate = addDaysToDateKey(dateKey, offset);
    if (!isDateKeyInMonth(nextDate, visibleMonth)) return;
    document.querySelector<HTMLButtonElement>(`[data-calendar-date="${nextDate}"]`)?.focus();
  }

  return (
    <div className="flex flex-col gap-4">
      <Card aria-busy={isPending}>
        <CardContent className="p-3 sm:p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-11 shrink-0"
              aria-label={t('previousMonth')}
              onClick={() => navigateMonth(-1)}
              disabled={isPending}
            >
              <ChevronLeft className="size-5" />
            </Button>

            <div className="min-w-0 text-center">
              <div className="flex items-center justify-center gap-2">
                <h2 className="truncate text-lg font-semibold capitalize sm:text-xl">
                  {monthTitle}
                </h2>
                {isPending && (
                  <LoaderCircle className="size-4 animate-spin text-muted-foreground" aria-hidden />
                )}
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={goToToday}>
                {t('today')}
              </Button>
            </div>

            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-11 shrink-0"
              aria-label={t('nextMonth')}
              onClick={() => navigateMonth(1)}
              disabled={isPending}
            >
              <ChevronRight className="size-5" />
            </Button>
          </div>

          <div role="grid" aria-label={monthTitle} className="grid grid-cols-7 gap-1">
            {weekdayLabels.map((label, index) => (
              <div
                key={`${index}-${label}`}
                role="columnheader"
                className="min-w-0 py-1 text-center text-xs font-medium text-muted-foreground"
              >
                {label}
              </div>
            ))}

            {grid.map((day) => {
              if (!day.inCurrentMonth) {
                return (
                  <div
                    key={day.dateKey}
                    role="gridcell"
                    aria-hidden="true"
                    className="min-h-12 rounded-md bg-muted/20 sm:min-h-16"
                  />
                );
              }

              const workoutCount = sessionsByDay.get(day.dateKey)?.length ?? 0;
              const isSelected = selectedDay === day.dateKey;
              const isToday = todayKey === day.dateKey;
              const dateLabel = formatDateKey(day.dateKey, locale, {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              });
              const countLabel = t('workoutCount', { count: workoutCount });

              return (
                <div key={day.dateKey} role="gridcell" className="min-w-0">
                  <button
                    type="button"
                    data-calendar-date={day.dateKey}
                    aria-label={t('dayLabel', { date: dateLabel, count: countLabel })}
                    aria-current={isToday ? 'date' : undefined}
                    aria-pressed={isSelected}
                    onClick={() => selectDay(day.dateKey)}
                    onKeyDown={(event) => handleDayKeyDown(event, day.dateKey)}
                    className={cn(
                      'flex min-h-12 w-full min-w-0 flex-col items-center justify-between rounded-md border border-transparent px-1 py-1.5 text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-16 sm:py-2',
                      isToday && 'border-foreground/50 font-bold underline underline-offset-4',
                      isSelected && 'border-primary bg-primary/10 ring-1 ring-primary',
                    )}
                  >
                    <span>{day.day}</span>
                    {workoutCount > 0 ? (
                      <span
                        aria-hidden="true"
                        className="flex min-w-5 items-center justify-center rounded-sm bg-primary px-1 text-[11px] font-semibold leading-5 text-primary-foreground"
                      >
                        {workoutCount}
                      </span>
                    ) : (
                      <span aria-hidden="true" className="h-5" />
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <section aria-labelledby="selected-history-day" className="flex flex-col gap-2">
        <div className="flex min-h-8 items-center justify-between gap-2">
          <h2 id="selected-history-day" className="text-base font-semibold capitalize sm:text-lg">
            {formatDateKey(selectedDay, locale, {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </h2>
          {selectedSessions.length > 0 && (
            <Badge variant="secondary">
              {t('workoutCount', { count: selectedSessions.length })}
            </Badge>
          )}
        </div>

        {selectedSessions.length === 0 ? (
          <div className="rounded-md border border-dashed px-4 py-5 text-center text-sm text-muted-foreground">
            {t('noWorkouts')}
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {selectedSessions.map((session) => {
              const time = new Intl.DateTimeFormat(locale, {
                timeZone,
                hour: '2-digit',
                minute: '2-digit',
              }).format(new Date(session.startedAt));
              const returnParams = new URLSearchParams({
                month: visibleMonth,
                day: selectedDay,
              });
              if (selectedProgramId) returnParams.set('programId', selectedProgramId);
              return (
                <li key={session.id}>
                  <Link
                    href={`/history/${session.id}?${returnParams.toString()}`}
                    aria-label={t('openSession', { name: session.title, time })}
                    className="block"
                  >
                    <Card className="transition-colors hover:bg-accent/40">
                      <CardContent className="flex items-center justify-between gap-3 p-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Clock className="size-3.5" />
                            <span>{time}</span>
                          </div>
                          <p className="mt-0.5 truncate text-base font-medium">{session.title}</p>
                          <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                            {session.programName && (
                              <Badge variant="secondary">{session.programName}</Badge>
                            )}
                            {session.cardio ? (
                              <>
                                {session.cardio.distanceM > 0 && (
                                  <Badge variant="outline">
                                    {formatDistance(session.cardio.distanceM)}
                                  </Badge>
                                )}
                                <Badge variant="outline">
                                  {formatDuration(
                                    session.cardio.durationSec || (session.durationMin ?? 0) * 60,
                                  )}
                                </Badge>
                                {session.cardio.avgHr != null && (
                                  <Badge variant="outline">{session.cardio.avgHr} bpm</Badge>
                                )}
                              </>
                            ) : (
                              <>
                                <Badge variant="outline">
                                  {common('counts.sets', { count: session.workingSets })}
                                </Badge>
                                <Badge variant="outline">
                                  {historyT('volumeShort', {
                                    weight: formatWeight(session.volume, unit, {
                                      decimals: 0,
                                      locale,
                                    }),
                                  })}
                                </Badge>
                                {session.durationMin != null && (
                                  <Badge variant="outline">
                                    {historyT('minutes', { count: session.durationMin })}
                                  </Badge>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                        <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
                      </CardContent>
                    </Card>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function formatMonthTitle(monthKey: string, locale: string): string {
  const parsed = parseMonthKey(monthKey);
  if (!parsed) return monthKey;
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(new Date(Date.UTC(parsed.year, parsed.month - 1, 1)));
}

function formatDateKey(
  dateKey: string,
  locale: string,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(
    new Date(`${dateKey}T12:00:00.000Z`),
  );
}

function getWeekdayLabels(locale: string, weekStartsOn: 0 | 1): string[] {
  const formatter = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
  const sunday = Date.UTC(2026, 0, 4);
  return Array.from({ length: 7 }, (_, index) => {
    const weekday = (weekStartsOn + index) % 7;
    return formatter.format(new Date(sunday + weekday * 24 * 60 * 60 * 1000));
  });
}
