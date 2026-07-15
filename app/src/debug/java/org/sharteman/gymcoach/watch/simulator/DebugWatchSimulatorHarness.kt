package org.sharteman.gymcoach.watch.simulator

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.StateFlow
import org.sharteman.gymcoach.watch.data.InMemoryProcessedWatchControlMessageStore
import org.sharteman.gymcoach.watch.data.InMemoryProcessedWatchEventStore
import org.sharteman.gymcoach.watch.domain.WatchCoordinatorState
import org.sharteman.gymcoach.watch.sync.WatchConnectionCoordinator

class DebugWatchSimulatorHarness(
    phoneDeviceId: String,
    scope: CoroutineScope,
) {
    val transport = DebugWatchSimulatorTransport()
    val coordinator = WatchConnectionCoordinator(
        phoneDeviceId = phoneDeviceId,
        transport = transport,
        processedEventStore = InMemoryProcessedWatchEventStore(),
        processedControlMessageStore = InMemoryProcessedWatchControlMessageStore(),
        scope = scope,
    )
    val phoneState: StateFlow<WatchCoordinatorState> = coordinator.state
    val diagnostics: StateFlow<DebugWatchSimulatorDiagnostics> = transport.diagnostics

    suspend fun connect() {
        coordinator.connect()
    }

    suspend fun disconnect() {
        coordinator.disconnect()
    }

    suspend fun reconnect() {
        coordinator.reconnect()
    }

    suspend fun ping(): String = coordinator.ping()

    fun close() {
        coordinator.stop()
    }
}
