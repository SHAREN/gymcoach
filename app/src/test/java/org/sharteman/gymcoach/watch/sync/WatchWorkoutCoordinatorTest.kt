package org.sharteman.gymcoach.watch.sync

import java.time.Instant
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.sharteman.gymcoach.data.local.ActiveWorkoutRuntimeEntity
import org.sharteman.gymcoach.data.local.LocalSessionEntity
import org.sharteman.gymcoach.data.local.LocalSetEntity
import org.sharteman.gymcoach.data.local.RestRecoverySummaryEntity
import org.sharteman.gymcoach.data.local.WatchProcessedEventEntity
import org.sharteman.gymcoach.data.local.WatchSensorBatchEntity
import org.sharteman.gymcoach.data.local.WatchSensorSampleEntity
import org.sharteman.gymcoach.data.model.BootstrapResponse
import org.sharteman.gymcoach.data.model.ExerciseDto
import org.sharteman.gymcoach.data.model.ProfileDto
import org.sharteman.gymcoach.data.model.ProgramDto
import org.sharteman.gymcoach.data.model.ProgramExerciseDto
import org.sharteman.gymcoach.data.model.WorkoutDto
import org.sharteman.gymcoach.watch.data.PersistentWatchWorkoutGateway
import org.sharteman.gymcoach.watch.data.WatchWorkoutProtocolCodec
import org.sharteman.gymcoach.watch.data.WatchWorkoutRepository
import org.sharteman.gymcoach.watch.domain.ActiveExerciseChangedPayloadDto
import org.sharteman.gymcoach.watch.domain.RestFinishedPayloadDto
import org.sharteman.gymcoach.watch.domain.RestHeartRateSummaryDto
import org.sharteman.gymcoach.watch.domain.RestStartedPayloadDto
import org.sharteman.gymcoach.watch.domain.RestUpdatedPayloadDto
import org.sharteman.gymcoach.watch.domain.SensorBatchRecordedPayloadDto
import org.sharteman.gymcoach.watch.domain.SetDeletedPayloadDto
import org.sharteman.gymcoach.watch.domain.SetStartedPayloadDto
import org.sharteman.gymcoach.watch.domain.WatchDeliveryMode
import org.sharteman.gymcoach.watch.domain.WatchEventEnvelopeDto
import org.sharteman.gymcoach.watch.domain.WatchEventSource
import org.sharteman.gymcoach.watch.domain.WatchEventType
import org.sharteman.gymcoach.watch.domain.WatchHeartRateSummaryDto
import org.sharteman.gymcoach.watch.domain.WatchProtocol
import org.sharteman.gymcoach.watch.domain.WatchSensorBatchDto
import org.sharteman.gymcoach.watch.domain.WatchSensorSampleDto
import org.sharteman.gymcoach.watch.domain.WatchSetRecordDto
import org.sharteman.gymcoach.watch.domain.WatchSyncAckDto
import org.sharteman.gymcoach.watch.domain.WatchSyncAckStatus
import org.sharteman.gymcoach.watch.domain.WatchSyncSnapshotDto
import org.sharteman.gymcoach.watch.domain.WatchWorkoutPhase

class WatchWorkoutCoordinatorTest {
    private val codec = WatchWorkoutProtocolCodec()

    @Test
    fun `phone start and later watch open produce the same restartable snapshot`() = runTest {
        val repository = FakeWatchWorkoutRepository()
        val firstGateway = gateway(repository)

        val initial = firstGateway.buildSnapshot(SESSION_ID)
        val reopened = gateway(repository).buildSnapshot(SESSION_ID)

        assertNotNull(initial)
        assertEquals(SESSION_ID, initial?.sessionId)
        assertEquals(EXERCISE_ONE_ID, initial?.workoutSession?.activeExerciseId)
        assertEquals(2, initial?.exerciseSessions?.size)
        assertEquals(initial?.workoutSession, reopened?.workoutSession)
        assertEquals(1L, repository.runtime?.revision)
    }

