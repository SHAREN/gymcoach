'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link2, MoreHorizontal, Pencil, Plus, Trash2, Unlink } from 'lucide-react';
import { toast } from 'sonner';
import type { Exercise, ProgramExercise } from '@/lib/prisma-client';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ProgramExerciseFormDialog } from '@/components/programs/program-exercise-form-dialog';
import { useExerciseName } from '@/components/shared/use-exercise-name';

type SessionProgramExercise = ProgramExercise & { exercise: Exercise };

interface Props {
  programExercise: SessionProgramExercise;
  programExercises: SessionProgramExercise[];
  catalog: Exercise[];
  loggedSetCount: number;
}

export function SessionExerciseActions({
  programExercise,
  programExercises,
  catalog,
  loggedSetCount,
}: Props) {
  const t = useTranslations('session.exerciseActions');
  const exerciseName = useExerciseName();
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [supersetOpen, setSupersetOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const index = programExercises.findIndex((item) => item.id === programExercise.id);
  const neighbors = [programExercises[index - 1], programExercises[index + 1]].filter(
    (item): item is SessionProgramExercise => Boolean(item),
  );
  const usedExerciseIds = useMemo(
    () => new Set(programExercises.map((item) => item.exerciseId)),
    [programExercises],
  );
  const addCatalog = catalog.filter((exercise) => !usedExerciseIds.has(exercise.id));
  const replaceCatalog =
    loggedSetCount > 0
      ? [programExercise.exercise]
      : catalog.filter(
          (exercise) => exercise.muscleGroup === programExercise.exercise.muscleGroup,
        );
  const removeDisabled = loggedSetCount > 0 || programExercises.length <= 1;

  async function mutateSuperset(input: { action: 'dissolve' } | { action: 'link'; neighborId: string }) {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/program-exercises/${programExercise.id}/superset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!response.ok) throw new Error('superset update failed');
      toast.success(input.action === 'dissolve' ? t('supersetDissolved') : t('supersetLinked'));
      setSupersetOpen(false);
      router.refresh();
    } catch {
      toast.error(t('saveError'));
    } finally {
      setBusy(false);
    }
  }

  async function removeExercise() {
    if (busy || removeDisabled) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/program-exercises/${programExercise.id}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('remove failed');
      toast.success(t('removed'));
      setRemoveOpen(false);
      router.refresh();
    } catch {
      toast.error(t('saveError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="gap-2" aria-label={t('open')}>
            <MoreHorizontal className="size-4" />
            {t('actions')}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          <DropdownMenuItem onSelect={() => setEditOpen(true)}>
            <Pencil />
            {t('edit')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setAddOpen(true)} disabled={addCatalog.length === 0}>
            <Plus />
            {t('add')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setSupersetOpen(true)} disabled={neighbors.length === 0}>
            <Link2 />
            {t('superset')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => setRemoveOpen(true)}
            disabled={removeDisabled}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 />
            {t('remove')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ProgramExerciseFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        mode="edit"
        programExercise={programExercise}
        catalog={replaceCatalog}
      />
      <ProgramExerciseFormDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        mode="create"
        workoutId={programExercise.workoutId}
        catalog={addCatalog}
      />

      <Dialog open={supersetOpen} onOpenChange={setSupersetOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('superset')}</DialogTitle>
            <DialogDescription>{t('supersetDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {programExercise.supersetGroup != null && (
              <Button
                type="button"
                variant="outline"
                className="w-full justify-start"
                onClick={() => void mutateSuperset({ action: 'dissolve' })}
                disabled={busy}
              >
                <Unlink className="mr-2 size-4" />
                {t('dissolve')}
              </Button>
            )}
            {neighbors.map((neighbor) => (
              <Button
                key={neighbor.id}
                type="button"
                variant="outline"
                className="w-full justify-start"
                onClick={() => void mutateSuperset({ action: 'link', neighborId: neighbor.id })}
                disabled={busy || neighbor.supersetGroup === programExercise.supersetGroup && programExercise.supersetGroup != null}
              >
                <Link2 className="mr-2 size-4" />
                {t('linkWith', { name: exerciseName(neighbor.exercise.name) })}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('removeTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('removeDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void removeExercise();
              }}
              disabled={busy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {busy ? t('removing') : t('remove')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
