package org.sharteman.gymcoach.watch.data

import java.util.UUID
import kotlinx.serialization.SerializationException
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import org.sharteman.gymcoach.watch.domain.WatchFilePayloadType
import org.sharteman.gymcoach.watch.domain.WatchFileTransferEnvelopeDto
import org.sharteman.gymcoach.watch.domain.WatchProtocol
import org.sharteman.gymcoach.watch.domain.WatchProtocolErrorCode
import org.sharteman.gymcoach.watch.domain.WatchProtocolException

data class ValidatedWatchFile(
    val envelope: WatchFileTransferEnvelopeDto,
    val canonicalPayload: CanonicalJsonValue,
)

class WatchFileTransferCodec(
    private val json: Json = Json {
        ignoreUnknownKeys = false
        isLenient = false
        coerceInputValues = false
        explicitNulls = true
        encodeDefaults = true
    },
) {
    fun createEnvelope(
        transferId: String,
        sessionId: String,
        relatedEventId: String?,
        payloadType: WatchFilePayloadType,
        payloadId: String,
        sequence: Int,
        totalSequences: Int,
        createdAt: Long,
        source: org.sharteman.gymcoach.watch.domain.WatchEventSource,
        deviceId: String,
        payload: JsonObject,
    ): WatchFileTransferEnvelopeDto {
        val canonical = CanonicalJson.value(payload)
        return WatchFileTransferEnvelopeDto(
            protocolVersion = WatchProtocol.VERSION,
            schemaVersion = WatchProtocol.SCHEMA_VERSION,
            transferId = transferId,
            sessionId = sessionId,
            relatedEventId = relatedEventId,
            payloadType = payloadType,
            payloadId = payloadId,
            sequence = sequence,
            totalSequences = totalSequences,
            byteLength = canonical.bytes.size,
            sha256 = canonical.sha256,
            createdAt = createdAt,
            source = source,
            deviceId = deviceId,
            payload = payload,
        ).also(::validate)
    }

    fun encode(envelope: WatchFileTransferEnvelopeDto): ByteArray {
        validate(envelope)
        return json.encodeToString(envelope).encodeToByteArray().also(::requireCompleteFileSize)
    }

    fun decode(bytes: ByteArray): ValidatedWatchFile {
        requireCompleteFileSize(bytes)
        val envelope = try {
            json.decodeFromString<WatchFileTransferEnvelopeDto>(bytes.decodeToString())
        } catch (_: SerializationException) {
            throw WatchProtocolException(WatchProtocolErrorCode.INVALID_JSON)
        } catch (_: IllegalArgumentException) {
            throw WatchProtocolException(WatchProtocolErrorCode.INVALID_JSON)
        }
        val canonical = validate(envelope)
        return ValidatedWatchFile(envelope, canonical)
    }

    private fun validate(envelope: WatchFileTransferEnvelopeDto): CanonicalJsonValue {
        if (
            envelope.protocolVersion != WatchProtocol.VERSION ||
            envelope.schemaVersion != WatchProtocol.SCHEMA_VERSION
        ) throw WatchProtocolException(WatchProtocolErrorCode.UNSUPPORTED_PROTOCOL)
        requireUuid(envelope.transferId)
        envelope.relatedEventId?.let(::requireUuid)
        if (
            envelope.sessionId.isBlank() || envelope.sessionId.codePointLength() > 128 ||
            envelope.payloadId.isBlank() || envelope.payloadId.codePointLength() > 128 ||
            envelope.deviceId.isBlank() || envelope.deviceId.codePointLength() > 128 ||
            envelope.sequence < 1 || envelope.totalSequences < 1 ||
            envelope.sequence > envelope.totalSequences || envelope.createdAt < 0 ||
            envelope.byteLength < 1 || envelope.byteLength >= WatchProtocol.MAX_FILE_BYTES_EXCLUSIVE ||
            !SHA_256.matches(envelope.sha256)
        ) throw WatchProtocolException(WatchProtocolErrorCode.INVALID_EVENT)
        val canonical = CanonicalJson.value(envelope.payload)
        if (canonical.bytes.size > WatchProtocol.TARGET_FILE_PAYLOAD_BYTES) {
            throw WatchProtocolException(WatchProtocolErrorCode.FILE_TOO_LARGE)
        }
        if (envelope.byteLength != canonical.bytes.size) {
            throw WatchProtocolException(WatchProtocolErrorCode.FILE_LENGTH_MISMATCH)
        }
        if (envelope.sha256 != canonical.sha256) {
            throw WatchProtocolException(WatchProtocolErrorCode.FILE_HASH_MISMATCH)
        }
        return canonical
    }

    private fun requireCompleteFileSize(bytes: ByteArray) {
        if (bytes.size >= WatchProtocol.MAX_FILE_BYTES_EXCLUSIVE) {
            throw WatchProtocolException(WatchProtocolErrorCode.FILE_TOO_LARGE)
        }
    }

    private fun requireUuid(value: String) {
        val canonical = runCatching { UUID.fromString(value).toString() }.getOrNull()
        if (!canonical.equals(value, ignoreCase = true)) {
            throw WatchProtocolException(WatchProtocolErrorCode.INVALID_EVENT)
        }
    }

    private fun String.codePointLength() = codePointCount(0, length)

    private companion object {
        val SHA_256 = Regex("^[0-9a-f]{64}$")
    }
}
