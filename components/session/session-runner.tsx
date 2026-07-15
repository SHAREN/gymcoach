'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Flag, MessageSquare, X } from 'lucide-react';
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
  GymEquipment,
  GymEquipmentExercise,
  GymPlateInventoryItem,
  GymPlatePool,
} from '@/lib/prisma-client';
import { useLiveQuery } from 'dexie-react-hooks';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
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
import { recommendNextIntraSet, type IntraSetRecommendation } from '@/lib/intra-set-autoregulation';
import {
  buildSupersetView,
  isSupersetTransitionRest,
  nextAutoAdvanceIndex,
  nextNavIndex,
  SUPERSET_TRANSITION_REST_SEC,
} from '@/lib/supersets';
import { isReadinessAutoRegulationEnabled } from '@/lib/preferences';
import { bindAutoSync, flushPendingSets, queueSet } from '@/lib/sync';
import { hydrateFromServerSets } from '@/lib/sync-hydration';
import { ExerciseCard } from '@/components/session/exercise-card';
import { SetsList } from '@/components/session/sets-list';
import { SessionExerciseMenu } from '@/components/session/session-exercise-menu';
import { SetInput } from '@/components/session/set-input';
import { RestTimer } from '@/components/session/rest-timer';
import { SessionSummary } from '@/components/session/session-summary';
import { SessionExerciseStrip } from '@/components/session/session-exercise-strip';
import { PreviousSessionSets } from '@/components/session/previous-session-sets';
import { EditableSetsTable } from '@/components/session/editable-sets-table';
import { SessionEquipmentSelector } from '@/components/session/session-equipment-selector';
import { ReturnToTrainingNotice } from '@/components/session/return-to-training-notice';
import { useExerciseName } from '@/components/shared/use-exercise-name';
import { useTrainingName } from '@/components/shared/use-training-name';
import {
  resolveExerciseInventory,
  type EquipmentLoadProfile,
  type GymLoadConstraints,
  type ResolvedExerciseInventory,
} from '@/lib/gym-loads';
import type { ReturnRecommendation } from '@/lib/return-to-training';
import type { EquipmentReturnRecommendation } from '@/lib/return-to-training-history';
import {
  DROP_SET_TRANSITION_REST_SEC,
  isPlannedExerciseComplete,
  nextPlannedSetIsDropSet,
  remainingPlannedSets,
} from '@/lib/planned-sets';

export interface SerializedLastPerformance {
  sessionId?: string;
  sessionStartedAt: string;
  gymEquipmentId: string | null;
  equipmentName: string | null;
  sets: {
    weight: number;
    reps: number;
    rir: number | null;
    isDropSet?: boolean;
    gymEquipmentId: string | null;
    nominalResistanceKg: number | null;
  }[];
  maxWeight: number;
  repsAtMaxWeight: number;
  // Cardio totals for the last session (issue #176): null for strength
  // exercises. Carried so the exercise card can show a cardio "Last session"
  // reference (duration / distance / avgHr).
  cardio: { durationSec: number; distanceM: number; avgHr: number | null } | null;
}

type ProgramExerciseWithExercise = ProgramExercise & { exercise: Exercise };

type SessionGymEquipment = Pick<
  GymEquipment,
  | 'id'
  | 'gymId'
  | 'name'
  | 'equipmentType'
  | 'loadType'
  | 'weightOptions'
  | 'selectedLoadMultiplier'
  | 'baseLoadKg'
  | 'platePoolId'
  | 'loadingSides'
> & {
  exerciseLinks: Pick<GymEquipmentExercise, 'exerciseId'>[];
  platePool:
    | (Pick<GymPlatePool, 'id' | 'name' | 'compatibilityKey'> & {
        plates: Pick<GymPlateInventoryItem, 'weightKg' | 'quantity'>[];
      })
    | null;
};

