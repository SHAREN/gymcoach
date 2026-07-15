import { canonicalSha256 } from './canonical-json.js';

const STORAGE_KEY = 'gymcoach.watch.control.v1';
const DOCUMENT_VERSION = 5;
const MAX_CONFLICTS = 128;
const MAX_RECEIPTS = 512;

function createEmptyDocument() {
  return {
    version: DOCUMENT_VERSION,
    state: {
      lastPongAt: null,
      lastSnapshotAt: null,
      lastError: null,
      lastErrorCode: null,
      lastSyncAt: null,
      conflictCount: 0,
      currentHeartRate: null,
    },
    outbox: [],
    receipts: [],
    receiptRecords: [],
    conflicts: [],
    pendingFileTransfers: [],
    pendingInboundEvents: [],
    peerWatermark: null,
    snapshotWatermark: null,
    activeWorkout: null,
    sensorSamples: [],
  };
}

export function createVolatileStorageBackend() {
  const values = new Map();

  return {
    async get(key) {
      return values.has(key) ? values.get(key) : null;
    },
    async set(key, value) {
      values.set(key, value);
    },
    async remove(key) {
      values.delete(key);
    },
  };
}

export function createStorageBackendAdapter({ get, remove, set }) {
  if (typeof get !== 'function' || typeof set !== 'function' || typeof remove !== 'function') {
    throw new Error('Storage adapter requires get, set, and remove functions.');
  }

  return { get, set, remove };
}

export class WatchStateRepository {
  constructor(backend) {
    this.backend = backend;
    this.document = null;
  }

  async load() {
    const serialized = await this.backend.get(STORAGE_KEY);
    if (serialized === null) {
      this.document = createEmptyDocument();
      await this.persist();
      return this.snapshot();
    }

    this.document = migrateDocument(JSON.parse(serialized));
    await this.persist();
    return this.snapshot();
  }

  snapshot() {
    this.requireLoaded();
    return clone(this.document);
  }

  async enqueue(message) {
    this.requireLoaded();
    const id = envelopeId(message);
    if (!this.document.outbox.some((entry) => envelopeId(entry) === id)) {
      this.document.outbox.push(clone(message));
      await this.persist();
    }
  }

  async removePending(messageId) {
    this.requireLoaded();
    const next = this.document.outbox.filter((entry) => envelopeId(entry) !== messageId);
    if (next.length !== this.document.outbox.length) {
      this.document.outbox = next;
      await this.persist();
    }
  }

  pending() {
    this.requireLoaded();
    return this.document.outbox.map(clone);
  }

  hasReceipt(messageId) {
    this.requireLoaded();
    return this.document.receipts.includes(messageId);
  }

  receiptRecord(messageId) {
    this.requireLoaded();
    const record = this.document.receiptRecords.find((entry) => entry.id === messageId);
    return record ? clone(record) : null;
  }

  async rememberReceipt(messageId, details = {}) {
    this.requireLoaded();
    if (this.document.receipts.includes(messageId)) {
      return false;
    }
    addReceipt(this.document, messageId, details);
    await this.persist();
    return true;
  }

  async rememberProcessedEnvelope({ canonicalHash, id, kind, recordedAt, sessionId, status }) {
    this.requireLoaded();
    const existing = this.receiptRecord(id);
    if (existing) {
      return existing;
    }
    addReceipt(this.document, id, {
      canonicalHash,
      kind,
      recordedAt,
      sessionId,
      status,
    });
    await this.persist();
    return null;
  }

  pendingInboundEvents() {
    this.requireLoaded();
    return this.document.pendingInboundEvents.map(clone);
  }

  async rememberPendingInboundEvent(event, canonicalHash, reason, recordedAt) {
    this.requireLoaded();
    const existing = this.document.pendingInboundEvents.find(
      (entry) => entry.event.eventId === event.eventId,
    );
    if (existing) {
      if (existing.canonicalHash !== canonicalHash) {
        throw new Error('EVENT_ID_REUSE');
      }
      return false;
    }
    this.document.pendingInboundEvents.push({
      event: clone(event),
      canonicalHash,
      reason: sanitizeStoredError(reason) || 'SYNC_PENDING',
      recordedAt,
    });
    await this.persist();
    return true;
  }

  async removePendingInboundEvent(eventId) {
    this.requireLoaded();
    const before = this.document.pendingInboundEvents.length;
    this.document.pendingInboundEvents = this.document.pendingInboundEvents.filter(
      (entry) => entry.event.eventId !== eventId,
    );
    if (before !== this.document.pendingInboundEvents.length) {
      await this.persist();
    }
  }

