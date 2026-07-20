import { describe, expect, it } from 'vitest';
import type { PendingSet } from '@/lib/indexeddb';
import type { ResolvedExerciseInventory } from '@/lib/gym-loads';
import {
  buildSetEquipmentChangePatch,
  buildSetValueCorrectionPatch,
  filterSetsForEquipment,
  requiresEquipmentSelection,
  resolveSelectedEquipmentId,
  selectLastPerformanceForEquipment,
  selectReturnRecommendationForEquipment,
  type SerializedLastPerformance,
} from './session-runner';

function pendingSet(
  localId: string,
  gymEquipmentId: string | null,
  serverId: string | null = localId,
): PendingSet {
  return {
    localId,
    sessionId: 'session-1',
    exerciseId: 'exercise-1',
    setNumber: 1,
    weight: 40,
    reps: 10,
    rir: 2,
    notes: null,
    isWarmup: false,
    isDropSet: false,
    gymEquipmentId,
    createdAt: 1,
    status: 'synced',
    serverId,
    syncedAt: 1,
    attempts: 0,
    lastError: null,
  };
}

function performance(sessionId: string, gymEquipmentId: string | null): SerializedLastPerformance {
  return {
    sessionId,
    sessionStartedAt: '2026-07-01T10:00:00.000Z',
    gymEquipmentId,
    equipmentName: gymEquipmentId,
    sets: [
      {
        weight: 40,
        reps: 10,
        rir: 2,
        gymEquipmentId,
        nominalResistanceKg: 20,
      },
    ],
    maxWeight: 40,
    repsAtMaxWeight: 10,
    cardio: null,
  };
}

const equipmentInventory = {
  isAvailable: true,
  source: 'equipment',
  requiresEquipmentSelection: true,
  weightOptions: [],
  equipment: [{ equipmentId: 'cable-a' }, { equipmentId: 'cable-b' }],
  constraints: { equipmentType: 'CABLE' },
} as unknown as ResolvedExerciseInventory;

describe('session runner equipment identity helpers', () => {
  it('keeps current-session sets separated by exact equipment identity', () => {
    const cableA = pendingSet('a', 'cable-a');
    const cableB = pendingSet('b', 'cable-b');
    const legacy = pendingSet('legacy', null);

    expect(filterSetsForEquipment([cableA, cableB, legacy], 'cable-a')).toEqual([cableA]);
    expect(filterSetsForEquipment([cableA, cableB, legacy], 'cable-b')).toEqual([cableB]);
    expect(filterSetsForEquipment([cableA, cableB, legacy], null)).toEqual([legacy]);
  });

  it('selects prior performance only for the exact machine or null legacy identity', () => {
    const cableA = performance('session-a', 'cable-a');
    const cableB = performance('session-b', 'cable-b');
    const legacy = performance('session-legacy', null);
    const performances = [cableA, cableB, legacy];

    expect(selectLastPerformanceForEquipment(performances, 'cable-a')).toBe(cableA);
    expect(selectLastPerformanceForEquipment(performances, 'cable-b')).toBe(cableB);
    expect(selectLastPerformanceForEquipment(performances, null)).toBe(legacy);
  });

  it('selects return targets only for the exact machine identity', () => {
    const cableARecommendation = { mode: 'exercise-reintro', weightCeiling: 20 } as never;
    const cableBRecommendation = { mode: 'normal', weightCeiling: 60 } as never;
    const recommendations = [
      { gymId: 'gym-1', gymEquipmentId: 'cable-a', recommendation: cableARecommendation },
      { gymId: 'gym-1', gymEquipmentId: 'cable-b', recommendation: cableBRecommendation },
    ];

    expect(selectReturnRecommendationForEquipment(recommendations, 'cable-a')).toBe(
      cableARecommendation,
    );
    expect(selectReturnRecommendationForEquipment(recommendations, 'cable-b')).toBe(
      cableBRecommendation,
    );
    expect(selectReturnRecommendationForEquipment(recommendations, null)).toBeUndefined();
  });

  it('requires an explicit valid choice for multiple linked machines and auto-resolves one', () => {
    expect(resolveSelectedEquipmentId(equipmentInventory, null)).toBeNull();
    expect(requiresEquipmentSelection(equipmentInventory, null)).toBe(true);
    expect(resolveSelectedEquipmentId(equipmentInventory, 'cable-a')).toBe('cable-a');
    expect(resolveSelectedEquipmentId(equipmentInventory, 'deleted-machine')).toBeNull();

    const singleInventory = {
      ...equipmentInventory,
      equipment: [equipmentInventory.equipment[0]!],
      requiresEquipmentSelection: false,
    };
    expect(resolveSelectedEquipmentId(singleInventory, null)).toBe('cable-a');
    expect(requiresEquipmentSelection(singleInventory, null)).toBe(false);
  });

  it('uses a preference for a new workout but keeps an explicit current selection authoritative', () => {
    const preferredInventory = {
      ...equipmentInventory,
      preferredEquipmentId: 'cable-b',
    };

    expect(resolveSelectedEquipmentId(preferredInventory, null)).toBe('cable-b');
    expect(requiresEquipmentSelection(preferredInventory, null)).toBe(false);
    expect(resolveSelectedEquipmentId(preferredInventory, 'cable-a')).toBe('cable-a');
  });

  it('keeps ordinary value corrections free of equipment mutations', () => {
    const patch = buildSetValueCorrectionPatch({ weight: 45, reps: 9, rir: 1 });

    expect(patch).toEqual({
      weight: 45,
      reps: 9,
      rir: 1,
      status: 'pending',
      attempts: 0,
      lastError: null,
      lastHttpStatus: null,
      nextAttemptAt: null,
    });
    expect(patch).not.toHaveProperty('gymEquipmentId');
    expect(patch).not.toHaveProperty('equipmentSnapshotAction');
  });

  it('builds REPLACE and CLEAR only for explicit synced equipment changes', () => {
    const synced = pendingSet('synced', 'cable-a', 'server-1');
    const unsynced = pendingSet('unsynced', 'cable-a', null);

    expect(buildSetEquipmentChangePatch(synced, 'cable-b')).toMatchObject({
      gymEquipmentId: 'cable-b',
      equipmentSnapshotAction: 'REPLACE',
    });
    expect(buildSetEquipmentChangePatch(synced, null)).toMatchObject({
      gymEquipmentId: null,
      equipmentSnapshotAction: 'CLEAR',
    });
    expect(buildSetEquipmentChangePatch(unsynced, 'cable-b')).toMatchObject({
      gymEquipmentId: 'cable-b',
      equipmentSnapshotAction: null,
    });
  });
});
