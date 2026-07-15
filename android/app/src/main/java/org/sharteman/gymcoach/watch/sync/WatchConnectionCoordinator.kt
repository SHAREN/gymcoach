package org.sharteman.gymcoach.watch.sync

import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.sharteman.gymcoach.watch.data.ProcessedWatchControlMessageStore
import org.sharteman.gymcoach.watch.data.ProcessedWatchEventStore
import org.sharteman.gymcoach.watch.data.WatchProtocolCodec
import org.sharteman.gymcoach.watch.domain.WatchConnectionStatus
import org.sharteman.gymcoach.watch.domain.WatchControlMessageDto
import org.sharteman.gymcoach.watch.domain.WatchControlMessageType
import org.sharteman.gymcoach.watch.domain.WatchCoordinatorState
import org.sharteman.gymcoach.watch.domain.WatchEventEnvelopeDto
import org.sharteman.gymcoach.watch.domain.WatchEventSource
import org.sharteman.gymcoach.watch.domain.WatchIncomingMessage
import org.sharteman.gymcoach.watch.domain.WatchProtocol
import org.sharteman.gymcoach.watch.domain.WatchProtocolErrorCode
import org.sharteman.gymcoach.watch.domain.WatchProtocolException
import org.sharteman.gymcoach.watch.transport.WatchTransport

fun interface WatchEventConsumer {
    suspend fun onEvent(event: WatchEventEnvelopeDto)
}