  async updateState(patch) {
    this.requireLoaded();
    this.document.state = { ...this.document.state, ...clone(patch) };
    await this.persist();
  }

  activeWorkout() {
    this.requireLoaded();
    return this.document.activeWorkout === null ? null : clone(this.document.activeWorkout);
  }

  async commitSnapshot(snapshotId, activeWorkout, details = {}) {
    this.requireLoaded();
    addReceipt(this.document, snapshotId, {
      canonicalHash: details.canonicalHash ?? null,
      kind: 'SNAPSHOT',
      recordedAt: details.recordedAt ?? null,
      sessionId: details.sessionId ?? activeWorkout?.session?.sessionId ?? null,
      status: 'APPLIED',
    });
    this.document.activeWorkout = clone(activeWorkout);
    if (details.watermark) {
      this.document.snapshotWatermark = clone(details.watermark);
    }
    await this.persist();
  }

  async commitInboundWorkoutEvent(eventId, activeWorkout, details = {}) {
    this.requireLoaded();
    addReceipt(this.document, eventId, {
      canonicalHash: details.canonicalHash ?? null,
      errorCode: details.errorCode ?? null,
      kind: 'EVENT',
      recordedAt: details.recordedAt ?? null,
      sessionId: details.sessionId ?? activeWorkout?.session?.sessionId ?? null,
      status: details.status ?? 'APPLIED',
    });
    if (activeWorkout !== null && activeWorkout !== undefined) {
      this.document.activeWorkout = clone(activeWorkout);
    }
    await this.persist();
  }

  async commitOutboundWorkoutEvent(event, activeWorkout) {
    this.requireLoaded();
    const existing = this.document.outbox.find((entry) => envelopeId(entry) === event.eventId);
    if (existing && canonicalSha256(existing) !== canonicalSha256(event)) {
      throw new Error('EVENT_ID_REUSE');
    }
    if (!existing) {
      this.document.outbox.push(clone(event));
    }
    this.document.activeWorkout = clone(activeWorkout);
    await this.persist();
  }

  async commitOutboundSensorTransfers({ activeWorkout, events, transfers }) {
    this.requireLoaded();
    if (new Set(events.map((event) => event.eventId)).size !== events.length) {
      throw new Error('EVENT_ID_REUSE');
    }
    if (new Set(transfers.map((transfer) => transfer.transferId)).size !== transfers.length) {
      throw new Error('FILE_TRANSFER_ID_REUSE');
    }
    for (const event of events) {
      const existing = this.document.outbox.find((entry) => envelopeId(entry) === event.eventId);
      if (existing && canonicalSha256(existing) !== canonicalSha256(event)) {
        throw new Error('EVENT_ID_REUSE');
      }
    }
    for (const transfer of transfers) {
      const existing = this.document.pendingFileTransfers.find(
        (entry) => entry.transferId === transfer.transferId,
      );
      if (existing && existing.canonicalHash !== transfer.canonicalHash) {
        throw new Error('FILE_TRANSFER_ID_REUSE');
      }
    }
    for (const event of events) {
      if (!this.document.outbox.some((entry) => envelopeId(entry) === event.eventId)) {
        this.document.outbox.push(clone(event));
      }
    }
    for (const transfer of transfers) {
      const existing = this.document.pendingFileTransfers.find(
        (entry) => entry.transferId === transfer.transferId,
      );
      if (!existing) {
        this.document.pendingFileTransfers.push({ ...clone(transfer), direction: 'OUTBOUND' });
      }
    }
    this.document.activeWorkout = clone(activeWorkout);
    await this.persist();
  }

  async saveActiveWorkout(activeWorkout) {
    this.requireLoaded();
    this.document.activeWorkout = clone(activeWorkout);
    await this.persist();
  }

  sensorSamples() {
    this.requireLoaded();
    return this.document.sensorSamples.map(clone);
  }

  unassignedSensorSamples() {
    this.requireLoaded();
    const assigned = new Set(
      this.document.pendingFileTransfers
        .filter((entry) => entry.direction === 'OUTBOUND')
        .flatMap((entry) => entry.sampleIds || []),
    );
    return this.document.sensorSamples.filter((sample) => !assigned.has(sample.sampleId)).map(clone);
  }

