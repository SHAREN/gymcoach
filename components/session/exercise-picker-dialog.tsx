'use client';

import Image from 'next/image';
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Dumbbell, Search } from 'lucide-react';
import type { EquipmentType, Exercise, MuscleGroup } from '@/lib/prisma-client';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ExerciseFilters } from '@/components/exercises/exercise-filters';
import { filterExercises } from '@/lib/exercise-filters';
import { orderFreeExerciseChoices } from '@/lib/free-session-exercise-order';
import { getExerciseMedia } from '@/lib/exercise-media';
import { useExerciseName } from '@/components/shared/use-exercise-name';

export type ExercisePickerChoice = Exercise & { sessionCount: number };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  catalog: ExercisePickerChoice[];
  existingExerciseIds?: string[];
  busyId?: string | null;
  onSelect: (exercise: ExercisePickerChoice) => void | Promise<void>;
}

export function ExercisePickerDialog({
  open,
  onOpenChange,
  catalog,
  existingExerciseIds = [],
  busyId = null,
  onSelect,
}: Props) {
  const t = useTranslations('session.free');
  const exerciseName = useExerciseName();
  const [query, setQuery] = useState('');
  const [muscleGroup, setMuscleGroup] = useState<MuscleGroup | null>(null);
  const [equipmentType, setEquipmentType] = useState<EquipmentType | null>(null);
  const existing = useMemo(() => new Set(existingExerciseIds), [existingExerciseIds]);

  const choices = useMemo(() => {
    const available = catalog.filter((exercise) => !existing.has(exercise.id));
    const filtered = filterExercises(
      available,
      { query, muscleGroup, equipmentType },
      exerciseName,
    ) as ExercisePickerChoice[];
    return orderFreeExerciseChoices(filtered);
  }, [catalog, equipmentType, exerciseName, existing, muscleGroup, query]);

  function handleOpenChange(nextOpen: boolean) {
    onOpenChange(nextOpen);
    if (!nextOpen) setQuery('');
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('chooseExercise')}</DialogTitle>
          <DialogDescription className="sr-only">
            {t('chooseExerciseDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <ExerciseFilters
            muscleGroup={muscleGroup}
            equipmentType={equipmentType}
            onMuscleGroupChange={setMuscleGroup}
            onEquipmentTypeChange={setEquipmentType}
            onReset={() => {
              setMuscleGroup(null);
              setEquipmentType(null);
            }}
          />
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('searchExercises')}
              className="pl-9"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          {choices.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('noChoices')}</p>
          ) : (
            choices.map((exercise) => {
              const media = getExerciseMedia(exercise.name);
              return (
                <Button
                  key={exercise.id}
                  type="button"
                  variant="ghost"
                  disabled={busyId !== null}
                  onClick={() => void onSelect(exercise)}
                  className="h-auto min-h-14 justify-between gap-3 px-3 py-2 text-left"
                >
                  <span className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted">
                      {media ? (
                        <Image
                          src={media.frames[0]}
                          alt=""
                          fill
                          unoptimized
                          sizes="44px"
                          className="object-cover"
                        />
                      ) : (
                        <Dumbbell className="size-5 text-muted-foreground" aria-hidden />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 whitespace-normal font-medium">
                      {exerciseName(exercise.name)}
                    </span>
                  </span>
                  {exercise.sessionCount > 0 && (
                    <span className="shrink-0 text-xs font-normal text-muted-foreground">
                      {t('sessionCount', { count: exercise.sessionCount })}
                    </span>
                  )}
                </Button>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