export type SessionGym = Gym & {
  exerciseConfigs: GymExerciseConfig[];
  equipment: SessionGymEquipment[];
};
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
  lastPerformances: Record<string, SerializedLastPerformance[]>;
  returnRecommendations: Record<string, EquipmentReturnRecommendation[]>;
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

export function sameEquipmentIdentity(
  first: string | null | undefined,
  second: string | null | undefined,
): boolean {
  return (first ?? null) === (second ?? null);
}

export function filterSetsForEquipment(
  sets: PendingSet[],
  gymEquipmentId: string | null,
): PendingSet[] {
  return sets.filter((set) => sameEquipmentIdentity(set.gymEquipmentId, gymEquipmentId));
}

export function selectLastPerformanceForEquipment(
  performances: SerializedLastPerformance[] | undefined,
  gymEquipmentId: string | null,
): SerializedLastPerformance | undefined {
  return performances?.find((performance) =>
    sameEquipmentIdentity(performance.gymEquipmentId, gymEquipmentId),
  );
}

export function selectReturnRecommendationForEquipment(
  recommendations: EquipmentReturnRecommendation[] | undefined,
  gymEquipmentId: string | null,
): ReturnRecommendation | undefined {
  return recommendations?.find((item) => sameEquipmentIdentity(item.gymEquipmentId, gymEquipmentId))
    ?.recommendation;
}

export function resolveSelectedEquipmentId(
  inventory: ResolvedExerciseInventory,
  requestedId: string | null | undefined,
): string | null {
  if (
    requestedId &&
    inventory.equipment.some((equipment) => equipment.equipmentId === requestedId)
  ) {
    return requestedId;
  }
  if (inventory.source === 'equipment' && inventory.equipment.length === 1) {
    return inventory.equipment[0]!.equipmentId;
  }
  return null;
}

export function requiresEquipmentSelection(
  inventory: ResolvedExerciseInventory,
  requestedId: string | null | undefined,
): boolean {
  return (
    inventory.source === 'equipment' && resolveSelectedEquipmentId(inventory, requestedId) == null
  );
}

export function buildSetValueCorrectionPatch(values: {
  weight: number;
  reps: number;
  rir: number | null;
}): Pick<PendingSet, 'weight' | 'reps' | 'rir' | 'status' | 'attempts' | 'lastError'> {
  return {
    ...values,
    status: 'pending',
    attempts: 0,
    lastError: null,
  };
}

export function buildSetEquipmentChangePatch(
  set: PendingSet,
  gymEquipmentId: string | null,
): Pick<
  PendingSet,
  'gymEquipmentId' | 'equipmentSnapshotAction' | 'status' | 'attempts' | 'lastError'
