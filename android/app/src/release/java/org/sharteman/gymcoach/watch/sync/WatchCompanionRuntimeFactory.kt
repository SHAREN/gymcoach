package org.sharteman.gymcoach.watch.sync

import kotlinx.coroutines.CoroutineScope
import org.sharteman.gymcoach.data.local.GymCoachDao
import org.sharteman.gymcoach.data.repository.GymCoachRepository
import org.sharteman.gymcoach.watch.transport.UnavailableWatchTransport

object WatchCompanionRuntimeFactory {
    fun create(
        phoneDeviceId: String,
        dao: GymCoachDao,
        repository: GymCoachRepository,
        scope: CoroutineScope,
    ): WatchCompanionRuntime = WatchCompanionRuntime.create(
        phoneDeviceId = phoneDeviceId,
        watchDeviceId = "unavailable-huawei-watch",
        dao = dao,
        repository = repository,
        transport = UnavailableWatchTransport(),
        scope = scope,
        transportConfigured = false,
    )
}