    @Test
    fun `phone and watch exercise changes update the same runtime`() = runTest {
        val repository = FakeWatchWorkoutRepository()
        val sink = RecordingSink()
        val gateway = gateway(repository)
        gateway.buildSnapshot(SESSION_ID)
        val coordinator = coordinator(gateway, sink)

        assertTrue(coordinator.changeActiveExerciseFromPhone(SESSION_ID, EXERCISE_TWO_ID))
        assertEquals(EXERCISE_TWO_ID, repository.runtime?.activeExerciseId)
        assertEquals(2L, repository.runtime?.revision)
        assertEquals(EXERCISE_TWO_ID, codec.decodeActiveExerciseChangedPayload(sink.events.single().payload).exerciseId)

        coordinator.onEvent(
            watchEvent(
                eventId = EVENT_EXERCISE,
                type = WatchEventType.ACTIVE_EXERCISE_CHANGED,
                revision = 3,
                payload = codec.encodeActiveExerciseChangedPayload(
                    ActiveExerciseChangedPayloadDto(
                        exerciseId = EXERCISE_ONE_ID,
                        exerciseSessionId = EXERCISE_SESSION_ONE_ID,
                        order = 1,
                    ),
                ),
            ),
        )

        assertEquals(EXERCISE_ONE_ID, repository.runtime?.activeExerciseId)
        assertEquals(WatchEventSource.WATCH.name, repository.runtime?.updatedBy)
        assertEquals(WatchSyncAckStatus.APPLIED, sink.acks.last().status)
    }

    @Test
    fun `completed watch set keeps exact values and duplicate creates no second outbox row`() = runTest {
        val repository = FakeWatchWorkoutRepository()
        val sink = RecordingSink()
        val gateway = gateway(repository)
        gateway.buildSnapshot(SESSION_ID)
        val coordinator = coordinator(gateway, sink)
        val record = WatchSetRecordDto(
            setId = WATCH_SET_ID,
            sessionId = SESSION_ID,
            exerciseSessionId = EXERCISE_SESSION_ONE_ID,
            setNumber = 1,
            weight = 102.5,
            reps = 7,
            rir = 2,
            setType = "WORKING",
            comment = "Exact watch set",
            startedAt = 2_000L,
            completedAt = 62_000L,
            source = WatchEventSource.WATCH,
            heartRateSummary = WatchHeartRateSummaryDto(null, null, null, null, null, 0),
            sensorSummary = buildJsonObject {},
            revision = 2,
        )
        val event = watchEvent(
            eventId = EVENT_SET,
            type = WatchEventType.SET_COMPLETED,
            revision = 2,
            payload = codec.encodeSetRecordPayload(record),
        )

        coordinator.onEvent(event)
        coordinator.onEvent(event)

        val stored = repository.sets.getValue(WATCH_SET_ID)
        assertEquals(WATCH_SET_ID, stored.id)
        assertEquals(EXERCISE_SESSION_ONE_ID, stored.exerciseSessionId)
        assertEquals(102.5, stored.weight, 0.0)
        assertEquals(7, stored.reps)
        assertEquals(2, stored.rir)
        assertEquals("Exact watch set", stored.notes)
        assertEquals(Instant.ofEpochMilli(2_000L).toString(), stored.startedAt)
        assertEquals(WatchEventSource.WATCH.name, stored.source)
        assertEquals(2L, stored.watchRevision)
        assertEquals(listOf(WATCH_SET_ID), repository.outboxSetIds)
        assertEquals(WatchSyncAckStatus.APPLIED, sink.acks[sink.acks.lastIndex - 1].status)
        assertEquals(WatchSyncAckStatus.DUPLICATE, sink.acks.last().status)

        val restartedSnapshot = gateway(repository).buildSnapshot(SESSION_ID)
        assertEquals(record, restartedSnapshot?.setRecords?.single())
    }

