'use client';

import { CalendarCheck2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

export function ExerciseTrainingDays({ count }: { count: number }) {
  const t = useTranslations('exercises');

  return (
    <span
      role="img"
      aria-label={t('trainedDays', { count })}
      className="inline-flex shrink-0 items-center gap-1 tabular-nums"
    >
      <CalendarCheck2 aria-hidden="true" className="size-3.5 shrink-0" />
      <span aria-hidden="true">{count}</span>
    </span>
  );
}
