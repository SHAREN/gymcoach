package org.sharteman.gymcoach.watch.sync

import java.util.UUID
import org.sharteman.gymcoach.watch.data.WatchWorkoutGateway
import org.sharteman.gymcoach.watch.data.WatchWorkoutProtocolCodec
import org.sharteman.gymcoach.watch.domain.WatchEventEnvelopeDto
import org.sharteman.gymcoach.watch.domain.WatchEventSource
import org.sharteman.gymcoach.watch.domain.WatchEventType
import org.sharteman.gymcoach.watch.domain.WatchProtocol
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
    private val nowEpochMs: () -> Long = System::currentTimeMillis,
    private val newUuid: () -> String = { UUID.randomUUID().toString() },
) : WatchEventConsumer {
    override suspend fun onEvent(event: WatchEventEnvelopeDto) {
        if (event.type == WatchEventType.SYNC_REQUESTED) {
            gateway.buildSnapshot(event.sessionId)?.let { sink.sendSnapshot(it) }
            return
        }
        val result = gateway.applyWatchEvent(event)
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
        sink.sendEvent(
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
}
