'use client';

import { useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { Exercise } from '@/lib/prisma-client';
import { useExerciseName } from '@/components/shared/use-exercise-name';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

interface Props {
  sessionId: string;
  catalog: Exercise[];
  selectedExerciseIds: string[];
  onAdded: (exerciseId: string) => void;
}

export function FreeSessionExercisePicker({
  sessionId,
  catalog,
  selectedExerciseIds,
  onAdded,
}: Props) {
  const t = useTranslations('session.freeform');
  const exerciseName = useExerciseName();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const selected = useMemo(() => new Set(selectedExerciseIds), [selectedExerciseIds]);
  const choices = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return catalog
      .filter((exercise) => !selected.has(exercise.id))
      .filter((exercise) => {
        if (!needle) return true;
        return (
          exercise.name.toLocaleLowerCase().includes(needle) ||
          exerciseName(exercise.name).toLocaleLowerCase().includes(needle)
        );
      });
  }, [catalog, exerciseName, query, selected]);

  async function addExercise(exerciseId: string) {
    setBusyId(exerciseId);
    try {
      const res = await fetch('/api/sessions/' + encodeURIComponent(sessionId) + '/exercises', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exerciseId }),
      });
      if (!res.ok) throw new Error('add failed');
      setOpen(false);
      setQuery('');
      onAdded(exerciseId);
    } catch {
      toast.error(t('addError'));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="min-h-tap">
          <Plus className="size-4" />
          <span className="ml-2">{t('addExercise')}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogTitle>{t('addExercise')}</DialogTitle>
        <DialogDescription>{t('addDescription')}</DialogDescription>
        <div className="relative">
          <Search
            className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('search')}
            className="pl-9"
            aria-label={t('search')}
          />
        </div>
        <div className="flex flex-col gap-1">
          {choices.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">{t('noChoices')}</p>
          ) : (
            choices.map((exercise) => (
              <Button
                key={exercise.id}
                type="button"
                variant="ghost"
                className="justify-start"
                disabled={busyId != null}
                onClick={() => void addExercise(exercise.id)}
              >
                {exerciseName(exercise.name)}
              </Button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
