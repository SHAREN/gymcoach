import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDB, type PendingSet } from '@/lib/indexeddb';
import { flushPendingSets, queueSet } from '@/lib/sync';

vi.mock('@/lib/indexeddb', async () => {
  const actual = await vi.importActual<typeof import('@/lib/indexeddb')>('@/lib/indexeddb');
  return { ...actual, getDB: vi.fn() };
});

const originalOnline = Object.getOwnPropertyDescriptor(navigator, 'onLine');

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalOnline) Object.defineProperty(navigator, 'onLine', originalOnline);
});

function pendingSet(overrides: Partial<PendingSet> = {}): PendingSet {
  return {
    localId: 'loc_set_1',
    ownerId: 'user-1',
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
    createdAt: 1,
    status: 'pending',
    serverId: null,
    syncedAt: null,
    serverObservedAt: null,
    attempts: 0,
    lastError: null,
    lastHttpStatus: null,
    nextAttemptAt: null,
    ...overrides,
  };
}

function mockPendingTable(initialRows: PendingSet[]) {
  const rows = new Map(initialRows.map((row) => [row.localId, { ...row }]));
  const update = vi.fn(async (localId: string, patch: Partial<PendingSet>) => {
    const current = rows.get(localId);
    if (!current) return 0;
    rows.set(localId, { ...current, ...patch });
    return 1;
  });
  const pendingSets = {
    where: vi.fn().mockImplementation((field: keyof PendingSet) => ({
      anyOf: (values: unknown[]) => ({
        toArray: async () =>
          [...rows.values()].filter((row) => values.includes(row[field] as unknown)),
      }),
    })),
    get: vi.fn(async (localId: string) => rows.get(localId)),
    update,
  };
  vi.mocked(getDB).mockReturnValue({ pendingSets } as never);
  return { rows, update };
}

