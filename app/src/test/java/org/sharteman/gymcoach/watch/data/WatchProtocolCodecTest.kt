package org.sharteman.gymcoach.watch.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlinx.serialization.json.buildJsonObject
import org.sharteman.gymcoach.watch.domain.WatchControlMessageDto
import org.sharteman.gymcoach.watch.domain.WatchControlMessageType
import org.sharteman.gymcoach.watch.domain.WatchEventSource
import org.sharteman.gymcoach.watch.domain.WatchEventType
import org.sharteman.gymcoach.watch.domain.WatchProtocol
import org.sharteman.gymcoach.watch.domain.WatchProtocolErrorCode
import org.sharteman.gymcoach.watch.domain.WatchProtocolException
import org.sharteman.gymcoach.watch.domain.WatchIncomingMessage
import org.sharteman.gymcoach.watch.domain.WatchSyncAckDto
import org.sharteman.gymcoach.watch.domain.WatchSyncAckStatus

class WatchProtocolCodecTest {
    private val codec = WatchProtocolCodec()

    @Test
    fun `strict v1 event accepts opaque session id`() {
        val event = codec.decodeEvent(VALID_EVENT.encodeToByteArray())

        assertEquals("mob_session_a1b2c3d4", event.sessionId)
        assertEquals(WatchEventType.WATCH_CONNECTED, event.type)
    }

    @Test
    fun `strict v1 event rejects undeclared envelope field`() {
        val invalid = VALID_EVENT.replace(
            "\"payload\":{}",
            "\"payload\":{},\"secret\":\"must-not-pass\"",
        )

        val failure = runCatching { codec.decodeEvent(invalid.encodeToByteArray()) }.exceptionOrNull()

        assertTrue(failure is WatchProtocolException)
        assertEquals(WatchProtocolErrorCode.INVALID_JSON, (failure as WatchProtocolException).code)
    }

    @Test
    fun `decodes and round trips shared control message fixture`() {
        val resource = javaClass.classLoader?.getResource("control-message.json")
        assertNotNull(resource)
        val fixture = resource!!.readText()

        val decoded = codec.decodeControlMessage(fixture.encodeToByteArray())
        val roundTripped = codec.decodeControlMessage(codec.encodeControlMessage(decoded))

        assertEquals("stage2-ping-001", decoded.messageId)
        assertEquals(decoded, roundTripped)
    }

    @Test
    fun `control id limits count Unicode code points`() {
        val accepted = controlMessage("😀".repeat(128))
        val rejected = controlMessage("😀".repeat(129))

        assertEquals(accepted, codec.decodeControlMessage(codec.encodeControlMessage(accepted)))
        val failure = runCatching { codec.encodeControlMessage(rejected) }.exceptionOrNull()

        assertTrue(failure is WatchProtocolException)
        assertEquals(WatchProtocolErrorCode.INVALID_EVENT, (failure as WatchProtocolException).code)
    }

    @Test
    fun `incoming dispatcher decodes sync ack without confusing event ids`() {
        val ack = WatchSyncAckDto(
            protocolVersion = WatchProtocol.VERSION,
            schemaVersion = WatchProtocol.SCHEMA_VERSION,
            ackId = "30000000-0000-0000-0000-000000000001",
            sessionId = "mob_session_ack",
            eventIds = listOf("40000000-0000-0000-0000-000000000001"),
            status = WatchSyncAckStatus.APPLIED,
            timestamp = 1_000,
            source = WatchEventSource.WATCH,
            deviceId = "watch-test",
            revision = 3,
            errorCode = null,
        )

        val incoming = codec.decodeIncomingMessage(codec.encodeSyncAck(ack))

        assertEquals(ack, (incoming as WatchIncomingMessage.Ack).ack)
    }

    private fun controlMessage(messageId: String) = WatchControlMessageDto(
        protocolVersion = WatchProtocol.VERSION,
        schemaVersion = WatchProtocol.SCHEMA_VERSION,
        messageId = messageId,
        type = WatchControlMessageType.PING,
        timestamp = 1_000L,
        source = WatchEventSource.WATCH,
        deviceId = "watch-test",
        replyTo = null,
        payload = buildJsonObject {},
    )

    private companion object {
        const val VALID_EVENT =
            "{\"protocolVersion\":\"1.0\",\"schemaVersion\":1," +
                "\"eventId\":\"00000000-0000-0000-0000-000000000099\"," +
                "\"sessionId\":\"mob_session_a1b2c3d4\",\"type\":\"WATCH_CONNECTED\"," +
                "\"timestamp\":1000,\"source\":\"WATCH\",\"deviceId\":\"watch-test\"," +
                "\"revision\":1,\"payload\":{}}"
    }
}
