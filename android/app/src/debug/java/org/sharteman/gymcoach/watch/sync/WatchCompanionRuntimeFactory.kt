package org.sharteman.gymcoach.watch.sync

import kotlinx.coroutines.CoroutineScope
import org.sharteman.gymcoach.data.local.GymCoachDao
import org.sharteman.gymcoach.data.repository.GymCoachRepository
import org.sharteman.gymcoach.watch.simulator.DebugWatchSimulatorTransport

object WatchCompanionRuntimeFactory {
    fun create(
        phoneDeviceId: String,
        dao: GymCoachDao,
        repository: GymCoachRepository,
        scope: CoroutineScope,
    ): WatchCompanionRuntime = WatchCompanionRuntime.create(
        phoneDeviceId = phoneDeviceId,
        watchDeviceId = DEBUG_WATCH_DEVICE_ID,
        dao = dao,
        repository = repository,
        transport = DebugWatchSimulatorTransport(watchDeviceId = DEBUG_WATCH_DEVICE_ID),
        scope = scope,
        transportConfigured = true,
    )

    private const val DEBUG_WATCH_DEVICE_ID = "watch-gt4-debug-simulator"
}
