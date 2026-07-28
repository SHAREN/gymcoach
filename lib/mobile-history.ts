import { db } from '@/lib/db';
import { sumCardioWorkingSets } from '@/lib/cardio';
import { getMonthQueryRange } from '@/lib/history-calendar';
import { applyBodyweight, best1RM, totalVolume } from '@/lib/stats';

export const MOBILE_HISTORY_SCHEMA_VERSION = 2;

export interface MobileHistoryProgram {
  id: string;
  name: string;
}

export interface MobileHistoryCardioSummary {
  durationSec: number;
  distanceM: number;
  avgHr: number | null;
}

export interface MobileHistorySet {
  id: string;
  setNumber: number;
  weight: number;
  effectiveWeight: number;
  reps: number;
  rir: number | null;
  durationSec: number | null;
  distanceM: number | null;
  avgHr: number | null;
  maxHr: number | null;
  notes: string | null;
  isWarmup: boolean;
  isDropSet: boolean;
  recoverySec: number | null;
  completedAt: string;
  gymEquipmentId: string | null;
  equipmentNameSnapshot: string | null;
  selectedLoadKg: number | null;
  selectedLoadMultiplierSnapshot: number | null;
  nominalResistanceKg: number | null;
  equipmentLoadSnapshot: unknown;
}

export interface MobileHistoryExercise {
  id: string;
  name: string;
  muscleGroup: string;
  category: string;
  usesBodyweight: boolean;
  equipmentType: string;
  volume: number;
  estimated1RM: number;
  cardio: MobileHistoryCardioSummary | null;
  sets: MobileHistorySet[];
}

export interface MobileHistorySession {
  id: string;
  programId: string | null;
  programName: string | null;
  workoutName: string | null;
  startedAt: string;
  finishedAt: string;
  gymId: string | null;
  durationMin: number;
  notes: string | null;
  sessionRpe: number | null;
  workingSets: number;
  volume: number;
  cardio: MobileHistoryCardioSummary | null;
  exercises: MobileHistoryExercise[];
}

export interface MobileHistorySnapshot {
  schemaVersion: typeof MOBILE_HISTORY_SCHEMA_VERSION;
  generatedAt: string;
  month: string;
  selectedProgramId: string | null;
  unit: 'KG' | 'LB';
  programs: MobileHistoryProgram[];
  sessions: MobileHistorySession[];
  hasAnyHistory: boolean;
}

