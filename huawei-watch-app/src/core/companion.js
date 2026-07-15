import {
  assertDataEnvelopeSize,
  createFileTransferEnvelope,
  createSyncAck,
  createWatchEvent,
  encodeSyncSnapshotForTransport,
  encodeWatchEventForTransport,
  parseFileTransferEnvelope,
  parseSyncAck,
  parseSyncSnapshot,
  parseWatchEvent,
  serializeFileTransferEnvelope,
  serializeSyncAck,
  validateSensorSample,
  validateSetRecord,
  WatchEventType,
} from './contracts.js';
import { canonicalSha256 } from './canonical-json.js';
import {
  ControlMessageType,
  createControlMessage,
  parseControlMessage,
  PROTOCOL_VERSION,
  serializeControlMessage,
} from './messages.js';
import { assertTransport, ConnectionState } from './transport.js';
import {
  buildSensorBatches,
  createUnavailableProductionCollectors,
  SensorPhase,
  SensorType,
  summarizeHeartRate,
  summarizeRestHeartRate,
} from './sensors.js';
import { restTimerState, setElapsedMs, workoutElapsedMs } from './timers.js';
import {
  createUnavailableVibrationAdapter,
  VibrationCue,
} from './vibration.js';
import {
  activeWorkoutFromSnapshot,
  applyWorkoutEvent,
  completedSetsForExercise,
  currentExercise,
  nextExercise,
  withRestSummary,
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

const SENSOR_FLUSH_EVENT_TYPES = new Set([
  WatchEventType.SET_COMPLETED,
  WatchEventType.REST_FINISHED,
  WatchEventType.REST_SKIPPED,
  WatchEventType.WORKOUT_FINISHED,
]);

export class WatchCompanion {
  constructor({
    clock = () => Date.now(),
    deviceId,
    eventIdGenerator = defaultUuidGenerator,
    idGenerator = defaultIdGenerator,
    repository,
    sensorCollectors = createUnavailableProductionCollectors(),
    sensorSampleLimit = 2_048,
    setIdGenerator = defaultSetIdGenerator,
    source = 'WATCH',
    transport,
    vibrationAdapter = createUnavailableVibrationAdapter(),
  }) {
    this.clock = clock;
    this.deviceId = deviceId;
    this.eventIdGenerator = eventIdGenerator;
    this.idGenerator = idGenerator;
    this.repository = repository;
    this.sensorCollectors = sensorCollectors;
    this.sensorSampleLimit = sensorSampleLimit;
    this.setIdGenerator = setIdGenerator;
    this.source = source;
    this.transport = assertTransport(transport);
    this.vibrationAdapter = vibrationAdapter;
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
      lastErrorCode: null,
      lastSyncAt: null,
      conflictCount: 0,
      activeWorkout: null,
      lastWorkout: null,
      currentHeartRate: null,
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
      lastWorkout: document.lastWorkout,
      pendingCount: document.outbox.length,
      connection: ConnectionState.CONNECTING,
    };
    this.started = true;
    this.transport.setMessageHandler((serialized) => this.receive(serialized));
    this.transport.setFileHandler((serialized) => this.receiveFile(serialized));
    this.transport.setConnectionHandler((connection, error) => this.onConnection(connection, error));
    await this.refreshSensorCollectors();
    this.emit();
    await this.transport.connect();
  }

  async stop() {
    if (!this.started) {
      return;
    }
    await this.collectSensorSamples();
    await this.queueSensorBatches({ collect: false, send: false });
    for (const collector of this.sensorCollectors) {
      await collector.stop();
    }
    await this.transport.disconnect();
    this.started = false;
  }

  async reconnect() {
    if (
      !this.started ||
      this.state.connection === ConnectionState.CONNECTED ||
      this.state.connection === ConnectionState.CONNECTING
    ) {
      return;
    }
    await this.transport.connect();
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
      if (Object.prototype.hasOwnProperty.call(envelope, 'ackId')) {
        return await this.receiveSyncAck(serialized);
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
      return await this.receiveFileTransfer(serialized);
    } catch (error) {
      await this.recordError(error);
      return { duplicate: false, error };
    }
  }

  async onConnection(connection, error) {
    this.state.connection = connection;
    const errorCode = error ? sanitizedErrorCode(error) : null;
    this.state.lastError = errorCode;
    this.state.lastErrorCode = errorCode;
    if (connection === ConnectionState.ERROR) {
      this.state.syncStatus = 'error';
      await this.repository.updateState({ lastError: errorCode, lastErrorCode: errorCode });
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
      try {
        await this.queueSensorBatches({ send: false });
        await this.flushPending();
      } catch (replayError) {
        await this.recordError(replayError);
        return;
      }
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
    const pendingFiles = this.repository
      .pendingFileTransfers('OUTBOUND')
      .sort(
        (left, right) =>
          left.createdAt - right.createdAt ||
          left.sequence - right.sequence ||
          left.transferId.localeCompare(right.transferId),
      );
    for (const transfer of pendingFiles) {
      await this.transport.sendFile(serializeFileTransferEnvelope(transfer.envelope));
    }

    const pending = this.repository.pending().sort(comparePendingEnvelopes);
    for (const envelope of pending) {
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
    if (activeWorkout.pendingSet || activeWorkout.rest) {
      throw new Error('Finish the active set or rest before changing exercise.');
    }
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
    const completedAt = this.clock();
    await this.collectSensorSamples();
    const samples = this.repository.sensorSamples().filter(
      (sample) =>
        sample.phase === SensorPhase.SET &&
        sample.setId === pendingSet.setId,
    );
    const heartRate = summarizeHeartRate(samples, pendingSet.startedAt, completedAt);
    const completedEvent = await this.emitWorkoutEvent(WatchEventType.SET_COMPLETED, (revision) => {
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
        completedAt,
        source: this.source,
        heartRateSummary: {
          min: heartRate.min,
          max: heartRate.max,
          average: heartRate.average,
          start: heartRate.start,
          end: heartRate.end,
          sampleCount: heartRate.sampleCount,
        },
        sensorSummary: { heartRateDurationMs: heartRate.durationMs },
        revision,
      };
      return validateSetRecord(setRecord);
    });
    await this.flushSensorBatches();
    await this.startRest(
      completedEvent.payload.setId,
      completedEvent.payload.exerciseSessionId,
    );
    return completedEvent;
  }

  async startRest(setId, exerciseSessionId) {
    const activeWorkout = this.requireActiveWorkout();
    const exercise = activeWorkout.exercises.find(
      (candidate) => candidate.exerciseSessionId === exerciseSessionId,
    );
    if (!exercise) {
      throw new Error('No active exercise is available for rest.');
    }
    const startedAt = this.clock();
    return this.emitWorkoutEvent(WatchEventType.REST_STARTED, {
      setId,
      startedAt,
      restEndsAt: startedAt + exercise.restDurationSeconds * 1_000,
    });
  }

  async adjustRest(seconds) {
    const activeWorkout = this.requireActiveWorkout();
    if (!activeWorkout.rest || ![15, 30].includes(seconds)) {
      throw new Error('Rest can only be extended by 15 or 30 seconds.');
    }
    return this.emitWorkoutEvent(WatchEventType.REST_UPDATED, {
      restEndsAt: activeWorkout.rest.restEndsAt + seconds * 1_000,
      reason: seconds === 15 ? 'ADD_15_SECONDS' : 'ADD_30_SECONDS',
    });
  }

  async skipRest() {
    const activeWorkout = this.requireActiveWorkout();
    if (!activeWorkout.rest) {
      return null;
    }
    const setId = activeWorkout.rest.setId;
    const skippedAt = this.clock();
    await this.collectSensorSamples();
    const summary = this.liveRestSummary(skippedAt);
    const event = await this.emitWorkoutEvent(
      WatchEventType.REST_SKIPPED,
      { skippedAt },
      (next) => withRestSummary(next, setId, summary),
    );
    await this.flushSensorBatches();
    return event;
  }

  async togglePause() {
    const activeWorkout = this.requireActiveWorkout();
    if (activeWorkout.session.status === 'PAUSED') {
      return this.emitWorkoutEvent(WatchEventType.WORKOUT_RESUMED, {
        resumedAt: this.clock(),
      });
    }
    return this.emitWorkoutEvent(WatchEventType.WORKOUT_PAUSED, {
      pausedAt: this.clock(),
    });
  }

  async startNextSetFromRest() {
    const activeWorkout = this.requireActiveWorkout();
    if (activeWorkout.session.status === 'PAUSED') {
      await this.togglePause();
    }
    if (this.state.activeWorkout.rest) {
      await this.skipRest();
    }
    return this.startSet();
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
    await this.flushSensorBatches();
    return this.emitWorkoutEvent(WatchEventType.WORKOUT_FINISHED, {
      finishedAt: this.clock(),
    });
  }

  async emitWorkoutEvent(type, payloadOrFactory, transformNext = (next) => next) {
    await this.collectSensorSamples();
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
    const next = transformNext(applyWorkoutEvent(activeWorkout, event));
    await this.repository.commitOutboundWorkoutEvent(event, next);
    this.state.activeWorkout = next;
    this.state.lastWorkout = this.repository.snapshot().lastWorkout;
    await this.refreshSensorCollectors();
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
      this.state.lastErrorCode = null;
    } else if (message.type === ControlMessageType.SYNC_SNAPSHOT) {
      const lastSnapshotAt = this.clock();
      await this.repository.removePending(message.replyTo);
      await this.repository.updateState({ lastSnapshotAt, lastError: null });
      this.state.lastSnapshotAt = lastSnapshotAt;
      this.state.syncStatus = 'synced';
      this.state.lastError = null;
      this.state.lastErrorCode = null;
    }

    this.refreshPendingCount();
    this.emit();
    return { duplicate: false };
  }

  async receiveWatchEvent(serialized) {
    await this.collectSensorSamples();
    const event = parseWatchEvent(serialized);
    const eventHash = canonicalSha256(event);
    const existing = this.repository.receiptRecord(event.eventId);
    if (existing) {
      if (existing.canonicalHash !== null && existing.canonicalHash !== eventHash) {
        await this.recordConflict({
          code: 'EVENT_ID_REUSE',
          eventId: event.eventId,
          sessionId: event.sessionId,
          localHash: existing.canonicalHash,
          remoteHash: eventHash,
        });
        await this.sendSyncAck(event, 'CONFLICT', 'EVENT_ID_REUSE');
        return { conflict: true, duplicate: false };
      }
      const status = existing.status === 'APPLIED' ? 'DUPLICATE' : existing.status;
      await this.sendSyncAck(
        event,
        status,
        status === 'DUPLICATE' ? null : existing.errorCode || status,
      );
      await this.repository.removePendingInboundEvent(event.eventId);
      return { duplicate: true };
    }
    const activeWorkout = this.requireActiveWorkout();
    if (event.sessionId !== activeWorkout.session.sessionId) {
      await this.commitRejectedEvent(event, eventHash, 'SESSION_MISMATCH');
      await this.repository.removePendingInboundEvent(event.eventId);
      return { duplicate: false, rejected: true };
    }
    if (event.revision < activeWorkout.revision) {
      await this.commitRejectedEvent(event, eventHash, 'STALE_REVISION', 'STALE');
      await this.repository.removePendingInboundEvent(event.eventId);
      return { duplicate: false, stale: true };
    }
    if (event.revision === activeWorkout.revision) {
      const localConcurrentEvent = this.repository
        .pending()
        .find(
          (pending) =>
            pending.eventId &&
            pending.source === this.source &&
            pending.sessionId === event.sessionId &&
            pending.revision === event.revision,
        );
      await this.commitRejectedEvent(
        event,
        eventHash,
        'CONCURRENT_REVISION',
        'CONFLICT',
        localConcurrentEvent ? canonicalSha256(localConcurrentEvent) : null,
      );
      await this.repository.removePendingInboundEvent(event.eventId);
      return { conflict: true, duplicate: false };
    }
    if (event.revision > activeWorkout.revision + 1) {
      await this.repository.rememberPendingInboundEvent(
        event,
        eventHash,
        'REVISION_GAP',
        this.clock(),
      );
      await this.recordConflict({
        code: 'REVISION_GAP',
        eventId: event.eventId,
        sessionId: event.sessionId,
        remoteHash: eventHash,
      });
      await this.requestState('revision-gap');
      return { duplicate: false, gap: true };
    }
    if (event.type === WatchEventType.SENSOR_BATCH_RECORDED) {
      await this.commitRejectedEvent(event, eventHash, 'UNSUPPORTED_INBOUND_SENSOR_BATCH');
      return { duplicate: false, rejected: true };
    }
    const next = applyWorkoutEvent(activeWorkout, event);
    await this.repository.commitInboundWorkoutEvent(event.eventId, next, {
      canonicalHash: eventHash,
      recordedAt: this.clock(),
      sessionId: event.sessionId,
      status: 'APPLIED',
    });
    await this.repository.completeInboundTransferForEvent(event.eventId);
    await this.repository.removePendingInboundEvent(event.eventId);
    this.state.activeWorkout = next;
    this.state.lastWorkout = this.repository.snapshot().lastWorkout;
    await this.refreshSensorCollectors();
    if (SENSOR_FLUSH_EVENT_TYPES.has(event.type)) {
      await this.queueSensorBatches({ collect: false });
    }
    this.state.syncStatus = 'synced';
    this.state.lastError = null;
    this.state.lastErrorCode = null;
    this.state.lastSyncAt = this.clock();
    await this.repository.updateState({
      lastError: null,
      lastErrorCode: null,
      lastSyncAt: this.state.lastSyncAt,
    });
    this.refreshPendingCount();
    this.emit();
    await this.sendSyncAck(event, 'APPLIED', null);
    return { duplicate: false };
  }

  async receiveSnapshot(serialized) {
    await this.collectSensorSamples();
    await this.queueSensorBatches({ collect: false });
    const snapshot = parseSyncSnapshot(serialized);
    const localBeforeSnapshot = this.state.activeWorkout;
    const snapshotHash = canonicalSha256(snapshot);
    const existing = this.repository.receiptRecord(snapshot.snapshotId);
    if (existing?.canonicalHash && existing.canonicalHash !== snapshotHash) {
      await this.recordConflict({
        code: 'SNAPSHOT_ID_REUSE',
        eventId: snapshot.snapshotId,
        sessionId: snapshot.sessionId,
        localHash: existing.canonicalHash,
        remoteHash: snapshotHash,
      });
      return { conflict: true, duplicate: false };
    }
    if (existing || this.repository.hasReceipt(snapshot.snapshotId)) {
      return { duplicate: true };
    }
    let next = activeWorkoutFromSnapshot(snapshot);
    const appliedRemotePending = [];
    const remotePendingEvents = [...snapshot.pendingEvents].sort(compareWorkoutEvents);
    let revisionGap = false;
    for (const event of remotePendingEvents) {
      if (event.type === WatchEventType.SENSOR_BATCH_RECORDED) {
        revisionGap = true;
        break;
      }
      if (event.revision <= next.revision) {
        continue;
      }
      if (event.revision !== next.revision + 1) {
        revisionGap = true;
        break;
      }
      next = applyWorkoutEvent(next, event);
      appliedRemotePending.push(event);
    }
    const localPendingEvents = this.repository
      .pending()
      .filter(
        (envelope) =>
          Object.prototype.hasOwnProperty.call(envelope, 'eventId') &&
          envelope.source === 'WATCH' &&
          envelope.sessionId === snapshot.sessionId,
      )
      .sort(compareWorkoutEvents);
    for (const event of localPendingEvents) {
      if (event.revision <= next.revision) {
        if (event.revision === next.revision) {
          await this.recordConflict({
            code: 'SNAPSHOT_PENDING_CONFLICT',
            eventId: event.eventId,
            sessionId: event.sessionId,
            localHash: canonicalSha256(event),
            remoteHash: snapshotHash,
            recordedAt: this.clock(),
          });
          revisionGap = true;
          break;
        }
        continue;
      }
      if (event.revision !== next.revision + 1) {
        revisionGap = true;
        break;
      }
      next = applyWorkoutEvent(next, event);
    }

    next = preserveRestSummaries(next, localBeforeSnapshot);

    await this.repository.commitSnapshot(snapshot.snapshotId, next, {
      canonicalHash: snapshotHash,
      recordedAt: this.clock(),
      sessionId: snapshot.sessionId,
      watermark: {
        snapshotId: snapshot.snapshotId,
        sessionId: snapshot.sessionId,
        revision: snapshot.revision,
        timestamp: snapshot.timestamp,
      },
    });
    for (const event of appliedRemotePending) {
      await this.repository.rememberProcessedEnvelope({
        canonicalHash: canonicalSha256(event),
        id: event.eventId,
        kind: 'EVENT',
        recordedAt: this.clock(),
        sessionId: event.sessionId,
        status: 'APPLIED',
      });
    }
    const lastSnapshotAt = this.clock();
    const lastSyncAt = this.clock();
    await this.repository.updateState({
      lastSnapshotAt,
      lastError: revisionGap ? 'REVISION_GAP' : null,
      lastErrorCode: revisionGap ? 'REVISION_GAP' : null,
      lastSyncAt,
    });
    this.state.activeWorkout = next;
    this.state.lastWorkout = this.repository.snapshot().lastWorkout;
    await this.refreshSensorCollectors();
    this.state.lastSnapshotAt = lastSnapshotAt;
    this.state.lastSyncAt = lastSyncAt;
    this.state.syncStatus = revisionGap ? 'requesting' : 'synced';
    this.state.lastError = revisionGap ? 'REVISION_GAP' : null;
    this.state.lastErrorCode = this.state.lastError;
    this.refreshPendingCount();
    this.emit();
    if (!revisionGap) {
      await this.replayPendingInboundEvents();
    }
    if (revisionGap) {
      await this.requestState('revision-gap');
    }
    return { duplicate: false };
  }

  async receiveSyncAck(serialized) {
    const ack = parseSyncAck(serialized);
    const ackHash = canonicalSha256(ack);
    const existing = this.repository.receiptRecord(ack.ackId);
    if (existing) {
      if (existing.canonicalHash !== null && existing.canonicalHash !== ackHash) {
        await this.recordConflict({
          code: 'ACK_ID_REUSE',
          ackId: ack.ackId,
          sessionId: ack.sessionId,
          localHash: existing.canonicalHash,
          remoteHash: ackHash,
        });
        return { conflict: true, duplicate: false };
      }
      return { duplicate: true };
    }
    const acknowledgedPending = this.repository
      .pending()
      .filter((entry) => entry.eventId && ack.eventIds.includes(entry.eventId));
    if (
      ack.source === this.source ||
      acknowledgedPending.some((event) => event.sessionId !== ack.sessionId)
    ) {
      await this.recordConflict({
        code: 'ACK_IDENTITY_MISMATCH',
        ackId: ack.ackId,
        eventIds: ack.eventIds,
        sessionId: ack.sessionId,
        remoteHash: ackHash,
      });
      return { conflict: true, duplicate: false };
    }
    const maxAcknowledgedRevision = acknowledgedPending.reduce(
      (maximum, event) => Math.max(maximum, event.revision),
      0,
    );
    if (maxAcknowledgedRevision > 0 && ack.revision < maxAcknowledgedRevision) {
      await this.recordConflict({
        code: 'ACK_REVISION_REGRESSION',
        ackId: ack.ackId,
        eventIds: ack.eventIds,
        sessionId: ack.sessionId,
        remoteHash: ackHash,
      });
      return { conflict: true, duplicate: false };
    }
    const result = await this.repository.applySyncAck(ack, ackHash);
    const document = this.repository.snapshot();
    this.state.lastSyncAt = document.state.lastSyncAt;
    this.state.lastError = document.state.lastError;
    this.state.lastErrorCode = document.state.lastErrorCode;
    this.state.conflictCount = document.state.conflictCount;
    this.state.syncStatus =
      ack.status === 'APPLIED' || ack.status === 'DUPLICATE' ? 'synced' : 'error';
    this.refreshPendingCount();
    this.emit();
    return result;
  }

  async receiveFileTransfer(serialized) {
    const envelope = parseFileTransferEnvelope(serialized);
    const transferHash = canonicalSha256(envelope);
    const existing =
      this.repository.transferRecord(envelope.transferId) ||
      this.repository.receiptRecord(envelope.transferId);
    if (existing) {
      if (existing.canonicalHash !== transferHash) {
        await this.recordConflict({
          code: 'FILE_TRANSFER_ID_REUSE',
          eventId: envelope.relatedEventId,
          sessionId: envelope.sessionId,
          localHash: existing.canonicalHash,
          remoteHash: transferHash,
        });
        return { conflict: true, duplicate: false };
      }
      return { duplicate: true };
    }
    if (envelope.payloadType === 'SENSOR_BATCH') {
      await this.recordConflict({
        code: 'UNSUPPORTED_INBOUND_SENSOR_BATCH',
        eventId: envelope.relatedEventId,
        sessionId: envelope.sessionId,
        remoteHash: transferHash,
      });
      return { duplicate: false, rejected: true };
    }
    await this.repository.rememberInboundTransfer(envelope, transferHash, this.clock());
    if (envelope.payloadType === 'SYNC_SNAPSHOT') {
      const result = await this.receiveSnapshot(JSON.stringify(envelope.payload));
      await this.repository.removeFileTransfer(envelope.transferId);
      return result;
    }
    throw new Error('EVENT_BATCH file payloads are not implemented by the watch runtime.');
  }

  async replayPendingInboundEvents() {
    const pending = this.repository
      .pendingInboundEvents()
      .map((entry) => entry.event)
      .sort(compareWorkoutEvents);
    for (const event of pending) {
      const activeRevision = this.state.activeWorkout?.revision ?? 0;
      if (event.revision > activeRevision + 1) {
        break;
      }
      await this.receiveWatchEvent(JSON.stringify(event));
    }
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

  async sendSyncAck(event, status, errorCode) {
    const ack = createSyncAck({
      ackId: this.eventIdGenerator(),
      deviceId: this.deviceId,
      errorCode,
      eventIds: [event.eventId],
      revision: this.state.activeWorkout?.revision || 0,
      sessionId: event.sessionId,
      source: this.source,
      status,
      timestamp: this.clock(),
    });
    if (this.state.connection === ConnectionState.CONNECTED) {
      await this.transport.send(serializeSyncAck(ack));
    }
    return ack;
  }

  async commitRejectedEvent(
    event,
    eventHash,
    errorCode,
    status = 'REJECTED',
    localHash = null,
  ) {
    await this.repository.commitInboundWorkoutEvent(event.eventId, null, {
      canonicalHash: eventHash,
      errorCode,
      recordedAt: this.clock(),
      sessionId: event.sessionId,
      status,
    });
    await this.recordConflict({
      code: errorCode,
      eventId: event.eventId,
      sessionId: event.sessionId,
      localHash,
      remoteHash: eventHash,
      recordedAt: this.clock(),
    });
    await this.sendSyncAck(event, status, errorCode);
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

  async recordSensorSample(sample) {
    validateSensorSample(sample);
    const context = this.sensorContext();
    if (!context || sample.sessionId !== context.sessionId || sample.phase !== context.phase) {
      throw new Error('Sensor sample does not match the active session phase.');
    }
    if (
      sample.exerciseSessionId !== context.exerciseSessionId ||
      sample.setId !== context.setId
    ) {
      throw new Error('Sensor sample does not match the active exercise or set.');
    }
    if (sample.valid === false && sample.value !== null) {
      throw new Error('Invalid sensor sample value must be null.');
    }
    if (
      sample.sensorType === SensorType.HEART_RATE &&
      sample.valid === true &&
      (typeof sample.value !== 'number' || sample.value <= 0)
    ) {
      throw new Error('Valid heart-rate sample must contain a positive number.');
    }
    if (this.repository.unassignedSensorSamples().length >= this.sensorSampleLimit) {
      await this.queueSensorBatches({ collect: false });
    }
    await this.repository.appendSensorSample(sample, this.sensorSampleLimit);
    if (sample.sensorType === SensorType.HEART_RATE) {
      const currentHeartRate =
        sample.valid === true && typeof sample.value === 'number' && sample.value > 0
          ? sample.value
          : null;
      this.state.currentHeartRate = currentHeartRate;
      await this.repository.updateState({ currentHeartRate });
      this.emit();
    }
    return sample;
  }

  async collectSensorSamples() {
    for (const collector of this.sensorCollectors) {
      for (const sample of collector.flushSamples()) {
        await this.recordSensorSample(sample);
      }
    }
  }

  async flushSensorBatches() {
    return this.queueSensorBatches();
  }

  async queueSensorBatches({ collect = true, send = true } = {}) {
    if (collect) {
      await this.collectSensorSamples();
    }
    const samples = this.repository.unassignedSensorSamples();
    if (samples.length === 0) {
      return [];
    }
    if (!this.state.activeWorkout) {
      return [];
    }
    let activeWorkout = this.state.activeWorkout;
    const batchId = this.eventIdGenerator();
    const batches = buildSensorBatches({
      batchId,
      createdAt: this.clock(),
      deviceId: this.deviceId,
      samples,
      sessionId: activeWorkout.session.sessionId,
      source: this.source,
    });
    const events = [];
    const transfers = [];
    for (const batch of batches) {
      const event = createWatchEvent({
        deviceId: this.deviceId,
        eventId: this.eventIdGenerator(),
        payload: {
          batchId: batch.batchId,
          sequence: batch.sequence,
          totalSequences: batch.totalSequences,
          deliveryMode: 'FILE',
          sampleCount: batch.sampleCount,
        },
        revision: activeWorkout.revision + 1,
        sessionId: activeWorkout.session.sessionId,
        source: this.source,
        timestamp: this.clock(),
        type: WatchEventType.SENSOR_BATCH_RECORDED,
      });
      activeWorkout = applyWorkoutEvent(activeWorkout, event);
      const envelope = createFileTransferEnvelope({
        createdAt: this.clock(),
        deviceId: this.deviceId,
        payload: batch,
        payloadId: batch.batchId,
        payloadType: 'SENSOR_BATCH',
        relatedEventId: event.eventId,
        sequence: batch.sequence,
        sessionId: batch.sessionId,
        source: this.source,
        totalSequences: batch.totalSequences,
        transferId: this.eventIdGenerator(),
      });
      serializeFileTransferEnvelope(envelope);
      events.push(event);
      transfers.push({
        transferId: envelope.transferId,
        relatedEventId: event.eventId,
        sessionId: event.sessionId,
        payloadId: batch.batchId,
        sequence: batch.sequence,
        totalSequences: batch.totalSequences,
        createdAt: envelope.createdAt,
        canonicalHash: canonicalSha256(envelope),
        envelope,
        sampleIds: batch.samples.map((sample) => sample.sampleId),
      });
    }
    await this.repository.commitOutboundSensorTransfers({
      activeWorkout,
      events,
      transfers,
    });
    this.state.activeWorkout = activeWorkout;
    this.refreshPendingCount();
    this.emit();
    if (send && this.state.connection === ConnectionState.CONNECTED) {
      for (let index = 0; index < transfers.length; index += 1) {
        await this.transport.sendFile(serializeFileTransferEnvelope(transfers[index].envelope));
        await this.sendEncoded(encodeWatchEventForTransport(events[index]));
      }
    }
    return batches;
  }

  timerState(now = this.clock()) {
    const activeWorkout = this.state.activeWorkout;
    return {
      workoutElapsedMs: workoutElapsedMs(activeWorkout, now),
      setElapsedMs: setElapsedMs(activeWorkout, now),
      rest: restTimerState(activeWorkout, now),
      restSummary: this.liveRestSummary(now),
    };
  }

  liveRestSummary(now = this.clock()) {
    const rest = this.state.activeWorkout?.rest;
    if (!rest) {
      return this.state.activeWorkout?.lastRestSummary || null;
    }
    const samples = this.repository
      .sensorSamples()
      .filter((sample) => sample.phase === SensorPhase.REST && sample.setId === rest.setId);
    return summarizeRestHeartRate(samples, rest.startedAt, Math.min(now, rest.restEndsAt));
  }

  async checkRestTimer(now = this.clock()) {
    const activeWorkout = this.state.activeWorkout;
    if (!activeWorkout?.rest || activeWorkout.session.status === 'PAUSED') {
      return this.timerState(now);
    }
    const timer = restTimerState(activeWorkout, now);
    if (timer.remainingMs > 0 && timer.remainingMs <= 10_000 && !activeWorkout.rest.warningVibrated) {
      activeWorkout.rest.warningVibrated = true;
      if (this.vibrationAdapter.isSupported()) {
        await this.vibrationAdapter.vibrate(VibrationCue.REST_WARNING);
      }
      await this.repository.saveActiveWorkout(activeWorkout);
      this.emit();
    }
    if (timer.expired) {
      if (!activeWorkout.rest.finishVibrated) {
        activeWorkout.rest.finishVibrated = true;
        if (this.vibrationAdapter.isSupported()) {
          await this.vibrationAdapter.vibrate(VibrationCue.REST_FINISHED);
        }
        await this.repository.saveActiveWorkout(activeWorkout);
      }
      await this.collectSensorSamples();
      const finishedAt = activeWorkout.rest.restEndsAt;
      const summary = this.liveRestSummary(finishedAt);
      await this.emitWorkoutEvent(WatchEventType.REST_FINISHED, {
        finishedAt,
        summary,
      });
      await this.flushSensorBatches();
    }
    return this.timerState(now);
  }

  async lifecycleCheckpoint(now = this.clock()) {
    await this.collectSensorSamples();
    await this.checkRestTimer(now);
    await this.queueSensorBatches({ collect: false });
    if (this.state.activeWorkout) {
      await this.repository.saveActiveWorkout(this.state.activeWorkout);
    }
    return this.timerState(now);
  }

  async refreshSensorCollectors() {
    const context = this.sensorContext();
    for (const collector of this.sensorCollectors) {
      await collector.stop();
      if (!context || !collector.isSupported()) {
        continue;
      }
      if (await collector.requestPermission()) {
        await collector.start(context);
      }
    }
  }

  sensorContext() {
    const activeWorkout = this.state.activeWorkout;
    if (!activeWorkout || activeWorkout.session.status === 'FINISHED') {
      return null;
    }
    const exercise = currentExercise(activeWorkout);
    let phase = SensorPhase.WORKOUT;
    let setId = null;
    if (activeWorkout.session.status === 'PAUSED') {
      phase = SensorPhase.PAUSE;
    } else if (activeWorkout.pendingSet) {
      phase = SensorPhase.SET;
      setId = activeWorkout.pendingSet.setId;
    } else if (activeWorkout.rest) {
      phase = SensorPhase.REST;
      setId = activeWorkout.rest.setId;
    }
    return {
      sessionId: activeWorkout.session.sessionId,
      exerciseSessionId: exercise?.exerciseSessionId || null,
      setId,
      phase,
    };
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
    const code = sanitizedErrorCode(error);
    this.state.lastError = code;
    this.state.lastErrorCode = code;
    this.state.syncStatus = 'error';
    await this.repository.updateState({ lastError: code, lastErrorCode: code });
    this.refreshPendingCount();
    this.emit();
  }

  async recordConflict(conflict) {
    await this.repository.recordConflict({
      ...conflict,
      recordedAt: conflict.recordedAt ?? this.clock(),
    });
    const document = this.repository.snapshot();
    this.state.conflictCount = document.state.conflictCount;
    this.state.lastError = document.state.lastError;
    this.state.lastErrorCode = document.state.lastErrorCode;
    this.state.syncStatus = 'error';
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

function compareWorkoutEvents(left, right) {
  return (
    left.revision - right.revision ||
    left.timestamp - right.timestamp ||
    left.eventId.localeCompare(right.eventId)
  );
}

function preserveRestSummaries(next, previous) {
  if (!previous || previous.session.sessionId !== next.session.sessionId) {
    return next;
  }
  const retainedSetIds = new Set(next.completedSets.map((set) => set.setId));
  const bySetId = new Map();
  for (const summary of previous.restSummaries || []) {
    if (retainedSetIds.has(summary.setId)) {
      bySetId.set(summary.setId, summary);
    }
  }
  for (const summary of next.restSummaries || []) {
    if (retainedSetIds.has(summary.setId)) {
      bySetId.set(summary.setId, summary);
    }
  }
  next.restSummaries = [...bySetId.values()].sort(
    (left, right) => left.finishedAt - right.finishedAt || left.setId.localeCompare(right.setId),
  );
  if (next.restSummaries.length > 0) {
    const summary = { ...next.restSummaries[next.restSummaries.length - 1] };
    delete summary.setId;
    next.lastRestSummary = summary;
  }
  return next;
}

function comparePendingEnvelopes(left, right) {
  const leftEvent = Object.prototype.hasOwnProperty.call(left, 'eventId');
  const rightEvent = Object.prototype.hasOwnProperty.call(right, 'eventId');
  if (leftEvent && rightEvent) {
    return compareWorkoutEvents(left, right);
  }
  if (leftEvent !== rightEvent) {
    return leftEvent ? 1 : -1;
  }
  return (left.timestamp || 0) - (right.timestamp || 0);
}

function sanitizedErrorCode(error) {
  const raw =
    error && typeof error === 'object' && typeof error.code === 'string'
      ? error.code
      : error instanceof Error
        ? error.message || error.name
        : String(error);
  return (
    raw
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 64) || 'SYNC_ERROR'
  );
}
