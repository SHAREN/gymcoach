package org.sharteman.gymcoach.watch.ui

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import org.sharteman.gymcoach.data.local.GymCoachDao
import org.sharteman.gymcoach.watch.domain.WatchConnectionStatus
import org.sharteman.gymcoach.watch.sync.WatchCompanionRuntime
import org.sharteman.gymcoach.watch.sync.WatchSyncPreferences

data class WatchStatusState(
    val connectionStatus: WatchConnectionStatus = WatchConnectionStatus.DISCONNECTED,
    val transportConfigured: Boolean = false,
    val syncEnabled: Boolean = false,
    val queuedEvents: Int = 0,
    val peerRevision: Long? = null,
    val lastSyncAtEpochMs: Long? = null,
    val conflictCount: Int = 0,
    val lastErrorCode: String? = null,
)

class WatchStatusDataSource(
    dao: GymCoachDao,
    runtime: WatchCompanionRuntime,
    private val preferences: WatchSyncPreferences,
    scope: CoroutineScope,
) {
    val state: StateFlow<WatchStatusState> = combine(
        runtime.state,
        dao.observeReplayableWatchOutboxEventCount(),
        dao.observeLatestWatchPeer(),
        dao.observeUnresolvedWatchConflictCount(),
        preferences.enabled,
    ) { coordinator, queued, peer, conflicts, enabled ->
        WatchStatusState(
            connectionStatus = coordinator.connectionStatus,
            transportConfigured = runtime.transportConfigured,
            syncEnabled = enabled,
            queuedEvents = queued,
            peerRevision = peer?.lastRevision,
            lastSyncAtEpochMs = peer?.lastSyncAtEpochMs ?: coordinator.lastPongAt,
            conflictCount = conflicts,
            lastErrorCode = coordinator.lastErrorCode?.name ?: peer?.lastError,
        )
    }.stateIn(scope, SharingStarted.Eagerly, WatchStatusState(transportConfigured = runtime.transportConfigured))

    fun setSyncEnabled(enabled: Boolean) = preferences.setEnabled(enabled)
}
