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
import org.sharteman.gymcoach.data.local.WatchResyncMarkerEntity
import org.sharteman.gymcoach.watch.domain.WatchExerciseSessionDto
import org.sharteman.gymcoach.watch.domain.WatchExerciseStatus
import org.sharteman.gymcoach.watch.domain.WatchWorkoutSessionDto
import org.sharteman.gymcoach.watch.domain.WatchWorkoutStatus

class WatchSyncPersistenceTest {
    @Test
    fun `snapshot send keeps crash marker until terminal ack reaches marker revision`() = runTest {
        val store = InMemoryWatchSyncPersistence()
        store.saveResyncMarkerForTest(
            WatchResyncMarkerEntity(SESSION, 2, "SET_UPDATED", 100, 100),
        )
        val sink = RecordingReplaySink(failSnapshots = 1)
        val coordinator = WatchReconnectReplayCoordinator(store, sink, snapshotProvider = { snapshot() })

        assertTrue(runCatching { coordinator.repairMarkers() }.isFailure)
        assertEquals(1, store.resyncMarkers().size)

        coordinator.repairMarkers()

        assertEquals(1, sink.snapshots.size)
        assertEquals(1, store.resyncMarkers().size)

        store.applyAck(ack(ACK_ONE, WatchSyncAckStatus.APPLIED, listOf(EVENT_ONE), revision = 1))
        assertEquals(1, store.resyncMarkers().size)

        store.applyAck(ack(ACK_TWO, WatchSyncAckStatus.DUPLICATE, listOf(EVENT_TWO), revision = 2))
        assertTrue(store.resyncMarkers().isEmpty())
    }

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

    @Test
    fun `ack for another session cannot remove queued event`() = runTest {
        val store = InMemoryWatchSyncPersistence(newUuid = { CONFLICT_ID })
        store.enqueue(event(EVENT_ONE, revision = 2, timestamp = 100))

        assertTrue(
            store.applyAck(
                ack(
                    ACK_ONE,
                    WatchSyncAckStatus.APPLIED,
                    listOf(EVENT_ONE),
                    revision = 2,
                    sessionId = SESSION_TWO,
                ),
            ),
        )

        assertEquals(listOf(EVENT_ONE), store.replayable(SESSION).map { it.eventId })
        assertEquals("ACK_SESSION_MISMATCH", store.conflicts(SESSION).single().errorCode)
        assertEquals(null, store.peer(WATCH_DEVICE))
    }

    @Test
    fun `ack revision regression keeps event and peer watermark is monotonic`() = runTest {
        val store = InMemoryWatchSyncPersistence(newUuid = { CONFLICT_ID })
        store.enqueue(event(EVENT_ONE, revision = 5, timestamp = 100))
        store.applyAck(ack(ACK_ONE, WatchSyncAckStatus.APPLIED, listOf(EVENT_ONE), revision = 5))
        assertEquals(5L, store.peer(WATCH_DEVICE)?.lastRevision)

        store.enqueue(event(EVENT_TWO, revision = 6, timestamp = 200))
        store.applyAck(ack(ACK_TWO, WatchSyncAckStatus.APPLIED, listOf(EVENT_TWO), revision = 4))

        assertEquals(listOf(EVENT_TWO), store.replayable(SESSION).map { it.eventId })
        assertEquals(5L, store.peer(WATCH_DEVICE)?.lastRevision)
        assertEquals("ACK_REVISION_REGRESSION", store.conflicts(SESSION).single().errorCode)
    }

    @Test
    fun `sync required ack keeps higher revision event replayable`() = runTest {
        val store = InMemoryWatchSyncPersistence()
        store.enqueue(event(EVENT_ONE, revision = 3, timestamp = 100))

        store.applyAck(
            ack(
                ACK_ONE,
                WatchSyncAckStatus.REJECTED,
                listOf(EVENT_ONE),
                revision = 1,
                errorCode = "SYNC_REQUIRED",
            ),
        )

        assertEquals(listOf(EVENT_ONE), store.replayable(SESSION).map { it.eventId })
        assertTrue(store.conflicts(SESSION).isEmpty())
        assertEquals(1L, store.peer(WATCH_DEVICE)?.lastRevision)
    }