  async appendSensorSample(sample, maxSamples = 2_048) {
    this.requireLoaded();
    if (this.unassignedSensorSamples().length >= maxSamples) {
      throw new Error('Persistent sensor sample buffer is full and must be flushed.');
    }
    const existing = this.document.sensorSamples.find((entry) => entry.sampleId === sample.sampleId);
    if (existing && canonicalSha256(existing) !== canonicalSha256(sample)) {
      throw new Error('SAMPLE_ID_REUSE');
    }
    if (!existing) {
      this.document.sensorSamples.push(clone(sample));
      await this.persist();
    }
  }

  async clearSensorSamples() {
    this.requireLoaded();
    this.document.sensorSamples = [];
    await this.persist();
  }

  pendingFileTransfers(direction = null) {
    this.requireLoaded();
    return this.document.pendingFileTransfers
      .filter((entry) => direction === null || entry.direction === direction)
      .map(clone);
  }

  inboundTransferForEvent(eventId) {
    this.requireLoaded();
    const transfer = this.document.pendingFileTransfers.find(
      (entry) => entry.direction === 'INBOUND' && entry.relatedEventId === eventId,
    );
    return transfer ? clone(transfer) : null;
  }

  transferRecord(transferId) {
    this.requireLoaded();
    const transfer = this.document.pendingFileTransfers.find(
      (entry) => entry.transferId === transferId,
    );
    return transfer ? clone(transfer) : null;
  }

  async rememberInboundTransfer(envelope, canonicalHash, recordedAt) {
    this.requireLoaded();
    const existing = this.document.pendingFileTransfers.find(
      (entry) => entry.transferId === envelope.transferId,
    );
    if (existing) {
      return clone(existing);
    }
    this.document.pendingFileTransfers.push({
      transferId: envelope.transferId,
      relatedEventId: envelope.relatedEventId,
      sessionId: envelope.sessionId,
      payloadId: envelope.payloadId,
      payloadType: envelope.payloadType,
      sequence: envelope.sequence,
      totalSequences: envelope.totalSequences,
      canonicalHash,
      envelope: clone(envelope),
      sampleIds: [],
      direction: 'INBOUND',
      recordedAt,
    });
    addReceipt(this.document, envelope.transferId, {
      canonicalHash,
      kind: 'FILE',
      recordedAt,
      sessionId: envelope.sessionId,
      status: 'APPLIED',
    });
    await this.persist();
    return null;
  }

  async completeInboundTransferForEvent(eventId) {
    this.requireLoaded();
    const before = this.document.pendingFileTransfers.length;
    this.document.pendingFileTransfers = this.document.pendingFileTransfers.filter(
      (entry) => !(entry.direction === 'INBOUND' && entry.relatedEventId === eventId),
    );
    if (before !== this.document.pendingFileTransfers.length) {
      await this.persist();
    }
  }

  async removeFileTransfer(transferId) {
    this.requireLoaded();
    const before = this.document.pendingFileTransfers.length;
    this.document.pendingFileTransfers = this.document.pendingFileTransfers.filter(
      (entry) => entry.transferId !== transferId,
    );
    if (before !== this.document.pendingFileTransfers.length) {
      await this.persist();
    }
  }

  async applySyncAck(ack, canonicalHash) {
    this.requireLoaded();
    const existing = this.receiptRecord(ack.ackId);
    if (existing) {
      return { duplicate: true, removedEventIds: [] };
    }
    addReceipt(this.document, ack.ackId, {
      canonicalHash,
      kind: 'ACK',
      recordedAt: ack.timestamp,
      sessionId: ack.sessionId,
      status: ack.status,
    });

    const successful = ack.status === 'APPLIED' || ack.status === 'DUPLICATE';
    const eventIds = new Set(ack.eventIds);
    let removedEventIds = [];
    if (successful) {
      removedEventIds = this.document.outbox
        .filter(
          (entry) =>
            Object.prototype.hasOwnProperty.call(entry, 'eventId') && eventIds.has(entry.eventId),
        )
        .map((entry) => entry.eventId);
      this.document.outbox = this.document.outbox.filter(
        (entry) =>
          !Object.prototype.hasOwnProperty.call(entry, 'eventId') || !eventIds.has(entry.eventId),
      );
      const acknowledgedTransfers = this.document.pendingFileTransfers.filter(
        (entry) =>
          entry.direction === 'OUTBOUND' &&
          entry.relatedEventId !== null &&
          eventIds.has(entry.relatedEventId),
      );
      const acknowledgedSamples = new Set(
        acknowledgedTransfers.flatMap((entry) => entry.sampleIds || []),
      );
      this.document.pendingFileTransfers = this.document.pendingFileTransfers.filter(
        (entry) =>
          !(
            entry.direction === 'OUTBOUND' &&
            entry.relatedEventId !== null &&
            eventIds.has(entry.relatedEventId)
          ),
      );
      this.document.sensorSamples = this.document.sensorSamples.filter(
        (sample) => !acknowledgedSamples.has(sample.sampleId),
      );
    } else {
      addConflict(this.document, {
        code: ack.errorCode || `ACK_${ack.status}`,
        ackId: ack.ackId,
        eventIds: [...ack.eventIds],
        sessionId: ack.sessionId,
        recordedAt: ack.timestamp,
      });
    }

    const currentWatermark = this.document.peerWatermark;
    if (
      currentWatermark === null ||
      currentWatermark.sessionId !== ack.sessionId ||
      ack.revision > currentWatermark.revision ||
      (ack.revision === currentWatermark.revision && ack.timestamp >= currentWatermark.updatedAt)
    ) {
      this.document.peerWatermark = {
        sessionId: ack.sessionId,
        revision: ack.revision,
        updatedAt: ack.timestamp,
        deviceId: ack.deviceId,
      };
    }
    this.document.state.lastSyncAt = Math.max(this.document.state.lastSyncAt || 0, ack.timestamp);
    this.document.state.lastErrorCode = successful ? null : ack.errorCode || `ACK_${ack.status}`;
    this.document.state.lastError = this.document.state.lastErrorCode;
    this.document.state.conflictCount = this.document.conflicts.length;
    await this.persist();
    return { duplicate: false, removedEventIds };
  }

