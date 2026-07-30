'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { BatteryCharging, BatteryLow } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import type {
  DeloadActivitySummary,
  DeloadReason,
  DeloadRecommendation,
  ResolvedDeloadRecommendation,
} from '@/lib/deload';
import { useExerciseName } from '@/components/shared/use-exercise-name';

interface Props {
  recommendation?: DeloadRecommendation;
  // Compatibility for older focused component tests/callers. Product callers
  // pass the resolved shared recommendation.
  reasons?: DeloadReason[];
  // End of the active planned deload week (ISO string), or null when none is
  // running. The server only passes a future timestamp here.
  deloadUntil: string | null;
}

// Banner shown on the progress page when recommendDeload fires or a planned
// deload week is running (issue #112). One tap starts the deload week (the
// suggestion engine then steps loads down ~10%); while active it shows the end
// date and lets the user end it early.
export function DeloadBanner({
  recommendation: providedRecommendation,
  reasons: legacyReasons = [],
  deloadUntil,
}: Props) {
  const t = useTranslations('progress.deload');
  const format = useFormatter();
  const exerciseName = useExerciseName();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const active = deloadUntil != null;
  const reasons = providedRecommendation?.reasons ?? legacyReasons;
  const state = providedRecommendation?.state ?? (reasons.length > 0 ? 'planned-deload' : 'none');
  const recommendation: ResolvedDeloadRecommendation = {
    recommended: providedRecommendation?.recommended ?? reasons.length > 0,
    reasons,
    state,
    activity: providedRecommendation?.activity ?? EMPTY_ACTIVITY,
  };

  if (!active && recommendation.state === 'none') return null;

  async function startDeload() {
    setBusy(true);
    try {
      const res = await fetch('/api/deload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast.error(data?.error ?? t('startError'));
        return;
      }
      toast.success(t('started'));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function endDeload() {
    setBusy(true);
    try {
      const res = await fetch('/api/deload', { method: 'DELETE' });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast.error(data?.error ?? t('endError'));
        return;
      }
      toast.success(t('ended'));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (active) {
    const endDate = format.dateTime(new Date(deloadUntil!), {
      day: '2-digit',
      month: 'short',
    });
    return (
      <Card className="border-emerald-500/50 bg-emerald-500/5">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <BatteryCharging className="size-4 text-emerald-600" />
            <h2 className="text-base font-semibold">{t('activeTitle')}</h2>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p className="text-muted-foreground">{t('activeDescription', { date: endDate })}</p>
          <div>
            <Button variant="outline" size="sm" onClick={endDeload} disabled={busy}>
              {t('end')}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (recommendation.state === 'recovery-break-completed') {
    return (
      <Card className="border-sky-500/50 bg-sky-500/5">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <BatteryCharging className="size-4 text-sky-600" />
            <h2 className="text-base font-semibold">{t('recoveryCompletedTitle')}</h2>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <p className="text-muted-foreground">
            {t('recoveryCompletedDescription', {
              days: recommendation.activity.daysSinceLastMeaningfulWorkout ?? 0,
              workouts: recommendation.activity.recent7DayCompletedWorkouts,
              sets: recommendation.activity.recent7DayWorkingSets,
            })}
          </p>
          {recommendation.activity.averageReadiness != null && (
            <p className="text-xs text-muted-foreground">
              {recommendation.activity.maxReportedSoreness == null
                ? t('recoveryMetricsNoSoreness', {
                    readiness: recommendation.activity.averageReadiness,
                    sleep: recommendation.activity.latestSleepQuality ?? 0,
                  })
                : t('recoveryMetrics', {
                    readiness: recommendation.activity.averageReadiness,
                    sleep: recommendation.activity.latestSleepQuality ?? 0,
                    soreness: recommendation.activity.maxReportedSoreness,
                  })}
            </p>
          )}
          <p className="text-xs text-muted-foreground">{t('returnNext')}</p>
        </CardContent>
      </Card>
    );
  }

  if (recommendation.state === 'stall-signal') {
    return (
      <Card className="border-muted bg-muted/20">
        <CardHeader className="pb-3">
          <h2 className="text-base font-semibold">{t('signalTitle')}</h2>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <ReasonList recommendation={recommendation} exerciseName={exerciseName} t={t} />
          <p className="text-xs text-muted-foreground">{t('signalDescription')}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-amber-500/50 bg-amber-500/5">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <BatteryLow className="size-4 text-amber-600" />
          <h2 className="text-base font-semibold">{t('dueTitle')}</h2>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <ReasonList recommendation={recommendation} exerciseName={exerciseName} t={t} />
        <p className="text-xs text-muted-foreground">
          {t('continuedLoad', {
            workouts: recommendation.activity.recent14DayCompletedWorkouts,
            sets: recommendation.activity.recent14DayWorkingSets,
          })}
        </p>
        <p className="text-xs text-muted-foreground">{t('dueDescription')}</p>
        <div>
          <Button size="sm" onClick={startDeload} disabled={busy}>
            {t('start')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ReasonList({
  recommendation,
  exerciseName,
  t,
}: {
  recommendation: DeloadRecommendation;
  exerciseName: (name: string) => string;
  t: (key: 'stalledReason' | 'readinessReason', values: Record<string, string | number>) => string;
}) {
  return (
    <ul className="list-disc space-y-1 pl-5">
      {recommendation.reasons.map((reason) => (
        <li key={reason.kind}>
          {reason.kind === 'stalled-lifts'
            ? t('stalledReason', {
                count: reason.exerciseNames.length,
                names: reason.exerciseNames.map(exerciseName).join(', '),
              })
            : t('readinessReason', {
                average: reason.averageReadiness,
                checkins: reason.checkins,
              })}
        </li>
      ))}
    </ul>
  );
}

const EMPTY_ACTIVITY: DeloadActivitySummary = {
  lastMeaningfulWorkoutAt: null,
  daysSinceLastMeaningfulWorkout: null,
  recent7DayCompletedWorkouts: 0,
  recent7DayWorkingSets: 0,
  recent14DayCompletedWorkouts: 0,
  recent14DayWorkingSets: 0,
  baselineCompletedWorkoutsPer14Days: 0,
  baselineWorkingSetsPer14Days: 0,
  sessionFrequencyRatio: null,
  workingSetRatio: null,
  actualWeeklyFrequency28Days: 0,
  plannedWeeklyFrequency: null,
  averageReadiness: null,
  latestSleepQuality: null,
  maxReportedSoreness: null,
  loadAccounting: null,
};
