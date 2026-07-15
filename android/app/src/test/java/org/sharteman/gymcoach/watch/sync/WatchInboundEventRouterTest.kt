package org.sharteman.gymcoach.watch.sync

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Test
import org.sharteman.gymcoach.watch.data.WatchFileTransferCodec
import org.sharteman.gymcoach.watch.data.WatchWorkoutApplyResult
import org.sharteman.gymcoach.watch.data.WatchWorkoutGateway
import org.sharteman.gymcoach.watch.data.WatchWorkoutProtocolCodec
import org.sharteman.gymcoach.watch.domain.SensorBatchRecordedPayloadDto
import org.sharteman.gymcoach.watch.domain.WatchDeliveryMode
import org.sharteman.gymcoach.watch.domain.WatchEventEnvelopeDto
import org.sharteman.gymcoach.watch.domain.WatchEventSource
import org.sharteman.gymcoach.watch.domain.WatchEventType
import org.sharteman.gymcoach.watch.domain.WatchFilePayloadType
import org.sharteman.gymcoach.watch.domain.WatchProtocol
import org.sharteman.gymcoach.watch.domain.WatchSensorBatchDto
import org.sharteman.gymcoach.watch.domain.WatchSensorSampleDto
import org.sharteman.gymcoach.watch.domain.WatchSyncAckDto
import org.sharteman.gymcoach.watch.domain.WatchSyncAckStatus
import org.sharteman.gymcoach.watch.domain.WatchSyncSnapshotDto
import org.sharteman.gymcoach.watch.domain.WatchWorkoutPhase
import org.sharteman.gymcoach.watch.transport.WatchTransportFile

class WatchInboundEventRouterTest {
    private val json = Json { explicitNulls = true; encodeDefaults = true }
    private val fileCodec = WatchFileTransferCodec(json)
    private val workoutCodec = WatchWorkoutProtocolCodec(json)

    @Test
    fun `event before final file survives router restart and applies every sequence in order`() = runTest {
        val persistence = InMemoryWatchSyncPersistence()
        val gateway = RecordingGateway()
        val sink = RecordingSink()
        val ackIds = ACK_IDS.iterator()
        val workoutCoordinator = WatchWorkoutCoordinator(
            gateway = gateway,
            sink = sink,
            phoneDeviceId = PHONE_DEVICE,
            codec = workoutCodec,
            newUuid = { ackIds.next() },
            syncPersistence = persistence,
        )
        val firstRouter = router(persistence, workoutCoordinator)
        val partOne = envelope(sequence = 1, relatedEventId = EVENT_ONE)
        val partTwo = envelope(sequence = 2, relatedEventId = EVENT_TWO)
        val eventOne = event(partOne, EVENT_ONE)
        val eventTwo = event(partTwo, EVENT_TWO)

        firstRouter.onEvent(eventOne)
        firstRouter.onEvent(eventTwo)
        firstRouter.onFile(WatchTransportFile(TRANSFER_ID, fileCodec.encode(partTwo)))
        assertEquals(emptyList<Int>(), gateway.appliedSequences)

        val restartedRouter = router(persistence, workoutCoordinator)
        restartedRouter.onFile(WatchTransportFile(TRANSFER_ID, fileCodec.encode(partOne)))

        assertEquals(listOf(1, 2), gateway.appliedSequences)
        assertEquals(
            listOf(WatchSyncAckStatus.APPLIED, WatchSyncAckStatus.APPLIED),
            sink.acks.map { it.status },
        )

        restartedRouter.onEvent(eventOne)
        assertEquals(WatchSyncAckStatus.DUPLICATE, sink.acks.last().status)
        assertEquals(listOf(1, 2), gateway.appliedSequences)
    }

    private fun router(
        persistence: WatchSyncPersistence,
        workoutCoordinator: WatchWorkoutCoordinator,
    ) = WatchInboundEventRouter(
        persistence = persistence,
        workoutCoordinator = workoutCoordinator,
        fileCoordinator = WatchFileTransferCoordinator(persistence, fileCodec, workoutCodec),
    )

    private fun envelope(sequence: Int, relatedEventId: String) = fileCodec.createEnvelope(
        transferId = TRANSFER_ID,
        sessionId = SESSION_ID,
        relatedEventId = relatedEventId,
        payloadType = WatchFilePayloadType.SENSOR_BATCH,
        payloadId = BATCH_ID,
        sequence = sequence,
        totalSequences = 2,
        createdAt = 1_000L + sequence,
        source = WatchEventSource.WATCH,
        deviceId = WATCH_DEVICE,
        payload = json.encodeToJsonElement(batch(sequence)).jsonObject,
    )

