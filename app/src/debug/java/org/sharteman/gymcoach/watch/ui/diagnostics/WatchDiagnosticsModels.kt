package org.sharteman.gymcoach.watch.ui.diagnostics

import kotlinx.coroutines.flow.StateFlow
import org.sharteman.gymcoach.watch.domain.WatchConnectionStatus

enum class WatchSensorSupport {
    AVAILABLE,
    DEBUG_SIMULATED,
    UNAVAILABLE,
}

data class WatchSensorDiagnostic(
    val type: String,
    val support: WatchSensorSupport,
)

data class WatchDiagnosticLogEntry(
    val timestamp: Long,
    val category: String,
    val code: String,
)

data class WatchDiagnosticsSnapshot(
    val watchModel: String = "Huawei Watch GT 4 debug simulator",
    val connectionStatus: WatchConnectionStatus = WatchConnectionStatus.DISCONNECTED,
    val watchAppVersion: String = "debug-simulator",
    val protocolVersion: String,
    val lastSyncAt: Long? = null,
    val unacknowledgedEventCount: Int = 0,
    val lastErrorCode: String? = null,
    val supportedSensors: List<WatchSensorDiagnostic> = emptyList(),
    val currentHeartRateBpm: Double? = null,
    val messageLatencyMs: Long? = null,
    val queueSize: Int = 0,
    val conflictCount: Int = 0,
    val isSyncRunning: Boolean = false,
)

interface WatchDiagnosticsDataSource : AutoCloseable {
    val snapshot: StateFlow<WatchDiagnosticsSnapshot>

    suspend fun forceSync()

    fun exportRedacted(): String
}
