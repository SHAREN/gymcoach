package org.sharteman.gymcoach.watch.data

import java.math.BigDecimal
import java.security.MessageDigest
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.encodeToJsonElement
import org.sharteman.gymcoach.watch.domain.WatchEventEnvelopeDto
import org.sharteman.gymcoach.watch.domain.WatchProtocolErrorCode
import org.sharteman.gymcoach.watch.domain.WatchProtocolException

data class CanonicalJsonValue(
    val json: String,
    val bytes: ByteArray,
    val sha256: String,
)

object CanonicalJson {
    private val json = Json {
        ignoreUnknownKeys = false
        isLenient = false
        coerceInputValues = false
        explicitNulls = true
        encodeDefaults = true
    }

    fun event(event: WatchEventEnvelopeDto): CanonicalJsonValue = value(json.encodeToJsonElement(event))

    fun value(element: JsonElement): CanonicalJsonValue {
        val canonical = buildString { appendCanonical(element) }
        val bytes = canonical.encodeToByteArray()
        return CanonicalJsonValue(canonical, bytes, sha256(bytes))
    }

    fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256")
        .digest(bytes)
        .joinToString(separator = "") { byte -> "%02x".format(byte) }

    private fun StringBuilder.appendCanonical(element: JsonElement) {
        when (element) {
            JsonNull -> append("null")
            is JsonArray -> {
                append('[')
                element.forEachIndexed { index, item ->
                    if (index > 0) append(',')
                    appendCanonical(item)
                }
                append(']')
            }
            is JsonObject -> {
                append('{')
                element.keys.sortedWith(::compareByCodePoint).forEachIndexed { index, key ->
                    if (index > 0) append(',')
                    append(json.encodeToString(JsonElement.serializer(), JsonPrimitive(key)))
                    append(':')
                    appendCanonical(requireNotNull(element[key]))
                }
                append('}')
            }
            is JsonPrimitive -> appendPrimitive(element)
        }
    }

    private fun StringBuilder.appendPrimitive(value: JsonPrimitive) {
        if (value.isString) {
            append(json.encodeToString(JsonElement.serializer(), value))
            return
        }
        value.booleanOrNull?.let {
            append(if (it) "true" else "false")
            return
        }
        try {
            BigDecimal(value.content)
        } catch (_: NumberFormatException) {
            throw WatchProtocolException(WatchProtocolErrorCode.INVALID_JSON)
        }
        append(value.content)
    }

    private fun compareByCodePoint(left: String, right: String): Int {
        var leftOffset = 0
        var rightOffset = 0
        while (leftOffset < left.length && rightOffset < right.length) {
            val leftPoint = left.codePointAt(leftOffset)
            val rightPoint = right.codePointAt(rightOffset)
            if (leftPoint != rightPoint) return leftPoint.compareTo(rightPoint)
            leftOffset += Character.charCount(leftPoint)
            rightOffset += Character.charCount(rightPoint)
        }
        return (left.length - leftOffset).compareTo(right.length - rightOffset)
    }
}
