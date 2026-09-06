'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { WeightUnit } from '@/lib/prisma-client';
import { fromDisplayWeight, roundWeight, toDisplayWeight } from '@/lib/units';
import { Button } from '@/components/ui/button';
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

export interface HistoricalStrengthSet {
  id: string;
  setNumber: number;
  weight: number;
  reps: number;
  rir: number | null;
  isWarmup: boolean;
  isDropSet: boolean;
  equipmentNameSnapshot: string | null;
  gymEquipmentId: string | null;
}

export interface HistoricalEquipmentOption {
  id: string;
  name: string;
}

interface DraftSet {
  weight: number;
  reps: number;
  rir: number | null;
}

interface Props {
  sessionId: string;
  exerciseId: string;
  exerciseName: string;
  sets: HistoricalStrengthSet[];
  unit: WeightUnit;
  equipmentOptions: HistoricalEquipmentOption[];
}

export function HistoryStrengthSetEditor({
  sessionId,
  exerciseId,
  exerciseName,
  sets,
  unit,
  equipmentOptions,
}: Props) {
  const t = useTranslations('history.detail.editor');
  const common = useTranslations('common');
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, DraftSet>>(() => draftsFromSets(sets));
  const [newDraft, setNewDraft] = useState<DraftSet>(() => draftFromLastSet(sets));
  const [selectedEquipmentId, setSelectedEquipmentId] = useState<string | null>(() =>
    initialEquipmentId(sets, equipmentOptions),
  );
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [deleteSet, setDeleteSet] = useState<HistoricalStrengthSet | null>(null);

  useEffect(() => {
    setDrafts(draftsFromSets(sets));
    setNewDraft(draftFromLastSet(sets));
  }, [sets]);

  useEffect(() => {
    setSelectedEquipmentId((current) => {
      if (current && equipmentOptions.some((item) => item.id === current)) return current;
      return initialEquipmentId(sets, equipmentOptions);
    });
  }, [equipmentOptions, sets]);

  const nextSetNumber = useMemo(
    () => Math.max(0, ...sets.map((set) => set.setNumber)) + 1,
    [sets],
  );

  async function saveSet(set: HistoricalStrengthSet) {
    if (pendingAction) return;
    const draft = drafts[set.id] ?? valueFromSet(set);
    if (!validDraft(draft)) return;
    setPendingAction(`save:${set.id}`);
    try {
      await requestJson(`/api/sets/${set.id}`, 'PATCH', draft);
      toast.success(t('updated'));
      router.refresh();
    } catch {
      setDrafts((current) => ({ ...current, [set.id]: valueFromSet(set) }));
      toast.error(t('saveError'));
    } finally {
      setPendingAction(null);
    }
  }

  async function addSet() {
    if (pendingAction || !validDraft(newDraft)) return;
    setPendingAction('add');
    try {
      await requestJson(`/api/sessions/${sessionId}/historical-sets`, 'POST', {
        exerciseId,
        gymEquipmentId: selectedEquipmentId,
        ...newDraft,
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

  function updateDraft(setId: string, patch: Partial<DraftSet>) {
    setDrafts((current) => ({
      ...current,
      [setId]: { ...(current[setId] ?? { weight: 0, reps: 1, rir: null }), ...patch },
    }));
  }

  return (
    <section data-testid="history-strength-set-editor" className="space-y-3">
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[34rem] text-sm">
          <thead>
            <tr className="border-b bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-2 py-2 font-medium">#</th>
              <th className="px-2 py-2 font-medium">{t('load', { unit })}</th>
              <th className="px-2 py-2 font-medium">{t('reps')}</th>
              <th className="px-2 py-2 font-medium">RIR</th>
              <th className="px-2 py-2 font-medium">{t('equipment')}</th>
              <th className="px-2 py-2 text-right font-medium">{t('actions')}</th>
            </tr>
          </thead>
          <tbody>
            {sets.map((set) => {
              const draft = drafts[set.id] ?? valueFromSet(set);
              const changed = !sameDraft(draft, set);
              const busy = pendingAction === `save:${set.id}` || pendingAction === `delete:${set.id}`;
              return (
                <tr key={set.id} className="border-b border-border/40" data-testid={`history-set-${set.setNumber}`}>
                  <td className="px-2 py-2 text-muted-foreground" title={set.isWarmup ? t('warmup') : set.isDropSet ? t('dropSet') : t('working')}>
                    {set.setNumber}
                  </td>
                  <td className="px-2 py-2">
                    <input
                      type="number"
                      min={0}
                      max={unit === 'LB' ? 1102 : 500}
                      step="any"
                      value={displayWeight(draft.weight, unit)}
                      disabled={pendingAction != null}
                      onChange={(event) =>
                        updateDraft(set.id, {
                          weight: roundWeight(fromDisplayWeight(Number(event.target.value), unit), 2),
                        })
                      }
                      aria-label={t('editWeight', { number: set.setNumber, unit })}
                      className="h-9 w-24 rounded-md border border-input bg-background px-2 tabular-nums"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      type="number"
                      min={1}
                      max={100}
                      step={1}
                      value={draft.reps}
                      disabled={pendingAction != null}
                      onChange={(event) => updateDraft(set.id, { reps: Number(event.target.value) })}
                      aria-label={t('editReps', { number: set.setNumber })}
                      className="h-9 w-20 rounded-md border border-input bg-background px-2 tabular-nums"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <RirSelect
                      value={draft.rir}
                      disabled={pendingAction != null}
                      label={t('editRir', { number: set.setNumber })}
                      onChange={(rir) => updateDraft(set.id, { rir })}
                    />
                  </td>
                  <td className="max-w-44 truncate px-2 py-2 text-xs text-muted-foreground" title={set.equipmentNameSnapshot ?? undefined}>
                    {set.equipmentNameSnapshot ?? t('noEquipment')}
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex justify-end gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={!changed || !validDraft(draft) || pendingAction != null}
                        onClick={() => void saveSet(set)}
                        aria-label={t('saveSet', { number: set.setNumber })}
                      >
                        {busy && pendingAction === `save:${set.id}` ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Save className="size-4" />
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={pendingAction != null}
                        onClick={() => setDeleteSet(set)}
                        aria-label={t('deleteSet', { number: set.setNumber })}
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      >
                        {busy && pendingAction === `delete:${set.id}` ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Trash2 className="size-4" />
                        )}
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="rounded-md border border-dashed border-primary/40 bg-primary/5 p-3">
        <div className="mb-2 text-sm font-medium">{t('addTitle', { number: nextSetNumber })}</div>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_6rem_6rem_minmax(0,1.4fr)_auto] sm:items-end">
          <label className="space-y-1 text-xs text-muted-foreground">
            <span>{t('load', { unit })}</span>
            <input
              type="number"
              min={0}
              max={unit === 'LB' ? 1102 : 500}
              step="any"
              value={displayWeight(newDraft.weight, unit)}
              disabled={pendingAction != null}
              onChange={(event) =>
                setNewDraft((current) => ({
                  ...current,
                  weight: roundWeight(fromDisplayWeight(Number(event.target.value), unit), 2),
                }))
              }
              aria-label={t('newWeight', { number: nextSetNumber, unit })}
              className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm tabular-nums text-foreground"
            />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            <span>{t('reps')}</span>
            <input
              type="number"
              min={1}
              max={100}
              step={1}
              value={newDraft.reps}
              disabled={pendingAction != null}
              onChange={(event) =>
                setNewDraft((current) => ({ ...current, reps: Number(event.target.value) }))
              }
              aria-label={t('newReps', { number: nextSetNumber })}
              className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm tabular-nums text-foreground"
            />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            <span>RIR</span>
            <RirSelect
              value={newDraft.rir}
              disabled={pendingAction != null}
              label={t('newRir', { number: nextSetNumber })}
              onChange={(rir) => setNewDraft((current) => ({ ...current, rir }))}
              className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
            />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            <span>{t('equipment')}</span>
            <select
              value={selectedEquipmentId ?? ''}
              disabled={pendingAction != null}
              onChange={(event) => setSelectedEquipmentId(event.target.value || null)}
              aria-label={t('equipment')}
              className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
            >
              <option value="">{t('noEquipment')}</option>
              {equipmentOptions.map((equipment) => (
                <option key={equipment.id} value={equipment.id}>
                  {equipment.name}
                </option>
              ))}
            </select>
          </label>
          <Button
            type="button"
            onClick={() => void addSet()}
            disabled={!validDraft(newDraft) || pendingAction != null}
            aria-label={t('addSet', { number: nextSetNumber })}
            className="h-10"
          >
            {pendingAction === 'add' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            <span className="ml-1">{t('add')}</span>
          </Button>
        </div>
      </div>

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
            <AlertDialogCancel disabled={pendingAction != null}>{common('actions.cancel')}</AlertDialogCancel>
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

function RirSelect({
  value,
  disabled,
  label,
  onChange,
  className = 'h-9 w-20 rounded-md border border-input bg-background px-2',
}: {
  value: number | null;
  disabled: boolean;
  label: string;
  onChange: (value: number | null) => void;
  className?: string;
}) {
  return (
    <select
      value={value ?? ''}
      disabled={disabled}
      aria-label={label}
      onChange={(event) => onChange(event.target.value === '' ? null : Number(event.target.value))}
      className={className}
    >
      <option value="">-</option>
      {[0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5].map((rir) => (
        <option key={rir} value={rir}>
          {rir}
        </option>
      ))}
    </select>
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

function draftsFromSets(sets: HistoricalStrengthSet[]): Record<string, DraftSet> {
  return Object.fromEntries(sets.map((set) => [set.id, valueFromSet(set)]));
}

function valueFromSet(set: HistoricalStrengthSet): DraftSet {
  return { weight: set.weight, reps: set.reps, rir: set.rir };
}

function draftFromLastSet(sets: HistoricalStrengthSet[]): DraftSet {
  const last = sets.at(-1);
  return last ? valueFromSet(last) : { weight: 0, reps: 10, rir: 2 };
}

function initialEquipmentId(
  sets: HistoricalStrengthSet[],
  options: HistoricalEquipmentOption[],
): string | null {
  const recent = sets.findLast((set) => options.some((option) => option.id === set.gymEquipmentId));
  if (recent?.gymEquipmentId) return recent.gymEquipmentId;
  return options.length === 1 ? options[0]!.id : null;
}

function validDraft(draft: DraftSet): boolean {
  return (
    Number.isFinite(draft.weight) &&
    draft.weight >= 0 &&
    draft.weight <= 500 &&
    Number.isInteger(draft.reps) &&
    draft.reps >= 1 &&
    draft.reps <= 100 &&
    (draft.rir == null || (draft.rir >= 0 && draft.rir <= 5 && Number.isInteger(draft.rir * 2)))
  );
}

function sameDraft(draft: DraftSet, set: HistoricalStrengthSet): boolean {
  return draft.weight === set.weight && draft.reps === set.reps && draft.rir === set.rir;
}

function displayWeight(weightKg: number, unit: WeightUnit): number {
  return roundWeight(toDisplayWeight(weightKg, unit), 2);
}
