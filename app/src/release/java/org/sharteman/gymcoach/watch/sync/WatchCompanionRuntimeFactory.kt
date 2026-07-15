package org.sharteman.gymcoach.watch.sync

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import org.sharteman.gymcoach.data.local.GymCoachDao
import org.sharteman.gymcoach.data.repository.GymCoachRepository
import org.sharteman.gymcoach.watch.transport.HuaweiWearEngineConfiguration
import org.sharteman.gymcoach.watch.transport.HuaweiWearEngineSdkClient
import org.sharteman.gymcoach.watch.transport.HuaweiWearEngineTransport
import org.sharteman.gymcoach.watch.transport.UnavailableWatchTransport

object WatchCompanionRuntimeFactory {
    fun create(
        context: Context,
        phoneDeviceId: String,
        dao: GymCoachDao,
        repository: GymCoachRepository,
        scope: CoroutineScope,
    ): WatchCompanionRuntime {
        val configuration = HuaweiWearEngineConfiguration.fromBuildConfig()
        val transport = if (configuration.isConfigured) {
            HuaweiWearEngineTransport(
                client = HuaweiWearEngineSdkClient(context),
                peer = configuration.peerIdentity,
                preferredDeviceUuid = configuration.preferredDeviceUuid,
            )
        } else {
            UnavailableWatchTransport()
        }
        return WatchCompanionRuntime.create(
            phoneDeviceId = phoneDeviceId,
            watchDeviceId = if (configuration.isConfigured) HUAWEI_WATCH_DEVICE_ID else UNAVAILABLE_WATCH_DEVICE_ID,
            dao = dao,
            repository = repository,
            transport = transport,
            scope = scope,
            transportConfigured = configuration.isConfigured,
        )
    }

    private const val HUAWEI_WATCH_DEVICE_ID = "huawei-watch-gt4"
    private const val UNAVAILABLE_WATCH_DEVICE_ID = "unavailable-huawei-watch"
}
