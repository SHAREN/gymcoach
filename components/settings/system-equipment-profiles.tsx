'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Dumbbell, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useExerciseName } from '@/components/shared/use-exercise-name';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { resolveEquipmentType } from '@/lib/gym-loads';
import type {
  GymBarbellFamilyView,
  GymInventoryExercise,
  GymInventoryView,
} from '@/lib/gym-inventory-types';

interface Props {
  gymId: string;
  inventory: GymInventoryView;
  onSaved: () => Promise<void>;
}

type ProfileDialog = 'DUMBBELLS' | 'BARBELL' | null;

export function SystemEquipmentProfiles({ gymId, inventory, onSaved }: Props) {
  const t = useTranslations('settings.gyms.inventory.systemProfiles');
  const [dialog, setDialog] = useState<ProfileDialog>(null);
  const dumbbells = inventory.systemProfiles.dumbbells;
  const barbell = inventory.systemProfiles.barbell;

  return (
    <>
      <div className="grid gap-3 lg:grid-cols-2">
        <Card data-testid="system-profile-dumbbells">
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Dumbbell className="size-4" />
                  <p className="text-sm font-semibold">{t('dumbbells.title')}</p>
                  <Badge variant="secondary">{t('systemBadge')}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('dumbbells.summary', {
                    weights: dumbbells.weightsKg.length,
                    exercises: dumbbells.exerciseLinks.length,
                  })}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t('dumbbells.edit')}
                onClick={() => setDialog('DUMBBELLS')}
              >
                <Pencil className="size-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            <p className="text-xs text-muted-foreground">{t('dumbbells.help')}</p>
            <div className="flex flex-wrap gap-1.5">
              {dumbbells.weightsKg.map((weight) => (
                <Badge key={weight} variant="outline">
                  {weight} kg
                </Badge>
              ))}
              {dumbbells.weightsKg.length === 0 && (
                <span className="text-xs text-amber-600">{t('dumbbells.noWeights')}</span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card data-testid="system-profile-barbell">
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Dumbbell className="size-4" />
                  <p className="text-sm font-semibold">{t('barbell.title')}</p>
                  <Badge variant="secondary">{t('systemBadge')}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('barbell.summary', { exercises: barbell.exerciseLinks.length })}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t('barbell.edit')}
                onClick={() => setDialog('BARBELL')}
              >
                <Pencil className="size-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            {barbell.families.map((family) => (
              <div key={family.family} className="rounded-md border p-2">
                <p className="text-xs font-medium">{t(`families.${family.family}.title`)}</p>
                <p className="text-xs text-muted-foreground">
                  {t('barbell.familySummary', {
                    bars: family.bars.length,
                    plates: family.pool.plates.length,
                    sides: family.loadingSides,
                  })}
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {family.bars.map((bar) => (
                    <Badge key={bar.id} variant="outline">
                      {bar.baseLoadKg} kg
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <DumbbellsProfileDialog
        gymId={gymId}
        inventory={inventory}
        open={dialog === 'DUMBBELLS'}
        onOpenChange={(open) => !open && setDialog(null)}
        onSaved={async () => {
          setDialog(null);
          await onSaved();
        }}
      />
      <BarbellProfileDialog
        gymId={gymId}
        inventory={inventory}
        open={dialog === 'BARBELL'}
        onOpenChange={(open) => !open && setDialog(null)}
        onSaved={async () => {
          setDialog(null);
          await onSaved();
        }}
      />
    </>
  );
}

function DumbbellsProfileDialog({
  gymId,
  inventory,
  open,
  onOpenChange,
  onSaved,
}: {
  gymId: string;
  inventory: GymInventoryView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  const t = useTranslations('settings.gyms.inventory.systemProfiles');
  const common = useTranslations('common');
  const profile = inventory.systemProfiles.dumbbells;
  const [weights, setWeights] = useState('');
  const [exerciseIds, setExerciseIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setWeights(profile.weightsKg.join(', '));
    setExerciseIds(new Set(profile.exerciseLinks.map((exercise) => exercise.id)));
  }, [open, profile]);

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/gyms/${gymId}/system-profiles/dumbbells`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          weightsKg: parseWeightList(weights),
          exerciseIds: [...exerciseIds],
        }),
      });
      if (!response.ok) throw new Error('save');
      toast.success(t('saved'));
      await onSaved();
    } catch {
      toast.error(t('saveError'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('dumbbells.dialogTitle')}</DialogTitle>
          <DialogDescription>{t('dumbbells.dialogDescription')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="system-dumbbell-weights">{t('dumbbells.weights')}</Label>
            <Input
              id="system-dumbbell-weights"
              value={weights}
              onChange={(event) => setWeights(event.target.value)}
              inputMode="decimal"
              placeholder="10, 12, 14, 16, 20"
            />
            <p className="text-xs text-muted-foreground">{t('dumbbells.weightsHelp')}</p>
          </div>
          <ExerciseSupportPicker
            targetType="DUMBBELL"
            exercises={inventory.exerciseCoverage}
            selected={exerciseIds}
            onChange={setExerciseIds}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {common('actions.cancel')}
          </Button>
          <Button type="button" onClick={() => void save()} disabled={saving}>
            {saving ? common('actions.saving') : common('actions.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface BarDraft {
  key: number;
  equipmentId?: string;
  weight: string;
}

interface PlateDraft {
  key: number;
  weight: string;
  quantity: string;
}

interface FamilyDraft {
  family: 'LARGE' | 'SMALL';
  loadingSides: string;
  bars: BarDraft[];
  plates: PlateDraft[];
}

function BarbellProfileDialog({
  gymId,
  inventory,
  open,
  onOpenChange,
  onSaved,
}: {
  gymId: string;
  inventory: GymInventoryView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  const t = useTranslations('settings.gyms.inventory.systemProfiles');
  const common = useTranslations('common');
  const profile = inventory.systemProfiles.barbell;
  const [families, setFamilies] = useState<FamilyDraft[]>([]);
  const [exerciseIds, setExerciseIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFamilies(profile.families.map(familyDraft));
    setExerciseIds(new Set(profile.exerciseLinks.map((exercise) => exercise.id)));
  }, [open, profile]);

  function updateFamily(family: 'LARGE' | 'SMALL', update: (draft: FamilyDraft) => FamilyDraft) {
    setFamilies((current) =>
      current.map((draft) => (draft.family === family ? update(draft) : draft)),
    );
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/gyms/${gymId}/system-profiles/barbell`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exerciseIds: [...exerciseIds],
          families: families.map((family) => ({
            family: family.family,
            loadingSides: Number(family.loadingSides),
            bars: family.bars.flatMap((bar) => {
              const weightKg = parseDecimal(bar.weight);
              return weightKg == null || weightKg <= 0
                ? []
                : [{ equipmentId: bar.equipmentId, weightKg }];
            }),
            plates: family.plates.flatMap((plate) => {
              const weightKg = parseDecimal(plate.weight);
              if (weightKg == null || weightKg <= 0) return [];
              return [
                {
                  weightKg,
                  quantity: plate.quantity.trim() === '' ? null : Number(plate.quantity),
                },
              ];
            }),
          })),
        }),
      });
      if (!response.ok) throw new Error('save');
      toast.success(t('saved'));
      await onSaved();
    } catch {
      toast.error(t('saveError'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94dvh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('barbell.dialogTitle')}</DialogTitle>
          <DialogDescription>{t('barbell.dialogDescription')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {families.map((family) => (
            <div key={family.family} className="space-y-4 rounded-md border p-3">
              <div>
                <p className="text-sm font-semibold">{t(`families.${family.family}.title`)}</p>
                <p className="text-xs text-muted-foreground">
                  {t(`families.${family.family}.description`)}
                </p>
              </div>
              <div className="space-y-2">
                <Label>{t('barbell.barWeights')}</Label>
                {family.bars.map((bar) => (
                  <div key={bar.key} className="flex gap-2">
                    <Input
                      aria-label={t('barbell.barWeight')}
                      inputMode="decimal"
                      value={bar.weight}
                      onChange={(event) =>
                        updateFamily(family.family, (draft) => ({
                          ...draft,
                          bars: draft.bars.map((item) =>
                            item.key === bar.key ? { ...item, weight: event.target.value } : item,
                          ),
                        }))
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t('barbell.removeBar')}
                      onClick={() =>
                        updateFamily(family.family, (draft) => ({
                          ...draft,
                          bars: draft.bars.filter((item) => item.key !== bar.key),
                        }))
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() =>
                    updateFamily(family.family, (draft) => ({
                      ...draft,
                      bars: [...draft.bars, { key: nextKey(draft.bars), weight: '' }],
                    }))
                  }
                >
                  <Plus className="size-4" />
                  <span className="ml-2">{t('barbell.addBar')}</span>
                </Button>
              </div>
              <div className="space-y-1">
                <Label htmlFor={`system-loading-sides-${family.family}`}>
                  {t('barbell.loadingSides')}
                </Label>
                <Input
                  id={`system-loading-sides-${family.family}`}
                  type="number"
                  min={1}
                  max={8}
                  value={family.loadingSides}
                  onChange={(event) =>
                    updateFamily(family.family, (draft) => ({
                      ...draft,
                      loadingSides: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>{t('barbell.plates')}</Label>
                <div className="grid grid-cols-[1fr_1fr_2.75rem] gap-2 text-xs text-muted-foreground">
                  <span>{t('barbell.plateWeight')}</span>
                  <span>{t('barbell.plateQuantity')}</span>
                  <span />
                </div>
                {family.plates.map((plate) => (
                  <div key={plate.key} className="grid grid-cols-[1fr_1fr_2.75rem] gap-2">
                    <Input
                      aria-label={t('barbell.plateWeight')}
                      inputMode="decimal"
                      value={plate.weight}
                      onChange={(event) =>
                        updateFamily(family.family, (draft) => ({
                          ...draft,
                          plates: draft.plates.map((item) =>
                            item.key === plate.key ? { ...item, weight: event.target.value } : item,
                          ),
                        }))
                      }
                    />
                    <Input
                      aria-label={t('barbell.plateQuantity')}
                      inputMode="numeric"
                      value={plate.quantity}
                      placeholder={t('barbell.unknownQuantity')}
                      onChange={(event) =>
                        updateFamily(family.family, (draft) => ({
                          ...draft,
                          plates: draft.plates.map((item) =>
                            item.key === plate.key
                              ? { ...item, quantity: event.target.value }
                              : item,
                          ),
                        }))
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t('barbell.removePlate')}
                      onClick={() =>
                        updateFamily(family.family, (draft) => ({
                          ...draft,
                          plates: draft.plates.filter((item) => item.key !== plate.key),
                        }))
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() =>
                    updateFamily(family.family, (draft) => ({
                      ...draft,
                      plates: [
                        ...draft.plates,
                        { key: nextKey(draft.plates), weight: '', quantity: '' },
                      ],
                    }))
                  }
                >
                  <Plus className="size-4" />
                  <span className="ml-2">{t('barbell.addPlate')}</span>
                </Button>
              </div>
            </div>
          ))}
          <ExerciseSupportPicker
            targetType="BARBELL"
            exercises={inventory.exerciseCoverage}
            selected={exerciseIds}
            onChange={setExerciseIds}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {common('actions.cancel')}
          </Button>
          <Button
            type="button"
            onClick={() => void save()}
            disabled={saving || families.some((family) => family.bars.length === 0)}
          >
            {saving ? common('actions.saving') : common('actions.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExerciseSupportPicker({
  targetType,
  exercises,
  selected,
  onChange,
}: {
  targetType: 'DUMBBELL' | 'BARBELL';
  exercises: GymInventoryExercise[];
  selected: Set<string>;
  onChange: (selected: Set<string>) => void;
}) {
  const t = useTranslations('settings.gyms.inventory.systemProfiles.exercises');
  const exerciseName = useExerciseName();
  const [search, setSearch] = useState('');
  const matching = useMemo(
    () =>
      exercises.filter(
        (exercise) => resolveEquipmentType(exercise.equipmentType, exercise.name) === targetType,
      ),
    [exercises, targetType],
  );
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return matching;
    return matching.filter((exercise) =>
      exerciseName(exercise.name).toLocaleLowerCase().includes(query),
    );
  }, [exerciseName, matching, search]);

  return (
    <div className="space-y-2 border-t pt-4">
      <div>
        <p className="text-sm font-semibold">{t('title')}</p>
        <p className="text-xs text-muted-foreground">{t('description')}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onChange(new Set(matching.map((exercise) => exercise.id)))}
        >
          {t('addMatching')}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => onChange(new Set())}>
          {t('clear')}
        </Button>
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('search')}
          className="pl-9"
        />
      </div>
      <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
        {filtered.map((exercise) => (
          <div
            key={exercise.id}
            className="flex items-center justify-between gap-3 rounded-md border p-2"
          >
            <span className="truncate text-sm">{exerciseName(exercise.name)}</span>
            <Switch
              aria-label={t('supportedForExercise', {
                exercise: exerciseName(exercise.name),
              })}
              checked={selected.has(exercise.id)}
              onCheckedChange={(checked) => {
                const next = new Set(selected);
                if (checked) next.add(exercise.id);
                else next.delete(exercise.id);
                onChange(next);
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function familyDraft(family: GymBarbellFamilyView): FamilyDraft {
  return {
    family: family.family,
    loadingSides: String(family.loadingSides),
    bars: family.bars.map((bar, index) => ({
      key: index + 1,
      equipmentId: bar.id,
      weight: String(bar.baseLoadKg),
    })),
    plates: family.pool.plates.map((plate, index) => ({
      key: index + 1,
      weight: String(plate.weightKg),
      quantity: plate.quantity == null ? '' : String(plate.quantity),
    })),
  };
}

function nextKey(items: Array<{ key: number }>) {
  return Math.max(0, ...items.map((item) => item.key)) + 1;
}

function parseWeightList(raw: string) {
  return raw
    .split(/[;,]/)
    .map(parseDecimal)
    .filter((value): value is number => value != null && value > 0)
    .map((value) => Math.round(value * 100) / 100);
}

function parseDecimal(raw: string) {
  const parsed = Number(raw.trim().replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}
