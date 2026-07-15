package org.sharteman.gymcoach.watch.transport

import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.sharteman.gymcoach.watch.domain.WatchConnectionStatus
import org.sharteman.gymcoach.watch.domain.WatchProtocolErrorCode
import org.sharteman.gymcoach.watch.domain.WatchProtocolException

class HuaweiWearEngineTransportTest {
    @Test
    fun `transport connects selected device and carries messages and files`() = runTest {
        val first = HuaweiWearEngineDevice("first", "First", "GT")
        val selected = HuaweiWearEngineDevice("selected", "Selected", "GT 4")
        val client = FakeHuaweiWearEngineClient(mutableListOf(first, selected))
        val transport = HuaweiWearEngineTransport(
            client = client,
            peer = PEER,
            preferredDeviceUuid = selected.uuid,
        )

        transport.connect()

        assertEquals(WatchConnectionStatus.CONNECTED, transport.connectionStatus.value)
        assertEquals(selected, client.registeredDevice)
        assertEquals(PEER, client.registeredPeer)
        assertTrue(transport.capabilities.supportsFileTransfer)

        val data = byteArrayOf(1, 2, 3)
        transport.sendMessage(data)
        data[0] = 9
        assertArrayEquals(byteArrayOf(1, 2, 3), client.sentMessages.single())

        val file = WatchTransportFile("transfer-id", byteArrayOf(4, 5, 6))
        transport.sendFile(file)
        file.bytes[0] = 9
        assertEquals("transfer-id", client.sentFiles.single().first)
        assertArrayEquals(byteArrayOf(4, 5, 6), client.sentFiles.single().second)

        val incomingMessage = async(start = CoroutineStart.UNDISPATCHED) {
            transport.incomingMessages.first()
        }
        client.emit(HuaweiWearEngineIncomingMessage.Data(byteArrayOf(7, 8)))
        assertArrayEquals(byteArrayOf(7, 8), incomingMessage.await())

        val incomingFile = async(start = CoroutineStart.UNDISPATCHED) {
            transport.incomingFiles.first()
        }
        client.emit(HuaweiWearEngineIncomingMessage.File("incoming-id", byteArrayOf(10, 11)))
        assertEquals("incoming-id", incomingFile.await().transferId)

        transport.disconnect()
        assertEquals(WatchConnectionStatus.DISCONNECTED, transport.connectionStatus.value)
        assertTrue(client.unregistered)
    }

    @Test
    fun `missing connected device remains disconnected`() = runTest {
        val transport = HuaweiWearEngineTransport(
            client = FakeHuaweiWearEngineClient(),
            peer = PEER,
        )

        val error = runCatching { transport.connect() }.exceptionOrNull()

        assertTrue(error is WatchProtocolException)
        assertEquals(WatchProtocolErrorCode.TRANSPORT_DISCONNECTED, (error as WatchProtocolException).code)
        assertEquals(WatchConnectionStatus.DISCONNECTED, transport.connectionStatus.value)
    }

    @Test
    fun `permission failure is exposed as transport failure`() = runTest {
        val client = FakeHuaweiWearEngineClient().apply {
            connectedDevicesFailure = HuaweiWearEngineClientException(
                HuaweiWearEngineFailure.DEVICE_MANAGER_PERMISSION_REQUIRED,
            )
        }
        val transport = HuaweiWearEngineTransport(client, PEER)

        val error = runCatching { transport.connect() }.exceptionOrNull()

        assertTrue(error is WatchProtocolException)
        assertEquals(WatchProtocolErrorCode.TRANSPORT_FAILURE, (error as WatchProtocolException).code)
        assertEquals(WatchConnectionStatus.DISCONNECTED, transport.connectionStatus.value)
    }

    @Test
    fun `oversized inbound payloads are not delivered`() = runTest {
        val client = FakeHuaweiWearEngineClient(mutableListOf(DEVICE))
        val transport = HuaweiWearEngineTransport(client, PEER)
        transport.connect()

        val incomingMessage = async(start = CoroutineStart.UNDISPATCHED) {
            transport.incomingMessages.first()
        }
        client.emit(
            HuaweiWearEngineIncomingMessage.Data(
                ByteArray(transport.capabilities.inboundMessageMaxBytes + 1),
            ),
        )
        client.emit(HuaweiWearEngineIncomingMessage.Data(byteArrayOf(42)))
        assertArrayEquals(byteArrayOf(42), incomingMessage.await())

        val incomingFile = async(start = CoroutineStart.UNDISPATCHED) {
            transport.incomingFiles.first()
        }
        client.emit(
            HuaweiWearEngineIncomingMessage.File(
                "too-large",
                ByteArray(transport.capabilities.inboundFileMaxBytesExclusive),
            ),
        )
        client.emit(HuaweiWearEngineIncomingMessage.File("accepted", byteArrayOf(43)))
        assertEquals("accepted", incomingFile.await().transferId)
    }

    private class FakeHuaweiWearEngineClient(
        val devices: MutableList<HuaweiWearEngineDevice> = mutableListOf(),
    ) : HuaweiWearEngineClient {
        var connectedDevicesFailure: Throwable? = null
        var registeredDevice: HuaweiWearEngineDevice? = null
        var registeredPeer: HuaweiWearEnginePeerIdentity? = null
        var receiver: ((HuaweiWearEngineIncomingMessage) -> Unit)? = null
        var unregistered = false
        val sentMessages = mutableListOf<ByteArray>()
        val sentFiles = mutableListOf<Pair<String, ByteArray>>()

        override suspend fun connectedDevices(): List<HuaweiWearEngineDevice> {
            connectedDevicesFailure?.let { throw it }
            return devices.toList()
        }

        override suspend fun registerReceiver(
            device: HuaweiWearEngineDevice,
            peer: HuaweiWearEnginePeerIdentity,
            onMessage: (HuaweiWearEngineIncomingMessage) -> Unit,
        ) {
            registeredDevice = device
            registeredPeer = peer
            receiver = onMessage
        }

        override suspend fun unregisterReceiver() {
            unregistered = true
            receiver = null
        }

        override suspend fun sendMessage(
            device: HuaweiWearEngineDevice,
            peer: HuaweiWearEnginePeerIdentity,
            bytes: ByteArray,
        ) {
            sentMessages += bytes.copyOf()
        }

        override suspend fun sendFile(
            device: HuaweiWearEngineDevice,
            peer: HuaweiWearEnginePeerIdentity,
            transferId: String,
            bytes: ByteArray,
        ) {
            sentFiles += transferId to bytes.copyOf()
        }

        fun emit(message: HuaweiWearEngineIncomingMessage) {
            requireNotNull(receiver).invoke(message)
        }
    }

    private companion object {
        val PEER = HuaweiWearEnginePeerIdentity("org.example.watch", "AA:BB")
        val DEVICE = HuaweiWearEngineDevice("device", "Watch", "GT 4")
    }
}
