// ============================================================
// Sync queue: flush the pending sets to the API
// ============================================================
// Strategy:
// 1. When a set is validated locally, we write it to IndexedDB
//    (status='pending') and trigger a flush.
// 2. flushPendingSets() takes each pending one in order, attempts the POST
//    and marks it according to the result.
// 3. On app startup + on the 'online' event, we call flushPendingSets().
// 4. Retryable failures use a bounded backoff and also retry on startup,
//    online, focus/manual triggers. Permanent failures remain visible until
//    the user edits, retries, or deletes the exact row.

import { getDB, type PendingSet } from '@/lib/indexeddb';

export interface FlushResult {
  flushed: number;
  failed: number;
  pending: number;
}

export interface FlushScope {
  ownerId?: string;
  sessionId?: string;
  force?: boolean;
}

export const SET_SYNC_EVENT = 'gymcoach:set-sync-complete';

const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 60_000;

let drainPromise: Promise<FlushResult> | null = null;
const queuedScopes: FlushScope[] = [];
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function flushPendingSets(scope: FlushScope = {}): Promise<FlushResult> {
  enqueueScope(scope);
  if (!drainPromise) drainPromise = drainQueuedScopes();
  return drainPromise;
}

async function drainQueuedScopes(): Promise<FlushResult> {
  const aggregate: FlushResult = { flushed: 0, failed: 0, pending: 0 };
  let firstError: unknown = null;
  try {
    while (queuedScopes.length > 0) {
      const scope = queuedScopes.shift()!;
      try {
        const result = await doFlush(scope);
        aggregate.flushed += result.flushed;
        aggregate.failed += result.failed;
        aggregate.pending = result.pending;
        announceSync(scope);
      } catch (error) {
        firstError ??= error;
      }
    }
    if (firstError) throw firstError;
    return aggregate;
  } finally {
    // Clearing inside the drain closes the final empty-check race: any later
    // trigger sees no active promise and starts a new drain for its scope.
    drainPromise = null;
  }
}

function enqueueScope(scope: FlushScope): void {
  const queued = queuedScopes.find(
    (candidate) => candidate.ownerId === scope.ownerId && candidate.sessionId === scope.sessionId,
  );
  if (queued) {
    queued.force = Boolean(queued.force || scope.force);
    return;
  }
  queuedScopes.push({ ...scope });
}

