import { describe, expect, it } from 'vitest';
import type { Set as PrismaSet } from '@/lib/prisma-client';
import type { PendingSet } from '@/lib/indexeddb';
import { hasUnsyncedSets, localSetIdsForDeletion, reconcileHydratedSets } from './sync-hydration';

function serverSet(id: string, setNumber = 1): PrismaSet {
  return {
    id,
    sessionId: 'session-1',
    exerciseId: 'exercise-1',
    gymEquipmentId: null,
    equipmentNameSnapshot: null,
    selectedLoadKg: null,
    selectedLoadMultiplierSnapshot: null,
    nominalResistanceKg: null,
    equipmentLoadSnapshot: null,
    setNumber,
    weight: 100,
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
    recoverySec: null,
    completedAt: new Date('2026-07-13T10:00:00.000Z'),
  };
}

function localSet(overrides: Partial<PendingSet> = {}): PendingSet {
  return {
    localId: 'local-1',
    sessionId: 'session-1',
    exerciseId: 'exercise-1',
    setNumber: 1,
    weight: 100,
    reps: 8,
    rir: 2,
    durationSec: null,
    distanceM: null,
    notes: null,
    isWarmup: false,
    isDropSet: false,
    createdAt: Date.parse('2026-07-13T10:00:00.000Z'),
    status: 'synced',
    serverId: 'server-1',
    syncedAt: Date.parse('2026-07-13T10:00:00.000Z'),
    attempts: 0,
    lastError: null,
    ...overrides,
  };
}

describe('reconcileHydratedSets', () => {
  it('keeps the original local identity instead of inserting a second server copy', () => {
    const result = reconcileHydratedSets('session-1', [localSet()], [serverSet('server-1')]);

    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.localId).toBe('local-1');
    expect(result.deleteLocalIds).toEqual([]);
  });

  it('removes duplicate cache rows for the same server set', () => {
    const result = reconcileHydratedSets(
      'session-1',
      [localSet(), localSet({ localId: 'srv_server-1' })],
      [serverSet('server-1')],
    );

    expect(result.records[0]?.localId).toBe('local-1');
    expect(result.deleteLocalIds).toEqual(['srv_server-1']);
  });

  it('preserves an unsynced local edit over the older server snapshot', () => {
    const edited = localSet({ status: 'pending', weight: 95, reps: 9 });
    const result = reconcileHydratedSets(
      'session-1',
      [edited, localSet({ localId: 'srv_server-1' })],
      [serverSet('server-1')],
    );

    expect(result.records[0]).toMatchObject({
      ...edited,
      serverObservedAt: expect.any(Number),
    });
    expect(result.deleteLocalIds).toEqual(['srv_server-1']);
  });

  it('acknowledges an unknown-outcome POST by matching the exact client id', () => {
    const unknownOutcome = localSet({
      localId: 'loc_unknown_outcome',
      serverId: null,
      status: 'pending',
      syncedAt: null,
    });
    const result = reconcileHydratedSets(
      'session-1',
      [unknownOutcome],
      [serverSet('loc_unknown_outcome')],
      { ownerId: 'user-1' },
    );

    expect(result.records[0]).toMatchObject({
      localId: 'loc_unknown_outcome',
      ownerId: 'user-1',
      status: 'synced',
      serverId: 'loc_unknown_outcome',
    });
    expect(result.deleteLocalIds).toEqual([]);
  });

  it('never prunes omitted local rows from a potentially stale server snapshot', () => {
    const pending = localSet({
      localId: 'pending-2',
      serverId: null,
      status: 'pending',
      setNumber: 2,
    });
    const result = reconcileHydratedSets('session-1', [localSet(), pending], []);

    expect(result.records).toEqual([]);
    expect(result.deleteLocalIds).toEqual([]);
  });

  it('does not prune a recently synced row when the server snapshot may be stale', () => {
    const result = reconcileHydratedSets('session-1', [localSet()], []);

    expect(result.deleteLocalIds).toEqual([]);
  });
});

describe('localSetIdsForDeletion', () => {
  it('removes every local copy of the same synced server set', () => {
    const target = localSet();
    const duplicate = localSet({ localId: 'srv_server-1' });
    const other = localSet({ localId: 'local-2', serverId: 'server-2', setNumber: 2 });

    expect(localSetIdsForDeletion(target, [target, duplicate, other])).toEqual([
      'local-1',
      'srv_server-1',
    ]);
  });

  it('removes only the selected unsynced row when no server id exists', () => {
    const target = localSet({ serverId: null, status: 'pending' });
    const other = localSet({ localId: 'local-2', serverId: null, status: 'pending' });

    expect(localSetIdsForDeletion(target, [target, other])).toEqual(['local-1']);
  });
});

describe('hasUnsyncedSets', () => {
  it('requires both synced status and a server id before session finish', () => {
    expect(hasUnsyncedSets([localSet()])).toBe(false);
    expect(hasUnsyncedSets([localSet({ status: 'syncing', serverId: null })])).toBe(true);
    expect(hasUnsyncedSets([localSet({ status: 'failed', serverId: null })])).toBe(true);
    expect(hasUnsyncedSets([localSet({ status: 'pending', serverId: 'server-1' })])).toBe(true);
  });
});
