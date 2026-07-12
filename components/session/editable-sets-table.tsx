'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Droplet, Loader2, Sparkles } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { Exercise, ProgramExercise, WeightUnit } from '@/lib/prisma-client';
import type { PendingSet } from '@/lib/indexeddb';
import type { SerializedLastPerformance } from '@/components/session/session-runner';
import type { IntraSetRecommendation } from '@/lib/intra-set-autoregulation';
import type { ReturnRecommendation } from '@/lib/return-to-training';
import type { SetParseResult } from '@/lib/schemas/set-parse';
import type { GymLoadConstraints } from '@/lib/gym-loads';
import { constrainGymWeight, gymWeightOptions } from '@/lib/gym-loads';
import { suggestNextWeight, type ReadinessSignal } from '@/lib/progression';
import { estimateRepMax } from '@/lib/stats';
import { formatWeight, fromDisplayWeight, roundWeight, toDisplayWeight } from '@/lib/units';
import { loadPreferences } from '@/lib/preferences';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SetValuePicker } from '@/components/session/set-value-picker';
import { nextPlannedSetIsDropSet, targetDropSets } from '@/lib/planned-sets';

interface Props {
  programExercise: ProgramExercise & { exercise: Exercise };
  sets: PendingSet[];
  lastPerformance: SerializedLastPerformance | undefined;
  readiness: ReadinessSignal | null;
  deloadActive: boolean;
  unit: WeightUnit;
  recommendation?: IntraSetRecommendation | null;
  returnRecommendation?: ReturnRecommendation | null;
  loadConstraints?: GymLoadConstraints | null;
  disabled?: boolean;
  onSubmit: (values: {
    weight: number;
    reps: number;
    rir: number | null;
    durationSec: null;
    distanceM: null;
    isWarmup: false;
    isDropSet: boolean;
    notes: null;
  }) => Promise<void>;
  onUpdateSet: (
    set: PendingSet,
    values: { weight: number; reps: number; rir: number | null },
  ) => Promise<void>;
}

interface DraftSet {
  weight: number;
  reps: number;
  rir: number | null;
}

interface EditingSet {
  set: PendingSet;
  draft: DraftSet;
  awaitingPersistence: boolean;
}

const SET_GRID_COLUMNS =
  'grid-cols-[1.5rem_minmax(0,1.05fr)_minmax(2.75rem,0.72fr)_minmax(2.5rem,0.65fr)_minmax(3.75rem,0.9fr)_2.75rem] sm:grid-cols-[2.25rem_minmax(5rem,1.05fr)_minmax(3.5rem,0.72fr)_minmax(3.25rem,0.65fr)_minmax(4.5rem,0.9fr)_3rem]';

function draftFromSet(set: PendingSet): DraftSet {
  return {
    weight: set.weight,
    reps: set.reps,
    rir: set.rir,
  };
}

function initialDraft(
  pe: Props['programExercise'],
  sets: PendingSet[],
  lastPerformance: SerializedLastPerformance | undefined,
  returnRecommendation: ReturnRecommendation | null,
  readiness: ReadinessSignal | null,
  deloadActive: boolean,
  loadConstraints: GymLoadConstraints | null,
): DraftSet {
  const loggedSets = sets.filter((set) => !set.isWarmup);
  if (
    loggedSets.length === 0 &&
    returnRecommendation != null &&
    returnRecommendation.mode !== 'normal'
  ) {
    return {
      weight: returnRecommendation.suggestedWeight ?? 0,
      reps: pe.targetRepsMin,
      rir: returnRecommendation.targetRIR,
    };
  }

  const nextIsDropSet = nextPlannedSetIsDropSet(pe, sets);
  const previousRow = lastPerformance?.sets[loggedSets.length];
  if (previousRow) {
    return { weight: previousRow.weight, reps: previousRow.reps, rir: previousRow.rir };
  }

  const lastLogged = loggedSets.at(-1);
  if (nextIsDropSet && lastLogged) {
    return {
      weight: constrainGymWeight(lastLogged.weight * 0.8, lastLogged.weight, loadConstraints),
      reps: Math.max(pe.targetRepsMin, lastLogged.reps),
      rir: 0,
    };
  }

  if (lastLogged) {
    return { weight: lastLogged.weight, reps: lastLogged.reps, rir: lastLogged.rir };
  }

  if (lastPerformance) {
    const suggestion = suggestNextWeight(
      pe,
      lastPerformance.sets.filter((set) => !set.isDropSet),
      readiness,
      deloadActive,
      loadConstraints,
    );
    return {
      weight: suggestion.weight ?? lastPerformance.maxWeight,
      reps:
        suggestion.reason === 'progression'
          ? pe.targetRepsMin
          : Math.max(pe.targetRepsMin, lastPerformance.repsAtMaxWeight),
      rir: pe.targetRIR,
    };
  }

  return {
    weight: 0,
    reps: Math.round((pe.targetRepsMin + pe.targetRepsMax) / 2),
    rir: pe.targetRIR,
  };
}

