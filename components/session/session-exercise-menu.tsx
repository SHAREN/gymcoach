'use client';

import Image from 'next/image';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import {
  Check,
  ChevronLeft,
  CircleHelp,
  Droplets,
  Link2,
  ListRestart,
  Loader2,
  Plus,
  Repeat2,
  Replace,
  Search,
  StickyNote,
  Trash2,
  Unlink2,
} from 'lucide-react';
import { toast } from 'sonner';
import type { Exercise, MuscleGroup, ProgramExercise } from '@/lib/prisma-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useExerciseName } from '@/components/shared/use-exercise-name';
import { getExerciseMedia } from '@/lib/exercise-media';
import { meaningfulProgramNote } from '@/lib/program-notes';
import { targetDropSets } from '@/lib/planned-sets';
import { muscleGroupMessageKeys } from '@/i18n/enum-keys';

type SessionProgramExercise = ProgramExercise & { exercise: Exercise };

type View =
  | 'main'
  | 'sets'
  | 'reps'
  | 'dropSets'
  | 'superset'
  | 'note'
  | 'replace'
  | 'replaceConfirm'
  | 'add'
  | 'removeConfirm';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  programExercise: SessionProgramExercise;
  programExercises: SessionProgramExercise[];
  catalog: Exercise[];
  loggedSetCount: number;
  onChanged: (options?: { selectProgramExerciseId?: string }) => void;
  onOpenHelp: (exerciseId: string) => void;
}

function abbreviation(name: string): string {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return Array.from(words[0]!).slice(0, 3).join('').toUpperCase();
  return words
    .slice(0, 3)
    .map((word) => Array.from(word)[0] ?? '')
    .join('')
    .toUpperCase();
}

