const STORAGE_KEY = 'gymcoach.watch.control.v1';
const MAX_RECEIPTS = 256;

function createEmptyDocument() {
  return {
    version: 3,
    state: {
      lastPongAt: null,
      lastSnapshotAt: null,
      lastError: null,
      currentHeartRate: null,
    },
    outbox: [],
    receipts: [],
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

    const parsed = JSON.parse(serialized);
    if (parsed.version === 1) {
      parsed.version = 2;
      parsed.activeWorkout = null;
    }
    if (parsed.version === 2) {
      parsed.version = 3;
      parsed.sensorSamples = [];
      parsed.state.currentHeartRate = null;
    }
    if (
      parsed.version !== 3 ||
      !Array.isArray(parsed.outbox) ||
      !Array.isArray(parsed.receipts) ||
      !Array.isArray(parsed.sensorSamples)
    ) {
      throw new Error('Unsupported watch state document.');
    }
    if (!Object.prototype.hasOwnProperty.call(parsed, 'activeWorkout')) {
      parsed.activeWorkout = null;
    }
    if (parsed.activeWorkout) {
      parsed.activeWorkout.timing = parsed.activeWorkout.timing || {
        accumulatedPauseMs: 0,
        pauseStartedAt: null,
      };
      parsed.activeWorkout.rest = parsed.activeWorkout.rest || null;
      parsed.activeWorkout.lastRestSummary = parsed.activeWorkout.lastRestSummary || null;
      if (parsed.activeWorkout.pendingSet) {
        parsed.activeWorkout.pendingSet.accumulatedPauseMs =
          parsed.activeWorkout.pendingSet.accumulatedPauseMs || 0;
        if (!Number.isInteger(parsed.activeWorkout.pendingSet.pauseStartedAt)) {
          parsed.activeWorkout.pendingSet.pauseStartedAt = null;
        }
      }
    }

    this.document = parsed;
    await this.persist();
    return this.snapshot();
  }

  snapshot() {
    this.requireLoaded();
    return JSON.parse(JSON.stringify(this.document));
  }

  async enqueue(message) {
    this.requireLoaded();
    const id = envelopeId(message);
    if (!this.document.outbox.some((entry) => envelopeId(entry) === id)) {
      this.document.outbox.push(message);
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
    return this.document.outbox.map((entry) => ({ ...entry }));
  }

  hasReceipt(messageId) {
    this.requireLoaded();
    return this.document.receipts.includes(messageId);
  }

  async rememberReceipt(messageId) {
    this.requireLoaded();
    if (this.document.receipts.includes(messageId)) {
      return false;
    }

    this.document.receipts.push(messageId);
    if (this.document.receipts.length > MAX_RECEIPTS) {
      this.document.receipts.splice(0, this.document.receipts.length - MAX_RECEIPTS);
    }
    await this.persist();
    return true;
  }

  async updateState(patch) {
    this.requireLoaded();
    this.document.state = { ...this.document.state, ...patch };
    await this.persist();
  }

  activeWorkout() {
    this.requireLoaded();
    return this.document.activeWorkout === null
      ? null
      : JSON.parse(JSON.stringify(this.document.activeWorkout));
  }

  async commitSnapshot(snapshotId, activeWorkout) {
    this.requireLoaded();
    addReceipt(this.document, snapshotId);
    this.document.activeWorkout = JSON.parse(JSON.stringify(activeWorkout));
    await this.persist();
  }

  async commitInboundWorkoutEvent(eventId, activeWorkout) {
    this.requireLoaded();
    addReceipt(this.document, eventId);
    this.document.activeWorkout = JSON.parse(JSON.stringify(activeWorkout));
    await this.persist();
  }

  async commitOutboundWorkoutEvent(event, activeWorkout) {
    this.requireLoaded();
    addReceipt(this.document, event.eventId);
    if (!this.document.outbox.some((entry) => envelopeId(entry) === event.eventId)) {
      this.document.outbox.push(JSON.parse(JSON.stringify(event)));
    }
    this.document.activeWorkout = JSON.parse(JSON.stringify(activeWorkout));
    await this.persist();
  }

  async saveActiveWorkout(activeWorkout) {
    this.requireLoaded();
    this.document.activeWorkout = JSON.parse(JSON.stringify(activeWorkout));
    await this.persist();
  }

  sensorSamples() {
    this.requireLoaded();
    return this.document.sensorSamples.map((sample) => JSON.parse(JSON.stringify(sample)));
  }

  async appendSensorSample(sample, maxSamples = 2_048) {
    this.requireLoaded();
    if (this.document.sensorSamples.length >= maxSamples) {
      throw new Error('Persistent sensor sample buffer is full and must be flushed.');
    }
    this.document.sensorSamples.push(JSON.parse(JSON.stringify(sample)));
    await this.persist();
  }

  async clearSensorSamples() {
    this.requireLoaded();
    this.document.sensorSamples = [];
    await this.persist();
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

function envelopeId(envelope) {
  const id = envelope?.messageId || envelope?.eventId;
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('Outbox envelope must have messageId or eventId.');
  }
  return id;
}

function addReceipt(document, id) {
  if (!document.receipts.includes(id)) {
    document.receipts.push(id);
    if (document.receipts.length > MAX_RECEIPTS) {
      document.receipts.splice(0, document.receipts.length - MAX_RECEIPTS);
    }
  }
}