export function EditableSetsTable({
  programExercise,
  sets,
  lastPerformance,
  readiness,
  deloadActive,
  unit,
  recommendation = null,
  returnRecommendation = null,
  loadConstraints = null,
  disabled = false,
  onSubmit,
  onUpdateSet,
}: Props) {
  const t = useTranslations('session.editableSets');
  const inputT = useTranslations('session.input');
  const locale = useLocale();
  const [rmTarget, setRmTarget] = useState<1 | 10>(1);
  const [draft, setDraft] = useState<DraftSet>(() =>
    initialDraft(
      programExercise,
      sets,
      lastPerformance,
      returnRecommendation,
      readiness,
      deloadActive,
      loadConstraints,
    ),
  );
  const [submitting, setSubmitting] = useState(false);
  const [editingSet, setEditingSet] = useState<EditingSet | null>(null);
  const [updatingSetId, setUpdatingSetId] = useState<string | null>(null);
  const [picker, setPicker] = useState<'weight' | 'reps' | null>(null);
  const [appliedRecommendationKey, setAppliedRecommendationKey] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiText, setAiText] = useState('');
  const [aiParsing, setAiParsing] = useState(false);
  const [aiHint, setAiHint] = useState<string | null>(null);

  useEffect(() => {
    setRmTarget(loadPreferences().rmDisplay === '10RM' ? 10 : 1);
  }, []);

  useEffect(() => {
    setDraft(
      initialDraft(
        programExercise,
        sets,
        lastPerformance,
        returnRecommendation,
        readiness,
        deloadActive,
        loadConstraints,
      ),
    );
    setAppliedRecommendationKey(null);
    setAiOpen(false);
    setAiText('');
    setAiHint(null);
    // Re-seed when the active exercise or logged row count changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    programExercise.id,
    returnRecommendation?.mode,
    returnRecommendation?.suggestedWeight,
    returnRecommendation?.targetRIR,
    sets.length,
  ]);

  useEffect(() => {
    if (!editingSet?.awaitingPersistence || updatingSetId === editingSet.set.localId) {
      return;
    }
    const persisted = sets.find((set) => set.localId === editingSet.set.localId);
    if (
      persisted &&
      persisted.weight === editingSet.draft.weight &&
      persisted.reps === editingSet.draft.reps &&
      persisted.rir === editingSet.draft.rir
    ) {
      setEditingSet(null);
    }
  }, [editingSet, sets, updatingSetId]);

  const loggedSets = useMemo(() => sets.filter((set) => !set.isWarmup), [sets]);
  const currentNumber = loggedSets.length + 1;
  const plannedRows = programExercise.targetSets + targetDropSets(programExercise);
  const totalRows = Math.max(plannedRows, currentNumber);
  const isNextDropSet = nextPlannedSetIsDropSet(programExercise, sets);
  const displayWeight =
    unit === 'LB' ? roundWeight(toDisplayWeight(draft.weight, unit), 1) : draft.weight;
  const rmValue = estimateRepMax(draft.weight, draft.reps, rmTarget);
  const pickerDraft = editingSet?.draft ?? draft;
  const availableWeights = useMemo(() => {
    const constrained = gymWeightOptions(loadConstraints, pickerDraft.weight);
    if (constrained.length > 0) return constrained;
    const step = programExercise.exercise.category === 'ISOLATION' ? 1 : 2.5;
    return Array.from({ length: 81 }, (_, index) => +(index * step).toFixed(2));
  }, [pickerDraft.weight, loadConstraints, programExercise.exercise.category]);
  const repOptions = useMemo(() => Array.from({ length: 30 }, (_, index) => index + 1), []);
  const recommendationKey = recommendation
    ? `${recommendation.weight}:${recommendation.reps}:${recommendation.rir}`
    : null;
  const canApplyRecommendation =
    !isNextDropSet && recommendation != null && appliedRecommendationKey !== recommendationKey;

  function applyRecommendation() {
    if (!recommendation || disabled) return;
    setEditingSet(null);
    setPicker(null);
    setDraft({ weight: recommendation.weight, reps: recommendation.reps, rir: recommendation.rir });
    setAppliedRecommendationKey(
      `${recommendation.weight}:${recommendation.reps}:${recommendation.rir}`,
    );
  }

  async function handleAiParse() {
    const text = aiText.trim();
    if (!text || aiParsing || disabled) return;
    setAiParsing(true);
    setAiHint(null);
    try {
      const response = await fetch('/api/sets/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exerciseId: programExercise.exercise.id, text }),
      });
      if (!response.ok) {
        setAiHint(inputT('parseError'));
        return;
      }
      const data = (await response.json()) as { parsed: SetParseResult | null };
      if (!data.parsed || data.parsed.kind !== 'strength') {
        setAiHint(inputT('parseError'));
        return;
      }

      setEditingSet(null);
      setPicker(null);
      setDraft({
        weight: fromDisplayWeight(data.parsed.weight, unit),
        reps: data.parsed.reps,
        rir: data.parsed.rir == null ? draft.rir : Math.min(5, Math.max(0, data.parsed.rir)),
      });
      setAppliedRecommendationKey(null);
    } catch {
      setAiHint(inputT('parseError'));
    } finally {
      setAiParsing(false);
    }
  }

  function openPicker(kind: 'weight' | 'reps', set?: PendingSet) {
    if (set) {
      const nextEditing =
        editingSet?.set.localId === set.localId
          ? editingSet
          : { set, draft: draftFromSet(set), awaitingPersistence: false };
      setEditingSet(nextEditing);
    } else {
      setEditingSet(null);
    }

    setPicker(kind);
  }

  function chooseValue(value: number) {
    const updateDraft = (current: DraftSet): DraftSet =>
      picker === 'weight'
        ? {
            ...current,
            weight: constrainGymWeight(
              fromDisplayWeight(value, unit),
              current.weight,
              loadConstraints,
            ),
          }
        : { ...current, reps: Math.max(1, Math.round(value)) };

    if (editingSet) {
      const nextDraft = updateDraft(editingSet.draft);
      setPicker(null);
      void persistEditedSet(editingSet.set, nextDraft);
      return;
    } else {
      setDraft(updateDraft);
      setAppliedRecommendationKey(null);
    }
    setPicker(null);
  }

  function updateEditingRir(set: PendingSet, rir: number | null) {
    const current = editingSet?.set.localId === set.localId ? editingSet.draft : draftFromSet(set);
    void persistEditedSet(set, { ...current, rir });
  }

  async function confirmRow() {
    if (disabled || submitting || draft.reps <= 0 || draft.weight < 0) return;
    setSubmitting(true);
    try {
      await onSubmit({
        weight: constrainGymWeight(draft.weight, draft.weight, loadConstraints),
        reps: draft.reps,
        rir: draft.rir,
        durationSec: null,
        distanceM: null,
        isWarmup: false,
        isDropSet: isNextDropSet,
        notes: null,
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function persistEditedSet(set: PendingSet, nextDraft: DraftSet) {
    const normalizedDraft = {
      ...nextDraft,
      weight: constrainGymWeight(nextDraft.weight, nextDraft.weight, loadConstraints),
    };

    if (
      disabled ||
      updatingSetId === set.localId ||
      normalizedDraft.reps <= 0 ||
      normalizedDraft.weight < 0
    ) {
      return;
    }

    setEditingSet({ set, draft: normalizedDraft, awaitingPersistence: true });
    setUpdatingSetId(set.localId);
    try {
      await onUpdateSet(set, normalizedDraft);
    } catch {
      // The parent shows the localized error; revert the optimistic row values.
      setEditingSet(null);
    } finally {
      setUpdatingSetId(null);
    }
  }

  return (
    <section
      data-testid="editable-sets-table"
      className="overflow-hidden rounded-md border border-border"
    >
      <div className="border-b border-border bg-muted/20 px-2 py-1.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setAiOpen((open) => !open)}
          aria-expanded={aiOpen}
          className="h-8 px-2 text-xs text-muted-foreground"
        >
          <Sparkles className="size-3.5" />
          <span className="ml-1.5">{inputT('describe')}</span>
        </Button>
        {aiOpen && (
          <div className="space-y-1 pb-1 pt-1">
            <Label htmlFor={`ai-set-${programExercise.id}`} className="sr-only">
              {inputT('describe')}
            </Label>
            <div className="flex gap-2">
              <Input
                id={`ai-set-${programExercise.id}`}
                value={aiText}
                onChange={(event) => {
                  setAiText(event.target.value);
                  if (aiHint) setAiHint(null);
                }}
                placeholder={inputT('strengthExample')}
                disabled={disabled || aiParsing}
              />
              <Button
                type="button"
                variant="secondary"
                onClick={handleAiParse}
                disabled={disabled || aiParsing || aiText.trim() === ''}
                className="shrink-0"
              >
                {aiParsing && <Loader2 className="size-4 animate-spin" />}
                {aiParsing ? inputT('parsing') : inputT('parse')}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{aiHint ?? inputT('parseHelp')}</p>
          </div>
        )}
      </div>
      <div>
        <div
          data-testid="editable-sets-header"
          className={`grid ${SET_GRID_COLUMNS} items-center gap-0.5 border-b border-border bg-muted/30 px-1 py-2 text-center text-[0.625rem] font-medium uppercase text-muted-foreground sm:gap-1 sm:px-2 sm:text-[0.6875rem]`}
        >
          <span>#</span>
          <span>{unit}</span>
          <span>REPS</span>
          <span>RIR</span>
          <span>{rmTarget}RM</span>
          <span aria-hidden />
        </div>

        {loggedSets.map((set, index) => {
          const rowNumber = index + 1;
          const isEditing = editingSet?.set.localId === set.localId;
          const rowDraft = isEditing ? editingSet.draft : draftFromSet(set);
          const isUpdating = updatingSetId === set.localId;

          return (
            <div
              key={set.localId}
              data-testid={`completed-set-${rowNumber}`}
              className={`grid ${SET_GRID_COLUMNS} items-center gap-0.5 border-b border-border px-1 py-1.5 text-center text-xs tabular-nums transition-colors sm:gap-1 sm:px-2 sm:text-sm ${isEditing ? 'bg-primary/5' : ''}`}
            >
              <span
                className="flex items-center justify-center gap-0.5 text-muted-foreground"
                title={set.isDropSet ? t('dropSetNumber', { number: rowNumber }) : undefined}
              >
                {set.isDropSet && <Droplet className="size-3 fill-current" />}
                {rowNumber}
              </span>
              <button
                type="button"
                onClick={() => openPicker('weight', set)}
                disabled={disabled || isUpdating}
                aria-label={t('weight', { number: rowNumber, unit })}
                className={`h-9 w-full min-w-0 rounded-md border px-0.5 text-center text-xs font-semibold tabular-nums sm:text-sm ${isEditing ? 'border-input bg-background' : 'border-transparent bg-transparent hover:bg-muted/40'}`}
              >
                {formatWeight(rowDraft.weight, unit, {
                  decimals: 2,
                  group: false,
                  locale,
                })}
              </button>
              <button
                type="button"
                onClick={() => openPicker('reps', set)}
                disabled={disabled || isUpdating}
                aria-label={t('reps', { number: rowNumber })}
                className={`h-9 w-full min-w-0 rounded-md border px-0 text-center text-xs font-semibold tabular-nums sm:text-sm ${isEditing ? 'border-input bg-background' : 'border-transparent bg-transparent hover:bg-muted/40'}`}
              >
                {rowDraft.reps}
              </button>
              <select
                aria-label={t('rir', { number: rowNumber })}
                value={rowDraft.rir ?? ''}
                onChange={(event) =>
                  updateEditingRir(
                    set,
                    event.target.value === '' ? null : Number(event.target.value),
                  )
                }
                disabled={disabled || isUpdating}
                className={`h-9 w-full min-w-0 rounded-md border px-0 text-center text-xs font-semibold tabular-nums sm:text-sm ${isEditing ? 'border-input bg-background' : 'appearance-none border-transparent bg-transparent'}`}
              >
                <option value="">–</option>
                {[0, 1, 2, 3, 4, 5].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
              <span className="min-w-0 whitespace-nowrap text-[0.6875rem] text-muted-foreground sm:text-sm">
                {formatWeight(estimateRepMax(rowDraft.weight, rowDraft.reps, rmTarget), unit, {
                  decimals: 1,
                  group: false,
                  locale,
                })}
              </span>
              <span className="flex items-center justify-center" aria-hidden>
                {isUpdating && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
              </span>
            </div>
          );
        })}

        <div
          className={`grid ${SET_GRID_COLUMNS} items-center gap-0.5 border-b border-border bg-primary/5 px-1 py-2 sm:gap-1 sm:px-2`}
        >
          {recommendation && !isNextDropSet ? (
            <button
              type="button"
              data-testid="apply-set-recommendation"
              onClick={applyRecommendation}
              disabled={disabled || !canApplyRecommendation}
              aria-label={t('applyRecommendation', { number: currentNumber })}
              title={t('applyRecommendation', { number: currentNumber })}
              className="relative mx-auto flex size-6 items-center justify-center rounded-md text-sm font-semibold text-primary transition-colors hover:bg-primary/10 disabled:cursor-default disabled:opacity-100"
            >
              {currentNumber}
              {canApplyRecommendation && (
                <span
                  data-testid="set-recommendation-dot"
                  aria-hidden
                  className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-sky-500 ring-2 ring-background"
                />
              )}
            </button>
          ) : (
            <span
              className="flex items-center justify-center gap-0.5 text-center text-sm font-semibold text-primary"
              title={isNextDropSet ? t('dropSetNumber', { number: currentNumber }) : undefined}
            >
              {isNextDropSet && <Droplet className="size-3.5 fill-current" />}
              {currentNumber}
            </span>
          )}
          <button
            type="button"
            onClick={() => openPicker('weight')}
            aria-label={t('weight', { number: currentNumber, unit })}
            className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-1 text-center text-sm font-semibold tabular-nums sm:h-11 sm:px-2 sm:text-base"
          >
            {displayWeight}
          </button>
          <button
            type="button"
            onClick={() => openPicker('reps')}
            aria-label={t('reps', { number: currentNumber })}
            className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-0.5 text-center text-sm font-semibold tabular-nums sm:h-11 sm:px-1 sm:text-base"
          >
            {draft.reps}
          </button>
          <select
            aria-label={t('rir', { number: currentNumber })}
            value={draft.rir ?? ''}
            onFocus={() => setEditingSet(null)}
            onChange={(event) => {
              setDraft((current) => ({
                ...current,
                rir: event.target.value === '' ? null : Number(event.target.value),
              }));
              setAppliedRecommendationKey(null);
            }}
            className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-0 text-center text-sm font-semibold sm:h-11 sm:px-1 sm:text-base"
          >
            <option value="">–</option>
            {[0, 1, 2, 3, 4, 5].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <span className="min-w-0 whitespace-nowrap text-center text-[0.6875rem] font-medium tabular-nums leading-tight text-muted-foreground sm:text-sm">
            {rmValue > 0 ? formatWeight(rmValue, unit, { decimals: 1, group: false, locale }) : '–'}
          </span>
          <Button
            type="button"
            size="icon"
            onClick={confirmRow}
            disabled={disabled || submitting || draft.reps <= 0}
            aria-label={t('confirm', { number: currentNumber })}
            className="size-10 justify-self-center sm:size-11"
          >
            {submitting ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <Check className="size-5 sm:size-6" />
            )}
          </Button>
        </div>

        {Array.from({ length: Math.max(0, totalRows - currentNumber) }, (_, index) => {
          const rowNumber = currentNumber + index + 1;
          const isUpcomingDropSet =
            rowNumber > programExercise.targetSets && rowNumber <= plannedRows;
          const previous = lastPerformance?.sets[rowNumber - 1];
          return (
            <div
              key={`upcoming-${rowNumber}`}
              className={`grid ${SET_GRID_COLUMNS} items-center gap-0.5 border-b border-border px-1 py-3 text-center text-xs text-muted-foreground last:border-b-0 sm:gap-1 sm:px-2 sm:text-sm [&>span]:min-w-0 [&>span]:whitespace-nowrap`}
            >
              <span className="flex items-center justify-center gap-0.5">
                {isUpcomingDropSet && <Droplet className="size-3 fill-current" />}
                {rowNumber}
              </span>
              <span>
                {previous
                  ? formatWeight(previous.weight, unit, { decimals: 2, group: false, locale })
                  : '–'}
              </span>
              <span>{previous?.reps ?? '–'}</span>
              <span>{previous?.rir ?? '–'}</span>
              <span>
                {previous
                  ? formatWeight(estimateRepMax(previous.weight, previous.reps, rmTarget), unit, {
                      decimals: 1,
                      group: false,
                      locale,
                    })
                  : '–'}
              </span>
              <span />
            </div>
          );
        })}
      </div>

      <SetValuePicker
        open={picker != null}
        kind={picker ?? 'weight'}
        value={
          picker === 'reps'
            ? pickerDraft.reps
            : unit === 'LB'
              ? roundWeight(toDisplayWeight(pickerDraft.weight, unit), 1)
              : pickerDraft.weight
        }
        options={
          picker === 'reps'
            ? repOptions
            : availableWeights.map((weight) =>
                unit === 'LB' ? roundWeight(toDisplayWeight(weight, unit), 1) : weight,
              )
        }
        unit={unit}
        loadConstraints={loadConstraints}
        onClose={() => setPicker(null)}
        onChoose={chooseValue}
      />
    </section>
  );
}
