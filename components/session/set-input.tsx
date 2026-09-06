'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Check, Minus, Plus } from 'lucide-react';
import type { Exercise, ProgramExercise, WeightUnit } from '@/lib/prisma-client';
import {
  displayIncrement,
  formatWeight,
  fromDisplayWeight,
  roundWeight,
  toDisplayWeight,
  unitLabel,
} from '@/lib/units';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { suggestNextWeight, weightIncrement, type ReadinessSignal } from '@/lib/progression';
import { formatDuration, MAX_DISTANCE_M, parseDurationToSec } from '@/lib/cardio';
import { parseSetShorthand, rpeToRir } from '@/lib/set-shorthand';
import type { SetParseResult } from '@/lib/schemas/set-parse';
import { PlateCalculator } from '@/components/session/plate-calculator';
import { WarmupCalculator } from '@/components/session/warmup-calculator';
import type { PendingSet } from '@/lib/indexeddb';
import { SetValuePicker } from '@/components/session/set-value-picker';
import type { SerializedLastPerformance } from './session-runner';
import type {
  IntraSetRecommendation,
  IntraSetRecommendationReason,
} from '@/lib/intra-set-autoregulation';
import type { ReturnRecommendation } from '@/lib/return-to-training';
import { estimateRepMax } from '@/lib/stats';
import { loadPreferences, PREFERENCES_CHANGED_EVENT, type SetTableMetric } from '@/lib/preferences';
import {
  constrainGymWeight,
  constrainGymWeightAtOrBelow,
  gymWeightOptions,
  type GymLoadConstraints,
} from '@/lib/gym-loads';

interface Props {
  programExercise: ProgramExercise & { exercise: Exercise };
  existingSets: PendingSet[];
  lastPerformance: SerializedLastPerformance | undefined;
  readiness: ReadinessSignal | null;
  // True while a planned deload week is active (issue #112).
  deloadActive: boolean;
  unit: WeightUnit;
  recommendation?: IntraSetRecommendation | null;
  returnRecommendation?: ReturnRecommendation | null;
  loadConstraints?: GymLoadConstraints | null;
  equipmentOptions?: { id: string; name: string }[];
  selectedEquipmentId?: string | null;
  onEquipmentChange?: (equipmentId: string | null) => void;
  embedded?: boolean;
  onSubmit: (values: {
    weight: number;
    reps: number;
    rir: number | null;
    durationSec: number | null;
    distanceM: number | null;
    isWarmup: boolean;
    isDropSet: boolean;
    notes: string | null;
    gymEquipmentId?: string | null;
  }) => Promise<void>;
}

interface FormState {
  weight: number;
  reps: number;
  rir: number | null;
  // Cardio inputs (issue #133), kept as raw strings while typing: duration as
  // "mm:ss" (or plain minutes) and distance in km. Empty on strength exercises.
  durationInput: string;
  distanceInput: string;
  isWarmup: boolean;
  isDropSet: boolean;
  notes: string;
}

const RIR_OPTIONS = [0, 1, 2, 3];
const AUTOREGULATION_REASON_KEYS: Record<
  IntraSetRecommendationReason,
  | 'reasons.hold-load'
  | 'reasons.adjust-reps'
  | 'reasons.reduce-load'
  | 'reasons.increase-load'
  | 'reasons.bodyweight-adjust-reps'
> = {
  'hold-load': 'reasons.hold-load',
  'adjust-reps': 'reasons.adjust-reps',
  'reduce-load': 'reasons.reduce-load',
  'increase-load': 'reasons.increase-load',
  'bodyweight-adjust-reps': 'reasons.bodyweight-adjust-reps',
};

// The validated parse the API returns (issue #210). Re-using the schema's type
// keeps the client's narrowing in lockstep with the server contract.
type ParsedSetFill = SetParseResult;

