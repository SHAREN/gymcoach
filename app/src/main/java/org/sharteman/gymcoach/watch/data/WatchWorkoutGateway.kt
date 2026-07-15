package org.sharteman.gymcoach.watch.data

import java.time.Instant
import java.util.UUID
import kotlin.math.roundToInt
import org.sharteman.gymcoach.data.local.ActiveWorkoutRuntimeEntity
import org.sharteman.gymcoach.data.local.LocalSessionEntity
import org.sharteman.gymcoach.data.local.LocalSetEntity
import org.sharteman.gymcoach.data.local.WatchProcessedEventEntity
import org.sharteman.gymcoach.data.model.BootstrapResponse
import org.sharteman.gymcoach.data.model.ProgramExerciseDto
import org.sharteman.gymcoach.data.model.WorkoutDto
import org.sharteman.gymcoach.data.repository.GymCoachRepository
import org.sharteman.gymcoach.watch.domain.ActiveExerciseChangedPayloadDto
import org.sharteman.gymcoach.watch.domain.SetStartedPayloadDto
import org.sharteman.gymcoach.watch.domain.WatchEventEnvelopeDto
import org.sharteman.gymcoach.watch.domain.WatchEventSource
import org.sharteman.gymcoach.watch.domain.WatchEventType
import org.sharteman.gymcoach.watch.domain.WatchExerciseSessionDto
import org.sharteman.gymcoach.watch.domain.WatchExerciseStatus
import org.sharteman.gymcoach.watch.domain.WatchHeartRateSummaryDto
import org.sharteman.gymcoach.watch.domain.WatchProtocol
import org.sharteman.gymcoach.watch.domain.WatchSetRecordDto
import org.sharteman.gymcoach.watch.domain.WatchSyncAckStatus
import org.sharteman.gymcoach.watch.domain.WatchSyncSnapshotDto
import org.sharteman.gymcoach.watch.domain.WatchWorkoutSessionDto
import org.sharteman.gymcoach.watch.domain.WatchWorkoutStatus

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
}

interface WatchWorkoutGateway {
    suspend fun buildSnapshot(sessionId: String): WatchSyncSnapshotDto?
    suspend fun applyWatchEvent(event: WatchEventEnvelopeDto): WatchWorkoutApplyResult
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
                val updated = current.copy(
                    activeSetId = current.activeSetId?.takeUnless { it == existing.id },
                    setStartedAtEpochMs = if (current.activeSetId == existing.id) null else current.setStartedAtEpochMs,
                    revision = nextRevision,
                    updatedAtEpochMs = event.timestamp,
                    updatedBy = WatchEventSource.WATCH.name,
                )
                appliedResult(
                    repository.applyDeleteSetEvent(processed, existing.id, updated),
                    updated.revision,
                )
            }
            else -> rejected(event, "UNSUPPORTED_EVENT")
        }
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
        val updated = current.copy(
            activeExerciseId = target.exerciseId,
            activeSetId = null,
            setStartedAtEpochMs = null,
            revision = nextRevision,
            updatedAtEpochMs = event.timestamp,
            updatedBy = WatchEventSource.WATCH.name,
        )
        return appliedResult(repository.applySetEvent(processed, set, updated), updated.revision)
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
            min = null,
            max = maxHr?.toDouble(),
            average = avgHr?.toDouble(),
            start = null,
            end = null,
            sampleCount = 0,
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

private fun String.toEventSource() = WatchEventSource.entries.firstOrNull { it.name == this }
    ?: WatchEventSource.PHONE

private fun String.toWorkoutStatus() = WatchWorkoutStatus.entries.firstOrNull { it.name == this }
    ?: WatchWorkoutStatus.ACTIVE
