'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Dumbbell, Save } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useExerciseName } from '@/components/shared/use-exercise-name';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { EquipmentType } from '@/lib/prisma-client';

type ExerciseOption = {
  id: string;
  name: string;
  equipmentType: EquipmentType;
};

type PlateView = { id: string; weightKg: number; quantity: number | null };
type BarView = {
  id: string;
  baseLoadKg: number;
  loadingSides: number;
  systemBarbellFamily: 'LARGE' | 'SMALL';
};
type FamilyView = {
  family: 'LARGE' | 'SMALL';
  loadingSides: number;
  pool: {
    id: string;
    name: string;
    compatibilityKey: string;
    plates: PlateView[];
  };
  bars: BarView[];
};
type ProfilesView = {
  dumbbells: {
    weightsKg: number[];
    exerciseLinks: Array<{ id: string }>;
  };
  barbell: {
    exerciseLinks: Array<{ id: string }>;
    families: [FamilyView, FamilyView];
  };
};

type FamilyDraft = {
  family: 'LARGE' | 'SMALL';
  bars: string;
  plates: string;
  loadingSides: string;
};

export function PermanentFreeWeightProfiles({
  gymId,
  exercises,
}: {
  gymId: string;
  exercises: ExerciseOption[];
}) {
  const t = useTranslations('settings.gyms.systemProfiles');
  const common = useTranslations('common');
  const exerciseName = useExerciseName();
  const router = useRouter();
  const [profiles, setProfiles] = useState<ProfilesView | null>(null);
  const [dumbbellWeights, setDumbbellWeights] = useState('');
  const [dumbbellExerciseIds, setDumbbellExerciseIds] = useState<Set<string>>(new Set());
  const [barbellExerciseIds, setBarbellExerciseIds] = useState<Set<string>>(new Set());
  const [families, setFamilies] = useState<FamilyDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<'DUMBBELLS' | 'BARBELL' | null>(null);

  const dumbbellExercises = useMemo(
    () => exercises.filter((exercise) => exercise.equipmentType === 'DUMBBELL'),
    [exercises],
  );
  const barbellExercises = useMemo(
    () => exercises.filter((exercise) => exercise.equipmentType === 'BARBELL'),
    [exercises],
  );

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/gyms/${gymId}/system-profiles`)
      .then(async (response) => {
        if (!response.ok) throw new Error('load');
        return (await response.json()) as ProfilesView;
      })
      .then((next) => {
        if (!alive) return;
        applyProfiles(next);
      })
      .catch(() => alive && toast.error(t('loadError')))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [gymId, t]);

  function applyProfiles(next: ProfilesView) {
    setProfiles(next);
    setDumbbellWeights(next.dumbbells.weightsKg.join(', '));
    setDumbbellExerciseIds(new Set(next.dumbbells.exerciseLinks.map((exercise) => exercise.id)));
    setBarbellExerciseIds(new Set(next.barbell.exerciseLinks.map((exercise) => exercise.id)));
    setFamilies(
      next.barbell.families.map((family) => ({
        family: family.family,
        bars: family.bars.map((bar) => bar.baseLoadKg).join(', '),
        plates: family.pool.plates
          .map((plate) => `${plate.weightKg}x${plate.quantity == null ? '?' : plate.quantity}`)
          .join(', '),
        loadingSides: String(family.loadingSides),
      })),
    );
  }

  async function saveDumbbells() {
    if (saving) return;
    setSaving('DUMBBELLS');
    try {
      const response = await fetch(`/api/gyms/${gymId}/system-profiles/dumbbells`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          weightsKg: parseWeightList(dumbbellWeights),
          exerciseIds: [...dumbbellExerciseIds],
        }),
      });
      if (!response.ok) throw new Error('save');
      applyProfiles((await response.json()) as ProfilesView);
      toast.success(t('saved'));
      router.refresh();
    } catch {
      toast.error(t('saveError'));
    } finally {
      setSaving(null);
    }
  }

  async function saveBarbell() {
    if (saving || !profiles) return;
    setSaving('BARBELL');
    try {
      const familyByName = new Map(profiles.barbell.families.map((family) => [family.family, family]));
      const bodyFamilies = families.map((draft) => {
        const current = familyByName.get(draft.family);
        const existingBarIds = new Map(
          (current?.bars ?? []).map((bar) => [round(bar.baseLoadKg), bar.id] as const),
        );
        return {
          family: draft.family,
          loadingSides: Number(draft.loadingSides),
          bars: parseWeightList(draft.bars).map((weightKg) => ({
            ...(existingBarIds.get(round(weightKg))
              ? { equipmentId: existingBarIds.get(round(weightKg)) }
              : {}),
            weightKg,
          })),
          plates: parsePlateList(draft.plates),
        };
      });
      const response = await fetch(`/api/gyms/${gymId}/system-profiles/barbell`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exerciseIds: [...barbellExerciseIds],
          families: bodyFamilies,
        }),
      });
      if (!response.ok) throw new Error('save');
      applyProfiles((await response.json()) as ProfilesView);
      toast.success(t('saved'));
      router.refresh();
    } catch {
      toast.error(t('saveError'));
    } finally {
      setSaving(null);
    }
  }

  if (loading) {
    return <p className="text-xs text-muted-foreground">{t('loading')}</p>;
  }
  if (!profiles) return null;

  return (
    <div className="space-y-4 border-t pt-4">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Dumbbell className="size-4" /> {t('title')}
        </h3>
        <p className="text-xs text-muted-foreground">{t('description')}</p>
      </div>

      <section className="space-y-3 rounded-md border p-3" data-testid="system-profile-dumbbells">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold">{t('dumbbells.title')}</p>
              <Badge variant="secondary">{t('systemBadge')}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">{t('dumbbells.help')}</p>
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`system-dumbbells-${gymId}`}>{t('dumbbells.weights')}</Label>
          <Input
            id={`system-dumbbells-${gymId}`}
            value={dumbbellWeights}
            onChange={(event) => setDumbbellWeights(event.target.value)}
            inputMode="decimal"
            placeholder="10, 12, 14, 16, 20"
          />
        </div>
        <ExerciseSupportList
          title={t('supportedExercises')}
          exercises={dumbbellExercises}
          selected={dumbbellExerciseIds}
          onChange={setDumbbellExerciseIds}
          exerciseName={exerciseName}
        />
        <Button type="button" onClick={() => void saveDumbbells()} disabled={saving != null}>
          <Save className="mr-2 size-4" />
          {saving === 'DUMBBELLS' ? common('actions.saving') : common('actions.save')}
        </Button>
      </section>

      <section className="space-y-3 rounded-md border p-3" data-testid="system-profile-barbell">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold">{t('barbell.title')}</p>
          <Badge variant="secondary">{t('systemBadge')}</Badge>
        </div>
        <p className="text-xs text-muted-foreground">{t('barbell.help')}</p>
        {families.map((family) => (
          <div key={family.family} className="space-y-3 rounded-md bg-muted/30 p-3">
            <div>
              <p className="text-sm font-medium">{t(`families.${family.family}.title`)}</p>
              <p className="text-xs text-muted-foreground">
                {t(`families.${family.family}.description`)}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1 sm:col-span-1">
                <Label>{t('barbell.bars')}</Label>
                <Input
                  value={family.bars}
                  onChange={(event) =>
                    updateFamily(family.family, { bars: event.target.value })
                  }
                  inputMode="decimal"
                  placeholder="20, 15"
                />
              </div>
              <div className="space-y-1 sm:col-span-1">
                <Label>{t('barbell.plates')}</Label>
                <Input
                  value={family.plates}
                  onChange={(event) =>
                    updateFamily(family.family, { plates: event.target.value })
                  }
                  placeholder="20x4, 10x4, 5x?"
                />
                <p className="text-[11px] text-muted-foreground">{t('barbell.platesHelp')}</p>
              </div>
              <div className="space-y-1">
                <Label>{t('barbell.loadingSides')}</Label>
                <Input
                  type="number"
                  min={1}
                  max={8}
                  value={family.loadingSides}
                  onChange={(event) =>
                    updateFamily(family.family, { loadingSides: event.target.value })
                  }
                />
              </div>
            </div>
          </div>
        ))}
        <ExerciseSupportList
          title={t('supportedExercises')}
          exercises={barbellExercises}
          selected={barbellExerciseIds}
          onChange={setBarbellExerciseIds}
          exerciseName={exerciseName}
        />
        <Button type="button" onClick={() => void saveBarbell()} disabled={saving != null}>
          <Save className="mr-2 size-4" />
          {saving === 'BARBELL' ? common('actions.saving') : common('actions.save')}
        </Button>
      </section>
    </div>
  );

  function updateFamily(family: 'LARGE' | 'SMALL', patch: Partial<FamilyDraft>) {
    setFamilies((current) =>
      current.map((item) => (item.family === family ? { ...item, ...patch } : item)),
    );
  }
}

function ExerciseSupportList({
  title,
  exercises,
  selected,
  onChange,
  exerciseName,
}: {
  title: string;
  exercises: ExerciseOption[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  exerciseName: (name: string) => string;
}) {
  return (
    <div className="space-y-2">
      <Label>{title}</Label>
      {exercises.length === 0 ? (
        <p className="text-xs text-muted-foreground">-</p>
      ) : (
        <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
          {exercises.map((exercise) => (
            <label key={exercise.id} className="flex items-center justify-between gap-3 rounded-md border p-2">
              <span className="truncate text-sm">{exerciseName(exercise.name)}</span>
              <Switch
                checked={selected.has(exercise.id)}
                onCheckedChange={(checked) => {
                  const next = new Set(selected);
                  if (checked) next.add(exercise.id);
                  else next.delete(exercise.id);
                  onChange(next);
                }}
              />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function parseWeightList(raw: string) {
  return [...new Set(raw.split(/[;,]/).map(parseDecimal).filter((value): value is number => value != null && value > 0).map(round))].sort(
    (a, b) => a - b,
  );
}

function parsePlateList(raw: string) {
  const byWeight = new Map<number, { weightKg: number; quantity: number | null }>();
  for (const token of raw.split(/[;,]/)) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    const match = /^([0-9]+(?:[.,][0-9]+)?)\s*(?:x|×)\s*(\?|[0-9]+)$/i.exec(trimmed);
    if (!match) throw new Error('Invalid plate list');
    const weightKg = parseDecimal(match[1]);
    if (weightKg == null || weightKg <= 0) throw new Error('Invalid plate weight');
    const quantity = match[2] === '?' ? null : Number(match[2]);
    if (quantity != null && (!Number.isInteger(quantity) || quantity < 0)) {
      throw new Error('Invalid plate quantity');
    }
    byWeight.set(round(weightKg), { weightKg: round(weightKg), quantity });
  }
  return [...byWeight.values()].sort((a, b) => a.weightKg - b.weightKg);
}

function parseDecimal(raw: string | undefined) {
  if (raw == null) return null;
  const value = Number(raw.trim().replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
