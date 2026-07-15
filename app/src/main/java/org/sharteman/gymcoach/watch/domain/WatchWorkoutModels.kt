package org.sharteman.gymcoach.watch.domain

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

@Serializable
enum class WatchWorkoutStatus {
    @SerialName("ACTIVE")
    ACTIVE,

    @SerialName("PAUSED")
    PAUSED,

    @SerialName("FINISHED")
    FINISHED,
}

@Serializable
enum class WatchExerciseStatus {
    @SerialName("PENDING")
    PENDING,

    @SerialName("ACTIVE")
    ACTIVE,

    @SerialName("COMPLETED")
    COMPLETED,

    @SerialName("SKIPPED")
    SKIPPED,
}

@Serializable
data class WatchWorkoutSessionDto(
    val sessionId: String,
    val workoutProgramId: String,
    val userId: String,
    val status: WatchWorkoutStatus,
    val startedAt: Long,
    val finishedAt: Long?,
    val activeExerciseId: String?,
    val activeSetId: String?,
    val revision: Long,
    val updatedAt: Long,
    val updatedBy: WatchEventSource,
)

@Serializable
data class WatchExerciseSessionDto(
    val exerciseSessionId: String,
    val sessionId: String,
    val exerciseId: String,
    val exerciseName: String,
    val order: Int,
    val status: WatchExerciseStatus,
    val targetSets: Int,
    val targetReps: Int,
    val targetRir: Int,
    val restDurationSeconds: Int,
)

@Serializable
data class WatchHeartRateSummaryDto(
    val min: Double?,
    val max: Double?,
    val average: Double?,
    val start: Double?,
    val end: Double?,
    val sampleCount: Int,
)

@Serializable
data class WatchSetRecordDto(
    val setId: String,
    val sessionId: String,
    val exerciseSessionId: String,
    val setNumber: Int,
    val weight: Double,
    val reps: Int,
    val rir: Int?,
    val setType: String? = null,
    val comment: String? = null,
    val startedAt: Long,
    val completedAt: Long,
    val source: WatchEventSource,
    val heartRateSummary: WatchHeartRateSummaryDto,
    val sensorSummary: JsonObject,
    val revision: Long,
)

@Serializable
enum class WatchWorkoutPhase {
    @SerialName("WORKOUT")
    WORKOUT,

    @SerialName("SET")
    SET,

    @SerialName("REST")
    REST,

    @SerialName("PAUSE")
    PAUSE,

    @SerialName("WARMUP")
    WARMUP,

    @SerialName("RECOVERY")
    RECOVERY,
}

@Serializable
data class WatchSensorSampleDto(
    val sampleId: String,
    val sessionId: String,
    val exerciseSessionId: String?,
    val setId: String?,
    val phase: WatchWorkoutPhase,
    val sensorType: String,
    val value: JsonElement,
    val unit: String,
    val timestamp: Long,
    val source: WatchEventSource,
    val valid: Boolean,
    val quality: String?,
)

@Serializable
data class WatchSyncSnapshotDto(
    val protocolVersion: String,
    val schemaVersion: Int,
    val snapshotId: String,
    val sessionId: String,
    val timestamp: Long,
    val source: WatchEventSource,
    val deviceId: String,
    val revision: Long,
    val workoutSession: WatchWorkoutSessionDto,
    val exerciseSessions: List<WatchExerciseSessionDto>,
    val setRecords: List<WatchSetRecordDto>,
    val sensorSamples: List<WatchSensorSampleDto>,
    val pendingEvents: List<WatchEventEnvelopeDto>,
)

@Serializable
enum class WatchSyncAckStatus {
    @SerialName("APPLIED")
    APPLIED,

    @SerialName("DUPLICATE")
    DUPLICATE,

    @SerialName("STALE")
    STALE,

    @SerialName("CONFLICT")
    CONFLICT,

    @SerialName("REJECTED")
    REJECTED,
}

@Serializable
data class WatchSyncAckDto(
    val protocolVersion: String,
    val schemaVersion: Int,
    val ackId: String,
    val sessionId: String,
    val eventIds: List<String>,
    val status: WatchSyncAckStatus,
    val timestamp: Long,
    val source: WatchEventSource,
    val deviceId: String,
    val revision: Long,
    val errorCode: String?,
)

@Serializable
data class ActiveExerciseChangedPayloadDto(
    val exerciseId: String,
    val exerciseSessionId: String,
    val order: Int,
)

@Serializable
data class SetStartedPayloadDto(
    val setId: String,
    val exerciseSessionId: String,
    val setNumber: Int,
    val startedAt: Long,
)

@Serializable
data class SetDeletedPayloadDto(
    val setId: String,
    val deletedAt: Long,
    val baseRevision: Long,
)