    private fun event(
        envelope: org.sharteman.gymcoach.watch.domain.WatchFileTransferEnvelopeDto,
        eventId: String,
    ) = WatchEventEnvelopeDto(
        protocolVersion = WatchProtocol.VERSION,
        schemaVersion = WatchProtocol.SCHEMA_VERSION,
        eventId = eventId,
        sessionId = SESSION_ID,
        type = WatchEventType.SENSOR_BATCH_RECORDED,
        timestamp = 2_000L + envelope.sequence,
        source = WatchEventSource.WATCH,
        deviceId = WATCH_DEVICE,
        revision = envelope.sequence.toLong(),
        payload = workoutCodec.encodeSensorBatchRecordedPayload(
            SensorBatchRecordedPayloadDto(
                batchId = BATCH_ID,
                sequence = envelope.sequence,
                totalSequences = envelope.totalSequences,
                deliveryMode = WatchDeliveryMode.FILE,
                sampleCount = 1,
            ),
        ),
    )

    private fun batch(sequence: Int) = WatchSensorBatchDto(
        protocolVersion = WatchProtocol.VERSION,
        schemaVersion = WatchProtocol.SCHEMA_VERSION,
        batchId = BATCH_ID,
        sessionId = SESSION_ID,
        source = WatchEventSource.WATCH,
        deviceId = WATCH_DEVICE,
        createdAt = 1_000,
        sequence = sequence,
        totalSequences = 2,
        sampleCount = 1,
        samples = listOf(
            WatchSensorSampleDto(
                sampleId = SAMPLE_IDS[sequence - 1],
                sessionId = SESSION_ID,
                exerciseSessionId = EXERCISE_SESSION_ID,
                setId = SET_ID,
                phase = WatchWorkoutPhase.SET,
                sensorType = "HEART_RATE",
                value = JsonPrimitive(140 + sequence),
                unit = "BPM",
                timestamp = 3_000L + sequence,
                source = WatchEventSource.WATCH,
                valid = true,
                quality = "VALID",
            ),
        ),
    )

    private class RecordingGateway : WatchWorkoutGateway {
        val appliedSequences = mutableListOf<Int>()

        override suspend fun buildSnapshot(sessionId: String): WatchSyncSnapshotDto? = null

        override suspend fun applyWatchEvent(event: WatchEventEnvelopeDto): WatchWorkoutApplyResult =
            error("Sensor manifests must be routed through applySensorBatch")

        override suspend fun applySensorBatch(
            event: WatchEventEnvelopeDto,
            batch: WatchSensorBatchDto,
        ): WatchWorkoutApplyResult {
            appliedSequences += batch.sequence
            return WatchWorkoutApplyResult(WatchSyncAckStatus.APPLIED, event.revision)
        }

        override suspend fun changeActiveExerciseFromPhone(
            sessionId: String,
            exerciseId: String,
        ) = null
    }

    private class RecordingSink : WatchWorkoutResponseSink {
        val acks = mutableListOf<WatchSyncAckDto>()
        override suspend fun sendSnapshot(snapshot: WatchSyncSnapshotDto) = Unit
        override suspend fun sendAck(ack: WatchSyncAckDto) { acks += ack }
        override suspend fun sendEvent(event: WatchEventEnvelopeDto) = Unit
    }

    private companion object {
        const val SESSION_ID = "mob_session_inbound_router"
        const val PHONE_DEVICE = "phone-inbound-router"
        const val WATCH_DEVICE = "watch-inbound-router"
        const val EXERCISE_SESSION_ID = "exercise_session_inbound_router"
        const val SET_ID = "set_inbound_router"
        const val TRANSFER_ID = "10000000-0000-0000-0000-000000000001"
        const val BATCH_ID = "20000000-0000-0000-0000-000000000001"
        const val EVENT_ONE = "30000000-0000-0000-0000-000000000001"
        const val EVENT_TWO = "30000000-0000-0000-0000-000000000002"
        val ACK_IDS = listOf(
            "40000000-0000-0000-0000-000000000001",
            "40000000-0000-0000-0000-000000000002",
            "40000000-0000-0000-0000-000000000003",
        )
        val SAMPLE_IDS = listOf(
            "50000000-0000-0000-0000-000000000001",
            "50000000-0000-0000-0000-000000000002",
        )
    }
}
