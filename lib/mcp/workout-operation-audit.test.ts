import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/mcp/historical-workout-import', () => ({
  rederiveHistoricalWorkoutGoals: vi.fn(),
}));

import { db } from '@/lib/db';
import { rederiveHistoricalWorkoutGoals } from '@/lib/mcp/historical-workout-import';
import { undoMcpWorkoutOperation } from '@/lib/mcp/workout-operation-audit';

const transaction = vi.mocked(db.$transaction);
const rederiveGoals = vi.mocked(rederiveHistoricalWorkoutGoals);

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

const after: Array<{
  id: string;
  gymEquipmentId: string | null;
  equipmentNameSnapshot: string | null;
  selectedLoadKg: number | null;
  selectedLoadMultiplierSnapshot: number | null;
  nominalResistanceKg: number | null;
  equipmentLoadSnapshot: Record<string, unknown> | null;
}> = [
  {
    id: 'set-1',
    gymEquipmentId: 'bar-20',
    equipmentNameSnapshot: '20 kg barbell',
    selectedLoadKg: 105,
    selectedLoadMultiplierSnapshot: 1,
    nominalResistanceKg: null,
    equipmentLoadSnapshot: { version: 2, gymEquipmentId: 'bar-20' },
  },
];

function makeTx(current = after) {
  return {
    set: {
      findMany: vi.fn().mockResolvedValue(current),
      update: vi.fn().mockResolvedValue({}),
    },
    mcpOperationAudit: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'operation-1',
        operation: 'backfill_historical_equipment',
        undoneAt: null,
        undoSnapshot: {
          version: 2,
          kind: 'SET_EQUIPMENT_BACKFILL',
          before,
          after,
        },
      }),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({ id: 'undo-1' }),
    },
  };
}

describe('MCP operation audit equipment-backfill undo', () => {
  beforeEach(() => {
    transaction.mockReset();
    rederiveGoals.mockReset();
  });

  it('restores the exact prior equipment state when the audited after-state is unchanged', async () => {
    const tx = makeTx();
    transaction.mockImplementation(
      (async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as never,
    );

    const result = await undoMcpWorkoutOperation('user-1', 'operation-1');

    expect(tx.set.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['set-1'] }, session: { userId: 'user-1' } } }),
    );
    expect(tx.set.update).toHaveBeenCalledWith({
      where: { id: 'set-1' },
      data: {
        gymEquipmentId: null,
        equipmentNameSnapshot: null,
        selectedLoadKg: null,
        selectedLoadMultiplierSnapshot: null,
        nominalResistanceKg: null,
        equipmentLoadSnapshot: expect.anything(),
      },
    });
    expect(tx.mcpOperationAudit.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'operation-1' } }),
    );
    expect(result).toMatchObject({
      ok: true,
      status: 'UNDONE',
      operationId: 'operation-1',
      undoOperationId: 'undo-1',
      restoredSetEquipmentIds: ['set-1'],
    });
  });

  it('fails closed when a set changed after the backfill', async () => {
    const tx = makeTx([
      {
        ...after[0]!,
        selectedLoadKg: 110,
        equipmentLoadSnapshot: { version: 2, gymEquipmentId: 'bar-20', selectedLoadKg: 110 },
      },
    ]);
    transaction.mockImplementation(
      (async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as never,
    );

    const result = await undoMcpWorkoutOperation('user-1', 'operation-1');

    expect(result).toMatchObject({
      ok: false,
      status: 'NEEDS_RESOLUTION',
      errorCode: 'UNDO_SET_EQUIPMENT_CHANGED',
    });
    expect(tx.set.update).not.toHaveBeenCalled();
    expect(tx.mcpOperationAudit.update).not.toHaveBeenCalled();
    expect(tx.mcpOperationAudit.create).not.toHaveBeenCalled();
  });
});
