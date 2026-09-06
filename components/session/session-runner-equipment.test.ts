import { describe, expect, it } from 'vitest';
import type { PendingSet } from '@/lib/indexeddb';
import {
  filterSetsForEquipment,
  sameEquipmentIdentity,
  selectLastPerformanceForEquipment,
  type SerializedLastPerformance,
} from './session-runner';

function pendingSet(id: string, equipmentId: string | null): PendingSet {
  return {
    localId: id,
    sessionId: 'session',
    exerciseId: 'exercise',
    setNumber: 1,
    weight: 50,
    reps: 10,
    rir: 2,
    durationSec: null,
    distanceM: null,
    notes: null,
    isWarmup: false,
    isDropSet: false,
    gymEquipmentId: equipmentId,
    createdAt: 1,
    status: 'synced',
    serverId: id,
    syncedAt: 1,
    attempts: 0,
    lastError: null,
  };
}

function performance(id: string | null, weight: number): SerializedLastPerformance {
  return {
    sessionStartedAt: '2026-08-01T10:00:00.000Z',
    gymEquipmentId: id,
    equipmentName: id,
    sets: [{ weight, reps: 8, rir: 2 }],
    maxWeight: weight,
    repsAtMaxWeight: 8,
    cardio: null,
  };
}

describe('session equipment history selection', () => {
  it('treats undefined and null as the same unscoped equipment identity', () => {
    expect(sameEquipmentIdentity(undefined, null)).toBe(true);
    expect(sameEquipmentIdentity('a', 'b')).toBe(false);
  });

  it('filters current sets to the selected machine', () => {
    const sets = [
      pendingSet('a', 'machine-a'),
      pendingSet('b', 'machine-b'),
      pendingSet('n', null),
    ];
    expect(filterSetsForEquipment(sets, 'machine-a').map((set) => set.localId)).toEqual(['a']);
    expect(filterSetsForEquipment(sets, null).map((set) => set.localId)).toEqual(['n']);
  });

  it('selects the previous performance for the selected machine only', () => {
    const a = performance('machine-a', 70);
    const b = performance('machine-b', 110);
    expect(selectLastPerformanceForEquipment([a, b], 'machine-a')).toBe(a);
    expect(selectLastPerformanceForEquipment([a, b], 'machine-b')).toBe(b);
    expect(selectLastPerformanceForEquipment([a, b], null)).toBeUndefined();
  });
});
