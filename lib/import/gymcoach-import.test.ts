import { describe, expect, it } from 'vitest';
import type { GymcoachCsvRow } from './gymcoach-csv';
import {
  buildGymcoachImportPlan,
  gymcoachTargetSessionId,
  gymcoachTargetSessionPrefix,
  type GymcoachExistingSessionSnapshot,
  type GymcoachImportSnapshot,
} from './gymcoach-import';

const USER_ID = 'user-1';

function row(over: Partial<GymcoachCsvRow> = {}): GymcoachCsvRow {
  return {
    line: 2,
    sourceSessionId: 'source-1',
    dateKey: '2026-05-02',
    timeZone: 'UTC',
    sourceSetCount: 1,
    startedAtIso: '2026-05-02T09:00:00.000Z',
    finishedAtIso: '2026-05-02T10:00:00.000Z',
    programName: '',
    workoutName: 'Push',
    exerciseName: 'Bench',
    muscleGroup: 'CHEST',
    category: 'COMPOUND',
    usesBodyweight: false,
    setOrder: 1,
    weightKg: 80,
    reps: 8,
    rir: 2,
    isWarmup: false,
    isDropSet: false,
    notes: null,
    durationSec: null,
    distanceM: null,
    avgHr: null,
    maxHr: null,
    ...over,
  };
}

function snapshot(over: Partial<GymcoachImportSnapshot> = {}): GymcoachImportSnapshot {
  return {
    exercises: [],
    sessions: [],
    importedSessionIds: [],
    existingSessionDates: [],
    ...over,
  };
}

function existingSession(
  id: string,
  source: GymcoachCsvRow,
  over: Partial<GymcoachExistingSessionSnapshot> = {},
): GymcoachExistingSessionSnapshot {
  return {
    id,
    startedAtIso: source.startedAtIso,
    finishedAtIso: source.finishedAtIso,
    programName: source.programName,
    workoutName: source.workoutName,
    sets: [
      {
        exerciseName: source.exerciseName,
        muscleGroup: source.muscleGroup,
        category: source.category,
        usesBodyweight: source.usesBodyweight,
        setOrder: source.setOrder,
        weightKg: source.weightKg,
        reps: source.reps,
        rir: source.rir,
        isWarmup: source.isWarmup,
        isDropSet: source.isDropSet,
        notes: source.notes,
        durationSec: source.durationSec,
        distanceM: source.distanceM,
        avgHr: source.avgHr,
        maxHr: source.maxHr,
      },
    ],
    ...over,
  };
}

describe('GymCoach native import identity', () => {
  it('keeps byte-identical same-day sessions separate by source ID', () => {
    const first = row();
    const second = row({ line: 3, sourceSessionId: 'source-2' });
    const plan = buildGymcoachImportPlan(USER_ID, [first, second], snapshot());
    expect(plan.sessions).toHaveLength(2);
    expect(new Set(plan.sessions.map((session) => session.targetSessionId)).size).toBe(2);
    expect(plan.totalSets).toBe(2);
  });

  it('preserves duplicate row multiplicity inside one source session', () => {
    const first = row({ sourceSetCount: 2 });
    const second = row({ line: 3, sourceSetCount: 2 });
    const plan = buildGymcoachImportPlan(USER_ID, [first, second], snapshot());
    expect(plan.sessions).toHaveLength(1);
    expect(plan.sessions[0]?.rows).toHaveLength(2);
    expect(plan.totalSets).toBe(2);
  });

  it('makes target IDs deterministic per user, source ID and metadata', () => {
    const source = row();
    const id = gymcoachTargetSessionId(USER_ID, source);
    expect(id).toBe(gymcoachTargetSessionId(USER_ID, { ...source }));
    expect(id).toMatch(/^gci_[0-9a-f]{32}_[0-9a-f]{32}$/);
    expect(id.startsWith(gymcoachTargetSessionPrefix(USER_ID, source.sourceSessionId))).toBe(true);
    expect(gymcoachTargetSessionId('other-user', source)).not.toBe(id);
  });

  it('treats an exact deterministic target as a no-op', () => {
    const source = row();
    const targetId = gymcoachTargetSessionId(USER_ID, source);
    const plan = buildGymcoachImportPlan(
      USER_ID,
      [source],
      snapshot({
        sessions: [existingSession(targetId, source, { programName: '', workoutName: '' })],
        importedSessionIds: [targetId],
        exercises: [
          {
            name: 'Bench',
            muscleGroup: 'CHEST',
            category: 'COMPOUND',
            usesBodyweight: false,
          },
        ],
      }),
    );
    expect(plan.sessions).toEqual([]);
    expect(plan.totalSets).toBe(0);
    expect(plan.duplicateCount).toBe(1);
    expect(plan.errors).toEqual([]);
  });

  it('recognizes an exact same-user original Session.id as a no-op', () => {
    const source = row();
    const plan = buildGymcoachImportPlan(
      USER_ID,
      [source],
      snapshot({
        sessions: [existingSession(source.sourceSessionId, source)],
        exercises: [
          {
            name: 'Bench',
            muscleGroup: 'CHEST',
            category: 'COMPOUND',
            usesBodyweight: false,
          },
        ],
      }),
    );
    expect(plan.sessions).toEqual([]);
    expect(plan.duplicateCount).toBe(1);
    expect(plan.errors).toEqual([]);
  });

  it('rejects a changed or partial version of an existing source session', () => {
    const source = row();
    const targetId = gymcoachTargetSessionId(USER_ID, source);
    const changed = row({ weightKg: 81 });
    const plan = buildGymcoachImportPlan(
      USER_ID,
      [changed],
      snapshot({
        sessions: [existingSession(targetId, source, { programName: '', workoutName: '' })],
        importedSessionIds: [targetId],
        exercises: [
          {
            name: 'Bench',
            muscleGroup: 'CHEST',
            category: 'COMPOUND',
            usesBodyweight: false,
          },
        ],
      }),
    );
    expect(plan.sessions).toEqual([]);
    expect(plan.errors[0]?.reason).toMatch(/different metadata or set contents/i);
  });

  it('rejects a reused source ID with different session metadata', () => {
    const oldSource = row();
    const changedMetadata = row({
      startedAtIso: '2026-05-02T11:00:00.000Z',
      finishedAtIso: '2026-05-02T12:00:00.000Z',
    });
    const oldId = gymcoachTargetSessionId(USER_ID, oldSource);
    const plan = buildGymcoachImportPlan(
      USER_ID,
      [changedMetadata],
      snapshot({ importedSessionIds: [oldId] }),
    );
    expect(plan.sessions).toEqual([]);
    expect(plan.errors[0]?.reason).toMatch(/different session metadata/i);
  });
});

