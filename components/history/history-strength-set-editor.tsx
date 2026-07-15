'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { WeightUnit } from '@/lib/prisma-client';
import type { GymLoadConstraints } from '@/lib/gym-loads';
import { gymWeightOptions } from '@/lib/gym-loads';
import { formatWeight, fromDisplayWeight, roundWeight, toDisplayWeight } from '@/lib/units';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { SetValuePicker } from '@/components/session/set-value-picker';

export interface HistoricalStrengthSet {
  id: string;
  setNumber: number;
  weight: number;
  reps: number;
  rir: number | null;
  isWarmup: boolean;
  isDropSet: boolean;
  gymEquipmentId: string | null;
  equipmentNameSnapshot: string | null;
  frozenLoadConstraints: GymLoadConstraints | null;
  frozenLoadSnapshotVersion: 1 | 2 | null;
}

interface DraftSet {
  weight: number;
  reps: number;
  rir: number | null;
}

type PickerTarget =
  | { kind: 'weight' | 'reps'; setId: string }
  | { kind: 'weight' | 'reps'; setId: null };

interface Props {
  sessionId: string;
  exerciseId: string;
  exerciseName: string;
  sets: HistoricalStrengthSet[];
  unit: WeightUnit;
  loadConstraints: GymLoadConstraints | null;
  equipmentRequired: boolean;
}

const HISTORY_GRID =
  'grid-cols-[1.5rem_minmax(4rem,1fr)_minmax(2.75rem,0.65fr)_minmax(2.5rem,0.55fr)_2.75rem] sm:grid-cols-[2rem_minmax(5rem,1fr)_minmax(3.5rem,0.65fr)_minmax(3rem,0.55fr)_3rem]';

