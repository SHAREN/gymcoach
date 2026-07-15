package org.sharteman.gymcoach.data.local

import androidx.room.Room
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.buildJsonObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.sharteman.gymcoach.watch.domain.WatchEventEnvelopeDto
import org.sharteman.gymcoach.watch.domain.WatchEventSource
import org.sharteman.gymcoach.watch.domain.WatchEventType
import org.sharteman.gymcoach.watch.domain.WatchProtocol
import org.sharteman.gymcoach.watch.domain.WatchSyncAckDto
import org.sharteman.gymcoach.watch.domain.WatchSyncAckStatus
import org.sharteman.gymcoach.watch.sync.RoomWatchSyncPersistence

@RunWith(AndroidJUnit4::class)
class GymCoachDaoWatchSyncTest {
    private lateinit var database: GymCoachDatabase
    private lateinit var dao: GymCoachDao

    @Before
    fun createDatabase() {
        database = Room.inMemoryDatabaseBuilder(
            InstrumentationRegistry.getInstrumentation().targetContext,
            GymCoachDatabase::class.java,
        ).allowMainThreadQueries().build()
        dao = database.dao()
    }

    @After
    fun closeDatabase() {
        database.close()
    }

    @Test
    fun clearAccountDataRemovesEveryWatchSyncRecord() = runBlocking {
        dao.insertWatchInboxEvent(
            WatchInboxEventEntity(
                eventId = EVENT_ID,
                sessionId = SESSION_ID,
                revision = 1,
                timestampEpochMs = 1,
                canonicalEventHash = HASH,
                envelopeJson = "{}",
                receivedAtEpochMs = 1,
            ),
        )
        dao.insertWatchOutboxEvent(
            WatchOutboxEventEntity(
                eventId = OUTBOX_EVENT_ID,
                sessionId = SESSION_ID,
                revision = 1,
                timestampEpochMs = 1,
                eventType = "WORKOUT_STARTED",
                canonicalEventHash = HASH,
                envelopeJson = "{}",
                createdAtEpochMs = 1,
            ),
        )
        dao.insertWatchAckJournal(
            WatchAckJournalEntity(
                ackId = ACK_ID,
                sessionId = SESSION_ID,
                eventIdsJson = "[]",
                status = "APPLIED",
                revision = 1,
                errorCode = null,
                source = "WATCH",
                deviceId = DEVICE_ID,
                receivedAtEpochMs = 1,
            ),
        )
        dao.saveWatchPeer(
            WatchPeerEntity(
                deviceId = DEVICE_ID,
                sessionId = SESSION_ID,
                protocolVersion = "1.0",
                schemaVersion = 1,
                lastRevision = 1,
                updatedAtEpochMs = 1,
            ),
        )
        dao.saveWatchConflict(
            WatchConflictEntity(
                conflictId = CONFLICT_ID,
                sessionId = SESSION_ID,
                eventId = EVENT_ID,
                entityType = "WORKOUT_STARTED",
                entityId = EVENT_ID,
                localRevision = 1,
                remoteRevision = 2,
                localEventJson = "{}",
                remoteEventJson = "{}",
                status = "UNRESOLVED",
                errorCode = "TEST_CONFLICT",
                detectedAtEpochMs = 1,
            ),
        )
        dao.saveWatchFileTransfer(
            WatchFileTransferEntity(
                transferId = TRANSFER_ID,
                sequence = 1,
                sessionId = SESSION_ID,
                relatedEventId = EVENT_ID,
                payloadType = "SENSOR_BATCH",
                payloadId = "batch_account_clear",
                totalSequences = 1,
                byteLength = 2,
                sha256 = HASH,
                source = "WATCH",
                deviceId = DEVICE_ID,
                direction = "INCOMING",
                status = "RECEIVED",
                canonicalPayloadJson = "{}",
                errorCode = null,
                createdAtEpochMs = 1,
                updatedAtEpochMs = 1,
            ),
        )

        dao.clearAccountData()

        WATCH_TABLES.forEach { table ->
            database.openHelper.writableDatabase.query("SELECT COUNT(*) FROM $table").use { cursor ->
                cursor.moveToFirst()
                assertEquals("Expected $table to be cleared", 0, cursor.getInt(0))
            }
        }
    }

    @Test
    fun roomAcknowledgementDeletesSuccessfulOutboxAndRejectsCrossSessionAck() = runBlocking {
        var now = 100L
        val persistence = RoomWatchSyncPersistence(
            dao = dao,
            nowEpochMs = { now++ },
            newUuid = { CONFLICT_ID },
        )
        val first = watchEvent(EVENT_ID, SESSION_ID, revision = 1)
        persistence.enqueue(first)
        persistence.applyAck(watchAck(ACK_ID, SESSION_ID, EVENT_ID, revision = 1))

        assertEquals(null, dao.getWatchOutboxEvent(EVENT_ID))
        assertEquals(1L, dao.getWatchPeer(DEVICE_ID)?.lastRevision)
        assertEquals(WatchSyncAckStatus.APPLIED.name, dao.getWatchAckJournal(ACK_ID)?.status)

        val second = watchEvent(OUTBOX_EVENT_ID, SESSION_ID, revision = 2)
        persistence.enqueue(second)
        persistence.applyAck(
            watchAck(
                ackId = SECOND_ACK_ID,
                sessionId = OTHER_SESSION_ID,
                eventId = OUTBOX_EVENT_ID,
                revision = 2,
            ),
        )

        assertEquals(OUTBOX_EVENT_ID, dao.getWatchOutboxEvent(OUTBOX_EVENT_ID)?.eventId)
        assertEquals("ACK_SESSION_MISMATCH", dao.getWatchConflicts(SESSION_ID).single().errorCode)
        assertEquals(1L, dao.getWatchPeer(DEVICE_ID)?.lastRevision)
    }

