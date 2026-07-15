import {
  assertDataEnvelopeSize,
  createWatchEvent,
  encodeSyncSnapshotForTransport,
  encodeWatchEventForTransport,
  parseSyncSnapshot,
  parseWatchEvent,
  validateSetRecord,
  WatchEventType,
} from './contracts.js';
import {
  ControlMessageType,
  createControlMessage,
  parseControlMessage,
  PROTOCOL_VERSION,
  serializeControlMessage,
} from './messages.js';
import { assertTransport, ConnectionState } from './transport.js';
import {
  activeWorkoutFromSnapshot,
  applyWorkoutEvent,
  completedSetsForExercise,
  currentExercise,
  nextExercise,
} from './workout-state.js';

function defaultIdGenerator() {
  return `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function defaultUuidGenerator() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (symbol) => {
    const random = Math.floor(Math.random() * 16);
    const value = symbol === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function defaultSetIdGenerator() {
  return `watch_set_${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
}

export class WatchCompanion {
  constructor({
    clock = () => Date.now(),
    deviceId,
    eventIdGenerator = defaultUuidGenerator,
    idGenerator = defaultIdGenerator,
    repository,
    setIdGenerator = defaultSetIdGenerator,
    source = 'WATCH',
    transport,
  }) {
    this.clock = clock;
    this.deviceId = deviceId;
    this.eventIdGenerator = eventIdGenerator;
    this.idGenerator = idGenerator;
    this.repository = repository;
    this.setIdGenerator = setIdGenerator;
    this.source = source;
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
      activeWorkout: null,
    };
  }

  getState() {
    return JSON.parse(JSON.stringify(this.state));
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
      activeWorkout: document.activeWorkout,
      pendingCount: document.outbox.length,
      connection: ConnectionState.CONNECTING,
    };
    this.started = true;
    this.transport.setMessageHandler((serialized) => this.receive(serialized));
    this.transport.setFileHandler((serialized) => this.receiveFile(serialized));
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
      assertDataEnvelopeSize(serialized, 'MESSAGE');
      const envelope = JSON.parse(serialized);
      if (Object.prototype.hasOwnProperty.call(envelope, 'messageId')) {
        return await this.receiveControl(serialized);
      }
      if (Object.prototype.hasOwnProperty.call(envelope, 'eventId')) {
        return await this.receiveWatchEvent(serialized);
      }
      if (Object.prototype.hasOwnProperty.call(envelope, 'snapshotId')) {
        return await this.receiveSnapshot(serialized);
      }
      throw new Error('Unknown direct transport envelope.');
    } catch (error) {
      await this.recordError(error);
      return { duplicate: false, error };
    }
  }

  async receiveFile(serialized) {
    try {
      assertDataEnvelopeSize(serialized, 'FILE');
      const envelope = JSON.parse(serialized);
      if (Object.prototype.hasOwnProperty.call(envelope, 'eventId')) {
        return await this.receiveWatchEvent(serialized);
      }
      if (Object.prototype.hasOwnProperty.call(envelope, 'snapshotId')) {
        return await this.receiveSnapshot(serialized);
      }
      throw new Error('File transport accepts only WatchEvent or SyncSnapshot.');
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
        .some(
          (message) =>
            Object.prototype.hasOwnProperty.call(message, 'messageId') &&
            message.type === ControlMessageType.SYNC_REQUESTED,
        );
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
    for (const envelope of this.repository.pending()) {
      if (Object.prototype.hasOwnProperty.call(envelope, 'messageId')) {
        await this.transport.send(serializeControlMessage(envelope));
        if (envelope.type === ControlMessageType.PONG) {
          await this.repository.removePending(envelope.messageId);
        }
      } else if (Object.prototype.hasOwnProperty.call(envelope, 'eventId')) {
        await this.sendEncoded(encodeWatchEventForTransport(envelope));
      } else {
        throw new Error('Outbox contains an unknown envelope.');
      }
    }
    this.refreshPendingCount();
    this.emit();
  }

  async changeExercise(offset) {
    const activeWorkout = this.requireActiveWorkout();
    const current = currentExercise(activeWorkout);
    const selected = nextExercise(activeWorkout, offset);
    if (selected.exerciseSessionId === current.exerciseSessionId) {
      return null;
    }
    return this.emitWorkoutEvent(WatchEventType.ACTIVE_EXERCISE_CHANGED, {
      exerciseId: selected.exerciseId,
      exerciseSessionId: selected.exerciseSessionId,
      order: selected.order,
    });
  }

  async startSet() {
    const activeWorkout = this.requireActiveWorkout();
    if (activeWorkout.activeSetId !== null) {
      throw new Error('A set is already active.');
    }
    const exercise = currentExercise(activeWorkout);
    if (!exercise) {
      throw new Error('No active exercise is available.');
    }
    const setNumber = completedSetsForExercise(activeWorkout, exercise.exerciseSessionId).length + 1;
    return this.emitWorkoutEvent(WatchEventType.SET_STARTED, {
      setId: this.setIdGenerator(),
      exerciseSessionId: exercise.exerciseSessionId,
      setNumber,
      startedAt: this.clock(),
    });
  }

  async completeSet({ comment = null, reps, rir, setType = 'WORKING', weight }) {
    const activeWorkout = this.requireActiveWorkout();
    if (!Number.isInteger(rir) || rir < 0 || rir > 5) {
      throw new Error('A new watch set requires RIR from 0 to 5.');
    }
    const pendingSet = activeWorkout.pendingSet;
    if (!pendingSet || activeWorkout.activeSetId !== pendingSet.setId) {
      throw new Error('No locally started set is available to complete.');
    }
    return this.emitWorkoutEvent(WatchEventType.SET_COMPLETED, (revision) => {
      const setRecord = {
        setId: pendingSet.setId,
        sessionId: activeWorkout.session.sessionId,
        exerciseSessionId: pendingSet.exerciseSessionId,
        setNumber: pendingSet.setNumber,
        weight,
        reps,
        rir,
        setType,
        comment,
        startedAt: pendingSet.startedAt,
        completedAt: this.clock(),
        source: this.source,
        heartRateSummary: {
          min: null,
          max: null,
          average: null,
          start: null,
          end: null,
          sampleCount: 0,
        },
        sensorSummary: {},
        revision,
      };
      return validateSetRecord(setRecord);
    });
  }

  async deleteSet(setId) {
    const activeWorkout = this.requireActiveWorkout();
    const existing = activeWorkout.completedSets.find((set) => set.setId === setId);
    if (!existing) {
      throw new Error('Set does not exist.');
    }
    return this.emitWorkoutEvent(WatchEventType.SET_DELETED, {
      setId,
      deletedAt: this.clock(),
      baseRevision: activeWorkout.revision,
    });
  }

  async updateLastSet({ comment, reps, rir, setType, weight }) {
    const activeWorkout = this.requireActiveWorkout();
    if (!Number.isInteger(rir) || rir < 0 || rir > 5) {
      throw new Error('A watch set edit requires RIR from 0 to 5.');
    }
    const previous = this.lastSetForCurrentExercise(activeWorkout);
    return this.emitWorkoutEvent(WatchEventType.SET_UPDATED, (revision) =>
      validateSetRecord({
        ...previous,
        weight,
        reps,
        rir,
        setType: setType === undefined ? previous.setType ?? null : setType,
        comment: comment === undefined ? previous.comment ?? null : comment,
        source: this.source,
        revision,
      }),
    );
  }

  async deleteLastSet() {
    const activeWorkout = this.requireActiveWorkout();
    const previous = this.lastSetForCurrentExercise(activeWorkout);
    return this.emitWorkoutEvent(WatchEventType.SET_DELETED, {
      setId: previous.setId,
      deletedAt: this.clock(),
      baseRevision: activeWorkout.revision,
    });
  }

  async finishWorkout() {
    this.requireActiveWorkout();
    return this.emitWorkoutEvent(WatchEventType.WORKOUT_FINISHED, {
      finishedAt: this.clock(),
    });
  }

  async emitWorkoutEvent(type, payloadOrFactory) {
    const activeWorkout = this.requireActiveWorkout();
    const revision = activeWorkout.revision + 1;
    const payload =
      typeof payloadOrFactory === 'function' ? payloadOrFactory(revision) : payloadOrFactory;
    const event = createWatchEvent({
      deviceId: this.deviceId,
      eventId: this.eventIdGenerator(),
      payload,
      revision,
      sessionId: activeWorkout.session.sessionId,
      source: this.source,
      timestamp: this.clock(),
      type,
    });
    const next = applyWorkoutEvent(activeWorkout, event);
    await this.repository.commitOutboundWorkoutEvent(event, next);
    this.state.activeWorkout = next;
    this.refreshPendingCount();
    this.emit();

    if (this.state.connection === ConnectionState.CONNECTED) {
      try {
        await this.sendEncoded(encodeWatchEventForTransport(event));
      } catch (error) {
        await this.recordError(error);
      }
    }
    return event;
  }

  async receiveControl(serialized) {
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
  }

  async receiveWatchEvent(serialized) {
    const event = parseWatchEvent(serialized);
    if (this.repository.hasReceipt(event.eventId)) {
      return { duplicate: true };
    }
    const activeWorkout = this.requireActiveWorkout();
    const next = applyWorkoutEvent(activeWorkout, event);
    await this.repository.commitInboundWorkoutEvent(event.eventId, next);
    this.state.activeWorkout = next;
    this.state.syncStatus = 'synced';
    this.state.lastError = null;
    this.refreshPendingCount();
    this.emit();
    return { duplicate: false };
  }

  async receiveSnapshot(serialized) {
    const snapshot = parseSyncSnapshot(serialized);
    if (this.repository.hasReceipt(snapshot.snapshotId)) {
      return { duplicate: true };
    }
    let next = activeWorkoutFromSnapshot(snapshot);
    const localPendingEvents = this.repository
      .pending()
      .filter(
        (envelope) =>
          Object.prototype.hasOwnProperty.call(envelope, 'eventId') &&
          envelope.source === 'WATCH' &&
          envelope.sessionId === snapshot.sessionId &&
          envelope.revision > snapshot.revision,
      )
      .sort((left, right) => left.revision - right.revision || left.timestamp - right.timestamp);
    for (const event of localPendingEvents) {
      next = applyWorkoutEvent(next, event);
    }

    await this.repository.commitSnapshot(snapshot.snapshotId, next);
    const lastSnapshotAt = this.clock();
    await this.repository.updateState({ lastSnapshotAt, lastError: null });
    this.state.activeWorkout = next;
    this.state.lastSnapshotAt = lastSnapshotAt;
    this.state.syncStatus = 'synced';
    this.state.lastError = null;
    this.refreshPendingCount();
    this.emit();
    return { duplicate: false };
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
      source: this.source,
      timestamp: this.clock(),
      type,
    });
  }

  async sendEncoded(encoded) {
    if (encoded.mode === 'MESSAGE') {
      await this.transport.send(encoded.serialized);
    } else {
      await this.transport.sendFile(encoded.serialized);
    }
  }

  requireActiveWorkout() {
    if (!this.state.activeWorkout || this.state.activeWorkout.session.status === 'FINISHED') {
      throw new Error('No active workout is available.');
    }
    return this.state.activeWorkout;
  }

  lastSetForCurrentExercise(activeWorkout) {
    const exercise = currentExercise(activeWorkout);
    if (!exercise) {
      throw new Error('No active exercise is available.');
    }
    const completedSets = completedSetsForExercise(
      activeWorkout,
      exercise.exerciseSessionId,
    );
    const previous = completedSets[completedSets.length - 1];
    if (!previous) {
      throw new Error('No completed set is available.');
    }
    return previous;
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

export function encodeSnapshotForDebugTransport(snapshot) {
  return encodeSyncSnapshotForTransport(snapshot);
}
