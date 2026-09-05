'use client';

import { useMemo, useState } from 'react';
import { Star } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { EquipmentType } from '@/lib/prisma-client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export interface ExerciseEquipmentEditorGym {
  id: string;
  name: string;
  equipment: Array<{
    id: string;
    name: string;
    equipmentType: EquipmentType;
    linked: boolean;
  }>;
  preferredEquipmentId: string | null;
}

export function ExerciseEquipmentEditor({
  exerciseId,
  exerciseEquipmentType,
  gyms,
}: {
  exerciseId: string;
  exerciseEquipmentType: EquipmentType;
  gyms: ExerciseEquipmentEditorGym[];
}) {
  const t = useTranslations('exercises.detail');
  const router = useRouter();
  const [draft, setDraft] = useState(() =>
    Object.fromEntries(
      gyms.map((gym) => [
        gym.id,
        {
          equipmentIds: gym.equipment.filter((item) => item.linked).map((item) => item.id),
          preferredEquipmentId: gym.preferredEquipmentId,
        },
      ]),
    ),
  );
  const [saving, setSaving] = useState(false);

  const hasEquipment = useMemo(() => gyms.some((gym) => gym.equipment.length > 0), [gyms]);

  function compatible(type: EquipmentType) {
    return exerciseEquipmentType === 'OTHER' || type === 'OTHER' || type === exerciseEquipmentType;
  }

  function toggle(gymId: string, equipmentId: string, checked: boolean) {
    setDraft((current) => {
      const gym = current[gymId] ?? { equipmentIds: [], preferredEquipmentId: null };
      const nextIds = checked
        ? [...new Set([...gym.equipmentIds, equipmentId])]
        : gym.equipmentIds.filter((id) => id !== equipmentId);
      return {
        ...current,
        [gymId]: {
          equipmentIds: nextIds,
          preferredEquipmentId:
            gym.preferredEquipmentId && nextIds.includes(gym.preferredEquipmentId)
              ? gym.preferredEquipmentId
              : null,
        },
      };
    });
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/exercises/${exerciseId}/equipment`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gyms: gyms.map((gym) => ({
            gymId: gym.id,
            equipmentIds: draft[gym.id]?.equipmentIds ?? [],
            preferredEquipmentId: draft[gym.id]?.preferredEquipmentId ?? null,
          })),
        }),
      });
      if (!response.ok) throw new Error(`Request failed with ${response.status}`);
      toast.success(t('equipmentSaved'));
      router.refresh();
    } catch {
      toast.error(t('equipmentSaveError'));
    } finally {
      setSaving(false);
    }
  }

  if (gyms.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('noGyms')}</p>;
  }

  return (
    <section className="space-y-4">
      {!hasEquipment && <p className="text-sm text-muted-foreground">{t('noPhysicalEquipment')}</p>}
      {gyms.map((gym) => {
        const state = draft[gym.id] ?? { equipmentIds: [], preferredEquipmentId: null };
        return (
          <div key={gym.id} className="rounded-md border border-border p-3">
            <h3 className="font-medium">{gym.name}</h3>
            <div className="mt-3 space-y-2">
              {gym.equipment.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('gymHasNoEquipment')}</p>
              ) : (
                gym.equipment.map((item) => {
                  const isCompatible = compatible(item.equipmentType);
                  const checked = state.equipmentIds.includes(item.id);
                  const preferred = state.preferredEquipmentId === item.id;
                  return (
                    <div key={item.id} className="flex flex-wrap items-center gap-3 rounded-md border border-border/60 px-3 py-2">
                      <label className="flex min-w-0 flex-1 items-center gap-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!isCompatible || saving}
                          onChange={(event) => toggle(gym.id, item.id, event.target.checked)}
                          aria-label={t('linkEquipmentAria', { equipment: item.name, gym: gym.name })}
                        />
                        <span className="truncate text-sm">{item.name}</span>
                        {!isCompatible && <Badge variant="outline">{t('incompatible')}</Badge>}
                      </label>
                      <Button
                        type="button"
                        size="sm"
                        variant={preferred ? 'default' : 'outline'}
                        disabled={!checked || !isCompatible || saving}
                        onClick={() =>
                          setDraft((current) => ({
                            ...current,
                            [gym.id]: {
                              equipmentIds: current[gym.id]?.equipmentIds ?? [],
                              preferredEquipmentId: preferred ? null : item.id,
                            },
                          }))
                        }
                        aria-label={t('preferredEquipmentAria', { equipment: item.name, gym: gym.name })}
                      >
                        <Star className={preferred ? 'size-4 fill-current' : 'size-4'} />
                        <span className="ml-1">{preferred ? t('preferred') : t('makePreferred')}</span>
                      </Button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
      <div className="flex justify-end">
        <Button type="button" onClick={() => void save()} disabled={saving}>
          {saving ? t('savingEquipment') : t('saveEquipment')}
        </Button>
      </div>
    </section>
  );
}
