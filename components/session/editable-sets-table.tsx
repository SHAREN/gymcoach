'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Droplet, Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { Exercise, ProgramExercise, WeightUnit } from '@/lib/prisma-client';
import type { PendingSet } from '@/lib/indexeddb';
import type { SerializedLastPerformance } from '@/components/session/session-runner';
import type { IntraSetRecommendation } from '@/lib/intra-set-autoregulation';
import type { GymLoadConstraints } from '@/lib/gym-loads';
import { constrainGymWeight, gymWeightOptions } from '@/lib/gym-loads';
import { suggestNextWeight, type ReadinessSignal } from '@/lib/progression';
import { estimateRepMax } from '@/lib/stats';
import { formatWeight, fromDisplayWeight, roundWeight, toDisplayWeight } from '@/lib/units';
import { loadPreferences } from '@/lib/preferences';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { nextPlannedSetIsDropSet, targetDropSets } from '@/lib/planned-sets';

interface Props {
  programExercise: ProgramExercise & { exercise: Exercise };
  sets: PendingSet[];
  lastPerformance: SerializedLastPerformance | undefined;
  readiness: ReadinessSignal | null;
  deloadActive: boolean;
  unit: WeightUnit;
  recommendation?: IntraSetRecommendation | null;
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
  readiness: ReadinessSignal | null,
  deloadActive: boolean,
  loadConstraints: GymLoadConstraints | null,
): DraftSet {
  const loggedSets = sets.filter((set) => !set.isWarmup);
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
  loadConstraints = null,
  disabled = false,
  onSubmit,
  onUpdateSet,
}: Props) {
  const t = useTranslations('session.editableSets');
  const locale = useLocale();
  const [rmTarget, setRmTarget] = useState<1 | 10>(1);
  const [draft, setDraft] = useState<DraftSet>(() =>
    initialDraft(programExercise, sets, lastPerformance, readiness, deloadActive, loadConstraints),
  );
  const [submitting, setSubmitting] = useState(false);
  const [editingSet, setEditingSet] = useState<EditingSet | null>(null);
  const [updatingSetId, setUpdatingSetId] = useState<string | null>(null);
  const [picker, setPicker] = useState<'weight' | 'reps' | null>(null);
  const [manualValue, setManualValue] = useState('');
  const [appliedRecommendationKey, setAppliedRecommendationKey] = useState<string | null>(null);

  useEffect(() => {
    setRmTarget(loadPreferences().rmDisplay === '10RM' ? 10 : 1);
  }, []);

  useEffect(() => {
    setDraft(
      initialDraft(
        programExercise,
        sets,
        lastPerformance,
        readiness,
        deloadActive,
        loadConstraints,
      ),
    );
    setAppliedRecommendationKey(null);
    // Re-seed when the active exercise or logged row count changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programExercise.id, sets.length]);

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

  function openPicker(kind: 'weight' | 'reps', set?: PendingSet) {
    let source = draft;
    if (set) {
      const nextEditing =
        editingSet?.set.localId === set.localId
          ? editingSet
          : { set, draft: draftFromSet(set), awaitingPersistence: false };
      setEditingSet(nextEditing);
      source = nextEditing.draft;
    } else {
      setEditingSet(null);
    }

    setPicker(kind);
    setManualValue(
      kind === 'weight'
        ? String(
            unit === 'LB' ? roundWeight(toDisplayWeight(source.weight, unit), 1) : source.weight,
          )
        : String(source.reps),
    );
  }

  function chooseValue(value: number) {
    const updateDraft = (current: DraftSet): DraftSet =>
      picker === 'weight'
        ? { ...current, weight: fromDisplayWeight(value, unit) }
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

      <Dialog open={picker != null} onOpenChange={(open) => !open && setPicker(null)}>
        <DialogContent className="bottom-0 left-0 top-auto max-h-[82vh] w-full max-w-none translate-x-0 translate-y-0 gap-3 rounded-t-lg border-x-0 border-b-0 p-4 sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:border">
          <DialogTitle>
            {picker === 'weight' ? t('chooseWeight', { unit }) : t('chooseReps')}
          </DialogTitle>
          <div className="flex gap-2">
            <Input
              autoFocus
              type="number"
              inputMode={picker === 'weight' ? 'decimal' : 'numeric'}
              step={picker === 'weight' ? '0.1' : '1'}
              min="0"
              value={manualValue}
              onChange={(event) => setManualValue(event.target.value)}
              className="h-12 text-center text-xl font-semibold tabular-nums"
            />
            <Button
              type="button"
              size="icon"
              className="size-12 shrink-0"
              onClick={() => chooseValue(Number(manualValue) || 0)}
              aria-label={t('applyValue')}
            >
              <Check className="size-6" />
            </Button>
          </div>
          <div className="max-h-[55vh] space-y-2 overflow-y-auto overscroll-contain py-1">
            {(picker === 'weight' ? availableWeights : repOptions).map((value) => {
              const shown =
                picker === 'weight'
                  ? unit === 'LB'
                    ? roundWeight(toDisplayWeight(value, unit), 1)
                    : value
                  : value;
              const selected =
                picker === 'weight' ? value === pickerDraft.weight : value === pickerDraft.reps;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => chooseValue(shown)}
                  className={`flex h-16 w-full items-center justify-center rounded-md border text-xl font-semibold tabular-nums ${
                    selected ? 'border-primary bg-primary/10' : 'border-border bg-muted/40'
                  }`}
                >
                  {shown} {picker === 'weight' ? unit.toLowerCase() : t('repsShort')}
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
