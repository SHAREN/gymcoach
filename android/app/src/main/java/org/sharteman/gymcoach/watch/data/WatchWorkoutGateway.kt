package org.sharteman.gymcoach.watch.data

import java.time.Instant
import java.util.UUID
import kotlin.math.roundToInt
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import org.sharteman.gymcoach.data.local.ActiveWorkoutRuntimeEntity
import org.sharteman.gymcoach.data.local.LocalSessionEntity
import org.sharteman.gymcoach.data.local.LocalSetEntity
import org.sharteman.gymcoach.data.local.RestRecoverySummaryEntity
import org.sharteman.gymcoach.data.local.WatchProcessedEventEntity
import org.sharteman.gymcoach.data.local.WatchSensorBatchEntity
import org.sharteman.gymcoach.data.local.WatchSensorSampleEntity
import org.sharteman.gymcoach.data.model.BootstrapResponse
import org.sharteman.gymcoach.data.model.ProgramExerciseDto
import org.sharteman.gymcoach.data.model.WorkoutDto
import org.sharteman.gymcoach.data.repository.GymCoachRepository
import org.sharteman.gymcoach.watch.domain.ActiveExerciseChangedPayloadDto
import org.sharteman.gymcoach.watch.domain.RestFinishedPayloadDto
import org.sharteman.gymcoach.watch.domain.RestHeartRateSummaryDto
import org.sharteman.gymcoach.watch.domain.RestSkippedPayloadDto
import org.sharteman.gymcoach.watch.domain.RestStartedPayloadDto
import org.sharteman.gymcoach.watch.domain.RestUpdatedPayloadDto
import org.sharteman.gymcoach.watch.domain.SetStartedPayloadDto
import org.sharteman.gymcoach.watch.domain.WatchDeliveryMode
import org.sharteman.gymcoach.watch.domain.WatchEventEnvelopeDto
import org.sharteman.gymcoach.watch.domain.WatchEventSource
import org.sharteman.gymcoach.watch.domain.WatchEventType
import org.sharteman.gymcoach.watch.domain.WatchExerciseSessionDto
import org.sharteman.gymcoach.watch.domain.WatchExerciseStatus
import org.sharteman.gymcoach.watch.domain.WatchHeartRateSummaryDto
import org.sharteman.gymcoach.watch.domain.WatchProtocol
import org.sharteman.gymcoach.watch.domain.WatchSensorBatchDto
import org.sharteman.gymcoach.watch.domain.WatchSensorSampleDto
import org.sharteman.gymcoach.watch.domain.WatchSetRecordDto
import org.sharteman.gymcoach.watch.domain.WatchSyncAckStatus
import org.sharteman.gymcoach.watch.domain.WatchSyncSnapshotDto
import org.sharteman.gymcoach.watch.domain.WatchWorkoutSessionDto
import org.sharteman.gymcoach.watch.domain.WatchWorkoutStatus
import org.sharteman.gymcoach.watch.domain.WatchActiveWorkoutRuntimeDto
import org.sharteman.gymcoach.watch.domain.WatchRestRuntimeDto
import org.sharteman.gymcoach.watch.domain.WatchWorkoutPhase
import org.sharteman.gymcoach.watch.sensors.HeartRateObservation
import org.sharteman.gymcoach.watch.sensors.HeartRateSummaryCalculator

data class WatchWorkoutApplyResult(
    val status: WatchSyncAckStatus,
    val revision: Long,
    val errorCode: String? = null,
)

data class PhoneExerciseChange(
    val payload: ActiveExerciseChangedPayloadDto,
    val revision: Long,
    val updatedAtEpochMs: Long,
)

interface WatchWorkoutRepository {
    suspend fun bootstrap(): BootstrapResponse?
    suspend fun session(sessionId: String): LocalSessionEntity?
    suspend fun sets(sessionId: String): List<LocalSetEntity>
    suspend fun set(setId: String): LocalSetEntity?
    suspend fun runtime(sessionId: String): ActiveWorkoutRuntimeEntity?
    suspend fun hasProcessedEvent(eventId: String): Boolean
    suspend fun hasSensorBatch(batchId: String, sequence: Int): Boolean
    suspend fun saveRuntime(runtime: ActiveWorkoutRuntimeEntity)
    suspend fun updateActiveExercise(
        sessionId: String,
        exerciseId: String,
        updatedBy: String,
        updatedAtEpochMs: Long,
    ): ActiveWorkoutRuntimeEntity?
    suspend fun applyRuntimeEvent(
        processed: WatchProcessedEventEntity,
        runtime: ActiveWorkoutRuntimeEntity,
    ): Boolean
    suspend fun applySetEvent(
        processed: WatchProcessedEventEntity,
        set: LocalSetEntity,
        runtime: ActiveWorkoutRuntimeEntity,
    ): Boolean
    suspend fun applyDeleteSetEvent(
        processed: WatchProcessedEventEntity,
        setId: String,
        runtime: ActiveWorkoutRuntimeEntity,
    ): Boolean
    suspend fun applySensorBatch(
        processed: WatchProcessedEventEntity,
        batch: WatchSensorBatchEntity,
        samples: List<WatchSensorSampleEntity>,
        runtime: ActiveWorkoutRuntimeEntity,
    ): Boolean
    suspend fun applyRestEvent(
        processed: WatchProcessedEventEntity,
        runtime: ActiveWorkoutRuntimeEntity,
        summary: RestRecoverySummaryEntity?,
    ): Boolean
    suspend fun sensorSamplesForSet(
        sessionId: String,
        setId: String,
        phase: String,
    ): List<WatchSensorSampleEntity>
    suspend fun sensorSamplesForInterval(
        sessionId: String,
        setId: String,
        phase: String,
        startedAtEpochMs: Long,
        endedAtEpochMs: Long,
    ): List<WatchSensorSampleEntity>
    suspend fun restSummaries(sessionId: String): List<RestRecoverySummaryEntity>
    suspend fun updateSetHeartRateSummary(
        setId: String,
        minHr: Int?,
        maxHr: Int?,
        avgHr: Int?,
        startHr: Int?,
        endHr: Int?,
        sampleCount: Int,
    ): Boolean
    suspend fun saveRestSummary(summary: RestRecoverySummaryEntity)
}