  async recordConflict(conflict) {
    this.requireLoaded();
    const added = addConflict(this.document, conflict);
    this.document.state.conflictCount = this.document.conflicts.length;
    this.document.state.lastErrorCode = conflict.code;
    this.document.state.lastError = conflict.code;
    if (added) {
      await this.persist();
    }
    return added;
  }

  conflicts() {
    this.requireLoaded();
    return this.document.conflicts.map(clone);
  }

  async persist() {
    await this.backend.set(STORAGE_KEY, JSON.stringify(this.document));
  }

  requireLoaded() {
    if (this.document === null) {
      throw new Error('Watch state repository must be loaded first.');
    }
  }
}

function migrateDocument(parsed) {
  if (parsed.version === 1) {
    parsed.version = 2;
    parsed.activeWorkout = null;
  }
  if (parsed.version === 2) {
    parsed.version = 3;
    parsed.sensorSamples = [];
    parsed.state = parsed.state || {};
    parsed.state.currentHeartRate = null;
  }
  if (parsed.version === 3) {
    parsed.version = 4;
  }
  if (parsed.version === 4) {
    parsed.version = DOCUMENT_VERSION;
    parsed.pendingInboundEvents = [];
  }
  if (
    parsed.version !== DOCUMENT_VERSION ||
    !Array.isArray(parsed.outbox) ||
    !Array.isArray(parsed.receipts) ||
    !Array.isArray(parsed.sensorSamples)
  ) {
    throw new Error('Unsupported watch state document.');
  }
  parsed.state = {
    ...createEmptyDocument().state,
    ...(parsed.state || {}),
  };
  parsed.state.lastErrorCode = sanitizeStoredError(parsed.state.lastErrorCode ?? parsed.state.lastError);
  parsed.state.lastError = parsed.state.lastErrorCode;
  parsed.receiptRecords = Array.isArray(parsed.receiptRecords) ? parsed.receiptRecords : [];
  for (const id of parsed.receipts) {
    if (!parsed.receiptRecords.some((entry) => entry.id === id)) {
      parsed.receiptRecords.push({
        id,
        canonicalHash: null,
        errorCode: null,
        kind: 'LEGACY',
        recordedAt: null,
        sessionId: null,
        status: 'APPLIED',
      });
    }
  }
  parsed.conflicts = Array.isArray(parsed.conflicts) ? parsed.conflicts : [];
  parsed.pendingFileTransfers = Array.isArray(parsed.pendingFileTransfers)
    ? parsed.pendingFileTransfers
    : [];
  parsed.pendingInboundEvents = Array.isArray(parsed.pendingInboundEvents)
    ? parsed.pendingInboundEvents
    : [];
  parsed.peerWatermark = parsed.peerWatermark || null;
  parsed.snapshotWatermark = parsed.snapshotWatermark || null;
  parsed.state.conflictCount = parsed.conflicts.length;
  if (!Object.prototype.hasOwnProperty.call(parsed, 'activeWorkout')) {
    parsed.activeWorkout = null;
  }
  normalizeActiveWorkout(parsed.activeWorkout);
  compactReceipts(parsed);
  return parsed;
}

