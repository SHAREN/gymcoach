package org.sharteman.gymcoach.watch.ui.diagnostics

import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.sharteman.gymcoach.BuildConfig
import org.sharteman.gymcoach.watch.domain.WatchConnectionStatus
import org.sharteman.gymcoach.watch.domain.WatchProtocol
import org.sharteman.gymcoach.watch.simulator.DebugWatchSimulatorHarness

internal class DebugWatchDiagnosticsDataSource(
    private val nowEpochMs: () -> Long = System::currentTimeMillis,
) : WatchDiagnosticsDataSource {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val harness = DebugWatchSimulatorHarness(
        phoneDeviceId = "phone-debug-diagnostics",
        scope = scope,
    )
    private val closed = AtomicBoolean(false)
    private val log = ArrayDeque<WatchDiagnosticLogEntry>()
    private val mutableSnapshot = MutableStateFlow(
        WatchDiagnosticsSnapshot(
            protocolVersion = WatchProtocol.VERSION,
            supportedSensors = listOf(
                WatchSensorDiagnostic("HEART_RATE", WatchSensorSupport.DEBUG_SIMULATED),
                WatchSensorDiagnostic("ACCELEROMETER", WatchSensorSupport.DEBUG_SIMULATED),
                WatchSensorDiagnostic("GYROSCOPE", WatchSensorSupport.DEBUG_SIMULATED),
                WatchSensorDiagnostic("WEAR_DETECTION", WatchSensorSupport.DEBUG_SIMULATED),
            ),
        ),
    )

    override val snapshot: StateFlow<WatchDiagnosticsSnapshot> = mutableSnapshot.asStateFlow()

    init {
        harness.coordinator.start()
        scope.launch {
            combine(harness.phoneState, harness.diagnostics) { phone, watch -> phone to watch }
                .collect { (phone, watch) ->
                    mutableSnapshot.update { current ->
                        current.copy(
                            connectionStatus = phone.connectionStatus,
                            lastSyncAt = phone.lastPongAt,
                            lastErrorCode = phone.lastErrorCode?.name ?: watch.lastErrorCode?.name,
                            currentHeartRateBpm = if (
                                phone.connectionStatus == WatchConnectionStatus.CONNECTED
                            ) DEBUG_HEART_RATE_BPM else null,
                            messageLatencyMs = phone.lastRoundTripMs,
                            queueSize = 0,
                            unacknowledgedEventCount = 0,
                            isSyncRunning = phone.pendingPingMessageId != null,
                        )
                    }
                }
        }
        record("LIFECYCLE", "DIAGNOSTICS_OPENED")
    }

    override suspend fun forceSync() {
        check(!closed.get())
        mutableSnapshot.update { it.copy(isSyncRunning = true, lastErrorCode = null) }
        record("SYNC", "FORCE_SYNC_REQUESTED")
        runCatching {
            if (harness.phoneState.value.connectionStatus == WatchConnectionStatus.DISCONNECTED) {
                harness.connect()
            }
            harness.ping()
        }.onSuccess {
            record("SYNC", "PING_SENT")
        }.onFailure {
            mutableSnapshot.update {
                it.copy(isSyncRunning = false, lastErrorCode = "FORCE_SYNC_FAILED")
            }
            record("SYNC", "FORCE_SYNC_FAILED")
            throw it
        }
    }

    override fun exportRedacted(): String = buildRedactedWatchDiagnosticsExport(
        snapshot = snapshot.value,
        log = synchronized(log) { log.toList() },
        androidAppVersion = BuildConfig.VERSION_NAME,
        generatedAt = nowEpochMs(),
    )

    override fun close() {
        if (!closed.compareAndSet(false, true)) return
        record("LIFECYCLE", "DIAGNOSTICS_CLOSED")
        harness.close()
        scope.cancel()
    }

    private fun record(category: String, code: String) {
        synchronized(log) {
            while (log.size >= MAX_LOG_ENTRIES) log.removeFirst()
            log.addLast(WatchDiagnosticLogEntry(nowEpochMs(), category, code))
        }
    }

    private companion object {
        const val DEBUG_HEART_RATE_BPM = 128.0
        const val MAX_LOG_ENTRIES = 200
    }
}
