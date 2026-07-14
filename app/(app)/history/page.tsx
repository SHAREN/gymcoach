import { getLocale, getTranslations } from 'next-intl/server';
import { CalendarDays } from 'lucide-react';
import { db } from '@/lib/db';
import { requireSession } from '@/lib/auth';
import { EmptyState } from '@/components/ui/empty-state';
import { applyBodyweight, totalVolume } from '@/lib/stats';
import { HistoryFilters } from '@/components/history/history-filters';
import {
  HistoryCalendar,
  type HistoryCalendarSession,
} from '@/components/history/history-calendar';
import { getExerciseDisplayName } from '@/i18n/exercise-names';
import { getTrainingDisplayName } from '@/i18n/training-names';
import {
  formatUtcMonthKey,
  getMonthQueryRange,
  isDateKeyInMonth,
  parseMonthKey,
} from '@/lib/history-calendar';

interface SearchParams {
  programId?: string;
  month?: string;
  day?: string;
}

export default async function HistoryPage(props: { searchParams: Promise<SearchParams> }) {
  const t = await getTranslations('history');
  const locale = await getLocale();
  const searchParams = await props.searchParams;
  const session = await requireSession();
  const monthWasProvided = parseMonthKey(searchParams.month) != null;
  const visibleMonth = monthWasProvided ? searchParams.month! : formatUtcMonthKey(new Date());
  const monthRange = getMonthQueryRange(visibleMonth);
  const programFilter = searchParams.programId ? { programId: searchParams.programId } : {};

  const [sessions, programs, user, anyHistory] = await Promise.all([
    db.session.findMany({
      where: {
        userId: session.userId,
        finishedAt: { not: null },
        startedAt: monthRange,
        ...programFilter,
      },
      orderBy: { startedAt: 'desc' },
      include: {
        workout: { select: { name: true } },
        program: { select: { name: true } },
        sets: {
          select: {
            weight: true,
            reps: true,
            isWarmup: true,
            durationSec: true,
            distanceM: true,
            avgHr: true,
            exercise: { select: { usesBodyweight: true, name: true, category: true } },
          },
        },
      },
    }),
    db.program.findMany({
      where: { userId: session.userId },
      orderBy: [{ isActive: 'desc' }, { startDate: 'desc' }],
      select: { id: true, name: true },
    }),
    db.user.findUnique({
      where: { id: session.userId },
      select: { bodyweight: true, unit: true },
    }),
    db.session.findFirst({
      where: { userId: session.userId, finishedAt: { not: null } },
      select: { id: true },
    }),
  ]);
  const unit = user?.unit ?? 'KG';

  const calendarSessions: HistoryCalendarSession[] = sessions.map((item) => {
    const enrichedSets = applyBodyweight(
      item.sets.map((set) => ({
        weight: set.weight,
        reps: set.reps,
        isWarmup: set.isWarmup,
        durationSec: set.durationSec,
        usesBodyweight: set.exercise.usesBodyweight,
      })),
      user?.bodyweight,
    );
    const working = item.sets.filter((set) => !set.isWarmup);
    const cardioSets = working.filter(
      (set) => set.exercise.category === 'CARDIO' && set.durationSec != null,
    );
    const isCardio = working.length > 0 && cardioSets.length === working.length;
    const cardioName = cardioSets[0]?.exercise.name
      ? getExerciseDisplayName(cardioSets[0].exercise.name, locale)
      : t('cardio');
    const durationMin = item.finishedAt
      ? Math.round((item.finishedAt.getTime() - item.startedAt.getTime()) / 60000)
      : null;

    return {
      id: item.id,
      startedAt: item.startedAt.toISOString(),
      title: item.workout?.name
        ? getTrainingDisplayName(item.workout.name, locale)
        : isCardio
          ? cardioName
          : t('freeSession'),
      programName: item.program?.name ? getTrainingDisplayName(item.program.name, locale) : null,
      workingSets: working.length,
      volume: totalVolume(enrichedSets),
      durationMin,
      cardio: isCardio
        ? {
            distanceM: cardioSets.reduce((sum, set) => sum + (set.distanceM ?? 0), 0),
            durationSec: cardioSets.reduce((sum, set) => sum + (set.durationSec ?? 0), 0),
            avgHr: cardioSets.find((set) => set.avgHr != null)?.avgHr ?? null,
          }
        : null,
    };
  });

  return (
    <main className="flex-1 px-4 py-6">
      <div className="mx-auto flex max-w-2xl flex-col gap-5">
        <div className="flex items-center gap-3">
          <CalendarDays className="size-6" />
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        </div>

        <HistoryFilters
          programs={programs}
          selectedProgramId={searchParams.programId}
          selectedMonth={visibleMonth}
        />

        {!anyHistory ? (
          <EmptyState
            icon={CalendarDays}
            title={t('emptyTitle')}
            description={t('emptyDescription')}
            action={{ label: t('firstSession'), href: '/session/new' }}
          />
        ) : (
          <HistoryCalendar
            sessions={calendarSessions}
            visibleMonth={visibleMonth}
            initialDay={
              isDateKeyInMonth(searchParams.day, visibleMonth) ? searchParams.day : undefined
            }
            selectedProgramId={searchParams.programId}
            monthWasProvided={monthWasProvided}
            unit={unit}
          />
        )}
      </div>
    </main>
  );
}
