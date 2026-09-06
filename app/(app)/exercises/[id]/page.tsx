import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft, History, TrendingUp } from 'lucide-react';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
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
import { safeSessionReturnTo } from '@/lib/session-navigation';
import { formatWeight } from '@/lib/units';
import { formatDistance, formatDuration } from '@/lib/cardio';

interface Props {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ returnTo?: string | string[] }>;
}

export default async function ExerciseDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const query = await searchParams;
  const backHref = safeSessionReturnTo(query?.returnTo);
  const auth = await requireSession();
  const locale = await getLocale();
  const t = await getTranslations('exercises');
  const detail = await getTranslations('exercises.detail');
  const format = await getFormatter();

  const [exercise, user, gyms] = await Promise.all([
    db.exercise.findFirst({
      where: { id, userId: auth.userId },
      include: {
        sets: {
          where: { isWarmup: false, session: { userId: auth.userId } },
          orderBy: { completedAt: 'desc' },
          take: 100,
          include: { session: { select: { id: true, startedAt: true } } },
        },
      },
    }),
    db.user.findUnique({ where: { id: auth.userId }, select: { unit: true } }),
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
  const unit = user?.unit ?? 'KG';
  const sessions = new Map<string, { id: string; startedAt: Date; sets: typeof exercise.sets }>();
  for (const set of exercise.sets) {
    const existing = sessions.get(set.session.id);
    if (existing) existing.sets.push(set);
    else
      sessions.set(set.session.id, {
        id: set.session.id,
        startedAt: set.session.startedAt,
        sets: [set],
      });
  }
  const recentSessions = [...sessions.values()]
    .sort((left, right) => right.startedAt.getTime() - left.startedAt.getTime())
    .slice(0, 12);

  return (
    <main className="flex-1 px-4 py-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        <Button asChild variant="ghost" size="sm" className="self-start">
          <Link href={backHref}>
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

        <section className="space-y-3 border-t border-border pt-5" data-testid="exercise-history">
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <History className="size-4" />
              {detail('history')}
            </h2>
            <Button asChild variant="outline" size="sm">
              <Link href={'/progress?exerciseId=' + exercise.id}>
                <TrendingUp className="size-4" />
                <span className="ml-2">{detail('openChart')}</span>
              </Link>
            </Button>
          </div>

          {recentSessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{detail('noHistory')}</p>
          ) : (
            <div className="divide-y divide-border overflow-hidden rounded-md border border-border">
              {recentSessions.map((session) => (
                <Link
                  key={session.id}
                  href={'/history/' + session.id}
                  className="block px-3 py-3 transition-colors hover:bg-muted/40"
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">
                      {format.dateTime(session.startedAt, {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </span>
                    <span className="text-xs text-muted-foreground">{detail('openSession')}</span>
                  </div>
                  {exercise.category === 'CARDIO' ? (
                    <div className="space-y-1 text-sm">
                      {session.sets
                        .slice()
                        .sort((left, right) => left.setNumber - right.setNumber)
                        .map((set, index) => (
                          <div key={set.id} className="flex justify-between gap-3">
                            <span className="text-muted-foreground">{index + 1}</span>
                            <span className="font-medium">
                              {set.durationSec != null ? formatDuration(set.durationSec) : '–'}
                              {set.distanceM != null && set.distanceM > 0
                                ? ' · ' + formatDistance(set.distanceM)
                                : ''}
                            </span>
                          </div>
                        ))}
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[22rem] table-fixed text-center text-xs tabular-nums">
                        <thead className="text-muted-foreground">
                          <tr>
                            <th className="w-8 py-1 font-medium">#</th>
                            <th className="py-1 font-medium">{unit}</th>
                            <th className="py-1 font-medium">{detail('reps')}</th>
                            <th className="py-1 font-medium">RIR</th>
                            <th className="py-1 font-medium">{detail('equipmentShort')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {session.sets
                            .slice()
                            .sort((left, right) => left.setNumber - right.setNumber)
                            .map((set, index) => (
                              <tr key={set.id} className="border-t border-border/60">
                                <td className="py-1.5 text-muted-foreground">{index + 1}</td>
                                <td className="py-1.5 font-medium">
                                  {formatWeight(set.weight, unit, {
                                    decimals: 2,
                                    group: false,
                                    locale,
                                  })}
                                </td>
                                <td className="py-1.5 font-medium">{set.reps}</td>
                                <td className="py-1.5 font-medium">{set.rir ?? '–'}</td>
                                <td className="truncate py-1.5 text-muted-foreground">
                                  {set.equipmentNameSnapshot ?? '–'}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Link>
              ))}
            </div>
          )}
        </section>

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
