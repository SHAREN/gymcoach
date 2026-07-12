'use client';

import { useEffect, useMemo, useState } from 'react';
import { Dumbbell, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { Exercise, WeightUnit } from '@/lib/prisma-client';
import type { SessionGym } from '@/components/session/session-runner';
import { useExerciseName } from '@/components/shared/use-exercise-name';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { resolveEquipmentType } from '@/lib/gym-loads';
import { fromDisplayWeight, roundWeight, toDisplayWeight } from '@/lib/units';

interface Props {
  open: boolean;
  gym: SessionGym;
  exercise: Exercise;
  unit: WeightUnit;
  onOpenChange: (open: boolean) => void;
  onSaved: (gym: SessionGym) => void;
}

type Scope = 'equipment' | 'exercise';

export interface RangeDraft {
  id: number;
  min: string;
  max: string;
  step: string;
}

export function WeightInventoryEditor({ open, gym, exercise, unit, onOpenChange, onSaved }: Props) {
  const t = useTranslations('session.editableSets.weightEditor');
  const locale = useLocale();
  const exerciseName = useExerciseName();
  const equipmentType = resolveEquipmentType(exercise.equipmentType, exercise.name);
  const supportsSharedInventory = equipmentType === 'BARBELL' || equipmentType === 'DUMBBELL';
  const [scope, setScope] = useState<Scope | null>(null);
  const [barValues, setBarValues] = useState<string[]>([]);
  const [plateValues, setPlateValues] = useState<string[]>([]);
  const [ranges, setRanges] = useState<RangeDraft[]>([]);
  const [singleValues, setSingleValues] = useState<string[]>([]);
  const [barOverrideEnabled, setBarOverrideEnabled] = useState(false);
  const [plateOverrideEnabled, setPlateOverrideEnabled] = useState(false);
  const [dumbbellOverrideEnabled, setDumbbellOverrideEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const config = useMemo(
    () => gym.exerciseConfigs.find((item) => item.exerciseId === exercise.id),
    [exercise.id, gym.exerciseConfigs],
  );

  useEffect(() => {
    if (!open) return;
    setScope(supportsSharedInventory ? null : 'exercise');
  }, [open, supportsSharedInventory]);

  useEffect(() => {
    if (!open || scope == null) return;
    const display = (values: number[]) =>
      values.map((value) => formatNumber(toDisplayWeight(value, unit), locale));

    if (equipmentType === 'BARBELL') {
      const bars =
        scope === 'exercise' && config?.barWeights.length ? config.barWeights : gym.barWeights;
      const plates =
        scope === 'exercise' && config?.plateWeights.length
          ? config.plateWeights
          : gym.plateWeights;
      setBarValues(display(bars));
      setPlateValues(display(plates));
      setBarOverrideEnabled(scope === 'equipment' || Boolean(config?.barWeights.length));
      setPlateOverrideEnabled(scope === 'equipment' || Boolean(config?.plateWeights.length));
      return;
    }

    const weights =
      equipmentType === 'DUMBBELL'
        ? scope === 'exercise' && config?.dumbbellWeights.length
          ? config.dumbbellWeights
          : gym.dumbbellWeights
        : (config?.weightOptions ?? []);
    const split = splitRanges(
      weights.map((value) => toDisplayWeight(value, unit)),
      locale,
    );
    setRanges(split.ranges);
    setSingleValues(split.singles);
    setDumbbellOverrideEnabled(
      equipmentType === 'DUMBBELL' &&
        (scope === 'equipment' || Boolean(config?.dumbbellWeights.length)),
    );
  }, [config, equipmentType, gym, locale, open, scope, unit]);

  function selectScope(nextScope: Scope) {
    setScope(nextScope);
  }

  async function save() {
    if (!scope || saving) return;
    setSaving(true);
    try {
      const toKg = (values: string[]) =>
        uniqueSorted(
          values
            .map(parseNumber)
            .filter((value): value is number => value != null && value > 0)
            .map((value) => roundWeight(fromDisplayWeight(value, unit), 2)),
        );
      const weightOptions = toKg(expandRanges(ranges).concat(singleValues));
      if (weightOptions.length > 200) throw new RangeError('too-many-weights');
      const response = await fetch(`/api/gyms/${gym.id}/weights`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exerciseId: exercise.id,
          scope,
          barWeights:
            equipmentType === 'BARBELL' && (scope === 'equipment' || barOverrideEnabled)
              ? toKg(barValues)
              : [],
          plateWeights:
            equipmentType === 'BARBELL' && (scope === 'equipment' || plateOverrideEnabled)
              ? toKg(plateValues)
              : [],
          dumbbellWeights:
            equipmentType === 'DUMBBELL' && (scope === 'equipment' || dumbbellOverrideEnabled)
              ? weightOptions
              : [],
          weightOptions:
            equipmentType === 'BARBELL' || equipmentType === 'DUMBBELL' ? [] : weightOptions,
        }),
      });
      if (!response.ok) throw new Error();
      const updated = (await response.json()) as SessionGym;
      onSaved(updated);
      onOpenChange(false);
      toast.success(t('saved'));
    } catch (error) {
      toast.error(error instanceof RangeError ? t('tooManyWeights') : t('saveError'));
    } finally {
      setSaving(false);
    }
  }

  function clearExerciseOverride() {
    if (scope !== 'exercise') return;
    const display = (values: number[]) =>
      values.map((value) => formatNumber(toDisplayWeight(value, unit), locale));
    setBarOverrideEnabled(false);
    setPlateOverrideEnabled(false);
    setDumbbellOverrideEnabled(false);
    if (equipmentType === 'BARBELL') {
      setBarValues(display(gym.barWeights));
      setPlateValues(display(gym.plateWeights));
      return;
    }
    if (equipmentType === 'DUMBBELL') {
      const split = splitRanges(
        gym.dumbbellWeights.map((value) => toDisplayWeight(value, unit)),
        locale,
      );
      setRanges(split.ranges);
      setSingleValues(split.singles);
      return;
    }
    setRanges([]);
    setSingleValues([]);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={
          scope == null
            ? 'bottom-0 left-0 top-auto w-full max-w-none translate-x-0 translate-y-0 gap-0 rounded-t-lg border-x-0 border-b-0 p-0 sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:border [&>button]:hidden'
            : 'left-0 top-0 flex h-[100dvh] max-h-none w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:left-1/2 sm:top-1/2 sm:h-[90dvh] sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-md sm:border [&>button]:hidden'
        }
      >
        {scope == null ? (
          <ScopeChooser
            equipmentType={equipmentType}
            onCancel={() => onOpenChange(false)}
            onSelect={selectScope}
          />
        ) : (
          <>
            <header className="grid shrink-0 grid-cols-[5rem_1fr_5rem] items-center border-b px-3 pb-2 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
              <Button
                type="button"
                variant="ghost"
                onClick={() => (supportsSharedInventory ? setScope(null) : onOpenChange(false))}
                className="justify-start px-1 text-primary"
              >
                {t('cancel')}
              </Button>
              <div className="min-w-0 text-center">
                <DialogTitle className="truncate text-base">{gym.name}</DialogTitle>
                <DialogDescription className="truncate text-xs">
                  {scope === 'equipment' ? t('allScope') : t('exerciseScope')}
                </DialogDescription>
              </div>
              <span />
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
              <div className="mb-5">
                <h2 className="truncate text-xl font-semibold">{exerciseName(exercise.name)}</h2>
                <p className="text-sm text-muted-foreground">{t(`equipment.${equipmentType}`)}</p>
              </div>

              {equipmentType === 'BARBELL' ? (
                <BarbellInventoryEditor
                  bars={barValues}
                  plates={plateValues}
                  unit={unit}
                  onBarsChange={(values) => {
                    setBarOverrideEnabled(true);
                    setBarValues(values);
                  }}
                  onPlatesChange={(values) => {
                    setPlateOverrideEnabled(true);
                    setPlateValues(values);
                  }}
                />
              ) : (
                <RangeInventoryEditor
                  ranges={ranges}
                  singles={singleValues}
                  unit={unit}
                  onRangesChange={(values) => {
                    if (equipmentType === 'DUMBBELL') setDumbbellOverrideEnabled(true);
                    setRanges(values);
                  }}
                  onSinglesChange={(values) => {
                    if (equipmentType === 'DUMBBELL') setDumbbellOverrideEnabled(true);
                    setSingleValues(values);
                  }}
                />
              )}

              {scope === 'exercise' && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={clearExerciseOverride}
                  className="mt-4 px-0 text-primary"
                >
                  {t('useGymDefaults')}
                </Button>
              )}
            </div>

            <footer className="shrink-0 border-t bg-background px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3">
              <Button
                type="button"
                onClick={save}
                disabled={saving}
                className="h-14 w-full text-base"
              >
                <Save className="size-5" />
                {saving ? t('saving') : t('save')}
              </Button>
            </footer>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ScopeChooser({
  equipmentType,
  onCancel,
  onSelect,
}: {
  equipmentType: ReturnType<typeof resolveEquipmentType>;
  onCancel: () => void;
  onSelect: (scope: Scope) => void;
}) {
  const t = useTranslations('session.editableSets.weightEditor');
  return (
    <div className="px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-4">
      <div className="mb-4 flex items-center justify-between">
        <Button type="button" variant="ghost" onClick={onCancel} className="px-1 text-primary">
          {t('cancel')}
        </Button>
        <DialogTitle className="text-base">{t('title')}</DialogTitle>
        <span className="w-16" />
        <DialogDescription className="sr-only">{t('scopeDescription')}</DialogDescription>
      </div>
      <div className="overflow-hidden rounded-md border bg-muted/20">
        <button
          type="button"
          onClick={() => onSelect('equipment')}
          className="flex min-h-16 w-full items-center gap-3 border-b px-4 text-left font-medium hover:bg-muted"
        >
          <Dumbbell className="size-5 text-muted-foreground" />
          {equipmentType === 'BARBELL' ? t('allBarbell') : t('allDumbbell')}
        </button>
        <button
          type="button"
          onClick={() => onSelect('exercise')}
          className="flex min-h-16 w-full items-center gap-3 px-4 text-left font-medium hover:bg-muted"
        >
          <Pencil className="size-5 text-muted-foreground" />
          {t('thisExercise')}
        </button>
      </div>
    </div>
  );
}

function BarbellInventoryEditor({
  bars,
  plates,
  unit,
  onBarsChange,
  onPlatesChange,
}: {
  bars: string[];
  plates: string[];
  unit: WeightUnit;
  onBarsChange: (values: string[]) => void;
  onPlatesChange: (values: string[]) => void;
}) {
  const t = useTranslations('session.editableSets.weightEditor');
  const locale = useLocale();
  return (
    <div className="space-y-5">
      <EditableWeightList
        label={t('bars')}
        values={bars}
        unit={unit}
        addLabel={t('addBar')}
        defaultValue={formatNumber(20, locale)}
        onChange={onBarsChange}
      />
      <EditableWeightList
        label={t('plates')}
        values={plates}
        unit={unit}
        addLabel={t('addPlate')}
        defaultValue={formatNumber(2.5, locale)}
        onChange={onPlatesChange}
      />
    </div>
  );
}

function EditableWeightList({
  label,
  values,
  unit,
  addLabel,
  defaultValue,
  onChange,
}: {
  label: string;
  values: string[];
  unit: WeightUnit;
  addLabel: string;
  defaultValue: string;
  onChange: (values: string[]) => void;
}) {
  const t = useTranslations('session.editableSets.weightEditor');
  return (
    <section>
      <h3 className="mb-2 text-base font-semibold">{label}</h3>
      <div className="overflow-hidden rounded-md border bg-muted/20">
        {values.map((value, index) => (
          <div
            key={`${index}-${values.length}`}
            className="flex items-center gap-2 border-b p-2 last:border-b-0"
          >
            <Input
              value={value}
              inputMode="decimal"
              onChange={(event) => onChange(replaceAt(values, index, event.target.value))}
              className="h-11 text-center text-base font-semibold tabular-nums"
              aria-label={`${label} ${index + 1}`}
            />
            <span className="w-8 text-xs uppercase text-muted-foreground">{unit}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onChange(values.filter((_, itemIndex) => itemIndex !== index))}
              aria-label={`${t('remove')} ${label} ${index + 1}`}
              className="text-destructive"
            >
              <Trash2 className="size-5" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="ghost"
          onClick={() => onChange([...values, defaultValue])}
          className="h-12 w-full text-primary"
        >
          <Plus className="size-4" />
          {addLabel}
        </Button>
      </div>
    </section>
  );
}

function RangeInventoryEditor({
  ranges,
  singles,
  unit,
  onRangesChange,
  onSinglesChange,
}: {
  ranges: RangeDraft[];
  singles: string[];
  unit: WeightUnit;
  onRangesChange: (ranges: RangeDraft[]) => void;
  onSinglesChange: (values: string[]) => void;
}) {
  const t = useTranslations('session.editableSets.weightEditor');
  const locale = useLocale();
  return (
    <div className="space-y-5">
      <section>
        <h3 className="mb-2 text-base font-semibold">{t('ranges')}</h3>
        <div className="grid grid-cols-[1fr_1fr_1fr_2.75rem] gap-2 px-1 pb-2 text-center text-xs text-muted-foreground">
          <span>{t('min')}</span>
          <span>{t('max')}</span>
          <span>{t('step')}</span>
          <span />
        </div>
        <div className="space-y-2">
          {ranges.map((range) => (
            <div key={range.id} className="grid grid-cols-[1fr_1fr_1fr_2.75rem] gap-2">
              {(['min', 'max', 'step'] as const).map((field) => (
                <div key={field} className="relative">
                  <Input
                    value={range[field]}
                    inputMode="decimal"
                    onChange={(event) =>
                      onRangesChange(
                        ranges.map((item) =>
                          item.id === range.id ? { ...item, [field]: event.target.value } : item,
                        ),
                      )
                    }
                    className="h-11 px-2 pr-7 text-center font-semibold tabular-nums"
                    aria-label={t(field)}
                  />
                  <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[0.625rem] uppercase text-muted-foreground">
                    {unit}
                  </span>
                </div>
              ))}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onRangesChange(ranges.filter((item) => item.id !== range.id))}
                aria-label={t('removeRange')}
                className="text-destructive"
              >
                <Trash2 className="size-5" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              onRangesChange([...ranges, { id: nextRangeId(ranges), min: '', max: '', step: '1' }])
            }
            className="h-12 w-full text-primary"
          >
            <Plus className="size-4" />
            {t('addRange')}
          </Button>
        </div>
      </section>

      <EditableWeightList
        label={t('individualWeights')}
        values={singles}
        unit={unit}
        addLabel={t('addIndividual')}
        defaultValue={formatNumber(15.5, locale)}
        onChange={onSinglesChange}
      />
    </div>
  );
}

function splitRanges(
  values: number[],
  locale: string,
): { ranges: RangeDraft[]; singles: string[] } {
  const sorted = uniqueSorted(values);
  const ranges: RangeDraft[] = [];
  const singles: string[] = [];
  let index = 0;
  let id = 1;

  while (index < sorted.length) {
    if (index === sorted.length - 1) {
      singles.push(formatNumber(sorted[index]!, locale));
      break;
    }
    const step = roundWeight(sorted[index + 1]! - sorted[index]!, 2);
    let end = index + 1;
    while (
      end + 1 < sorted.length &&
      Math.abs(roundWeight(sorted[end + 1]! - sorted[end]!, 2) - step) < 0.001
    ) {
      end += 1;
    }
    if (end - index >= 1 && step > 0) {
      ranges.push({
        id,
        min: formatNumber(sorted[index]!, locale),
        max: formatNumber(sorted[end]!, locale),
        step: formatNumber(step, locale),
      });
      id += 1;
      index = end + 1;
    } else {
      singles.push(formatNumber(sorted[index]!, locale));
      index += 1;
    }
  }
  return { ranges, singles };
}

export function expandRanges(ranges: RangeDraft[]): string[] {
  const values: number[] = [];
  for (const range of ranges) {
    const min = parseNumber(range.min);
    const max = parseNumber(range.max);
    const step = parseNumber(range.step);
    if (min == null || max == null || step == null || min <= 0 || max < min || step <= 0) continue;
    const count = Math.floor((max - min) / step + 0.0001) + 1;
    if (values.length + count > 200) throw new RangeError('too-many-weights');
    for (let index = 0; index < count; index += 1) {
      values.push(roundWeight(min + step * index, 2));
    }
    if (Math.abs((values.at(-1) ?? min) - max) > 0.001) {
      if (values.length >= 200) throw new RangeError('too-many-weights');
      values.push(max);
    }
  }
  return values.map(String);
}

function parseNumber(value: string): number | null {
  const parsed = Number(value.trim().replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: 2,
    useGrouping: false,
  }).format(roundWeight(value, 2));
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values.filter(Number.isFinite).map((value) => roundWeight(value, 2)))].sort(
    (left, right) => left - right,
  );
}

function replaceAt(values: string[], index: number, value: string): string[] {
  return values.map((item, itemIndex) => (itemIndex === index ? value : item));
}

function nextRangeId(ranges: RangeDraft[]): number {
  return Math.max(0, ...ranges.map((range) => range.id)) + 1;
}
