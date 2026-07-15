package org.sharteman.gymcoach.watch.simulator

import java.util.UUID
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.sharteman.gymcoach.watch.data.WatchWorkoutProtocolCodec
import org.sharteman.gymcoach.watch.domain.ActiveExerciseChangedPayloadDto
import org.sharteman.gymcoach.watch.domain.WatchEventEnvelopeDto
import org.sharteman.gymcoach.watch.domain.WatchEventSource
import org.sharteman.gymcoach.watch.domain.WatchEventType
import org.sharteman.gymcoach.watch.domain.WatchHeartRateSummaryDto
import org.sharteman.gymcoach.watch.domain.WatchProtocol
import org.sharteman.gymcoach.watch.domain.WatchSetRecordDto
import org.sharteman.gymcoach.watch.domain.WatchSyncAckDto
import org.sharteman.gymcoach.watch.domain.WatchSyncSnapshotDto
import org.sharteman.gymcoach.watch.sync.WatchWorkoutResponseSink

data class DebugWatchWorkoutDiagnostics(
    val hasSnapshot: Boolean = false,
    val activeExerciseId: String? = null,
    val completedSetCount: Int = 0,
    val ackCount: Int = 0,
    val lastAckStatus: String? = null,
)

class DebugWatchWorkoutSimulator(
    private val transport: DebugWatchSimulatorTransport,
    private val watchDeviceId: String = "watch-gt4-debug-simulator",
    private val codec: WatchWorkoutProtocolCodec = WatchWorkoutProtocolCodec(),
    private val nowEpochMs: () -> Long = System::currentTimeMillis,
    private val newUuid: () -> String = { UUID.randomUUID().toString() },
) : WatchWorkoutResponseSink {
    private val mutableSnapshot = MutableStateFlow<WatchSyncSnapshotDto?>(null)
    private val mutableDiagnostics = MutableStateFlow(DebugWatchWorkoutDiagnostics())

    val snapshot: StateFlow<WatchSyncSnapshotDto?> = mutableSnapshot.asStateFlow()
    val diagnostics: StateFlow<DebugWatchWorkoutDiagnostics> = mutableDiagnostics.asStateFlow()

    override suspend fun sendSnapshot(snapshot: WatchSyncSnapshotDto) {
        val validated = codec.decodeSyncSnapshot(codec.encodeSyncSnapshot(snapshot))
        mutableSnapshot.value = validated
        refreshDiagnostics()
    }

    override suspend fun sendAck(ack: WatchSyncAckDto) {
        val validated = codec.decodeSyncAck(codec.encodeSyncAck(ack))
        mutableDiagnostics.value = mutableDiagnostics.value.copy(
            ackCount = mutableDiagnostics.value.ackCount + 1,
            lastAckStatus = validated.status.name,
        )
    }

    override suspend fun sendEvent(event: WatchEventEnvelopeDto) {
        if (event.type != WatchEventType.ACTIVE_EXERCISE_CHANGED) return
        val payload = codec.decodeActiveExerciseChangedPayload(event.payload)
        mutableSnapshot.value = mutableSnapshot.value?.let { current ->
            current.copy(
                revision = event.revision,
                workoutSession = current.workoutSession.copy(
                    activeExerciseId = payload.exerciseId,
                    revision = event.revision,
                    updatedAt = event.timestamp,
                    updatedBy = WatchEventSource.PHONE,
                ),
                exerciseSessions = current.exerciseSessions.map { exercise ->
                    exercise.copy(
                        status = if (exercise.exerciseSessionId == payload.exerciseSessionId) {
                            org.sharteman.gymcoach.watch.domain.WatchExerciseStatus.ACTIVE
                        } else {
                            org.sharteman.gymcoach.watch.domain.WatchExerciseStatus.PENDING
                        },
                    )
                },
            )
        }
        refreshDiagnostics()
    }

    suspend fun requestSnapshot(sessionId: String, revision: Long = 1, duplicate: Boolean = false) {
        sendWatchEvent(
            sessionId = sessionId,
            type = WatchEventType.SYNC_REQUESTED,
            revision = revision,
            payload = kotlinx.serialization.json.buildJsonObject {},
            duplicate = duplicate,
        )
    }

    suspend fun changeExercise(exerciseSessionId: String, duplicate: Boolean = false) {
        val current = requireNotNull(mutableSnapshot.value) { "No workout snapshot is loaded." }
        val exercise = requireNotNull(
            current.exerciseSessions.firstOrNull { it.exerciseSessionId == exerciseSessionId },
        ) { "Exercise session is not present in the snapshot." }
        sendWatchEvent(
            sessionId = current.sessionId,
            type = WatchEventType.ACTIVE_EXERCISE_CHANGED,
            revision = current.revision + 1,
            payload = codec.encodeActiveExerciseChangedPayload(
                ActiveExerciseChangedPayloadDto(
                    exerciseId = exercise.exerciseId,
                    exerciseSessionId = exercise.exerciseSessionId,
                    order = exercise.order,
                ),
            ),
            duplicate = duplicate,
        )
    }

    suspend fun completeSet(
        setId: String,
        exerciseSessionId: String,
        setNumber: Int,
        weight: Double,
        reps: Int,
        rir: Int,
        startedAt: Long,
        completedAt: Long = nowEpochMs(),
        duplicate: Boolean = false,
    ) {
        val current = requireNotNull(mutableSnapshot.value) { "No workout snapshot is loaded." }
        val revision = current.revision + 1
        val record = WatchSetRecordDto(
            setId = setId,
            sessionId = current.sessionId,
            exerciseSessionId = exerciseSessionId,
            setNumber = setNumber,
            weight = weight,
            reps = reps,
            rir = rir,
            setType = "WORKING",
            comment = null,
            startedAt = startedAt,
            completedAt = completedAt,
            source = WatchEventSource.WATCH,
            heartRateSummary = WatchHeartRateSummaryDto(
                min = null,
                max = null,
                average = null,
                start = null,
                end = null,
                sampleCount = 0,
            ),
            sensorSummary = kotlinx.serialization.json.buildJsonObject {},
            revision = revision,
        )
        sendWatchEvent(
            sessionId = current.sessionId,
            type = WatchEventType.SET_COMPLETED,
            revision = revision,
            payload = codec.encodeSetRecordPayload(record),
            duplicate = duplicate,
        )
    }

    private suspend fun sendWatchEvent(
        sessionId: String,
        type: WatchEventType,
        revision: Long,
        payload: kotlinx.serialization.json.JsonObject,
        duplicate: Boolean,
    ) {
        transport.sendFromWatch(
            WatchEventEnvelopeDto(
                protocolVersion = WatchProtocol.VERSION,
                schemaVersion = WatchProtocol.SCHEMA_VERSION,
                eventId = newUuid(),
                sessionId = sessionId,
                type = type,
                timestamp = nowEpochMs(),
                source = WatchEventSource.WATCH,
                deviceId = watchDeviceId,
                revision = revision,
                payload = payload,
            ),
            duplicate = duplicate,
        )
    }

    private fun refreshDiagnostics() {
        val current = mutableSnapshot.value
        mutableDiagnostics.value = mutableDiagnostics.value.copy(
            hasSnapshot = current != null,
            activeExerciseId = current?.workoutSession?.activeExerciseId,
            completedSetCount = current?.setRecords?.size ?: 0,
        )
    }
}
