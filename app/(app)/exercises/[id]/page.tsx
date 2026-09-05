import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { db } from '@/lib/db';
import { requireSession } from '@/lib/auth';
import { getExerciseDisplayName } from '@/i18n/exercise-names';
import {
  equipmentTypeMessageKeys,
  exerciseCategoryMessageKeys,
  muscleGroupMessageKeys,
} from '@/i18n/enum-keys';
import { ExerciseMediaDialog } from '@/components/exercises/exercise-media-dialog';
import { ExerciseEquipmentEditor } from '@/components/exercises/exercise-equipment-editor';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ExerciseDetailPage({ params }: Props) {
  const { id } = await params;
  const auth = await requireSession();
  const locale = await getLocale();
  const t = await getTranslations('exercises');
  const detail = await getTranslations('exercises.detail');

  const [exercise, gyms] = await Promise.all([
    db.exercise.findFirst({ where: { id, userId: auth.userId } }),
    db.gym.findMany({
      where: { userId: auth.userId },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        exerciseConfigs: {
          where: { exerciseId: id },
          select: { preferredEquipmentId: true },
        },
        equipment: {
          orderBy: { name: 'asc' },
          select: {
            id: true,
            name: true,
            equipmentType: true,
            exerciseLinks: { where: { exerciseId: id }, select: { exerciseId: true } },
          },
        },
      },
    }),
  ]);
  if (!exercise) notFound();

  const displayName = getExerciseDisplayName(exercise.name, locale);

  return (
    <main className="flex-1 px-4 py-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        <Button asChild variant="ghost" size="sm" className="self-start">
          <Link href="/exercises">
            <ChevronLeft className="size-4" />
            <span className="ml-1">{detail('back')}</span>
          </Link>
        </Button>

        <header className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold">{displayName}</h1>
              {displayName !== exercise.name && (
                <p className="text-sm text-muted-foreground">{exercise.name}</p>
              )}
            </div>
            <ExerciseMediaDialog
              exerciseName={exercise.name}
              displayName={displayName}
              equipmentType={exercise.equipmentType}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge>{t(`muscleGroups.${muscleGroupMessageKeys[exercise.muscleGroup]}`)}</Badge>
            <Badge variant="secondary">
              {t(`categories.${exerciseCategoryMessageKeys[exercise.category]}`)}
            </Badge>
            <Badge variant="outline">
              {t(`equipmentTypes.${equipmentTypeMessageKeys[exercise.equipmentType]}`)}
            </Badge>
          </div>
          {exercise.notes && (
            <p className="whitespace-pre-line text-sm text-muted-foreground">{exercise.notes}</p>
          )}
        </header>

        <Card>
          <CardHeader>
            <CardTitle>{detail('equipmentTitle')}</CardTitle>
            <p className="text-sm text-muted-foreground">{detail('equipmentDescription')}</p>
          </CardHeader>
          <CardContent>
            <ExerciseEquipmentEditor
              exerciseId={exercise.id}
              exerciseEquipmentType={exercise.equipmentType}
              gyms={gyms.map((gym) => ({
                id: gym.id,
                name: gym.name,
                preferredEquipmentId: gym.exerciseConfigs[0]?.preferredEquipmentId ?? null,
                equipment: gym.equipment.map((item) => ({
                  id: item.id,
                  name: item.name,
                  equipmentType: item.equipmentType,
                  linked: item.exerciseLinks.length > 0,
                })),
              }))}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