    @Test
    fun watchFinishAtomicallyClosesSessionQueuesServerFinishAndRemovesActiveRuntime() = runBlocking {
        val session = LocalSessionEntity(
            id = SESSION_ID,
            workoutId = "workout_watch_finish",
            gymId = null,
            startedAt = "2026-07-15T10:00:00Z",
        )
        dao.saveWatchResyncMarker(
            WatchResyncMarkerEntity(SESSION_ID, 1, "TEST", 1, 1),
        )
        dao.saveSession(session)
        dao.saveActiveWorkoutRuntime(
            ActiveWorkoutRuntimeEntity(
                sessionId = SESSION_ID,
                workoutId = session.workoutId,
                revision = 1,
                updatedAtEpochMs = 1_000,
            ),
        )
        val processed = WatchProcessedEventEntity(
            eventId = EVENT_ID,
            sessionId = SESSION_ID,
            revision = 2,
            processedAtEpochMs = 2_000,
            canonicalEventHash = HASH,
            resultRevision = 2,
        )
        val finished = session.copy(finishedAt = "2026-07-15T11:00:00Z")
        val operation = SyncOutboxEntity(
            operationId = "op_watch_finish",
            type = "FinishSessionOperation",
            payloadJson = "{}",
        )

        assertTrue(dao.applyWatchFinishedEvent(processed, finished, operation))

        assertEquals(finished.finishedAt, dao.getSession(SESSION_ID)?.finishedAt)
        assertTrue(dao.getOpenSessions().isEmpty())
        assertNull(dao.getActiveWorkoutRuntime(SESSION_ID))
        assertEquals(EVENT_ID, dao.getProcessedWatchEvent(EVENT_ID)?.eventId)
        assertEquals("op_watch_finish", dao.queuedOperations().single().operationId)
    }

    @Test
    fun phoneSetMutationAtomicallyStoresRuntimeRevisionAndRepairMarker() = runBlocking {
        val session = LocalSessionEntity(
            id = SESSION_ID,
            workoutId = "workout_repair_marker",
            gymId = null,
            startedAt = "2026-07-15T10:00:00Z",
        )
        dao.saveSession(session)
        val set = LocalSetEntity(
            id = "set_repair_marker",
            sessionId = SESSION_ID,
            exerciseId = "exercise_repair_marker",
            setNumber = 1,
            weight = 100.0,
            reps = 8,
            rir = 2,
            completedAt = "2026-07-15T10:01:00Z",
        )
        val runtime = ActiveWorkoutRuntimeEntity(
            sessionId = SESSION_ID,
            workoutId = session.workoutId,
            activeExerciseId = set.exerciseId,
            revision = 2,
            updatedAtEpochMs = 2_000,
        )
        val marker = WatchResyncMarkerEntity(SESSION_ID, 2, "SET_COMPLETED", 2_000, 2_000)

        dao.saveSetOperationRuntimeAndMarker(
            set = set,
            operation = SyncOutboxEntity(
                operationId = "op_repair_marker",
                type = "UpsertSetOperation",
                payloadJson = "{}",
            ),
            runtime = runtime,
            marker = marker,
        )

        assertEquals(set.id, dao.getSet(set.id)?.id)
        assertEquals(2L, dao.getActiveWorkoutRuntime(SESSION_ID)?.revision)
        assertEquals("op_repair_marker", dao.queuedOperations().single().operationId)
        assertEquals(2L, dao.getWatchResyncMarker(SESSION_ID)?.revision)
    }

    private fun watchEvent(eventId: String, sessionId: String, revision: Long) = WatchEventEnvelopeDto(
        protocolVersion = WatchProtocol.VERSION,
        schemaVersion = WatchProtocol.SCHEMA_VERSION,
        eventId = eventId,
        sessionId = sessionId,
        type = WatchEventType.WORKOUT_STARTED,
        timestamp = revision,
        source = WatchEventSource.PHONE,
        deviceId = "phone-account-clear",
        revision = revision,
        payload = buildJsonObject {},
    )

    private fun watchAck(
        ackId: String,
        sessionId: String,
        eventId: String,
        revision: Long,
    ) = WatchSyncAckDto(
        protocolVersion = WatchProtocol.VERSION,
        schemaVersion = WatchProtocol.SCHEMA_VERSION,
        ackId = ackId,
        sessionId = sessionId,
        eventIds = listOf(eventId),
        status = WatchSyncAckStatus.APPLIED,
        timestamp = revision,
        source = WatchEventSource.WATCH,
        deviceId = DEVICE_ID,
        revision = revision,
        errorCode = null,
    )

    private companion object {
        const val SESSION_ID = "session_account_clear"
        const val EVENT_ID = "10000000-0000-0000-0000-000000000001"
        const val OUTBOX_EVENT_ID = "10000000-0000-0000-0000-000000000002"
        const val ACK_ID = "20000000-0000-0000-0000-000000000001"
        const val SECOND_ACK_ID = "20000000-0000-0000-0000-000000000002"
        const val CONFLICT_ID = "30000000-0000-0000-0000-000000000001"
        const val TRANSFER_ID = "40000000-0000-0000-0000-000000000001"
        const val DEVICE_ID = "watch-account-clear"
        const val OTHER_SESSION_ID = "session_account_clear_other"
        const val HASH = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        val WATCH_TABLES = listOf(
            "watch_inbox_events",
            "watch_outbox_events",
            "watch_resync_markers",
            "watch_ack_journal",
            "watch_peers",
            "watch_conflicts",
            "watch_file_transfers",
        )
    }
}