export function SetInput({
  programExercise,
  existingSets,
  lastPerformance,
  readiness,
  deloadActive,
  unit,
  recommendation = null,
  returnRecommendation = null,
  loadConstraints = null,
  equipmentOptions = [],
  selectedEquipmentId,
  onEquipmentChange,
  embedded = false,
  onSubmit,
}: Props) {
  const t = useTranslations('session.input');
  const autoT = useTranslations('session.autoregulation');
  const metricT = useTranslations('session.setsList.metrics');
  const common = useTranslations('common');
  const locale = useLocale();
  // Pre-fill: last set of this exercise in the current session,
  // otherwise the last performance, otherwise defaults.
  const initial = computeInitial(
    programExercise,
    existingSets,
    lastPerformance,
    readiness,
    deloadActive,
    returnRecommendation,
    loadConstraints,
  );
  const [form, setForm] = useState<FormState>(initial);
  const [submitting, setSubmitting] = useState(false);
  const [quickEntry, setQuickEntry] = useState('');
  // Opt-in AI free-text parse (issue #210): a DELIBERATE action that fills the
  // form for the user to confirm. The deterministic shorthand above stays the
  // primary fast path; this never auto-logs and never blocks normal logging.
  const [aiText, setAiText] = useState('');
  const [aiParsing, setAiParsing] = useState(false);
  const [aiHint, setAiHint] = useState<string | null>(null);
  const [gymEquipmentId, setGymEquipmentId] = useState('');
  const [picker, setPicker] = useState<'weight' | 'reps' | null>(null);
  const [metrics, setMetrics] = useState<SetTableMetric[]>(['1RM']);

  useEffect(() => {
    const syncMetrics = () => setMetrics(loadPreferences().setTableMetrics);
    syncMetrics();
    window.addEventListener(PREFERENCES_CHANGED_EVENT, syncMetrics);
    return () => window.removeEventListener(PREFERENCES_CHANGED_EVENT, syncMetrics);
  }, []);

  // Re-init when the exercise changes or a set changes.
  useEffect(() => {
    setForm(
      computeInitial(
        programExercise,
        existingSets,
        lastPerformance,
        readiness,
        deloadActive,
        returnRecommendation,
        loadConstraints,
      ),
    );
    setQuickEntry('');
    setAiText('');
    setAiHint(null);
    const recentEquipmentId = existingSets.at(-1)?.gymEquipmentId ?? '';
    const requestedEquipmentId =
      selectedEquipmentId !== undefined ? (selectedEquipmentId ?? '') : recentEquipmentId;
    setGymEquipmentId(
      equipmentOptions.some((equipment) => equipment.id === requestedEquipmentId)
        ? requestedEquipmentId
        : '',
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programExercise.id, existingSets.length]);

  useEffect(() => {
    if (selectedEquipmentId === undefined) return;
    const next =
      selectedEquipmentId &&
      equipmentOptions.some((equipment) => equipment.id === selectedEquipmentId)
        ? selectedEquipmentId
        : '';
    setGymEquipmentId(next);
  }, [equipmentOptions, selectedEquipmentId]);

  // A selected machine the gym no longer offers (issue #326: the server dropped
  // it from a saved set and the runner withdrew it) must not be resent.
  useEffect(() => {
    if (gymEquipmentId && !equipmentOptions.some((equipment) => equipment.id === gymEquipmentId)) {
      setGymEquipmentId('');
      onEquipmentChange?.(null);
    }
  }, [equipmentOptions, gymEquipmentId, onEquipmentChange]);

  const incrementKg = weightIncrement(programExercise.exercise.category);
  // Increment shown in the user's unit (clean plate jumps), applied to the
  // kg-stored weight. The form value stays in kg; only display/input convert.
  const stepDisplay = displayIncrement(incrementKg, unit);
  const stepKg = fromDisplayWeight(stepDisplay, unit);
  // Show the kg-stored weight in the user's unit. KG renders the raw value
  // (unchanged behavior); LB shows a rounded conversion.
  const displayWeight =
    unit === 'LB' ? roundWeight(toDisplayWeight(form.weight, unit), 1) : form.weight;
  const weightPickerOptions = [
    ...new Set([
      ...gymWeightOptions(loadConstraints, form.weight).map((weight) =>
        roundWeight(toDisplayWeight(weight, unit), 2),
      ),
      ...(displayWeight > 0 ? [displayWeight] : []),
    ]),
  ].sort((a, b) => a - b);
  const repPickerOptions = [
    ...new Set([
      ...Array.from({ length: 30 }, (_, index) => index + 1),
      ...(form.reps > 0 ? [form.reps] : []),
    ]),
  ].sort((a, b) => a - b);

  const recommendationMatchesDraft =
    recommendation != null &&
    form.weight === recommendation.weight &&
    form.reps === recommendation.reps &&
    form.rir === recommendation.rir;

  function applyRecommendation() {
    if (!recommendation) return;
    setForm((current) => ({
      ...current,
      weight: recommendation.weight,
      reps: recommendation.reps,
      rir: recommendation.rir,
    }));
  }

  function adjustWeight(delta: number) {
    setForm((f) => ({
      ...f,
      weight: Math.max(
        0,
        constrainGymWeight(+(f.weight + delta).toFixed(2), f.weight, loadConstraints),
      ),
    }));
  }
  function adjustReps(delta: number) {
    setForm((f) => ({ ...f, reps: Math.max(0, f.reps + delta) }));
  }

  // Quick entry: parse shorthand like "100x8@9" and fill the classic fields.
  // The user still confirms with the log button; the classic fields keep
  // working unchanged.
  function handleQuickEntry(value: string) {
    setQuickEntry(value);
    const parsed = parseSetShorthand(value);
    if (!parsed) return;
    setForm((f) => ({
      ...f,
      // The shorthand weight is typed in the user's display unit, exactly
      // like the classic weight field.
      weight: fromDisplayWeight(parsed.weight, unit),
      reps: parsed.reps,
      rir: parsed.rpe !== undefined ? rpeToRir(parsed.rpe) : f.rir,
    }));
  }

  const quickEntryInvalid = quickEntry.trim() !== '' && parseSetShorthand(quickEntry) === null;

  // Opt-in AI parse: POST the free text, then FILL the form from the validated
  // result for the user to confirm. Never logs. On any failure (null parse,
  // wrong shape, network error) it fills nothing and shows a small hint - the
  // model output is untrusted, so the UI degrades gracefully and never crashes.
  async function handleAiParse() {
    const text = aiText.trim();
    if (!text || aiParsing) return;
    setAiParsing(true);
    setAiHint(null);
    try {
      const res = await fetch('/api/sets/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exerciseId: programExercise.exercise.id, text }),
      });
      if (!res.ok) {
        setAiHint(t('parseError'));
        return;
      }
      const data = (await res.json()) as { parsed: ParsedSetFill | null };
      const parsed = data.parsed;
      if (!parsed) {
        setAiHint(t('parseError'));
        return;
      }
      if (parsed.kind === 'cardio') {
        if (!isCardio) {
          setAiHint(t('parseError'));
          return;
        }
        setForm((f) => ({
          ...f,
          durationInput: formatDuration(parsed.durationSec),
          distanceInput:
            parsed.distanceM != null && parsed.distanceM > 0
              ? String(+(parsed.distanceM / 1000).toFixed(2))
              : '',
        }));
      } else {
        if (isCardio) {
          setAiHint(t('parseError'));
          return;
        }
        setForm((f) => ({
          ...f,
          // The model returns the weight in the user's display unit, like the
          // shorthand parser; convert to the kg the form stores.
          weight: fromDisplayWeight(parsed.weight, unit),
          reps: parsed.reps,
          // Clamp the parsed RIR to the selectable button range so a model
          // value of 4-5 maps to the closest option instead of leaving no
          // button highlighted (the set API still accepts 0-5).
          rir:
            parsed.rir != null ? Math.min(parsed.rir, RIR_OPTIONS[RIR_OPTIONS.length - 1]!) : f.rir,
        }));
      }
    } catch {
      setAiHint(t('parseError'));
    } finally {
      setAiParsing(false);
    }
  }

  // Cardio mode (issue #133): the logger swaps weight/reps for duration and
  // optional distance. The set is stored with weight = 0 / reps = 1 (the API
  // normalizes them too) and the UI never shows those fields for CARDIO.
  const isCardio = programExercise.exercise.category === 'CARDIO';
  const durationSec = parseDurationToSec(form.durationInput);
  const durationInvalid = form.durationInput.trim() !== '' && durationSec === null;
  const distanceKm = parseFloat(form.distanceInput);
  const hasDistance = form.distanceInput.trim() !== '';
  const distanceInvalid =
    hasDistance &&
    (!Number.isFinite(distanceKm) || distanceKm < 0 || distanceKm * 1000 > MAX_DISTANCE_M);
  const cardioInvalid = isCardio && (durationSec === null || distanceInvalid);

  async function handleValidate() {
    if (cardioInvalid) return;
    setSubmitting(true);
    try {
      const values = isCardio
        ? {
            weight: 0,
            reps: 1,
            rir: null,
            durationSec: durationSec!,
            distanceM: hasDistance && distanceKm > 0 ? Math.round(distanceKm * 1000) : null,
            isWarmup: false,
            isDropSet: false,
            notes: form.notes.trim() || null,
          }
        : {
            weight: form.weight,
            reps: form.reps,
            rir: form.rir,
            durationSec: null,
            distanceM: null,
            isWarmup: form.isWarmup,
            isDropSet: form.isDropSet,
            notes: form.notes.trim() || null,
          };
      await onSubmit(
        equipmentOptions.length > 0
          ? { ...values, gymEquipmentId: gymEquipmentId || null }
          : values,
      );
      // The transition animation to the rest timer is handled by the parent.
    } finally {
      setSubmitting(false);
    }
  }

  if (embedded && !isCardio) {
    return (
      <div className="space-y-3 px-2 py-2">
        {equipmentOptions.length > 0 && (
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2">
            <Label htmlFor="gym-equipment" className="text-xs text-muted-foreground">
              {t('equipment')}
            </Label>
            <select
              id="gym-equipment"
              value={gymEquipmentId}
              onChange={(event) => {
                const next = event.target.value;
                setGymEquipmentId(next);
                onEquipmentChange?.(next || null);
              }}
              className="h-9 min-w-0 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">{t('equipmentNone')}</option>
              {equipmentOptions.map((equipment) => (
                <option key={equipment.id} value={equipment.id}>
                  {equipment.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div
          data-testid="active-set-controls"
          className="grid grid-cols-[minmax(0,1fr)_minmax(0,0.75fr)_minmax(0,0.7fr)_2.75rem] items-end gap-1.5"
        >
          <div className="min-w-0 space-y-1">
            <Label className="block truncate text-center text-[0.65rem] uppercase tracking-wide text-muted-foreground">
              {t('load', { unit: unitLabel(unit) })}
            </Label>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPicker('weight')}
              aria-label={t('load', { unit: unitLabel(unit) })}
              aria-haspopup="dialog"
              className="h-11 w-full min-w-0 px-1 text-base font-semibold tabular-nums"
            >
              {displayWeight}
            </Button>
          </div>
          <div className="min-w-0 space-y-1">
            <Label className="block truncate text-center text-[0.65rem] uppercase tracking-wide text-muted-foreground">
              {t('reps')}
            </Label>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPicker('reps')}
              aria-label={t('reps')}
              aria-haspopup="dialog"
              className="h-11 w-full min-w-0 px-1 text-base font-semibold tabular-nums"
            >
              {form.reps}
            </Button>
          </div>
          <label className="min-w-0 space-y-1">
            <span className="block truncate text-center text-[0.65rem] uppercase tracking-wide text-muted-foreground">
              RIR
            </span>
            <select
              aria-label={t('repsInReserve')}
              value={form.rir ?? ''}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  rir: event.target.value === '' ? null : Number(event.target.value),
                }))
              }
              className="h-11 w-full min-w-0 rounded-md border border-input bg-background px-0 text-center text-base font-semibold"
            >
              <option value="">-</option>
              {RIR_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <Button
            type="button"
            size="icon"
            onClick={handleValidate}
            disabled={submitting}
            aria-label={t('logSet')}
            className="size-11"
          >
            <Check className="size-5" />
          </Button>
        </div>

        {metrics.length > 0 && (
          <div className="flex flex-wrap justify-end gap-x-3 gap-y-1 text-xs tabular-nums text-muted-foreground">
            {metrics.map((metric) => {
              const value =
                metric === 'VOLUME'
                  ? form.weight * form.reps
                  : estimateRepMax(form.weight, form.reps, metric === '10RM' ? 10 : 1);
              const label =
                metric === '1RM'
                  ? metricT('oneRmShort')
                  : metric === '10RM'
                    ? metricT('tenRmShort')
                    : metricT('volumeShort');
              return (
                <span key={metric} data-testid={'active-set-metric-' + metric}>
                  {label}{' '}
                  {value > 0
                    ? formatWeight(value, unit, {
                        decimals: 1,
                        group: false,
                        locale,
                        withUnit: false,
                      })
                    : '-'}
                </span>
              );
            })}
          </div>
        )}

        {recommendation && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
            <span className="font-medium">
              {autoT('nextSet')}:{' '}
              {unit === 'LB'
                ? roundWeight(toDisplayWeight(recommendation.weight, unit), 1)
                : recommendation.weight}{' '}
              {unitLabel(unit)} × {recommendation.reps} · RIR {recommendation.rir}
            </span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={applyRecommendation}
              disabled={recommendationMatchesDraft}
            >
              {autoT('apply')}
            </Button>
            <span className="basis-full text-xs text-muted-foreground">
              {autoT(AUTOREGULATION_REASON_KEYS[recommendation.reason])}
            </span>
          </div>
        )}

        <details className="rounded-md border border-border bg-muted/10 px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium">{t('moreOptions')}</summary>
          <div className="mt-3 space-y-4">
            <div className="space-y-1">
              <Label
                htmlFor="quick-entry"
                className="text-xs uppercase tracking-wide text-muted-foreground"
              >
                {t('quickEntry')}
              </Label>
              <Input
                id="quick-entry"
                type="text"
                inputMode="text"
                autoComplete="off"
                value={quickEntry}
                onChange={(event) => handleQuickEntry(event.target.value)}
                placeholder={t('quickEntryExample', { unit: unitLabel(unit) })}
                aria-invalid={quickEntryInvalid}
              />
              {quickEntryInvalid && (
                <p className="text-xs text-muted-foreground">{t('quickEntryError')}</p>
              )}
            </div>

            <div className="space-y-1">
              <Label
                htmlFor="ai-parse"
                className="text-xs uppercase tracking-wide text-muted-foreground"
              >
                {t('describe')}
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="ai-parse"
                  type="text"
                  inputMode="text"
                  autoComplete="off"
                  value={aiText}
                  onChange={(event) => {
                    setAiText(event.target.value);
                    if (aiHint) setAiHint(null);
                  }}
                  placeholder={t('strengthExample')}
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleAiParse}
                  disabled={aiParsing || aiText.trim() === ''}
                  className="shrink-0"
                >
                  {aiParsing ? t('parsing') : t('parse')}
                </Button>
              </div>
              {aiHint ? (
                <p className="text-xs text-muted-foreground">{aiHint}</p>
              ) : (
                <p className="text-xs text-muted-foreground">{t('parseHelp')}</p>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <WarmupCalculator
                  weightKg={form.weight}
                  unit={unit}
                  barWeightsKg={loadConstraints?.barWeights}
                />
                <PlateCalculator
                  weightKg={form.weight}
                  unit={unit}
                  barWeightsKg={loadConstraints?.barWeights}
                  plateWeightsKg={loadConstraints?.plateWeights}
                />
              </div>
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <label className="flex cursor-pointer items-center gap-2">
                  <Switch
                    checked={form.isDropSet}
                    disabled={
                      returnRecommendation != null && returnRecommendation.mode !== 'normal'
                    }
                    onCheckedChange={(value) =>
                      setForm((current) => ({ ...current, isDropSet: value }))
                    }
                  />
                  <span>{t('dropSet')}</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <Switch
                    checked={form.isWarmup}
                    onCheckedChange={(value) =>
                      setForm((current) => ({ ...current, isWarmup: value }))
                    }
                  />
                  <span>{t('warmup')}</span>
                </label>
              </div>
            </div>

            <div className="space-y-2">
              <Label
                htmlFor="set-notes"
                className="text-xs uppercase tracking-wide text-muted-foreground"
              >
                {t('note')}
              </Label>
              <Textarea
                id="set-notes"
                rows={2}
                value={form.notes}
                onChange={(event) =>
                  setForm((current) => ({ ...current, notes: event.target.value }))
                }
                placeholder={t('notePlaceholder')}
              />
            </div>
          </div>
        </details>

        <SetValuePicker
          open={picker != null}
          kind={picker ?? 'weight'}
          value={picker === 'reps' ? form.reps : displayWeight}
          options={picker === 'reps' ? repPickerOptions : weightPickerOptions}
          unit={unit}
          loadConstraints={loadConstraints}
          onClose={() => setPicker(null)}
          onChoose={(value) => {
            setForm((current) => ({
              ...current,
              ...(picker === 'reps'
                ? { reps: Math.max(1, Math.round(value)) }
                : { weight: fromDisplayWeight(value, unit) }),
            }));
            setPicker(null);
          }}
        />
      </div>
    );
  }

  return (
    <Card className={embedded ? 'rounded-none border-0 shadow-none' : undefined}>
      <CardContent
        className={embedded ? 'flex flex-col gap-4 px-3 pb-3 pt-2' : 'flex flex-col gap-4 pt-6'}
      >
        {recommendation && !isCardio && (
          <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
            <p className="text-xs font-medium uppercase text-muted-foreground">
              {autoT('nextSet')}
            </p>
            <p className="mt-1 text-lg font-semibold">
              {unit === 'LB'
                ? roundWeight(toDisplayWeight(recommendation.weight, unit), 1)
                : recommendation.weight}{' '}
              {unitLabel(unit)} × {recommendation.reps} · RIR {recommendation.rir}
            </p>
            <p className="text-xs text-muted-foreground">
              {autoT(`reasons.${recommendation.reason}`)}
            </p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mt-2"
              onClick={applyRecommendation}
              disabled={recommendationMatchesDraft}
            >
              {autoT('apply')}
            </Button>
          </div>
        )}
        {/* Opt-in AI free-text parse (issue #210): fills the form below from a
            plain-language description. Deliberate action, never auto-logs. */}
        <div className="space-y-1">
          <Label
            htmlFor="ai-parse"
            className="text-xs uppercase tracking-wide text-muted-foreground"
          >
            {t('describe')}
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="ai-parse"
              type="text"
              inputMode="text"
              autoComplete="off"
              value={aiText}
              onChange={(e) => {
                setAiText(e.target.value);
                if (aiHint) setAiHint(null);
              }}
              placeholder={isCardio ? t('cardioExample') : t('strengthExample')}
            />
            <Button
              type="button"
              variant="secondary"
              onClick={handleAiParse}
              disabled={aiParsing || aiText.trim() === ''}
              className="shrink-0"
            >
              {aiParsing ? t('parsing') : t('parse')}
            </Button>
          </div>
          {aiHint ? (
            <p className="text-xs text-muted-foreground">{aiHint}</p>
          ) : (
            <p className="text-xs text-muted-foreground">{t('parseHelp')}</p>
          )}
        </div>

        {equipmentOptions.length > 0 && (
          <div className="space-y-1">
            <Label
              htmlFor="gym-equipment"
              className="text-xs uppercase tracking-wide text-muted-foreground"
            >
              {t('equipment')}
            </Label>
            <select
              id="gym-equipment"
              value={gymEquipmentId}
              onChange={(event) => {
                const next = event.target.value;
                setGymEquipmentId(next);
                onEquipmentChange?.(next || null);
              }}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">{t('equipmentNone')}</option>
              {equipmentOptions.map((equipment) => (
                <option key={equipment.id} value={equipment.id}>
                  {equipment.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {isCardio ? (
          <>
            {/* Duration (required) */}
            <div className="space-y-1">
              <Label
                htmlFor="cardio-duration"
                className="text-xs uppercase tracking-wide text-muted-foreground"
              >
                {t('duration')}
              </Label>
              <Input
                id="cardio-duration"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={form.durationInput}
                onChange={(e) => setForm((f) => ({ ...f, durationInput: e.target.value }))}
                placeholder={t('durationExample')}
                aria-invalid={durationInvalid}
                className="h-14 text-center text-2xl font-semibold"
              />
              {durationInvalid && (
                <p className="text-xs text-muted-foreground">{t('durationError')}</p>
              )}
            </div>

            {/* Distance (optional) */}
            <div className="space-y-1">
              <Label
                htmlFor="cardio-distance"
                className="text-xs uppercase tracking-wide text-muted-foreground"
              >
                {t('distance')}
              </Label>
              <Input
                id="cardio-distance"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={form.distanceInput}
                onChange={(e) => setForm((f) => ({ ...f, distanceInput: e.target.value }))}
                placeholder={t('distanceExample')}
                aria-invalid={distanceInvalid}
                className="h-14 text-center text-2xl font-semibold"
              />
              {distanceInvalid && (
                <p className="text-xs text-muted-foreground">{t('distanceError')}</p>
              )}
            </div>
          </>
        ) : (
          <>
            {/* Quick entry shorthand */}
            <div className="space-y-1">
              <Label
                htmlFor="quick-entry"
                className="text-xs uppercase tracking-wide text-muted-foreground"
              >
                {t('quickEntry')}
              </Label>
              <Input
                id="quick-entry"
                type="text"
                inputMode="text"
                autoComplete="off"
                value={quickEntry}
                onChange={(e) => handleQuickEntry(e.target.value)}
                placeholder={t('quickEntryExample', { unit: unitLabel(unit) })}
                aria-invalid={quickEntryInvalid}
              />
              {quickEntryInvalid && (
                <p className="text-xs text-muted-foreground">{t('quickEntryError')}</p>
              )}
            </div>

            {/* Load */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t('load', { unit: unitLabel(unit) })}
                </Label>
                <div className="flex items-center gap-1">
                  <WarmupCalculator
                    weightKg={form.weight}
                    unit={unit}
                    barWeightsKg={loadConstraints?.barWeights}
                  />
                  <PlateCalculator
                    weightKg={form.weight}
                    unit={unit}
                    barWeightsKg={loadConstraints?.barWeights}
                    plateWeightsKg={loadConstraints?.plateWeights}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => adjustWeight(-stepKg)}
                  className="min-h-tap min-w-tap"
                  aria-label={`-${stepDisplay} ${unitLabel(unit)}`}
                >
                  <Minus className="size-5" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPicker('weight')}
                  aria-label={t('load', { unit: unitLabel(unit) })}
                  aria-haspopup="dialog"
                  className="h-14 flex-1 text-center text-2xl font-semibold tabular-nums"
                >
                  {displayWeight}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => adjustWeight(stepKg)}
                  className="min-h-tap min-w-tap"
                  aria-label={`+${stepDisplay} ${unitLabel(unit)}`}
                >
                  <Plus className="size-5" />
                </Button>
              </div>
            </div>

            {/* Reps */}
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                {t('reps')}
              </Label>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => adjustReps(-1)}
                  className="min-h-tap min-w-tap"
                  aria-label="-1 rep"
                >
                  <Minus className="size-5" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPicker('reps')}
                  aria-label={t('reps')}
                  aria-haspopup="dialog"
                  className="h-14 flex-1 text-center text-2xl font-semibold tabular-nums"
                >
                  {form.reps}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => adjustReps(1)}
                  className="min-h-tap min-w-tap"
                  aria-label="+1 rep"
                >
                  <Plus className="size-5" />
                </Button>
              </div>
            </div>

            {metrics.length > 0 && (
              <div
                className={metrics.length > 1 ? 'grid grid-cols-2 gap-2' : 'grid grid-cols-1 gap-2'}
              >
                {metrics.map((metric) => {
                  const value =
                    metric === 'VOLUME'
                      ? form.weight * form.reps
                      : estimateRepMax(form.weight, form.reps, metric === '10RM' ? 10 : 1);
                  const label =
                    metric === '1RM'
                      ? metricT('oneRmShort')
                      : metric === '10RM'
                        ? metricT('tenRmShort')
                        : metricT('volumeShort');
                  return (
                    <div
                      key={metric}
                      data-testid={'active-set-metric-' + metric}
                      className="rounded-md border border-border bg-muted/20 px-3 py-2"
                    >
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {label}
                      </p>
                      <p className="mt-0.5 text-lg font-semibold tabular-nums">
                        {value > 0
                          ? formatWeight(value, unit, {
                              decimals: 1,
                              group: false,
                              locale,
                              withUnit: false,
                            })
                          : '-'}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}

            {/* RIR */}
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                {t('repsInReserve')}
              </Label>
              <div className="grid grid-cols-4 gap-2">
                {RIR_OPTIONS.map((opt) => (
                  <Button
                    key={opt}
                    type="button"
                    variant={form.rir === opt ? 'default' : 'outline'}
                    onClick={() => setForm((f) => ({ ...f, rir: opt }))}
                    className="min-h-tap text-lg font-semibold"
                  >
                    {opt}
                  </Button>
                ))}
              </div>
            </div>

            {/* Toggles */}
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <label className="flex cursor-pointer items-center gap-2">
                <Switch
                  checked={form.isDropSet}
                  disabled={returnRecommendation != null && returnRecommendation.mode !== 'normal'}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, isDropSet: v }))}
                />
                <span>{t('dropSet')}</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <Switch
                  checked={form.isWarmup}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, isWarmup: v }))}
                />
                <span>{t('warmup')}</span>
              </label>
            </div>
          </>
        )}

        {/* Notes */}
        <div className="space-y-2">
          <Label
            htmlFor="set-notes"
            className="text-xs uppercase tracking-wide text-muted-foreground"
          >
            {t('note')}
          </Label>
          <Textarea
            id="set-notes"
            rows={2}
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            placeholder={t('notePlaceholder')}
          />
        </div>

        <Button
          type="button"
          onClick={handleValidate}
          disabled={submitting || cardioInvalid}
          className="h-20 w-full text-lg font-semibold"
        >
          <Check className="size-6" />
          <span className="ml-2">{submitting ? common('actions.saving') : t('logSet')}</span>
        </Button>
      </CardContent>
      {!isCardio && (
        <SetValuePicker
          open={picker != null}
          kind={picker ?? 'weight'}
          value={picker === 'reps' ? form.reps : displayWeight}
          options={picker === 'reps' ? repPickerOptions : weightPickerOptions}
          unit={unit}
          loadConstraints={loadConstraints}
          onClose={() => setPicker(null)}
          onChoose={(value) => {
            setForm((current) => ({
              ...current,
              ...(picker === 'reps'
                ? { reps: Math.max(1, Math.round(value)) }
                : { weight: fromDisplayWeight(value, unit) }),
            }));
            setPicker(null);
          }}
        />
      )}
    </Card>
  );
}

