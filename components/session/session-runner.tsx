'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { MessageSquare } from 'lucide-react';
import type {
  Exercise,
  Program,
  ProgramExercise,
  Session,
  Set as PrismaSet,
  WeightUnit,
  Workout,
  Gym,
  GymExerciseConfig,
} from '@/lib/prisma-client';
import { useLiveQuery } from 'dexie-react-hooks';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { acquireWakeLock, bindWakeLockToVisibility, releaseWakeLock } from '@/lib/wake-lock';
import { vibrate, VIBRATION_PATTERNS } from '@/lib/vibrate';
import { generateLocalId, getDB, type PendingSet } from '@/lib/indexeddb';
import {
  READINESS_HOLD_AT_OR_BELOW,
  READINESS_RECENCY_HOURS,
  SORENESS_HOLD_AT_OR_ABOVE,
  readinessForSuggestion,
  type ReadinessSignal,
} from '@/lib/progression';
import {
  recommendFirstWorkingSet,
  recommendNextIntraSet,
  type IntraSetRecommendation,
} from '@/lib/intra-set-autoregulation';
import {
  buildSupersetView,
  isSupersetTransitionRest,
  nextAutoAdvanceIndex,
  SUPERSET_TRANSITION_REST_SEC,
} from '@/lib/supersets';
import { isReadinessAutoRegulationEnabled } from '@/lib/preferences';
import { flushPendingSets, queueSet } from '@/lib/sync';
import {
  hasUnsyncedSets,
  hydrateFromServerSets,
  localSetIdsForDeletion,
} from '@/lib/sync-hydration';
import { ExerciseCard } from '@/components/session/exercise-card';
import { SetsList } from '@/components/session/sets-list';
import { SessionExerciseMenu } from '@/components/session/session-exercise-menu';
import { SetInput } from '@/components/session/set-input';
import { RestTimer } from '@/components/session/rest-timer';
import { SessionSummary } from '@/components/session/session-summary';
import { SessionControlsDialog } from '@/components/session/session-controls-dialog';
import { SessionExerciseStrip } from '@/components/session/session-exercise-strip';
import { PreviousSessionSets } from '@/components/session/previous-session-sets';
import { EditableSetsTable } from '@/components/session/editable-sets-table';
import { ReturnToTrainingNotice } from '@/components/session/return-to-training-notice';
import { useExerciseName } from '@/components/shared/use-exercise-name';
import { useTrainingName } from '@/components/shared/use-training-name';
import { resolveEquipmentType, type GymLoadConstraints } from '@/lib/gym-loads';
import type { ReturnRecommendation } from '@/lib/return-to-training';
import {
  DROP_SET_TRANSITION_REST_SEC,
  isPlannedExerciseComplete,
  nextPlannedSetIsDropSet,
  projectSetsToTarget,
  remainingPlannedSets,
} from '@/lib/planned-sets';

export interface SerializedLastPerformance {
  sessionId?: string;
  sessionStartedAt: string;
  sets: { weight: number; reps: number; rir: number | null; isDropSet?: boolean }[];
  maxWeight: number;
  repsAtMaxWeight: number;
  // Cardio totals for the last session (issue #176): null for strength
  // exercises. Carried so the exercise card can show a cardio "Last session"
  // reference (duration / distance / avgHr).
  cardio: { durationSec: number; distanceM: number; avgHr: number | null } | null;
}

type ProgramExerciseWithExercise = ProgramExercise & { exercise: Exercise };

export type SessionGym = Gym & { exerciseConfigs: GymExerciseConfig[] };
type SessionRunnerProps = {
  session: Session & {
    workout:
      | (Workout & {
          program: Pick<Program, 'id' | 'name'> | null;
          exercises: ProgramExerciseWithExercise[];
        })
      | null;
    sets: PrismaSet[];
    gym: SessionGym | null;
  };
  lastPerformances: Record<string, SerializedLastPerformance>;
  returnRecommendations: Record<string, ReturnRecommendation>;
  // Latest in-window readiness check-in (or null). Drives whether the load
  // suggestion is held/reduced and the matching explainer in the UI.
  readiness: ReadinessSignal | null;
  // True while the user runs a planned deload week (issue #112): suggestions
  // step down and the runner shows a "Deload week" badge.
  deloadActive: boolean;
  unit: WeightUnit;
  initialExerciseId?: string;
  catalog: Exercise[];
};

