package org.sharteman.gymcoach.data.local

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class WatchSensorDaoTest {
    private lateinit var database: GymCoachDatabase
    private lateinit var dao: GymCoachDao

    @Before
    fun setUp() {
        database = Room.inMemoryDatabaseBuilder(
            ApplicationProvider.getApplicationContext(),
            GymCoachDatabase::class.java,
        ).build()
        dao = database.dao()
    }

    @After
    fun tearDown() {
        database.close()
    }

    @Test
    fun sensorBatchTransactionIsIdempotentPerEventAndSequence() = runTest {
        dao.saveSession(
            LocalSessionEntity(
                id = SESSION_ID,
                workoutId = WORKOUT_ID,
                gymId = null,
                startedAt = "2026-07-15T04:00:00Z",
            ),
        )
        val initialRuntime = ActiveWorkoutRuntimeEntity(
            sessionId = SESSION_ID,
            workoutId = WORKOUT_ID,
            revision = 1,
            updatedAtEpochMs = 1_000L,
        )
        dao.saveActiveWorkoutRuntime(initialRuntime)
        val firstBatch = batch(sequence = 1)
        val firstSample = sample(
            sampleId = SAMPLE_ONE_ID,
            sequence = 1,
            numericValue = null,
            valid = false,
            quality = "OFF_WRIST",
        )
        val firstProcessed = processed(EVENT_ONE_ID, 2)

        assertTrue(
            dao.applyWatchSensorBatch(
                firstProcessed,
                firstBatch,
                listOf(firstSample),
                initialRuntime.copy(revision = 2, updatedAtEpochMs = 2_000L),
            ),
        )
        assertFalse(
            dao.applyWatchSensorBatch(
                firstProcessed,
                firstBatch,
                listOf(firstSample),
                initialRuntime.copy(revision = 2, updatedAtEpochMs = 2_000L),
            ),
        )

        val secondBatch = batch(sequence = 2)
        assertTrue(
            dao.applyWatchSensorBatch(
                processed(EVENT_TWO_ID, 3),
                secondBatch,
                listOf(sample(SAMPLE_TWO_ID, 2, 142.0, true, "VALID")),
                initialRuntime.copy(revision = 3, updatedAtEpochMs = 3_000L),
            ),
        )

        assertEquals(1, dao.hasWatchSensorBatch(BATCH_ID, 1))
        assertEquals(1, dao.hasWatchSensorBatch(BATCH_ID, 2))
        val stored = dao.getWatchSensorSamplesForSet(SESSION_ID, SET_ID, "REST")
        assertEquals(2, stored.size)
        assertNull(stored.first().numericValue)
        assertFalse(stored.first().valid)
        assertEquals("OFF_WRIST", stored.first().quality)
        assertEquals(3L, dao.getActiveWorkoutRuntime(SESSION_ID)?.revision)
    }

    private fun batch(sequence: Int) = WatchSensorBatchEntity(
        batchId = BATCH_ID,
        sessionId = SESSION_ID,
        source = "WATCH",
        deviceId = "watch-test",
        createdAtEpochMs = 1_000L,
        sequence = sequence,
        totalSequences = 2,
        sampleCount = 1,
        receivedAtEpochMs = 2_000L,
    )

    private fun sample(
        sampleId: String,
        sequence: Int,
        numericValue: Double?,
        valid: Boolean,
        quality: String,
    ) = WatchSensorSampleEntity(
        sampleId = sampleId,
        batchId = BATCH_ID,
        batchSequence = sequence,
        sessionId = SESSION_ID,
        exerciseSessionId = EXERCISE_SESSION_ID,
        setId = SET_ID,
        phase = "REST",
        sensorType = "HEART_RATE",
        numericValue = numericValue,
        textValue = null,
        booleanValue = null,
        unit = "BPM",
        timestampEpochMs = sequence * 1_000L,
        source = "WATCH",
        valid = valid,
        quality = quality,
    )

    private fun processed(eventId: String, revision: Long) = WatchProcessedEventEntity(
        eventId = eventId,
        sessionId = SESSION_ID,
        revision = revision,
        processedAtEpochMs = revision * 1_000L,
    )

    private companion object {
        const val SESSION_ID = "session-sensor-dao"
        const val WORKOUT_ID = "workout-sensor-dao"
        const val SET_ID = "set-sensor-dao"
        const val EXERCISE_SESSION_ID = "exercise-session-sensor-dao"
        const val BATCH_ID = "70000000-0000-0000-0000-000000000001"
        const val SAMPLE_ONE_ID = "70000000-0000-0000-0000-000000000002"
        const val SAMPLE_TWO_ID = "70000000-0000-0000-0000-000000000003"
        const val EVENT_ONE_ID = "70000000-0000-0000-0000-000000000004"
        const val EVENT_TWO_ID = "70000000-0000-0000-0000-000000000005"
    }
}
