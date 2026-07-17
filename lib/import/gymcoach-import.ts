import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@/prisma/generated/client';
import { getDateKeyInTimeZone } from '@/lib/history-calendar';
import { gymcoachSessionMetadata, type GymcoachCsvRow } from '@/lib/import/gymcoach-csv';
import type { EquipmentType, ExerciseCategory, MuscleGroup } from '@/lib/prisma-client';
import type { CsvLineError } from '@/lib/import/csv';

const IMPORTED_SESSION_PREFIX = 'gci_';
const SOURCE_HASH_LENGTH = 32;
const METADATA_HASH_LENGTH = 32;
const SESSION_ID_PREFIX_LENGTH = IMPORTED_SESSION_PREFIX.length + SOURCE_HASH_LENGTH + 1;
const LOAD_BATCH_SIZE = 5_000;

type Db = PrismaClient | Prisma.TransactionClient;

export interface GymcoachExistingSetSnapshot {
  exerciseName: string;
  muscleGroup: MuscleGroup;
  category: ExerciseCategory;
  usesBodyweight: boolean;
  setOrder: number;
  weightKg: number;
  reps: number;
  rir: number | null;
  isWarmup: boolean;
  isDropSet: boolean;
  notes: string | null;
  durationSec: number | null;
  distanceM: number | null;
  avgHr: number | null;
  maxHr: number | null;
}

export interface GymcoachExistingSessionSnapshot {
  id: string;
  startedAtIso: string;
  finishedAtIso: string | null;
  programName: string;
  workoutName: string;
  sets: GymcoachExistingSetSnapshot[];
}

export interface GymcoachExistingExerciseSnapshot {
  name: string;
  muscleGroup: MuscleGroup;
  category: ExerciseCategory;
  usesBodyweight: boolean;
}

export interface GymcoachImportSnapshot {
  exercises: GymcoachExistingExerciseSnapshot[];
  sessions: GymcoachExistingSessionSnapshot[];
  importedSessionIds: string[];
  existingSessionDates: string[];
}

export interface GymcoachNewExercise {
  name: string;
  muscleGroup: MuscleGroup;
  category: ExerciseCategory;
  usesBodyweight: boolean;
  equipmentType: EquipmentType;
}

export interface GymcoachPlannedSession {
  sourceSessionId: string;
  targetSessionId: string;
  startedAtIso: string;
  finishedAtIso: string;
  workoutName: string;
  rows: GymcoachCsvRow[];
}

export interface GymcoachImportPlan {
  sessions: GymcoachPlannedSession[];
  newExercises: GymcoachNewExercise[];
  totalSets: number;
  cardioSetCount: number;
  duplicateCount: number;
  existingSessionDates: string[];
  errors: CsvLineError[];
}

export interface GymcoachImportResult {
  createdSessions: number;
  createdSets: number;
  createdExercises: number;
}

function hash(value: string, length: number): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, length);
}

export function gymcoachTargetSessionPrefix(userId: string, sourceSessionId: string): string {
  return `${IMPORTED_SESSION_PREFIX}${hash(`${userId}\0${sourceSessionId}`, SOURCE_HASH_LENGTH)}_`;
}

export function gymcoachTargetSessionId(userId: string, row: GymcoachCsvRow): string {
  return (
    gymcoachTargetSessionPrefix(userId, row.sourceSessionId) +
    hash(gymcoachSessionMetadata(row), METADATA_HASH_LENGTH)
  );
}

function canonicalSet(set: GymcoachCsvRow | GymcoachExistingSetSnapshot): string {
  return JSON.stringify([
    set.exerciseName.trim().toLowerCase(),
    set.muscleGroup,
    set.category,
    set.usesBodyweight,
    set.setOrder,
    Object.is(set.weightKg, -0) ? 0 : set.weightKg,
    set.reps,
    set.rir,
    set.isWarmup,
    set.isDropSet,
    set.notes,
    set.durationSec,
    set.distanceM,
    set.avgHr,
    set.maxHr,
  ]);
}

function canonicalSets(sets: Array<GymcoachCsvRow | GymcoachExistingSetSnapshot>): string[] {
  return sets.map(canonicalSet).sort((left, right) => left.localeCompare(right));
}

