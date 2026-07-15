package org.sharteman.gymcoach.watch.transport

import android.content.Context
import com.huawei.hmf.tasks.Task
import com.huawei.wearengine.HiWear
import com.huawei.wearengine.common.WearEngineErrorCode
import com.huawei.wearengine.device.Device
import com.huawei.wearengine.p2p.Message
import com.huawei.wearengine.p2p.Peer
import com.huawei.wearengine.p2p.Receiver
import com.huawei.wearengine.p2p.SendCallback
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeout

internal suspend fun <T> withWearEngineSendTimeout(
    timeoutMs: Long,
    block: suspend () -> T,
): T = try {
    withTimeout(timeoutMs) { block() }
} catch (error: TimeoutCancellationException) {
    currentCoroutineContext().ensureActive()
    throw HuaweiWearEngineClientException(HuaweiWearEngineFailure.SDK_FAILURE, error)
}

class HuaweiWearEngineSdkClient(context: Context) : HuaweiWearEngineClient {
    private val applicationContext = context.applicationContext
    private val authClient by lazy(LazyThreadSafetyMode.SYNCHRONIZED) {
        HiWear.getAuthClient(applicationContext)
    }
    private val deviceClient by lazy(LazyThreadSafetyMode.SYNCHRONIZED) {
        HiWear.getDeviceClient(applicationContext)
    }
    private val p2pClient by lazy(LazyThreadSafetyMode.SYNCHRONIZED) {
        HiWear.getP2pClient(applicationContext)
    }
    private val devices = ConcurrentHashMap<String, Device>()

    @Volatile
    private var registeredReceiver: Receiver? = null

    override suspend fun connectedDevices(): List<HuaweiWearEngineDevice> {
        val permitted = sdkCall {
            authClient.checkPermission(com.huawei.wearengine.auth.Permission.DEVICE_MANAGER).awaitResult()
        }
        if (!permitted) {
            throw HuaweiWearEngineClientException(
                HuaweiWearEngineFailure.DEVICE_MANAGER_PERMISSION_REQUIRED,
            )
        }
        return sdkCall {
            devices.clear()
            deviceClient.getBondedDevices().awaitResult()
                .asSequence()
                .filter(Device::isConnected)
                .mapNotNull { device ->
                    val uuid = device.uuid?.trim().orEmpty()
                    if (uuid.isEmpty()) return@mapNotNull null
                    devices[uuid] = device
                    HuaweiWearEngineDevice(
                        uuid = uuid,
                        name = device.name.orEmpty(),
                        model = device.model.orEmpty(),
                    )
                }
                .toList()
        }
    }

    override suspend fun registerReceiver(
        device: HuaweiWearEngineDevice,
        peer: HuaweiWearEnginePeerIdentity,
        onMessage: (HuaweiWearEngineIncomingMessage) -> Unit,
    ) {
        unregisterReceiver()
        val sdkDevice = requireDevice(device)
        val receiver = object : Receiver {
            override fun onReceiveMessage(message: Message) {
                when (message.type) {
                    Message.MESSAGE_TYPE_DATA -> message.data?.let { bytes ->
                        onMessage(HuaweiWearEngineIncomingMessage.Data(bytes.copyOf()))
                    }

                    Message.MESSAGE_TYPE_FILE -> message.file?.let { incomingFile ->
                        val transferId = message.description?.takeIf(String::isNotBlank)
                            ?: incomingFile.name
                        runCatching { incomingFile.readBytes() }
                            .onSuccess { bytes ->
                                onMessage(HuaweiWearEngineIncomingMessage.File(transferId, bytes))
                            }
                    }
                }
            }
        }
        sdkCall {
            p2pClient.registerReceiver(sdkDevice.toPeer(peer), receiver).awaitResult()
        }
        registeredReceiver = receiver
    }

    override suspend fun unregisterReceiver() {
        val receiver = registeredReceiver ?: return
        registeredReceiver = null
        sdkCall { p2pClient.unregisterReceiver(receiver).awaitResult() }
    }