export async function buildMobileHistory(
  userId: string,
  month: string,
  programId?: string,
  now: Date = new Date(),
): Promise<MobileHistorySnapshot> {
  const monthRange = getMonthQueryRange(month);
  const [sessions, programs, user, anyHistory] = await Promise.all([
    db.session.findMany({
      where: {
        userId,
        finishedAt: { not: null },
        startedAt: monthRange,
        ...(programId ? { programId } : {}),
      },
      orderBy: { startedAt: 'desc' },
      include: {
        workout: { select: { name: true } },
        program: { select: { name: true } },
        sets: {
          orderBy: [{ completedAt: 'asc' }, { setNumber: 'asc' }],
          include: {
            exercise: {
              select: {
                id: true,
                name: true,
                muscleGroup: true,
                category: true,
                usesBodyweight: true,
                equipmentType: true,
              },
            },
          },
        },
        exerciseMemberships: {
          orderBy: [{ addedAt: 'asc' }, { ordinal: 'asc' }],
          include: {
            exercise: {
              select: {
                id: true,
                name: true,
                muscleGroup: true,
                category: true,
                usesBodyweight: true,
                equipmentType: true,
              },
            },
          },
        },
      },
    }),
    db.program.findMany({
      where: { userId },
      orderBy: [{ isActive: 'desc' }, { startDate: 'desc' }],
      select: { id: true, name: true },
    }),
    db.user.findUnique({
      where: { id: userId },
      select: { bodyweight: true, unit: true },
    }),
    db.session.findFirst({
      where: { userId, finishedAt: { not: null } },
      select: { id: true },
    }),
  ]);

  if (!user) throw new Error('User not found.');

  return {
    schemaVersion: MOBILE_HISTORY_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    month,
    selectedProgramId: programId ?? null,
    unit: user.unit,
    programs,
    sessions: sessions.map((session) => {
      const adjustedAll = applyBodyweight(
        session.sets.map((set) => ({
          weight: set.weight,
          reps: set.reps,
          isWarmup: set.isWarmup,
          durationSec: set.durationSec,
          usesBodyweight: set.exercise.usesBodyweight,
        })),
        user.bodyweight,
      );
      const workingSets = session.sets.filter((set) => !set.isWarmup);
      const cardioSets = workingSets.filter(
        (set) => set.exercise.category === 'CARDIO' && set.durationSec != null,
      );
      const isCardio = workingSets.length > 0 && cardioSets.length === workingSets.length;
      const exerciseOrder = session.exerciseMemberships.map((membership) => membership.exerciseId);
      const byExercise = new Map<string, typeof session.sets>();
      const exerciseById = new Map(
        session.exerciseMemberships.map((membership) => [
          membership.exerciseId,
          membership.exercise,
        ]),
      );
      for (const set of session.sets) {
        const values = byExercise.get(set.exerciseId);
        if (values) values.push(set);
        else {
          if (!exerciseById.has(set.exerciseId)) exerciseOrder.push(set.exerciseId);
          byExercise.set(set.exerciseId, [set]);
        }
        exerciseById.set(set.exerciseId, set.exercise);
      }

      return {
        id: session.id,
        programId: session.programId,
        programName: session.program?.name ?? null,
        workoutName: session.workout?.name ?? null,
        startedAt: session.startedAt.toISOString(),
        finishedAt: session.finishedAt!.toISOString(),
        gymId: session.gymId,
        durationMin: Math.round(
          (session.finishedAt!.getTime() - session.startedAt.getTime()) / 60_000,
        ),
        notes: session.notes,
        sessionRpe: session.sessionRpe,
        workingSets: workingSets.length,
        volume: totalVolume(adjustedAll),
        cardio: isCardio ? cardioSummary(cardioSets) : null,
        exercises: exerciseOrder.flatMap((exerciseId) => {
          const sets = byExercise.get(exerciseId) ?? [];
          const exercise = exerciseById.get(exerciseId);
          if (!exercise) return [];
          const adjusted = applyBodyweight(
            sets.map((set) => ({
              weight: set.weight,
              reps: set.reps,
              isWarmup: set.isWarmup,
              durationSec: set.durationSec,
              usesBodyweight: exercise.usesBodyweight,
            })),
            user.bodyweight,
          );
          return [
            {
              id: exercise.id,
              name: exercise.name,
              muscleGroup: exercise.muscleGroup,
              category: exercise.category,
              usesBodyweight: exercise.usesBodyweight,
              equipmentType: exercise.equipmentType,
              volume: totalVolume(adjusted),
              estimated1RM: +best1RM(adjusted).toFixed(1),
              cardio: exercise.category === 'CARDIO' ? cardioSummary(sets) : null,
              sets: sets.map((set, index) => ({
                id: set.id,
                setNumber: set.setNumber,
                weight: set.weight,
                effectiveWeight: adjusted[index]!.weight,
                reps: set.reps,
                rir: set.rir,
                durationSec: set.durationSec,
                distanceM: set.distanceM,
                avgHr: set.avgHr,
                maxHr: set.maxHr,
                notes: set.notes,
                isWarmup: set.isWarmup,
                isDropSet: set.isDropSet,
                recoverySec: set.recoverySec,
                completedAt: set.completedAt.toISOString(),
                gymEquipmentId: set.gymEquipmentId,
                equipmentNameSnapshot: set.equipmentNameSnapshot,
                selectedLoadKg: set.selectedLoadKg,
                selectedLoadMultiplierSnapshot: set.selectedLoadMultiplierSnapshot,
                nominalResistanceKg: set.nominalResistanceKg,
                equipmentLoadSnapshot: set.equipmentLoadSnapshot,
              })),
            },
          ];
        }),
      };
    }),
    hasAnyHistory: anyHistory != null,
  };
}

function cardioSummary(
  sets: Array<{
    isWarmup: boolean;
    durationSec: number | null;
    distanceM: number | null;
    avgHr: number | null;
  }>,
): MobileHistoryCardioSummary {
  const totals = sumCardioWorkingSets(sets);
  return {
    durationSec: totals.durationSec,
    distanceM: totals.distanceM,
    avgHr: sets.find((set) => !set.isWarmup && set.avgHr != null)?.avgHr ?? null,
  };
}
