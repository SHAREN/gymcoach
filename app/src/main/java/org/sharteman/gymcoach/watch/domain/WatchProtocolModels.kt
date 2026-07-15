package org.sharteman.gymcoach.watch.domain

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

object WatchProtocol {
    const val VERSION = "1.0"
    const val SCHEMA_VERSION = 1
    const val MAX_P2P_MESSAGE_BYTES = 1_024
    const val MAX_FILE_BYTES_EXCLUSIVE = 4_000_000
    const val MAX_CONTROL_ID_LENGTH = 128
    const val MAX_DEVICE_ID_LENGTH = 128
}

@Serializable
enum class WatchEventType {
    @SerialName("WORKOUT_STARTED")
    WORKOUT_STARTED,

    @SerialName("WORKOUT_PAUSED")
    WORKOUT_PAUSED,

    @SerialName("WORKOUT_RESUMED")
    WORKOUT_RESUMED,

    @SerialName("WORKOUT_FINISHED")
    WORKOUT_FINISHED,

    @SerialName("ACTIVE_EXERCISE_CHANGED")
    ACTIVE_EXERCISE_CHANGED,

    @SerialName("SET_STARTED")
    SET_STARTED,

    @SerialName("SET_UPDATED")
    SET_UPDATED,

    @SerialName("SET_COMPLETED")
    SET_COMPLETED,

    @SerialName("SET_DELETED")
    SET_DELETED,

    @SerialName("REST_STARTED")
    REST_STARTED,

    @SerialName("REST_UPDATED")
    REST_UPDATED,

    @SerialName("REST_FINISHED")
    REST_FINISHED,

    @SerialName("REST_SKIPPED")
    REST_SKIPPED,

    @SerialName("SENSOR_BATCH_RECORDED")
    SENSOR_BATCH_RECORDED,

    @SerialName("HEART_RATE_UPDATED")
    HEART_RATE_UPDATED,

    @SerialName("WATCH_CONNECTED")
    WATCH_CONNECTED,

    @SerialName("WATCH_DISCONNECTED")
    WATCH_DISCONNECTED,

    @SerialName("SYNC_REQUESTED")
    SYNC_REQUESTED,

    @SerialName("SYNC_SNAPSHOT")
    SYNC_SNAPSHOT,

    @SerialName("SYNC_ACKNOWLEDGED")
    SYNC_ACKNOWLEDGED,
}

@Serializable
enum class WatchEventSource {
    @SerialName("PHONE")
    PHONE,

    @SerialName("WATCH")
    WATCH,
}

@Serializable
enum class WatchDeliveryMode {
    @SerialName("P2P")
    P2P,

    @SerialName("FILE")
    FILE,
}

@Serializable
data class WatchEventEnvelopeDto(
    val protocolVersion: String,
    val schemaVersion: Int,
    val eventId: String,
    val sessionId: String,
    val type: WatchEventType,
    val timestamp: Long,
    val source: WatchEventSource,
    val deviceId: String,
    val revision: Long,
    val payload: JsonObject,
)

@Serializable
data class WatchBatchEnvelopeDto(
    val protocolVersion: String,
    val schemaVersion: Int,
    val batchId: String,
    val sessionId: String,
    val source: WatchEventSource,
    val deviceId: String,
    val createdAt: Long,
    val sequence: Int,
    val totalSequences: Int,
    val deliveryMode: WatchDeliveryMode,
    val eventCount: Int,
    val events: List<WatchEventEnvelopeDto>,
)

@Serializable
enum class WatchControlMessageType {
    @SerialName("PING")
    PING,

    @SerialName("PONG")
    PONG,

    @SerialName("SYNC_REQUESTED")
    SYNC_REQUESTED,

    @SerialName("SYNC_SNAPSHOT")
    SYNC_SNAPSHOT,
}

@Serializable
data class WatchControlMessageDto(
    val protocolVersion: String,
    val schemaVersion: Int,
    val messageId: String,
    val type: WatchControlMessageType,
    val timestamp: Long,
    val source: WatchEventSource,
    val deviceId: String,
    val replyTo: String?,
    val payload: JsonObject,
)

sealed interface WatchIncomingMessage {
    data class Control(val message: WatchControlMessageDto) : WatchIncomingMessage

    data class Event(val event: WatchEventEnvelopeDto) : WatchIncomingMessage
}
