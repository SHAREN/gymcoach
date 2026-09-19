import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { db } from '@/lib/db';
import { requireSession } from '@/lib/auth';
import { getLastPerformances, type LastPerformance } from '@/lib/last-performance';
import { READINESS_RECENCY_HOURS, type ReadinessSignal } from '@/lib/progression';
import { isDeloadActive } from '@/lib/deload';
import { getReturnToTrainingRecommendations } from '@/lib/return-to-training-history';
import { SessionRunner, type SerializedLastPerformance } from '@/components/session/session-runner';
import { liveSessionGymInclude } from '@/lib/session-gym-selection';

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ programExerciseId?: string }>;
}

export default async function SessionRunPage(props: Props) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const auth = await requireSession();

  const session = await db.session.findFirst({
    where: { id: params.id, userId: auth.userId },
    include: {
      workout: {
        include: {
          program: { select: { id: true, name: true } },
          exercises: {
            orderBy: { order: 'asc' },
            include: { exercise: true },
          },
        },
      },
      sets: { orderBy: [{ exerciseId: 'asc' }, { setNumber: 'asc' }] },
      gym: { include: liveSessionGymInclude },
    },
  });

  if (!session) notFound();
  if (session.finishedAt) {
    redirect('/');
  }

  const freeform = session.workoutId == null && session.programId == null;
  if (!freeform && !session.workout) notFound();

  const t = await getTranslations('session');
  const catalog = freeform
    ? await db.exercise.findMany({
        where: { userId: auth.userId },
        orderBy: { name: 'asc' },
      })
    : [];
  const catalogById = new Map(catalog.map((exercise) => [exercise.id, exercise]));
  const freeProgramExercises = freeform
    ? session.freeExerciseIds.flatMap((exerciseId, index) => {
        const exercise = catalogById.get(exerciseId);
        return exercise
          ? [
              {
                id: `free-${exercise.id}`,
                workoutId: `free-${session.id}`,
                exerciseId: exercise.id,
                order: index,
                targetSets: 1,
                targetRepsMin: 8,
                targetRepsMax: 12,
                targetRIR: 2,
                restSec: exercise.defaultRestSec,
                tempo: null,
                notes: null,
                supersetGroup: null,
                autoregulationMode: 'PRESERVE_RIR' as const,
                fatigueRate: null,
                loadAdjustmentPct: null,
                exercise,
              },
            ]
          : [];
      })
    : [];

  const runnerWorkout = session.workout ?? {
    id: `free-${session.id}`,
    programId: '',
    name: t('freeform.title'),
    dayOfWeek: null,
    order: 0,
    program: null,
    exercises: freeProgramExercises,
  };

  const exerciseIds = runnerWorkout.exercises.map((pe) => pe.exerciseId);
  const userPromise = db.user.findUnique({
    where: { id: auth.userId },
    select: { unit: true, deloadUntil: true, bodyweight: true },
  });

  const [lastPerformances, user, latestCheckin, returnRecommendations] = await Promise.all([
    getLastPerformances(auth.userId, exerciseIds, session.id),
    userPromise,
    freeform
      ? Promise.resolve(null)
      : db.readinessCheckin.findFirst({
          where: { userId: auth.userId },
          orderBy: { createdAt: 'desc' },
        }),
    freeform
      ? Promise.resolve({})
      : userPromise.then((resolvedUser) =>
          getReturnToTrainingRecommendations({
            userId: auth.userId,
            programExercises: runnerWorkout.exercises,
            excludeSessionId: session.id,
            now: session.startedAt,
            bodyweight: resolvedUser?.bodyweight ?? null,
            gym: session.gym,
          }),
        ),
  ]);

  const lastPerfRecord: Record<string, SerializedLastPerformance> = {};
  for (const [key, value] of lastPerformances) {
    lastPerfRecord[key] = serializePerf(value);
  }

  const readiness = freeform ? null : buildReadinessSignal(latestCheckin);
  const deloadActive = freeform ? false : isDeloadActive(user?.deloadUntil ?? null, new Date());

  return (
    <SessionRunner
      session={{ ...session, workout: runnerWorkout }}
      lastPerformances={lastPerfRecord}
      returnRecommendations={returnRecommendations}
      readiness={readiness}
      deloadActive={deloadActive}
      unit={user?.unit ?? 'KG'}
      initialProgramExerciseId={searchParams.programExerciseId}
      freeform={freeform}
      catalog={catalog}
    />
  );
}

function buildReadinessSignal(
  checkin: {
    readiness: number;
    soreness: unknown;
    createdAt: Date;
  } | null,
): ReadinessSignal | null {
  if (!checkin) return null;
  const ageHours = (Date.now() - checkin.createdAt.getTime()) / (1000 * 60 * 60);
  if (ageHours > READINESS_RECENCY_HOURS) return null;

  let soreness: ReadinessSignal['soreness'] = null;
  if (
    checkin.soreness &&
    typeof checkin.soreness === 'object' &&
    !Array.isArray(checkin.soreness)
  ) {
    const entries = Object.entries(checkin.soreness as Record<string, unknown>).filter(
      ([, value]) => typeof value === 'number',
    ) as Array<[string, number]>;
    if (entries.length > 0) {
      soreness = Object.fromEntries(entries) as ReadinessSignal['soreness'];
    }
  }

  return { readiness: checkin.readiness, soreness, ageHours };
}

function serializePerf(performance: LastPerformance): SerializedLastPerformance {
  return {
    sessionStartedAt: performance.sessionStartedAt.toISOString(),
    sets: performance.sets,
    maxWeight: performance.maxWeight,
    repsAtMaxWeight: performance.repsAtMaxWeight,
    cardio: performance.cardio,
  };
}