function normalizeActiveWorkout(activeWorkout) {
  if (!activeWorkout) {
    return;
  }
  activeWorkout.timing = activeWorkout.timing || {
    accumulatedPauseMs: 0,
    pauseStartedAt: null,
  };
  activeWorkout.rest = activeWorkout.rest || null;
  activeWorkout.lastRestSummary = activeWorkout.lastRestSummary || null;
  if (activeWorkout.pendingSet) {
    activeWorkout.pendingSet.accumulatedPauseMs =
      activeWorkout.pendingSet.accumulatedPauseMs || 0;
    if (!Number.isInteger(activeWorkout.pendingSet.pauseStartedAt)) {
      activeWorkout.pendingSet.pauseStartedAt = null;
    }
  }
}

function envelopeId(envelope) {
  const id = envelope?.messageId || envelope?.eventId;
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('Outbox envelope must have messageId or eventId.');
  }
  return id;
}

function addReceipt(document, id, details = {}) {
  if (!document.receipts.includes(id)) {
    document.receipts.push(id);
  }
  if (!document.receiptRecords.some((entry) => entry.id === id)) {
    document.receiptRecords.push({
      id,
      canonicalHash: details.canonicalHash ?? null,
      errorCode: details.errorCode ?? null,
      kind: details.kind ?? 'CONTROL',
      recordedAt: details.recordedAt ?? null,
      sessionId: details.sessionId ?? null,
      status: details.status ?? 'APPLIED',
    });
  }
  compactReceipts(document);
}

function compactReceipts(document) {
  if (document.receiptRecords.length <= MAX_RECEIPTS) {
    return;
  }
  const protectedIds = new Set();
  for (const envelope of document.outbox) {
    protectedIds.add(envelopeId(envelope));
  }
  for (const transfer of document.pendingFileTransfers) {
    protectedIds.add(transfer.transferId);
    if (transfer.relatedEventId) {
      protectedIds.add(transfer.relatedEventId);
    }
  }
  for (const pending of document.pendingInboundEvents || []) {
    protectedIds.add(pending.event.eventId);
  }
  for (const conflict of document.conflicts) {
    if (conflict.ackId) protectedIds.add(conflict.ackId);
    if (conflict.eventId) protectedIds.add(conflict.eventId);
    for (const eventId of conflict.eventIds || []) protectedIds.add(eventId);
  }
  if (document.snapshotWatermark?.snapshotId) {
    protectedIds.add(document.snapshotWatermark.snapshotId);
  }
  const removable = document.receiptRecords
    .filter((entry) => !protectedIds.has(entry.id))
    .sort(
      (left, right) =>
        (left.recordedAt ?? Number.MIN_SAFE_INTEGER) -
          (right.recordedAt ?? Number.MIN_SAFE_INTEGER) || left.id.localeCompare(right.id),
    );
  const removeCount = Math.min(
    removable.length,
    document.receiptRecords.length - MAX_RECEIPTS,
  );
  const removed = new Set(removable.slice(0, removeCount).map((entry) => entry.id));
  document.receiptRecords = document.receiptRecords.filter((entry) => !removed.has(entry.id));
  document.receipts = document.receipts.filter((id) => !removed.has(id));
}

function addConflict(document, conflict) {
  const normalized = {
    code: sanitizeStoredError(conflict.code) || 'SYNC_CONFLICT',
    ackId: conflict.ackId ?? null,
    eventId: conflict.eventId ?? null,
    eventIds: Array.isArray(conflict.eventIds) ? [...conflict.eventIds] : [],
    sessionId: conflict.sessionId ?? null,
    localHash: conflict.localHash ?? null,
    remoteHash: conflict.remoteHash ?? null,
    recordedAt: conflict.recordedAt ?? null,
  };
  const key = conflictKey(normalized);
  if (document.conflicts.some((entry) => conflictKey(entry) === key)) {
    return false;
  }
  document.conflicts.push(normalized);
  if (document.conflicts.length > MAX_CONFLICTS) {
    document.conflicts.splice(0, document.conflicts.length - MAX_CONFLICTS);
  }
  return true;
}

function conflictKey(conflict) {
  return JSON.stringify({
    code: conflict.code,
    ackId: conflict.ackId,
    eventId: conflict.eventId,
    eventIds: conflict.eventIds,
    sessionId: conflict.sessionId,
    localHash: conflict.localHash,
    remoteHash: conflict.remoteHash,
  });
}

function sanitizeStoredError(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64) || null;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
