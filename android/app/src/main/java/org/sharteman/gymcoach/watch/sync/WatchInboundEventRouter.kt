package org.sharteman.gymcoach.watch.sync

import org.sharteman.gymcoach.watch.data.WatchProtocolCodec
import org.sharteman.gymcoach.watch.domain.WatchEventEnvelopeDto
import org.sharteman.gymcoach.watch.domain.WatchEventType
import org.sharteman.gymcoach.watch.domain.WatchProtocolErrorCode
import org.sharteman.gymcoach.watch.domain.WatchProtocolException
import org.sharteman.gymcoach.watch.transport.WatchTransportFile

/**
 * Routes ordinary watch events directly to the workout coordinator and keeps
 * file-backed sensor manifests replayable until every referenced file part is
 * durably available. The inbox is the restart boundary: an event that arrived
 * before its file can be resumed when a later file part arrives or when the
 * watch redelivers the event after reconnect.
 */
class WatchInboundEventRouter(
    private val persistence: WatchSyncPersistence,
    private val workoutCoordinator: WatchWorkoutCoordinator,
    private val fileCoordinator: WatchFileTransferCoordinator,
    private val codec: WatchProtocolCodec = WatchProtocolCodec(),
) : WatchEventConsumer, WatchFileConsumer {
    override suspend fun onEvent(event: WatchEventEnvelopeDto) {
        if (event.type != WatchEventType.SENSOR_BATCH_RECORDED) {
            workoutCoordinator.onEvent(event)
            return
        }
        applySensorEventWhenReady(event, recordWhileWaiting = true)
    }

    override suspend fun onFile(file: WatchTransportFile) {
        val received = fileCoordinator.receive(file.bytes)
        val transferId = received.transferId?.takeIf { received.accepted } ?: return
        val eventIds = persistence.filesForTransfer(transferId)
            .sortedBy { it.sequence }
            .mapNotNull { it.relatedEventId }
            .distinct()
        for (eventId in eventIds) {
            val stored = persistence.incoming(eventId)
                ?.takeUnless { it.status == "PROCESSED" }
                ?: continue
            val event = codec.decodeEvent(stored.envelopeJson.encodeToByteArray())
            applySensorEventWhenReady(event, recordWhileWaiting = false)
        }
    }

    private suspend fun applySensorEventWhenReady(
        event: WatchEventEnvelopeDto,
        recordWhileWaiting: Boolean,
    ) {
        try {
            fileCoordinator.applySensorBatchFile(event, workoutCoordinator)
        } catch (error: WatchProtocolException) {
            if (error.code !in REPLAYABLE_FILE_ERRORS) throw error
            if (!recordWhileWaiting) return
            when (persistence.recordIncoming(event).registration) {
                WatchInboxRegistration.NEW -> Unit
                WatchInboxRegistration.DUPLICATE,
                WatchInboxRegistration.EVENT_ID_REUSE,
                -> workoutCoordinator.onEvent(event)
            }
        }
    }

    private companion object {
        val REPLAYABLE_FILE_ERRORS = setOf(
            WatchProtocolErrorCode.FILE_SEQUENCE_GAP,
            WatchProtocolErrorCode.FILE_PAIR_MISMATCH,
        )
    }
}
