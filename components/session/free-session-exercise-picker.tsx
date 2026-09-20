'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
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
import { useExerciseName } from '@/components/shared/use-exercise-name';

export type FreeExerciseChoice = Exercise & { sessionCount: number };

interface Props {
  sessionId: string;
  catalog: FreeExerciseChoice[];
  existingExerciseIds: string[];
  buttonLabel?: string;
  buttonClassName?: string;
}

export function FreeSessionExercisePicker({
  sessionId,
  catalog,
  existingExerciseIds,
  buttonLabel,
  buttonClassName,
}: Props) {
  const t = useTranslations('session.free');
  const exerciseName = useExerciseName();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [muscleGroup, setMuscleGroup] = useState<MuscleGroup | null>(null);
  const [equipmentType, setEquipmentType] = useState<EquipmentType | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const existing = useMemo(() => new Set(existingExerciseIds), [existingExerciseIds]);
  const choices = useMemo(() => {
    const available = catalog.filter((exercise) => !existing.has(exercise.id));
    const filtered = filterExercises(
      available,
      { query, muscleGroup, equipmentType },
      exerciseName,
    ) as FreeExerciseChoice[];
    return orderFreeExerciseChoices(filtered);
  }, [catalog, equipmentType, exerciseName, existing, muscleGroup, query]);

  async function addExercise(exerciseId: string) {
    if (busyId) return;
    setBusyId(exerciseId);
    try {
      const response = await fetch(
        '/api/sessions/' + encodeURIComponent(sessionId) + '/exercises',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ exerciseId }),
        },
      );
      if (!response.ok) throw new Error('add failed');
      const created = (await response.json()) as { exerciseId: string };
      setOpen(false);
      setQuery('');
      router.replace(
        '/session/' + sessionId + '?programExerciseId=' + encodeURIComponent(created.exerciseId),
      );
      router.refresh();
    } catch {
      toast.error(t('addError'));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className={buttonClassName}
        onClick={() => setOpen(true)}
      >
        <Plus className="size-4" />
        <span className="ml-2">{buttonLabel ?? t('addExercise')}</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('chooseExercise')}</DialogTitle>
            <DialogDescription>{t('chooseExerciseDescription')}</DialogDescription>
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
              choices.map((exercise) => (
                <Button
                  key={exercise.id}
                  type="button"
                  variant="ghost"
                  disabled={busyId !== null}
                  onClick={() => void addExercise(exercise.id)}
                  className="h-auto min-h-tap justify-between gap-3 px-3 py-2 text-left"
                >
                  <span className="min-w-0 flex-1 whitespace-normal">
                    {exerciseName(exercise.name)}
                  </span>
                  {exercise.sessionCount > 0 && (
                    <span className="shrink-0 text-xs font-normal text-muted-foreground">
                      {t('sessionCount', { count: exercise.sessionCount })}
                    </span>
                  )}
                </Button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