function importedIdPrefix(id: string): string | null {
  if (!id.startsWith(IMPORTED_SESSION_PREFIX) || id.length <= SESSION_ID_PREFIX_LENGTH) {
    return null;
  }
  return id.slice(0, SESSION_ID_PREFIX_LENGTH);
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

export async function loadGymcoachImportSnapshot(
  client: Db,
  userId: string,
  rows: GymcoachCsvRow[],
): Promise<GymcoachImportSnapshot> {
  const sourceRows = [...new Map(rows.map((row) => [row.sourceSessionId, row])).values()];
  const targetIds = sourceRows.map((row) => gymcoachTargetSessionId(userId, row));
  const sourceIds = sourceRows.map((row) => row.sourceSessionId);

  const [exercises, importedIdRows] = await Promise.all([
    client.exercise.findMany({
      where: { userId },
      select: {
        name: true,
        muscleGroup: true,
        category: true,
        usesBodyweight: true,
      },
    }),
    client.session.findMany({
      where: { userId, id: { startsWith: IMPORTED_SESSION_PREFIX } },
      select: { id: true },
    }),
  ]);

  const importedSessionIds = importedIdRows.map((row) => row.id);
  const importedIdSet = new Set(importedSessionIds);
  const candidateIds = [
    ...new Set([...sourceIds, ...targetIds.filter((targetId) => importedIdSet.has(targetId))]),
  ];

  const sessionRows = (
    await Promise.all(
      chunks(candidateIds, LOAD_BATCH_SIZE).map((ids) =>
        client.session.findMany({
          where: { userId, id: { in: ids } },
          select: {
            id: true,
            startedAt: true,
            finishedAt: true,
            program: { select: { name: true } },
            workout: { select: { name: true } },
            sets: {
              select: {
                setNumber: true,
                weight: true,
                reps: true,
                rir: true,
                isWarmup: true,
                isDropSet: true,
                notes: true,
                durationSec: true,
                distanceM: true,
                avgHr: true,
                maxHr: true,
                exercise: {
                  select: {
                    name: true,
                    muscleGroup: true,
                    category: true,
                    usesBodyweight: true,
                  },
                },
              },
            },
          },
        }),
      ),
    )
  ).flat();

  let existingSessionDates: string[] = [];
  if (rows.length > 0) {
    const starts = rows.map((row) => new Date(row.startedAtIso).getTime());
    const rangeStart = new Date(Math.min(...starts) - 36 * 60 * 60 * 1000);
    const rangeEnd = new Date(Math.max(...starts) + 36 * 60 * 60 * 1000);
    const dateContracts = new Map<string, Set<string>>();
    for (const row of rows) {
      const dates = dateContracts.get(row.timeZone) ?? new Set<string>();
      dates.add(row.dateKey);
      dateContracts.set(row.timeZone, dates);
    }
    const nearbySessions = await client.session.findMany({
      where: { userId, startedAt: { gte: rangeStart, lte: rangeEnd } },
      select: { startedAt: true },
    });
    const matches = new Set<string>();
    for (const session of nearbySessions) {
      for (const [timeZone, dates] of dateContracts) {
        const dateKey = getDateKeyInTimeZone(session.startedAt, timeZone);
        if (dates.has(dateKey)) matches.add(dateKey);
      }
    }
    existingSessionDates = [...matches].sort();
  }

  return {
    exercises,
    importedSessionIds,
    existingSessionDates,
    sessions: sessionRows.map((session) => ({
      id: session.id,
      startedAtIso: session.startedAt.toISOString(),
      finishedAtIso: session.finishedAt?.toISOString() ?? null,
      programName: session.program?.name ?? '',
      workoutName: session.workout?.name ?? '',
      sets: session.sets.map((set) => ({
        exerciseName: set.exercise.name,
        muscleGroup: set.exercise.muscleGroup,
        category: set.exercise.category,
        usesBodyweight: set.exercise.usesBodyweight,
        setOrder: set.setNumber,
        weightKg: set.weight,
        reps: set.reps,
        rir: set.rir,
        isWarmup: set.isWarmup,
        isDropSet: set.isDropSet,
        notes: set.notes,
        durationSec: set.durationSec,
        distanceM: set.distanceM,
        avgHr: set.avgHr,
        maxHr: set.maxHr,
      })),
    })),
  };
}

export function buildGymcoachImportPlan(
  userId: string,
  rows: GymcoachCsvRow[],
  snapshot: GymcoachImportSnapshot,
): GymcoachImportPlan {
  const errorByLine = new Map<number, string>();
  const addSessionError = (sessionRows: GymcoachCsvRow[], reason: string) => {
    for (const row of sessionRows) {
      if (!errorByLine.has(row.line)) errorByLine.set(row.line, reason);
    }
  };

  const exercisesByLower = new Map<string, GymcoachExistingExerciseSnapshot[]>();
  for (const exercise of snapshot.exercises) {
    const key = exercise.name.trim().toLowerCase();
    const values = exercisesByLower.get(key) ?? [];
    values.push(exercise);
    exercisesByLower.set(key, values);
  }
  const sessionsById = new Map(snapshot.sessions.map((session) => [session.id, session]));
  const importedIdsByPrefix = new Map<string, string[]>();
  for (const id of snapshot.importedSessionIds) {
    const prefix = importedIdPrefix(id);
    if (!prefix) continue;
    const ids = importedIdsByPrefix.get(prefix) ?? [];
    ids.push(id);
    importedIdsByPrefix.set(prefix, ids);
  }

  const sourceSessions = new Map<string, GymcoachCsvRow[]>();
  for (const row of rows) {
    const sessionRows = sourceSessions.get(row.sourceSessionId) ?? [];
    sessionRows.push(row);
    sourceSessions.set(row.sourceSessionId, sessionRows);
  }

  const plannedSessions: GymcoachPlannedSession[] = [];
  let duplicateCount = 0;

  for (const sessionRows of sourceSessions.values()) {
    for (const row of sessionRows) {
      const existing = exercisesByLower.get(row.exerciseName.trim().toLowerCase()) ?? [];
      if (existing.length > 1) {
        addSessionError(
          sessionRows,
          `Exercise ${row.exerciseName} is ambiguous because multiple case-insensitive matches exist.`,
        );
        break;
      }
      const exercise = existing[0];
      if (
        exercise &&
        (exercise.muscleGroup !== row.muscleGroup ||
          exercise.category !== row.category ||
          exercise.usesBodyweight !== row.usesBodyweight)
      ) {
        addSessionError(
          sessionRows,
          `Exercise ${row.exerciseName} has incompatible muscle group, category or bodyweight semantics.`,
        );
        break;
      }
    }
    if (sessionRows.some((row) => errorByLine.has(row.line))) continue;

    const first = sessionRows[0]!;
    const targetId = gymcoachTargetSessionId(userId, first);
    const targetPrefix = gymcoachTargetSessionPrefix(userId, first.sourceSessionId);
    const original = sessionsById.get(first.sourceSessionId);
    const imported = sessionsById.get(targetId);
    const sameSourceImportedIds = importedIdsByPrefix.get(targetPrefix) ?? [];

    if (original && imported && original.id !== imported.id) {
      addSessionError(sessionRows, 'Source session identity maps to multiple owned sessions.');
      continue;
    }
    if (!original && !imported && sameSourceImportedIds.length > 0) {
      addSessionError(
        sessionRows,
        'This session_id was already imported with different session metadata.',
      );
      continue;
    }
    if (imported && sameSourceImportedIds.some((id) => id !== imported.id)) {
      addSessionError(sessionRows, 'Source session identity maps to multiple owned sessions.');
      continue;
    }
    if (original && sameSourceImportedIds.some((id) => id !== original.id)) {
      addSessionError(sessionRows, 'Source session identity maps to multiple owned sessions.');
      continue;
    }

    const existingSession = original ?? imported;
    if (existingSession) {
      const originalMetadataMatches =
        !original ||
        (existingSession.programName === first.programName &&
          existingSession.workoutName === first.workoutName);
      const timesMatch =
        existingSession.startedAtIso === first.startedAtIso &&
        existingSession.finishedAtIso === first.finishedAtIso;
      const setsMatch =
        canonicalSets(existingSession.sets).join('\n') === canonicalSets(sessionRows).join('\n');
      if (!originalMetadataMatches || !timesMatch || !setsMatch) {
        addSessionError(
          sessionRows,
          'This session_id already exists with different metadata or set contents.',
        );
        continue;
      }
      duplicateCount += sessionRows.length;
      continue;
    }

    plannedSessions.push({
      sourceSessionId: first.sourceSessionId,
      targetSessionId: targetId,
      startedAtIso: first.startedAtIso,
      finishedAtIso: first.finishedAtIso,
      workoutName: first.workoutName,
      rows: [...sessionRows].sort(
        (left, right) =>
          left.exerciseName.localeCompare(right.exerciseName) || left.setOrder - right.setOrder,
      ),
    });
  }

  const newExercisesByLower = new Map<string, GymcoachNewExercise>();
  for (const session of plannedSessions) {
    for (const row of session.rows) {
      const lower = row.exerciseName.trim().toLowerCase();
      if (exercisesByLower.has(lower) || newExercisesByLower.has(lower)) continue;
      const equipmentType: EquipmentType =
        row.category === 'CARDIO' ? 'CARDIO' : row.usesBodyweight ? 'BODYWEIGHT' : 'OTHER';
      newExercisesByLower.set(lower, {
        name: row.exerciseName,
        muscleGroup: row.muscleGroup,
        category: row.category,
        usesBodyweight: row.usesBodyweight,
        equipmentType,
      });
    }
  }

  const errors = [...errorByLine.entries()]
    .sort(([left], [right]) => left - right)
    .map(([line, reason]) => ({ line, reason }));
  return {
    sessions: plannedSessions.sort((left, right) =>
      left.startedAtIso.localeCompare(right.startedAtIso),
    ),
    newExercises: [...newExercisesByLower.values()].sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
    totalSets: plannedSessions.reduce((sum, session) => sum + session.rows.length, 0),
    cardioSetCount: plannedSessions.reduce(
      (sum, session) => sum + session.rows.filter((row) => row.category === 'CARDIO').length,
      0,
    ),
    duplicateCount,
    existingSessionDates: snapshot.existingSessionDates,
    errors,
  };
}

export async function executeGymcoachImport(
  tx: Db,
  userId: string,
  plan: GymcoachImportPlan,
): Promise<GymcoachImportResult> {
  const exercises = await tx.exercise.findMany({
    where: { userId },
    select: { id: true, name: true },
  });
  const exerciseIdByLower = new Map(
    exercises.map((exercise) => [exercise.name.trim().toLowerCase(), exercise.id]),
  );

  let createdExercises = 0;
  for (const exercise of plan.newExercises) {
    const lower = exercise.name.trim().toLowerCase();
    if (exerciseIdByLower.has(lower)) continue;
    const created = await tx.exercise.create({
      data: {
        userId,
        name: exercise.name,
        muscleGroup: exercise.muscleGroup,
        category: exercise.category,
        usesBodyweight: exercise.usesBodyweight,
        equipmentType: exercise.equipmentType,
        notes: 'Imported from GymCoach CSV.',
      },
    });
    exerciseIdByLower.set(lower, created.id);
    createdExercises++;
  }

  let createdSets = 0;
  for (const session of plan.sessions) {
    const startedAt = new Date(session.startedAtIso);
    await tx.session.create({
      data: {
        id: session.targetSessionId,
        userId,
        startedAt,
        finishedAt: new Date(session.finishedAtIso),
        notes: `Imported from GymCoach CSV - ${session.workoutName || 'Workout'}`,
      },
    });
    await tx.set.createMany({
      data: session.rows.map((row) => {
        const exerciseId = exerciseIdByLower.get(row.exerciseName.trim().toLowerCase());
        if (!exerciseId) throw new Error(`Unresolved exercise: ${row.exerciseName}`);
        return {
          sessionId: session.targetSessionId,
          exerciseId,
          setNumber: row.setOrder,
          weight: row.weightKg,
          reps: row.reps,
          rir: row.rir,
          isWarmup: row.isWarmup,
          isDropSet: row.isDropSet,
          notes: row.notes,
          durationSec: row.durationSec,
          distanceM: row.distanceM,
          avgHr: row.avgHr,
          maxHr: row.maxHr,
          completedAt: startedAt,
        };
      }),
    });
    createdSets += session.rows.length;
  }

  return {
    createdSessions: plan.sessions.length,
    createdSets,
    createdExercises,
  };
}
