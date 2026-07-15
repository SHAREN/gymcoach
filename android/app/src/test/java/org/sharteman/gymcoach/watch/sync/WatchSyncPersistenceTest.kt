package org.sharteman.gymcoach.watch.sync

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.sharteman.gymcoach.watch.domain.WatchEventEnvelopeDto
import org.sharteman.gymcoach.watch.domain.WatchEventSource
import org.sharteman.gymcoach.watch.domain.WatchEventType
import org.sharteman.gymcoach.watch.domain.WatchProtocol
import org.sharteman.gymcoach.watch.domain.WatchSyncAckDto
import org.sharteman.gymcoach.watch.domain.WatchSyncAckStatus
import org.sharteman.gymcoach.watch.domain.WatchSyncSnapshotDto

class WatchSyncPersistenceTest {
    @Test
    fun `received but unprocessed inbox event is retried after process restart`() = runTest {
        val store = InMemoryWatchSyncPersistence()
        val event = event(EVENT_ONE, revision = 1, timestamp = 100)

        assertEquals(WatchInboxRegistration.NEW, store.recordIncoming(event).registration)
        assertEquals(WatchInboxRegistration.NEW, store.recordIncoming(event).registration)
        store.finishIncoming(EVENT_ONE, WatchSyncAckStatus.APPLIED, 1, null)
        assertEquals(WatchInboxRegistration.DUPLICATE, store.recordIncoming(event).registration)
    }

    @Test
    fun `lost ack survives coordinator restart and applied ack stops replay`() = runTest {
        var now = 1_000L
        val store = InMemoryWatchSyncPersistence(nowEpochMs = { now++ })
        val event = event(EVENT_ONE, revision = 1, timestamp = 100)
        store.enqueue(event)
        val firstSink = RecordingReplaySink()
        WatchReconnectReplayCoordinator(store, firstSink, snapshotProvider = { null })
            .reconnect(SESSION, WATCH_DEVICE, localRevision = 1)
        assertEquals(listOf(EVENT_ONE), firstSink.events.map { it.eventId })

        val restartedSink = RecordingReplaySink()
        WatchReconnectReplayCoordinator(store, restartedSink, snapshotProvider = { null })
            .reconnect(SESSION, WATCH_DEVICE, localRevision = 1)
        assertEquals(listOf(EVENT_ONE), restartedSink.events.map { it.eventId })

        assertTrue(store.applyAck(ack(ACK_ONE, WatchSyncAckStatus.APPLIED, listOf(EVENT_ONE), 1)))
        assertTrue(store.replayable(SESSION).isEmpty())
    }

    @Test
    fun `duplicate ack is idempotent`() = runTest {
        val store = InMemoryWatchSyncPersistence()
        store.enqueue(event(EVENT_ONE, revision = 1, timestamp = 100))
        val ack = ack(ACK_ONE, WatchSyncAckStatus.DUPLICATE, listOf(EVENT_ONE), 1)

        assertTrue(store.applyAck(ack))
        assertFalse(store.applyAck(ack))
        assertTrue(store.replayable().isEmpty())
    }

    @Test
    fun `offline replay is ordered by revision timestamp and event id`() = runTest {
        val store = InMemoryWatchSyncPersistence()
        store.enqueue(event(EVENT_THREE, revision = 2, timestamp = 300))
        store.enqueue(event(EVENT_TWO, revision = 2, timestamp = 200))
        store.enqueue(event(EVENT_ONE, revision = 1, timestamp = 900))
        val sink = RecordingReplaySink()

        WatchReconnectReplayCoordinator(store, sink, snapshotProvider = { null })
            .reconnect(SESSION, WATCH_DEVICE, localRevision = 2)

        assertEquals(listOf(EVENT_ONE, EVENT_TWO, EVENT_THREE), sink.events.map { it.eventId })
    }

    @Test
    fun `conflict ack retains event and creates conflict journal entry`() = runTest {
        val store = InMemoryWatchSyncPersistence(newUuid = { CONFLICT_ID })
        store.enqueue(event(EVENT_ONE, revision = 4, timestamp = 100))

        store.applyAck(ack(ACK_ONE, WatchSyncAckStatus.CONFLICT, listOf(EVENT_ONE), 5, "REVISION_CONFLICT"))

        assertTrue(store.replayable().isEmpty())
        val conflict = store.conflicts(SESSION).single()
        assertEquals(EVENT_ONE, conflict.eventId)
        assertEquals(4, conflict.localRevision)
        assertEquals(5, conflict.remoteRevision)
        assertEquals("REVISION_CONFLICT", conflict.errorCode)
        assertEquals("UNRESOLVED", conflict.status)
    }

    private fun event(eventId: String, revision: Long, timestamp: Long) = WatchEventEnvelopeDto(
        protocolVersion = WatchProtocol.VERSION,
        schemaVersion = WatchProtocol.SCHEMA_VERSION,
        eventId = eventId,
        sessionId = SESSION,
        type = WatchEventType.ACTIVE_EXERCISE_CHANGED,
        timestamp = timestamp,
        source = WatchEventSource.PHONE,
        deviceId = PHONE_DEVICE,
        revision = revision,
        payload = buildJsonObject { put("order", revision) },
    )

    private fun ack(
        ackId: String,
        status: WatchSyncAckStatus,
        eventIds: List<String>,
        revision: Long,
        errorCode: String? = null,
    ) = WatchSyncAckDto(
        protocolVersion = WatchProtocol.VERSION,
        schemaVersion = WatchProtocol.SCHEMA_VERSION,
        ackId = ackId,
        sessionId = SESSION,
        eventIds = eventIds,
        status = status,
        timestamp = 2_000,
        source = WatchEventSource.WATCH,
        deviceId = WATCH_DEVICE,
        revision = revision,
        errorCode = errorCode,
    )

    private class RecordingReplaySink : WatchReplaySink {
        val events = mutableListOf<WatchEventEnvelopeDto>()
        override suspend fun sendEvent(event: WatchEventEnvelopeDto) { events += event }
        override suspend fun sendSnapshot(snapshot: WatchSyncSnapshotDto) = Unit
        override suspend fun requestSnapshot(sessionId: String, knownRevision: Long) = Unit
    }

    private companion object {
        const val SESSION = "mob_session_stage5"
        const val PHONE_DEVICE = "phone-stage5"
        const val WATCH_DEVICE = "watch-stage5"
        const val EVENT_ONE = "10000000-0000-0000-0000-000000000001"
        const val EVENT_TWO = "10000000-0000-0000-0000-000000000002"
        const val EVENT_THREE = "10000000-0000-0000-0000-000000000003"
        const val ACK_ONE = "20000000-0000-0000-0000-000000000001"
        const val CONFLICT_ID = "30000000-0000-0000-0000-000000000001"
    }
}
