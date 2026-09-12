import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    set: { findMany: vi.fn() },
    gymEquipment: { findMany: vi.fn() },
    gymExerciseConfig: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/set-equipment', () => ({
  resolveSetEquipmentSnapshot: vi.fn(),
}));

vi.mock('@/lib/mcp/workout-operation-audit', () => ({
  createWorkoutOperationAudit: vi.fn(),
}));

import { db } from '@/lib/db';
import { resolveSetEquipmentSnapshot } from '@/lib/set-equipment';
import { createWorkoutOperationAudit } from '@/lib/mcp/workout-operation-audit';
import {
  backfillHistoricalEquipment,
  previewHistoricalEquipmentBackfill,
} from '@/lib/mcp/historical-equipment-backfill';

const findSets = vi.mocked(db.set.findMany);
const findEquipment = vi.mocked(db.gymEquipment.findMany);
const findConfigs = vi.mocked(db.gymExerciseConfig.findMany);
const transaction = vi.mocked(db.$transaction);
const resolveSnapshot = vi.mocked(resolveSetEquipmentSnapshot);
const createAudit = vi.mocked(createWorkoutOperationAudit);

describe('historical equipment backfill', () => {
  beforeEach(() => {
    findSets.mockReset();
    findEquipment.mockReset();
    findConfigs.mockReset();
    transaction.mockReset();
    resolveSnapshot.mockReset();
    createAudit.mockReset();
  });

  it('previews missing equipment and exposes an evidence-only suggestion', async () => {
    findSets
      .mockResolvedValueOnce([
        {
          id: 'set-1',
          setNumber: 1,
          weight: 100,
          reps: 8,
          repsKnown: true,
          loadBasis: 'TOTAL',
          completedAt: new Date('2026-08-20T10:00:00.000Z'),
          exercise: { id: 'exercise-rdl', name: 'Romanian Deadlift', equipmentType: 'BARBELL' },
          session: {
            id: 'session-1',
            gymId: 'gym-xfit',
            startedAt: new Date('2026-08-20T09:30:00.000Z'),
            historicalDate: null,
            timePrecision: 'EXACT',
            gym: { id: 'gym-xfit', name: 'X-Fit' },
          },
        },
      ] as never)
      .mockResolvedValueOnce([] as never);
    findEquipment.mockResolvedValue([
      {
        id: 'bar-20',
        gymId: 'gym-xfit',
        name: '20 kg large-diameter barbell',
        equipmentType: 'BARBELL',
        loadType: 'PLATE_LOADED',
        exerciseLinks: [{ exerciseId: 'exercise-rdl' }],
      },
    ] as never);
    findConfigs.mockResolvedValue([
      { gymId: 'gym-xfit', exerciseId: 'exercise-rdl', preferredEquipmentId: 'bar-20' },
    ] as never);

    const result = await previewHistoricalEquipmentBackfill('user-1', {});

    expect(result.returnedMissingSets).toBe(1);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({
      gym: { id: 'gym-xfit', name: 'X-Fit' },
      exercise: { id: 'exercise-rdl', name: 'Romanian Deadlift' },
      missingSetIds: ['set-1'],
      suggestedEquipment: {
        equipmentId: 'bar-20',
        name: '20 kg large-diameter barbell',
        reason: 'ONLY_LINKED_EQUIPMENT',
      },
      suggestionIsConfirmation: false,
    });
    expect(result.guidance).toContain('not authorization');
  });

  it('refuses a batch that assigns one set to more than one equipment item', async () => {
    const result = await backfillHistoricalEquipment(
      'user-1',
      [
        { equipmentId: 'bar-a', setIds: ['set-1'] },
        { equipmentId: 'bar-b', setIds: ['set-1'] },
      ],
      null,
    );

    expect(result).toMatchObject({
      ok: false,
      errorCode: 'DUPLICATE_SET_ASSIGNMENT',
    });
    expect(findSets).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('never overwrites a historical set that already has equipment', async () => {
    findSets.mockResolvedValue([
      {
        id: 'set-1',
        sessionId: 'session-1',
        exerciseId: 'exercise-rdl',
        weight: 100,
        gymEquipmentId: 'existing-bar',
        session: { gymId: 'gym-xfit' },
      },
    ] as never);

    const result = await backfillHistoricalEquipment(
      'user-1',
      [{ equipmentId: 'bar-20', setIds: ['set-1'] }],
      null,
    );

    expect(result).toMatchObject({
      ok: false,
      errorCode: 'SET_ALREADY_HAS_EQUIPMENT',
      setIds: ['set-1'],
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('writes the full equipment snapshot atomically and creates an undoable audit', async () => {
    findSets.mockResolvedValue([
      {
        id: 'set-1',
        sessionId: 'session-1',
        exerciseId: 'exercise-rdl',
        weight: 105,
        gymEquipmentId: null,
        session: { gymId: 'gym-xfit' },
      },
    ] as never);
    resolveSnapshot.mockResolvedValue({
      gymEquipmentId: 'bar-20',
      equipmentNameSnapshot: '20 kg large-diameter barbell',
      selectedLoadKg: 105,
      selectedLoadMultiplierSnapshot: 1,
      nominalResistanceKg: null,
      equipmentLoadSnapshot: { version: 2, gymEquipmentId: 'bar-20' },
    } as never);
    createAudit.mockResolvedValue({
      operationId: 'operation-1',
      createdAt: '2026-09-12T18:00:00.000Z',
    });

    const before = [
      {
        id: 'set-1',
        gymEquipmentId: null,
        equipmentNameSnapshot: null,
        selectedLoadKg: null,
        selectedLoadMultiplierSnapshot: null,
        nominalResistanceKg: null,
        equipmentLoadSnapshot: null,
      },
    ];
    const after = [
      {
        id: 'set-1',
        gymEquipmentId: 'bar-20',
        equipmentNameSnapshot: '20 kg large-diameter barbell',
        selectedLoadKg: 105,
        selectedLoadMultiplierSnapshot: 1,
        nominalResistanceKg: null,
        equipmentLoadSnapshot: { version: 2, gymEquipmentId: 'bar-20' },
      },
    ];
    const currentRows = [
      {
        ...before[0]!,
        exerciseId: 'exercise-rdl',
        weight: 105,
        session: { gymId: 'gym-xfit' },
      },
    ];
    const tx = {
      set: {
        findMany: vi.fn().mockResolvedValueOnce(currentRows).mockResolvedValueOnce(after),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    transaction.mockImplementation(
      (async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as never,
    );

    const result = await backfillHistoricalEquipment(
      'user-1',
      [{ equipmentId: 'bar-20', setIds: ['set-1'] }],
      'Confirmed historical barbell identity',
    );

    expect(resolveSnapshot).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        userId: 'user-1',
        sessionGymId: 'gym-xfit',
        exerciseId: 'exercise-rdl',
        gymEquipmentId: 'bar-20',
        selectedLoadKg: 105,
        snapshotVersion: 2,
      }),
    );
    expect(tx.set.update).toHaveBeenCalledWith({
      where: { id: 'set-1' },
      data: expect.objectContaining({
        gymEquipmentId: 'bar-20',
        selectedLoadKg: 105,
      }),
    });
    expect(createAudit).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        operation: 'backfill_historical_equipment',
        reason: 'Confirmed historical barbell identity',
        undoSnapshot: { version: 2, kind: 'SET_EQUIPMENT_BACKFILL', before, after },
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      status: 'BACKFILLED',
      operationId: 'operation-1',
      updatedSetIds: ['set-1'],
      recoverable: true,
    });
  });
});
