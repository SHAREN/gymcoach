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
  ownerId?: string;
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
  ownerId?: string,
): PendingSet {
  const completedAt = new Date(serverSet.completedAt).getTime();
  return {
    localId,
    ownerId,
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
    gymEquipmentId: serverSet.gymEquipmentId,
    equipmentNameSnapshot: serverSet.equipmentNameSnapshot,
    selectedLoadKg: serverSet.selectedLoadKg,
    selectedLoadMultiplierSnapshot: serverSet.selectedLoadMultiplierSnapshot,
    nominalResistanceKg: serverSet.nominalResistanceKg,
    equipmentLoadSnapshot: serverSet.equipmentLoadSnapshot,
    createdAt: completedAt,
    status: 'synced',
    serverId: serverSet.id,
    syncedAt: completedAt,
    serverObservedAt: Date.now(),
    attempts: 0,
    lastError: null,
    lastHttpStatus: null,
    nextAttemptAt: null,
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
    const matches = existing.filter(
      (set) => set.serverId === serverSet.id || set.localId === serverSet.id,
    );
    const chosen =
      matches.find((set) => set.status !== 'synced') ??
      matches.find((set) => !set.localId.startsWith('srv_')) ??
      matches[0];

    for (const duplicate of matches) {
      if (duplicate.localId !== chosen?.localId) deleteLocalIds.add(duplicate.localId);
    }

    const preservesPendingServerUpdate =
      chosen?.serverId === serverSet.id && chosen.status !== 'synced';
    records.push(
      preservesPendingServerUpdate
        ? {
            ...chosen,
            ownerId: options.ownerId ?? chosen.ownerId,
            serverObservedAt: Date.now(),
          }
        : pendingSetFromServer(sessionId, serverSet, chosen?.localId, options.ownerId),
    );
  }

  for (const localSet of existing) {
    if (
      (localSet.serverId && serverIds.has(localSet.serverId)) ||
      serverIds.has(localSet.localId)
    ) {
      continue;
    }
    // A GET may have raced a successful POST or may be a stale cached read.
    // Absence is never acknowledgement that a durable local row should vanish.
    if (options.ownerId && localSet.ownerId == null) {
      records.push({ ...localSet, ownerId: options.ownerId });
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
    const sessionRows = await db.pendingSets.where('sessionId').equals(sessionId).toArray();
    const existing = options.ownerId
      ? sessionRows.filter((set) => set.ownerId == null || set.ownerId === options.ownerId)
      : sessionRows;
    const reconciliation = reconcileHydratedSets(sessionId, existing, serverSets, options);
    if (reconciliation.deleteLocalIds.length > 0) {
      await db.pendingSets.bulkDelete(reconciliation.deleteLocalIds);
    }
    if (reconciliation.records.length > 0) {
      await db.pendingSets.bulkPut(reconciliation.records);
    }
  });
}
