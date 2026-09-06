'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronDown, ChevronUp, HelpCircle, Lightbulb, TrendingUp } from 'lucide-react';
import type { Exercise, ProgramExercise, WeightUnit } from '@/lib/prisma-client';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  suggestNextWeight,
  SORENESS_HOLD_AT_OR_ABOVE,
  type ReadinessSignal,
} from '@/lib/progression';
import { formatWeight } from '@/lib/units';
import type { SerializedLastPerformance } from './session-runner';
import { useExerciseName } from '@/components/shared/use-exercise-name';
import type { GymLoadConstraints } from '@/lib/gym-loads';
import { meaningfulProgramNote } from '@/lib/program-notes';

interface Props {
  programExercise: ProgramExercise & { exercise: Exercise };
  lastPerformance: SerializedLastPerformance | undefined;
  readiness: ReadinessSignal | null;
  // True while a planned deload week is active (issue #112).
  deloadActive: boolean;
  unit: WeightUnit;
  gymName?: string | null;
  loadConstraints?: GymLoadConstraints | null;
}

export function ExerciseCard({
  programExercise,
  lastPerformance,
  readiness,
  deloadActive,
  unit,
  gymName = null,
  loadConstraints = null,
}: Props) {
  const t = useTranslations('session.exerciseCard');
  const locale = useLocale();
  const exerciseName = useExerciseName();
  const [notesOpen, setNotesOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const exo = programExercise.exercise;
  const note = meaningfulProgramNote(programExercise.notes);
  // Cardio exercises (issue #133) are duration/distance based: the weight x
  // reps targets, load suggestion and last-performance load make no sense for
  // them, so those blocks are hidden.
  const isCardio = exo.category === 'CARDIO';

  const repsLabel =
    programExercise.targetRepsMin === programExercise.targetRepsMax
      ? `${programExercise.targetRepsMin}`
      : `${programExercise.targetRepsMin}-${programExercise.targetRepsMax}`;

  const suggestion = suggestNextWeight(
    programExercise,
    lastPerformance?.sets ?? [],
    readiness,
    deloadActive,
    loadConstraints,
  );
  const groupSoreness = readiness?.soreness?.[exo.muscleGroup];
  const sorenessHigh =
    typeof groupSoreness === 'number' && groupSoreness >= SORENESS_HOLD_AT_OR_ABOVE;
  const readinessNote =
    suggestion.reason === 'planned-deload'
      ? t('readiness.planned')
      : suggestion.reason === 'readiness-deload'
        ? t(sorenessHigh ? 'readiness.sorenessLighter' : 'readiness.readinessLighter')
        : suggestion.reason === 'readiness-hold'
          ? t(sorenessHigh ? 'readiness.sorenessHeld' : 'readiness.readinessHeld')
          : null;
  const working = formatWeight(suggestion.workingWeight ?? 0, unit, {
    decimals: 2,
    group: false,
    locale,
  });
  const suggestionHelp =
    suggestion.reason === 'progression'
      ? t('help.progression', {
          reps: suggestion.targetRepsMax ?? programExercise.targetRepsMax,
          weight: working,
          delta: formatWeight(suggestion.delta ?? 0, unit, {
            decimals: 2,
            group: false,
            locale,
          }),
        })
      : suggestion.reason === 'readiness-hold'
        ? t('help.readinessHold', { weight: working })
        : suggestion.reason === 'readiness-deload'
          ? t('help.readinessDeload', { weight: working })
          : suggestion.reason === 'planned-deload'
            ? t('help.plannedDeload', { weight: working })
            : t('help.hold', {
                reps: suggestion.targetRepsMax ?? programExercise.targetRepsMax,
              });

  return (
    <Card>
      <CardHeader className="min-w-0 pb-3">
        <div className="min-w-0 overflow-x-auto overscroll-x-contain pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <h2 className="w-max min-w-full whitespace-nowrap text-xl font-bold sm:text-2xl">
            {exerciseName(exo.name)}
          </h2>
        </div>
        {(gymName || loadConstraints?.isAvailable === false) && (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {gymName && <Badge variant="outline">{gymName}</Badge>}
            {loadConstraints?.isAvailable === false && (
              <Badge variant="destructive">{t('notAvailable')}</Badge>
            )}
          </div>
        )}
      </CardHeader>

      <CardContent className="flex flex-col gap-3 pt-0">
        <p className="text-sm font-medium">
          {isCardio ? (
            <>
              {t('cardioPrescription', {
                sets: programExercise.targetSets,
                seconds: programExercise.restSec,
              })}
            </>
          ) : (
            <>
              {t('strengthPrescription', {
                sets: programExercise.targetSets,
                reps: repsLabel,
                rir: programExercise.targetRIR,
                seconds: programExercise.restSec,
                tempo: programExercise.tempo ?? 'none',
              })}
            </>
          )}
        </p>

        {!isCardio && suggestion.weight != null && (
          <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
            <div className="flex items-center gap-2">
              {suggestion.reason === 'progression' ? (
                <TrendingUp className="size-4 text-primary" />
              ) : (
                <Lightbulb className="size-4 text-primary" />
              )}
              <span className="flex-1">
                {t('suggestion')}{' '}
                <span className="font-medium">
                  {suggestion.weight === 0
                    ? t('bodyweight')
                    : formatWeight(suggestion.weight, unit, {
                        decimals: 2,
                        group: false,
                        locale,
                      })}
                </span>
                {suggestion.reason === 'progression' && suggestion.delta && (
                  <span className="ml-1 text-xs text-primary">
                    (+
                    {formatWeight(suggestion.delta, unit, {
                      decimals: 2,
                      group: false,
                      locale,
                    })}
                    )
                  </span>
                )}
                {readinessNote && (
                  <Badge variant="secondary" className="ml-2 align-middle">
                    {readinessNote}
                  </Badge>
                )}
              </span>
              <button
                type="button"
                onClick={() => setHelpOpen((v) => !v)}
                aria-label={t('suggestionHelp')}
                aria-expanded={helpOpen}
                className="text-muted-foreground hover:text-foreground"
              >
                <HelpCircle className="size-4" />
              </button>
            </div>
            {helpOpen && (
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{suggestionHelp}</p>
            )}
          </div>
        )}

        {note && (
          <div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setNotesOpen((v) => !v)}
              className="-ml-2"
            >
              {notesOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
              <span className="ml-1">{t('notes')}</span>
            </Button>
            {notesOpen && (
              <div className="mt-2 space-y-2 rounded-md bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
                <p className="whitespace-pre-line">{note}</p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
