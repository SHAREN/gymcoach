'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Check, Circle, CircleDot, CloudOff, Loader2, Pencil, Trash2, Trophy } from 'lucide-react';
import type { Exercise, ProgramExercise, WeightUnit } from '@/lib/prisma-client';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import type { PendingSet } from '@/lib/indexeddb';
import { detectPRs, type PRType } from '@/lib/records';
import { formatCardioSet } from '@/lib/cardio';
import { SetValuePicker } from '@/components/session/set-value-picker';
import {
  formatWeight,
  fromDisplayWeight,
  roundWeight,
  toDisplayWeight,
  unitLabel,
} from '@/lib/units';
import { estimateRepMax } from '@/lib/stats';
import {
  loadPreferences,
  PREFERENCES_CHANGED_EVENT,
  savePreferences,
  SET_TABLE_METRICS,
  setTableMetricEnabled,
  type SetTableMetric,
} from '@/lib/preferences';

interface Props {
  programExercise: ProgramExercise & { exercise: Exercise };
  sets: PendingSet[];
  isInputActive: boolean;
  unit: WeightUnit;
  onDeleteSet: (set: PendingSet) => void;
  onEditSet?: (
    set: PendingSet,
    values: { weight: number; reps: number; rir: number | null },
  ) => Promise<void>;
  // Prior (previous-session) non-warmup sets for this exercise, used as the
  // baseline for PR detection. Optional: absent on the very first session.
  // This is the most recent session's data (from getLastPerformances), so a
  // badge means "beats your last session" rather than an all-time record - an
  // all-time baseline would need a separate query and is out of scope here.
  priorSets?: { weight: number; reps: number }[];
}

const PR_LABEL_KEYS = { weight: 'weightPr', e1rm: 'oneRmPr' } as const;
const PR_TITLE_KEYS = { weight: 'weightPrTitle', e1rm: 'oneRmPrTitle' } as const;

function formatSetMetric(
  metric: SetTableMetric,
  weight: number,
  reps: number,
  unit: WeightUnit,
  locale: string,
): string {
  const value =
    metric === 'VOLUME' ? weight * reps : estimateRepMax(weight, reps, metric === '10RM' ? 10 : 1);
  if (value <= 0) return '–';
  return formatWeight(value, unit, { decimals: 1, group: false, locale, withUnit: false });
}

