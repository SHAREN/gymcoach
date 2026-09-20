import { notFound, redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { requireSession } from '@/lib/auth';
import {
  buildEquipmentPerformanceTargets,
  getLastPerformancesForEquipmentTargets,
  type LastPerformance,
} from '@/lib/last-performance';
import { READINESS_RECENCY_HOURS, type ReadinessSignal } from '@/lib/progression';
import { isDeloadActive } from '@/lib/deload';
import { getReturnToTrainingRecommendationsByEquipment } from '@/lib/return-to-training-history';
import { SessionRunner, type SerializedLastPerformance } from '@/components/session/session-runner';
import { liveSessionGymInclude } from '@/lib/session-gym-selection';
import { getExerciseCatalogWithUsage } from '@/lib/free-session-catalog';

interface Props {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ programExerciseId?: string | string[] }>;
}

export default async function SessionRunPage(props: Props) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const requestedProgramExerciseId =
    typeof searchParams?.programExerciseId === 'string' ? searchParams.programExerciseId : null;
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
      sessionExercises: {
        orderBy: { ordinal: 'asc' },
        include: { exercise: true },
      },
      sets: { orderBy: [{ exerciseId: 'asc' }, { setNumber: 'asc' }] },
      gym: { include: liveSessionGymInclude },
    },
  });

  if (!session) notFound();
  if (session.finishedAt) redirect('/');

  const isFreeSession = session.workout == null;
  const sessionExercises = session.workout
    ? session.workout.exercises
    : session.sessionExercises.map((item) => ({
        id: item.exerciseId,
        workoutId: '',
        exerciseId: item.exerciseId,
        order: item.ordinal,
        targetSets: item.targetSets ?? 4,
        targetRepsMin: item.targetRepsMin ?? 8,
        targetRepsMax: item.targetRepsMax ?? 12,
        targetRIR: item.targetRIR ?? 2,
        restSec: item.restSec ?? item.exercise.defaultRestSec,
        tempo: item.tempo,
        notes: item.notes,
        supersetGroup: item.supersetGroup,
        autoregulationMode: item.autoregulationMode ?? 'PRESERVE_RIR',
        fatigueRate: item.fatigueRate,
        loadAdjustmentPct: item.loadAdjustmentPct,
        exercise: item.exercise,
      }));

  const exerciseIds = sessionExercises.map((item) => item.exerciseId);
  const performanceTargets = buildEquipmentPerformanceTargets(exerciseIds, session.gym);
  const userPromise = db.user.findUnique({
    where: { id: auth.userId },
    select: { unit: true, deloadUntil: true, bodyweight: true },
  });

  const [lastPerformances, user, latestCheckin, returnRecommendations, exerciseCatalog] =
    await Promise.all([
      getLastPerformancesForEquipmentTargets(auth.userId, performanceTargets, session.id),
      userPromise,
      db.readinessCheckin.findFirst({
        where: { userId: auth.userId },
        orderBy: { createdAt: 'desc' },
      }),
      userPromise.then((resolvedUser) =>
        getReturnToTrainingRecommendationsByEquipment({
          userId: auth.userId,
          programExercises: sessionExercises,
          excludeSessionId: session.id,
          now: session.startedAt,
          bodyweight: resolvedUser?.bodyweight ?? null,
          gym: session.gym,
        }),
      ),
      getExerciseCatalogWithUsage(auth.userId),
    ]);

  const lastPerfRecord: Record<string, SerializedLastPerformance[]> = {};
  for (const performance of lastPerformances) {
    const exercisePerformances = lastPerfRecord[performance.exerciseId] ?? [];
    exercisePerformances.push(serializePerf(performance));
    lastPerfRecord[performance.exerciseId] = exercisePerformances;
  }

  const readiness = buildReadinessSignal(latestCheckin);
  const deloadActive = isDeloadActive(user?.deloadUntil ?? null, new Date());

  return (
    <SessionRunner
      key={session.id + ':' + sessionExercises.map((exercise) => exercise.id).join(',')}
      session={session}
      sessionExercises={sessionExercises}
      isFreeSession={isFreeSession}
      lastPerformances={lastPerfRecord}
      returnRecommendations={returnRecommendations}
      readiness={readiness}
      deloadActive={deloadActive}
      unit={user?.unit ?? 'KG'}
      initialProgramExerciseId={requestedProgramExerciseId}
      exerciseCatalog={exerciseCatalog}
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
    if (entries.length > 0) soreness = Object.fromEntries(entries) as ReadinessSignal['soreness'];
  }

  return { readiness: checkin.readiness, soreness, ageHours };
}

function serializePerf(p: LastPerformance): SerializedLastPerformance {
  return {
    sessionId: p.sessionId,
    sessionStartedAt: p.sessionStartedAt.toISOString(),
    gymEquipmentId: p.gymEquipmentId,
    equipmentName: p.equipmentName,
    sets: p.sets,
    maxWeight: p.maxWeight,
    repsAtMaxWeight: p.repsAtMaxWeight,
    cardio: p.cardio,
  };
}