async function doFlush(scope: FlushScope): Promise<FlushResult> {
  const db = getDB();
  const now = Date.now();
  const candidates = await db.pendingSets.where('status').anyOf(['pending', 'syncing']).toArray();
  const pending = candidates
    .filter((item) => matchesScope(item, scope))
    .filter((item) => scope.force || (item.nextAttemptAt ?? 0) <= now)
    .sort((a, b) => a.createdAt - b.createdAt || a.localId.localeCompare(b.localId));

  let flushed = 0;
  let failed = 0;

  for (const item of pending) {
    if (!navigator.onLine) {
      // No point trying if we know we are offline.
      break;
    }
    await db.pendingSets.update(item.localId, {
      status: 'syncing',
      ...(item.ownerId == null && scope.ownerId ? { ownerId: scope.ownerId } : {}),
    });

    try {
      const updatesExistingSet = item.serverId != null;
      const res = await fetch(
        updatesExistingSet ? `/api/sets/${item.serverId}` : `/api/sessions/${item.sessionId}/sets`,
        {
          method: updatesExistingSet ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            updatesExistingSet
              ? {
                  weight: item.weight,
                  reps: item.reps,
                  rir: item.rir,
                  ...(item.gymEquipmentId !== undefined
                    ? { gymEquipmentId: item.gymEquipmentId }
                    : {}),
                  ...(item.equipmentSnapshotAction
                    ? { equipmentSnapshotAction: item.equipmentSnapshotAction }
                    : {}),
                }
              : {
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
                },
          ),
        },
      );

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        const current = await db.pendingSets.get(item.localId);
        if (
          !current ||
          current.serverId !== item.serverId ||
          current.status === 'synced' ||
          !sameQueuedMutation(current, item)
        ) {
          continue;
        }
        const attempts = (item.attempts ?? 0) + 1;
        const retryable = isRetryableStatus(res.status);
        await db.pendingSets.update(item.localId, {
          status: retryable ? 'pending' : 'failed',
          attempts,
          lastError: data?.error ?? `HTTP ${res.status}`,
          lastHttpStatus: res.status,
          nextAttemptAt: retryable ? Date.now() + retryDelayMs(attempts, res) : null,
        });
        failed += 1;
        continue;
      }

      const saved = (await res.json()) as {
        id: string;
        gymEquipmentId?: string | null;
        equipmentNameSnapshot?: string | null;
        selectedLoadKg?: number | null;
        selectedLoadMultiplierSnapshot?: number | null;
        nominalResistanceKg?: number | null;
        equipmentLoadSnapshot?: unknown;
      };
      if (!updatesExistingSet && saved.id !== item.localId) {
        await db.pendingSets.update(item.localId, {
          status: 'failed',
          attempts: (item.attempts ?? 0) + 1,
          lastError: 'Server acknowledgement did not match the local set ID.',
          lastHttpStatus: res.status,
          nextAttemptAt: null,
        });
        failed += 1;
        continue;
      }
      const current = (await db.pendingSets.get(item.localId)) ?? item;
      const mutationUnchanged = sameQueuedMutation(current, item);
      await db.pendingSets.update(item.localId, {
        status: mutationUnchanged ? 'synced' : 'pending',
        serverId: item.serverId ?? saved.id,
        syncedAt: Date.now(),
        serverObservedAt: item.serverObservedAt ?? null,
        lastError: null,
        lastHttpStatus: null,
        nextAttemptAt: mutationUnchanged ? null : Date.now(),
        ...(mutationUnchanged
          ? {
              gymEquipmentId:
                saved.gymEquipmentId !== undefined
                  ? saved.gymEquipmentId
                  : (item.gymEquipmentId ?? null),
              equipmentNameSnapshot: saved.equipmentNameSnapshot ?? null,
              selectedLoadKg: saved.selectedLoadKg ?? null,
              selectedLoadMultiplierSnapshot: saved.selectedLoadMultiplierSnapshot ?? null,
              nominalResistanceKg: saved.nominalResistanceKg ?? null,
              equipmentLoadSnapshot: saved.equipmentLoadSnapshot ?? null,
              equipmentSnapshotAction: null,
            }
          : {}),
      });
      flushed += 1;
    } catch (err) {
      // Network error (offline, timeout): we keep 'pending' to retry later.
      const current = await db.pendingSets.get(item.localId);
      if (
        !current ||
        current.serverId !== item.serverId ||
        current.status === 'synced' ||
        !sameQueuedMutation(current, item)
      ) {
        continue;
      }
      const attempts = (item.attempts ?? 0) + 1;
      await db.pendingSets.update(item.localId, {
        status: 'pending',
        attempts,
        lastError: err instanceof Error ? err.message : 'network',
        lastHttpStatus: null,
        nextAttemptAt: Date.now() + retryDelayMs(attempts),
      });
      failed += 1;
    }
  }

  const remainingRows = await db.pendingSets
    .where('status')
    .anyOf(['pending', 'failed', 'syncing'])
    .toArray();
  const scopedRemaining = remainingRows.filter((item) => matchesScope(item, scope));
  scheduleRetry(scope, scopedRemaining);
  return { flushed, failed, pending: scopedRemaining.length };
}

// Helper: adds a set to the queue (status pending) and triggers a flush.
export async function queueSet(
  set: Omit<
    PendingSet,
    'createdAt' | 'status' | 'serverId' | 'syncedAt' | 'attempts' | 'lastError'
  > & { ownerId: string },
): Promise<PendingSet> {
  const db = getDB();
  const record: PendingSet = {
    ...set,
    createdAt: Date.now(),
    status: 'pending',
    serverId: null,
    syncedAt: null,
    serverObservedAt: null,
    attempts: 0,
    lastError: null,
    lastHttpStatus: null,
    nextAttemptAt: null,
  };
  await db.pendingSets.add(record);
  // Kick off the flush in the background (not awaited so as not to block the UI).
  void flushPendingSets({ ownerId: record.ownerId, sessionId: record.sessionId });
  return record;
}

// Deletes synced sets older than `maxAgeMs` to keep Dexie lightweight.
export async function pruneSyncedSets(maxAgeMs = 7 * 24 * 60 * 60 * 1000): Promise<number> {
  const db = getDB();
  const cutoff = Date.now() - maxAgeMs;
  return db.pendingSets
    .where('status')
    .equals('synced')
    .and((s) => s.serverObservedAt != null && (s.syncedAt ?? 0) < cutoff)
    .delete();
}

export async function retryPendingSet(
  localId: string,
  scope: Required<Pick<FlushScope, 'ownerId' | 'sessionId'>>,
): Promise<FlushResult> {
  const db = getDB();
  const row = await db.pendingSets.get(localId);
  if (!row || row.sessionId !== scope.sessionId) return { flushed: 0, failed: 0, pending: 0 };
  if (row.ownerId != null && row.ownerId !== scope.ownerId) {
    throw new Error('Set owner mismatch.');
  }
  await db.pendingSets.update(localId, {
    ownerId: scope.ownerId,
    status: 'pending',
    lastError: null,
    lastHttpStatus: null,
    nextAttemptAt: null,
  });
  return flushPendingSets({ ...scope, force: true });
}