export function SetsList({
  programExercise,
  sets,
  isInputActive,
  unit,
  onDeleteSet,
  onEditSet,
  priorSets,
}: Props) {
  const t = useTranslations('session.setsList');
  const locale = useLocale();
  const isStrength = programExercise.exercise.category !== 'CARDIO';
  const [metrics, setMetrics] = useState<SetTableMetric[]>(['1RM']);

  useEffect(() => {
    const syncMetrics = () => setMetrics(loadPreferences().setTableMetrics);
    syncMetrics();
    window.addEventListener(PREFERENCES_CHANGED_EVENT, syncMetrics);
    return () => window.removeEventListener(PREFERENCES_CHANGED_EVENT, syncMetrics);
  }, []);

  function metricLabel(metric: SetTableMetric, short = false) {
    if (metric === '1RM') return t(short ? 'metrics.oneRmShort' : 'metrics.oneRm');
    if (metric === '10RM') return t(short ? 'metrics.tenRmShort' : 'metrics.tenRm');
    return t(short ? 'metrics.volumeShort' : 'metrics.volume');
  }

  function updateMetric(metric: SetTableMetric, enabled: boolean) {
    const next = setTableMetricEnabled(metrics, metric, enabled);
    if (next.length === metrics.length && next.every((value, index) => value === metrics[index]))
      return;
    const prefs = loadPreferences();
    const rmDisplay = next.includes('10RM')
      ? '10RM'
      : next.includes('1RM')
        ? '1RM'
        : prefs.rmDisplay;
    savePreferences({ ...prefs, rmDisplay, setTableMetrics: next });
    setMetrics(next);
  }

  const completedNonWarmup = sets.filter((s) => !s.isWarmup);
  const totalRows = Math.max(programExercise.targetSets, completedNonWarmup.length + 1);
  const currentSetNumber = completedNonWarmup.length + 1;

  // PR detection runs on read against a baseline of the previous session plus
  // any earlier sets already logged in this session, so a second set only
  // counts as a PR if it beats the first one too.
  const baseline = (priorSets ?? []).map((s) => ({ ...s, isWarmup: false }));

  function prsFor(set: PendingSet, index: number): PRType[] {
    if (set.isWarmup) return [];
    const earlierThisSession = sets
      .slice(0, index)
      .filter((s) => !s.isWarmup)
      .map((s) => ({ weight: s.weight, reps: s.reps, isWarmup: false }));
    return detectPRs(set, [...baseline, ...earlierThisSession]);
  }

  return (
    <div className="rounded-lg border border-border">
      {isStrength && (
        <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/20 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('metrics.label')}
            </span>
            <span
              className="truncate text-xs tabular-nums text-muted-foreground"
              data-testid="set-metric-selection"
            >
              {metrics.map((metric) => metricLabel(metric, true)).join(' + ')}
            </span>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="sm" aria-label={t('metrics.open')}>
                {t('metrics.open')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              <DropdownMenuLabel>{t('metrics.label')}</DropdownMenuLabel>
              {SET_TABLE_METRICS.map((option) => (
                <DropdownMenuCheckboxItem
                  key={option}
                  checked={metrics.includes(option)}
                  disabled={metrics.length === 1 && metrics[0] === option}
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={(checked) => updateMetric(option, checked === true)}
                >
                  {metricLabel(option)}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      {sets.map((s, i) => (
        <RowDone
          key={s.localId}
          set={s}
          prs={prsFor(s, i)}
          unit={unit}
          metrics={isStrength ? metrics : []}
          locale={locale}
          onEdit={onEditSet ? (values) => onEditSet(s, values) : undefined}
          onDelete={() => onDeleteSet(s)}
        />
      ))}

      {Array.from({ length: totalRows - sets.length }, (_, i) => {
        const setNum = completedNonWarmup.length + 1 + i;
        const isCurrent = i === 0 && isInputActive;
        return <RowUpcoming key={`upcoming-${setNum}`} setNumber={setNum} isCurrent={isCurrent} />;
      })}

      {!isInputActive && completedNonWarmup.length === 0 && sets.length === 0 && (
        <div className="px-3 py-2 text-xs text-muted-foreground">
          {t('noneDuringRest', { number: currentSetNumber })}
        </div>
      )}
    </div>
  );
}

function RowDone({
  set,
  prs,
  unit,
  metrics,
  locale,
  onEdit,
  onDelete,
}: {
  set: PendingSet;
  prs: PRType[];
  unit: WeightUnit;
  metrics: SetTableMetric[];
  locale: string;
  onEdit?: (values: { weight: number; reps: number; rir: number | null }) => Promise<void>;
  onDelete: () => void;
}) {
  const t = useTranslations('session.setsList');
  const isCardio = set.durationSec != null;
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState<'weight' | 'reps' | null>(null);
  const [draft, setDraft] = useState({ weight: set.weight, reps: set.reps, rir: set.rir });
  const displayWeight = roundWeight(toDisplayWeight(draft.weight, unit), 2);
  const savedWeightLabel =
    set.weight === 0
      ? t('bodyweight')
      : `${roundWeight(toDisplayWeight(set.weight, unit), 2)} ${unitLabel(unit)}`;

  function beginEdit() {
    setDraft({ weight: set.weight, reps: set.reps, rir: set.rir });
    setEditing(true);
  }

  async function saveEdit() {
    if (!onEdit || saving) return;
    setSaving(true);
    try {
      await onEdit(draft);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border-b border-border last:border-b-0">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <SyncIcon status={set.status} />
          <span className="text-sm font-medium">
            {t('set', { number: set.setNumber })}
            {set.isWarmup ? t('warmup') : ''}
            {set.isDropSet ? t('drop') : ''}
          </span>
          <span className="truncate text-sm text-muted-foreground">
            {isCardio ? (
              formatCardioSet(set.durationSec!, set.distanceM)
            ) : (
              <>
                {savedWeightLabel} × {set.reps}
                {set.rir != null && ` · RIR ${set.rir}`}
              </>
            )}
          </span>
          {prs.map((pr) => (
            <Badge key={pr} className="gap-1 text-xs" title={t(PR_TITLE_KEYS[pr])}>
              <Trophy className="size-3" />
              {t(PR_LABEL_KEYS[pr])}
            </Badge>
          ))}
          {set.notes && (
            <Badge variant="secondary" className="text-xs">
              {t('note')}
            </Badge>
          )}
          {!isCardio && metrics.length > 0 && (
            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.7rem] tabular-nums text-muted-foreground">
              {metrics.map((metric) => (
                <span
                  key={metric}
                  data-testid={'completed-set-' + set.setNumber + '-metric-' + metric}
                >
                  {metric === '1RM'
                    ? t('metrics.oneRmShort')
                    : metric === '10RM'
                      ? t('metrics.tenRmShort')
                      : t('metrics.volumeShort')}{' '}
                  {formatSetMetric(metric, draft.weight, draft.reps, unit, locale)}
                </span>
              ))}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!isCardio && onEdit && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={beginEdit}
              aria-label={t('edit')}
              className="size-8 text-muted-foreground"
            >
              <Pencil className="size-3.5" />
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onDelete}
            aria-label={t('delete')}
            className="size-8 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>

      {editing && !isCardio && (
        <div className="grid gap-2 border-t border-border bg-muted/20 px-3 py-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
          <div className="space-y-1">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              {t('editWeight', { unit: unitLabel(unit) })}
            </span>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPicker('weight')}
              className="h-10 w-full justify-center tabular-nums"
            >
              {displayWeight}
            </Button>
          </div>
          <div className="space-y-1">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              {t('editReps')}
            </span>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPicker('reps')}
              className="h-10 w-full justify-center tabular-nums"
            >
              {draft.reps}
            </Button>
          </div>
          <label className="space-y-1">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              {t('editRir')}
            </span>
            <select
              value={draft.rir ?? ''}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  rir: event.target.value === '' ? null : Number(event.target.value),
                }))
              }
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">—</option>
              {[0, 1, 2, 3, 4, 5].map((rir) => (
                <option key={rir} value={rir}>
                  {rir}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditing(false)}
              disabled={saving}
            >
              {t('cancelEdit')}
            </Button>
            <Button type="button" onClick={saveEdit} disabled={saving || draft.reps < 1}>
              {saving ? t('savingEdit') : t('saveEdit')}
            </Button>
          </div>
          <SetValuePicker
            open={picker != null}
            kind={picker ?? 'weight'}
            value={picker === 'reps' ? draft.reps : displayWeight}
            options={
              picker === 'reps'
                ? [
                    ...new Set([
                      ...Array.from({ length: 30 }, (_, index) => index + 1),
                      draft.reps,
                    ]),
                  ].sort((a, b) => a - b)
                : [displayWeight]
            }
            unit={unit}
            onClose={() => setPicker(null)}
            onChoose={(value) => {
              setDraft((current) => ({
                ...current,
                ...(picker === 'reps'
                  ? { reps: Math.max(1, Math.round(value)) }
                  : { weight: fromDisplayWeight(value, unit) }),
              }));
              setPicker(null);
            }}
          />
        </div>
      )}
    </div>
  );
}

function SyncIcon({ status }: { status: PendingSet['status'] }) {
  if (status === 'synced') return <Check className="size-4 flex-shrink-0 text-primary" />;
  if (status === 'syncing')
    return <Loader2 className="size-4 flex-shrink-0 animate-spin text-muted-foreground" />;
  if (status === 'failed') return <CloudOff className="size-4 flex-shrink-0 text-amber-500" />;
  // 'pending'
  return <CloudOff className="size-4 flex-shrink-0 text-muted-foreground" />;
}

function RowUpcoming({ setNumber, isCurrent }: { setNumber: number; isCurrent: boolean }) {
  const t = useTranslations('session.setsList');

  return (
    <div
      className={`flex items-center gap-2 border-b border-border px-3 py-2 last:border-b-0 ${
        isCurrent ? 'bg-primary/5' : ''
      }`}
    >
      {isCurrent ? (
        <CircleDot className="size-4 flex-shrink-0 text-primary" />
      ) : (
        <Circle className="size-4 flex-shrink-0 text-muted-foreground" />
      )}
      <span className={`text-sm ${isCurrent ? 'font-medium' : 'text-muted-foreground'}`}>
        {isCurrent ? t('current', { number: setNumber }) : t('upcoming', { number: setNumber })}
      </span>
    </div>
  );
}