    @Test
    fun `state request responds with snapshot and revision gap requests sync`() = runTest {
        val repository = FakeWatchWorkoutRepository()
        val sink = RecordingSink()
        val gateway = gateway(repository)
        val coordinator = coordinator(gateway, sink)

        coordinator.onEvent(
            watchEvent(
                eventId = EVENT_SYNC_REQUEST,
                type = WatchEventType.SYNC_REQUESTED,
                revision = 1,
            ),
        )
        coordinator.onEvent(
            watchEvent(
                eventId = EVENT_GAP,
                type = WatchEventType.ACTIVE_EXERCISE_CHANGED,
                revision = 3,
                payload = codec.encodeActiveExerciseChangedPayload(
                    ActiveExerciseChangedPayloadDto(EXERCISE_TWO_ID, EXERCISE_SESSION_TWO_ID, 2),
                ),
            ),
        )

        assertEquals(1, sink.snapshots.size)
        assertEquals(WatchSyncAckStatus.REJECTED, sink.acks.single().status)
        assertEquals("SYNC_REQUIRED", sink.acks.single().errorCode)
        assertTrue(SESSION_ID.startsWith("mob_session_"))
        assertTrue(EXERCISE_SESSION_ONE_ID.startsWith("program_exercise_"))
    }

    @Test
    fun `set start survives restart and update delete reuse stable set id`() = runTest {
        val repository = FakeWatchWorkoutRepository()
        val sink = RecordingSink()
        val gateway = gateway(repository)
        gateway.buildSnapshot(SESSION_ID)
        val coordinator = coordinator(gateway, sink)

        coordinator.onEvent(
            watchEvent(
                eventId = EVENT_SET_STARTED,
                type = WatchEventType.SET_STARTED,
                revision = 2,
                payload = codec.encodeSetStartedPayload(
                    SetStartedPayloadDto(WATCH_SET_ID, EXERCISE_SESSION_ONE_ID, 1, 2_000L),
                ),
            ),
        )
        val reopened = gateway(repository).buildSnapshot(SESSION_ID)
        assertEquals(WATCH_SET_ID, reopened?.workoutSession?.activeSetId)
        assertEquals(2_000L, repository.runtime?.setStartedAtEpochMs)

        val completed = setRecord(weight = 100.0, reps = 8, rir = 2, revision = 3)
        coordinator.onEvent(
            watchEvent(EVENT_SET, WatchEventType.SET_COMPLETED, 3, codec.encodeSetRecordPayload(completed)),
        )
        val updated = setRecord(weight = 102.5, reps = 7, rir = 1, revision = 4)
        coordinator.onEvent(
            watchEvent(EVENT_SET_UPDATED, WatchEventType.SET_UPDATED, 4, codec.encodeSetRecordPayload(updated)),
        )
        coordinator.onEvent(
            watchEvent(
                EVENT_SET_DELETED,
                WatchEventType.SET_DELETED,
                5,
                codec.encodeSetDeletedPayload(SetDeletedPayloadDto(WATCH_SET_ID, 70_000L, 4)),
            ),
        )

        assertEquals(WATCH_SET_ID, repository.sets.getValue(WATCH_SET_ID).id)
        assertEquals(102.5, repository.sets.getValue(WATCH_SET_ID).weight, 0.0)
        assertEquals(1, repository.sets.getValue(WATCH_SET_ID).rir)
        assertTrue(repository.sets.getValue(WATCH_SET_ID).deleted)
        assertEquals(listOf(WATCH_SET_ID, WATCH_SET_ID, WATCH_SET_ID), repository.outboxSetIds)
        assertEquals(5L, repository.runtime?.revision)
    }

