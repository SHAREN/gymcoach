package org.sharteman.gymcoach.data.diagnostics

import android.os.Build
import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.sharteman.gymcoach.data.errors.UserFacingError
import org.sharteman.gymcoach.data.errors.sanitizeDiagnosticText

@Serializable
data class AppErrorReportQueueState(
    val pendingCount: Int,
    val blockedItemId: String? = null,
    val operationType: String? = null,
    val attemptCount: Int? = null,
    val createdAtUtc: String? = null,
    val lastRetryAtUtc: String? = null,
)

@Serializable
data class AppErrorReportDevice(
    val androidVersion: String,
    val apiLevel: Int,
    val manufacturer: String,
    val model: String,
    val locale: String,
    val timezone: String,
    val networkState: String,
)

@Serializable
data class AppErrorReportProblem(
    val category: String,
    val retryable: Boolean,
    val recoveryAction: String,
    val dataState: String,
    val operation: String,
    val errorCode: String? = null,
    val httpStatus: Int? = null,
    val correlationId: String? = null,
    val sanitizedServerResponse: String? = null,
    val exceptionClass: String? = null,
    val sanitizedStackTrace: String? = null,
)

@Serializable
data class AppErrorReportPayload(
    val schemaVersion: Int = 1,
    val generatedAtUtc: String,
    val generatedAtLocal: String,
    val app: SettingsDiagnosticAppInfo,
    val device: AppErrorReportDevice,
    val problem: AppErrorReportProblem,
    val queue: AppErrorReportQueueState,
    val recentDiagnosticEvents: List<SettingsDiagnosticEvent>,
)

fun SettingsDiagnostics.buildErrorReport(
    error: UserFacingError,
    pendingCount: Int,
    online: Boolean?,
    nowEpochMs: Long = System.currentTimeMillis(),
): String = buildAppErrorReportForTest(
    error = error,
    pendingCount = pendingCount,
    online = online,
    appInfo = appInfo(),
    networkClass = networkClass(),
    recentEvents = snapshot().takeLast(MAX_REPORT_EVENTS),
    nowEpochMs = nowEpochMs,
    device = AppErrorReportDevice(
        androidVersion = sanitizeDeviceLabel(Build.VERSION.RELEASE, "unknown"),
        apiLevel = Build.VERSION.SDK_INT,
        manufacturer = sanitizeDeviceLabel(Build.MANUFACTURER, "unknown"),
        model = sanitizeDeviceLabel(Build.MODEL, "unknown"),
        locale = Locale.getDefault().toLanguageTag().take(64),
        timezone = ZoneId.systemDefault().id.take(80),
        networkState = reportNetworkState(online, networkClass()),
    ),
)

