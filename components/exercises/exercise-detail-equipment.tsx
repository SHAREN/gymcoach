'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Dumbbell, Pencil, Star } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Exercise } from '@/lib/prisma-client';
import type { ExerciseEquipmentChoice } from '@/lib/gym-inventory-types';
import { ExerciseFormDialog } from '@/components/exercises/exercise-form-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface Props {
  exercise: Exercise;
  gyms: Array<{ id: string; name: string }>;
  activeGymId: string | null;
  equipmentChoices: ExerciseEquipmentChoice[];
}

export function ExerciseDetailEquipment({ exercise, gyms, activeGymId, equipmentChoices }: Props) {
  const t = useTranslations('exercises');
  const detailT = useTranslations('exercises.detail');
  const [editOpen, setEditOpen] = useState(false);
  const activeGym = gyms.find((gym) => gym.id === activeGymId) ?? null;
  const activeEquipment = activeGym
    ? equipmentChoices.filter(
        (item) => item.gymId === activeGym.id && item.exerciseIds.includes(exercise.id),
      )
    : [];
  const preferred = activeEquipment.find((item) =>
    item.preferredExerciseIds?.includes(exercise.id),
  );
  const orderedEquipment = preferred
    ? [preferred, ...activeEquipment.filter((item) => item.id !== preferred.id)]
    : activeEquipment;

  return (
    <section className="space-y-3 border-t border-border pt-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Dumbbell className="size-4" />
          {detailT('activeGymEquipment')}
        </h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-tap"
          onClick={() => setEditOpen(true)}
        >
          <Pencil className="size-4" />
          <span className="ml-2">{detailT('edit')}</span>
        </Button>
      </div>

      {!activeGym ? (
        <EmptyState message={detailT('noActiveGym')} action={detailT('openGymSettings')} />
      ) : orderedEquipment.length === 0 ? (
        <EmptyState
          message={detailT('noEquipment', { gym: activeGym.name })}
          action={detailT('openGymSettings')}
        />
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {activeGym.name} · {detailT('compatibleEquipment')}
          </p>
          {orderedEquipment.map((item) => (
            <div key={item.id} className="rounded-md border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{item.name}</p>
                {item.id === preferred?.id && (
                  <Badge className="gap-1">
                    <Star className="size-3 fill-current" />
                    {t('preferred')}
                  </Badge>
                )}
              </div>
              {item.loadType === 'PLATE_LOADED' && (
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>{detailT('baseLoad', { weight: item.baseLoadKg ?? 0 })}</span>
                  <span>{detailT('loadingSides', { count: item.loadingSides ?? 2 })}</span>
                  {item.platePoolName && (
                    <span>{detailT('platePool', { name: item.platePoolName })}</span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <ExerciseFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        mode="edit"
        exercise={exercise}
        activeGymId={activeGymId}
        equipmentChoices={equipmentChoices}
      />
    </section>
  );
}

function EmptyState({ message, action }: { message: string; action: string }) {
  return (
    <div className="rounded-md border border-dashed p-3">
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button asChild variant="link" className="mt-1 h-auto p-0">
        <Link href="/settings">{action}</Link>
      </Button>
    </div>
  );
}
