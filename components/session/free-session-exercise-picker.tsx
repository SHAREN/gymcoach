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

export type FreeExerciseChoice = ExercisePickerChoice;

interface Props {
  sessionId: string;
  catalog: FreeExerciseChoice[];
  existingExerciseIds: string[];
  buttonLabel?: string;
  buttonClassName?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
}

export function FreeSessionExercisePicker({
  sessionId,
  catalog,
  existingExerciseIds,
  buttonLabel,
  buttonClassName,
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
}: Props) {
  const t = useTranslations('session.free');
  const router = useRouter();
  const [internalOpen, setInternalOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const open = controlledOpen ?? internalOpen;

  function setOpen(nextOpen: boolean) {
    if (onOpenChange) onOpenChange(nextOpen);
    else setInternalOpen(nextOpen);
  }

  async function addExercise(exercise: FreeExerciseChoice) {
    if (busyId) return;
    setBusyId(exercise.id);
    try {
      const response = await fetch(
        '/api/sessions/' + encodeURIComponent(sessionId) + '/exercises',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ exerciseId: exercise.id }),
        },
      );
      if (!response.ok) throw new Error('add failed');
      const created = (await response.json()) as { exerciseId: string };
      setOpen(false);
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
      {!hideTrigger && (
        <Button
          type="button"
          variant="outline"
          className={buttonClassName}
          onClick={() => setOpen(true)}
        >
          <Plus className="size-4" />
          <span className="ml-2">{buttonLabel ?? t('addExercise')}</span>
        </Button>
      )}
      <ExercisePickerDialog
        open={open}
        onOpenChange={setOpen}
        catalog={catalog}
        existingExerciseIds={existingExerciseIds}
        busyId={busyId}
        onSelect={addExercise}
      />
    </>
  );
}
