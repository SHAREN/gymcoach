package org.sharteman.gymcoach.watch.data

import java.util.UUID
import kotlin.math.abs
import kotlinx.serialization.SerializationException
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.encodeToJsonElement
import org.sharteman.gymcoach.watch.domain.ActiveExerciseChangedPayloadDto
import org.sharteman.gymcoach.watch.domain.RestHeartRateSummaryDto
import org.sharteman.gymcoach.watch.domain.RestFinishedPayloadDto
import org.sharteman.gymcoach.watch.domain.RestSkippedPayloadDto
import org.sharteman.gymcoach.watch.domain.RestStartedPayloadDto
import org.sharteman.gymcoach.watch.domain.RestUpdatedPayloadDto
import org.sharteman.gymcoach.watch.domain.SensorBatchRecordedPayloadDto
import org.sharteman.gymcoach.watch.domain.SetDeletedPayloadDto
import org.sharteman.gymcoach.watch.domain.SetStartedPayloadDto
import org.sharteman.gymcoach.watch.domain.WatchEventEnvelopeDto
import org.sharteman.gymcoach.watch.domain.WatchActiveWorkoutRuntimeDto
import org.sharteman.gymcoach.watch.domain.WatchExerciseStatus
import org.sharteman.gymcoach.watch.domain.WatchHeartRateSummaryDto
import org.sharteman.gymcoach.watch.domain.WatchProtocol
import org.sharteman.gymcoach.watch.domain.WatchProtocolErrorCode
import org.sharteman.gymcoach.watch.domain.WatchProtocolException
import org.sharteman.gymcoach.watch.domain.WatchSensorSampleDto
import org.sharteman.gymcoach.watch.domain.WatchSensorBatchDto
import org.sharteman.gymcoach.watch.domain.WatchSetRecordDto
import org.sharteman.gymcoach.watch.domain.WatchSyncAckDto
import org.sharteman.gymcoach.watch.domain.WatchSyncSnapshotDto
import org.sharteman.gymcoach.watch.domain.WatchWorkoutSessionDto
import org.sharteman.gymcoach.watch.domain.WatchWorkoutStatus
import org.sharteman.gymcoach.watch.domain.WatchExerciseSessionDto

