package org.sharteman.gymcoach.watch.transport

data class HuaweiWearEngineDevice(
    val uuid: String,
    val name: String,
    val model: String,
)

data class HuaweiWearEnginePeerIdentity(
    val packageName: String,
    val fingerprint: String,
)

sealed interface HuaweiWearEngineIncomingMessage {
    data class Data(val bytes: ByteArray) : HuaweiWearEngineIncomingMessage

    data class File(
        val transferId: String,
        val bytes: ByteArray,
    ) : HuaweiWearEngineIncomingMessage
}

enum class HuaweiWearEngineFailure {
    DEVICE_MANAGER_PERMISSION_REQUIRED,
    NO_CONNECTED_DEVICE,
    DEVICE_NOT_AVAILABLE,
    SDK_FAILURE,
}

class HuaweiWearEngineClientException(
    val failure: HuaweiWearEngineFailure,
    cause: Throwable? = null,
) : Exception(failure.name, cause)

interface HuaweiWearEngineClient {
    suspend fun connectedDevices(): List<HuaweiWearEngineDevice>

    suspend fun registerReceiver(
        device: HuaweiWearEngineDevice,
        peer: HuaweiWearEnginePeerIdentity,
        onMessage: (HuaweiWearEngineIncomingMessage) -> Unit,
    )

    suspend fun unregisterReceiver()

    suspend fun sendMessage(
        device: HuaweiWearEngineDevice,
        peer: HuaweiWearEnginePeerIdentity,
        bytes: ByteArray,
    )

    suspend fun sendFile(
        device: HuaweiWearEngineDevice,
        peer: HuaweiWearEnginePeerIdentity,
        transferId: String,
        bytes: ByteArray,
    )
}
