// Hydrates IndexedDB with the sets fetched from the server.
//
// Strategy: on every SessionRunner mount, we call hydrate with the
// server-side sets. IndexedDB thus becomes the single source of truth
// for display (the components use useLiveQuery on Dexie).

import type { Set as PrismaSet } from '@/lib/prisma-client';
import { getDB, type PendingSet } from '@/lib/indexeddb';

export interface HydrationReconciliation {
  records: PendingSet[];
  deleteLocalIds: string[];
}

export interface HydrationReconciliationOptions {
  pruneMissingSynced?: boolean;
}

export function localSetIdsForDeletion(
  target: PendingSet,
  sessionSets: readonly PendingSet[],
): string[] {
  return sessionSets
    .filter(
      (set) =>
        set.localId === target.localId ||
        (target.serverId != null && set.serverId === target.serverId),
    )
    .map((set) => set.localId);
}

export function hasUnsyncedSets(sets: readonly PendingSet[]): boolean {
  return sets.some((set) => set.status !== 'synced' || set.serverId == null);
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
  options: HydrationReconciliationOptions = {},
): HydrationReconciliation {
  const records: PendingSet[] = [];
  const deleteLocalIds = new Set<string>();
  const serverIds = new Set(serverSets.map((set) => set.id));

  for (const serverSet of serverSets) {
    const matches = existing.filter((set) => set.serverId === serverSet.id);
    const chosen =
      matches.find((set) => set.status !== 'synced') ??
      matches.find((set) => !set.localId.startsWith('srv_')) ??
      matches[0];

    for (const duplicate of matches) {
      if (duplicate.localId !== chosen?.localId) deleteLocalIds.add(duplicate.localId);
    }

    records.push(
      chosen && chosen.status !== 'synced'
        ? chosen
        : pendingSetFromServer(sessionId, serverSet, chosen?.localId),
    );
  }

  for (const localSet of existing) {
    if (localSet.serverId && serverIds.has(localSet.serverId)) continue;
    if (options.pruneMissingSynced && localSet.status === 'synced') {
      deleteLocalIds.add(localSet.localId);
    }
  }

  return { records, deleteLocalIds: [...deleteLocalIds] };
}

export async function hydrateFromServerSets(
  sessionId: string,
  serverSets: PrismaSet[],
  options: HydrationReconciliationOptions = {},
): Promise<void> {
  const db = getDB();
  await db.transaction('rw', db.pendingSets, async () => {
    const existing = await db.pendingSets.where('sessionId').equals(sessionId).toArray();
    const reconciliation = reconcileHydratedSets(sessionId, existing, serverSets, options);
    if (reconciliation.deleteLocalIds.length > 0) {
      await db.pendingSets.bulkDelete(reconciliation.deleteLocalIds);
    }
    if (reconciliation.records.length > 0) {
      await db.pendingSets.bulkPut(reconciliation.records);
    }
  });
}
