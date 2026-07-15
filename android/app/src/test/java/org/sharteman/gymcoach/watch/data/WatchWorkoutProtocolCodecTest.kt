package org.sharteman.gymcoach.watch.data

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.sharteman.gymcoach.watch.domain.WatchEventSource
import org.sharteman.gymcoach.watch.domain.WatchExerciseStatus
import org.sharteman.gymcoach.watch.domain.WatchProtocolErrorCode
import org.sharteman.gymcoach.watch.domain.WatchProtocolException

class WatchWorkoutProtocolCodecTest {
    private val codec = WatchWorkoutProtocolCodec()

    @Test
    fun `decodes and round trips shared active workout snapshot`() {
        val fixture = resource("sync-snapshot.json")

        val snapshot = codec.decodeSyncSnapshot(fixture.encodeToByteArray())
        val roundTripped = codec.decodeSyncSnapshot(codec.encodeSyncSnapshot(snapshot))

        assertEquals("mob_session_7b7c6d325d234be7b6cba379ad12c659", snapshot.sessionId)
        assertEquals(2, snapshot.exerciseSessions.size)
        assertEquals(1, snapshot.exerciseSessions.count { it.status == WatchExerciseStatus.ACTIVE })
        assertEquals(snapshot.workoutSession.activeExerciseId, snapshot.exerciseSessions.first().exerciseId)
        assertEquals(WatchEventSource.WATCH, snapshot.setRecords.single().source)
        assertEquals(snapshot, roundTripped)
    }

    @Test
    fun `decodes normative stage3 event payloads`() {
        val root = Json.parseToJsonElement(resource("stage3-event-payloads.json")).jsonObject

        val exercise = codec.decodeActiveExerciseChangedPayload(root.getValue("activeExerciseChanged").jsonObject)
        val started = codec.decodeSetStartedPayload(root.getValue("setStarted").jsonObject)
        val completed = codec.decodeSetRecordPayload(root.getValue("setCompleted").jsonObject)
        val deleted = codec.decodeSetDeletedPayload(root.getValue("setDeleted").jsonObject)

        assertEquals(2, exercise.order)
        assertEquals(2, started.setNumber)
        assertEquals(100.0, completed.weight, 0.0)
        assertEquals(8, completed.reps)
        assertEquals(2, completed.rir)
        assertEquals(7L, deleted.baseRevision)
    }

    @Test
    fun `historical set record preserves missing rir`() {
        val root = Json.parseToJsonElement(resource("stage3-event-payloads.json")).jsonObject
        val completed = codec.decodeSetRecordPayload(root.getValue("setCompleted").jsonObject)
        val withoutRir = completed.copy(rir = null)

        val decoded = codec.decodeSetRecord(codec.encodeSetRecord(withoutRir))

        assertNull(decoded.rir)
    }

    @Test
    fun `fractional rir is rejected by strict Kotlin contract`() {
        val root = Json.parseToJsonElement(resource("stage3-event-payloads.json")).jsonObject
        val invalid = root.getValue("setCompleted").toString().replace("\"rir\":2", "\"rir\":2.5")

        val failure = runCatching { codec.decodeSetRecord(invalid.encodeToByteArray()) }.exceptionOrNull()

        assertTrue(failure is WatchProtocolException)
        assertEquals(WatchProtocolErrorCode.INVALID_JSON, (failure as WatchProtocolException).code)
    }

    private fun resource(name: String): String = requireNotNull(javaClass.classLoader?.getResource(name)).readText()
}