class GymCoachWatchWorkoutRepository(
    private val repository: GymCoachRepository,
) : WatchWorkoutRepository {
    override suspend fun bootstrap() = repository.cachedBootstrapSnapshot()
    override suspend fun session(sessionId: String) = repository.localSession(sessionId)
    override suspend fun sets(sessionId: String) = repository.localSets(sessionId)
    override suspend fun set(setId: String) = repository.localSet(setId)
    override suspend fun runtime(sessionId: String) = repository.activeWorkoutRuntime(sessionId)
    override suspend fun hasProcessedEvent(eventId: String) = repository.hasProcessedWatchEvent(eventId)
    override suspend fun hasSensorBatch(batchId: String, sequence: Int) =
        repository.hasWatchSensorBatch(batchId, sequence)
    override suspend fun saveRuntime(runtime: ActiveWorkoutRuntimeEntity) =
        repository.saveActiveWorkoutRuntime(runtime)

    override suspend fun updateActiveExercise(
        sessionId: String,
        exerciseId: String,
        updatedBy: String,
        updatedAtEpochMs: Long,
    ) = repository.updateActiveExercise(sessionId, exerciseId, updatedBy, updatedAtEpochMs)

    override suspend fun applyRuntimeEvent(
        processed: WatchProcessedEventEntity,
        runtime: ActiveWorkoutRuntimeEntity,
    ) = repository.applyWatchRuntimeEvent(processed, runtime)

    override suspend fun applySetEvent(
        processed: WatchProcessedEventEntity,
        set: LocalSetEntity,
        runtime: ActiveWorkoutRuntimeEntity,
    ) = repository.applyWatchSetEvent(processed, set, runtime)

    override suspend fun applyDeleteSetEvent(
        processed: WatchProcessedEventEntity,
        setId: String,
        runtime: ActiveWorkoutRuntimeEntity,
    ) = repository.applyWatchDeleteSetEvent(processed, setId, runtime)

    override suspend fun applySensorBatch(
        processed: WatchProcessedEventEntity,
        batch: WatchSensorBatchEntity,
        samples: List<WatchSensorSampleEntity>,
        runtime: ActiveWorkoutRuntimeEntity,
    ) = repository.applyWatchSensorBatch(processed, batch, samples, runtime)

    override suspend fun applyRestEvent(
        processed: WatchProcessedEventEntity,
        runtime: ActiveWorkoutRuntimeEntity,
        summary: RestRecoverySummaryEntity?,
    ) = repository.applyWatchRestEvent(processed, runtime, summary)

    override suspend fun sensorSamplesForSet(sessionId: String, setId: String, phase: String) =
        repository.watchSensorSamplesForSet(sessionId, setId, phase)

    override suspend fun sensorSamplesForInterval(
        sessionId: String,
        setId: String,
        phase: String,
        startedAtEpochMs: Long,
        endedAtEpochMs: Long,
    ) = repository.watchSensorSamplesForInterval(
        sessionId,
        setId,
        phase,
        startedAtEpochMs,
        endedAtEpochMs,
    )

    override suspend fun restSummaries(sessionId: String) = repository.restRecoverySummaries(sessionId)

    override suspend fun updateSetHeartRateSummary(
        setId: String,
        minHr: Int?,
        maxHr: Int?,
        avgHr: Int?,
        startHr: Int?,
        endHr: Int?,
        sampleCount: Int,
    ) = repository.updateSetHeartRateSummary(
        setId,
        minHr,
        maxHr,
        avgHr,
        startHr,
        endHr,
        sampleCount,
    )

    override suspend fun saveRestSummary(summary: RestRecoverySummaryEntity) =
        repository.saveRestRecoverySummary(summary)
}

interface WatchWorkoutGateway {
    suspend fun buildSnapshot(sessionId: String): WatchSyncSnapshotDto?
    suspend fun applyWatchEvent(event: WatchEventEnvelopeDto): WatchWorkoutApplyResult
    suspend fun applySensorBatch(
        event: WatchEventEnvelopeDto,
        batch: WatchSensorBatchDto,
    ): WatchWorkoutApplyResult
    suspend fun changeActiveExerciseFromPhone(sessionId: String, exerciseId: String): PhoneExerciseChange?
}

