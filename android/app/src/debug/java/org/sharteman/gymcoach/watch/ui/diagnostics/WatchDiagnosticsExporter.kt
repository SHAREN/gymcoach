package org.sharteman.gymcoach.watch.ui.diagnostics

import java.util.Locale
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.sharteman.gymcoach.watch.domain.WatchProtocolErrorCode

private val unsafeLabelCharacters = Regex("[^\\p{L}\\p{N} ._()/-]")
private val exportJson = Json {
    prettyPrint = true
    encodeDefaults = true
}
private val knownErrorCodes = WatchProtocolErrorCode.entries.mapTo(mutableSetOf()) { it.name }.apply {
    add("FORCE_SYNC_FAILED")
    add("NO_ROUTE")
}
private val knownLogCategories = setOf(
    "CONFLICT",
    "LIFECYCLE",
    "PROTOCOL",
    "QUEUE",
    "SENSOR",
    "SYNC",
    "TRANSPORT",
)
private val knownLogCodes = knownErrorCodes + setOf(
    "DIAGNOSTICS_CLOSED",
    "DIAGNOSTICS_OPENED",
    "FORCE_SYNC_REQUESTED",
    "PING_SENT",
)

@Serializable
private data class RedactedWatchDiagnosticsExport(
    val formatVersion: Int = 1,
    val generatedAt: Long,
    val androidAppVersion: String,
    val watchModel: String,
    val connectionStatus: String,
    val watchAppVersion: String,
    val protocolVersion: String,
    val lastSyncAt: Long?,
    val unacknowledgedEventCount: Int,
    val lastErrorCode: String?,
    val supportedSensors: List<RedactedSensor>,
    val heartRateStreamActive: Boolean,
    val messageLatencyMs: Long?,
    val queueSize: Int,
    val conflictCount: Int,
    val log: List<RedactedLogEntry>,
)

@Serializable
private data class RedactedSensor(
    val type: String,
    val support: String,
)

@Serializable
private data class RedactedLogEntry(
    val timestamp: Long,
    val category: String,
    val code: String,
)

internal fun buildRedactedWatchDiagnosticsExport(
    snapshot: WatchDiagnosticsSnapshot,
    log: List<WatchDiagnosticLogEntry>,
    androidAppVersion: String,
    generatedAt: Long,
): String = exportJson.encodeToString(
    RedactedWatchDiagnosticsExport(
        generatedAt = generatedAt,
        androidAppVersion = safeLabel(androidAppVersion),
        watchModel = safeLabel(snapshot.watchModel),
        connectionStatus = snapshot.connectionStatus.name,
        watchAppVersion = safeLabel(snapshot.watchAppVersion),
        protocolVersion = safeLabel(snapshot.protocolVersion),
        lastSyncAt = snapshot.lastSyncAt,
        unacknowledgedEventCount = snapshot.unacknowledgedEventCount.coerceAtLeast(0),
        lastErrorCode = safeCode(snapshot.lastErrorCode, knownErrorCodes),
        supportedSensors = snapshot.supportedSensors.map {
            RedactedSensor(type = safeLabel(it.type), support = it.support.name)
        },
        heartRateStreamActive = snapshot.currentHeartRateBpm != null,
        messageLatencyMs = snapshot.messageLatencyMs?.coerceAtLeast(0),
        queueSize = snapshot.queueSize.coerceAtLeast(0),
        conflictCount = snapshot.conflictCount.coerceAtLeast(0),
        log = log.takeLast(MAX_EXPORTED_LOG_ENTRIES).map {
            RedactedLogEntry(
                timestamp = it.timestamp,
                category = safeCode(it.category, knownLogCategories) ?: "REDACTED",
                code = safeCode(it.code, knownLogCodes) ?: "REDACTED",
            )
        },
    ),
)

private fun safeCode(value: String?, allowlist: Set<String>): String? = value
    ?.uppercase(Locale.ROOT)
    ?.takeIf(allowlist::contains)
    ?: value?.let { "REDACTED" }

private fun safeLabel(value: String): String = value
    .replace(unsafeLabelCharacters, "?")
    .take(MAX_SAFE_LABEL_LENGTH)

private const val MAX_SAFE_LABEL_LENGTH = 80
private const val MAX_EXPORTED_LOG_ENTRIES = 100
