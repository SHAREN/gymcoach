'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Building2, Plus, Search } from 'lucide-react';
import type { EquipmentType, Exercise, MuscleGroup } from '@/lib/prisma-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ExerciseFormDialog } from '@/components/exercises/exercise-form-dialog';
import type { ExerciseEquipmentChoice } from '@/lib/gym-inventory-types';
import { ExerciseMediaDialog } from '@/components/exercises/exercise-media-dialog';
import { ExerciseFilters } from '@/components/exercises/exercise-filters';
import { ExerciseTrainingDays } from '@/components/exercises/exercise-training-days';
import { useExerciseTrainingDays } from '@/components/exercises/use-exercise-training-days';
import { useExerciseName } from '@/components/shared/use-exercise-name';
import { muscleGroupMessageKeys } from '@/i18n/enum-keys';
import { filterExercises } from '@/lib/exercise-filters';
import type { TrainingDatesByExercise } from '@/lib/exercise-training-days';

interface ExercisesViewProps {
  exercises: Exercise[];
  gyms: Array<{
    id: string;
    name: string;
    exerciseConfigs: Array<{ exerciseId: string; isAvailable: boolean }>;
  }>;
  activeGymId: string | null;
  trainingDatesByExercise?: TrainingDatesByExercise;
  equipmentChoices?: ExerciseEquipmentChoice[];
}

const ALL_GYMS = 'all';

export function ExercisesView({
  exercises,
  gyms,
  activeGymId,
  trainingDatesByExercise = {},
  equipmentChoices = [],
}: ExercisesViewProps) {
  const t = useTranslations('exercises');
  const common = useTranslations('common');
  const exerciseName = useExerciseName();
  const [createOpen, setCreateOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedMuscleGroup, setSelectedMuscleGroup] = useState<MuscleGroup | null>(null);
  const [selectedEquipmentType, setSelectedEquipmentType] = useState<EquipmentType | null>(null);
  const [selectedGymId, setSelectedGymId] = useState(() =>
    activeGymId && gyms.some((gym) => gym.id === activeGymId) ? activeGymId : ALL_GYMS,
  );

  const selectedGym = gyms.find((gym) => gym.id === selectedGymId);

  // Gym availability follows the same rule as session load constraints and
  // program generation: an exercise is available unless that gym explicitly
  // marks it unavailable. Name, muscle and equipment filters then compose
  // locally without changing the selected gym.
  const filtered = useMemo(() => {
    const unavailableIds = new Set(
      selectedGym?.exerciseConfigs
        .filter((config) => !config.isAvailable)
        .map((config) => config.exerciseId) ?? [],
    );
    return filterExercises(
      exercises,
      {
        query,
        muscleGroup: selectedMuscleGroup,
        equipmentType: selectedEquipmentType,
        unavailableExerciseIds: unavailableIds,
      },
      exerciseName,
    );
  }, [exerciseName, exercises, query, selectedEquipmentType, selectedGym, selectedMuscleGroup]);

  const grouped = useMemo(() => groupByMuscle(filtered), [filtered]);
  const trainedDaysByExercise = useExerciseTrainingDays(trainingDatesByExercise);
  const hasNameOrExerciseFilter =
    query.trim().length > 0 || selectedMuscleGroup !== null || selectedEquipmentType !== null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('savedCount', { count: exercises.length })}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="min-h-tap">
          <Plus className="size-4" />
          <span className="ml-2">{common('actions.add')}</span>
        </Button>
      </div>

      {exercises.length > 0 && (
        <div className="space-y-3">
          {gyms.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="exercise-gym-filter" className="flex items-center gap-2">
                <Building2 className="size-4" />
                {t('gymFilter')}
              </Label>
              <Select value={selectedGymId} onValueChange={setSelectedGymId}>
                <SelectTrigger id="exercise-gym-filter" aria-label={t('gymFilter')}>
                  <SelectValue>{selectedGym?.name ?? t('allGyms')}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_GYMS}>{t('allGyms')}</SelectItem>
                  {gyms.map((gym) => (
                    <SelectItem key={gym.id} value={gym.id}>
                      {gym.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <ExerciseFilters
            muscleGroup={selectedMuscleGroup}
            equipmentType={selectedEquipmentType}
            onMuscleGroupChange={setSelectedMuscleGroup}
            onEquipmentTypeChange={setSelectedEquipmentType}
            onReset={() => {
              setSelectedMuscleGroup(null);
              setSelectedEquipmentType(null);
            }}
          />
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('search')}
              aria-label={t('search')}
              className="pl-9"
            />
          </div>
        </div>
      )}

      {exercises.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('emptyTitle')}</CardTitle>
            <CardDescription>{t('emptyDescription')}</CardDescription>
          </CardHeader>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {hasNameOrExerciseFilter ? t('noMatchTitle') : t('noGymExercisesTitle')}
            </CardTitle>
            <CardDescription>
              {hasNameOrExerciseFilter
                ? t('noFilteredDescription')
                : t('noGymExercisesDescription', { gym: selectedGym?.name ?? '' })}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          {Object.entries(grouped).map(([group, list]) => (
            <section key={group} className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {t(`muscleGroups.${muscleGroupMessageKeys[group as MuscleGroup]}`)}
              </h2>
              <div className="flex flex-col gap-2">
                {list.map((ex) => (
                  <ExerciseRow
                    key={ex.id}
                    exercise={ex}
                    trainedDays={trainedDaysByExercise[ex.id] ?? 0}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <ExerciseFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
        activeGymId={activeGymId}
        equipmentChoices={equipmentChoices}
      />
    </div>
  );
}

function ExerciseRow({ exercise, trainedDays }: { exercise: Exercise; trainedDays: number }) {
  const exerciseName = useExerciseName();
  const displayName = exerciseName(exercise.name);

  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-3">
        <ExerciseMediaDialog
          exerciseName={exercise.name}
          displayName={displayName}
          equipmentType={exercise.equipmentType}
          compact
        />
        <Link
          href={`/exercises/${exercise.id}`}
          className="min-w-0 flex-1 rounded-sm py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <p className="truncate text-sm font-semibold">{displayName}</p>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <ExerciseTrainingDays count={trainedDays} />
          </p>
        </Link>
      </CardContent>
    </Card>
  );
}

function groupByMuscle(exercises: Exercise[]): Record<string, Exercise[]> {
  const out: Record<string, Exercise[]> = {};
  for (const ex of exercises) {
    if (!out[ex.muscleGroup]) out[ex.muscleGroup] = [];
    out[ex.muscleGroup]!.push(ex);
  }
  return out;
}