    @Test
    fun `late ack from previous session cannot replace current peer session`() = runTest {
        val store = InMemoryWatchSyncPersistence()
        store.enqueue(event(EVENT_ONE, revision = 5, timestamp = 100))
        store.applyAck(ack(ACK_ONE, WatchSyncAckStatus.APPLIED, listOf(EVENT_ONE), revision = 5))

        store.enqueue(event(EVENT_TWO, revision = 2, timestamp = 200, sessionId = SESSION_TWO))
        store.applyAck(
            ack(
                ACK_TWO,
                WatchSyncAckStatus.APPLIED,
                listOf(EVENT_TWO),
                revision = 2,
                sessionId = SESSION_TWO,
            ),
        )

        assertEquals(SESSION, store.peer(WATCH_DEVICE)?.sessionId)
        assertEquals(5L, store.peer(WATCH_DEVICE)?.lastRevision)
    }

    private fun event(
        eventId: String,
        revision: Long,
        timestamp: Long,
        sessionId: String = SESSION,
    ) = WatchEventEnvelopeDto(
        protocolVersion = WatchProtocol.VERSION,
        schemaVersion = WatchProtocol.SCHEMA_VERSION,
        eventId = eventId,
        sessionId = sessionId,
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
        sessionId: String = SESSION,
    ) = WatchSyncAckDto(
        protocolVersion = WatchProtocol.VERSION,
        schemaVersion = WatchProtocol.SCHEMA_VERSION,
        ackId = ackId,
        sessionId = sessionId,
        eventIds = eventIds,
        status = status,
        timestamp = 2_000,
        source = WatchEventSource.WATCH,
        deviceId = WATCH_DEVICE,
        revision = revision,
        errorCode = errorCode,
    )

    private fun snapshot() = WatchSyncSnapshotDto(
        protocolVersion = WatchProtocol.VERSION,
        schemaVersion = WatchProtocol.SCHEMA_VERSION,
        snapshotId = "90000000-0000-0000-0000-000000000001",
        sessionId = SESSION,
        timestamp = 100,
        source = WatchEventSource.PHONE,
        deviceId = PHONE_DEVICE,
        revision = 2,
        workoutSession = WatchWorkoutSessionDto(
            sessionId = SESSION,
            workoutProgramId = "workout_stage5",
            userId = "user_stage5",
            status = WatchWorkoutStatus.ACTIVE,
            startedAt = 1,
            finishedAt = null,
            activeExerciseId = "exercise_stage5",
            activeSetId = null,
            revision = 2,
            updatedAt = 100,
            updatedBy = WatchEventSource.PHONE,
        ),
        exerciseSessions = listOf(
            WatchExerciseSessionDto(
                exerciseSessionId = "exercise_session_stage5",
                sessionId = SESSION,
                exerciseId = "exercise_stage5",
                exerciseName = "Squat",
                order = 1,
                status = WatchExerciseStatus.ACTIVE,
                targetSets = 3,
                targetReps = 8,
                targetRir = 2,
                restDurationSeconds = 120,
            ),
        ),
        setRecords = emptyList(),
        sensorSamples = emptyList(),
        pendingEvents = emptyList(),
    )

    private class RecordingReplaySink(
        private var failSnapshots: Int = 0,
    ) : WatchReplaySink {
        val events = mutableListOf<WatchEventEnvelopeDto>()
        val snapshots = mutableListOf<WatchSyncSnapshotDto>()
        override suspend fun sendEvent(event: WatchEventEnvelopeDto) { events += event }
        override suspend fun sendSnapshot(snapshot: WatchSyncSnapshotDto) {
            if (failSnapshots > 0) {
                failSnapshots -= 1
                error("snapshot transport failed")
            }
            snapshots += snapshot
        }
        override suspend fun requestSnapshot(sessionId: String, knownRevision: Long) = Unit
    }

    private companion object {
        const val SESSION = "mob_session_stage5"
        const val SESSION_TWO = "mob_session_stage5_other"
        const val PHONE_DEVICE = "phone-stage5"
        const val WATCH_DEVICE = "watch-stage5"
        const val EVENT_ONE = "10000000-0000-0000-0000-000000000001"
        const val EVENT_TWO = "10000000-0000-0000-0000-000000000002"
        const val EVENT_THREE = "10000000-0000-0000-0000-000000000003"
        const val ACK_ONE = "20000000-0000-0000-0000-000000000001"
        const val ACK_TWO = "20000000-0000-0000-0000-000000000002"
        const val CONFLICT_ID = "30000000-0000-0000-0000-000000000001"
    }
}