class PersistentWatchWorkoutGateway(
    private val repository: WatchWorkoutRepository,
    private val phoneDeviceId: String,
    private val codec: WatchWorkoutProtocolCodec = WatchWorkoutProtocolCodec(),
    private val nowEpochMs: () -> Long = System::currentTimeMillis,
    private val newUuid: () -> String = { UUID.randomUUID().toString() },
) : WatchWorkoutGateway {
    override suspend fun buildSnapshot(sessionId: String): WatchSyncSnapshotDto? {
        val context = loadContext(sessionId) ?: return null
        val runtime = normalizeRuntime(context)
        val exerciseSessions = context.workout.exercises
            .sortedBy { it.order }
            .map { target -> target.toWatchExerciseSession(context.session.id, runtime.activeExerciseId) }
        val exerciseSessionByExerciseId = context.workout.exercises.associateBy { it.exerciseId }
        val setRecords = repository.sets(sessionId)
            .filterNot { it.deleted }
            .mapNotNull { set ->
                val target = exerciseSessionByExerciseId[set.exerciseId] ?: return@mapNotNull null
                set.toWatchSetRecord(target, runtime.revision)
            }
        val timestamp = nowEpochMs()
        return WatchSyncSnapshotDto(
            protocolVersion = WatchProtocol.VERSION,
            schemaVersion = WatchProtocol.SCHEMA_VERSION,
            snapshotId = newUuid(),
            sessionId = context.session.id,
            timestamp = timestamp,
            source = WatchEventSource.PHONE,
            deviceId = phoneDeviceId,
            revision = runtime.revision,
            workoutSession = WatchWorkoutSessionDto(
                sessionId = context.session.id,
                workoutProgramId = context.workout.id,
                userId = context.bootstrap.profile.id,
                status = runtime.status.toWorkoutStatus(),
                startedAt = Instant.parse(context.session.startedAt).toEpochMilli(),
                finishedAt = context.session.finishedAt?.let { Instant.parse(it).toEpochMilli() },
                activeExerciseId = runtime.activeExerciseId,
                activeSetId = runtime.activeSetId,
                revision = runtime.revision,
                updatedAt = runtime.updatedAtEpochMs,
                updatedBy = runtime.updatedBy.toEventSource(),
            ),
            runtimeState = WatchActiveWorkoutRuntimeDto(
                sessionId = runtime.sessionId,
                status = runtime.status.toWorkoutStatus(),
                activeExerciseId = runtime.activeExerciseId,
                activeSetId = runtime.activeSetId,
                setStartedAt = runtime.setStartedAtEpochMs,
                pausedAt = runtime.pausedAtEpochMs,
                workoutAccumulatedPauseMs = 0,
                setAccumulatedPauseMs = 0,
                rest = if (
                    runtime.activeSetId != null &&
                    runtime.restStartedAtEpochMs != null &&
                    runtime.restEndsAtEpochMs != null
                ) {
                    WatchRestRuntimeDto(
                        setId = runtime.activeSetId,
                        startedAt = runtime.restStartedAtEpochMs,
                        endsAt = runtime.restEndsAtEpochMs,
                        pausedRemainingMs = null,
                    )
                } else {
                    null
                },
                revision = runtime.revision,
                updatedAt = runtime.updatedAtEpochMs,
                updatedBy = runtime.updatedBy.toEventSource(),
            ),
            exerciseSessions = exerciseSessions,
            setRecords = setRecords,
            sensorSamples = emptyList(),
            pendingEvents = emptyList(),
        ).also { codec.decodeSyncSnapshot(codec.encodeSyncSnapshot(it)) }
    }

    override suspend fun applyWatchEvent(event: WatchEventEnvelopeDto): WatchWorkoutApplyResult {
        if (event.source != WatchEventSource.WATCH) return rejected(event, "INVALID_SOURCE")
        val context = loadContext(event.sessionId) ?: return rejected(event, "SESSION_NOT_FOUND")
        val current = normalizeRuntime(context)
        if (repository.hasProcessedEvent(event.eventId)) {
            return WatchWorkoutApplyResult(WatchSyncAckStatus.DUPLICATE, current.revision)
        }
        if (event.revision <= current.revision) {
            return WatchWorkoutApplyResult(WatchSyncAckStatus.STALE, current.revision, "STALE_REVISION")
        }
        if (event.revision > current.revision + 1) {
            return WatchWorkoutApplyResult(WatchSyncAckStatus.REJECTED, current.revision, "SYNC_REQUIRED")
        }
        val nextRevision = event.revision
        val processed = WatchProcessedEventEntity(
            eventId = event.eventId,
            sessionId = event.sessionId,
            revision = event.revision,
            processedAtEpochMs = nowEpochMs(),
        )
        return when (event.type) {
            WatchEventType.ACTIVE_EXERCISE_CHANGED -> {
                val payload = codec.decodeActiveExerciseChangedPayload(event.payload)
                val target = context.workout.exercises.findPayloadTarget(payload)
                    ?: return rejected(event, "EXERCISE_NOT_FOUND")
                val updated = current.changeExercise(target.exerciseId, nextRevision, event.timestamp)
                appliedResult(repository.applyRuntimeEvent(processed, updated), updated.revision)
            }
            WatchEventType.SET_STARTED -> {
                val payload = codec.decodeSetStartedPayload(event.payload)
                val target = context.workout.exercises.firstOrNull { it.id == payload.exerciseSessionId }
                    ?: return rejected(event, "EXERCISE_NOT_FOUND")
                val updated = current.copy(
                    activeExerciseId = target.exerciseId,
                    activeSetId = payload.setId,
                    setStartedAtEpochMs = payload.startedAt,
                    revision = nextRevision,
                    updatedAtEpochMs = event.timestamp,
                    updatedBy = WatchEventSource.WATCH.name,
                )
                appliedResult(repository.applyRuntimeEvent(processed, updated), updated.revision)
            }
            WatchEventType.SET_COMPLETED,
            WatchEventType.SET_UPDATED,
            -> applySetRecord(event, context, current, processed, nextRevision)
            WatchEventType.SET_DELETED -> {
                val payload = codec.decodeSetDeletedPayload(event.payload)
                if (payload.baseRevision != current.revision) {
                    return WatchWorkoutApplyResult(
                        WatchSyncAckStatus.STALE,
                        current.revision,
                        "STALE_BASE_REVISION",
                    )
                }
                val existing = repository.set(payload.setId)
                    ?.takeIf { it.sessionId == event.sessionId }
                    ?: return rejected(event, "SET_NOT_FOUND")
                val clearsActiveSet = current.activeSetId == existing.id
                val updated = current.copy(
                    activeSetId = current.activeSetId?.takeUnless { clearsActiveSet },
                    setStartedAtEpochMs = if (clearsActiveSet) null else current.setStartedAtEpochMs,
                    restStartedAtEpochMs = if (clearsActiveSet) null else current.restStartedAtEpochMs,
                    restEndsAtEpochMs = if (clearsActiveSet) null else current.restEndsAtEpochMs,
                    restDurationSeconds = if (clearsActiveSet) null else current.restDurationSeconds,
                    revision = nextRevision,
                    updatedAtEpochMs = event.timestamp,
                    updatedBy = WatchEventSource.WATCH.name,
                )
                appliedResult(
                    repository.applyDeleteSetEvent(processed, existing.id, updated),
                    updated.revision,
                )
            }
            WatchEventType.REST_STARTED -> applyRestStarted(
                event,
                current,
                processed,
                codec.decodeRestStartedPayload(event.payload),
            )
            WatchEventType.REST_UPDATED -> applyRestUpdated(
                event,
                current,
                processed,
                codec.decodeRestUpdatedPayload(event.payload),
            )
            WatchEventType.REST_FINISHED -> applyRestFinished(
                event,
                current,
                processed,
                codec.decodeRestFinishedPayload(event.payload),
            )
            WatchEventType.REST_SKIPPED -> applyRestSkipped(
                event,
                current,
                processed,
                codec.decodeRestSkippedPayload(event.payload),
            )
            WatchEventType.SENSOR_BATCH_RECORDED -> rejected(event, "BATCH_PAYLOAD_REQUIRED")
            else -> rejected(event, "UNSUPPORTED_EVENT")
        }
    }

    override suspend fun applySensorBatch(
        event: WatchEventEnvelopeDto,
        batch: WatchSensorBatchDto,
    ): WatchWorkoutApplyResult {
        if (event.type != WatchEventType.SENSOR_BATCH_RECORDED) {
            return rejected(event, "INVALID_EVENT_TYPE")
        }
        if (event.source != WatchEventSource.WATCH || batch.source != WatchEventSource.WATCH) {
            return rejected(event, "INVALID_SOURCE")
        }
        val payload = codec.decodeSensorBatchRecordedPayload(event.payload)
        val encodedBatch = codec.encodeSensorBatch(batch)
        if (
            batch.sessionId != event.sessionId ||
            batch.deviceId != event.deviceId ||
            payload.batchId != batch.batchId ||
            payload.sequence != batch.sequence ||
            payload.totalSequences != batch.totalSequences ||
            payload.sampleCount != batch.sampleCount ||
            (payload.deliveryMode == WatchDeliveryMode.P2P &&
                encodedBatch.size > WatchProtocol.MAX_P2P_MESSAGE_BYTES)
        ) {
            return rejected(event, "BATCH_MISMATCH")
        }
        val context = loadContext(event.sessionId) ?: return rejected(event, "SESSION_NOT_FOUND")
        val current = normalizeRuntime(context)
        if (
            repository.hasProcessedEvent(event.eventId) ||
            repository.hasSensorBatch(batch.batchId, batch.sequence)
        ) {
            return WatchWorkoutApplyResult(WatchSyncAckStatus.DUPLICATE, current.revision)
        }
        if (event.revision <= current.revision) {
            return WatchWorkoutApplyResult(WatchSyncAckStatus.STALE, current.revision, "STALE_REVISION")
        }
        if (event.revision > current.revision + 1) {
            return WatchWorkoutApplyResult(WatchSyncAckStatus.REJECTED, current.revision, "SYNC_REQUIRED")
        }
        val processed = WatchProcessedEventEntity(
            eventId = event.eventId,
            sessionId = event.sessionId,
            revision = event.revision,
            processedAtEpochMs = nowEpochMs(),
        )
        val updated = current.copy(
            revision = event.revision,
            updatedAtEpochMs = event.timestamp,
            updatedBy = WatchEventSource.WATCH.name,
        )
        val applied = repository.applySensorBatch(
            processed = processed,
            batch = batch.toEntity(nowEpochMs()),
            samples = batch.samples.map { it.toEntity(batch) },
            runtime = updated,
        )
        if (!applied) return WatchWorkoutApplyResult(WatchSyncAckStatus.DUPLICATE, current.revision)
        refreshHeartRateSummaries(batch)
        return WatchWorkoutApplyResult(WatchSyncAckStatus.APPLIED, updated.revision)
    }

    override suspend fun changeActiveExerciseFromPhone(
        sessionId: String,
        exerciseId: String,
    ): PhoneExerciseChange? {
        val context = loadContext(sessionId) ?: return null
        normalizeRuntime(context)
        val target = context.workout.exercises.firstOrNull { it.exerciseId == exerciseId } ?: return null
        val updatedAt = nowEpochMs()
        val runtime = repository.updateActiveExercise(
            sessionId = sessionId,
            exerciseId = exerciseId,
            updatedBy = WatchEventSource.PHONE.name,
            updatedAtEpochMs = updatedAt,
        ) ?: return null
        return PhoneExerciseChange(
            payload = ActiveExerciseChangedPayloadDto(
                exerciseId = target.exerciseId,
                exerciseSessionId = target.id,
                order = target.order,
            ),
            revision = runtime.revision,
            updatedAtEpochMs = updatedAt,
        )
    }

    private suspend fun applySetRecord(
        event: WatchEventEnvelopeDto,
        context: WorkoutContext,
        current: ActiveWorkoutRuntimeEntity,
        processed: WatchProcessedEventEntity,
        nextRevision: Long,
    ): WatchWorkoutApplyResult {
        val record = codec.decodeSetRecordPayload(event.payload)
        if (
            record.sessionId != event.sessionId ||
            record.source != WatchEventSource.WATCH ||
            record.weight !in 0.0..500.0 ||
            record.reps !in 1..100 ||
            record.rir == null ||
            record.rir !in 0..5 ||
            record.startedAt > record.completedAt
        ) return rejected(event, "INVALID_SET")
        val target = context.workout.exercises.firstOrNull { it.id == record.exerciseSessionId }
            ?: return rejected(event, "EXERCISE_NOT_FOUND")
        val existing = repository.set(record.setId)
        if (existing != null && (existing.sessionId != record.sessionId || existing.exerciseId != target.exerciseId)) {
            return rejected(event, "SET_ID_CONFLICT")
        }
        val set = record.toLocalSet(target.exerciseId)
        val updated = if (event.type == WatchEventType.SET_COMPLETED) {
            current.copy(
                activeExerciseId = target.exerciseId,
                activeSetId = null,
                setStartedAtEpochMs = null,
                revision = nextRevision,
                updatedAtEpochMs = event.timestamp,
                updatedBy = WatchEventSource.WATCH.name,
            )
        } else {
            current.copy(
                revision = nextRevision,
                updatedAtEpochMs = event.timestamp,
                updatedBy = WatchEventSource.WATCH.name,
            )
        }
        val result = appliedResult(repository.applySetEvent(processed, set, updated), updated.revision)
        if (result.status == WatchSyncAckStatus.APPLIED) refreshSetHeartRateSummary(record.setId)
        return result
    }

    private suspend fun applyRestStarted(
        event: WatchEventEnvelopeDto,
        current: ActiveWorkoutRuntimeEntity,
        processed: WatchProcessedEventEntity,
        payload: RestStartedPayloadDto,
    ): WatchWorkoutApplyResult {
        val set = repository.set(payload.setId)
            ?.takeIf { it.sessionId == event.sessionId && !it.deleted }
            ?: return rejected(event, "SET_NOT_FOUND")
        val updated = current.copy(
            activeExerciseId = set.exerciseId,
            activeSetId = set.id,
            setStartedAtEpochMs = null,
            restStartedAtEpochMs = payload.startedAt,
            restEndsAtEpochMs = payload.restEndsAt,
            restDurationSeconds = durationSeconds(payload.startedAt, payload.restEndsAt),
            revision = event.revision,
            updatedAtEpochMs = event.timestamp,
            updatedBy = WatchEventSource.WATCH.name,
        )
        return appliedResult(repository.applyRestEvent(processed, updated, null), updated.revision)
    }

    private suspend fun applyRestUpdated(
        event: WatchEventEnvelopeDto,
        current: ActiveWorkoutRuntimeEntity,
        processed: WatchProcessedEventEntity,
        payload: RestUpdatedPayloadDto,
    ): WatchWorkoutApplyResult {
        val startedAt = current.restStartedAtEpochMs ?: return rejected(event, "REST_NOT_ACTIVE")
        if (current.activeSetId == null || payload.restEndsAt < startedAt) {
            return rejected(event, "INVALID_REST")
        }
        val updated = current.copy(
            restEndsAtEpochMs = payload.restEndsAt,
            restDurationSeconds = durationSeconds(startedAt, payload.restEndsAt),
            revision = event.revision,
            updatedAtEpochMs = event.timestamp,
            updatedBy = WatchEventSource.WATCH.name,
        )
        return appliedResult(repository.applyRestEvent(processed, updated, null), updated.revision)
    }

    private suspend fun applyRestFinished(
        event: WatchEventEnvelopeDto,
        current: ActiveWorkoutRuntimeEntity,
        processed: WatchProcessedEventEntity,
        payload: RestFinishedPayloadDto,
    ): WatchWorkoutApplyResult {
        val startedAt = current.restStartedAtEpochMs ?: return rejected(event, "REST_NOT_ACTIVE")
        val setId = current.activeSetId ?: return rejected(event, "REST_SET_NOT_FOUND")
        if (payload.finishedAt < startedAt || payload.summary.startedAt != startedAt) {
            return rejected(event, "INVALID_REST")
        }
        val samples = repository.sensorSamplesForInterval(
            event.sessionId,
            setId,
            WatchWorkoutPhase.REST.name,
            startedAt,
            payload.finishedAt,
        )
        val calculated = if (samples.isEmpty()) {
            payload.summary
        } else {
            HeartRateSummaryCalculator.restSummary(
                samples.map(WatchSensorSampleEntity::toHeartRateObservation),
                startedAt,
                payload.finishedAt,
            )
        }
        val summary = calculated.toEntity(
            sessionId = event.sessionId,
            setId = setId,
            skipped = false,
            updatedAtEpochMs = event.timestamp,
        )
        val updated = current.finishRest(event)
        return appliedResult(repository.applyRestEvent(processed, updated, summary), updated.revision)
    }

    private suspend fun applyRestSkipped(
        event: WatchEventEnvelopeDto,
        current: ActiveWorkoutRuntimeEntity,
        processed: WatchProcessedEventEntity,
        payload: RestSkippedPayloadDto,
    ): WatchWorkoutApplyResult {
        val startedAt = current.restStartedAtEpochMs ?: return rejected(event, "REST_NOT_ACTIVE")
        val setId = current.activeSetId ?: return rejected(event, "REST_SET_NOT_FOUND")
        if (payload.skippedAt < startedAt) return rejected(event, "INVALID_REST")
        val samples = repository.sensorSamplesForInterval(
            event.sessionId,
            setId,
            WatchWorkoutPhase.REST.name,
            startedAt,
            payload.skippedAt,
        )
        val summary = HeartRateSummaryCalculator.restSummary(
            samples.map(WatchSensorSampleEntity::toHeartRateObservation),
            startedAt,
            payload.skippedAt,
        ).toEntity(
            sessionId = event.sessionId,
            setId = setId,
            skipped = true,
            updatedAtEpochMs = event.timestamp,
        )
        val updated = current.finishRest(event)
        return appliedResult(repository.applyRestEvent(processed, updated, summary), updated.revision)
    }

    private suspend fun refreshHeartRateSummaries(batch: WatchSensorBatchDto) {
        val setIds = batch.samples
            .asSequence()
            .filter { it.sensorType == "HEART_RATE" }
            .mapNotNullTo(linkedSetOf()) { it.setId }
        setIds.forEach { refreshSetHeartRateSummary(it) }
        repository.restSummaries(batch.sessionId)
            .filter { it.setId in setIds }
            .forEach { existing ->
                val samples = repository.sensorSamplesForInterval(
                    existing.sessionId,
                    existing.setId,
                    WatchWorkoutPhase.REST.name,
                    existing.restStartedAtEpochMs,
                    existing.restEndedAtEpochMs,
                )
                val recalculated = HeartRateSummaryCalculator.restSummary(
                    samples.map(WatchSensorSampleEntity::toHeartRateObservation),
                    existing.restStartedAtEpochMs,
                    existing.restEndedAtEpochMs,
                )
                if (recalculated.sampleCount == 0) return@forEach
                repository.saveRestSummary(
                    recalculated.toEntity(
                        sessionId = existing.sessionId,
                        setId = existing.setId,
                        skipped = existing.skipped,
                        updatedAtEpochMs = nowEpochMs(),
                    ),
                )
            }
    }

    private suspend fun refreshSetHeartRateSummary(setId: String) {
        val set = repository.set(setId) ?: return
        val startedAt = set.startedAt?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }
            ?: return
        val finishedAt = runCatching { Instant.parse(set.completedAt).toEpochMilli() }.getOrNull() ?: return
        val samples = repository.sensorSamplesForSet(
            set.sessionId,
            set.id,
            WatchWorkoutPhase.SET.name,
        )
        if (samples.isEmpty()) return
        val summary = HeartRateSummaryCalculator.setSummary(
            samples.map(WatchSensorSampleEntity::toHeartRateObservation),
            startedAt,
            finishedAt,
        )
        if (summary.sampleCount == 0) return
        repository.updateSetHeartRateSummary(
            setId = set.id,
            minHr = summary.min?.roundToInt(),
            maxHr = summary.max?.roundToInt(),
            avgHr = summary.average?.roundToInt(),
            startHr = summary.start?.roundToInt(),
            endHr = summary.end?.roundToInt(),
            sampleCount = summary.sampleCount,
        )
    }

    private suspend fun loadContext(sessionId: String): WorkoutContext? {
        val session = repository.session(sessionId)?.takeIf { it.finishedAt == null } ?: return null
        val bootstrap = repository.bootstrap() ?: return null
        val workout = bootstrap.activeProgram?.workouts?.firstOrNull { it.id == session.workoutId }
            ?: bootstrap.openSessions.firstOrNull { it.id == sessionId }?.workout
            ?: return null
        if (workout.exercises.isEmpty()) return null
        return WorkoutContext(session, bootstrap, workout, repository.runtime(sessionId))
    }

    private suspend fun normalizeRuntime(context: WorkoutContext): ActiveWorkoutRuntimeEntity {
        val firstExerciseId = context.workout.exercises.minByOrNull { it.order }?.exerciseId
        val validIds = context.workout.exercises.mapTo(mutableSetOf()) { it.exerciseId }
        val existing = context.runtime
        val normalized = when {
            existing == null -> ActiveWorkoutRuntimeEntity(
                sessionId = context.session.id,
                workoutId = context.workout.id,
                activeExerciseId = firstExerciseId,
                revision = 1,
                updatedAtEpochMs = nowEpochMs(),
                updatedBy = WatchEventSource.PHONE.name,
            )
            existing.activeExerciseId !in validIds -> existing.copy(
                activeExerciseId = firstExerciseId,
                revision = existing.revision + 1,
                updatedAtEpochMs = nowEpochMs(),
                updatedBy = WatchEventSource.PHONE.name,
            )
            else -> existing
        }
        if (normalized != existing) repository.saveRuntime(normalized)
        return normalized
    }

    private fun appliedResult(applied: Boolean, revision: Long) = WatchWorkoutApplyResult(
        status = if (applied) WatchSyncAckStatus.APPLIED else WatchSyncAckStatus.DUPLICATE,
        revision = revision,
    )

    private fun rejected(event: WatchEventEnvelopeDto, errorCode: String) = WatchWorkoutApplyResult(
        status = WatchSyncAckStatus.REJECTED,
        revision = event.revision,
        errorCode = errorCode,
    )

    private data class WorkoutContext(
        val session: LocalSessionEntity,
        val bootstrap: BootstrapResponse,
        val workout: WorkoutDto,
        val runtime: ActiveWorkoutRuntimeEntity?,
    )
}

