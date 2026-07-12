'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { Exercise, ProgramExercise } from '@/lib/prisma-client';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useExerciseName } from '@/components/shared/use-exercise-name';
import type { GymLoadConstraints } from '@/lib/gym-loads';

interface Props {
  programExercise: ProgramExercise & { exercise: Exercise };
  gymName?: string | null;
  loadConstraints?: GymLoadConstraints | null;
}

export function ExerciseCard({ programExercise, gymName = null, loadConstraints = null }: Props) {
  const t = useTranslations('session.exerciseCard');
  const exerciseName = useExerciseName();
  const [notesOpen, setNotesOpen] = useState(false);
  const exo = programExercise.exercise;
  const displayName = exerciseName(exo.name);
  const showContextBadges = gymName != null || loadConstraints?.isAvailable === false;

  return (
    <Card data-testid="exercise-card" className="min-w-0">
      <CardHeader className="min-w-0 pb-3">
        <div
          data-testid="exercise-title-scroll"
          className="max-w-full overflow-x-auto overscroll-x-contain pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <h2 className="w-max min-w-full whitespace-nowrap text-xl font-bold sm:text-2xl">
            {displayName}
          </h2>
        </div>

        {showContextBadges && (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {gymName && <Badge variant="outline">{gymName}</Badge>}
            {loadConstraints?.isAvailable === false && (
              <Badge variant="destructive">{t('notAvailable')}</Badge>
            )}
          </div>
        )}
      </CardHeader>

      {programExercise.notes && (
        <CardContent className="pt-0">
          <div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setNotesOpen((open) => !open)}
              className="-ml-2"
            >
              {notesOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
              <span className="ml-1">{t('notes')}</span>
            </Button>
            {notesOpen && (
              <div className="mt-2 rounded-md bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
                <p className="whitespace-pre-line">{programExercise.notes}</p>
              </div>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
