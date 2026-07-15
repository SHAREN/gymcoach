package org.sharteman.gymcoach.watch.simulator

import java.util.UUID
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.sharteman.gymcoach.watch.data.WatchProtocolCodec
import org.sharteman.gymcoach.watch.domain.WatchConnectionStatus
import org.sharteman.gymcoach.watch.domain.WatchControlMessageDto
import org.sharteman.gymcoach.watch.domain.WatchControlMessageType
import org.sharteman.gymcoach.watch.domain.WatchEventEnvelopeDto
import org.sharteman.gymcoach.watch.domain.WatchEventSource
import org.sharteman.gymcoach.watch.domain.WatchIncomingMessage
import org.sharteman.gymcoach.watch.domain.WatchProtocol
import org.sharteman.gymcoach.watch.domain.WatchProtocolErrorCode
import org.sharteman.gymcoach.watch.domain.WatchProtocolException
import org.sharteman.gymcoach.watch.domain.WatchSyncAckDto
import org.sharteman.gymcoach.watch.domain.WatchSyncAckStatus
import org.sharteman.gymcoach.watch.transport.WatchTransport
import org.sharteman.gymcoach.watch.transport.WatchTransportCapabilities
import org.sharteman.gymcoach.watch.transport.WatchTransportFile

data class DebugWatchSimulatorDiagnostics(
    val connectionStatus: WatchConnectionStatus = WatchConnectionStatus.DISCONNECTED,
    val connectionChangedAt: Long? = null,
    val messagesReceivedFromPhone: Long = 0,
    val messagesSentFromWatch: Long = 0,
    val duplicatedMessages: Long = 0,
    val rejectedMessages: Long = 0,
    val lastErrorCode: WatchProtocolErrorCode? = null,
)

