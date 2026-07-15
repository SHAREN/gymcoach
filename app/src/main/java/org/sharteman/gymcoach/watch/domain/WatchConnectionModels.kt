package org.sharteman.gymcoach.watch.domain

enum class WatchConnectionStatus {
    DISCONNECTED,
    CONNECTING,
    CONNECTED,
}

enum class WatchProtocolErrorCode {
    INVALID_JSON,
    INVALID_EVENT,
    INVALID_SOURCE,
    MESSAGE_TOO_LARGE,
    FILE_TOO_LARGE,
    FILE_LENGTH_MISMATCH,
    FILE_HASH_MISMATCH,
    FILE_PAIR_MISMATCH,
    FILE_SEQUENCE_GAP,
    UNSUPPORTED_PROTOCOL,
    TRANSPORT_DISCONNECTED,
    TRANSPORT_FAILURE,
}

class WatchProtocolException(
    val code: WatchProtocolErrorCode,
) : IllegalArgumentException(code.name)

data class WatchCoordinatorState(
    val connectionStatus: WatchConnectionStatus = WatchConnectionStatus.DISCONNECTED,
    val connectionChangedAt: Long? = null,
    val pendingPingMessageId: String? = null,
    val pendingPingSentAt: Long? = null,
    val lastPongAt: Long? = null,
    val lastRoundTripMs: Long? = null,
    val sentMessageCount: Long = 0,
    val receivedMessageCount: Long = 0,
    val processedControlMessageCount: Long = 0,
    val processedEventCount: Long = 0,
    val duplicateControlMessageCount: Long = 0,
    val duplicateEventCount: Long = 0,
    val rejectedMessageCount: Long = 0,
    val lastErrorCode: WatchProtocolErrorCode? = null,
)
