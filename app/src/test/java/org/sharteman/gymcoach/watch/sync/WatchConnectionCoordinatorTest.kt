package org.sharteman.gymcoach.watch.sync

import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.sharteman.gymcoach.watch.data.InMemoryProcessedWatchControlMessageStore
import org.sharteman.gymcoach.watch.data.InMemoryProcessedWatchEventStore
import org.sharteman.gymcoach.watch.data.WatchProtocolCodec
import org.sharteman.gymcoach.watch.domain.WatchConnectionStatus
import org.sharteman.gymcoach.watch.domain.WatchControlMessageDto
import org.sharteman.gymcoach.watch.domain.WatchControlMessageType
import org.sharteman.gymcoach.watch.domain.WatchEventEnvelopeDto
import org.sharteman.gymcoach.watch.domain.WatchEventSource
import org.sharteman.gymcoach.watch.domain.WatchEventType
import org.sharteman.gymcoach.watch.domain.WatchProtocol
import org.sharteman.gymcoach.watch.domain.WatchProtocolErrorCode
import org.sharteman.gymcoach.watch.domain.WatchProtocolException
import org.sharteman.gymcoach.watch.transport.WatchTransport
import org.sharteman.gymcoach.watch.transport.WatchTransportCapabilities

@OptIn(ExperimentalCoroutinesApi::class)
class WatchConnectionCoordinatorTest {
    private val codec = WatchProtocolCodec()

    @Test
    fun `ping receives matching control pong and records round trip`() = runTest {
        var now = 1_000L
        val transport = FakeWatchTransport()
        val coordinator = coordinator(transport, backgroundScope, { now })

        coordinator.connect()
        runCurrent()
        val pingId = coordinator.ping()
        val ping = codec.decodeControlMessage(transport.sentMessages.single())

        assertEquals(WatchControlMessageType.PING, ping.type)
        assertEquals(pingId, ping.messageId)
        assertNull(ping.replyTo)

        now = 1_125L
        transport.emitControlFromWatch(
            controlMessage(
                messageId = "watch-pong-1",
                type = WatchControlMessageType.PONG,
                replyTo = pingId,
            ),
            codec,
        )
        runCurrent()

        assertNull(coordinator.state.value.pendingPingMessageId)
        assertEquals(1_125L, coordinator.state.value.lastPongAt)
        assertEquals(125L, coordinator.state.value.lastRoundTripMs)
    }

    @Test
    fun `duplicate control message is processed once and answered once`() = runTest {
        val transport = FakeWatchTransport()
        val controlStore = InMemoryProcessedWatchControlMessageStore()
        val coordinator = coordinator(
            transport = transport,
            scope = backgroundScope,
            processedControlStore = controlStore,
        )
        val ping = controlMessage(
            messageId = "watch-ping-duplicate",
            type = WatchControlMessageType.PING,
        )

        coordinator.connect()
        runCurrent()
        transport.emitControlFromWatch(ping, codec)
        transport.emitControlFromWatch(ping, codec)
        runCurrent()

        assertEquals(1, controlStore.processedCount())
        assertEquals(1L, coordinator.state.value.processedControlMessageCount)
        assertEquals(1L, coordinator.state.value.duplicateControlMessageCount)
        assertEquals(2L, coordinator.state.value.receivedMessageCount)
        assertEquals(1, transport.sentMessages.size)
        assertEquals(WatchControlMessageType.PONG, codec.decodeControlMessage(transport.sentMessages.single()).type)
    }

    @Test
    fun `duplicate workout event uses a separate idempotency store`() = runTest {
        val transport = FakeWatchTransport()
        val eventStore = InMemoryProcessedWatchEventStore()
        val coordinator = coordinator(
            transport = transport,
            scope = backgroundScope,
            processedEventStore = eventStore,
        )
        val event = watchEvent("00000000-0000-0000-0000-000000000092")

        coordinator.connect()
        runCurrent()
        transport.emitEventFromWatch(event, codec)
        transport.emitEventFromWatch(event, codec)
        runCurrent()

        assertEquals(1, eventStore.processedCount())
        assertEquals(1L, coordinator.state.value.processedEventCount)
        assertEquals(1L, coordinator.state.value.duplicateEventCount)
        assertEquals(0L, coordinator.state.value.processedControlMessageCount)
    }

    @Test
    fun `coordinator reconnects and can send another control message`() = runTest {
        val transport = FakeWatchTransport()
        val coordinator = coordinator(transport, backgroundScope)

        coordinator.connect()
        runCurrent()
        assertEquals(WatchConnectionStatus.CONNECTED, coordinator.state.value.connectionStatus)

        coordinator.reconnect()
        runCurrent()
        assertEquals(WatchConnectionStatus.CONNECTED, coordinator.state.value.connectionStatus)

        coordinator.ping()
        assertEquals(1, transport.sentMessages.size)
    }

