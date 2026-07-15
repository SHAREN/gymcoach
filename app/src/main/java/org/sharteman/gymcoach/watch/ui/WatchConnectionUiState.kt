package org.sharteman.gymcoach.watch.ui

import org.sharteman.gymcoach.watch.domain.WatchConnectionStatus
import org.sharteman.gymcoach.watch.domain.WatchCoordinatorState

data class WatchConnectionUiState(
    val connectionStatus: WatchConnectionStatus,
    val isPingPending: Boolean,
    val lastRoundTripMs: Long?,
    val processedControlMessageCount: Long,
    val processedEventCount: Long,
    val duplicateControlMessageCount: Long,
    val duplicateEventCount: Long,
    val rejectedMessageCount: Long,
    val lastErrorCode: String?,
)

fun WatchCoordinatorState.toUiState() = WatchConnectionUiState(
    connectionStatus = connectionStatus,
    isPingPending = pendingPingMessageId != null,
    lastRoundTripMs = lastRoundTripMs,
    processedControlMessageCount = processedControlMessageCount,
    processedEventCount = processedEventCount,
    duplicateControlMessageCount = duplicateControlMessageCount,
    duplicateEventCount = duplicateEventCount,
    rejectedMessageCount = rejectedMessageCount,
    lastErrorCode = lastErrorCode?.name,
)
