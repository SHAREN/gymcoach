package org.sharteman.gymcoach.watch.sync

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.buildJsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.sharteman.gymcoach.watch.domain.ActiveExerciseChangedPayloadDto
import org.sharteman.gymcoach.watch.domain.SetDeletedPayloadDto
import org.sharteman.gymcoach.watch.domain.WatchEventEnvelopeDto
import org.sharteman.gymcoach.watch.domain.WatchEventSource
import org.sharteman.gymcoach.watch.domain.WatchEventType
import org.sharteman.gymcoach.watch.domain.WatchExerciseSessionDto
import org.sharteman.gymcoach.watch.domain.WatchExerciseStatus
import org.sharteman.gymcoach.watch.domain.WatchHeartRateSummaryDto
import org.sharteman.gymcoach.watch.domain.WatchProtocol
import org.sharteman.gymcoach.watch.domain.WatchSetRecordDto
import org.sharteman.gymcoach.watch.domain.WatchSyncSnapshotDto
import org.sharteman.gymcoach.watch.domain.WatchWorkoutSessionDto
import org.sharteman.gymcoach.watch.domain.WatchWorkoutStatus

class WatchIntegrationRuntimeTest {
    @Test
    fun `phone commands persist before fake watch dispatch`() = runTest {
        val store = InMemoryWatchSyncPersistence(nowEpochMs = { 9_000 })
        val dispatch = RecordingDispatch(store)
        var idIndex = 0
        val ids = EVENT_IDS.iterator()
        val runtime = WatchIntegrationRuntime(
            phoneDeviceId = PHONE_DEVICE,
            persistence = store,
            dispatch = dispatch,
            snapshotProvider = { snapshot() },
            nowEpochMs = { 2_000 + idIndex++.toLong() },
            newUuid = { ids.next() },
        )

        runtime.startWorkout(SESSION, 1, 1_000)
        runtime.changeExercise(
            SESSION,
            2,
            ActiveExerciseChangedPayloadDto(EXERCISE_ID, EXERCISE_SESSION_ID, 1),
        )
        runtime.completeSet(SESSION, 3, setRecord(revision = 3))
        runtime.editSet(SESSION, 4, setRecord(revision = 4, reps = 9))
        runtime.deleteSet(SESSION, 5, SetDeletedPayloadDto(SET_ID, 3_000, 4))
        runtime.finishWorkout(SESSION, 6, 4_000)

        assertEquals(1, dispatch.snapshots.size)
        assertEquals(
            listOf(
                WatchEventType.WORKOUT_STARTED,
                WatchEventType.ACTIVE_EXERCISE_CHANGED,
                WatchEventType.SET_COMPLETED,
                WatchEventType.SET_UPDATED,
                WatchEventType.SET_DELETED,
                WatchEventType.WORKOUT_FINISHED,
            ),
            dispatch.events.map { it.type },
        )
        assertTrue(dispatch.persistedBeforeSend.all { it })
        assertEquals(EVENT_IDS, store.replayable(SESSION).map { it.eventId })
    }

    private class RecordingDispatch(
        private val persistence: WatchSyncPersistence,
    ) : WatchIntegrationDispatch {
        val events = mutableListOf<WatchEventEnvelopeDto>()
        val snapshots = mutableListOf<WatchSyncSnapshotDto>()
        val persistedBeforeSend = mutableListOf<Boolean>()

        override suspend fun sendEvent(event: WatchEventEnvelopeDto) {
            persistedBeforeSend += persistence.replayable(event.sessionId).any { it.eventId == event.eventId }
            events += event
        }

        override suspend fun sendSnapshot(snapshot: WatchSyncSnapshotDto) {
            snapshots += snapshot
        }
    }

    private fun setRecord(revision: Long, reps: Int = 8) = WatchSetRecordDto(
        setId = SET_ID,
        sessionId = SESSION,
        exerciseSessionId = EXERCISE_SESSION_ID,
        setNumber = 1,
        weight = 100.0,
        reps = reps,
        rir = 2,
        startedAt = 2_000,
        completedAt = 2_100,
        source = WatchEventSource.PHONE,
        heartRateSummary = WatchHeartRateSummaryDto(null, null, null, null, null, 0),
        sensorSummary = buildJsonObject {},
        revision = revision,
    )

    private fun snapshot() = WatchSyncSnapshotDto(
        protocolVersion = WatchProtocol.VERSION,
        schemaVersion = WatchProtocol.SCHEMA_VERSION,
        snapshotId = SNAPSHOT_ID,
        sessionId = SESSION,
        timestamp = 1_000,
        source = WatchEventSource.PHONE,
        deviceId = PHONE_DEVICE,
        revision = 1,
        workoutSession = WatchWorkoutSessionDto(
            SESSION, "workout_stage5", "user_stage5", WatchWorkoutStatus.ACTIVE,
            1_000, null, EXERCISE_ID, null, 1, 1_000, WatchEventSource.PHONE,
        ),
        exerciseSessions = listOf(
            WatchExerciseSessionDto(
                EXERCISE_SESSION_ID, SESSION, EXERCISE_ID, "Squat", 1,
                WatchExerciseStatus.ACTIVE, 3, 8, 2, 120,
            ),
        ),
        setRecords = emptyList(),
        sensorSamples = emptyList(),
        pendingEvents = emptyList(),
    )

    private companion object {
        const val SESSION = "mob_session_stage5_runtime"
        const val PHONE_DEVICE = "phone-stage5-runtime"
        const val EXERCISE_ID = "exercise_stage5"
        const val EXERCISE_SESSION_ID = "exercise_session_stage5"
        const val SET_ID = "mob_set_stage5"
        const val SNAPSHOT_ID = "80000000-0000-0000-0000-000000000001"
        val EVENT_IDS = listOf(
            "90000000-0000-0000-0000-000000000001",
            "90000000-0000-0000-0000-000000000002",
            "90000000-0000-0000-0000-000000000003",
            "90000000-0000-0000-0000-000000000004",
            "90000000-0000-0000-0000-000000000005",
            "90000000-0000-0000-0000-000000000006",
        )
    }
}