    @Test
    fun `control messages over 1024 bytes are rejected before transport`() = runTest {
        val transport = FakeWatchTransport()
        val coordinator = coordinator(transport, backgroundScope)
        val oversized = WatchControlMessageDto(
            protocolVersion = WatchProtocol.VERSION,
            schemaVersion = WatchProtocol.SCHEMA_VERSION,
            messageId = "phone-sync-snapshot-1",
            type = WatchControlMessageType.SYNC_SNAPSHOT,
            timestamp = 1_000L,
            source = WatchEventSource.PHONE,
            deviceId = "phone-test",
            replyTo = null,
            payload = buildJsonObject { put("snapshot", "x".repeat(2_000)) },
        )

        coordinator.connect()
        runCurrent()
        val failure = runCatching { coordinator.sendControlMessage(oversized) }.exceptionOrNull()

        assertTrue(failure is WatchProtocolException)
        assertEquals(WatchProtocolErrorCode.MESSAGE_TOO_LARGE, (failure as WatchProtocolException).code)
        assertTrue(transport.sentMessages.isEmpty())
        assertEquals(1L, coordinator.state.value.rejectedMessageCount)
    }

    private fun coordinator(
        transport: FakeWatchTransport,
        scope: CoroutineScope,
        nowEpochMs: () -> Long = { 1_000L },
        processedEventStore: InMemoryProcessedWatchEventStore = InMemoryProcessedWatchEventStore(),
        processedControlStore: InMemoryProcessedWatchControlMessageStore =
            InMemoryProcessedWatchControlMessageStore(),
    ): WatchConnectionCoordinator {
        val ids = AtomicInteger(1)
        return WatchConnectionCoordinator(
            phoneDeviceId = "phone-test",
            transport = transport,
            processedEventStore = processedEventStore,
            processedControlMessageStore = processedControlStore,
            scope = scope,
            codec = codec,
            nowEpochMs = nowEpochMs,
            newId = { "phone-msg-${ids.getAndIncrement()}" },
        )
    }

    private fun controlMessage(
        messageId: String,
        type: WatchControlMessageType,
        replyTo: String? = null,
    ) = WatchControlMessageDto(
        protocolVersion = WatchProtocol.VERSION,
        schemaVersion = WatchProtocol.SCHEMA_VERSION,
        messageId = messageId,
        type = type,
        timestamp = 1_000L,
        source = WatchEventSource.WATCH,
        deviceId = "watch-test",
        replyTo = replyTo,
        payload = buildJsonObject {},
    )

    private fun watchEvent(eventId: String) = WatchEventEnvelopeDto(
        protocolVersion = WatchProtocol.VERSION,
        schemaVersion = WatchProtocol.SCHEMA_VERSION,
        eventId = eventId,
        sessionId = SESSION_ID,
        type = WatchEventType.WATCH_CONNECTED,
        timestamp = 1_000L,
        source = WatchEventSource.WATCH,
        deviceId = "watch-test",
        revision = 1,
        payload = buildJsonObject {},
    )

    private class FakeWatchTransport : WatchTransport {
        private val mutableConnectionStatus = MutableStateFlow(WatchConnectionStatus.DISCONNECTED)
        private val mutableIncomingMessages = MutableSharedFlow<ByteArray>(extraBufferCapacity = 16)

        override val connectionStatus: StateFlow<WatchConnectionStatus> = mutableConnectionStatus
        override val incomingMessages: Flow<ByteArray> = mutableIncomingMessages
        override val capabilities = WatchTransportCapabilities()
        val sentMessages = mutableListOf<ByteArray>()

        override suspend fun connect() {
            mutableConnectionStatus.value = WatchConnectionStatus.CONNECTED
        }

        override suspend fun disconnect() {
            mutableConnectionStatus.value = WatchConnectionStatus.DISCONNECTED
        }

        override suspend fun sendMessage(message: ByteArray) {
            if (mutableConnectionStatus.value != WatchConnectionStatus.CONNECTED) {
                throw WatchProtocolException(WatchProtocolErrorCode.TRANSPORT_DISCONNECTED)
            }
            sentMessages += message.copyOf()
        }

        suspend fun emitControlFromWatch(message: WatchControlMessageDto, codec: WatchProtocolCodec) {
            mutableIncomingMessages.emit(codec.encodeControlMessage(message))
        }

        suspend fun emitEventFromWatch(event: WatchEventEnvelopeDto, codec: WatchProtocolCodec) {
            mutableIncomingMessages.emit(codec.encodeEvent(event))
        }
    }

    private companion object {
        const val SESSION_ID = "mob_session_a1b2c3d4"
    }
}
