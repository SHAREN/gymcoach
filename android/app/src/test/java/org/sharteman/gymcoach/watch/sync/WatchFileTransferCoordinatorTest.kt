package org.sharteman.gymcoach.watch.sync

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.sharteman.gymcoach.watch.data.WatchFileTransferCodec
import org.sharteman.gymcoach.watch.data.WatchWorkoutProtocolCodec
import org.sharteman.gymcoach.watch.domain.SensorBatchRecordedPayloadDto
import org.sharteman.gymcoach.watch.domain.WatchDeliveryMode
import org.sharteman.gymcoach.watch.domain.WatchEventEnvelopeDto
import org.sharteman.gymcoach.watch.domain.WatchEventSource
import org.sharteman.gymcoach.watch.domain.WatchEventType
import org.sharteman.gymcoach.watch.domain.WatchFilePayloadType
import org.sharteman.gymcoach.watch.domain.WatchProtocol
import org.sharteman.gymcoach.watch.domain.WatchProtocolErrorCode
import org.sharteman.gymcoach.watch.domain.WatchProtocolException
import org.sharteman.gymcoach.watch.domain.WatchSensorBatchDto
import org.sharteman.gymcoach.watch.domain.WatchSensorSampleDto
import org.sharteman.gymcoach.watch.domain.WatchWorkoutPhase

class WatchFileTransferCoordinatorTest {
    private val json = Json { explicitNulls = true; encodeDefaults = true }
    private val fileCodec = WatchFileTransferCodec(json)
    private val workoutCodec = WatchWorkoutProtocolCodec(json)

    @Test
    fun `rejects corrupt payload length and hash`() = runTest {
        val envelope = envelope(sequence = 1, totalSequences = 1, relatedEventId = EVENT_TWO)
        val badLength = json.encodeToString(envelope.copy(byteLength = envelope.byteLength + 1)).encodeToByteArray()
        val badHash = json.encodeToString(envelope.copy(sha256 = "0".repeat(64))).encodeToByteArray()

        assertEquals(
            WatchProtocolErrorCode.FILE_LENGTH_MISMATCH,
            assertProtocolError { fileCodec.decode(badLength) },
        )
        assertEquals(
            WatchProtocolErrorCode.FILE_HASH_MISMATCH,
            assertProtocolError { fileCodec.decode(badHash) },
        )
    }

    @Test
    fun `out of order file waits for every sequence then pairs exact event`() = runTest {
        val store = InMemoryWatchSyncPersistence()
        val coordinator = WatchFileTransferCoordinator(store, fileCodec, workoutCodec)
        val partTwo = envelope(sequence = 2, totalSequences = 2, relatedEventId = EVENT_TWO)
        val partOne = envelope(sequence = 1, totalSequences = 2, relatedEventId = EVENT_ONE)

        assertTrue(coordinator.receive(fileCodec.encode(partTwo)).accepted)
        assertEquals(
            WatchProtocolErrorCode.FILE_SEQUENCE_GAP,
            assertProtocolError { coordinator.sensorBatchForEvent(eventFor(partTwo, EVENT_TWO)) },
        )

        assertTrue(coordinator.receive(fileCodec.encode(partOne)).accepted)
        val decoded = coordinator.sensorBatchForEvent(eventFor(partTwo, EVENT_TWO))
        assertEquals(2, decoded.sequence)
        assertEquals(BATCH_ID, decoded.batchId)
    }

    @Test
    fun `missing or mismatched file is rejected deterministically`() = runTest {
        val store = InMemoryWatchSyncPersistence()
        val coordinator = WatchFileTransferCoordinator(store, fileCodec, workoutCodec)
        val envelope = envelope(sequence = 1, totalSequences = 1, relatedEventId = EVENT_ONE)
        val event = eventFor(envelope, EVENT_TWO)

        assertTrue(coordinator.receive(fileCodec.encode(envelope)).accepted)
        assertEquals(
            WatchProtocolErrorCode.FILE_SEQUENCE_GAP,
            assertProtocolError { coordinator.sensorBatchForEvent(event) },
        )
        val corrupt = coordinator.receive(json.encodeToString(envelope.copy(sha256 = "f".repeat(64))).encodeToByteArray())
        assertFalse(corrupt.accepted)
        assertEquals(WatchProtocolErrorCode.FILE_HASH_MISMATCH.name, corrupt.errorCode)
    }

