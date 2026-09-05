// ============================================================
// Sync queue: flush the pending sets to the API
// ============================================================
// Strategy:
// 1. A validated set is written to IndexedDB first.
// 2. The server receives the stable localId as Set.id, making POST replay
//    idempotent even when the original response was lost.
// 3. Startup/online/new-set triggers flush the durable queue.
// 4. A trigger that arrives during an active flush schedules another pass, so
//    a row added after the first pass snapshotted the queue cannot be stranded.

import { getDB, type PendingSet } from '@/lib/indexeddb';

export interface FlushResult {
  flushed: number;
  failed: number;
  pending: number;
  droppedEquipment: DroppedEquipment[];
}

export interface DroppedEquipment {
  localId: string;
  sessionId: string;
  gymEquipmentId: string;
}

type DroppedEquipmentListener = (dropped: DroppedEquipment[]) => void;

const droppedEquipmentListeners = new Set<DroppedEquipmentListener>();

export function onEquipmentDropped(listener: DroppedEquipmentListener): () => void {
  droppedEquipmentListeners.add(listener);
  return () => {
    droppedEquipmentListeners.delete(listener);
  };
}

let inFlight: Promise<FlushResult> | null = null;
let rerunRequested = false;

export async function flushPendingSets(): Promise<FlushResult> {
  if (inFlight) {
    rerunRequested = true;
    return inFlight;
  }
  inFlight = drainFlushes();
  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

async function drainFlushes(): Promise<FlushResult> {
  const aggregate: FlushResult = { flushed: 0, failed: 0, pending: 0, droppedEquipment: [] };
  do {
    rerunRequested = false;
    const result = await doFlush();
    aggregate.flushed += result.flushed;
    aggregate.failed += result.failed;
    aggregate.pending = result.pending;
    aggregate.droppedEquipment.push(...result.droppedEquipment);
  } while (rerunRequested);
  return aggregate;
}

async function doFlush(): Promise<FlushResult> {
  const db = getDB();
  const pending = await db.pendingSets
    .where('status')
    .anyOf(['pending', 'failed'])
    .sortBy('createdAt');

  let flushed = 0;
  let failed = 0;
  const droppedEquipment: DroppedEquipment[] = [];

  for (const item of pending) {
    if (!navigator.onLine) break;
    await db.pendingSets.update(item.localId, { status: 'syncing' });

    try {
      const payload = {
        id: item.localId,
        exerciseId: item.exerciseId,
        gymEquipmentId: item.gymEquipmentId ?? null,
        setNumber: item.setNumber,
        weight: item.weight,
        reps: item.reps,
        rir: item.rir,
        durationSec: item.durationSec ?? null,
        distanceM: item.distanceM ?? null,
        notes: item.notes,
        isWarmup: item.isWarmup,
        isDropSet: item.isDropSet,
      };
      const post = (gymEquipmentId: string | null) =>
        fetch(`/api/sessions/${item.sessionId}/sets`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, gymEquipmentId }),
        });

      let res = await post(payload.gymEquipmentId);
      if (res.status === 400 && payload.gymEquipmentId) {
        res = await post(null);
      }

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        const fatal = res.status === 400 || res.status === 404 || res.status === 409;
        await db.pendingSets.update(item.localId, {
          status: fatal ? 'failed' : 'pending',
          attempts: (item.attempts ?? 0) + 1,
          lastError: data?.error ?? `HTTP ${res.status}`,
        });
        failed += 1;
        continue;
      }

      const created = (await res.json()) as { id: string; gymEquipmentId?: string | null };
      // The stable client ID is the acknowledgement. A different server ID is
      // not success: retaining the row as failed is safer than silently losing
      // the only durable local copy and later creating a duplicate.
      if (created.id !== item.localId) {
        await db.pendingSets.update(item.localId, {
          status: 'failed',
          attempts: (item.attempts ?? 0) + 1,
          lastError: 'Server acknowledgement did not match the local set ID.',
        });
        failed += 1;
        continue;
      }

      const sentEquipmentId = payload.gymEquipmentId;
      const equipmentDropped = sentEquipmentId !== null && !created.gymEquipmentId;
      await db.pendingSets.update(item.localId, {
        status: 'synced',
        serverId: created.id,
        syncedAt: Date.now(),
        lastError: null,
        ...(equipmentDropped ? { gymEquipmentId: null } : {}),
      });
      if (equipmentDropped) {
        droppedEquipment.push({
          localId: item.localId,
          sessionId: item.sessionId,
          gymEquipmentId: sentEquipmentId,
        });
      }
      flushed += 1;
    } catch (err) {
      // Unknown outcome is deliberately retryable. If the POST actually
      // committed before the connection failed, replaying the same localId is
      // acknowledged by the server instead of inserting another row.
      await db.pendingSets.update(item.localId, {
        status: 'pending',
        attempts: (item.attempts ?? 0) + 1,
        lastError: err instanceof Error ? err.message : 'network',
      });
      failed += 1;
    }
  }

  const remaining = await db.pendingSets.where('status').anyOf(['pending', 'failed']).count();
  if (droppedEquipment.length > 0) {
    for (const listener of droppedEquipmentListeners) listener(droppedEquipment);
  }
  return { flushed, failed, pending: remaining, droppedEquipment };
}

export async function queueSet(
  set: Omit<
    PendingSet,
    'createdAt' | 'status' | 'serverId' | 'syncedAt' | 'attempts' | 'lastError'
  >,
): Promise<PendingSet> {
  const db = getDB();
  const record: PendingSet = {
    ...set,
    createdAt: Date.now(),
    status: 'pending',
    serverId: null,
    syncedAt: null,
    attempts: 0,
    lastError: null,
  };
  await db.pendingSets.add(record);
  void flushPendingSets();
  return record;
}

export async function pruneSyncedSets(maxAgeMs = 7 * 24 * 60 * 60 * 1000): Promise<number> {
  const db = getDB();
  const cutoff = Date.now() - maxAgeMs;
  return db.pendingSets
    .where('status')
    .equals('synced')
    .and((s) => (s.syncedAt ?? 0) < cutoff)
    .delete();
}

export function bindAutoSync(): () => void {
  if (typeof window === 'undefined') return () => {};
  const onOnline = () => {
    void flushPendingSets();
  };
  window.addEventListener('online', onOnline);
  if (navigator.onLine) void flushPendingSets();
  return () => window.removeEventListener('online', onOnline);
}