internal fun buildAppErrorReportForTest(
    error: UserFacingError,
    pendingCount: Int,
    online: Boolean?,
    appInfo: SettingsDiagnosticAppInfo,
    networkClass: String,
    recentEvents: List<SettingsDiagnosticEvent>,
    nowEpochMs: Long,
    device: AppErrorReportDevice = AppErrorReportDevice(
        androidVersion = "test",
        apiLevel = 35,
        manufacturer = "test",
        model = "test",
        locale = "en-US",
        timezone = "UTC",
        networkState = reportNetworkState(online, networkClass),
    ),
): String {
    val technical = error.technical
    val instant = Instant.ofEpochMilli(nowEpochMs)
    val payload = AppErrorReportPayload(
        generatedAtUtc = instant.toString(),
        generatedAtLocal = ZonedDateTime.ofInstant(instant, ZoneId.of(device.timezone))
            .format(DateTimeFormatter.ISO_OFFSET_DATE_TIME),
        app = appInfo.copy(
            packageName = sanitizeDeviceLabel(appInfo.packageName, "unknown-package"),
            versionName = sanitizeDeviceLabel(appInfo.versionName, "unknown-version"),
            buildType = sanitizeDeviceLabel(appInfo.buildType, "unknown-build"),
            commit = safeCommit(appInfo.commit),
        ),
        device = device.copy(
            androidVersion = sanitizeDeviceLabel(device.androidVersion, "unknown"),
            manufacturer = sanitizeDeviceLabel(device.manufacturer, "unknown"),
            model = sanitizeDeviceLabel(device.model, "unknown"),
            locale = sanitizeDeviceLabel(device.locale, "unknown"),
            timezone = sanitizeDeviceLabel(device.timezone, "unknown"),
            networkState = sanitizeDeviceLabel(device.networkState, "unknown"),
        ),
        problem = AppErrorReportProblem(
            category = error.category.name,
            retryable = error.retryable,
            recoveryAction = error.recoveryAction.name,
            dataState = error.dataState.name,
            operation = error.operation.name,
            errorCode = technical.errorCode,
            httpStatus = technical.httpStatus,
            correlationId = technical.correlationId,
            sanitizedServerResponse = sanitizeDiagnosticText(technical.sanitizedServerResponse),
            exceptionClass = technical.exceptionClass,
            sanitizedStackTrace = sanitizeDiagnosticText(technical.sanitizedStackTrace),
        ),
        queue = AppErrorReportQueueState(
            pendingCount = pendingCount.coerceAtLeast(0),
            blockedItemId = technical.queueItemId,
            operationType = technical.operationType,
            attemptCount = technical.attemptCount,
            createdAtUtc = technical.createdAtEpochMs?.let { Instant.ofEpochMilli(it).toString() },
            lastRetryAtUtc = technical.lastRetryAtEpochMs?.let { Instant.ofEpochMilli(it).toString() },
        ),
        recentDiagnosticEvents = recentEvents
            .takeLast(MAX_REPORT_EVENTS)
            .map(SettingsDiagnosticEvent::sanitizedForPersistence),
    )
    val json = reportJson.encodeToString(payload)
    return buildString {
        appendLine("GymCoach error report")
        appendLine("Generated UTC: ${payload.generatedAtUtc}")
        appendLine("Generated local: ${payload.generatedAtLocal}")
        appendLine("App: ${payload.app.versionName} (${payload.app.versionCode})")
        appendLine("Source commit: ${payload.app.commit}")
        appendLine("Build type: ${payload.app.buildType}")
        appendLine("Android: ${payload.device.androidVersion} / API ${payload.device.apiLevel}")
        appendLine("Device: ${payload.device.manufacturer} ${payload.device.model}")
        appendLine("Locale/timezone: ${payload.device.locale} / ${payload.device.timezone}")
        appendLine("Network: ${payload.device.networkState}")
        appendLine("Category: ${payload.problem.category}")
        appendLine("Retryable: ${payload.problem.retryable}")
        appendLine("Data state: ${payload.problem.dataState}")
        appendLine("Operation: ${payload.problem.operation}")
        appendLine("Queue item: ${payload.queue.blockedItemId ?: "not available"}")
        appendLine("Attempts: ${payload.queue.attemptCount ?: "not available"}")
        appendLine("HTTP status: ${payload.problem.httpStatus ?: "not available"}")
        appendLine("Correlation ID: ${payload.problem.correlationId ?: "not available"}")
        appendLine()
        appendLine("Sanitized machine-readable details:")
        append(json)
        appendLine()
    }
}

private fun reportNetworkState(online: Boolean?, networkClass: String): String = when (online) {
    true -> "online-${safeDiagnosticLabel(networkClass, "unknown") ?: "unknown"}"
    false -> "offline"
    null -> "unknown-${safeDiagnosticLabel(networkClass, "unknown") ?: "unknown"}"
}

private fun sanitizeDeviceLabel(value: String?, fallback: String): String = value
    ?.trim()
    ?.takeIf { SAFE_DEVICE_LABEL.matches(it) }
    ?.take(80)
    ?: fallback

private val reportJson = Json {
    encodeDefaults = true
    explicitNulls = true
    prettyPrint = true
}
private val SAFE_DEVICE_LABEL = Regex("^[A-Za-z0-9 ._+:/-]{1,80}$")
private const val MAX_REPORT_EVENTS = 30
