package org.sharteman.gymcoach.watch.sync

import java.util.UUID
import kotlinx.coroutines.sync.withLock
import org.sharteman.gymcoach.watch.data.WatchWorkoutGateway
import org.sharteman.gymcoach.watch.data.WatchWorkoutProtocolCodec
import org.sharteman.gymcoach.watch.data.WatchProtocolCodec
import org.sharteman.gymcoach.watch.domain.WatchEventEnvelopeDto
import org.sharteman.gymcoach.watch.domain.WatchEventSource
import org.sharteman.gymcoach.watch.domain.WatchEventType
import org.sharteman.gymcoach.watch.domain.WatchProtocol
import org.sharteman.gymcoach.watch.domain.WatchSensorBatchDto
import org.sharteman.gymcoach.watch.domain.WatchSyncAckDto
import org.sharteman.gymcoach.watch.domain.WatchSyncSnapshotDto

interface WatchWorkoutResponseSink {
    suspend fun sendSnapshot(snapshot: WatchSyncSnapshotDto)
    suspend fun sendAck(ack: WatchSyncAckDto)
    suspend fun sendEvent(event: WatchEventEnvelopeDto)
}

class WatchWorkoutCoordinator(
    private val gateway: WatchWorkoutGateway,
    private val sink: WatchWorkoutResponseSink,
    private val phoneDeviceId: String,
    private val codec: WatchWorkoutProtocolCodec = WatchWorkoutProtocolCodec(),
    private val eventCodec: WatchProtocolCodec = WatchProtocolCodec(),
    private val nowEpochMs: () -> Long = System::currentTimeMillis,
    private val newUuid: () -> String = { UUID.randomUUID().toString() },
    private val syncPersistence: WatchSyncPersistence = InMemoryWatchSyncPersistence(nowEpochMs),
) : WatchEventConsumer, WatchAckConsumer {
    private val replayMutex = kotlinx.coroutines.sync.Mutex()

    override suspend fun onEvent(event: WatchEventEnvelopeDto) {
        when (val inbox = syncPersistence.recordIncoming(event).registration) {
            WatchInboxRegistration.EVENT_ID_REUSE -> {
                sendAck(
                    event,
                    org.sharteman.gymcoach.watch.data.WatchWorkoutApplyResult(
                        org.sharteman.gymcoach.watch.domain.WatchSyncAckStatus.REJECTED,
                        event.revision,
                        "EVENT_ID_REUSE",
                    ),
                )
                return
            }
            WatchInboxRegistration.DUPLICATE -> {
                sendAck(
                    event,
                    org.sharteman.gymcoach.watch.data.WatchWorkoutApplyResult(
                        org.sharteman.gymcoach.watch.domain.WatchSyncAckStatus.DUPLICATE,
                        event.revision,
                    ),
                )
                return
            }
            WatchInboxRegistration.NEW -> Unit
        }
        if (event.type == WatchEventType.SYNC_REQUESTED) {
            gateway.buildSnapshot(event.sessionId)?.let { sink.sendSnapshot(it) }
            syncPersistence.finishIncoming(
                event.eventId,
                org.sharteman.gymcoach.watch.domain.WatchSyncAckStatus.APPLIED,
                event.revision,
                null,
            )
            return
        }
        val result = gateway.applyWatchEvent(event)
        if (!result.isReplayableRevisionGap()) {
            syncPersistence.finishIncoming(event.eventId, result.status, result.revision, result.errorCode)
        }
        sendAck(event, result)
        if (result.errorCode == "SYNC_REQUIRED") {
            gateway.buildSnapshot(event.sessionId)?.let { sink.sendSnapshot(it) }
        }
    }

    suspend fun onSensorBatch(event: WatchEventEnvelopeDto, batch: WatchSensorBatchDto) {
        when (syncPersistence.recordIncoming(event).registration) {
            WatchInboxRegistration.EVENT_ID_REUSE -> {
                sendAck(
                    event,
                    org.sharteman.gymcoach.watch.data.WatchWorkoutApplyResult(
                        org.sharteman.gymcoach.watch.domain.WatchSyncAckStatus.REJECTED,
                        event.revision,
                        "EVENT_ID_REUSE",
                    ),
                )
                return
            }
            WatchInboxRegistration.DUPLICATE -> {
                sendAck(
                    event,
                    org.sharteman.gymcoach.watch.data.WatchWorkoutApplyResult(
                        org.sharteman.gymcoach.watch.domain.WatchSyncAckStatus.DUPLICATE,
                        event.revision,
                    ),
                )
                return
            }
            WatchInboxRegistration.NEW -> Unit
        }
        val result = gateway.applySensorBatch(event, batch)
        if (!result.isReplayableRevisionGap()) {
            syncPersistence.finishIncoming(event.eventId, result.status, result.revision, result.errorCode)
        }
        sendAck(event, result)
    }

    private suspend fun sendAck(
        event: WatchEventEnvelopeDto,
        result: org.sharteman.gymcoach.watch.data.WatchWorkoutApplyResult,
    ) {
        sink.sendAck(
            WatchSyncAckDto(
                protocolVersion = WatchProtocol.VERSION,
                schemaVersion = WatchProtocol.SCHEMA_VERSION,
                ackId = newUuid(),
                sessionId = event.sessionId,
                eventIds = listOf(event.eventId),
                status = result.status,
                timestamp = nowEpochMs(),
                source = WatchEventSource.PHONE,
                deviceId = phoneDeviceId,
                revision = result.revision,
                errorCode = result.errorCode,
            ),
        )
    }

    suspend fun changeActiveExerciseFromPhone(sessionId: String, exerciseId: String): Boolean {
        val change = gateway.changeActiveExerciseFromPhone(sessionId, exerciseId) ?: return false
        persistAndSend(
            WatchEventEnvelopeDto(
                protocolVersion = WatchProtocol.VERSION,
                schemaVersion = WatchProtocol.SCHEMA_VERSION,
                eventId = newUuid(),
                sessionId = sessionId,
                type = WatchEventType.ACTIVE_EXERCISE_CHANGED,
                timestamp = change.updatedAtEpochMs,
                source = WatchEventSource.PHONE,
                deviceId = phoneDeviceId,
                revision = change.revision,
                payload = codec.encodeActiveExerciseChangedPayload(change.payload),
            ),
        )
        return true
    }

    override suspend fun onAck(ack: WatchSyncAckDto) {
        syncPersistence.applyAck(ack)
    }

    suspend fun replayPending(sessionId: String? = null) = replayMutex.withLock {
        syncPersistence.replayable(sessionId).forEach { pending ->
            val event = eventCodec.decodeEvent(pending.envelopeJson.encodeToByteArray())
            syncPersistence.markAttempt(event.eventId)
            sink.sendEvent(event)
        }
    }

    suspend fun persistAndSend(event: WatchEventEnvelopeDto, relatedTransferId: String? = null) {
        syncPersistence.enqueue(event, relatedTransferId)
        syncPersistence.markAttempt(event.eventId)
        sink.sendEvent(event)
    }
}

private fun org.sharteman.gymcoach.watch.data.WatchWorkoutApplyResult.isReplayableRevisionGap() =
    status == org.sharteman.gymcoach.watch.domain.WatchSyncAckStatus.REJECTED &&
        errorCode == "SYNC_REQUIRED"
