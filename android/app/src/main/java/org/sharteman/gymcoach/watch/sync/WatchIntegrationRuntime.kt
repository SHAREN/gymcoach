package org.sharteman.gymcoach.watch.sync

import java.util.UUID
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.sharteman.gymcoach.watch.data.WatchWorkoutProtocolCodec
import org.sharteman.gymcoach.watch.domain.ActiveExerciseChangedPayloadDto
import org.sharteman.gymcoach.watch.domain.RestFinishedPayloadDto
import org.sharteman.gymcoach.watch.domain.RestSkippedPayloadDto
import org.sharteman.gymcoach.watch.domain.RestStartedPayloadDto
import org.sharteman.gymcoach.watch.domain.RestUpdatedPayloadDto
import org.sharteman.gymcoach.watch.domain.SetDeletedPayloadDto
import org.sharteman.gymcoach.watch.domain.SetStartedPayloadDto
import org.sharteman.gymcoach.watch.domain.WatchEventEnvelopeDto
import org.sharteman.gymcoach.watch.domain.WatchEventSource
import org.sharteman.gymcoach.watch.domain.WatchEventType
import org.sharteman.gymcoach.watch.domain.WatchProtocol
import org.sharteman.gymcoach.watch.domain.WatchProtocolErrorCode
import org.sharteman.gymcoach.watch.domain.WatchProtocolException
import org.sharteman.gymcoach.watch.domain.WatchSetRecordDto
import org.sharteman.gymcoach.watch.domain.WatchSyncSnapshotDto

interface WatchIntegrationDispatch {
    suspend fun sendEvent(event: WatchEventEnvelopeDto)
    suspend fun sendSnapshot(snapshot: WatchSyncSnapshotDto)
}

class WatchIntegrationRuntime(
    private val phoneDeviceId: String,
    private val persistence: WatchSyncPersistence,
    private val dispatch: WatchIntegrationDispatch,
    private val snapshotProvider: suspend (String) -> WatchSyncSnapshotDto?,
    private val codec: WatchWorkoutProtocolCodec = WatchWorkoutProtocolCodec(),
    private val nowEpochMs: () -> Long = System::currentTimeMillis,
    private val newUuid: () -> String = { UUID.randomUUID().toString() },
) {
    suspend fun startWorkout(sessionId: String, revision: Long, startedAt: Long): String {
        val eventId = emit(
            sessionId,
            WatchEventType.WORKOUT_STARTED,
            revision,
            buildJsonObject { put("startedAt", startedAt) },
            startedAt,
        )
        snapshotProvider(sessionId)?.let { snapshot ->
            tryOfflineDispatch { dispatch.sendSnapshot(snapshot) }
        }
        return eventId
    }

    suspend fun pauseWorkout(sessionId: String, revision: Long, pausedAt: Long) = emit(
        sessionId, WatchEventType.WORKOUT_PAUSED, revision,
        buildJsonObject { put("pausedAt", pausedAt) }, pausedAt,
    )

    suspend fun resumeWorkout(sessionId: String, revision: Long, resumedAt: Long) = emit(
        sessionId, WatchEventType.WORKOUT_RESUMED, revision,
        buildJsonObject { put("resumedAt", resumedAt) }, resumedAt,
    )

    suspend fun changeExercise(
        sessionId: String,
        revision: Long,
        payload: ActiveExerciseChangedPayloadDto,
        timestamp: Long = nowEpochMs(),
    ) = emit(
        sessionId, WatchEventType.ACTIVE_EXERCISE_CHANGED, revision,
        codec.encodeActiveExerciseChangedPayload(payload), timestamp,
    )

    suspend fun startSet(
        sessionId: String,
        revision: Long,
        payload: SetStartedPayloadDto,
        timestamp: Long = nowEpochMs(),
    ) = emit(sessionId, WatchEventType.SET_STARTED, revision, codec.encodeSetStartedPayload(payload), timestamp)

    suspend fun completeSet(
        sessionId: String,
        revision: Long,
        payload: WatchSetRecordDto,
        timestamp: Long = nowEpochMs(),
    ) = emit(sessionId, WatchEventType.SET_COMPLETED, revision, codec.encodeSetRecordPayload(payload), timestamp)

    suspend fun editSet(
        sessionId: String,
        revision: Long,
        payload: WatchSetRecordDto,
        timestamp: Long = nowEpochMs(),
    ) = emit(sessionId, WatchEventType.SET_UPDATED, revision, codec.encodeSetRecordPayload(payload), timestamp)

    suspend fun deleteSet(
        sessionId: String,
        revision: Long,
        payload: SetDeletedPayloadDto,
        timestamp: Long = nowEpochMs(),
    ) = emit(sessionId, WatchEventType.SET_DELETED, revision, codec.encodeSetDeletedPayload(payload), timestamp)

    suspend fun startRest(
        sessionId: String,
        revision: Long,
        payload: RestStartedPayloadDto,
        timestamp: Long = nowEpochMs(),
    ) = emit(sessionId, WatchEventType.REST_STARTED, revision, codec.encodeRestStartedPayload(payload), timestamp)

    suspend fun updateRest(
        sessionId: String,
        revision: Long,
        payload: RestUpdatedPayloadDto,
        timestamp: Long = nowEpochMs(),
    ) = emit(sessionId, WatchEventType.REST_UPDATED, revision, codec.encodeRestUpdatedPayload(payload), timestamp)

    suspend fun finishRest(
        sessionId: String,
        revision: Long,
        payload: RestFinishedPayloadDto,
        timestamp: Long = nowEpochMs(),
    ) = emit(sessionId, WatchEventType.REST_FINISHED, revision, codec.encodeRestFinishedPayload(payload), timestamp)

    suspend fun skipRest(
        sessionId: String,
        revision: Long,
        payload: RestSkippedPayloadDto,
        timestamp: Long = nowEpochMs(),
    ) = emit(sessionId, WatchEventType.REST_SKIPPED, revision, codec.encodeRestSkippedPayload(payload), timestamp)

    suspend fun finishWorkout(sessionId: String, revision: Long, finishedAt: Long) = emit(
        sessionId, WatchEventType.WORKOUT_FINISHED, revision,
        buildJsonObject { put("finishedAt", finishedAt) }, finishedAt,
    )

    suspend fun emit(
        sessionId: String,
        type: WatchEventType,
        revision: Long,
        payload: JsonObject,
        timestamp: Long = nowEpochMs(),
        relatedTransferId: String? = null,
    ): String {
        require(sessionId.isNotBlank())
        require(revision >= 1)
        require(timestamp >= 0)
        val event = WatchEventEnvelopeDto(
            protocolVersion = WatchProtocol.VERSION,
            schemaVersion = WatchProtocol.SCHEMA_VERSION,
            eventId = newUuid(),
            sessionId = sessionId,
            type = type,
            timestamp = timestamp,
            source = WatchEventSource.PHONE,
            deviceId = phoneDeviceId,
            revision = revision,
            payload = payload,
        )
        check(persistence.enqueue(event, relatedTransferId)) { "Duplicate generated watch event ID" }
        tryOfflineDispatch {
            persistence.markAttempt(event.eventId)
            dispatch.sendEvent(event)
        }
        return event.eventId
    }

    private suspend fun tryOfflineDispatch(block: suspend () -> Unit) {
        try {
            block()
        } catch (error: WatchProtocolException) {
            if (
                error.code != WatchProtocolErrorCode.TRANSPORT_DISCONNECTED &&
                error.code != WatchProtocolErrorCode.TRANSPORT_FAILURE
            ) {
                throw error
            }
        }
    }
}