    @Test
    fun `sensor chunks are idempotent per batch sequence and update set summary`() = runTest {
        val repository = FakeWatchWorkoutRepository()
        val sink = RecordingSink()
        val gateway = gateway(repository)
        gateway.buildSnapshot(SESSION_ID)
        val coordinator = coordinator(gateway, sink)
        coordinator.onEvent(
            watchEvent(
                EVENT_SET,
                WatchEventType.SET_COMPLETED,
                2,
                codec.encodeSetRecordPayload(setRecord(100.0, 8, 2, 2)),
            ),
        )
        val firstBatch = sensorBatch(
            sequence = 1,
            samples = listOf(
                heartRateSample("20000000-0000-0000-0000-000000000001", 2_000L, 150),
                heartRateSample(
                    "20000000-0000-0000-0000-000000000002",
                    3_000L,
                    null,
                    valid = false,
                    quality = "OFF_WRIST",
                ),
                heartRateSample("20000000-0000-0000-0000-000000000003", 32_000L, 170),
            ),
        )
        val firstEvent = sensorBatchEvent(EVENT_SENSOR_BATCH, 3, firstBatch)

        coordinator.onSensorBatch(firstEvent, firstBatch)
        coordinator.onSensorBatch(firstEvent, firstBatch)
        coordinator.onSensorBatch(
            sensorBatchEvent(EVENT_SENSOR_BATCH_DUPLICATE_CHUNK, 4, firstBatch),
            firstBatch,
        )

        val secondBatch = sensorBatch(
            sequence = 2,
            samples = listOf(
                heartRateSample("20000000-0000-0000-0000-000000000004", 62_000L, 160),
            ),
        )
        coordinator.onSensorBatch(sensorBatchEvent(EVENT_SENSOR_BATCH_SECOND, 4, secondBatch), secondBatch)

        val stored = repository.sets.getValue(WATCH_SET_ID)
        assertEquals(150, stored.minHr)
        assertEquals(170, stored.maxHr)
        assertEquals(160, stored.avgHr)
        assertEquals(150, stored.startHr)
        assertEquals(160, stored.endHr)
        assertEquals(3, stored.hrSampleCount)
        assertEquals(setOf(SENSOR_BATCH_ID to 1, SENSOR_BATCH_ID to 2), repository.sensorBatches)
        assertEquals(WatchSyncAckStatus.DUPLICATE, sink.acks[sink.acks.lastIndex - 1].status)
        assertEquals(WatchSyncAckStatus.APPLIED, sink.acks.last().status)
    }

