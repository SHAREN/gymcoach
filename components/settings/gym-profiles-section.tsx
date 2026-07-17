'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Building2, Check, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Gym, GymExerciseConfig, GymInventoryMode } from '@/lib/prisma-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { GymInventoryManager } from '@/components/settings/gym-inventory-manager';

type GymWithConfigs = Gym & { exerciseConfigs: GymExerciseConfig[] };

interface Props {
  initialGyms: GymWithConfigs[];
  activeGymId: string | null;
}

interface Draft {
  id: string | null;
  name: string;
  inventoryMode: GymInventoryMode;
  dumbbellWeights: number[];
  plateWeights: number[];
  barWeights: number[];
  configs: Map<
    string,
    {
      isAvailable: boolean;
      weightOptions: number[];
      dumbbellWeights: number[];
      plateWeights: number[];
      barWeights: number[];
    }
  >;
}

export function GymProfilesSection({ initialGyms, activeGymId: initialActive }: Props) {
  const t = useTranslations('settings.gyms');
  const common = useTranslations('common');
  const router = useRouter();
  const [gyms, setGyms] = useState(initialGyms);
  const [activeGymId, setActiveGymId] = useState(initialActive);
  const [selectedId, setSelectedId] = useState(initialActive ?? initialGyms[0]?.id ?? 'new');
  const [draft, setDraft] = useState<Draft>(() =>
    draftFromGym(initialGyms.find((g) => g.id === selectedId)),
  );
  const [saving, setSaving] = useState(false);

  function selectGym(id: string) {
    setSelectedId(id);
    setDraft(draftFromGym(gyms.find((gym) => gym.id === id)));
  }

  async function save() {
    if (!draft.name.trim() || saving) return;
    setSaving(true);
    try {
      const body = {
        name: draft.name.trim(),
        inventoryMode: draft.inventoryMode,
        ...(draft.id
          ? {}
          : {
              dumbbellWeights: draft.dumbbellWeights,
              plateWeights: draft.plateWeights,
              barWeights: draft.barWeights,
            }),
        exerciseConfigs: [...draft.configs.entries()].flatMap(([exerciseId, config]) =>
          !config.isAvailable ||
          config.weightOptions.length > 0 ||
          config.dumbbellWeights.length > 0 ||
          config.plateWeights.length > 0 ||
          config.barWeights.length > 0
            ? [{ exerciseId, ...config }]
            : [],
        ),
        ...(draft.id ? {} : { makeActive: true }),
      };
      const res = await fetch(draft.id ? `/api/gyms/${draft.id}` : '/api/gyms', {
        method: draft.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      const saved = (await res.json()) as GymWithConfigs;
      setGyms((current) => [...current.filter((gym) => gym.id !== saved.id), saved].sort(byName));
      setSelectedId(saved.id);
      setDraft(draftFromGym(saved));
      if (!draft.id) setActiveGymId(saved.id);
      toast.success(t('saved'));
      router.refresh();
    } catch {
      toast.error(t('saveError'));
    } finally {
      setSaving(false);
    }
  }

  async function activate() {
    if (!draft.id || draft.id === activeGymId) return;
    const res = await fetch(`/api/gyms/${draft.id}/activate`, { method: 'POST' });
    if (!res.ok) {
      toast.error(t('activateError'));
      return;
    }
    setActiveGymId(draft.id);
    toast.success(t('activated'));
    router.refresh();
  }

  async function remove() {
    if (!draft.id) return;
    const deletedId = draft.id;
    const res = await fetch(`/api/gyms/${deletedId}`, { method: 'DELETE' });
    if (!res.ok) {
      toast.error(t('deleteError'));
      return;
    }
    const remaining = gyms.filter((gym) => gym.id !== deletedId);
    const next = remaining[0];
    setGyms(remaining);
    setActiveGymId(activeGymId === deletedId ? (next?.id ?? null) : activeGymId);
    setSelectedId(next?.id ?? 'new');
    setDraft(draftFromGym(next));
    toast.success(t('deleted'));
    router.refresh();
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Building2 className="size-4" />
          {t('title')}
        </h2>
        <p className="text-xs text-muted-foreground">{t('description')}</p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <Label>{t('savedGyms')}</Label>
            <Select value={selectedId} onValueChange={selectGym}>
              <SelectTrigger>
                <SelectValue placeholder={t('newGym')} />
              </SelectTrigger>
              <SelectContent>
                {gyms.map((gym) => (
                  <SelectItem key={gym.id} value={gym.id}>
                    {gym.name}
                    {gym.id === activeGymId ? ` (${t('active')})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => selectGym('new')}
            title={t('newGym')}
          >
            <Plus className="size-4" />
          </Button>
        </div>

        <div className="space-y-1">
          <Label htmlFor="gym-name">{t('name')}</Label>
          <Input
            id="gym-name"
            value={draft.name}
            onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
            placeholder={t('namePlaceholder')}
          />
        </div>

        {draft.id && (
          <GymInventoryManager
            key={draft.id}
            gymId={draft.id}
            onModeChanged={(inventoryMode) => {
              setDraft((current) => ({ ...current, inventoryMode }));
              setGyms((current) =>
                current.map((gym) => (gym.id === draft.id ? { ...gym, inventoryMode } : gym)),
              );
            }}
          />
        )}

        <div className="flex flex-wrap justify-between gap-2">
          <div>
            {draft.id && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" variant="outline" className="text-destructive">
                    <Trash2 className="size-4" />
                    <span className="ml-2">{common('actions.delete')}</span>
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t('deleteTitle')}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t('deleteDescription', { name: draft.name })}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{common('actions.cancel')}</AlertDialogCancel>
                    <AlertDialogAction onClick={remove}>
                      {common('actions.delete')}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
          <div className="flex gap-2">
            {draft.id && draft.id !== activeGymId && (
              <Button type="button" variant="outline" onClick={activate}>
                <Check className="size-4" />
                <span className="ml-2">{t('makeActive')}</span>
              </Button>
            )}
            <Button type="button" onClick={save} disabled={!draft.name.trim() || saving}>
              <Save className="size-4" />
              <span className="ml-2">
                {saving ? common('actions.saving') : common('actions.save')}
              </span>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function draftFromGym(gym?: GymWithConfigs): Draft {
  return {
    id: gym?.id ?? null,
    name: gym?.name ?? '',
    inventoryMode: gym?.inventoryMode ?? 'EQUIPMENT_FIRST',
    dumbbellWeights: gym?.dumbbellWeights ?? [],
    plateWeights: gym?.plateWeights ?? [],
    barWeights: gym?.barWeights ?? [],
    configs: new Map(
      gym?.exerciseConfigs.map((config) => [
        config.exerciseId,
        {
          isAvailable: config.isAvailable,
          weightOptions: config.weightOptions,
          dumbbellWeights: config.dumbbellWeights,
          plateWeights: config.plateWeights,
          barWeights: config.barWeights,
        },
      ]) ?? [],
    ),
  };
}

function byName(a: GymWithConfigs, b: GymWithConfigs) {
  return a.name.localeCompare(b.name);
}
