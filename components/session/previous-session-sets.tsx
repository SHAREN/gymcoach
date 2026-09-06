'use client';

import Link from 'next/link';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { History, TrendingUp } from 'lucide-react';
import type { WeightUnit } from '@/lib/prisma-client';
import { formatWeight } from '@/lib/units';
import type { SerializedLastPerformance } from '@/components/session/session-runner';
import { Button } from '@/components/ui/button';

interface Props {
  performance: SerializedLastPerformance | undefined;
  exerciseId: string;
  unit: WeightUnit;
}

export function PreviousSessionSets({ performance, exerciseId, unit }: Props) {
  const t = useTranslations('session.previousSession');
  const locale = useLocale();
  const format = useFormatter();

  if (!performance || performance.sets.length === 0) return null;

  const date = format.dateTime(new Date(performance.sessionStartedAt), {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  return (
    <section
      data-testid="previous-session"
      className="overflow-hidden rounded-md border border-border bg-muted/20"
    >
      <div className="border-b border-border px-3 py-2">
        <h3 className="text-xs font-medium text-muted-foreground">{t('title', { date })}</h3>
        {performance.equipmentName && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('equipment', { name: performance.equipmentName })}
          </p>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[20rem] table-fixed text-center text-xs tabular-nums">
          <thead className="text-[0.6875rem] uppercase text-muted-foreground">
            <tr>
              <th className="w-10 px-2 py-2 font-medium">#</th>
              <th className="px-2 py-2 font-medium">{unit}</th>
              <th className="px-2 py-2 font-medium">{t('reps')}</th>
              <th className="px-2 py-2 font-medium">RIR</th>
            </tr>
          </thead>
          <tbody>
            {performance.sets.map((set, index) => (
              <tr
                key={[index, set.weight, set.reps].join('-')}
                className="border-t border-border/70"
              >
                <td className="px-2 py-2.5 text-muted-foreground">{index + 1}</td>
                <td className="px-2 py-2.5 font-medium">
                  {formatWeight(set.weight, unit, { decimals: 2, group: false, locale })}
                </td>
                <td className="px-2 py-2.5 font-medium">{set.reps}</td>
                <td className="px-2 py-2.5 font-medium">{set.rir ?? '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-border p-2">
        {performance.sessionId && (
          <Button variant="ghost" size="sm" asChild>
            <Link href={'/history/' + performance.sessionId}>
              <History className="size-4" />
              <span className="ml-1">{t('history')}</span>
            </Link>
          </Button>
        )}
        <Button variant="ghost" size="sm" asChild>
          <Link href={'/progress?exerciseId=' + encodeURIComponent(exerciseId)}>
            <TrendingUp className="size-4" />
            <span className="ml-1">{t('progress')}</span>
          </Link>
        </Button>
      </div>
    </section>
  );
}