    @Test
    fun `absolute rest survives updates and persists deterministic recovery summary`() = runTest {
        val repository = FakeWatchWorkoutRepository()
        val sink = RecordingSink()
        val gateway = gateway(repository)
        gateway.buildSnapshot(SESSION_ID)
        val coordinator = coordinator(gateway, sink)
        coordinator.onEvent(
            watchEvent(
                EVENT_SET,
                WatchEventType.SET_COMPLETED,
                2,
                codec.encodeSetRecordPayload(setRecord(100.0, 8, 2, 2)),
            ),
        )
        coordinator.onEvent(
            watchEvent(
                EVENT_REST_STARTED,
                WatchEventType.REST_STARTED,
                3,
                codec.encodeRestStartedPayload(RestStartedPayloadDto(WATCH_SET_ID, 70_000L, 190_000L)),
            ),
        )
        coordinator.onEvent(
            watchEvent(
                EVENT_REST_UPDATED,
                WatchEventType.REST_UPDATED,
                4,
                codec.encodeRestUpdatedPayload(RestUpdatedPayloadDto(220_000L, "ADD_30_SECONDS")),
            ),
        )

        assertEquals(WATCH_SET_ID, repository.runtime?.activeSetId)
        assertEquals(70_000L, repository.runtime?.restStartedAtEpochMs)
        assertEquals(220_000L, repository.runtime?.restEndsAtEpochMs)
        assertEquals(150, repository.runtime?.restDurationSeconds)

        val restBatch = sensorBatch(
            sequence = 1,
            samples = listOf(
                heartRateSample("30000000-0000-0000-0000-000000000001", 70_000L, 150, phase = WatchWorkoutPhase.REST),
                heartRateSample("30000000-0000-0000-0000-000000000002", 100_000L, 140, phase = WatchWorkoutPhase.REST),
                heartRateSample("30000000-0000-0000-0000-000000000003", 130_000L, 130, phase = WatchWorkoutPhase.REST),
                heartRateSample(
                    "30000000-0000-0000-0000-000000000004",
                    150_000L,
                    null,
                    valid = false,
                    quality = "OFF_WRIST",
                    phase = WatchWorkoutPhase.REST,
                ),
            ),
            batchId = REST_BATCH_ID,
            totalSequences = 1,
        )
        coordinator.onSensorBatch(sensorBatchEvent(EVENT_REST_BATCH, 5, restBatch), restBatch)
        coordinator.onEvent(
            watchEvent(
                EVENT_REST_FINISHED,
                WatchEventType.REST_FINISHED,
                6,
                codec.encodeRestFinishedPayload(
                    RestFinishedPayloadDto(
                        finishedAt = 190_000L,
                        summary = RestHeartRateSummaryDto(
                            startedAt = 70_000L,
                            finishedAt = 190_000L,
                            start = 150.0,
                            min = 130.0,
                            average = 140.0,
                            at30Seconds = 140.0,
                            at60Seconds = 130.0,
                            drop30Seconds = 10.0,
                            drop60Seconds = 20.0,
                            sampleCount = 3,
                        ),
                    ),
                ),
            ),
        )

        val summary = repository.restRecoverySummaries.values.single()
        assertEquals(WATCH_SET_ID, summary.setId)
        assertEquals(150.0, summary.startHr ?: Double.NaN, 0.0)
        assertEquals(130.0, summary.minHr ?: Double.NaN, 0.0)
        assertEquals(140.0, summary.avgHr ?: Double.NaN, 0.0)
        assertEquals(10.0, summary.drop30 ?: Double.NaN, 0.0)
        assertEquals(20.0, summary.drop60 ?: Double.NaN, 0.0)
        assertEquals(3, summary.hrSampleCount)
        assertEquals(null, repository.runtime?.restStartedAtEpochMs)
        assertEquals(null, repository.runtime?.activeSetId)
    }

    private fun gateway(repository: FakeWatchWorkoutRepository) = PersistentWatchWorkoutGateway(
        repository = repository,
        phoneDeviceId = "phone-stage3",
        codec = codec,
        nowEpochMs = { 10_000L },
        newUuid = { SNAPSHOT_ID },
    )

    private fun coordinator(
        gateway: PersistentWatchWorkoutGateway,
        sink: RecordingSink,
    ) = WatchWorkoutCoordinator(
        gateway = gateway,
        sink = sink,
        phoneDeviceId = "phone-stage3",
        codec = codec,
        nowEpochMs = { 20_000L },
        newUuid = { ACK_ID },
    )

    private fun watchEvent(
        eventId: String,
        type: WatchEventType,
        revision: Long,
        payload: kotlinx.serialization.json.JsonObject = buildJsonObject {},
    ) = WatchEventEnvelopeDto(
        protocolVersion = WatchProtocol.VERSION,
        schemaVersion = WatchProtocol.SCHEMA_VERSION,
        eventId = eventId,
        sessionId = SESSION_ID,
        type = type,
        timestamp = 15_000L,
        source = WatchEventSource.WATCH,
        deviceId = "watch-stage3",
        revision = revision,
        payload = payload,
    )

    private fun setRecord(
        weight: Double,
        reps: Int,
        rir: Int,
        revision: Long,
    ) = WatchSetRecordDto(
        setId = WATCH_SET_ID,
        sessionId = SESSION_ID,
        exerciseSessionId = EXERCISE_SESSION_ONE_ID,
        setNumber = 1,
        weight = weight,
        reps = reps,
        rir = rir,
        setType = "WORKING",
        comment = null,
        startedAt = 2_000L,
        completedAt = 62_000L,
        source = WatchEventSource.WATCH,
        heartRateSummary = WatchHeartRateSummaryDto(null, null, null, null, null, 0),
        sensorSummary = buildJsonObject {},
        revision = revision,
    )