export function SessionExerciseMenu({
  open,
  onOpenChange,
  programExercise,
  programExercises,
  catalog,
  loggedSetCount,
  onChanged,
  onOpenHelp,
}: Props) {
  const t = useTranslations('session.exerciseMenu');
  const exerciseT = useTranslations('exercises');
  const exerciseName = useExerciseName();
  const [view, setView] = useState<View>('main');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [repsMinDraft, setRepsMinDraft] = useState(programExercise.targetRepsMin);
  const [repsMaxDraft, setRepsMaxDraft] = useState(programExercise.targetRepsMax);
  const [pendingReplacement, setPendingReplacement] = useState<Exercise | null>(null);

  const displayName = exerciseName(programExercise.exercise.name);
  const currentIndex = programExercises.findIndex((item) => item.id === programExercise.id);
  const previous = currentIndex > 0 ? (programExercises[currentIndex - 1] ?? null) : null;
  const next =
    currentIndex >= 0 && currentIndex + 1 < programExercises.length
      ? (programExercises[currentIndex + 1] ?? null)
      : null;
  const currentGroup = programExercise.supersetGroup;
  const groupMembers =
    currentGroup == null
      ? []
      : programExercises.filter((item) => item.supersetGroup === currentGroup);
  const inSuperset = groupMembers.length >= 2;

  const existingExerciseIds = useMemo(
    () => new Set(programExercises.map((item) => item.exerciseId)),
    [programExercises],
  );

  const pickerExercises = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const source =
      view === 'replace'
        ? catalog.filter(
            (exercise) =>
              exercise.muscleGroup === programExercise.exercise.muscleGroup &&
              exercise.id !== programExercise.exerciseId,
          )
        : catalog.filter((exercise) => !existingExerciseIds.has(exercise.id));

    if (!normalizedQuery) return source;
    return source.filter((exercise) => {
      const localized = exerciseName(exercise.name).toLocaleLowerCase();
      return (
        localized.includes(normalizedQuery) ||
        exercise.name.toLocaleLowerCase().includes(normalizedQuery)
      );
    });
  }, [
    catalog,
    exerciseName,
    existingExerciseIds,
    programExercise.exercise.muscleGroup,
    programExercise.exerciseId,
    query,
    view,
  ]);

  function close(openState: boolean) {
    if (busy && !openState) return;
    onOpenChange(openState);
    if (!openState) {
      setView('main');
      setQuery('');
      setPendingReplacement(null);
    }
  }

  function openView(nextView: View) {
    if (nextView === 'note') setNoteDraft(meaningfulProgramNote(programExercise.notes) ?? '');
    if (nextView === 'reps') {
      setRepsMinDraft(programExercise.targetRepsMin);
      setRepsMaxDraft(programExercise.targetRepsMax);
    }
    if (nextView === 'replace' || nextView === 'add') setQuery('');
    setView(nextView);
  }

  function updatePayload(patch: Partial<ProgramExercise>) {
    return {
      exerciseId: patch.exerciseId ?? programExercise.exerciseId,
      targetSets: patch.targetSets ?? programExercise.targetSets,
      targetDropSets: patch.targetDropSets ?? programExercise.targetDropSets,
      targetRepsMin: patch.targetRepsMin ?? programExercise.targetRepsMin,
      targetRepsMax: patch.targetRepsMax ?? programExercise.targetRepsMax,
      targetRIR: patch.targetRIR ?? programExercise.targetRIR,
      restSec: patch.restSec ?? programExercise.restSec,
      autoregulationMode: patch.autoregulationMode ?? programExercise.autoregulationMode,
      fatigueRate:
        patch.fatigueRate === undefined ? programExercise.fatigueRate : patch.fatigueRate,
      loadAdjustmentPct:
        patch.loadAdjustmentPct === undefined
          ? programExercise.loadAdjustmentPct
          : patch.loadAdjustmentPct,
      tempo: patch.tempo === undefined ? programExercise.tempo : patch.tempo,
      notes: patch.notes === undefined ? programExercise.notes : patch.notes,
      supersetGroup:
        patch.supersetGroup === undefined ? programExercise.supersetGroup : patch.supersetGroup,
    };
  }

  async function savePatch(patch: Partial<ProgramExercise>, successMessage = t('saved')) {
    setBusy(true);
    try {
      const response = await fetch(`/api/program-exercises/${programExercise.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatePayload(patch)),
      });
      if (!response.ok) throw new Error('update failed');
      toast.success(successMessage);
      setView('main');
      onChanged();
    } catch {
      toast.error(t('saveError'));
    } finally {
      setBusy(false);
    }
  }

  async function saveReps(min: number, max: number) {
    const normalizedMin = Math.max(1, Math.min(50, Math.round(min)));
    const normalizedMax = Math.max(normalizedMin, Math.min(50, Math.round(max)));
    await savePatch({ targetRepsMin: normalizedMin, targetRepsMax: normalizedMax });
  }

  async function mutateSuperset(action: 'link' | 'dissolve', neighborId?: string) {
    setBusy(true);
    try {
      const response = await fetch(`/api/program-exercises/${programExercise.id}/superset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'link' ? { action, neighborId } : { action }),
      });
      if (!response.ok) throw new Error('superset update failed');
      toast.success(action === 'dissolve' ? t('supersetDissolved') : t('supersetLinked'));
      setView('main');
      onChanged();
    } catch {
      toast.error(t('supersetError'));
    } finally {
      setBusy(false);
    }
  }

  async function replaceExercise(exercise: Exercise) {
    setBusy(true);
    try {
      const response = await fetch(`/api/program-exercises/${programExercise.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatePayload({ exerciseId: exercise.id })),
      });
      if (!response.ok) throw new Error('replace failed');
      toast.success(t('replaced'));
      onOpenChange(false);
      setView('main');
      setQuery('');
      onChanged();
    } catch {
      toast.error(t('replaceError'));
    } finally {
      setBusy(false);
    }
  }

  function requestReplacement(exercise: Exercise) {
    if (loggedSetCount > 0) {
      setPendingReplacement(exercise);
      setView('replaceConfirm');
      return;
    }
    void replaceExercise(exercise);
  }

  async function addExercise(exercise: Exercise) {
    setBusy(true);
    try {
      const response = await fetch(`/api/workouts/${programExercise.workoutId}/program-exercises`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exerciseId: exercise.id,
          targetSets: 4,
          targetDropSets: 0,
          targetRepsMin: 8,
          targetRepsMax: 12,
          targetRIR: 2,
          restSec: exercise.defaultRestSec,
        }),
      });
      if (!response.ok) throw new Error('add failed');
      const created = (await response.json()) as SessionProgramExercise;
      toast.success(t('added'));
      onOpenChange(false);
      setView('main');
      setQuery('');
      onChanged({ selectProgramExerciseId: created.id });
    } catch {
      toast.error(t('addError'));
    } finally {
      setBusy(false);
    }
  }

  async function removeExercise() {
    setBusy(true);
    try {
      const response = await fetch(`/api/program-exercises/${programExercise.id}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('remove failed');
      const fallback = next ?? previous;
      toast.success(t('removed'));
      onOpenChange(false);
      setView('main');
      setQuery('');
      onChanged({ selectProgramExerciseId: fallback?.id });
    } catch {
      toast.error(t('removeError'));
    } finally {
      setBusy(false);
    }
  }

  function openHelp() {
    close(false);
    onOpenHelp(programExercise.exerciseId);
  }

  const repsLabel =
    programExercise.targetRepsMin === programExercise.targetRepsMax
      ? t('repsValue', { count: programExercise.targetRepsMin })
      : t('repsRange', {
          min: programExercise.targetRepsMin,
          max: programExercise.targetRepsMax,
        });

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="bottom-0 left-0 top-auto max-h-[88vh] w-full max-w-none translate-x-0 translate-y-0 gap-3 overflow-y-auto rounded-t-lg border-x-0 border-b-0 p-4 sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:border">
        <DialogDescription className="sr-only">{t('actions')}</DialogDescription>
        {view === 'main' && (
          <>
            <DialogTitle className="pr-8 text-center text-base font-semibold text-primary">
              {displayName}
            </DialogTitle>

            <div className="grid grid-cols-2 gap-2">
              <MenuTile
                icon={<ListRestart className="size-5" />}
                label={t('setsValue', { count: programExercise.targetSets })}
                onClick={() => openView('sets')}
              />
              <MenuTile
                icon={<Repeat2 className="size-5" />}
                label={repsLabel}
                onClick={() => openView('reps')}
              />
            </div>

            <MenuSection>
              <MenuRow
                icon={<Droplets className="size-5" />}
                label={t('dropSets')}
                value={String(targetDropSets(programExercise))}
                onClick={() => openView('dropSets')}
              />
              <MenuRow
                icon={inSuperset ? <Unlink2 className="size-5" /> : <Link2 className="size-5" />}
                label={t('supersets')}
                value={inSuperset ? t('linked') : undefined}
                onClick={() => openView('superset')}
              />
            </MenuSection>

            <MenuSection>
              <MenuRow
                icon={<StickyNote className="size-5" />}
                label={meaningfulProgramNote(programExercise.notes) ? t('editNote') : t('addNote')}
                onClick={() => openView('note')}
              />
            </MenuSection>

            <MenuSection>
              <MenuRow
                icon={<Replace className="size-5" />}
                label={t('replace')}
                onClick={() => openView('replace')}
              />
              <MenuRow
                destructive
                icon={<Trash2 className="size-5" />}
                label={t('remove')}
                onClick={() => openView('removeConfirm')}
              />
            </MenuSection>

            <div className="flex flex-col items-start gap-1 pt-1">
              <Button variant="link" className="h-auto px-0 py-1" onClick={() => openView('add')}>
                <Plus className="mr-2 size-4" />
                {t('addExercises')}
              </Button>
              <Button variant="link" className="h-auto px-0 py-1" onClick={openHelp}>
                <CircleHelp className="mr-2 size-4" />
                {t('help')}
              </Button>
            </div>
          </>
        )}

        {view === 'sets' && (
          <ValuePicker
            title={t('sets')}
            values={Array.from({ length: 20 }, (_, index) => index + 1)}
            selected={programExercise.targetSets}
            format={(value) => t('setsValue', { count: value })}
            busy={busy}
            onBack={() => setView('main')}
            onSelect={(value) => void savePatch({ targetSets: value })}
          />
        )}

        {view === 'dropSets' && (
          <ValuePicker
            title={t('dropSets')}
            values={Array.from({ length: 11 }, (_, index) => index)}
            selected={targetDropSets(programExercise)}
            format={(value) => t('dropSetsValue', { count: value })}
            busy={busy}
            onBack={() => setView('main')}
            onSelect={(value) => void savePatch({ targetDropSets: value })}
          />
        )}

        {view === 'reps' && (
          <>
            <SheetHeader title={t('reps')} onBack={() => setView('main')} />
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">{t('repsMin')}</span>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={50}
                  value={repsMinDraft}
                  onChange={(event) => setRepsMinDraft(Number(event.target.value))}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">{t('repsMax')}</span>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={50}
                  value={repsMaxDraft}
                  onChange={(event) => setRepsMaxDraft(Number(event.target.value))}
                />
              </label>
            </div>
            <Button
              type="button"
              onClick={() => void saveReps(repsMinDraft, repsMaxDraft)}
              disabled={busy}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              <span className="ml-2">{t('save')}</span>
            </Button>
            <div className="grid grid-cols-4 gap-2 overflow-y-auto py-1 sm:grid-cols-5">
              {Array.from({ length: 30 }, (_, index) => index + 1).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => void saveReps(value, value)}
                  disabled={busy}
                  className={`h-14 rounded-md border text-lg font-semibold tabular-nums ${
                    programExercise.targetRepsMin === value &&
                    programExercise.targetRepsMax === value
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-muted/30'
                  }`}
                >
                  {value}
                </button>
              ))}
            </div>
          </>
        )}

        {view === 'superset' && (
          <>
            <SheetHeader title={t('supersets')} onBack={() => setView('main')} />
            <MenuSection>
              {inSuperset && (
                <MenuRow
                  icon={<Unlink2 className="size-5" />}
                  label={t('dissolveSuperset')}
                  onClick={() => void mutateSuperset('dissolve')}
                  disabled={busy}
                />
              )}
              {previous && (!inSuperset || previous.supersetGroup !== currentGroup) && (
                <MenuRow
                  icon={<Link2 className="size-5" />}
                  label={t(inSuperset ? 'combinePrevious' : 'linkPrevious', {
                    name: exerciseName(previous.exercise.name),
                  })}
                  onClick={() => void mutateSuperset('link', previous.id)}
                  disabled={busy}
                />
              )}
              {next && (!inSuperset || next.supersetGroup !== currentGroup) && (
                <MenuRow
                  icon={<Link2 className="size-5" />}
                  label={t(inSuperset ? 'combineNext' : 'linkNext', {
                    name: exerciseName(next.exercise.name),
                  })}
                  onClick={() => void mutateSuperset('link', next.id)}
                  disabled={busy}
                />
              )}
            </MenuSection>
            {!inSuperset && !previous && !next && (
              <p className="py-6 text-center text-sm text-muted-foreground">{t('noNeighbors')}</p>
            )}
          </>
        )}

        {view === 'note' && (
          <>
            <SheetHeader title={t('note')} onBack={() => setView('main')} />
            <Textarea
              autoFocus
              rows={6}
              maxLength={2000}
              value={noteDraft}
              onChange={(event) => setNoteDraft(event.target.value)}
              placeholder={t('notePlaceholder')}
            />
            <Button
              type="button"
              onClick={() => void savePatch({ notes: noteDraft.trim() || null })}
              disabled={busy}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              <span className="ml-2">{t('save')}</span>
            </Button>
          </>
        )}

        {(view === 'replace' || view === 'add') && (
          <>
            <SheetHeader
              title={view === 'replace' ? t('replace') : t('addExercises')}
              onBack={() => setView('main')}
            />
            {view === 'replace' && (
              <p className="text-sm text-muted-foreground">
                {exerciseT(
                  `muscleGroups.${muscleGroupMessageKeys[programExercise.exercise.muscleGroup as MuscleGroup]}`,
                )}
              </p>
            )}
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
            <div className="max-h-[58vh] space-y-2 overflow-y-auto overscroll-contain">
              {pickerExercises.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">{t('noExercises')}</p>
              ) : (
                pickerExercises.map((exercise) => (
                  <ExerciseChoice
                    key={exercise.id}
                    exercise={exercise}
                    displayName={exerciseName(exercise.name)}
                    muscleLabel={exerciseT(
                      `muscleGroups.${muscleGroupMessageKeys[exercise.muscleGroup]}`,
                    )}
                    disabled={busy}
                    onClick={() =>
                      view === 'replace' ? requestReplacement(exercise) : void addExercise(exercise)
                    }
                  />
                ))
              )}
            </div>
          </>
        )}

        {view === 'replaceConfirm' && pendingReplacement && (
          <>
            <SheetHeader title={t('replace')} onBack={() => setView('replace')} />
            <p className="text-sm text-muted-foreground">{t('replaceLoggedWarning')}</p>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setView('replace')}>
                {t('cancel')}
              </Button>
              <Button
                className="flex-1"
                onClick={() => void replaceExercise(pendingReplacement)}
                disabled={busy}
              >
                {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
                {t('replace')}
              </Button>
            </div>
          </>
        )}

        {view === 'removeConfirm' && (
          <>
            <SheetHeader title={t('remove')} onBack={() => setView('main')} />
            <p className="text-sm text-muted-foreground">
              {loggedSetCount > 0 ? t('removeLoggedWarning') : t('removeConfirm')}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setView('main')}>
                {t('cancel')}
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                onClick={() => void removeExercise()}
                disabled={busy}
              >
                {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
                {t('remove')}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MenuSection({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-border overflow-hidden rounded-md bg-muted/35">{children}</div>
  );
}

function MenuTile({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-16 items-center justify-center gap-2 rounded-md bg-muted/50 px-3 text-base font-semibold transition-colors hover:bg-muted"
    >
      <span className="text-muted-foreground">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function MenuRow({
  icon,
  label,
  value,
  onClick,
  destructive = false,
  disabled = false,
}: {
  icon: ReactNode;
  label: string;
  value?: string;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex min-h-14 w-full items-center gap-3 px-4 text-left text-base font-medium transition-colors hover:bg-muted disabled:opacity-50 ${
        destructive ? 'text-destructive' : ''
      }`}
    >
      <span className={destructive ? 'text-destructive' : 'text-muted-foreground'}>{icon}</span>
      <span className="min-w-0 flex-1">{label}</span>
      {value && <span className="text-sm font-normal text-muted-foreground">{value}</span>}
    </button>
  );
}

function SheetHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-2 pr-8">
      <Button type="button" variant="ghost" size="icon" onClick={onBack} aria-label={title}>
        <ChevronLeft className="size-5" />
      </Button>
      <DialogTitle className="text-base">{title}</DialogTitle>
    </div>
  );
}

function ValuePicker({
  title,
  values,
  selected,
  format,
  busy,
  onBack,
  onSelect,
}: {
  title: string;
  values: number[];
  selected: number;
  format: (value: number) => string;
  busy: boolean;
  onBack: () => void;
  onSelect: (value: number) => void;
}) {
  return (
    <>
      <SheetHeader title={title} onBack={onBack} />
      <div className="grid grid-cols-2 gap-2 overflow-y-auto py-1 sm:grid-cols-3">
        {values.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => onSelect(value)}
            disabled={busy}
            className={`h-16 rounded-md border px-2 text-base font-semibold ${
              selected === value
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-muted/30'
            }`}
          >
            {format(value)}
          </button>
        ))}
      </div>
    </>
  );
}

function ExerciseChoice({
  exercise,
  displayName,
  muscleLabel,
  disabled,
  onClick,
}: {
  exercise: Exercise;
  displayName: string;
  muscleLabel: string;
  disabled: boolean;
  onClick: () => void;
}) {
  const media = getExerciseMedia(exercise.name);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex min-h-16 w-full items-center gap-3 rounded-md border border-border p-2 text-left transition-colors hover:bg-muted disabled:opacity-50"
    >
      <span className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-xs font-semibold">
        {media ? (
          <Image
            src={media.frames[0]}
            alt=""
            fill
            unoptimized
            sizes="48px"
            className="object-cover"
          />
        ) : (
          abbreviation(displayName)
        )}
      </span>
      <span className="min-w-0">
        <span className="block truncate font-medium">{displayName}</span>
        <span className="block text-xs text-muted-foreground">{muscleLabel}</span>
      </span>
    </button>
  );
}
