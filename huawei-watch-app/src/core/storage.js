const STORAGE_KEY = 'gymcoach.watch.control.v1';
const MAX_RECEIPTS = 256;

function createEmptyDocument() {
  return {
    version: 1,
    state: {
      lastPongAt: null,
      lastSnapshotAt: null,
      lastError: null,
    },
    outbox: [],
    receipts: [],
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
    if (parsed.version !== 1 || !Array.isArray(parsed.outbox) || !Array.isArray(parsed.receipts)) {
      throw new Error('Unsupported watch state document.');
    }

    this.document = parsed;
    return this.snapshot();
  }

  snapshot() {
    this.requireLoaded();
    return JSON.parse(JSON.stringify(this.document));
  }

  async enqueue(message) {
    this.requireLoaded();
    if (!this.document.outbox.some((entry) => entry.messageId === message.messageId)) {
      this.document.outbox.push(message);
      await this.persist();
    }
  }

  async removePending(messageId) {
    this.requireLoaded();
    const next = this.document.outbox.filter((entry) => entry.messageId !== messageId);
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

  async persist() {
    await this.backend.set(STORAGE_KEY, JSON.stringify(this.document));
  }

  requireLoaded() {
    if (this.document === null) {
      throw new Error('Watch state repository must be loaded first.');
    }
  }
}