class WatchWorkoutProtocolCodec(
    private val json: Json = STRICT_JSON,
) {
    fun encodeWorkoutSession(value: WatchWorkoutSessionDto): ByteArray =
        encodeValidated(value, ::validateWorkoutSession)

    fun decodeWorkoutSession(message: ByteArray): WatchWorkoutSessionDto =
        decodeValidated(message, ::validateWorkoutSession)

    fun encodeExerciseSession(value: WatchExerciseSessionDto): ByteArray =
        encodeValidated(value, ::validateExerciseSession)

    fun decodeExerciseSession(message: ByteArray): WatchExerciseSessionDto =
        decodeValidated(message, ::validateExerciseSession)

    fun encodeSetRecord(value: WatchSetRecordDto): ByteArray =
        encodeValidated(value, ::validateSetRecord)

    fun decodeSetRecord(message: ByteArray): WatchSetRecordDto =
        decodeValidated(message, ::validateSetRecord)

    fun encodeSyncSnapshot(value: WatchSyncSnapshotDto): ByteArray {
        validateSyncSnapshot(value)
        return json.encodeToString(value).encodeToByteArray().also(::requireFileSize)
    }

    fun decodeSyncSnapshot(message: ByteArray): WatchSyncSnapshotDto {
        requireFileSize(message)
        return decodeValidated(message, ::validateSyncSnapshot)
    }

    fun encodeSyncAck(value: WatchSyncAckDto): ByteArray {
        validateSyncAck(value)
        return json.encodeToString(value).encodeToByteArray().also(::requireP2pSize)
    }

    fun decodeSyncAck(message: ByteArray): WatchSyncAckDto {
        requireP2pSize(message)
        return decodeValidated(message, ::validateSyncAck)
    }

    fun encodeSensorBatch(value: WatchSensorBatchDto): ByteArray {
        validateSensorBatch(value)
        return json.encodeToString(value).encodeToByteArray().also(::requireFileSize)
    }

    fun decodeSensorBatch(message: ByteArray): WatchSensorBatchDto {
        requireFileSize(message)
        return decodeValidated(message, ::validateSensorBatch)
    }

    fun decodeActiveExerciseChangedPayload(payload: JsonObject): ActiveExerciseChangedPayloadDto =
        decodePayload(payload, ::validateActiveExerciseChanged)

    fun encodeActiveExerciseChangedPayload(payload: ActiveExerciseChangedPayloadDto): JsonObject =
        encodePayload(payload, ::validateActiveExerciseChanged)

    fun decodeSetStartedPayload(payload: JsonObject): SetStartedPayloadDto =
        decodePayload(payload, ::validateSetStarted)

    fun encodeSetStartedPayload(payload: SetStartedPayloadDto): JsonObject =
        encodePayload(payload, ::validateSetStarted)

    fun decodeSetRecordPayload(payload: JsonObject): WatchSetRecordDto =
        decodePayload(payload, ::validateSetRecord)

    fun decodeSetDeletedPayload(payload: JsonObject): SetDeletedPayloadDto =
        decodePayload(payload, ::validateSetDeleted)

    fun encodeSetDeletedPayload(payload: SetDeletedPayloadDto): JsonObject =
        encodePayload(payload, ::validateSetDeleted)

    fun encodeSetRecordPayload(payload: WatchSetRecordDto): JsonObject =
        encodePayload(payload, ::validateSetRecord)

    fun decodeSensorBatchRecordedPayload(payload: JsonObject): SensorBatchRecordedPayloadDto =
        decodePayload(payload, ::validateSensorBatchRecorded)

    fun encodeSensorBatchRecordedPayload(payload: SensorBatchRecordedPayloadDto): JsonObject =
        encodePayload(payload, ::validateSensorBatchRecorded)

    fun decodeRestStartedPayload(payload: JsonObject): RestStartedPayloadDto =
        decodePayload(payload, ::validateRestStarted)

    fun encodeRestStartedPayload(payload: RestStartedPayloadDto): JsonObject =
        encodePayload(payload, ::validateRestStarted)

    fun decodeRestUpdatedPayload(payload: JsonObject): RestUpdatedPayloadDto =
        decodePayload(payload, ::validateRestUpdated)

    fun encodeRestUpdatedPayload(payload: RestUpdatedPayloadDto): JsonObject =
        encodePayload(payload, ::validateRestUpdated)

    fun decodeRestFinishedPayload(payload: JsonObject): RestFinishedPayloadDto =
        decodePayload(payload, ::validateRestFinished)

    fun encodeRestFinishedPayload(payload: RestFinishedPayloadDto): JsonObject =
        encodePayload(payload, ::validateRestFinished)

    fun decodeRestSkippedPayload(payload: JsonObject): RestSkippedPayloadDto =
        decodePayload(payload, ::validateRestSkipped)

    fun encodeRestSkippedPayload(payload: RestSkippedPayloadDto): JsonObject =
        encodePayload(payload, ::validateRestSkipped)

    private inline fun <reified T> encodeValidated(value: T, validate: (T) -> Unit): ByteArray {
        validate(value)
        return json.encodeToString(value).encodeToByteArray()
    }

    private inline fun <reified T> decodeValidated(message: ByteArray, validate: (T) -> Unit): T {
        val decoded = decodeStrict<T>(message)
        validate(decoded)
        return decoded
    }

    private inline fun <reified T> decodePayload(payload: JsonObject, validate: (T) -> Unit): T {
        val decoded = try {
            json.decodeFromJsonElement<T>(payload)
        } catch (_: SerializationException) {
            throw WatchProtocolException(WatchProtocolErrorCode.INVALID_JSON)
        } catch (_: IllegalArgumentException) {
            throw WatchProtocolException(WatchProtocolErrorCode.INVALID_JSON)
        }
        validate(decoded)
        return decoded
    }

    private inline fun <reified T> encodePayload(payload: T, validate: (T) -> Unit): JsonObject {
        validate(payload)
        return json.encodeToJsonElement(payload) as JsonObject
    }

    private inline fun <reified T> decodeStrict(message: ByteArray): T = try {
        json.decodeFromString(message.decodeToString())
    } catch (_: SerializationException) {
        throw WatchProtocolException(WatchProtocolErrorCode.INVALID_JSON)
    } catch (_: IllegalArgumentException) {
        throw WatchProtocolException(WatchProtocolErrorCode.INVALID_JSON)
    }

    private fun validateWorkoutSession(value: WatchWorkoutSessionDto) {
        requireOpaqueId(value.sessionId)
        requireOpaqueId(value.workoutProgramId)
        requireOpaqueId(value.userId)
        value.activeExerciseId?.let(::requireOpaqueId)
        value.activeSetId?.let(::requireOpaqueId)
        if (
            value.startedAt < 0 ||
            (value.finishedAt != null && value.finishedAt < 0) ||
            value.revision < 1 ||
            value.updatedAt < 0
        ) invalid()
    }

    private fun validateExerciseSession(value: WatchExerciseSessionDto) {
        requireOpaqueId(value.exerciseSessionId)
        requireOpaqueId(value.sessionId)
        requireOpaqueId(value.exerciseId)
        if (
            value.exerciseName.isBlank() ||
            value.order < 1 ||
            value.targetSets < 1 ||
            value.targetReps < 0 ||
            value.targetRir < 0 ||
            value.restDurationSeconds < 0
        ) invalid()
    }

    private fun validateSetRecord(value: WatchSetRecordDto) {
        requireOpaqueId(value.setId)
        requireOpaqueId(value.sessionId)
        requireOpaqueId(value.exerciseSessionId)
        if (
            value.setNumber < 1 ||
            !value.weight.isFinite() ||
            value.weight < 0 ||
            value.reps < 0 ||
            (value.rir != null && value.rir < 0) ||
            value.startedAt < 0 ||
            value.completedAt < 0 ||
            value.startedAt > value.completedAt ||
            value.revision < 1
        ) invalid()
        validateHeartRateSummary(value.heartRateSummary)
    }

    private fun validateHeartRateSummary(value: WatchHeartRateSummaryDto) {
        val samples = listOf(value.min, value.max, value.average, value.start, value.end)
        if (samples.any { it != null && (!it.isFinite() || it <= 0) } || value.sampleCount < 0) invalid()
    }

    private fun validateSensorSample(value: WatchSensorSampleDto) {
        requireUuid(value.sampleId)
        requireOpaqueId(value.sessionId)
        value.exerciseSessionId?.let(::requireOpaqueId)
        value.setId?.let(::requireOpaqueId)
        if (
            value.sensorType.isBlank() ||
            value.value !is JsonPrimitive ||
            value.unit.isBlank() ||
            value.timestamp < 0
        ) invalid()
    }

    private fun validateSensorBatch(value: WatchSensorBatchDto) {
        requireProtocol(value.protocolVersion, value.schemaVersion)
        requireUuid(value.batchId)
        requireOpaqueId(value.sessionId)
        if (
            value.deviceId.isBlank() ||
            value.deviceId.codePointCount(0, value.deviceId.length) > MAX_OPAQUE_ID_CODE_POINTS ||
            value.createdAt < 0 ||
            value.sequence < 1 ||
            value.totalSequences < 1 ||
            value.sequence > value.totalSequences ||
            value.samples.isEmpty() ||
            value.sampleCount != value.samples.size ||
            value.samples.map { it.sampleId }.toSet().size != value.samples.size
        ) invalid()
        value.samples.forEach { sample ->
            validateSensorSample(sample)
            if (sample.sessionId != value.sessionId || sample.source != value.source) invalid()
        }
    }

    private fun validateSyncSnapshot(value: WatchSyncSnapshotDto) {
        requireProtocol(value.protocolVersion, value.schemaVersion)
        requireUuid(value.snapshotId)
        requireOpaqueId(value.sessionId)
        if (value.timestamp < 0 || value.deviceId.isBlank() || value.revision < 1) invalid()
        validateWorkoutSession(value.workoutSession)
        if (
            value.workoutSession.sessionId != value.sessionId ||
            value.workoutSession.revision != value.revision
        ) invalid()
        value.runtimeState?.let { runtime ->
            validateActiveWorkoutRuntime(runtime)
            if (
                runtime.sessionId != value.sessionId ||
                runtime.revision != value.revision ||
                runtime.status != value.workoutSession.status ||
                runtime.activeExerciseId != value.workoutSession.activeExerciseId ||
                runtime.activeSetId != value.workoutSession.activeSetId
            ) invalid()
        }
        value.exerciseSessions.forEach {
            validateExerciseSession(it)
            if (it.sessionId != value.sessionId) invalid()
        }
        if (
            value.exerciseSessions.map { it.exerciseSessionId }.toSet().size != value.exerciseSessions.size ||
            value.exerciseSessions.map { it.order }.toSet().size != value.exerciseSessions.size
        ) invalid()
        val activeExercises = value.exerciseSessions.filter { it.status == WatchExerciseStatus.ACTIVE }
        if (
            activeExercises.size != 1 ||
            activeExercises.single().exerciseId != value.workoutSession.activeExerciseId
        ) invalid()
        val exerciseSessionIds = value.exerciseSessions.mapTo(mutableSetOf()) { it.exerciseSessionId }
        value.setRecords.forEach {
            validateSetRecord(it)
            if (
                it.sessionId != value.sessionId ||
                it.exerciseSessionId !in exerciseSessionIds ||
                it.revision > value.revision
            ) invalid()
        }
        value.sensorSamples.forEach {
            validateSensorSample(it)
            if (it.sessionId != value.sessionId) invalid()
        }
        value.pendingEvents.forEach {
            validatePendingEvent(it)
            if (it.sessionId != value.sessionId) invalid()
        }
    }

    private fun validateActiveWorkoutRuntime(value: WatchActiveWorkoutRuntimeDto) {
        requireOpaqueId(value.sessionId)
        value.activeExerciseId?.let(::requireOpaqueId)
        value.activeSetId?.let(::requireOpaqueId)
        if (
            (value.setStartedAt != null && value.setStartedAt < 0) ||
            (value.pausedAt != null && value.pausedAt < 0) ||
            value.workoutAccumulatedPauseMs < 0 ||
            value.setAccumulatedPauseMs < 0 ||
            value.revision < 1 ||
            value.updatedAt < 0 ||
            (value.status == WatchWorkoutStatus.PAUSED) != (value.pausedAt != null) ||
            (value.activeSetId == null && value.setStartedAt != null)
        ) invalid()
        value.rest?.let { rest ->
            requireOpaqueId(rest.setId)
            if (
                rest.startedAt < 0 ||
                rest.endsAt < rest.startedAt ||
                (rest.pausedRemainingMs != null && rest.pausedRemainingMs < 0)
            ) invalid()
        }
    }

    private fun validateSyncAck(value: WatchSyncAckDto) {
        requireProtocol(value.protocolVersion, value.schemaVersion)
        requireUuid(value.ackId)
        requireOpaqueId(value.sessionId)
        if (
            value.eventIds.isEmpty() ||
            value.eventIds.toSet().size != value.eventIds.size ||
            value.timestamp < 0 ||
            value.deviceId.isBlank() ||
            value.revision < 0
        ) invalid()
        value.eventIds.forEach(::requireUuid)
    }

    private fun validatePendingEvent(value: WatchEventEnvelopeDto) {
        requireProtocol(value.protocolVersion, value.schemaVersion)
        requireUuid(value.eventId)
        requireOpaqueId(value.sessionId)
        if (value.timestamp < 0 || value.deviceId.isBlank() || value.revision < 1) invalid()
    }

    private fun validateActiveExerciseChanged(value: ActiveExerciseChangedPayloadDto) {
        requireOpaqueId(value.exerciseId)
        requireOpaqueId(value.exerciseSessionId)
        if (value.order < 1) invalid()
    }

    private fun validateSetStarted(value: SetStartedPayloadDto) {
        requireOpaqueId(value.setId)
        requireOpaqueId(value.exerciseSessionId)
        if (value.setNumber < 1 || value.startedAt < 0) invalid()
    }

    private fun validateSetDeleted(value: SetDeletedPayloadDto) {
        requireOpaqueId(value.setId)
        if (value.deletedAt < 0 || value.baseRevision < 1) invalid()
    }

    private fun validateSensorBatchRecorded(value: SensorBatchRecordedPayloadDto) {
        requireUuid(value.batchId)
        if (
            value.sequence < 1 ||
            value.totalSequences < 1 ||
            value.sequence > value.totalSequences ||
            value.sampleCount < 1
        ) invalid()
    }

    private fun validateRestStarted(value: RestStartedPayloadDto) {
        requireOpaqueId(value.setId)
        if (value.startedAt < 0 || value.restEndsAt < value.startedAt) invalid()
    }

    private fun validateRestUpdated(value: RestUpdatedPayloadDto) {
        if (value.restEndsAt < 0 || value.reason.isBlank()) invalid()
    }

    private fun validateRestFinished(value: RestFinishedPayloadDto) {
        if (value.finishedAt < 0 || value.summary.finishedAt != value.finishedAt) invalid()
        validateRestHeartRateSummary(value.summary)
    }

    private fun validateRestSkipped(value: RestSkippedPayloadDto) {
        if (value.skippedAt < 0) invalid()
    }

    private fun validateRestHeartRateSummary(value: RestHeartRateSummaryDto) {
        val readings = listOf(value.start, value.min, value.average, value.at30Seconds, value.at60Seconds)
        val drops = listOf(value.drop30Seconds, value.drop60Seconds)
        if (
            value.startedAt < 0 ||
            value.finishedAt < value.startedAt ||
            value.sampleCount < 0 ||
            readings.any { it != null && (!it.isFinite() || it <= 0) } ||
            drops.any { it != null && !it.isFinite() } ||
            (value.start == null || value.at30Seconds == null) != (value.drop30Seconds == null) ||
            (value.start == null || value.at60Seconds == null) != (value.drop60Seconds == null) ||
            (value.drop30Seconds != null &&
                abs(value.drop30Seconds - (value.start!! - value.at30Seconds!!)) > DOUBLE_TOLERANCE) ||
            (value.drop60Seconds != null &&
                abs(value.drop60Seconds - (value.start!! - value.at60Seconds!!)) > DOUBLE_TOLERANCE)
        ) invalid()
    }

    private fun requireProtocol(protocolVersion: String, schemaVersion: Int) {
        if (protocolVersion != WatchProtocol.VERSION || schemaVersion != WatchProtocol.SCHEMA_VERSION) {
            throw WatchProtocolException(WatchProtocolErrorCode.UNSUPPORTED_PROTOCOL)
        }
    }

    private fun requireOpaqueId(value: String) {
        if (value.isBlank() || value.codePointCount(0, value.length) > MAX_OPAQUE_ID_CODE_POINTS) invalid()
    }

    private fun requireUuid(value: String) {
        val canonical = runCatching { UUID.fromString(value).toString() }.getOrNull()
        if (!canonical.equals(value, ignoreCase = true)) invalid()
    }

    private fun requireP2pSize(message: ByteArray) {
        if (message.size > WatchProtocol.MAX_P2P_MESSAGE_BYTES) {
            throw WatchProtocolException(WatchProtocolErrorCode.MESSAGE_TOO_LARGE)
        }
    }

    private fun requireFileSize(message: ByteArray) {
        if (message.size >= WatchProtocol.MAX_FILE_BYTES_EXCLUSIVE) {
            throw WatchProtocolException(WatchProtocolErrorCode.FILE_TOO_LARGE)
        }
    }

    private fun invalid(): Nothing = throw WatchProtocolException(WatchProtocolErrorCode.INVALID_EVENT)

    private companion object {
        const val MAX_OPAQUE_ID_CODE_POINTS = 128
        const val DOUBLE_TOLERANCE = 1e-9

        val STRICT_JSON = Json {
            ignoreUnknownKeys = false
            isLenient = false
            coerceInputValues = false
            explicitNulls = true
            encodeDefaults = true
        }
    }
}