private fun ProgramExerciseDto.toWatchExerciseSession(
    sessionId: String,
    activeExerciseId: String?,
) = WatchExerciseSessionDto(
    exerciseSessionId = id,
    sessionId = sessionId,
    exerciseId = exerciseId,
    exerciseName = exercise.name,
    order = order,
    status = if (exerciseId == activeExerciseId) WatchExerciseStatus.ACTIVE else WatchExerciseStatus.PENDING,
    targetSets = targetSets,
    targetReps = targetRepsMin,
    targetRir = targetRIR,
    restDurationSeconds = restSec,
)

private fun List<ProgramExerciseDto>.findPayloadTarget(
    payload: ActiveExerciseChangedPayloadDto,
) = firstOrNull {
    it.exerciseId == payload.exerciseId && it.id == payload.exerciseSessionId && it.order == payload.order
}

private fun ActiveWorkoutRuntimeEntity.changeExercise(
    exerciseId: String,
    nextRevision: Long,
    updatedAt: Long,
) = copy(
    activeExerciseId = exerciseId,
    activeSetId = null,
    setStartedAtEpochMs = null,
    restStartedAtEpochMs = null,
    restEndsAtEpochMs = null,
    restDurationSeconds = null,
    revision = nextRevision,
    updatedAtEpochMs = updatedAt,
    updatedBy = WatchEventSource.WATCH.name,
)