export function HistoryStrengthSetEditor({
  sessionId,
  exerciseId,
  exerciseName,
  sets,
  unit,
  loadConstraints,
  equipmentRequired,
}: Props) {
  const t = useTranslations('history.detail.editor');
  const common = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const equipmentOptions = useMemo(
    () => loadConstraints?.equipmentOptions ?? [],
    [loadConstraints?.equipmentOptions],
  );
  const [selectedEquipmentId, setSelectedEquipmentId] = useState<string | null>(() =>
    initialEquipmentId(sets, equipmentOptions),
  );
  const [draft, setDraft] = useState<DraftSet>(() => draftFromSets(sets));
  const [picker, setPicker] = useState<PickerTarget | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [deleteSet, setDeleteSet] = useState<HistoricalStrengthSet | null>(null);
  const selectedEquipment = useMemo(
    () =>
      equipmentOptions.find((equipment) => equipment.equipmentId === selectedEquipmentId) ?? null,
    [equipmentOptions, selectedEquipmentId],
  );

  useEffect(() => {
    setSelectedEquipmentId((current) => {
      if (current && equipmentOptions.some((item) => item.equipmentId === current)) return current;
      return initialEquipmentId(sets, equipmentOptions);
    });
  }, [equipmentOptions, sets]);

  useEffect(() => {
    setDraft(draftFromSets(sets));
  }, [sets]);

  useEffect(() => {
    if (!selectedEquipment || selectedEquipment.attainableLoads.length === 0) return;
    setDraft((current) => normalizeDraftForEquipment(current, selectedEquipment));
  }, [selectedEquipment]);

  const pickerSet = picker?.setId ? (sets.find((set) => set.id === picker.setId) ?? null) : null;
  const pickerDraft = pickerSet ?? draft;
  const pickerConstraints = pickerSet
    ? constraintsForExistingSet(loadConstraints, pickerSet)
    : constraintsForEquipment(loadConstraints, selectedEquipmentId);
  const weightOptions = useMemo(
    () => gymWeightOptions(pickerConstraints, pickerDraft.weight),
    [pickerConstraints, pickerDraft.weight],
  );
  const pickerOptions =
    picker?.kind === 'reps'
      ? Array.from({ length: 30 }, (_, index) => index + 1)
      : weightOptions.map((weight) => toPickerWeight(weight, unit));
  const equipmentSelectionRequired = equipmentRequired && !selectedEquipmentId;
  const equipmentUnavailable = equipmentRequired && equipmentOptions.length === 0;
  const draftLoadIsAttainable =
    !selectedEquipment ||
    selectedEquipment.attainableLoads.length === 0 ||
    selectedEquipment.attainableLoads.some((weight) => nearlyEqual(weight, draft.weight));
  const canAddSet =
    pendingAction == null && !equipmentSelectionRequired && draft.reps > 0 && draftLoadIsAttainable;
  const nextSetNumber = Math.max(0, ...sets.map((set) => set.setNumber)) + 1;

  async function updateSet(set: HistoricalStrengthSet, values: DraftSet) {
    if (pendingAction) return;
    setPendingAction(set.id);
    try {
      await requestJson(`/api/sets/${set.id}`, 'PATCH', values);
      toast.success(t('updated'));
      router.refresh();
    } catch {
      toast.error(t('saveError'));
    } finally {
      setPendingAction(null);
    }
  }

  async function addSet() {
    if (!canAddSet) return;
    setPendingAction('add');
    try {
      await requestJson(`/api/sessions/${sessionId}/historical-sets`, 'POST', {
        exerciseId,
        gymEquipmentId: selectedEquipmentId,
        weight: draft.weight,
        reps: draft.reps,
        rir: draft.rir,
      });
      toast.success(t('added'));
      router.refresh();
    } catch {
      toast.error(t('addError'));
    } finally {
      setPendingAction(null);
    }
  }

  async function confirmDelete() {
    if (!deleteSet || pendingAction) return;
    const target = deleteSet;
    setPendingAction(`delete:${target.id}`);
    try {
      await requestJson(`/api/sets/${target.id}`, 'DELETE');
      setDeleteSet(null);
      toast.success(t('deleted'));
      router.refresh();
    } catch {
      toast.error(t('deleteError'));
    } finally {
      setPendingAction(null);
    }
  }

  function chooseValue(displayValue: number) {
    if (!picker) return;
    const targetSet = picker.setId ? (sets.find((set) => set.id === picker.setId) ?? null) : null;
    const current = targetSet ?? draft;
    let value = displayValue;
    if (picker.kind === 'weight') {
      const normalized = normalizePickerWeight(displayValue, weightOptions, unit);
      if (normalized == null) {
        toast.error(t('invalidLoad'));
        return;
      }
      value = normalized;
    }
    const next: DraftSet = {
      weight: picker.kind === 'weight' ? value : current.weight,
      reps: picker.kind === 'reps' ? Math.max(1, Math.round(value)) : current.reps,
      rir: current.rir,
    };
    setPicker(null);
    if (targetSet) {
      void updateSet(targetSet, next);
    } else {
      setDraft(next);
    }
  }

  function selectEquipment(equipmentId: string) {
    setSelectedEquipmentId(equipmentId);
    const equipment = equipmentOptions.find((item) => item.equipmentId === equipmentId);
    if (!equipment || equipment.attainableLoads.length === 0) return;
    setDraft((current) => normalizeDraftForEquipment(current, equipment));
  }

  return (
    <section
      data-testid="history-strength-set-editor"
      className="overflow-hidden rounded-md border border-border"
    >
      <div
        data-testid="history-strength-set-header"
        className={`grid ${HISTORY_GRID} items-center gap-0.5 border-b border-border bg-muted/30 px-1 py-2 text-center text-[0.625rem] font-medium uppercase text-muted-foreground sm:gap-1 sm:px-2 sm:text-xs`}
      >
        <span>#</span>
        <span>{t('load', { unit })}</span>
        <span>{t('reps')}</span>
        <span>RIR</span>
        <span className="sr-only">{t('actions')}</span>
      </div>

      {sets.map((set) => {
        const busy = pendingAction === set.id || pendingAction === `delete:${set.id}`;
        return (
          <div
            key={set.id}
            data-testid={`history-set-row-${set.setNumber}`}
            className={`grid ${HISTORY_GRID} items-center gap-0.5 border-b border-border px-1 py-1.5 text-center text-xs tabular-nums sm:gap-1 sm:px-2 sm:text-sm`}
          >
            <span
              className="text-muted-foreground"
              title={set.isWarmup ? t('warmup') : set.isDropSet ? t('dropSet') : t('working')}
            >
              {set.setNumber}
            </span>
            <button
              type="button"
              onClick={() => setPicker({ kind: 'weight', setId: set.id })}
              disabled={busy || pendingAction != null}
              aria-label={t('editWeight', { number: set.setNumber, unit })}
              title={set.equipmentNameSnapshot ?? undefined}
              className="h-9 min-w-0 rounded-md px-0.5 font-semibold hover:bg-muted/50 disabled:opacity-50"
            >
              {formatWeight(set.weight, unit, { decimals: 2, group: false, locale })}
            </button>
            <button
              type="button"
              onClick={() => setPicker({ kind: 'reps', setId: set.id })}
              disabled={busy || pendingAction != null}
              aria-label={t('editReps', { number: set.setNumber })}
              className="h-9 rounded-md font-semibold hover:bg-muted/50 disabled:opacity-50"
            >
              {set.reps}
            </button>
            <select
              value={set.rir ?? ''}
              onChange={(event) =>
                void updateSet(set, {
                  weight: set.weight,
                  reps: set.reps,
                  rir: event.target.value === '' ? null : Number(event.target.value),
                })
              }
              disabled={busy || pendingAction != null}
              aria-label={t('editRir', { number: set.setNumber })}
              className="h-9 min-w-0 appearance-none rounded-md border-0 bg-transparent px-0 text-center font-semibold disabled:opacity-50"
            >
              <option value="">-</option>
              {[0, 1, 2, 3, 4, 5].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={pendingAction != null}
              onClick={() => setDeleteSet(set)}
              aria-label={t('deleteSet', { number: set.setNumber })}
              className="size-9 justify-self-center text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            </Button>
          </div>
        );
      })}

      <div className="space-y-2 bg-primary/5 p-2">
        {equipmentUnavailable && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
            {t('equipmentUnavailable')}
          </p>
        )}
        {equipmentOptions.length > 0 && (
          <div className="space-y-1.5">
            <Label htmlFor={`history-equipment-${exerciseId}`}>{t('equipment')}</Label>
            <Select value={selectedEquipmentId ?? undefined} onValueChange={selectEquipment}>
              <SelectTrigger
                id={`history-equipment-${exerciseId}`}
                aria-label={t('equipment')}
                className="h-10"
              >
                <SelectValue placeholder={t('chooseEquipment')} />
              </SelectTrigger>
              <SelectContent>
                {equipmentOptions.map((equipment) => (
                  <SelectItem key={equipment.equipmentId} value={equipment.equipmentId}>
                    {equipment.equipmentName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {equipmentSelectionRequired && (
              <p className="text-xs text-amber-700 dark:text-amber-400">{t('equipmentRequired')}</p>
            )}
          </div>
        )}

        <div
          data-testid="history-new-set-row"
          className={`grid ${HISTORY_GRID} items-center gap-0.5 text-center text-xs tabular-nums sm:gap-1 sm:text-sm`}
        >
          <span className="font-semibold text-primary">{nextSetNumber}</span>
          <button
            type="button"
            onClick={() => setPicker({ kind: 'weight', setId: null })}
            disabled={equipmentSelectionRequired || pendingAction != null}
            aria-label={t('newWeight', { number: nextSetNumber, unit })}
            className="h-10 min-w-0 rounded-md border border-input bg-background px-0.5 font-semibold disabled:opacity-50"
          >
            {formatWeight(draft.weight, unit, { decimals: 2, group: false, locale })}
          </button>
          <button
            type="button"
            onClick={() => setPicker({ kind: 'reps', setId: null })}
            disabled={equipmentSelectionRequired || pendingAction != null}
            aria-label={t('newReps', { number: nextSetNumber })}
            className="h-10 rounded-md border border-input bg-background font-semibold disabled:opacity-50"
          >
            {draft.reps}
          </button>
          <select
            value={draft.rir ?? ''}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                rir: event.target.value === '' ? null : Number(event.target.value),
              }))
            }
            disabled={equipmentSelectionRequired || pendingAction != null}
            aria-label={t('newRir', { number: nextSetNumber })}
            className="h-10 min-w-0 rounded-md border border-input bg-background px-0 text-center font-semibold disabled:opacity-50"
          >
            <option value="">-</option>
            {[0, 1, 2, 3, 4, 5].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <Button
            type="button"
            size="icon"
            onClick={() => void addSet()}
            disabled={!canAddSet}
            aria-label={t('addSet', { number: nextSetNumber })}
            className="size-10 justify-self-center"
          >
            {pendingAction === 'add' ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <Plus className="size-5" />
            )}
          </Button>
        </div>
      </div>

      <SetValuePicker
        open={picker != null}
        kind={picker?.kind ?? 'weight'}
        value={
          picker?.kind === 'reps' ? pickerDraft.reps : toPickerWeight(pickerDraft.weight, unit)
        }
        options={pickerOptions}
        unit={unit}
        loadConstraints={pickerConstraints}
        onClose={() => setPicker(null)}
        onChoose={chooseValue}
      />

      <AlertDialog open={deleteSet != null} onOpenChange={(open) => !open && setDeleteSet(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteDescription', {
                number: deleteSet?.setNumber ?? 0,
                exercise: exerciseName,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pendingAction != null}>
              {common('actions.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void confirmDelete()}
              disabled={pendingAction != null}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('confirmDelete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

async function requestJson(url: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown) {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Request failed with ${response.status}`);
  return response.json();
}

function draftFromSets(sets: HistoricalStrengthSet[]): DraftSet {
  const last = sets.at(-1);
  return last
    ? { weight: last.weight, reps: last.reps, rir: last.rir }
    : { weight: 0, reps: 10, rir: 2 };
}

function normalizeDraftForEquipment(
  draft: DraftSet,
  equipment: NonNullable<GymLoadConstraints['equipmentOptions']>[number],
): DraftSet {
  if (
    equipment.attainableLoads.length === 0 ||
    equipment.attainableLoads.some((weight) => nearlyEqual(weight, draft.weight))
  ) {
    return draft;
  }
  return { ...draft, weight: equipment.attainableLoads[0]! };
}

function initialEquipmentId(
  sets: HistoricalStrengthSet[],
  options: NonNullable<GymLoadConstraints['equipmentOptions']>,
): string | null {
  const recentId = sets.findLast((set) =>
    options.some((option) => option.equipmentId === set.gymEquipmentId),
  )?.gymEquipmentId;
  return recentId ?? (options.length === 1 ? options[0]!.equipmentId : null);
}

function constraintsForExistingSet(
  constraints: GymLoadConstraints | null,
  set: HistoricalStrengthSet,
): GymLoadConstraints | null {
  if (set.frozenLoadConstraints) return set.frozenLoadConstraints;
  if (set.frozenLoadSnapshotVersion === 1) return null;
  if (!constraints?.equipmentOptions?.length) return constraints;
  if (
    !set.gymEquipmentId ||
    !constraints.equipmentOptions.some((item) => item.equipmentId === set.gymEquipmentId)
  ) {
    return null;
  }
  return { ...constraints, equipmentId: set.gymEquipmentId };
}

function constraintsForEquipment(
  constraints: GymLoadConstraints | null,
  equipmentId: string | null,
): GymLoadConstraints | null {
  if (!constraints?.equipmentOptions?.length) return constraints;
  return { ...constraints, equipmentId };
}

function toPickerWeight(weightKg: number, unit: WeightUnit): number {
  return unit === 'LB' ? roundWeight(toDisplayWeight(weightKg, unit), 1) : weightKg;
}

function normalizePickerWeight(
  displayValue: number,
  optionsKg: number[],
  unit: WeightUnit,
): number | null {
  if (optionsKg.length > 0) {
    return (
      optionsKg.find((weight) => nearlyEqual(toPickerWeight(weight, unit), displayValue)) ?? null
    );
  }
  return roundWeight(fromDisplayWeight(displayValue, unit), 2);
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.001;
}
