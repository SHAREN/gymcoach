package org.sharteman.gymcoach.watch.transport

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.emptyFlow
import org.sharteman.gymcoach.watch.domain.WatchConnectionStatus
import org.sharteman.gymcoach.watch.domain.WatchProtocolErrorCode
import org.sharteman.gymcoach.watch.domain.WatchProtocolException

class UnavailableWatchTransport : WatchTransport {
    override val connectionStatus: StateFlow<WatchConnectionStatus> =
        MutableStateFlow(WatchConnectionStatus.DISCONNECTED)
    override val incomingMessages: Flow<ByteArray> = emptyFlow()
    override val incomingFiles: Flow<WatchTransportFile> = emptyFlow()
    override val capabilities = WatchTransportCapabilities(supportsFileTransfer = false)

    override suspend fun connect(): Nothing = unavailable()
    override suspend fun disconnect() = Unit
    override suspend fun sendMessage(message: ByteArray): Nothing = unavailable()
    override suspend fun sendFile(file: WatchTransportFile): Nothing = unavailable()

    private fun unavailable(): Nothing = throw WatchProtocolException(
        WatchProtocolErrorCode.TRANSPORT_DISCONNECTED,
    )
}
