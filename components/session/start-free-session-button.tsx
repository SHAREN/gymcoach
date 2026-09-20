'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  ExercisePickerDialog,
  type ExercisePickerChoice,
} from '@/components/session/exercise-picker-dialog';

interface Props {
  className?: string;
  catalog: ExercisePickerChoice[];
}

export function StartFreeSessionButton({ className, catalog }: Props) {
  const t = useTranslations('session.free');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function startWithExercise(exercise: ExercisePickerChoice) {
    if (busyId) return;
    setBusyId(exercise.id);
    try {
      const response = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initialExerciseId: exercise.id }),
      });
      if (!response.ok) throw new Error('start failed');
      const session = (await response.json()) as { id: string };
      setOpen(false);
      router.push(
        '/session/' + session.id + '?programExerciseId=' + encodeURIComponent(exercise.id),
      );
      router.refresh();
    } catch {
      toast.error(t('startError'));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <Button type="button" variant="outline" className={className} onClick={() => setOpen(true)}>
        <Plus className="size-5" />
        <span className="ml-2">{t('start')}</span>
      </Button>
      <ExercisePickerDialog
        open={open}
        onOpenChange={setOpen}
        catalog={catalog}
        busyId={busyId}
        onSelect={startWithExercise}
      />
    </>
  );
}
