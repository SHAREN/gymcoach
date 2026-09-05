import { describe, expect, it } from 'vitest';
import type { Set as PrismaSet } from '@/lib/prisma-client';
import type { PendingSet } from '@/lib/indexeddb';
import { reconcileHydratedSets } from '@/lib/sync-hydration';

function localSet(overrides: Partial<PendingSet> = {}): PendingSet {
  return {
    localId: 'loc_unknown_outcome',
    sessionId: 'session-1',
    exerciseId: 'exercise-1',
    setNumber: 1,
    weight: 80,
    reps: 8,
    rir: 2,
    notes: null,
    isWarmup: false,
    isDropSet: false,
    createdAt: 100,
    status: 'pending',
    serverId: null,
    syncedAt: null,
    attempts: 1,
    lastError: 'connection reset after send',
    ...overrides,
  };
}

function serverSet(overrides: Partial<PrismaSet> = {}): PrismaSet {
  return {
    id: 'loc_unknown_outcome',
    sessionId: 'session-1',
    exerciseId: 'exercise-1',
    gymEquipmentId: null,
    equipmentNameSnapshot: null,
    equipmentLoadSnapshot: null,
    setNumber: 1,
    weight: 80,
    reps: 8,
    rir: 2,
    durationSec: null,
    distanceM: null,
    avgHr: null,
    maxHr: null,
    track: null,
    notes: null,
    isWarmup: false,
    isDropSet: false,
    completedAt: new Date(200),
    ...overrides,
  } as PrismaSet;
}

describe('sync hydration acknowledgement', () => {
  it('acknowledges an unknown-outcome POST by the exact client-generated server ID', () => {
    const local = localSet();
    const result = reconcileHydratedSets('session-1', [local], [serverSet()]);

    expect(result.deleteLocalIds).toEqual([]);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      localId: 'loc_unknown_outcome',
      serverId: 'loc_unknown_outcome',
      status: 'synced',
      weight: 80,
      reps: 8,
    });
  });

  it('removes a synthetic duplicate but keeps the durable client row identity', () => {
    const local = localSet({ status: 'synced', serverId: 'loc_unknown_outcome', lastError: null });
    const duplicate = localSet({
      localId: 'srv_loc_unknown_outcome',
      status: 'synced',
      serverId: 'loc_unknown_outcome',
      lastError: null,
    });
    const result = reconcileHydratedSets('session-1', [duplicate, local], [serverSet()]);

    expect(result.deleteLocalIds).toEqual(['srv_loc_unknown_outcome']);
    expect(result.records[0]?.localId).toBe('loc_unknown_outcome');
  });

  it('does not delete a pending local row just because one server GET does not contain it', () => {
    const pending = localSet({ localId: 'loc_still_pending' });
    const result = reconcileHydratedSets('session-1', [pending], []);

    expect(result.deleteLocalIds).toEqual([]);
    expect(result.records).toEqual([pending]);
  });
});