    override suspend fun sendMessage(
        device: HuaweiWearEngineDevice,
        peer: HuaweiWearEnginePeerIdentity,
        bytes: ByteArray,
    ) {
        val message = Message.Builder()
            .setPayload(bytes)
            .setEnableEncrypt(true)
            .build()
        send(requireDevice(device).toPeer(peer), message)
    }

    override suspend fun sendFile(
        device: HuaweiWearEngineDevice,
        peer: HuaweiWearEnginePeerIdentity,
        transferId: String,
        bytes: ByteArray,
    ) {
        val outbox = File(applicationContext.cacheDir, OUTBOX_DIRECTORY).apply { mkdirs() }
        val payload = File.createTempFile(OUTBOX_PREFIX, OUTBOX_SUFFIX, outbox)
        try {
            payload.writeBytes(bytes)
            val message = Message.Builder()
                .setPayload(payload)
                .setDescription(transferId)
                .setEnableEncrypt(true)
                .build()
            send(requireDevice(device).toPeer(peer), message)
        } finally {
            payload.delete()
        }
    }

    private suspend fun send(peer: Peer, message: Message) = sdkCall {
        withWearEngineSendTimeout(SEND_TIMEOUT_MS) {
            suspendCancellableCoroutine { continuation ->
                val completed = AtomicBoolean(false)
                fun fail(error: Throwable) {
                    if (completed.compareAndSet(false, true) && continuation.isActive) {
                        continuation.resumeWithException(error)
                    }
                }
                val callback = object : SendCallback {
                    override fun onSendResult(resultCode: Int) {
                        if (
                            resultCode == WearEngineErrorCode.ERROR_CODE_SUCCESS ||
                            resultCode == WearEngineErrorCode.ERROR_CODE_COMM_SUCCESS ||
                            resultCode == WearEngineErrorCode.ERROR_CODE_OFFLINE_MSG_SUCCESS
                        ) {
                            if (completed.compareAndSet(false, true) && continuation.isActive) {
                                continuation.resume(Unit)
                            }
                        } else {
                            fail(IllegalStateException("Wear Engine send result: $resultCode"))
                        }
                    }

                    override fun onSendProgress(progress: Long) = Unit
                }
                p2pClient.send(peer, message, callback)
                    .addOnFailureListener(::fail)
            }
        }
    }

    private fun requireDevice(device: HuaweiWearEngineDevice): Device = devices[device.uuid]
        ?: throw HuaweiWearEngineClientException(HuaweiWearEngineFailure.DEVICE_NOT_AVAILABLE)

    private fun Device.toPeer(identity: HuaweiWearEnginePeerIdentity): Peer = Peer.Builder()
        .setDevice(this)
        .setPkgName(identity.packageName)
        .setFingerPrint(identity.fingerprint)
        .build()

    private suspend fun <T> sdkCall(block: suspend () -> T): T = try {
        block()
    } catch (error: CancellationException) {
        throw error
    } catch (error: HuaweiWearEngineClientException) {
        throw error
    } catch (error: Throwable) {
        throw HuaweiWearEngineClientException(HuaweiWearEngineFailure.SDK_FAILURE, error)
    }

    private suspend fun <T> Task<T>.awaitResult(): T = suspendCancellableCoroutine { continuation ->
        addOnCompleteListener { task ->
            when {
                task.isSuccessful && continuation.isActive -> continuation.resume(task.result)
                continuation.isActive -> continuation.resumeWithException(
                    task.exception ?: IllegalStateException("Wear Engine task failed"),
                )
            }
        }
    }

    private companion object {
        const val SEND_TIMEOUT_MS = 30_000L
        const val OUTBOX_DIRECTORY = "wear-engine-outbox"
        const val OUTBOX_PREFIX = "gymcoach-"
        const val OUTBOX_SUFFIX = ".bin"
    }
}