export async function retrySessionSets(
  scope: Required<Pick<FlushScope, 'ownerId' | 'sessionId'>>,
): Promise<FlushResult> {
  const db = getDB();
  const rows = await db.pendingSets.where('sessionId').equals(scope.sessionId).toArray();
  const retryableIds = rows
    .filter((row) => row.ownerId == null || row.ownerId === scope.ownerId)
    .filter((row) => row.status !== 'synced' || row.serverId == null)
    .map((row) => row.localId);
  await db.transaction('rw', db.pendingSets, async () => {
    for (const localId of retryableIds) {
      await db.pendingSets.update(localId, {
        ownerId: scope.ownerId,
        status: 'pending',
        lastError: null,
        lastHttpStatus: null,
        nextAttemptAt: null,
      });
    }
  });
  return flushPendingSets({ ...scope, force: true });
}

// Hook event listener to start/stop the auto-sync on online/offline.
export function bindAutoSync(ownerId: string): () => void {
  if (typeof window === 'undefined') return () => {};
  const onOnline = () => {
    void flushPendingSets({ ownerId, force: true });
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === SET_SYNC_EVENT) dispatchLocalSyncEvent({ ownerId });
  };
  window.addEventListener('online', onOnline);
  window.addEventListener('storage', onStorage);
  // First flush on mount (in case some sets remain from the previous session).
  if (navigator.onLine) {
    void flushPendingSets({ ownerId });
  }
  return () => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('storage', onStorage);
  };
}

function matchesScope(item: PendingSet, scope: FlushScope): boolean {
  if (scope.sessionId && item.sessionId !== scope.sessionId) return false;
  if (!scope.ownerId) return true;
  if (item.ownerId === scope.ownerId) return true;
  // Legacy ownerless rows may be adopted only from the exact owned session
  // currently open in SessionRunner, never by the global bootstrap.
  return item.ownerId == null && scope.sessionId === item.sessionId;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function retryDelayMs(attempts: number, response?: Response): number {
  const retryAfter = response?.headers.get('Retry-After');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(RETRY_MAX_MS, Math.max(RETRY_BASE_MS, seconds * 1000));
    }
  }
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(6, Math.max(0, attempts - 1)));
}

function scheduleRetry(scope: FlushScope, rows: PendingSet[]): void {
  if (typeof window === 'undefined') return;
  const retryScope = { ownerId: scope.ownerId, sessionId: scope.sessionId };
  const timerKey = retryScopeKey(retryScope);
  const existingTimer = retryTimers.get(timerKey);
  if (existingTimer) {
    clearTimeout(existingTimer);
    retryTimers.delete(timerKey);
  }
  const earliest = rows
    .filter((row) => row.status === 'pending' && row.nextAttemptAt != null)
    .reduce<
      number | null
    >((minimum, row) => (minimum == null ? row.nextAttemptAt! : Math.min(minimum, row.nextAttemptAt!)), null);
  if (earliest == null) return;
  const delay = Math.min(RETRY_MAX_MS, Math.max(0, earliest - Date.now()));
  const retryTimer = setTimeout(() => {
    if (retryTimers.get(timerKey) !== retryTimer) return;
    retryTimers.delete(timerKey);
    if (navigator.onLine) void flushPendingSets(retryScope);
  }, delay);
  retryTimers.set(timerKey, retryTimer);
}

function retryScopeKey(scope: FlushScope): string {
  return `${scope.ownerId ?? '*'}\u0000${scope.sessionId ?? '*'}`;
}

function announceSync(scope: FlushScope): void {
  if (typeof window === 'undefined') return;
  dispatchLocalSyncEvent(scope);
  try {
    window.localStorage.setItem(SET_SYNC_EVENT, String(Date.now()));
  } catch {
    // Cross-tab notification is an enhancement; the durable queue is primary.
  }
}

function dispatchLocalSyncEvent(scope: FlushScope): void {
  window.dispatchEvent(new CustomEvent(SET_SYNC_EVENT, { detail: scope }));
}

function sameQueuedMutation(first: PendingSet, second: PendingSet): boolean {
  return (
    first.weight === second.weight &&
    first.reps === second.reps &&
    first.rir === second.rir &&
    (first.durationSec ?? null) === (second.durationSec ?? null) &&
    (first.distanceM ?? null) === (second.distanceM ?? null) &&
    first.notes === second.notes &&
    first.isWarmup === second.isWarmup &&
    first.isDropSet === second.isDropSet &&
    (first.gymEquipmentId ?? null) === (second.gymEquipmentId ?? null) &&
    (first.equipmentSnapshotAction ?? null) === (second.equipmentSnapshotAction ?? null)
  );
}
