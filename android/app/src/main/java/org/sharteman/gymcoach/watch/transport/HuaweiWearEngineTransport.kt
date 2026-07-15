package org.sharteman.gymcoach.watch.transport

import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.sharteman.gymcoach.watch.domain.WatchConnectionStatus
import org.sharteman.gymcoach.watch.domain.WatchProtocolErrorCode
import org.sharteman.gymcoach.watch.domain.WatchProtocolException

class HuaweiWearEngineTransport(
    private val client: HuaweiWearEngineClient,
    private val peer: HuaweiWearEnginePeerIdentity,
    private val preferredDeviceUuid: String? = null,
) : WatchTransport {
    private val connectionMutex = Mutex()
    private val activeDevice = AtomicReference<HuaweiWearEngineDevice?>(null)
    private val mutableConnectionStatus = MutableStateFlow(WatchConnectionStatus.DISCONNECTED)
    private val mutableIncomingMessages = MutableSharedFlow<ByteArray>(extraBufferCapacity = INBOUND_BUFFER_CAPACITY)
    private val mutableIncomingFiles = MutableSharedFlow<WatchTransportFile>(extraBufferCapacity = INBOUND_BUFFER_CAPACITY)

    override val connectionStatus: StateFlow<WatchConnectionStatus> = mutableConnectionStatus.asStateFlow()
    override val incomingMessages: Flow<ByteArray> = mutableIncomingMessages.asSharedFlow()
    override val incomingFiles: Flow<WatchTransportFile> = mutableIncomingFiles.asSharedFlow()
    override val capabilities = WatchTransportCapabilities(supportsFileTransfer = true)

    override suspend fun connect() = connectionMutex.withLock {
        if (activeDevice.get() != null && mutableConnectionStatus.value == WatchConnectionStatus.CONNECTED) return
        mutableConnectionStatus.value = WatchConnectionStatus.CONNECTING
        try {
            val device = selectDevice(client.connectedDevices())
                ?: throw HuaweiWearEngineClientException(HuaweiWearEngineFailure.NO_CONNECTED_DEVICE)
            client.registerReceiver(device, peer, ::receive)
            activeDevice.set(device)
            mutableConnectionStatus.value = WatchConnectionStatus.CONNECTED
        } catch (error: CancellationException) {
            mutableConnectionStatus.value = WatchConnectionStatus.DISCONNECTED
            throw error
        } catch (error: Throwable) {
            activeDevice.set(null)
            runCatching { client.unregisterReceiver() }
            mutableConnectionStatus.value = WatchConnectionStatus.DISCONNECTED
            throw error.asWatchProtocolException()
        }
    }

    override suspend fun disconnect() = connectionMutex.withLock {
        activeDevice.set(null)
        try {
            client.unregisterReceiver()
        } finally {
            mutableConnectionStatus.value = WatchConnectionStatus.DISCONNECTED
        }
    }

    override suspend fun sendMessage(message: ByteArray) {
        if (message.size > capabilities.outboundMessageTargetBytes) {
            throw WatchProtocolException(WatchProtocolErrorCode.MESSAGE_TOO_LARGE)
        }
        val device = requireConnectedDevice()
        try {
            client.sendMessage(device, peer, message.copyOf())
        } catch (error: CancellationException) {
            throw error
        } catch (error: Throwable) {
            mutableConnectionStatus.value = WatchConnectionStatus.DISCONNECTED
            activeDevice.set(null)
            throw error.asWatchProtocolException()
        }
    }

    override suspend fun sendFile(file: WatchTransportFile) {
        if (file.bytes.size > capabilities.outboundFileTargetBytes) {
            throw WatchProtocolException(WatchProtocolErrorCode.FILE_TOO_LARGE)
        }
        val device = requireConnectedDevice()
        try {
            client.sendFile(device, peer, file.transferId, file.bytes.copyOf())
        } catch (error: CancellationException) {
            throw error
        } catch (error: Throwable) {
            mutableConnectionStatus.value = WatchConnectionStatus.DISCONNECTED
            activeDevice.set(null)
            throw error.asWatchProtocolException()
        }
    }

    private fun selectDevice(devices: List<HuaweiWearEngineDevice>): HuaweiWearEngineDevice? {
        val requestedUuid = preferredDeviceUuid?.takeIf(String::isNotBlank)
        return if (requestedUuid == null) {
            devices.firstOrNull()
        } else {
            devices.firstOrNull { it.uuid == requestedUuid }
        }
    }

    private fun requireConnectedDevice(): HuaweiWearEngineDevice = activeDevice.get()
        ?.takeIf { mutableConnectionStatus.value == WatchConnectionStatus.CONNECTED }
        ?: throw WatchProtocolException(WatchProtocolErrorCode.TRANSPORT_DISCONNECTED)

    private fun receive(message: HuaweiWearEngineIncomingMessage) {
        when (message) {
            is HuaweiWearEngineIncomingMessage.Data -> {
                if (message.bytes.size <= capabilities.inboundMessageMaxBytes) {
                    mutableIncomingMessages.tryEmit(message.bytes.copyOf())
                }
            }

            is HuaweiWearEngineIncomingMessage.File -> {
                if (
                    message.transferId.isNotBlank() &&
                    message.bytes.size < capabilities.inboundFileMaxBytesExclusive
                ) {
                    mutableIncomingFiles.tryEmit(
                        WatchTransportFile(message.transferId, message.bytes.copyOf()),
                    )
                }
            }
        }
    }

    private fun Throwable.asWatchProtocolException(): WatchProtocolException {
        if (this is WatchProtocolException) return this
        val code = when ((this as? HuaweiWearEngineClientException)?.failure) {
            HuaweiWearEngineFailure.NO_CONNECTED_DEVICE,
            HuaweiWearEngineFailure.DEVICE_NOT_AVAILABLE,
            -> WatchProtocolErrorCode.TRANSPORT_DISCONNECTED

            HuaweiWearEngineFailure.DEVICE_MANAGER_PERMISSION_REQUIRED,
            HuaweiWearEngineFailure.SDK_FAILURE,
            null,
            -> WatchProtocolErrorCode.TRANSPORT_FAILURE
        }
        return WatchProtocolException(code)
    }

    private companion object {
        const val INBOUND_BUFFER_CAPACITY = 64
    }
}