class DebugWatchSimulatorTransport(
    private val watchDeviceId: String = "watch-gt4-debug-simulator",
    private val codec: WatchProtocolCodec = WatchProtocolCodec(),
    private val nowEpochMs: () -> Long = System::currentTimeMillis,
    private val newId: () -> String = { UUID.randomUUID().toString() },
) : WatchTransport {
    private val mutableConnectionStatus = MutableStateFlow(WatchConnectionStatus.DISCONNECTED)
    private val mutableIncomingMessages = MutableSharedFlow<ByteArray>(extraBufferCapacity = 32)
    private val mutableIncomingFiles = MutableSharedFlow<WatchTransportFile>(extraBufferCapacity = 32)
    private val mutableDiagnostics = MutableStateFlow(DebugWatchSimulatorDiagnostics())
    private var lastWatchMessage: ByteArray? = null

    override val connectionStatus: StateFlow<WatchConnectionStatus> = mutableConnectionStatus.asStateFlow()
    override val incomingMessages: Flow<ByteArray> = mutableIncomingMessages.asSharedFlow()
    override val incomingFiles: Flow<WatchTransportFile> = mutableIncomingFiles.asSharedFlow()
    override val capabilities = WatchTransportCapabilities(supportsFileTransfer = true)

    val diagnostics: StateFlow<DebugWatchSimulatorDiagnostics> = mutableDiagnostics.asStateFlow()
    val receivedPhoneEvents = mutableListOf<WatchEventEnvelopeDto>()
    val receivedPhoneFiles = mutableListOf<WatchTransportFile>()

    override suspend fun connect() {
        mutableConnectionStatus.value = WatchConnectionStatus.CONNECTING
        updateConnection(WatchConnectionStatus.CONNECTING)
        mutableConnectionStatus.value = WatchConnectionStatus.CONNECTED
        updateConnection(WatchConnectionStatus.CONNECTED)
    }

    override suspend fun disconnect() {
        mutableConnectionStatus.value = WatchConnectionStatus.DISCONNECTED
        updateConnection(WatchConnectionStatus.DISCONNECTED)
    }

    override suspend fun sendMessage(message: ByteArray) {
        requireConnected()
        try {
            val incoming = codec.decodeIncomingMessage(message)
            mutableDiagnostics.update {
                it.copy(messagesReceivedFromPhone = it.messagesReceivedFromPhone + 1, lastErrorCode = null)
            }
            if (
                incoming is WatchIncomingMessage.Control &&
                incoming.message.type == WatchControlMessageType.PING
            ) {
                sendPong(incoming.message)
            } else if (incoming is WatchIncomingMessage.Event) {
                synchronized(receivedPhoneEvents) { receivedPhoneEvents += incoming.event }
                sendAck(incoming.event)
            }
        } catch (error: WatchProtocolException) {
            reject(error.code)
            throw error
        }
    }

    override suspend fun sendFile(file: WatchTransportFile) {
        requireConnected()
        require(file.bytes.size <= capabilities.outboundFileTargetBytes)
        synchronized(receivedPhoneFiles) {
            receivedPhoneFiles += file.copy(bytes = file.bytes.copyOf())
        }
    }

    suspend fun sendFileFromWatch(file: WatchTransportFile) {
        requireConnected()
        require(file.bytes.size < capabilities.inboundFileMaxBytesExclusive)
        mutableIncomingFiles.emit(file.copy(bytes = file.bytes.copyOf()))
    }

    suspend fun sendFromWatch(event: WatchEventEnvelopeDto, duplicate: Boolean = false) {
        requireConnected()
        if (event.source != WatchEventSource.WATCH) {
            reject(WatchProtocolErrorCode.INVALID_SOURCE)
            throw WatchProtocolException(WatchProtocolErrorCode.INVALID_SOURCE)
        }
        val message = codec.encodeEvent(event)
        emitFromWatch(message)
        if (duplicate) duplicateLastWatchMessage()
    }

    suspend fun sendControlFromWatch(message: WatchControlMessageDto, duplicate: Boolean = false) {
        requireConnected()
        if (message.source != WatchEventSource.WATCH) {
            reject(WatchProtocolErrorCode.INVALID_SOURCE)
            throw WatchProtocolException(WatchProtocolErrorCode.INVALID_SOURCE)
        }
        val encoded = codec.encodeControlMessage(message)
        emitFromWatch(encoded)
        if (duplicate) duplicateLastWatchMessage()
    }

    suspend fun duplicateLastWatchMessage() {
        requireConnected()
        val message = lastWatchMessage ?: return
        mutableIncomingMessages.emit(message.copyOf())
        mutableDiagnostics.update {
            it.copy(
                messagesSentFromWatch = it.messagesSentFromWatch + 1,
                duplicatedMessages = it.duplicatedMessages + 1,
                lastErrorCode = null,
            )
        }
    }

    private suspend fun sendPong(ping: WatchControlMessageDto) {
        val respondedAt = nowEpochMs()
        sendControlFromWatch(
            WatchControlMessageDto(
                protocolVersion = WatchProtocol.VERSION,
                schemaVersion = WatchProtocol.SCHEMA_VERSION,
                messageId = newId(),
                type = WatchControlMessageType.PONG,
                timestamp = respondedAt,
                source = WatchEventSource.WATCH,
                deviceId = watchDeviceId,
                replyTo = ping.messageId,
                payload = buildJsonObject { put("receivedAt", respondedAt) },
            ),
        )
    }

    private suspend fun sendAck(event: WatchEventEnvelopeDto) {
        emitFromWatch(
            codec.encodeSyncAck(
                WatchSyncAckDto(
                    protocolVersion = WatchProtocol.VERSION,
                    schemaVersion = WatchProtocol.SCHEMA_VERSION,
                    ackId = newId(),
                    sessionId = event.sessionId,
                    eventIds = listOf(event.eventId),
                    status = WatchSyncAckStatus.APPLIED,
                    timestamp = nowEpochMs(),
                    source = WatchEventSource.WATCH,
                    deviceId = watchDeviceId,
                    revision = event.revision,
                    errorCode = null,
                ),
            ),
        )
    }

    private suspend fun emitFromWatch(message: ByteArray) {
        lastWatchMessage = message.copyOf()
        mutableIncomingMessages.emit(message.copyOf())
        mutableDiagnostics.update {
            it.copy(messagesSentFromWatch = it.messagesSentFromWatch + 1, lastErrorCode = null)
        }
    }

    private fun requireConnected() {
        if (mutableConnectionStatus.value != WatchConnectionStatus.CONNECTED) {
            reject(WatchProtocolErrorCode.TRANSPORT_DISCONNECTED)
            throw WatchProtocolException(WatchProtocolErrorCode.TRANSPORT_DISCONNECTED)
        }
    }

    private fun updateConnection(status: WatchConnectionStatus) {
        mutableDiagnostics.update {
            it.copy(
                connectionStatus = status,
                connectionChangedAt = nowEpochMs(),
                lastErrorCode = null,
            )
        }
    }

    private fun reject(code: WatchProtocolErrorCode) {
        mutableDiagnostics.update {
            it.copy(rejectedMessages = it.rejectedMessages + 1, lastErrorCode = code)
        }
    }
}