    @Test
    fun `same transfer sequence cannot be overwritten with different metadata or payload`() = runTest {
        val store = InMemoryWatchSyncPersistence()
        val coordinator = WatchFileTransferCoordinator(store, fileCodec, workoutCodec)
        val original = envelope(sequence = 1, totalSequences = 1, relatedEventId = EVENT_ONE)
        val reused = fileCodec.createEnvelope(
            transferId = original.transferId,
            sessionId = original.sessionId,
            relatedEventId = EVENT_TWO,
            payloadType = original.payloadType,
            payloadId = original.payloadId,
            sequence = original.sequence,
            totalSequences = original.totalSequences,
            createdAt = original.createdAt + 1,
            source = original.source,
            deviceId = original.deviceId,
            payload = json.encodeToJsonElement(batch(1, 1).copy(createdAt = 9_999)).jsonObject,
        )

        assertTrue(coordinator.receive(fileCodec.encode(original)).accepted)
        assertTrue(coordinator.receive(fileCodec.encode(original)).accepted)
        val conflict = coordinator.receive(fileCodec.encode(reused))

        assertFalse(conflict.accepted)
        assertEquals(WatchProtocolErrorCode.FILE_PAIR_MISMATCH.name, conflict.errorCode)
        assertEquals(original.sha256, store.filesForTransfer(TRANSFER_ID).single().sha256)
    }

    private fun envelope(sequence: Int, totalSequences: Int, relatedEventId: String) =
        fileCodec.createEnvelope(
            transferId = TRANSFER_ID,
            sessionId = SESSION_ID,
            relatedEventId = relatedEventId,
            payloadType = WatchFilePayloadType.SENSOR_BATCH,
            payloadId = BATCH_ID,
            sequence = sequence,
            totalSequences = totalSequences,
            createdAt = 1_000 + sequence.toLong(),
            source = WatchEventSource.WATCH,
            deviceId = WATCH_DEVICE,
            payload = json.encodeToJsonElement(batch(sequence, totalSequences)).jsonObject,
        )

    private fun batch(sequence: Int, totalSequences: Int) = WatchSensorBatchDto(
        protocolVersion = WatchProtocol.VERSION,
        schemaVersion = WatchProtocol.SCHEMA_VERSION,
        batchId = BATCH_ID,
        sessionId = SESSION_ID,
        source = WatchEventSource.WATCH,
        deviceId = WATCH_DEVICE,
        createdAt = 1_000,
        sequence = sequence,
        totalSequences = totalSequences,
        sampleCount = 1,
        samples = listOf(
            WatchSensorSampleDto(
                sampleId = if (sequence == 1) SAMPLE_ONE else SAMPLE_TWO,
                sessionId = SESSION_ID,
                exerciseSessionId = "exercise_session_stage5",
                setId = "set_stage5",
                phase = WatchWorkoutPhase.SET,
                sensorType = "HEART_RATE",
                value = JsonPrimitive(140 + sequence),
                unit = "BPM",
                timestamp = 2_000 + sequence.toLong(),
                source = WatchEventSource.WATCH,
                valid = true,
                quality = "VALID",
            ),
        ),
    )

    private fun eventFor(
        envelope: org.sharteman.gymcoach.watch.domain.WatchFileTransferEnvelopeDto,
        eventId: String,
    ) = WatchEventEnvelopeDto(
        protocolVersion = WatchProtocol.VERSION,
        schemaVersion = WatchProtocol.SCHEMA_VERSION,
        eventId = eventId,
        sessionId = SESSION_ID,
        type = WatchEventType.SENSOR_BATCH_RECORDED,
        timestamp = 3_000,
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

    private suspend fun assertProtocolError(block: suspend () -> Unit): WatchProtocolErrorCode = try {
        block()
        error("Expected WatchProtocolException")
    } catch (error: WatchProtocolException) {
        error.code
    }

    private companion object {
        const val SESSION_ID = "mob_session_stage5_file"
        const val WATCH_DEVICE = "watch-stage5-file"
        const val TRANSFER_ID = "40000000-0000-0000-0000-000000000001"
        const val BATCH_ID = "50000000-0000-0000-0000-000000000001"
        const val EVENT_ONE = "60000000-0000-0000-0000-000000000001"
        const val EVENT_TWO = "60000000-0000-0000-0000-000000000002"
        const val SAMPLE_ONE = "70000000-0000-0000-0000-000000000001"
        const val SAMPLE_TWO = "70000000-0000-0000-0000-000000000002"
    }
}