describe('GymCoach exercise semantics', () => {
  it('plans exact muscle/category/bodyweight metadata for new exercises', () => {
    const bodyweight = row({
      exerciseName: 'Weighted Pull-up',
      muscleGroup: 'BACK_WIDTH',
      category: 'COMPOUND',
      usesBodyweight: true,
      weightKg: 20,
    });
    const cardio = row({
      line: 3,
      sourceSessionId: 'source-2',
      exerciseName: 'Running',
      muscleGroup: 'OTHER',
      category: 'CARDIO',
      weightKg: 0,
      reps: 1,
      rir: null,
      durationSec: 1800,
    });
    const plan = buildGymcoachImportPlan(USER_ID, [bodyweight, cardio], snapshot());
    expect(plan.newExercises).toEqual([
      {
        name: 'Running',
        muscleGroup: 'OTHER',
        category: 'CARDIO',
        usesBodyweight: false,
        equipmentType: 'CARDIO',
      },
      {
        name: 'Weighted Pull-up',
        muscleGroup: 'BACK_WIDTH',
        category: 'COMPOUND',
        usesBodyweight: true,
        equipmentType: 'BODYWEIGHT',
      },
    ]);
  });

  it.each([
    { muscleGroup: 'BACK_WIDTH' as const },
    { category: 'CARDIO' as const },
    { usesBodyweight: true },
  ])('rejects an incompatible existing exercise: %o', (difference) => {
    const source = row();
    const plan = buildGymcoachImportPlan(
      USER_ID,
      [source],
      snapshot({
        exercises: [
          {
            name: 'bench',
            muscleGroup: 'CHEST',
            category: 'COMPOUND',
            usesBodyweight: false,
            ...difference,
          },
        ],
      }),
    );
    expect(plan.sessions).toEqual([]);
    expect(plan.errors[0]?.reason).toMatch(/incompatible/i);
  });

  it('rejects ambiguous case-insensitive exercise matches', () => {
    const source = row();
    const plan = buildGymcoachImportPlan(
      USER_ID,
      [source],
      snapshot({
        exercises: [
          {
            name: 'Bench',
            muscleGroup: 'CHEST',
            category: 'COMPOUND',
            usesBodyweight: false,
          },
          {
            name: 'bench',
            muscleGroup: 'CHEST',
            category: 'COMPOUND',
            usesBodyweight: false,
          },
        ],
      }),
    );
    expect(plan.sessions).toEqual([]);
    expect(plan.errors[0]?.reason).toMatch(/ambiguous/i);
  });
});