describe('flushPendingSets', () => {
  it('does not report success or start a POST when the durable local write fails', async () => {
    const add = vi.fn().mockRejectedValue(new Error('IndexedDB quota exceeded'));
    vi.mocked(getDB).mockReturnValue({ pendingSets: { add } } as never);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      queueSet({
        localId: 'loc_write_failure',
        ownerId: 'user-1',
        sessionId: 'session-1',
        exerciseId: 'exercise-1',
        setNumber: 1,
        weight: 100,
        reps: 8,
        rir: 2,
        notes: null,
        isWarmup: false,
        isDropSet: false,
      }),
    ).rejects.toThrow('IndexedDB quota exceeded');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('replays an interrupted POST with the exact client id and stores acknowledgement', async () => {
    const set = pendingSet({ status: 'syncing' });
    const { rows } = mockPendingTable([set]);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: set.localId,
          gymEquipmentId: 'equipment-1',
          equipmentNameSnapshot: 'Cable A',
          selectedLoadKg: 100,
          selectedLoadMultiplierSnapshot: 0.5,
          nominalResistanceKg: 50,
          equipmentLoadSnapshot: { version: 2 },
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await flushPendingSets({ ownerId: 'user-1', sessionId: 'session-1', force: true });

    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/session-1/sets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: set.localId,
        exerciseId: 'exercise-1',
        gymEquipmentId: null,
        setNumber: 1,
        weight: 100,
        reps: 8,
        rir: 2,
        durationSec: null,
        distanceM: null,
        notes: null,
        isWarmup: false,
        isDropSet: false,
      }),
    });
    expect(rows.get(set.localId)).toMatchObject({
      status: 'synced',
      serverId: set.localId,
      equipmentNameSnapshot: 'Cable A',
      nominalResistanceKg: 50,
      lastError: null,
      nextAttemptAt: null,
    });
  });

  it('patches an existing server row instead of posting a duplicate', async () => {
    const set = pendingSet({ serverId: 'server-1', syncedAt: 1, weight: 95, reps: 9, rir: 1 });
    const { rows } = mockPendingTable([set]);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'server-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await flushPendingSets({ ownerId: 'user-1', sessionId: 'session-1', force: true });

    expect(fetchMock).toHaveBeenCalledWith('/api/sets/server-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weight: 95, reps: 9, rir: 1 }),
    });
    expect(rows.get(set.localId)).toMatchObject({ status: 'synced', serverId: 'server-1' });
  });

  it('keeps validation/conflict failures visible and excludes them from automatic replay', async () => {
    const set = pendingSet();
    const { rows } = mockPendingTable([set]);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Set ID was already used with different data.' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await flushPendingSets({ ownerId: 'user-1', sessionId: 'session-1', force: true });
    await flushPendingSets({ ownerId: 'user-1', sessionId: 'session-1' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(rows.get(set.localId)).toMatchObject({
      status: 'failed',
      lastHttpStatus: 409,
      lastError: 'Set ID was already used with different data.',
      nextAttemptAt: null,
    });
  });

  it('uses bounded backoff for 5xx and timeout failures', async () => {
    const serverFailure = pendingSet({ localId: 'loc_5xx' });
    const timeoutFailure = pendingSet({ localId: 'loc_timeout', setNumber: 2 });
    const { rows } = mockPendingTable([serverFailure, timeoutFailure]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('server', { status: 503 }))
      .mockRejectedValueOnce(new Error('timeout'));
    vi.stubGlobal('fetch', fetchMock);
    const before = Date.now();

    await flushPendingSets({ ownerId: 'user-1', sessionId: 'session-1', force: true });

    for (const localId of ['loc_5xx', 'loc_timeout']) {
      expect(rows.get(localId)).toMatchObject({ status: 'pending', attempts: 1 });
      expect(rows.get(localId)!.nextAttemptAt).toBeGreaterThanOrEqual(before + 1_000);
      expect(rows.get(localId)!.nextAttemptAt).toBeLessThanOrEqual(before + 60_000);
    }
  });

  it('does not replay another authenticated owner queue', async () => {
    const owner = pendingSet({ localId: 'owner-row' });
    const other = pendingSet({ localId: 'other-row', ownerId: 'user-2', sessionId: 'session-2' });
    const { rows } = mockPendingTable([owner, other]);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: owner.localId }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await flushPendingSets({ ownerId: 'user-1', force: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(rows.get('owner-row')?.status).toBe('synced');
    expect(rows.get('other-row')?.status).toBe('pending');
  });

  it('drains a broader owner scope queued behind a blocked session flush', async () => {
    const first = pendingSet({ localId: 'session-1-row' });
    const second = pendingSet({
      localId: 'session-2-row',
      sessionId: 'session-2',
      setNumber: 2,
    });
    const { rows } = mockPendingTable([first, second]);
    let resolveFirst!: (response: Response) => void;
    const firstResponse = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => firstResponse)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: second.localId }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const sessionFlush = flushPendingSets({
      ownerId: 'user-1',
      sessionId: 'session-1',
      force: true,
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const ownerFlush = flushPendingSets({ ownerId: 'user-1', force: true });
    resolveFirst(
      new Response(JSON.stringify({ id: first.localId }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await Promise.all([sessionFlush, ownerFlush]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/sessions/session-1/sets',
      '/api/sessions/session-2/sets',
    ]);
    expect(rows.get(first.localId)?.status).toBe('synced');
    expect(rows.get(second.localId)?.status).toBe('synced');
  });

  it('replays an edit made while its initial POST is still in flight', async () => {
    const set = pendingSet();
    const { rows } = mockPendingTable([set]);
    let resolvePost!: (response: Response) => void;
    const postResponse = new Promise<Response>((resolve) => {
      resolvePost = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => postResponse)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: set.localId }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const initialFlush = flushPendingSets({
      ownerId: 'user-1',
      sessionId: 'session-1',
      force: true,
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    rows.set(set.localId, {
      ...rows.get(set.localId)!,
      weight: 105,
      reps: 7,
      status: 'pending',
      nextAttemptAt: null,
    });
    const editFlush = flushPendingSets({
      ownerId: 'user-1',
      sessionId: 'session-1',
      force: true,
    });
    resolvePost(
      new Response(JSON.stringify({ id: set.localId }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await Promise.all([initialFlush, editFlush]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/sessions/session-1/sets');
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      weight: 100,
      reps: 8,
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`/api/sets/${set.localId}`);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      weight: 105,
      reps: 7,
      rir: 2,
    });
    expect(rows.get(set.localId)).toMatchObject({
      weight: 105,
      reps: 7,
      status: 'synced',
      serverId: set.localId,
      nextAttemptAt: null,
    });
  });

  it('rejects a response that does not acknowledge the exact client id', async () => {
    const set = pendingSet();
    const { rows } = mockPendingTable([set]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: 'different-server-id' }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await flushPendingSets({ ownerId: 'user-1', sessionId: 'session-1', force: true });

    expect(rows.get(set.localId)).toMatchObject({
      status: 'failed',
      serverId: null,
      lastError: 'Server acknowledgement did not match the local set ID.',
    });
  });
});
