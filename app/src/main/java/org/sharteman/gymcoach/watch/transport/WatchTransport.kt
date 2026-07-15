package org.sharteman.gymcoach.watch.transport

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import org.sharteman.gymcoach.watch.domain.WatchConnectionStatus
import org.sharteman.gymcoach.watch.domain.WatchProtocol

data class WatchTransportCapabilities(
    val maxMessageBytes: Int = WatchProtocol.MAX_P2P_MESSAGE_BYTES,
    val maxFileBytesExclusive: Int = WatchProtocol.MAX_FILE_BYTES_EXCLUSIVE,
    val supportsFileTransfer: Boolean = false,
)

interface WatchTransport {
    val connectionStatus: StateFlow<WatchConnectionStatus>
    val incomingMessages: Flow<ByteArray>
    val capabilities: WatchTransportCapabilities

    suspend fun connect()

    suspend fun disconnect()

    suspend fun sendMessage(message: ByteArray)
}