type Mode =
  | { kind: 'input' }
  | {
      kind: 'rest';
      endsAt: number;
      totalSec: number;
      nextExerciseIdx: number | null;
      navigatedImmediately: boolean;
    }
  | { kind: 'summary' };

function sortExerciseSets(sets: PendingSet[]): PendingSet[] {
  return sets.sort(
    (a, b) =>
      a.setNumber - b.setNumber || a.createdAt - b.createdAt || a.localId.localeCompare(b.localId),
  );
}

function projectSessionSets(
  sets: readonly PendingSet[],
  targetsByExerciseId: ReadonlyMap<string, ProgramExerciseWithExercise>,
): { visible: PendingSet[]; overflow: PendingSet[] } {
  const byExercise = new Map<string, PendingSet[]>();
  for (const set of sets) {
    const exerciseSets = byExercise.get(set.exerciseId) ?? [];
    exerciseSets.push(set);
    byExercise.set(set.exerciseId, exerciseSets);
  }

  const visible: PendingSet[] = [];
  const overflow: PendingSet[] = [];
  for (const [exerciseId, exerciseSets] of byExercise) {
    sortExerciseSets(exerciseSets);
    const target = targetsByExerciseId.get(exerciseId);
    if (!target) {
      visible.push(...exerciseSets);
      continue;
    }
    const projected = projectSetsToTarget(target, exerciseSets);
    visible.push(...projected.visible);
    overflow.push(...projected.overflow);
  }

  return { visible, overflow };
}

