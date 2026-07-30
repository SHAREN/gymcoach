import { db } from '@/lib/db';
import {
  DELOAD_ACTIVITY_BASELINE_DAYS,
  DELOAD_ACTIVITY_RECENT_DAYS,
  type DeloadActivityInput,
} from '@/lib/deload';
import { aggregateTrainingLoad } from '@/lib/training-load-aggregation';

// Loads only completed, meaningful strength sessions. A started session with
// no finishedAt, a warm-up-only session, and cardio work cannot reset the
// recovery gap or inflate the recent-load comparison.
export async function loadDeloadActivity(
  userId: string,
  now: Date,
  plannedWeeklyFrequency: number | null | undefined,
): Promise<DeloadActivityInput> {
  const since = new Date(
    now.getTime() - (DELOAD_ACTIVITY_RECENT_DAYS + DELOAD_ACTIVITY_BASELINE_DAYS) * 86_400_000,
  );
  const sessions = await db.session.findMany({
    where: {
      userId,
      finishedAt: { not: null },
      startedAt: { gte: since, lt: now },
      sets: {
        some: {
          isWarmup: false,
          durationSec: null,
          reps: { gt: 0 },
        },
      },
    },
    select: {
      id: true,
      startedAt: true,
      sets: {
        where: {
          isWarmup: false,
          durationSec: null,
          reps: { gt: 0 },
        },
        select: {
          id: true,
          exerciseId: true,
          isWarmup: true,
          isDropSet: true,
          rir: true,
          exercise: { select: { muscleGroup: true, loadProfile: true } },
        },
      },
    },
  });

  const ageDays = (performedAt: Date) => (now.getTime() - performedAt.getTime()) / 86_400_000;
  const loadInputs = sessions.flatMap((session) =>
    session.sets.map((set) => ({
      performedAt: session.startedAt,
      input: {
        setId: set.id,
        exerciseId: set.exerciseId,
        legacyMuscleGroup: set.exercise.muscleGroup,
        loadProfile: set.exercise.loadProfile,
        isWarmup: set.isWarmup,
        isDropSet: set.isDropSet,
        rir: set.rir,
        historyReliability: set.rir == null ? ('UNKNOWN' as const) : ('RELIABLE' as const),
      },
    })),
  );
  const recentLoad = aggregateTrainingLoad(
    loadInputs
      .filter((row) => ageDays(row.performedAt) < DELOAD_ACTIVITY_RECENT_DAYS)
      .map((row) => row.input),
  );
  const baselineLoad = aggregateTrainingLoad(
    loadInputs
      .filter((row) => {
        const age = ageDays(row.performedAt);
        return (
          age >= DELOAD_ACTIVITY_RECENT_DAYS &&
          age < DELOAD_ACTIVITY_RECENT_DAYS + DELOAD_ACTIVITY_BASELINE_DAYS
        );
      })
      .map((row) => row.input),
  );

  return {
    now,
    plannedWeeklyFrequency,
    sessions: sessions.map((session) => ({
      sessionId: session.id,
      performedAt: session.startedAt,
      workingSetCount: session.sets.length,
    })),
    loadAccounting: {
      recent: compactAccounting(recentLoad),
      baseline: compactAccounting(baselineLoad),
    },
  };
}

function compactAccounting(accounting: ReturnType<typeof aggregateTrainingLoad>) {
  return {
    confidence: accounting.confidence,
    qualifyingSetCount: accounting.qualifyingSetCount,
    unknownSecondaryParticipationSetCount: accounting.unknownSecondaryParticipationSetCount,
    muscles: Object.fromEntries(
      Object.entries(accounting.muscles).map(([muscle, value]) => [
        muscle,
        { directSets: value.directSets, indirectSets: value.indirectSets },
      ]),
    ),
    movementPatterns: accounting.movementPatterns,
    fatigueTags: accounting.fatigueTags,
    jointStress: accounting.jointStress,
  };
}
