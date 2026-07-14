'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Download, Filter, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTrainingName } from '@/components/shared/use-training-name';
import { buildHistoryCsvHref } from '@/lib/history-calendar';

interface Props {
  programs: { id: string; name: string }[];
  selectedProgramId?: string;
  selectedMonth: string;
}

export function HistoryFilters({ programs, selectedProgramId, selectedMonth }: Props) {
  const t = useTranslations('history.filters');
  const trainingName = useTrainingName();
  const router = useRouter();
  const search = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [timeZone, setTimeZone] = useState('UTC');

  useEffect(() => {
    setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  }, []);

  function updateProgram(value: string | undefined) {
    const params = new URLSearchParams(search.toString());
    params.set('month', selectedMonth);
    if (value) params.set('programId', value);
    else params.delete('programId');
    const qs = params.toString();
    startTransition(() => {
      router.push(`/history?${qs}`);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Filter className="size-4" />
        <span>{t('title')}</span>
      </div>

      <Select
        value={selectedProgramId ?? 'all'}
        onValueChange={(v) => updateProgram(v === 'all' ? undefined : v)}
      >
        <SelectTrigger aria-label={t('program')} className="h-9 w-auto min-w-[10rem]">
          <SelectValue placeholder={t('program')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t('allPrograms')}</SelectItem>
          {programs.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {trainingName(p.name)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {selectedProgramId && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => updateProgram(undefined)}
          disabled={isPending}
        >
          <X className="size-4" />
          <span className="ml-1">{t('clear')}</span>
        </Button>
      )}

      <Button variant="outline" size="sm" asChild className="ml-auto" title={t('csvTitle')}>
        <a
          href={buildHistoryCsvHref({
            programId: selectedProgramId,
            month: selectedMonth,
            timeZone,
          })}
          download
        >
          <Download className="size-4" />
          <span className="ml-1">CSV</span>
        </a>
      </Button>
    </div>
  );
}
