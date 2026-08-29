import { resolveMcpEntities } from '@/lib/mcp/entity-resolver';
import { getMcpWorkouts } from '@/lib/mcp/workout-query';

export interface AnalyzeWorkoutConflictsInput {
  dates: string[];
  sourceGym?: string;
  targetGym?: string;
}

export async function analyzeMcpWorkoutConflicts(
  userId: string,
  input: AnalyzeWorkoutConflictsInput,
) {
  const [sourceResolution, targetResolution, history] = await Promise.all([
    input.sourceGym ? resolveMcpEntities(userId, { gym: input.sourceGym }) : null,
    input.targetGym ? resolveMcpEntities(userId, { gym: input.targetGym }) : null,
    getMcpWorkouts(userId, { dates: input.dates, limit: 200 }),
  ]);
  const resolutionIssues = [sourceResolution, targetResolution]
    .flatMap((resolution) => resolution?.issues ?? []);
  if (resolutionIssues.length > 0 || history.status !== 'READY') {
    return {
      status: 'NEEDS_RESOLUTION' as const,
      issues: [...resolutionIssues, ...(('issues' in history ? history.issues : []) ?? [])],
      findings: [],
      workouts: history.workouts,
    };
  }

  const sourceGym = sourceResolution?.gym?.selected ?? null;
  const targetGym = targetResolution?.gym?.selected ?? null;
  const workouts = history.workouts;
  const findings: Array<{
    classification: string;
    confidence: number;
    sessionIds: string[];
    reason: string;
  }> = [];

  for (const workout of workouts) {
    if (workout.isStale) {
      findings.push({
        classification: workout.staleClassification,
        confidence: workout.staleClassification === 'STALE_MULTI_DAY_SESSION' ? 0.99 : 0.95,
        sessionIds: [workout.sessionId],
        reason: workout.staleReason ?? 'Server data-quality heuristic flagged this session.',
      });
    }
    for (const overlappingId of workout.overlappingSessionIds) {
      if (workout.sessionId < overlappingId) {
        findings.push({
          classification: 'OVERLAPPING_SESSION',
          confidence: 0.95,
          sessionIds: [workout.sessionId, overlappingId],
          reason: 'The stored session time intervals overlap.',
        });
      }
    }
  }

  for (let i = 0; i < workouts.length; i += 1) {
    const left = workouts[i]!;
    for (let j = i + 1; j < workouts.length; j += 1) {
      const right = workouts[j]!;
      const sameDate = left.startedAt.slice(0, 10) === right.startedAt.slice(0, 10);
      if (sameDate && left.gym?.id !== right.gym?.id) {
        findings.push({
          classification: 'SAME_DATE_OTHER_GYM',
          confidence: 1,
          sessionIds: [left.sessionId, right.sessionId],
          reason: `Both sessions start on ${left.startedAt.slice(0, 10)} but are assigned to different gyms.`,
        });
      }

      const comparison = compareWorkoutContent(left, right);
      if (comparison.exact) {
        findings.push({
          classification: 'EXACT_DUPLICATE',
          confidence: 1,
          sessionIds: [left.sessionId, right.sessionId],
          reason: 'Exercise/set facts are identical after ignoring session IDs and gym assignment.',
        });
      } else if (sameDate && comparison.similarity >= 0.8) {
        findings.push({
          classification: 'PROBABLE_DUPLICATE',
          confidence: Math.round(comparison.similarity * 100) / 100,
          sessionIds: [left.sessionId, right.sessionId],
          reason: `Same-date sessions share ${Math.round(comparison.similarity * 100)}% of normalized exercise/set facts.`,
        });
      }
    }
  }

  return {
    status: 'READY' as const,
    sourceGym,
    targetGym,
    dates: input.dates,
    findings: dedupeFindings(findings),
    workouts,
    interpretation:
      'STALE/LONG classifications are engineering data-quality heuristics. Duplicate classifications compare stored workout facts; only an explicitly confirmed cleanup operation may delete sessions.',
  };
}

function compareWorkoutContent(
  left: Awaited<ReturnType<typeof getMcpWorkouts>> extends { workouts: infer T } ? T extends Array<infer R> ? R : never : never,
  right: Awaited<ReturnType<typeof getMcpWorkouts>> extends { workouts: infer T } ? T extends Array<infer R> ? R : never : never,
) {
  const leftFacts = workoutFacts(left);
  const rightFacts = workoutFacts(right);
  if (leftFacts.length === 0 && rightFacts.length === 0) {
    return { exact: false, similarity: 0 };
  }
  const leftSet = new Set(leftFacts);
  const rightSet = new Set(rightFacts);
  const intersection = [...leftSet].filter((fact) => rightSet.has(fact)).length;
  const union = new Set([...leftSet, ...rightSet]).size;
  const similarity = union > 0 ? intersection / union : 0;
  return {
    exact: leftSet.size === rightSet.size && intersection === leftSet.size && leftSet.size > 0,
    similarity,
  };
}

function workoutFacts(workout: {
  exercises: Array<{
    exerciseId: string;
    sets: Array<{
      setNumber: number;
      weightKg: number;
      reps: number;
      rir: number | null;
      isWarmup: boolean;
      isDropSet: boolean;
    }>;
  }>;
}) {
  return workout.exercises
    .flatMap((exercise) =>
      exercise.sets.map((set) =>
        [
          exercise.exerciseId,
          set.setNumber,
          set.weightKg,
          set.reps,
          set.rir ?? 'unknown-rir',
          set.isWarmup ? 'warmup' : 'work',
          set.isDropSet ? 'drop' : 'regular',
        ].join('|'),
      ),
    )
    .sort();
}

function dedupeFindings<T extends { classification: string; sessionIds: string[] }>(findings: T[]) {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = `${finding.classification}:${[...finding.sessionIds].sort().join(',')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