function computeInitial(
  pe: ProgramExercise & { exercise: Exercise },
  existingSets: PendingSet[],
  lastPerf: SerializedLastPerformance | undefined,
  readiness: ReadinessSignal | null,
  deloadActive: boolean,
  returnRecommendation: ReturnRecommendation | null = null,
  loadConstraints: GymLoadConstraints | null = null,
): FormState {
  // Cardio exercises (issue #133): prefill the duration/distance from the
  // last cardio set of this session, otherwise leave the inputs empty. The
  // weight/reps machinery below is strength-only.
  if (pe.exercise.category === 'CARDIO') {
    const lastCardio = existingSets.filter((s) => s.durationSec != null).at(-1);
    return {
      weight: 0,
      reps: 1,
      rir: null,
      durationInput: lastCardio?.durationSec != null ? formatDuration(lastCardio.durationSec) : '',
      distanceInput:
        lastCardio?.distanceM != null && lastCardio.distanceM > 0
          ? String(+(lastCardio.distanceM / 1000).toFixed(2))
          : '',
      isWarmup: false,
      isDropSet: false,
      notes: '',
    };
  }

  // 1. If a set already exists for this exercise in the current session,
  //    reuse its values (idea: you aim for the same load, adjust the reps).
  const lastInSession = existingSets.filter((s) => !s.isWarmup).at(-1);
  if (lastInSession) {
    return {
      weight: lastInSession.weight,
      reps: lastInSession.reps,
      rir: lastInSession.rir,
      durationInput: '',
      distanceInput: '',
      isWarmup: false,
      isDropSet: false,
      notes: '',
    };
  }
  // 2. A return after a long break is a session-only calibration. Keep the
  //    normal progression path intact for ordinary sessions, but start this one
  //    at the conservative history/inventory value and let later sets hand off
  //    to RIR-aware intra-set autoregulation.
  if (returnRecommendation && returnRecommendation.mode !== 'normal') {
    let weight = returnRecommendation.suggestedWeight;
    if (weight == null && lastPerf) {
      const ordinary = suggestNextWeight(
        pe,
        lastPerf.sets,
        readiness,
        deloadActive,
        loadConstraints,
      );
      weight = ordinary.weight ?? lastPerf.maxWeight;
      if (
        returnRecommendation.weightCeiling != null &&
        weight > returnRecommendation.weightCeiling
      ) {
        weight = constrainGymWeightAtOrBelow(returnRecommendation.weightCeiling, loadConstraints);
      }
    }

    return {
      weight: weight ?? 0,
      reps: pe.targetRepsMin,
      rir: pe.targetRIR,
      durationInput: '',
      distanceInput: '',
      isWarmup: false,
      isDropSet: false,
      notes: '',
    };
  }

  // 2. Otherwise, pre-fill with the suggestion (double progression algo). If
  //    progressing, aim for the bottom of the rep range with the heavier
  //    load; otherwise try to beat the previous reps (at least match them).
  if (lastPerf) {
    const suggestion = suggestNextWeight(
      pe,
      lastPerf.sets,
      readiness,
      deloadActive,
      loadConstraints,
    );
    const initialReps =
      suggestion.reason === 'progression' ? pe.targetRepsMin : lastPerf.repsAtMaxWeight;
    return {
      weight: suggestion.weight ?? lastPerf.maxWeight,
      reps: initialReps,
      rir: pe.targetRIR,
      durationInput: '',
      distanceInput: '',
      isWarmup: false,
      isDropSet: false,
      notes: '',
    };
  }
  // 3. Defaults: middle of the rep range, target RIR, load 0.
  const midReps = Math.round((pe.targetRepsMin + pe.targetRepsMax) / 2);
  return {
    weight: 0,
    reps: midReps,
    rir: pe.targetRIR,
    durationInput: '',
    distanceInput: '',
    isWarmup: false,
    isDropSet: false,
    notes: '',
  };
}
