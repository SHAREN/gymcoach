// Reconcile server session sets into the durable IndexedDB queue without
// creating a second local copy for a client-ID POST that the server already
// committed. Absence from one GET is never treated as acknowledgement that a
// pending local row may be discarded.

import type { Set as PrismaSet } from '@/lib/prisma-client';
import { getDB, type PendingSet } from '@/lib/indexeddb';

export interface HydrationReconciliation {
  records: PendingSet[];
  deleteLocalIds: string[];
}

function pendingSetFromServer(
  sessionId: string,
  serverSet: PrismaSet,
  localId = `srv_${serverSet.id}`,
): PendingSet {
  const completedAt = new Date(serverSet.completedAt).getTime();
  return {
    localId,
    sessionId,
    exerciseId: serverSet.exerciseId,
    gymEquipmentId: serverSet.gymEquipmentId,
    setNumber: serverSet.setNumber,
    weight: serverSet.weight,
    reps: serverSet.reps,
    rir: serverSet.rir,
    durationSec: serverSet.durationSec,
    distanceM: serverSet.distanceM,
    notes: serverSet.notes,
    isWarmup: serverSet.isWarmup,
    isDropSet: serverSet.isDropSet,
    createdAt: completedAt,
    status: 'synced',
    serverId: serverSet.id,
    syncedAt: completedAt,
    attempts: 0,
    lastError: null,
  };
}

export function reconcileHydratedSets(
  sessionId: string,
  existing: readonly PendingSet[],
  serverSets: readonly PrismaSet[],
): HydrationReconciliation {
  const records: PendingSet[] = [];
  const deleteLocalIds = new Set<string>();
  const serverIds = new Set(serverSets.map((set) => set.id));

  for (const serverSet of serverSets) {
    // serverSet.id === localId is the durable acknowledgement for a replayable
    // POST. serverId covers rows already acknowledged by an earlier flush.
    const matches = existing.filter(
      (set) => set.serverId === serverSet.id || set.localId === serverSet.id,
    );
    const chosen =
      matches.find((set) => !set.localId.startsWith('srv_')) ??
      matches.find((set) => set.status !== 'synced') ??
      matches[0];

    for (const duplicate of matches) {
      if (duplicate.localId !== chosen?.localId) deleteLocalIds.add(duplicate.localId);
    }

    records.push(pendingSetFromServer(sessionId, serverSet, chosen?.localId));
  }

  for (const localSet of existing) {
    if (
      (localSet.serverId && serverIds.has(localSet.serverId)) ||
      serverIds.has(localSet.localId)
    ) {
      continue;
    }
    // A GET can race a successful POST or be served from a stale cache. Keep
    // the durable local row until a server row explicitly acknowledges it.
    records.push(localSet);
  }

  return { records, deleteLocalIds: [...deleteLocalIds] };
}

export async function hydrateFromServerSets(
  sessionId: string,
  serverSets: PrismaSet[],
): Promise<void> {
  const db = getDB();
  await db.transaction('rw', db.pendingSets, async () => {
    const existing = await db.pendingSets.where('sessionId').equals(sessionId).toArray();
    const reconciliation = reconcileHydratedSets(sessionId, existing, serverSets);
    if (reconciliation.deleteLocalIds.length > 0) {
      await db.pendingSets.bulkDelete(reconciliation.deleteLocalIds);
    }
    if (reconciliation.records.length > 0) {
      await db.pendingSets.bulkPut(reconciliation.records);
    }
  });
}