export function SessionRunner({
  session,
  lastPerformances,
  returnRecommendations,
  readiness,
  deloadActive,
  unit,
  initialExerciseId,
  catalog,
}: SessionRunnerProps) {
  const t = useTranslations('session');
  const exerciseName = useExerciseName();
  const trainingName = useTrainingName();
  const router = useRouter();
  const workout = session.workout!;
  const [sessionGym, setSessionGym] = useState<SessionGym | null>(session.gym);
  const [targetSetOverrides, setTargetSetOverrides] = useState<Record<string, number>>({});
  // Supersets (issue #146, slice 1): run the workout in presentation order -
  // members of a superset group come consecutively with A1/A2 labels. For a
  // workout without supersets this is exactly the stored order.
  const supersetView = useMemo(() => buildSupersetView(workout.exercises), [workout.exercises]);
  const programExercises = supersetView.ordered;
  const effectiveProgramExercises = useMemo<ProgramExerciseWithExercise[]>(
    () =>
      programExercises.map((pe) => {
        const recommendation = returnRecommendations[pe.id];
        const override = targetSetOverrides[pe.id];
        const effective =
          !recommendation || recommendation.mode === 'normal'
            ? pe
            : {
                ...pe,
                targetSets: recommendation.targetSets,
                targetDropSets: 0,
                targetRIR: recommendation.targetRIR,
              };
        return override == null ? effective : { ...effective, targetSets: override };
      }),
    [programExercises, returnRecommendations, targetSetOverrides],
  );
  const effectiveProgramExerciseById = useMemo(
    () => new Map(effectiveProgramExercises.map((pe) => [pe.id, pe])),
    [effectiveProgramExercises],
  );
  const effectiveProgramExerciseByExerciseId = useMemo(
    () => new Map(effectiveProgramExercises.map((pe) => [pe.exerciseId, pe])),
    [effectiveProgramExercises],
  );

  const initialProgramExerciseId =
    (initialExerciseId
      ? programExercises.find((pe) => pe.exerciseId === initialExerciseId)?.id
      : null) ??
    programExercises[0]?.id ??
    null;
  const [hydrated, setHydrated] = useState(false);
  const [selectedProgramExerciseId, setSelectedProgramExerciseId] = useState<string | null>(
    initialProgramExerciseId,
  );
  const [pendingProgramExerciseId, setPendingProgramExerciseId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'input' });
  const [closing, setClosing] = useState(false);
  const [exerciseMenuOpen, setExerciseMenuOpen] = useState(false);
  // Readiness auto-regulation can be turned off in settings (issue #61). The
  // preference lives in localStorage, so it is read after mount; until then we
  // assume the default (on) so the first render matches the server output.
  const [autoRegulate, setAutoRegulate] = useState(true);

  const selectedIndex = programExercises.findIndex((pe) => pe.id === selectedProgramExerciseId);
  const currentIdx = selectedIndex >= 0 ? selectedIndex : 0;
  const currentPE = programExercises[currentIdx];
  const currentTarget = effectiveProgramExercises[currentIdx];

  useEffect(() => {
    if (pendingProgramExerciseId) {
      if (programExercises.some((pe) => pe.id === pendingProgramExerciseId)) {
        setSelectedProgramExerciseId(pendingProgramExerciseId);
        setPendingProgramExerciseId(null);
      }
      return;
    }

    if (programExercises.length === 0) {
      if (selectedProgramExerciseId != null) setSelectedProgramExerciseId(null);
      return;
    }
    if (!programExercises.some((pe) => pe.id === selectedProgramExerciseId)) {
      setSelectedProgramExerciseId(programExercises[0]!.id);
    }
  }, [pendingProgramExerciseId, programExercises, selectedProgramExerciseId]);

  useEffect(() => {
    if (!currentPE || typeof window === 'undefined') return;
    const url = `/session/${session.id}?exerciseId=${encodeURIComponent(currentPE.exerciseId)}`;
    window.history.replaceState(window.history.state, '', url);
  }, [currentPE, session.id]);

  // When auto-regulation is off, the readiness signal is dropped entirely, so
  // the suggestion falls back to pure programmed progression (pre-#55 behavior).
  const effectiveReadiness = readinessForSuggestion(readiness, autoRegulate);

  // Hydrate IndexedDB with the server sets, then enable auto-sync.
  useEffect(() => {
    setAutoRegulate(isReadinessAutoRegulationEnabled());
    let cancelled = false;
    void (async () => {
      let serverSets = session.sets;
      let pruneMissingSynced = false;

      if (typeof navigator !== 'undefined' && navigator.onLine) {
        await flushPendingSets();
        const response = await fetch(`/api/sessions/${session.id}`, { cache: 'no-store' }).catch(
          () => null,
        );
        if (response?.ok) {
          const fresh = (await response.json()) as { sets?: PrismaSet[] };
          if (Array.isArray(fresh.sets)) {
            serverSets = fresh.sets;
            pruneMissingSynced = true;
          }
        }
      }

      await hydrateFromServerSets(session.id, serverSets, { pruneMissingSynced });
      if (!cancelled) setHydrated(true);
    })();
    void acquireWakeLock();
    const cleanupVisibility = bindWakeLockToVisibility();
    return () => {
      cancelled = true;
      void releaseWakeLock();
      cleanupVisibility();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live query: all sets of this session, from IndexedDB.
  const liveSets = useLiveQuery(
    async () => {
      const db = getDB();
      const items = await db.pendingSets.where('sessionId').equals(session.id).toArray();
      items.sort(
        (a, b) =>
          a.exerciseId.localeCompare(b.exerciseId) ||
          a.setNumber - b.setNumber ||
          a.createdAt - b.createdAt ||
          a.localId.localeCompare(b.localId),
      );
      return items;
    },
    [session.id],
    [] as PendingSet[],
  );

  const allSetsByExercise = useMemo(() => {
    const out = new Map<string, PendingSet[]>();
    for (const s of liveSets) {
      if (!out.has(s.exerciseId)) out.set(s.exerciseId, []);
      out.get(s.exerciseId)!.push(s);
    }
    for (const arr of out.values()) {
      sortExerciseSets(arr);
    }
    return out;
  }, [liveSets]);

  const setsByExercise = useMemo(() => {
    const out = new Map<string, PendingSet[]>();
    for (const [exerciseId, exerciseSets] of allSetsByExercise) {
      const target = effectiveProgramExerciseByExerciseId.get(exerciseId);
      out.set(
        exerciseId,
        target ? projectSetsToTarget(target, exerciseSets).visible : exerciseSets,
      );
    }
    return out;
  }, [allSetsByExercise, effectiveProgramExerciseByExerciseId]);

  const visibleSets = useMemo(
    () => projectSessionSets(liveSets, effectiveProgramExerciseByExerciseId).visible,
    [effectiveProgramExerciseByExerciseId, liveSets],
  );

  const programExerciseByExerciseId = useMemo(
    () => new Map(effectiveProgramExercises.map((pe) => [pe.exerciseId, pe])),
    [effectiveProgramExercises],
  );

  function recommendationFor(
    pe: ProgramExerciseWithExercise,
    atMs: number,
  ): IntraSetRecommendation | null {
    const completedSets = setsByExercise.get(pe.exerciseId) ?? [];
    const lastWorkingSet = completedSets.filter((set) => !set.isWarmup && !set.isDropSet).at(-1);
    if (!lastWorkingSet) {
      const returnRecommendation = returnRecommendations[pe.id];
      if (returnRecommendation && returnRecommendation.mode !== 'normal') return null;

      const previousPerformance = lastPerformances[pe.exerciseId];
      if (!previousPerformance) return null;
      return recommendFirstWorkingSet({
        programExercise: pe,
        previousSets: previousPerformance.sets,
        readiness: effectiveReadiness,
        plannedDeload: deloadActive,
        loadConstraints: loadConstraintsFor(pe),
      });
    }

    const interveningSet = visibleSets
      .filter(
        (set) =>
          !set.isWarmup &&
          !set.isDropSet &&
          set.exerciseId !== pe.exerciseId &&
          set.createdAt > lastWorkingSet.createdAt,
      )
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    const interveningPe = interveningSet
      ? programExerciseByExerciseId.get(interveningSet.exerciseId)
      : undefined;
    const sameMuscleSuperset = Boolean(
      interveningPe &&
      pe.supersetGroup != null &&
      interveningPe.supersetGroup === pe.supersetGroup &&
      interveningPe.exercise.muscleGroup === pe.exercise.muscleGroup,
    );

    const freshReadiness =
      effectiveReadiness != null && effectiveReadiness.ageHours <= READINESS_RECENCY_HOURS;
    const groupSoreness = effectiveReadiness?.soreness?.[pe.exercise.muscleGroup];
    const recoveryBlocksIncrease =
      freshReadiness &&
      (effectiveReadiness.readiness <= READINESS_HOLD_AT_OR_BELOW ||
        (typeof groupSoreness === 'number' && groupSoreness >= SORENESS_HOLD_AT_OR_ABOVE));
    const allowLoadIncrease = !deloadActive && !recoveryBlocksIncrease;

    return recommendNextIntraSet({
      programExercise: pe,
      completedSets,
      recoverySec: Math.max(0, (atMs - lastWorkingSet.createdAt) / 1000),
      sameMuscleSuperset,
      allowLoadIncrease,
      maxWeight: returnRecommendations[pe.id]?.weightCeiling ?? null,
      loadConstraints: loadConstraintsFor(pe),
    });
  }

  function loadConstraintsFor(pe: ProgramExerciseWithExercise): GymLoadConstraints {
    const equipmentType = resolveEquipmentType(pe.exercise.equipmentType, pe.exercise.name);
    if (!sessionGym) return { equipmentType };

    const config = sessionGym.exerciseConfigs.find((item) => item.exerciseId === pe.exerciseId);
    return {
      equipmentType,
      isAvailable: config?.isAvailable ?? true,
      dumbbellWeights: config?.dumbbellWeights.length
        ? config.dumbbellWeights
        : sessionGym.dumbbellWeights,
      plateWeights: config?.plateWeights.length ? config.plateWeights : sessionGym.plateWeights,
      barWeights: config?.barWeights.length ? config.barWeights : sessionGym.barWeights,
      weightOptions: config?.weightOptions ?? [],
    };
  }

  // Prior-session sets per exercise, the PR baseline for the post-session
  // summary (same source as the in-session badge: getLastPerformances).
  const priorSetsByExercise = useMemo(() => {
    const out: Record<string, { weight: number; reps: number }[]> = {};
    for (const [exerciseId, perf] of Object.entries(lastPerformances)) {
      out[exerciseId] = perf.sets.map((s) => ({ weight: s.weight, reps: s.reps }));
    }
    return out;
  }, [lastPerformances]);

  const completedExerciseIds = useMemo(() => {
    const completed = new Set<string>();
    for (const pe of effectiveProgramExercises) {
      const exerciseSets = setsByExercise.get(pe.exerciseId) ?? [];
      if (isPlannedExerciseComplete(pe, exerciseSets)) completed.add(pe.exerciseId);
    }
    return completed;
  }, [effectiveProgramExercises, setsByExercise]);

  async function handleValidate(values: {
    weight: number;
    reps: number;
    rir: number | null;
    durationSec: number | null;
    distanceM: number | null;
    isWarmup: boolean;
    isDropSet: boolean;
    notes: string | null;
  }) {
    if (!currentPE || !currentTarget) return;
    const existing = setsByExercise.get(currentPE.exerciseId) ?? [];
    const allExisting = allSetsByExercise.get(currentPE.exerciseId) ?? [];
    const setNumber = (allExisting.at(-1)?.setNumber ?? 0) + 1;

    // Optimistic write: immediate insert into IndexedDB (status pending),
    // instant display via useLiveQuery, and a background POST attempt.
    await queueSet({
      localId: generateLocalId(),
      sessionId: session.id,
      exerciseId: currentPE.exerciseId,
      setNumber,
      weight: values.weight,
      reps: values.reps,
      rir: values.rir,
      durationSec: values.durationSec,
      distanceM: values.distanceM,
      notes: values.notes,
      isWarmup: values.isWarmup,
      isDropSet: values.isDropSet,
    });

    vibrate(VIBRATION_PATTERNS.validate);

    // Start the rest and determine where the runner should continue.
    // Standalone exercise (unchanged behavior): advance once the set
    // completes the target. Superset member (issue #146): alternate to the
    // next member of the group that still has sets, the A1/A2 flow.
    const submittedSet = { isWarmup: values.isWarmup, isDropSet: values.isDropSet };
    const remainingAfterThisSet = (pe: ProgramExerciseWithExercise) => {
      const exerciseSets = setsByExercise.get(pe.exerciseId) ?? [];
      const target = effectiveProgramExerciseById.get(pe.id) ?? pe;
      return remainingPlannedSets(
        target,
        exerciseSets,
        pe.id === currentPE.id ? submittedSet : null,
      );
    };
    const dropSetTransition =
      !values.isWarmup && nextPlannedSetIsDropSet(currentTarget, [...existing, submittedSet]);
    const nextIdx =
      values.isWarmup || dropSetTransition
        ? null
        : nextAutoAdvanceIndex(supersetView, currentIdx, remainingAfterThisSet);

    // Superset-aware rest (issue #189): a short transition rest when the
    // auto-advance moves to another member of the same group (A1 -> A2); the
    // full per-exercise rest after the last member and for standalone work.
    const transition = isSupersetTransitionRest(supersetView, currentIdx, nextIdx);
    const restSec = dropSetTransition
      ? DROP_SET_TRANSITION_REST_SEC
      : transition
        ? SUPERSET_TRANSITION_REST_SEC
        : currentTarget.restSec;

    // Inside a superset, show the next member immediately so the athlete can
    // get into position while the transition timer is running. The timer only
    // unlocks input when it ends; it must not navigate a second time.
    const navigatedImmediately = transition && nextIdx != null;
    if (navigatedImmediately) selectExercise(nextIdx);

    setMode({
      kind: 'rest',
      endsAt: Date.now() + restSec * 1000,
      totalSec: restSec,
      nextExerciseIdx: nextIdx,
      navigatedImmediately,
    });
  }

  async function handleUpdateSet(
    set: PendingSet,
    values: { weight: number; reps: number; rir: number | null },
  ) {
    const db = getDB();
    try {
      // A freshly confirmed row may still be inside its POST request. Wait for
      // that request to finish so the correction becomes a PATCH instead of
      // racing the original values.
      const current = (await db.pendingSets.get(set.localId)) ?? set;
      if (!current.serverId && current.status === 'syncing') {
        await flushPendingSets();
      }

      await db.pendingSets.update(set.localId, {
        weight: values.weight,
        reps: values.reps,
        rir: values.rir,
        status: 'pending',
        attempts: 0,
        lastError: null,
      });

      // The queue chooses POST for a new local row and PATCH once serverId is
      // present. Offline edits remain pending and sync on reconnect.
      void flushPendingSets();
      toast.success(t('setUpdated'));
    } catch (error) {
      toast.error(t('setUpdateError'));
      throw error;
    }
  }

  async function handleTargetSetsChange(targetSets: number) {
    if (!currentPE) throw new Error('Program exercise missing.');
    const programExerciseId = currentPE.id;
    const hadOverride = Object.prototype.hasOwnProperty.call(targetSetOverrides, programExerciseId);
    const previousOverride = targetSetOverrides[programExerciseId];

    setTargetSetOverrides((current) => ({ ...current, [programExerciseId]: targetSets }));
    try {
      const response = await fetch(`/api/program-exercises/${programExerciseId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetSets }),
      });
      if (!response.ok) throw new Error('Target set update failed.');
      router.refresh();
    } catch (error) {
      setTargetSetOverrides((current) => {
        const next = { ...current };
        if (hadOverride && previousOverride != null) next[programExerciseId] = previousOverride;
        else delete next[programExerciseId];
        return next;
      });
      throw error;
    }
  }

  async function handleDeleteSet(set: PendingSet): Promise<boolean> {
    const db = getDB();
    try {
      let current = (await db.pendingSets.get(set.localId)) ?? set;
      if (!current.serverId && (current.status === 'pending' || current.status === 'syncing')) {
        await flushPendingSets();
        current = (await db.pendingSets.get(set.localId)) ?? current;
      }

      // If already synced: API DELETE call, then local removal. If it has not
      // synced yet, deleting the local row prevents its pending POST.
      if (current.serverId) {
        const res = await fetch(`/api/sets/${current.serverId}`, { method: 'DELETE' });
        if (!res.ok && res.status !== 404) {
          toast.error(t('setDeleteError'));
          return false;
        }
      }
      const sessionSets = await db.pendingSets
        .where('sessionId')
        .equals(current.sessionId)
        .toArray();
      const localIds = localSetIdsForDeletion(current, sessionSets);
      await db.pendingSets.bulkDelete(localIds.length > 0 ? localIds : [current.localId]);
      toast.success(t('setDeleted'));
      return true;
    } catch {
      toast.error(t('setDeleteError'));
      return false;
    }
  }

  async function handleFinishSession() {
    setClosing(true);
    try {
      // Attempt one last flush before closing, to minimize the residual queue.
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        await flushPendingSets();
      }
      const db = getDB();
      const persistedSets = await db.pendingSets.where('sessionId').equals(session.id).toArray();
      const projection = projectSessionSets(persistedSets, effectiveProgramExerciseByExerciseId);
      if (hasUnsyncedSets(projection.visible)) {
        toast.error(t('finishSyncError'));
        return;
      }
      const overflowSets = projection.overflow;
      if (overflowSets.some((set) => !set.serverId)) {
        toast.error(t('finishError'));
        return;
      }
      const discardSetIds = [
        ...new Set(overflowSets.flatMap((set) => (set.serverId ? [set.serverId] : []))),
      ];
      const res = await fetch(`/api/sessions/${session.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ finish: true, discardSetIds }),
      });
      if (!res.ok) {
        toast.error(t('finishError'));
        return;
      }
      if (overflowSets.length > 0) {
        await db.pendingSets.bulkDelete(overflowSets.map((set) => set.localId));
      }
      toast.success(t('finished'));
      router.replace('/');
      router.refresh();
    } finally {
      setClosing(false);
    }
  }

  function handlePauseSession() {
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      void flushPendingSets();
    }
    toast.success(t('controls.paused'));
    router.replace('/');
    router.refresh();
  }

  async function handleResetSession(): Promise<boolean> {
    try {
      const res = await fetch(`/api/sessions/${session.id}`, { method: 'DELETE' });
      if (!res.ok) {
        toast.error(t('controls.resetError'));
        return false;
      }

      const db = getDB();
      await db.pendingSets.where('sessionId').equals(session.id).delete();
      toast.success(t('controls.resetSuccess'));
      router.replace('/');
      router.refresh();
      return true;
    } catch {
      toast.error(t('controls.resetError'));
      return false;
    }
  }

  function selectExercise(index: number) {
    const next = programExercises[index];
    if (!next) return;
    setSelectedProgramExerciseId(next.id);
    setExerciseMenuOpen(false);
    if (typeof window !== 'undefined') {
      const url = `/session/${session.id}?exerciseId=${encodeURIComponent(next.exerciseId)}`;
      window.history.replaceState(window.history.state, '', url);
    }
  }

  function openExerciseDetails(exerciseId: string) {
    const returnTo = `/session/${session.id}?exerciseId=${encodeURIComponent(exerciseId)}`;
    router.push(`/exercises/${exerciseId}?returnTo=${encodeURIComponent(returnTo)}`);
  }
  function handleProgramChanged(options?: { selectProgramExerciseId?: string }) {
    if (options?.selectProgramExerciseId) {
      setPendingProgramExerciseId(options.selectProgramExerciseId);
      setSelectedProgramExerciseId(options.selectProgramExerciseId);
    }
    setTargetSetOverrides({});
    setExerciseMenuOpen(false);
    router.refresh();
  }

  function handleRestEnd() {
    vibrate(VIBRATION_PATTERNS.restEnd);
    if (mode.kind === 'rest' && !mode.navigatedImmediately && mode.nextExerciseIdx != null) {
      selectExercise(mode.nextExerciseIdx);
    }
    setMode({ kind: 'input' });
  }

  function handleSkipRest() {
    if (mode.kind === 'rest' && !mode.navigatedImmediately && mode.nextExerciseIdx != null) {
      selectExercise(mode.nextExerciseIdx);
    }
    setMode({ kind: 'input' });
  }

  function handleAdd30s() {
    if (mode.kind !== 'rest') return;
    setMode({ ...mode, endsAt: mode.endsAt + 30_000 });
  }

  if (mode.kind === 'summary') {
    return (
      <SessionSummary
        session={session}
        sets={visibleSets}
        programExercises={effectiveProgramExercises}
        unit={unit}
        priorSets={priorSetsByExercise}
        onBack={() => setMode({ kind: 'input' })}
        onFinish={handleFinishSession}
        finishing={closing}
      />
    );
  }

  if (!currentPE || !currentTarget) {
    return (
      <main className="flex flex-1 items-center justify-center px-4 py-6">
        <p className="text-muted-foreground">{t('noExercises')}</p>
      </main>
    );
  }

  const lastPerf = lastPerformances[currentPE.exerciseId];
  const currentSets = setsByExercise.get(currentPE.exerciseId) ?? [];
  const allCurrentSets = allSetsByExercise.get(currentPE.exerciseId) ?? [];
  const currentReturnRecommendation = returnRecommendations[currentPE.id];
  const currentRecommendation = nextPlannedSetIsDropSet(currentTarget, currentSets)
    ? null
    : recommendationFor(currentTarget, Date.now());
  const restNextPe =
    mode.kind === 'rest'
      ? mode.nextExerciseIdx != null
        ? (effectiveProgramExercises[mode.nextExerciseIdx] ?? null)
        : remainingPlannedSets(currentTarget, currentSets) > 0
          ? currentTarget
          : null
      : null;
  const restNextLabel =
    mode.kind === 'rest' && !mode.navigatedImmediately && restNextPe
      ? exerciseName(restNextPe.exercise.name)
      : null;
  const restRecommendation =
    mode.kind === 'rest' &&
    restNextPe &&
    !nextPlannedSetIsDropSet(restNextPe, setsByExercise.get(restNextPe.exerciseId) ?? [])
      ? recommendationFor(restNextPe, mode.endsAt)
      : null;

  return (
    <main className="flex flex-1 flex-col">
      {/* Compact day controls and direct exercise navigation. */}
      <div className="sticky top-[97px] z-10 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
        <div className="flex justify-end">
          <SessionControlsDialog
            workoutName={trainingName(workout.name)}
            startedAt={session.startedAt}
            statusLabel={deloadActive ? t('deloadWeek') : null}
            onComplete={() => setMode({ kind: 'summary' })}
            onPause={handlePauseSession}
            onReset={handleResetSession}
          />
        </div>
        <SessionExerciseStrip
          exercises={programExercises}
          currentIndex={currentIdx}
          completedExerciseIds={completedExerciseIds}
          disabled={mode.kind !== 'input'}
          onSelect={(index) => {
            selectExercise(index);
            setMode({ kind: 'input' });
          }}
          onOpen={openExerciseDetails}
        />
      </div>

      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-4">
        <ExerciseCard
          programExercise={currentPE}
          gymName={sessionGym?.name ?? null}
          loadConstraints={loadConstraintsFor(currentPE)}
          onOpenMenu={() => setExerciseMenuOpen(true)}
        />
        <ReturnToTrainingNotice
          recommendation={currentReturnRecommendation}
          unit={unit}
          usesBodyweight={currentTarget.exercise.usesBodyweight}
        />
        <SessionExerciseMenu
          open={exerciseMenuOpen}
          onOpenChange={setExerciseMenuOpen}
          programExercise={currentPE}
          programExercises={programExercises}
          catalog={catalog}
          loggedSetCount={currentSets.filter((set) => !set.isWarmup).length}
          onChanged={handleProgramChanged}
          onOpenHelp={openExerciseDetails}
        />

        {currentPE.exercise.category === 'CARDIO' ? (
          <>
            <SetsList
              programExercise={currentTarget}
              sets={currentSets}
              isInputActive={mode.kind === 'input'}
              onDeleteSet={handleDeleteSet}
              priorSets={lastPerf?.sets}
            />
            {!hydrated ? null : mode.kind === 'input' ? (
              <SetInput
                programExercise={currentTarget}
                existingSets={currentSets}
                lastPerformance={lastPerf}
                readiness={effectiveReadiness}
                deloadActive={deloadActive}
                unit={unit}
                recommendation={currentRecommendation}
                loadConstraints={loadConstraintsFor(currentTarget)}
                onSubmit={handleValidate}
              />
            ) : (
              <RestTimer
                endsAt={mode.endsAt}
                totalSec={mode.totalSec}
                nextLabel={restNextLabel}
                recommendation={restRecommendation}
                unit={unit}
                onEnd={handleRestEnd}
                onSkip={handleSkipRest}
                onAdd30={handleAdd30s}
              />
            )}
          </>
        ) : (
          <>
            <EditableSetsTable
              programExercise={currentTarget}
              sets={allCurrentSets}
              lastPerformance={lastPerf}
              readiness={effectiveReadiness}
              deloadActive={deloadActive}
              unit={unit}
              recommendation={currentRecommendation}
              returnRecommendation={currentReturnRecommendation}
              loadConstraints={loadConstraintsFor(currentTarget)}
              gym={sessionGym}
              onGymUpdated={setSessionGym}
              disabled={!hydrated || mode.kind !== 'input'}
              onSubmit={handleValidate}
              onUpdateSet={handleUpdateSet}
              onDeleteSet={handleDeleteSet}
              onTargetSetsChange={handleTargetSetsChange}
            />
            {mode.kind === 'rest' && (
              <RestTimer
                endsAt={mode.endsAt}
                totalSec={mode.totalSec}
                nextLabel={restNextLabel}
                recommendation={restRecommendation}
                unit={unit}
                onEnd={handleRestEnd}
                onSkip={handleSkipRest}
                onAdd30={handleAdd30s}
              />
            )}
          </>
        )}

        <PreviousSessionSets performance={lastPerf} unit={unit} />

        {/* In-session coach access (issue #111): opens the chat with this
            session attached so the advice is grounded in the live workout.
            Always available, never auto-triggered. */}
        <Button variant="outline" size="sm" asChild className="min-h-tap">
          <Link href={`/chat?sessionId=${session.id}`}>
            <MessageSquare className="size-4" />
            <span className="ml-2">{t('askCoach')}</span>
          </Link>
        </Button>
      </div>
    </main>
  );
}