    private fun sensorBatchEvent(
        eventId: String,
        revision: Long,
        batch: WatchSensorBatchDto,
    ) = watchEvent(
        eventId = eventId,
        type = WatchEventType.SENSOR_BATCH_RECORDED,
        revision = revision,
        payload = codec.encodeSensorBatchRecordedPayload(
            SensorBatchRecordedPayloadDto(
                batchId = batch.batchId,
                sequence = batch.sequence,
                totalSequences = batch.totalSequences,
                deliveryMode = WatchDeliveryMode.FILE,
                sampleCount = batch.sampleCount,
            ),
        ),
    )

    private fun sensorBatch(
        sequence: Int,
        samples: List<WatchSensorSampleDto>,
        batchId: String = SENSOR_BATCH_ID,
        totalSequences: Int = 2,
    ) = WatchSensorBatchDto(
        protocolVersion = WatchProtocol.VERSION,
        schemaVersion = WatchProtocol.SCHEMA_VERSION,
        batchId = batchId,
        sessionId = SESSION_ID,
        source = WatchEventSource.WATCH,
        deviceId = "watch-stage3",
        createdAt = 15_000L,
        sequence = sequence,
        totalSequences = totalSequences,
        sampleCount = samples.size,
        samples = samples,
    )

    private fun heartRateSample(
        sampleId: String,
        timestamp: Long,
        value: Int?,
        valid: Boolean = true,
        quality: String = "VALID",
        phase: WatchWorkoutPhase = WatchWorkoutPhase.SET,
    ) = WatchSensorSampleDto(
        sampleId = sampleId,
        sessionId = SESSION_ID,
        exerciseSessionId = EXERCISE_SESSION_ONE_ID,
        setId = WATCH_SET_ID,
        phase = phase,
        sensorType = "HEART_RATE",
        value = value?.let(::JsonPrimitive) ?: JsonNull,
        unit = "BPM",
        timestamp = timestamp,
        source = WatchEventSource.WATCH,
        valid = valid,
        quality = quality,
    )

    private class RecordingSink : WatchWorkoutResponseSink {
        val snapshots = mutableListOf<WatchSyncSnapshotDto>()
        val acks = mutableListOf<WatchSyncAckDto>()
        val events = mutableListOf<WatchEventEnvelopeDto>()

        override suspend fun sendSnapshot(snapshot: WatchSyncSnapshotDto) {
            snapshots += snapshot
        }

        override suspend fun sendAck(ack: WatchSyncAckDto) {
            acks += ack
        }

        override suspend fun sendEvent(event: WatchEventEnvelopeDto) {
            events += event
        }
    }

    private class FakeWatchWorkoutRepository : WatchWorkoutRepository {
        private val workout = testWorkout()
        private val session = LocalSessionEntity(
            id = SESSION_ID,
            workoutId = WORKOUT_ID,
            gymId = null,
            startedAt = Instant.ofEpochMilli(1_000L).toString(),
        )
        private val processedEventIds = mutableSetOf<String>()
        val sensorBatches = mutableSetOf<Pair<String, Int>>()
        private val sensorSamples = linkedMapOf<String, WatchSensorSampleEntity>()
        val restRecoverySummaries = linkedMapOf<String, RestRecoverySummaryEntity>()
        val sets = linkedMapOf<String, LocalSetEntity>()
        val outboxSetIds = mutableListOf<String>()
        var runtime: ActiveWorkoutRuntimeEntity? = null

        override suspend fun bootstrap() = BootstrapResponse(
            schemaVersion = 1,
            calculationVersion = "test",
            serverTime = Instant.EPOCH.toString(),
            profile = ProfileDto(USER_ID, "user@example.com"),
            activeProgram = ProgramDto(
                id = "program_opaque",
                name = "Program",
                phase = "HYPERTROPHY",
                workouts = listOf(workout),
            ),
        )