class WatchConnectionCoordinator(
    private val phoneDeviceId: String,
    private val transport: WatchTransport,
    private val processedEventStore: ProcessedWatchEventStore,
    private val processedControlMessageStore: ProcessedWatchControlMessageStore,
    private val scope: CoroutineScope,
    private val eventConsumer: WatchEventConsumer? = null,
    private val codec: WatchProtocolCodec = WatchProtocolCodec(),
    private val nowEpochMs: () -> Long = System::currentTimeMillis,
    private val newId: () -> String = { UUID.randomUUID().toString() },
) {
    private val started = AtomicBoolean(false)
    private val jobs = mutableListOf<Job>()
    private val mutableState = MutableStateFlow(WatchCoordinatorState())

    val state: StateFlow<WatchCoordinatorState> = mutableState.asStateFlow()

    fun start() {
        if (!started.compareAndSet(false, true)) return
        jobs += scope.launch {
            transport.connectionStatus.collect { status ->
                mutableState.update { current ->
                    current.copy(
                        connectionStatus = status,
                        connectionChangedAt = nowEpochMs(),
                        pendingPingMessageId =
                            if (status == WatchConnectionStatus.DISCONNECTED) null else current.pendingPingMessageId,
                        pendingPingSentAt = if (status == WatchConnectionStatus.DISCONNECTED) null else current.pendingPingSentAt,
                    )
                }
            }
        }
        jobs += scope.launch {
            transport.incomingMessages.collect(::handleIncomingMessage)
        }
    }

    suspend fun connect() {
        start()
        transport.connect()
    }

    suspend fun disconnect() {
        transport.disconnect()
    }

    suspend fun reconnect() {
        transport.disconnect()
        transport.connect()
    }

    fun stop() {
        jobs.forEach(Job::cancel)
        jobs.clear()
        started.set(false)
    }

    suspend fun ping(): String {
        val messageId = newId()
        val sentAt = nowEpochMs()
        mutableState.update {
            it.copy(
                pendingPingMessageId = messageId,
                pendingPingSentAt = sentAt,
                lastErrorCode = null,
            )
        }
        val message = newPhoneControlMessage(
            messageId = messageId,
            type = WatchControlMessageType.PING,
            timestamp = sentAt,
            payload = buildJsonObject { put("purpose", "connection-check") },
        )
        try {
            sendControlMessage(message)
        } catch (error: Exception) {
            mutableState.update {
                it.copy(pendingPingMessageId = null, pendingPingSentAt = null)
            }
            throw error
        }
        return messageId
    }

    suspend fun sendControlMessage(message: WatchControlMessageDto) {
        sendEncoded { codec.encodeControlMessage(message) }
    }

    suspend fun sendEvent(event: WatchEventEnvelopeDto) {
        sendEncoded { codec.encodeEvent(event) }
    }

    private suspend fun sendEncoded(encode: () -> ByteArray) {
        try {
            val message = encode()
            val transportLimit = transport.capabilities.maxMessageBytes
            if (message.size > transportLimit) {
                throw WatchProtocolException(WatchProtocolErrorCode.MESSAGE_TOO_LARGE)
            }
            transport.sendMessage(message)
            mutableState.update {
                it.copy(sentMessageCount = it.sentMessageCount + 1, lastErrorCode = null)
            }
        } catch (error: WatchProtocolException) {
            reject(error.code)
            throw error
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            reject(WatchProtocolErrorCode.TRANSPORT_FAILURE)
            throw WatchProtocolException(WatchProtocolErrorCode.TRANSPORT_FAILURE)
        }
    }

    private suspend fun handleIncomingMessage(message: ByteArray) {
        mutableState.update { it.copy(receivedMessageCount = it.receivedMessageCount + 1) }
        try {
            if (message.size > transport.capabilities.maxMessageBytes) {
                throw WatchProtocolException(WatchProtocolErrorCode.MESSAGE_TOO_LARGE)
            }
            when (val incoming = codec.decodeIncomingMessage(message)) {
                is WatchIncomingMessage.Control -> handleIncomingControl(incoming.message)
                is WatchIncomingMessage.Event -> handleIncomingEvent(incoming.event)
            }
        } catch (error: WatchProtocolException) {
            reject(error.code)
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            reject(WatchProtocolErrorCode.INVALID_JSON)
        }
    }

    private suspend fun handleIncomingControl(message: WatchControlMessageDto) {
        if (message.source != WatchEventSource.WATCH) {
            throw WatchProtocolException(WatchProtocolErrorCode.INVALID_SOURCE)
        }
        if (!processedControlMessageStore.markProcessed(message.messageId)) {
            mutableState.update {
                it.copy(
                    duplicateControlMessageCount = it.duplicateControlMessageCount + 1,
                    lastErrorCode = null,
                )
            }
            return
        }
        mutableState.update {
            it.copy(processedControlMessageCount = it.processedControlMessageCount + 1, lastErrorCode = null)
        }
        when (message.type) {
            WatchControlMessageType.PING -> handlePing(message)
            WatchControlMessageType.PONG -> handlePong(message)
            WatchControlMessageType.SYNC_REQUESTED,
            WatchControlMessageType.SYNC_SNAPSHOT,
            -> Unit
        }
    }

    private suspend fun handleIncomingEvent(event: WatchEventEnvelopeDto) {
        if (event.source != WatchEventSource.WATCH) {
            throw WatchProtocolException(WatchProtocolErrorCode.INVALID_SOURCE)
        }
        eventConsumer?.let { consumer ->
            consumer.onEvent(event)
            mutableState.update {
                it.copy(processedEventCount = it.processedEventCount + 1, lastErrorCode = null)
            }
            return
        }
        if (!processedEventStore.markProcessed(event.eventId)) {
            mutableState.update {
                it.copy(duplicateEventCount = it.duplicateEventCount + 1, lastErrorCode = null)
            }
            return
        }
        mutableState.update {
            it.copy(processedEventCount = it.processedEventCount + 1, lastErrorCode = null)
        }
    }

    private suspend fun handlePing(message: WatchControlMessageDto) {
        val respondedAt = nowEpochMs()
        sendControlMessage(
            newPhoneControlMessage(
                type = WatchControlMessageType.PONG,
                timestamp = respondedAt,
                replyTo = message.messageId,
                payload = buildJsonObject { put("receivedAt", respondedAt) },
            ),
        )
    }

    private fun handlePong(message: WatchControlMessageDto) {
        val current = mutableState.value
        if (current.pendingPingMessageId != message.replyTo) return
        val receivedAt = nowEpochMs()
        val sentAt = current.pendingPingSentAt ?: message.timestamp
        mutableState.update {
            it.copy(
                pendingPingMessageId = null,
                pendingPingSentAt = null,
                lastPongAt = receivedAt,
                lastRoundTripMs = (receivedAt - sentAt).coerceAtLeast(0),
                lastErrorCode = null,
            )
        }
    }

    private fun newPhoneControlMessage(
        type: WatchControlMessageType,
        timestamp: Long,
        payload: JsonObject,
        messageId: String = newId(),
        replyTo: String? = null,
    ) = WatchControlMessageDto(
        protocolVersion = WatchProtocol.VERSION,
        schemaVersion = WatchProtocol.SCHEMA_VERSION,
        messageId = messageId,
        type = type,
        timestamp = timestamp,
        source = WatchEventSource.PHONE,
        deviceId = phoneDeviceId,
        replyTo = replyTo,
        payload = payload,
    )

    private fun reject(code: WatchProtocolErrorCode) {
        mutableState.update {
            it.copy(
                rejectedMessageCount = it.rejectedMessageCount + 1,
                lastErrorCode = code,
            )
        }
    }
}
