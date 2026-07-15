package org.sharteman.gymcoach.watch.data

import java.util.UUID
import kotlinx.serialization.SerializationException
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.sharteman.gymcoach.watch.domain.WatchBatchEnvelopeDto
import org.sharteman.gymcoach.watch.domain.WatchControlMessageDto
import org.sharteman.gymcoach.watch.domain.WatchDeliveryMode
import org.sharteman.gymcoach.watch.domain.WatchEventEnvelopeDto
import org.sharteman.gymcoach.watch.domain.WatchIncomingMessage
import org.sharteman.gymcoach.watch.domain.WatchProtocol
import org.sharteman.gymcoach.watch.domain.WatchProtocolErrorCode
import org.sharteman.gymcoach.watch.domain.WatchProtocolException

class WatchProtocolCodec(
    private val json: Json = STRICT_JSON,
) {
    fun encodeEvent(event: WatchEventEnvelopeDto): ByteArray {
        validateEvent(event)
        return json.encodeToString(event).encodeToByteArray().also(::requireP2pSize)
    }

    fun decodeEvent(message: ByteArray): WatchEventEnvelopeDto {
        requireP2pSize(message)
        val event = decodeStrict<WatchEventEnvelopeDto>(message)
        validateEvent(event)
        return event
    }

    fun encodeControlMessage(message: WatchControlMessageDto): ByteArray {
        validateControlMessage(message)
        return json.encodeToString(message).encodeToByteArray().also(::requireP2pSize)
    }

    fun decodeControlMessage(message: ByteArray): WatchControlMessageDto {
        requireP2pSize(message)
        val controlMessage = decodeStrict<WatchControlMessageDto>(message)
        validateControlMessage(controlMessage)
        return controlMessage
    }

    fun decodeIncomingMessage(message: ByteArray): WatchIncomingMessage {
        requireP2pSize(message)
        val root = try {
            json.parseToJsonElement(message.decodeToString()).jsonObject
        } catch (_: SerializationException) {
            throw WatchProtocolException(WatchProtocolErrorCode.INVALID_JSON)
        } catch (_: IllegalArgumentException) {
            throw WatchProtocolException(WatchProtocolErrorCode.INVALID_JSON)
        }
        val hasMessageId = root.containsKey("messageId")
        val hasEventId = root.containsKey("eventId")
        if (hasMessageId == hasEventId) {
            throw WatchProtocolException(WatchProtocolErrorCode.INVALID_JSON)
        }
        return if (hasMessageId) {
            val controlMessage = decodeStrict<WatchControlMessageDto>(message)
            validateControlMessage(controlMessage)
            WatchIncomingMessage.Control(controlMessage)
        } else {
            val event = decodeStrict<WatchEventEnvelopeDto>(message)
            validateEvent(event)
            WatchIncomingMessage.Event(event)
        }
    }

    fun encodeBatch(batch: WatchBatchEnvelopeDto): ByteArray {
        validateBatch(batch)
        val bytes = json.encodeToString(batch).encodeToByteArray()
        when (batch.deliveryMode) {
            WatchDeliveryMode.P2P -> requireP2pSize(bytes)
            WatchDeliveryMode.FILE -> if (bytes.size >= WatchProtocol.MAX_FILE_BYTES_EXCLUSIVE) {
                throw WatchProtocolException(WatchProtocolErrorCode.FILE_TOO_LARGE)
            }
        }
        return bytes
    }

    fun decodeBatch(message: ByteArray, deliveryMode: WatchDeliveryMode): WatchBatchEnvelopeDto {
        when (deliveryMode) {
            WatchDeliveryMode.P2P -> requireP2pSize(message)
            WatchDeliveryMode.FILE -> if (message.size >= WatchProtocol.MAX_FILE_BYTES_EXCLUSIVE) {
                throw WatchProtocolException(WatchProtocolErrorCode.FILE_TOO_LARGE)
            }
        }
        val batch = decodeStrict<WatchBatchEnvelopeDto>(message)
        validateBatch(batch)
        if (batch.deliveryMode != deliveryMode) {
            throw WatchProtocolException(WatchProtocolErrorCode.INVALID_EVENT)
        }
        return batch
    }

    private inline fun <reified T> decodeStrict(message: ByteArray): T = try {
        json.decodeFromString(message.decodeToString())
    } catch (error: WatchProtocolException) {
        throw error
    } catch (_: SerializationException) {
        throw WatchProtocolException(WatchProtocolErrorCode.INVALID_JSON)
    } catch (_: IllegalArgumentException) {
        throw WatchProtocolException(WatchProtocolErrorCode.INVALID_JSON)
    }

    private fun validateBatch(batch: WatchBatchEnvelopeDto) {
        requireProtocol(batch.protocolVersion, batch.schemaVersion)
        requireUuid(batch.batchId)
        if (
            batch.sessionId.isBlank() ||
            batch.deviceId.isBlank() ||
            batch.createdAt < 0 ||
            batch.sequence < 1 ||
            batch.totalSequences < 1 ||
            batch.sequence > batch.totalSequences ||
            batch.events.isEmpty() ||
            batch.eventCount != batch.events.size
        ) {
            throw WatchProtocolException(WatchProtocolErrorCode.INVALID_EVENT)
        }
        batch.events.forEach(::validateEvent)
    }

    private fun validateEvent(event: WatchEventEnvelopeDto) {
        requireProtocol(event.protocolVersion, event.schemaVersion)
        requireUuid(event.eventId)
        if (event.sessionId.isBlank() || event.deviceId.isBlank() || event.timestamp < 0 || event.revision < 1) {
            throw WatchProtocolException(WatchProtocolErrorCode.INVALID_EVENT)
        }
    }

    private fun validateControlMessage(message: WatchControlMessageDto) {
        requireProtocol(message.protocolVersion, message.schemaVersion)
        if (
            message.messageId.isBlank() ||
            message.messageId.codePointLength() > WatchProtocol.MAX_CONTROL_ID_LENGTH ||
            message.deviceId.isBlank() ||
            message.deviceId.codePointLength() > WatchProtocol.MAX_DEVICE_ID_LENGTH ||
            message.timestamp < 0 ||
            (message.replyTo != null && (
                message.replyTo.isBlank() ||
                    message.replyTo.codePointLength() > WatchProtocol.MAX_CONTROL_ID_LENGTH
            ))
        ) {
            throw WatchProtocolException(WatchProtocolErrorCode.INVALID_EVENT)
        }
    }

    private fun requireProtocol(protocolVersion: String, schemaVersion: Int) {
        if (protocolVersion != WatchProtocol.VERSION || schemaVersion != WatchProtocol.SCHEMA_VERSION) {
            throw WatchProtocolException(WatchProtocolErrorCode.UNSUPPORTED_PROTOCOL)
        }
    }

    private fun requireUuid(value: String) {
        val canonical = runCatching { UUID.fromString(value).toString() }.getOrNull()
        if (!canonical.equals(value, ignoreCase = true)) {
            throw WatchProtocolException(WatchProtocolErrorCode.INVALID_EVENT)
        }
    }

    private fun requireP2pSize(message: ByteArray) {
        if (message.size > WatchProtocol.MAX_P2P_MESSAGE_BYTES) {
            throw WatchProtocolException(WatchProtocolErrorCode.MESSAGE_TOO_LARGE)
        }
    }

    private fun String.codePointLength(): Int = codePointCount(0, length)

    private companion object {
        val STRICT_JSON = Json {
            ignoreUnknownKeys = false
            isLenient = false
            coerceInputValues = false
            explicitNulls = false
            encodeDefaults = true
        }
    }
}