private fun ActiveWorkoutRuntimeEntity.finishRest(
    event: WatchEventEnvelopeDto,
) = copy(
    activeSetId = null,
    restStartedAtEpochMs = null,
    restEndsAtEpochMs = null,
    restDurationSeconds = null,
    revision = event.revision,
    updatedAtEpochMs = event.timestamp,
    updatedBy = WatchEventSource.WATCH.name,
)

private fun durationSeconds(startedAtEpochMs: Long, endedAtEpochMs: Long): Int =
    ((endedAtEpochMs - startedAtEpochMs) / 1_000L).coerceIn(0, Int.MAX_VALUE.toLong()).toInt()

private fun LocalSetEntity.toWatchSetRecord(
    target: ProgramExerciseDto,
    snapshotRevision: Long,
): WatchSetRecordDto {
    val completedAtEpochMs = Instant.parse(completedAt).toEpochMilli()
    val startedAtEpochMs = startedAt?.let { Instant.parse(it).toEpochMilli() }
        ?: durationSec?.let { completedAtEpochMs - it * 1_000L }
        ?: completedAtEpochMs
    return WatchSetRecordDto(
        setId = id,
        sessionId = sessionId,
        exerciseSessionId = exerciseSessionId ?: target.id,
        setNumber = setNumber,
        weight = weight,
        reps = reps,
        rir = rir,
        setType = when {
            isWarmup -> "WARMUP"
            isDropSet -> "DROP_SET"
            else -> "WORKING"
        },
        comment = notes,
        startedAt = startedAtEpochMs,
        completedAt = completedAtEpochMs,
        source = source?.toEventSource() ?: WatchEventSource.PHONE,
        heartRateSummary = WatchHeartRateSummaryDto(
            min = minHr?.toDouble(),
            max = maxHr?.toDouble(),
            average = avgHr?.toDouble(),
            start = startHr?.toDouble(),
            end = endHr?.toDouble(),
            sampleCount = hrSampleCount ?: 0,
        ),
        sensorSummary = kotlinx.serialization.json.buildJsonObject {},
        revision = (watchRevision ?: snapshotRevision).coerceAtMost(snapshotRevision),
    )
}