        override suspend fun session(sessionId: String) = session.takeIf { it.id == sessionId }
        override suspend fun sets(sessionId: String) = sets.values.filter { it.sessionId == sessionId }
        override suspend fun set(setId: String) = sets[setId]
        override suspend fun runtime(sessionId: String) = runtime?.takeIf { it.sessionId == sessionId }
        override suspend fun hasProcessedEvent(eventId: String) = eventId in processedEventIds
        override suspend fun hasSensorBatch(batchId: String, sequence: Int) =
            batchId to sequence in sensorBatches

        override suspend fun saveRuntime(runtime: ActiveWorkoutRuntimeEntity) {
            this.runtime = runtime
        }

        override suspend fun updateActiveExercise(
            sessionId: String,
            exerciseId: String,
            updatedBy: String,
            updatedAtEpochMs: Long,
        ): ActiveWorkoutRuntimeEntity? {
            val current = runtime ?: return null
            return current.copy(
                activeExerciseId = exerciseId,
                activeSetId = null,
                setStartedAtEpochMs = null,
                revision = current.revision + 1,
                updatedAtEpochMs = updatedAtEpochMs,
                updatedBy = updatedBy,
            ).also { runtime = it }
        }

        override suspend fun applyRuntimeEvent(
            processed: WatchProcessedEventEntity,
            runtime: ActiveWorkoutRuntimeEntity,
        ): Boolean {
            if (!processedEventIds.add(processed.eventId)) return false
            this.runtime = runtime
            return true
        }

        override suspend fun applySetEvent(
            processed: WatchProcessedEventEntity,
            set: LocalSetEntity,
            runtime: ActiveWorkoutRuntimeEntity,
        ): Boolean {
            if (!processedEventIds.add(processed.eventId)) return false
            sets[set.id] = set
            outboxSetIds += set.id
            this.runtime = runtime
            return true
        }

        override suspend fun applyDeleteSetEvent(
            processed: WatchProcessedEventEntity,
            setId: String,
            runtime: ActiveWorkoutRuntimeEntity,
        ): Boolean {
            if (!processedEventIds.add(processed.eventId)) return false
            sets[setId]?.let { sets[setId] = it.copy(deleted = true) }
            outboxSetIds += setId
            this.runtime = runtime
            return true
        }

        override suspend fun applySensorBatch(
            processed: WatchProcessedEventEntity,
            batch: WatchSensorBatchEntity,
            samples: List<WatchSensorSampleEntity>,
            runtime: ActiveWorkoutRuntimeEntity,
        ): Boolean {
            if (
                !processedEventIds.add(processed.eventId) ||
                !sensorBatches.add(batch.batchId to batch.sequence)
            ) return false
            samples.forEach { sensorSamples[it.sampleId] = it }
            this.runtime = runtime
            return true
        }

        override suspend fun applyRestEvent(
            processed: WatchProcessedEventEntity,
            runtime: ActiveWorkoutRuntimeEntity,
            summary: RestRecoverySummaryEntity?,
        ): Boolean {
            if (!processedEventIds.add(processed.eventId)) return false
            this.runtime = runtime
            summary?.let { restRecoverySummaries[it.restId] = it }
            return true
        }

        override suspend fun sensorSamplesForSet(sessionId: String, setId: String, phase: String) =
            sensorSamples.values.filter {
                it.sessionId == sessionId && it.setId == setId && it.phase == phase
            }.sortedWith(compareBy(WatchSensorSampleEntity::timestampEpochMs, WatchSensorSampleEntity::sampleId))

        override suspend fun sensorSamplesForInterval(
            sessionId: String,
            setId: String,
            phase: String,
            startedAtEpochMs: Long,
            endedAtEpochMs: Long,
        ) = sensorSamplesForSet(sessionId, setId, phase).filter {
            it.timestampEpochMs in startedAtEpochMs..endedAtEpochMs
        }

        override suspend fun restSummaries(sessionId: String) =
            restRecoverySummaries.values.filter { it.sessionId == sessionId }