> {
  return {
    gymEquipmentId,
    equipmentSnapshotAction: set.serverId ? (gymEquipmentId ? 'REPLACE' : 'CLEAR') : null,
    status: 'pending',
    attempts: 0,
    lastError: null,
  };
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
  const [selectedEquipmentByExercise, setSelectedEquipmentByExercise] = useState<
    Record<string, string | null>
  >(() => initialEquipmentSelections(session));
  const [targetSetOverrides, setTargetSetOverrides] = useState<Record<string, number>>({});
  // Supersets (issue #146, slice 1): run the workout in presentation order -
  // members of a superset group come consecutively with A1/A2 labels. For a
  // workout without supersets this is exactly the stored order.
  const supersetView = useMemo(() => buildSupersetView(workout.exercises), [workout.exercises]);
  const programExercises = supersetView.ordered;
  const effectiveProgramExercises = useMemo<ProgramExerciseWithExercise[]>(
    () =>
      programExercises.map((pe) => {
        const inventory = resolveSessionExerciseInventory(sessionGym, pe);
        const selectedEquipmentId = resolveSelectedEquipmentId(
          inventory,
          selectedEquipmentByExercise[pe.exerciseId],
        );
        const recommendation = requiresEquipmentSelection(
          inventory,
          selectedEquipmentByExercise[pe.exerciseId],
        )
          ? undefined
          : selectReturnRecommendationForEquipment(
              returnRecommendations[pe.id],
              selectedEquipmentId,
            );
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
    [
      programExercises,
      returnRecommendations,
      selectedEquipmentByExercise,
      sessionGym,
      targetSetOverrides,
    ],
  );
  const effectiveProgramExerciseById = useMemo(
    () => new Map(effectiveProgramExercises.map((pe) => [pe.id, pe])),
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
    void (async () => {
      await hydrateFromServerSets(session.id, session.sets);
      setHydrated(true);
    })();
    void acquireWakeLock();
    const cleanupVisibility = bindWakeLockToVisibility();
    const cleanupSync = bindAutoSync();
    return () => {
      void releaseWakeLock();
      cleanupVisibility();
      cleanupSync();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live query: all sets of this session, from IndexedDB.
  const liveSets = useLiveQuery(
    async () => {
      const db = getDB();
      const items = await db.pendingSets.where('sessionId').equals(session.id).toArray();
      items.sort((a, b) => a.exerciseId.localeCompare(b.exerciseId) || a.setNumber - b.setNumber);
      return items;
    },
    [session.id],
    [] as PendingSet[],
  );

  const setsByExercise = useMemo(() => {
    const out = new Map<string, PendingSet[]>();
    for (const s of liveSets) {
      if (!out.has(s.exerciseId)) out.set(s.exerciseId, []);
      out.get(s.exerciseId)!.push(s);
    }
    for (const arr of out.values()) {
      arr.sort((a, b) => a.setNumber - b.setNumber);
    }
    return out;
  }, [liveSets]);

  const programExerciseByExerciseId = useMemo(
    () => new Map(effectiveProgramExercises.map((pe) => [pe.exerciseId, pe])),
    [effectiveProgramExercises],
  );

  function recommendationFor(
    pe: ProgramExerciseWithExercise,
    atMs: number,
  ): IntraSetRecommendation | null {
    const inventory = inventoryFor(pe);
    const selectedEquipmentId = selectedEquipmentIdFor(pe, inventory);
    if (requiresEquipmentSelection(inventory, selectedEquipmentByExercise[pe.exerciseId])) {
      return null;
    }
    const completedSets = filterSetsForEquipment(
      setsByExercise.get(pe.exerciseId) ?? [],
      selectedEquipmentId,
    );
    const lastWorkingSet = completedSets.filter((set) => !set.isWarmup && !set.isDropSet).at(-1);
    if (!lastWorkingSet) return null;

    const interveningSet = liveSets
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
      maxWeight: returnRecommendationFor(pe)?.weightCeiling ?? null,
      loadConstraints: loadConstraintsFor(pe),
    });
  }

  function inventoryFor(pe: ProgramExerciseWithExercise): ResolvedExerciseInventory {
    return resolveSessionExerciseInventory(sessionGym, pe);
  }

  function loadConstraintsFor(pe: ProgramExerciseWithExercise): GymLoadConstraints {
    const resolved = inventoryFor(pe);
    const selectedEquipmentId = selectedEquipmentIdFor(pe, resolved);
    if (resolved.source === 'equipment') {
      return { ...resolved.constraints, equipmentId: selectedEquipmentId };
    }
    return resolved.constraints;
  }

  function selectedEquipmentIdFor(
    pe: ProgramExerciseWithExercise,
    inventory = inventoryFor(pe),
  ): string | null {
    return resolveSelectedEquipmentId(inventory, selectedEquipmentByExercise[pe.exerciseId]);
  }

  function returnRecommendationFor(
    pe: ProgramExerciseWithExercise,
  ): ReturnRecommendation | undefined {
    const inventory = inventoryFor(pe);
    if (requiresEquipmentSelection(inventory, selectedEquipmentByExercise[pe.exerciseId])) {
      return undefined;
    }
    return selectReturnRecommendationForEquipment(
      returnRecommendations[pe.id],
      selectedEquipmentIdFor(pe, inventory),
    );
  }

  // Prior-session sets per exercise, the PR baseline for the post-session
  // summary (same source as the in-session badge: getLastPerformances).
  const priorSetsByExercise = useMemo(() => {
    const out: Record<string, { weight: number; reps: number }[]> = {};
    for (const pe of effectiveProgramExercises) {
      const inventory = inventoryFor(pe);
      const selectedEquipmentId = selectedEquipmentIdFor(pe, inventory);
      const performance = requiresEquipmentSelection(
        inventory,
        selectedEquipmentByExercise[pe.exerciseId],
      )
        ? undefined
        : selectLastPerformanceForEquipment(lastPerformances[pe.exerciseId], selectedEquipmentId);
      if (performance) {
        out[pe.exerciseId] = performance.sets.map((set) => ({
          weight: set.weight,
          reps: set.reps,
        }));
      }
    }
    return out;
    // inventoryFor and selectedEquipmentIdFor use only these state values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveProgramExercises, lastPerformances, selectedEquipmentByExercise, sessionGym]);

  const completedExerciseCount = useMemo(() => {
    let count = 0;
    for (const pe of effectiveProgramExercises) {
      const exerciseSets = setsByExercise.get(pe.exerciseId) ?? [];
      if (isPlannedExerciseComplete(pe, exerciseSets)) count += 1;
    }
    return count;
  }, [effectiveProgramExercises, setsByExercise]);

  const completedExerciseIds = useMemo(() => {
    const completed = new Set<string>();
    for (const pe of effectiveProgramExercises) {
      const exerciseSets = setsByExercise.get(pe.exerciseId) ?? [];
      if (isPlannedExerciseComplete(pe, exerciseSets)) completed.add(pe.exerciseId);
    }
    return completed;
  }, [effectiveProgramExercises, setsByExercise]);

  const progressPct =
    programExercises.length === 0
      ? 0
      : Math.round((completedExerciseCount / programExercises.length) * 100);

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
    const inventory = inventoryFor(currentPE);
    const selectedEquipmentId = selectedEquipmentIdFor(currentPE, inventory);
    if (requiresEquipmentSelection(inventory, selectedEquipmentByExercise[currentPE.exerciseId])) {
      toast.error(t('equipment.selectionRequired'));
      return;
    }
    const existing = setsByExercise.get(currentPE.exerciseId) ?? [];
    const setNumber = (existing.at(-1)?.setNumber ?? 0) + 1;

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
      gymEquipmentId: selectedEquipmentId,
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
      let current = (await db.pendingSets.get(set.localId)) ?? set;
      if (!current.serverId && current.status === 'syncing') {
        await flushPendingSets();
        current = (await db.pendingSets.get(set.localId)) ?? current;
      }

      await db.pendingSets.update(set.localId, buildSetValueCorrectionPatch(values));

      // The queue chooses POST for a new local row and PATCH once serverId is
      // present. Offline edits remain pending and sync on reconnect.
      void flushPendingSets();
      toast.success(t('setUpdated'));
    } catch (error) {
      toast.error(t('setUpdateError'));
      throw error;
    }
  }

  async function handleChangeSetEquipment(
    set: PendingSet,
    gymEquipmentId: string | null,
  ): Promise<void> {
    const pe = effectiveProgramExercises.find((item) => item.exerciseId === set.exerciseId);
    if (!pe) throw new Error('Program exercise missing.');
    const inventory = inventoryFor(pe);
    if (inventory.source === 'equipment') {
      if (
        !gymEquipmentId ||
        !inventory.equipment.some((equipment) => equipment.equipmentId === gymEquipmentId)
      ) {
        toast.error(t('setUpdateError'));
        throw new Error('A linked equipment selection is required.');
      }
    }

    const db = getDB();
    try {
      let current = (await db.pendingSets.get(set.localId)) ?? set;
      if (!current.serverId && current.status === 'syncing') {
        await flushPendingSets();
        current = (await db.pendingSets.get(set.localId)) ?? current;
      }

      await db.pendingSets.update(
        set.localId,
        buildSetEquipmentChangePatch(current, gymEquipmentId),
      );
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
      await db.pendingSets.delete(current.localId);
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
      const res = await fetch(`/api/sessions/${session.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ finish: true }),
      });
      if (!res.ok) {
        toast.error(t('finishError'));
        return;
      }
      toast.success(t('finished'));
      router.replace('/');
      router.refresh();
    } finally {
      setClosing(false);
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

  function goPrev() {
    selectExercise(Math.max(0, currentIdx - 1));
    setMode({ kind: 'input' });
  }
  // Next is linear for standalone exercises (unchanged) and cycles within a
  // superset group before advancing past it (issue #146).
  const remainingNow = (pe: ProgramExerciseWithExercise) =>
    remainingPlannedSets(
      effectiveProgramExerciseById.get(pe.id) ?? pe,
      setsByExercise.get(pe.exerciseId) ?? [],
    );
  const navNextIdx = nextNavIndex(supersetView, currentIdx, remainingNow);
  function goNext() {
    if (navNextIdx == null) return;
    selectExercise(navNextIdx);
    setMode({ kind: 'input' });
  }

  if (mode.kind === 'summary') {
    return (
      <SessionSummary
        session={session}
        sets={liveSets}
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

  const currentSets = setsByExercise.get(currentPE.exerciseId) ?? [];
  const currentReturnRecommendation = returnRecommendationFor(currentPE);
  const currentInventory = inventoryFor(currentPE);
  const currentSelectedEquipmentId = selectedEquipmentIdFor(currentPE, currentInventory);
  const currentEquipmentSelectionRequired = requiresEquipmentSelection(
    currentInventory,
    selectedEquipmentByExercise[currentPE.exerciseId],
  );
  const currentHistorySets = currentEquipmentSelectionRequired
    ? []
    : filterSetsForEquipment(currentSets, currentSelectedEquipmentId);
  const lastPerf = currentEquipmentSelectionRequired
    ? undefined
    : selectLastPerformanceForEquipment(
        lastPerformances[currentPE.exerciseId],
        currentSelectedEquipmentId,
      );
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
      {/* Sticky header with progress and exit button */}
      <div className="sticky top-[97px] z-10 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-xs text-muted-foreground">{trainingName(workout.name)}</p>
            <p className="text-sm font-semibold tabular-nums">
              {currentIdx + 1} / {programExercises.length}
            </p>
            {supersetView.labels.has(currentPE.id) && (
              <Badge variant="secondary" className="mt-1">
                {t('superset', { label: supersetView.labels.get(currentPE.id) ?? '' })}
              </Badge>
            )}
            {deloadActive && (
              <Badge variant="secondary" className="mt-1 text-emerald-700 dark:text-emerald-400">
                {t('deloadWeek')}
              </Badge>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            asChild
            className="text-muted-foreground"
            aria-label={t('quit')}
          >
            <Link href="/">
              <X className="size-4" />
            </Link>
          </Button>
        </div>
        <Progress value={progressPct} className="mt-2 h-1.5" />
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
        <SessionEquipmentSelector
          options={currentInventory.equipment}
          selectedId={currentSelectedEquipmentId}
          onChange={(equipmentId) =>
            setSelectedEquipmentByExercise((current) => ({
              ...current,
              [currentPE.exerciseId]: equipmentId,
            }))
          }
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
                submissionDisabled={currentEquipmentSelectionRequired}
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
              sets={currentSets}
              historySets={currentHistorySets}
              lastPerformance={lastPerf}
              readiness={effectiveReadiness}
              deloadActive={deloadActive}
              unit={unit}
              recommendation={currentRecommendation}
              returnRecommendation={currentReturnRecommendation}
              loadConstraints={loadConstraintsFor(currentTarget)}
              equipmentSelectionRequired={currentEquipmentSelectionRequired}
              gym={sessionGym}
              onGymUpdated={setSessionGym}
              disabled={!hydrated || mode.kind !== 'input'}
              onSubmit={handleValidate}
              onUpdateSet={handleUpdateSet}
              onChangeSetEquipment={handleChangeSetEquipment}
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

        <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={goPrev}
            disabled={currentIdx === 0 || mode.kind !== 'input'}
            className="min-h-tap"
          >
            <ChevronLeft className="size-4" />
            <span className="ml-1">{t('previous')}</span>
          </Button>

          <Button
            variant="default"
            size="sm"
            onClick={() => setMode({ kind: 'summary' })}
            className="min-h-tap"
          >
            <Flag className="size-4" />
            <span className="ml-2">{t('finish')}</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={goNext}
            disabled={navNextIdx == null || mode.kind !== 'input'}
            className="min-h-tap"
          >
            <span className="mr-1">{t('next')}</span>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
    </main>
  );
}

function initialEquipmentSelections(
  session: SessionRunnerProps['session'],
): Record<string, string | null> {
  const selections: Record<string, string | null> = {};
  for (const programExercise of session.workout?.exercises ?? []) {
    const linked =
      session.gym?.equipment.filter((item) =>
        item.exerciseLinks.some((link) => link.exerciseId === programExercise.exerciseId),
      ) ?? [];
    const logged = [...session.sets]
      .reverse()
      .find(
        (set) =>
          set.exerciseId === programExercise.exerciseId &&
          set.gymEquipmentId != null &&
          linked.some((equipment) => equipment.id === set.gymEquipmentId),
      );
    if (logged?.gymEquipmentId) {
      selections[programExercise.exerciseId] = logged.gymEquipmentId;
      continue;
    }
    if (linked.length === 1) selections[programExercise.exerciseId] = linked[0]!.id;
  }
  return selections;
}

function resolveSessionExerciseInventory(
  sessionGym: SessionGym | null,
  pe: ProgramExerciseWithExercise,
): ResolvedExerciseInventory {
  if (!sessionGym) {
    return resolveExerciseInventory({
      inventoryMode: 'LEGACY',
      exercise: pe.exercise,
      linkedEquipment: [],
    });
  }
  const config = sessionGym.exerciseConfigs.find((item) => item.exerciseId === pe.exerciseId);
  const linkedEquipment = sessionGym.equipment
    .filter((item) => item.exerciseLinks.some((link) => link.exerciseId === pe.exerciseId))
    .map(toEquipmentLoadProfile);
  return resolveExerciseInventory({
    inventoryMode: sessionGym.inventoryMode,
    exercise: pe.exercise,
    linkedEquipment,
    legacyConfig: config,
    sharedDumbbellWeights: sessionGym.dumbbellWeights,
    legacyPlateWeights: sessionGym.plateWeights,
    legacyBarWeights: sessionGym.barWeights,
  });
}

function toEquipmentLoadProfile(item: SessionGymEquipment): EquipmentLoadProfile {
  return {
    equipmentId: item.id,
    equipmentName: item.name,
    equipmentType: item.equipmentType,
    loadType: item.loadType,
    weightOptions: item.weightOptions,
    selectedLoadMultiplier: item.selectedLoadMultiplier,
    baseLoadKg: item.baseLoadKg,
    loadingSides: item.loadingSides,
    platePoolId: item.platePoolId,
    platePoolName: item.platePool?.name ?? null,
    plates:
      item.platePool?.plates.map((plate) => ({
        weightKg: plate.weightKg,
        quantity: plate.quantity,
      })) ?? [],
  };
}
