import {
  ControlMessageType,
  createControlMessage,
  parseControlMessage,
  PROTOCOL_VERSION,
  serializeControlMessage,
} from './messages.js';
import { assertTransport, ConnectionState } from './transport.js';

function defaultIdGenerator() {
  return `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export class WatchCompanion {
  constructor({
    clock = () => Date.now(),
    deviceId,
    idGenerator = defaultIdGenerator,
    repository,
    transport,
  }) {
    this.clock = clock;
    this.deviceId = deviceId;
    this.idGenerator = idGenerator;
    this.repository = repository;
    this.transport = assertTransport(transport);
    this.listeners = new Set();
    this.started = false;
    this.state = {
      connection: ConnectionState.DISCONNECTED,
      syncStatus: 'idle',
      protocolVersion: PROTOCOL_VERSION,
      pendingCount: 0,
      lastPongAt: null,
      lastSnapshotAt: null,
      lastError: null,
    };
  }

  getState() {
    return { ...this.state };
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  async start() {
    if (this.started) {
      return;
    }

    const document = await this.repository.load();
    this.state = {
      ...this.state,
      ...document.state,
      pendingCount: document.outbox.length,
      connection: ConnectionState.CONNECTING,
    };
    this.started = true;
    this.transport.setMessageHandler((serialized) => this.receive(serialized));
    this.transport.setConnectionHandler((connection, error) => this.onConnection(connection, error));
    this.emit();
    await this.transport.connect();
  }

  async stop() {
    if (!this.started) {
      return;
    }
    await this.transport.disconnect();
    this.started = false;
  }

  async ping() {
    return this.sendRequest(ControlMessageType.PING, { purpose: 'connection-check' });
  }

  async requestState(reason = 'connected') {
    this.state.syncStatus = 'requesting';
    this.emit();
    return this.sendRequest(ControlMessageType.SYNC_REQUESTED, { reason });
  }

  async receive(serialized) {
    try {
      const message = parseControlMessage(serialized);
      if (this.repository.hasReceipt(message.messageId)) {
        return { duplicate: true };
      }

      await this.repository.rememberReceipt(message.messageId);

      if (message.type === ControlMessageType.PING) {
        await this.sendResponse(ControlMessageType.PONG, message.messageId, {
          receivedAt: this.clock(),
        });
      } else if (message.type === ControlMessageType.PONG) {
        const lastPongAt = this.clock();
        await this.repository.removePending(message.replyTo);
        await this.repository.updateState({ lastPongAt, lastError: null });
        this.state.lastPongAt = lastPongAt;
        this.state.lastError = null;
      } else if (message.type === ControlMessageType.SYNC_SNAPSHOT) {
        const lastSnapshotAt = this.clock();
        await this.repository.removePending(message.replyTo);
        await this.repository.updateState({ lastSnapshotAt, lastError: null });
        this.state.lastSnapshotAt = lastSnapshotAt;
        this.state.syncStatus = 'synced';
        this.state.lastError = null;
      }

      this.refreshPendingCount();
      this.emit();
      return { duplicate: false };
    } catch (error) {
      await this.recordError(error);
      return { duplicate: false, error };
    }
  }

  async onConnection(connection, error) {
    this.state.connection = connection;
    this.state.lastError = error || null;
    if (connection === ConnectionState.ERROR) {
      this.state.syncStatus = 'error';
    }
    this.emit();

    if (connection === ConnectionState.CONNECTED) {
      const hasPendingStateRequest = this.repository
        .pending()
        .some((message) => message.type === ControlMessageType.SYNC_REQUESTED);
      await this.flushPending();
      if (hasPendingStateRequest) {
        this.state.syncStatus = 'requesting';
        this.refreshPendingCount();
        this.emit();
      } else {
        await this.requestState('connected');
      }
    }
  }

  async flushPending() {
    for (const message of this.repository.pending()) {
      await this.transport.send(serializeControlMessage(message));
      if (message.type === ControlMessageType.PONG) {
        await this.repository.removePending(message.messageId);
      }
    }
    this.refreshPendingCount();
    this.emit();
  }

  async sendRequest(type, payload) {
    const message = this.createMessage(type, payload, null);
    await this.repository.enqueue(message);
    this.refreshPendingCount();
    this.emit();

    if (this.state.connection === ConnectionState.CONNECTED) {
      try {
        await this.transport.send(serializeControlMessage(message));
      } catch (error) {
        await this.recordError(error);
      }
    }

    return message.messageId;
  }

  async sendResponse(type, replyTo, payload) {
    const message = this.createMessage(type, payload, replyTo);
    await this.repository.enqueue(message);
    this.refreshPendingCount();
    this.emit();
    await this.transport.send(serializeControlMessage(message));
    await this.repository.removePending(message.messageId);
    this.refreshPendingCount();
    this.emit();
    return message.messageId;
  }

  createMessage(type, payload, replyTo) {
    return createControlMessage({
      deviceId: this.deviceId,
      messageId: this.idGenerator(),
      payload,
      replyTo,
      timestamp: this.clock(),
      type,
    });
  }

  refreshPendingCount() {
    this.state.pendingCount = this.repository.pending().length;
  }

  async recordError(error) {
    const message = error instanceof Error ? error.message : String(error);
    this.state.lastError = message;
    this.state.syncStatus = 'error';
    await this.repository.updateState({ lastError: message });
    this.refreshPendingCount();
    this.emit();
  }

  emit() {
    const state = this.getState();
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}