        override suspend fun updateSetHeartRateSummary(
            setId: String,
            minHr: Int?,
            maxHr: Int?,
            avgHr: Int?,
            startHr: Int?,
            endHr: Int?,
            sampleCount: Int,
        ): Boolean {
            val existing = sets[setId] ?: return false
            sets[setId] = existing.copy(
                minHr = minHr,
                maxHr = maxHr,
                avgHr = avgHr,
                startHr = startHr,
                endHr = endHr,
                hrSampleCount = sampleCount,
            )
            return true
        }

        override suspend fun saveRestSummary(summary: RestRecoverySummaryEntity) {
            restRecoverySummaries[summary.restId] = summary
        }
    }

    private companion object {
        const val SESSION_ID = "mob_session_stage3_opaque"
        const val WORKOUT_ID = "workout_stage3_opaque"
        const val USER_ID = "user_stage3_opaque"
        const val EXERCISE_ONE_ID = "exercise_stage3_one"
        const val EXERCISE_TWO_ID = "exercise_stage3_two"
        const val EXERCISE_SESSION_ONE_ID = "program_exercise_stage3_one"
        const val EXERCISE_SESSION_TWO_ID = "program_exercise_stage3_two"
        const val WATCH_SET_ID = "watch_set_stage3_opaque"
        const val SNAPSHOT_ID = "10000000-0000-0000-0000-000000000001"
        const val ACK_ID = "10000000-0000-0000-0000-000000000002"
        const val EVENT_EXERCISE = "10000000-0000-0000-0000-000000000003"
        const val EVENT_SET = "10000000-0000-0000-0000-000000000004"
        const val EVENT_SYNC_REQUEST = "10000000-0000-0000-0000-000000000005"
        const val EVENT_GAP = "10000000-0000-0000-0000-000000000006"
        const val EVENT_SET_STARTED = "10000000-0000-0000-0000-000000000007"
        const val EVENT_SET_UPDATED = "10000000-0000-0000-0000-000000000008"
        const val EVENT_SET_DELETED = "10000000-0000-0000-0000-000000000009"
        const val EVENT_SENSOR_BATCH = "10000000-0000-0000-0000-000000000010"
        const val EVENT_SENSOR_BATCH_DUPLICATE_CHUNK = "10000000-0000-0000-0000-000000000011"
        const val EVENT_SENSOR_BATCH_SECOND = "10000000-0000-0000-0000-000000000012"
        const val EVENT_REST_STARTED = "10000000-0000-0000-0000-000000000013"
        const val EVENT_REST_UPDATED = "10000000-0000-0000-0000-000000000014"
        const val EVENT_REST_BATCH = "10000000-0000-0000-0000-000000000015"
        const val EVENT_REST_FINISHED = "10000000-0000-0000-0000-000000000016"
        const val SENSOR_BATCH_ID = "40000000-0000-0000-0000-000000000001"
        const val REST_BATCH_ID = "40000000-0000-0000-0000-000000000002"

        fun testWorkout(): WorkoutDto {
            fun target(
                programExerciseId: String,
                exerciseId: String,
                order: Int,
                name: String,
            ) = ProgramExerciseDto(
                id = programExerciseId,
                workoutId = WORKOUT_ID,
                exerciseId = exerciseId,
                order = order,
                targetSets = 3,
                targetRepsMin = 8,
                targetRepsMax = 10,
                targetRIR = 2,
                restSec = 90,
                exercise = ExerciseDto(
                    id = exerciseId,
                    name = name,
                    muscleGroup = "CHEST",
                    category = "STRENGTH",
                ),
            )
            return WorkoutDto(
                id = WORKOUT_ID,
                programId = "program_opaque",
                name = "Stage 3 workout",
                order = 1,
                exercises = listOf(
                    target(EXERCISE_SESSION_ONE_ID, EXERCISE_ONE_ID, 1, "Exercise one"),
                    target(EXERCISE_SESSION_TWO_ID, EXERCISE_TWO_ID, 2, "Exercise two"),
                ),
            )
        }
    }
}
