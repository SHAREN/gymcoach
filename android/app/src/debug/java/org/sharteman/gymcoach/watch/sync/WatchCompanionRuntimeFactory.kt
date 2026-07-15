package org.sharteman.gymcoach.watch.sync

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import org.sharteman.gymcoach.BuildConfig
import org.sharteman.gymcoach.data.local.GymCoachDao
import org.sharteman.gymcoach.data.repository.GymCoachRepository
import org.sharteman.gymcoach.watch.simulator.DebugWatchSimulatorTransport
import org.sharteman.gymcoach.watch.transport.HuaweiWearEngineConfiguration
import org.sharteman.gymcoach.watch.transport.HuaweiWearEngineSdkClient
import org.sharteman.gymcoach.watch.transport.HuaweiWearEngineTransport
import org.sharteman.gymcoach.watch.transport.UnavailableWatchTransport
import org.sharteman.gymcoach.watch.transport.WatchTransportMode

object WatchCompanionRuntimeFactory {
    fun create(
        context: Context,
        phoneDeviceId: String,
        dao: GymCoachDao,
        repository: GymCoachRepository,
        scope: CoroutineScope,
    ): WatchCompanionRuntime {
        val configuration = HuaweiWearEngineConfiguration.fromBuildConfig()
        val huaweiSelected = WatchTransportMode.parse(BuildConfig.WATCH_TRANSPORT_MODE) == WatchTransportMode.HUAWEI
        val transport = if (huaweiSelected && configuration.isConfigured) {
            HuaweiWearEngineTransport(
                client = HuaweiWearEngineSdkClient(context),
                peer = configuration.peerIdentity,
                preferredDeviceUuid = configuration.preferredDeviceUuid,
            )
        } else if (huaweiSelected) {
            UnavailableWatchTransport()
        } else {
            DebugWatchSimulatorTransport(watchDeviceId = DEBUG_WATCH_DEVICE_ID)
        }
        return WatchCompanionRuntime.create(
            phoneDeviceId = phoneDeviceId,
            watchDeviceId = if (huaweiSelected) HUAWEI_WATCH_DEVICE_ID else DEBUG_WATCH_DEVICE_ID,
            dao = dao,
            repository = repository,
            transport = transport,
            scope = scope,
            transportConfigured = !huaweiSelected || configuration.isConfigured,
        )
    }

    private const val DEBUG_WATCH_DEVICE_ID = "watch-gt4-debug-simulator"
    private const val HUAWEI_WATCH_DEVICE_ID = "huawei-watch-gt4"
}