private fun WatchSetRecordDto.toLocalSet(exerciseId: String) = LocalSetEntity(
    id = setId,
    sessionId = sessionId,
    exerciseId = exerciseId,
    setNumber = setNumber,
    weight = weight,
    reps = reps,
    rir = requireNotNull(rir),
    durationSec = ((completedAt - startedAt) / 1_000L).coerceIn(0, Int.MAX_VALUE.toLong()).toInt(),
    avgHr = heartRateSummary.average?.roundToInt(),
    maxHr = heartRateSummary.max?.roundToInt(),
    minHr = heartRateSummary.min?.roundToInt(),
    startHr = heartRateSummary.start?.roundToInt(),
    endHr = heartRateSummary.end?.roundToInt(),
    hrSampleCount = heartRateSummary.sampleCount,
    notes = comment,
    isWarmup = setType == "WARMUP",
    isDropSet = setType == "DROP_SET",
    completedAt = Instant.ofEpochMilli(completedAt).toString(),
    deleted = false,
    exerciseSessionId = exerciseSessionId,
    startedAt = Instant.ofEpochMilli(startedAt).toString(),
    source = source.name,
    watchRevision = revision,
)

private fun WatchSensorBatchDto.toEntity(receivedAtEpochMs: Long) = WatchSensorBatchEntity(
    batchId = batchId,
    sessionId = sessionId,
    source = source.name,
    deviceId = deviceId,
    createdAtEpochMs = createdAt,
    sequence = sequence,
    totalSequences = totalSequences,
    sampleCount = sampleCount,
    receivedAtEpochMs = receivedAtEpochMs,
)

