import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDB, type PendingSet } from '@/lib/indexeddb';
import { flushPendingSets } from '@/lib/sync';

vi.mock('@/lib/indexeddb', async () => {
  const actual = await vi.importActual<typeof import('@/lib/indexeddb')>('@/lib/indexeddb');
  return { ...actual, getDB: vi.fn() };
});

const originalOnline = Object.getOwnPropertyDescriptor(navigator, 'onLine');

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalOnline) {
    Object.defineProperty(navigator, 'onLine', originalOnline);
  }
});

describe('flushPendingSets', () => {
  it('patches an existing server set instead of posting a duplicate', async () => {
    const set: PendingSet = {
      localId: 'local-1',
      sessionId: 'session-1',
      exerciseId: 'exercise-1',
      setNumber: 1,
      weight: 95,
      reps: 9,
      rir: 1,
      durationSec: null,
      distanceM: null,
      notes: null,
      isWarmup: false,
      isDropSet: false,
      createdAt: 1,
      status: 'pending',
      serverId: 'server-1',
      syncedAt: 1,
      attempts: 0,
      lastError: null,
    };
    const update = vi.fn().mockResolvedValue(1);
    const query = {
      sortBy: vi.fn().mockResolvedValue([set]),
      count: vi.fn().mockResolvedValue(0),
    };
    const pendingSets = {
      where: vi.fn().mockReturnValue({ anyOf: vi.fn().mockReturnValue(query) }),
      update,
    };
    vi.mocked(getDB).mockReturnValue({ pendingSets } as never);
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'server-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await flushPendingSets();

    expect(fetchMock).toHaveBeenCalledWith('/api/sets/server-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weight: 95, reps: 9, rir: 1 }),
    });
    expect(update).toHaveBeenLastCalledWith(
      'local-1',
      expect.objectContaining({ status: 'synced', serverId: 'server-1' }),
    );
  });

  it('posts selected equipment and persists the returned immutable snapshot', async () => {
    const set: PendingSet = {
      localId: 'local-equipment',
      sessionId: 'session-1',
      exerciseId: 'exercise-1',
      setNumber: 1,
      weight: 50,
      reps: 10,
      rir: 2,
      durationSec: null,
      distanceM: null,
      notes: null,
      isWarmup: false,
      isDropSet: false,
      gymEquipmentId: 'equipment-1',
      createdAt: 1,
      status: 'pending',
      serverId: null,
      syncedAt: null,
      attempts: 0,
      lastError: null,
    };
    const update = vi.fn().mockResolvedValue(1);
    const query = {
      sortBy: vi.fn().mockResolvedValue([set]),
      count: vi.fn().mockResolvedValue(0),
    };
    vi.mocked(getDB).mockReturnValue({
      pendingSets: {
        where: vi.fn().mockReturnValue({ anyOf: vi.fn().mockReturnValue(query) }),
        update,
      },
    } as never);
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'server-equipment',
          gymEquipmentId: 'equipment-1',
          equipmentNameSnapshot: 'Cable A',
          selectedLoadKg: 50,
          selectedLoadMultiplierSnapshot: 0.5,
          nominalResistanceKg: 25,
          equipmentLoadSnapshot: { version: 1, loadType: 'SELECTORIZED' },
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await flushPendingSets();

    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/session-1/sets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        exerciseId: 'exercise-1',
        gymEquipmentId: 'equipment-1',
        setNumber: 1,
        weight: 50,
        reps: 10,
        rir: 2,
        durationSec: null,
        distanceM: null,
        notes: null,
        isWarmup: false,
        isDropSet: false,
      }),
    });
    expect(update).toHaveBeenLastCalledWith(
      'local-equipment',
      expect.objectContaining({
        status: 'synced',
        gymEquipmentId: 'equipment-1',
        equipmentNameSnapshot: 'Cable A',
        selectedLoadMultiplierSnapshot: 0.5,
        nominalResistanceKg: 25,
      }),
    );
  });

  it('sends an explicit snapshot replacement when a synced set changes machines', async () => {
    const set: PendingSet = {
      localId: 'local-replace',
      sessionId: 'session-1',
      exerciseId: 'exercise-1',
      setNumber: 1,
      weight: 60,
      reps: 8,
      rir: 1,
      notes: null,
      isWarmup: false,
      isDropSet: false,
      gymEquipmentId: 'equipment-2',
      equipmentSnapshotAction: 'REPLACE',
      createdAt: 1,
      status: 'pending',
      serverId: 'server-1',
      syncedAt: 1,
      attempts: 0,
      lastError: null,
    };
    const query = {
      sortBy: vi.fn().mockResolvedValue([set]),
      count: vi.fn().mockResolvedValue(0),
    };
    vi.mocked(getDB).mockReturnValue({
      pendingSets: {
        where: vi.fn().mockReturnValue({ anyOf: vi.fn().mockReturnValue(query) }),
        update: vi.fn().mockResolvedValue(1),
      },
    } as never);
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'server-1', gymEquipmentId: 'equipment-2' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await flushPendingSets();

    expect(fetchMock).toHaveBeenCalledWith('/api/sets/server-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        weight: 60,
        reps: 8,
        rir: 1,
        gymEquipmentId: 'equipment-2',
        equipmentSnapshotAction: 'REPLACE',
      }),
    });
  });
});
