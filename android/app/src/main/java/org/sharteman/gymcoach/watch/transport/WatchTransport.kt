package org.sharteman.gymcoach.watch.transport

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.emptyFlow
import org.sharteman.gymcoach.watch.domain.WatchConnectionStatus
import org.sharteman.gymcoach.watch.domain.WatchProtocol

data class WatchTransportCapabilities(
    val outboundMessageTargetBytes: Int = WatchProtocol.P2P_SEND_TARGET_BYTES,
    val inboundMessageMaxBytes: Int = WatchProtocol.MAX_P2P_MESSAGE_BYTES,
    val outboundFileTargetBytes: Int = WatchProtocol.FILE_SEND_TARGET_BYTES,
    val inboundFileMaxBytesExclusive: Int = WatchProtocol.MAX_FILE_BYTES_EXCLUSIVE,
    val supportsFileTransfer: Boolean = false,
)

data class WatchTransportFile(
    val transferId: String,
    val bytes: ByteArray,
)

interface WatchTransport {
    val connectionStatus: StateFlow<WatchConnectionStatus>
    val incomingMessages: Flow<ByteArray>
    val capabilities: WatchTransportCapabilities
    val incomingFiles: Flow<WatchTransportFile>
        get() = emptyFlow()

    suspend fun connect()

    suspend fun disconnect()

    suspend fun sendMessage(message: ByteArray)

    suspend fun sendFile(file: WatchTransportFile) {
        throw UnsupportedOperationException("Watch file transfer is not configured")
    }
}