private fun WatchSensorSampleDto.toEntity(batch: WatchSensorBatchDto): WatchSensorSampleEntity {
    val primitive = value as kotlinx.serialization.json.JsonPrimitive
    val numericValue = if (!primitive.isString) primitive.doubleOrNull else null
    val booleanValue = if (!primitive.isString && numericValue == null) primitive.booleanOrNull else null
    val textValue = if (primitive.isString) primitive.content else null
    return WatchSensorSampleEntity(
        sampleId = sampleId,
        batchId = batch.batchId,
        batchSequence = batch.sequence,
        sessionId = sessionId,
        exerciseSessionId = exerciseSessionId,
        setId = setId,
        phase = phase.name,
        sensorType = sensorType,
        numericValue = numericValue,
        textValue = textValue,
        booleanValue = booleanValue,
        unit = unit,
        timestampEpochMs = timestamp,
        source = source.name,
        valid = valid,
        quality = quality,
    )
}

private fun WatchSensorSampleEntity.toHeartRateObservation() = HeartRateObservation(
    sampleId = sampleId,
    timestampEpochMs = timestampEpochMs,
    sensorType = sensorType,
    value = numericValue,
    valid = valid,
)

private fun RestHeartRateSummaryDto.toEntity(
    sessionId: String,
    setId: String,
    skipped: Boolean,
    updatedAtEpochMs: Long,
) = RestRecoverySummaryEntity(
    restId = UUID.nameUUIDFromBytes(
        "${sessionId.length}:$sessionId${setId.length}:$setId:$startedAt".encodeToByteArray(),
    ).toString(),
    sessionId = sessionId,
    setId = setId,
    restStartedAtEpochMs = startedAt,
    restEndedAtEpochMs = finishedAt,
    startHr = start,
    minHr = min,
    avgHr = average,
    hr30 = at30Seconds,
    hr60 = at60Seconds,
    drop30 = drop30Seconds,
    drop60 = drop60Seconds,
    hrSampleCount = sampleCount,
    skipped = skipped,
    updatedAtEpochMs = updatedAtEpochMs,
)

private fun String.toEventSource() = WatchEventSource.entries.firstOrNull { it.name == this }
    ?: WatchEventSource.PHONE

private fun String.toWorkoutStatus() = WatchWorkoutStatus.entries.firstOrNull { it.name == this }
    ?: WatchWorkoutStatus.ACTIVE
