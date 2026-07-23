package org.sharteman.gymcoach.data.diagnostics

import kotlinx.serialization.Serializable
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import org.sharteman.gymcoach.data.settings.SettingsException

data class SettingsRequestDiagnostic(
    val attemptId: String?,
    val correlationId: String?,
    val subrequest: String?,
    val origin: String,
    val path: String,
    val method: String,
    val statusCode: Int?,
    val category: String,
    val durationMs: Long,
    val retryDecision: String = "none",
    val authOutcome: String? = null,
    val errorCode: String? = null,
    val exception: Throwable? = null,
)

data class SettingsEndpointDiagnostic(
    val origin: String,
    val decision: String,
    val category: String,
    val exception: Throwable? = null,
)

interface SettingsDiagnosticSink {
    fun recordRequest(input: SettingsRequestDiagnostic) = Unit

    fun recordAttempt(
        attemptId: String,
        phase: String,
        section: String? = null,
        error: SettingsException? = null,
    ) = Unit

    fun recordEndpoint(input: SettingsEndpointDiagnostic) = Unit
}

object NoOpSettingsDiagnosticSink : SettingsDiagnosticSink

@Serializable
data class SettingsDiagnosticAppInfo(
    val packageName: String,
    val versionName: String,
    val versionCode: Int,
    val buildType: String,
    val commit: String,
)

@Serializable
data class SettingsDiagnosticAuthority(
    val selected: String? = null,
    val primary: String? = null,
    val fallback: String? = null,
    val session: String? = null,
)

@Serializable
data class SettingsDiagnosticEvent(
    val schemaVersion: Int = 1,
    val eventId: String,
    val utcTimestamp: String,
    val deviceEpochMs: Long,
    val elapsedRealtimeMs: Long,
    val kind: String,
    val app: SettingsDiagnosticAppInfo,
    val attemptId: String? = null,
    val correlationId: String? = null,
    val subrequest: String? = null,
    val origin: String? = null,
    val path: String? = null,
    val method: String? = null,
    val authority: SettingsDiagnosticAuthority = SettingsDiagnosticAuthority(),
    val statusCode: Int? = null,
    val category: String,
    val errorCode: String? = null,
    val authOutcome: String? = null,
    val durationMs: Long? = null,
    val retryDecision: String? = null,
    val networkClass: String,
    val exceptionClass: String? = null,
    val appState: String,
    val lifecycleMarker: String? = null,
)

data class SettingsDiagnosticRetentionPolicy(
    val maxEvents: Int = 500,
    val maxBytes: Int = 128 * 1024,
    val maxAgeMs: Long = 7L * 24L * 60L * 60L * 1000L,
) {
    init {
        require(maxEvents > 0)
        require(maxBytes > 0)
        require(maxAgeMs > 0)
    }
}

@Serializable
data class SettingsDiagnosticAccountState(
    val loggedIn: Boolean,
    val selectedAuthority: String?,
    val primaryAuthority: String?,
    val fallbackAuthority: String?,
    val sessionAuthority: String?,
)

internal fun sanitizeOrigin(value: String?): String? {
    val url = value?.trim()?.toHttpUrlOrNull() ?: return null
    val defaultPort = (url.scheme == "https" && url.port == 443) ||
        (url.scheme == "http" && url.port == 80)
    return buildString {
        append(url.scheme)
        append("://")
        append(url.host)
        if (!defaultPort) {
            append(':')
            append(url.port)
        }
    }.take(MAX_SAFE_TEXT)
}

internal fun sanitizePath(value: String?): String? {
    val raw = value?.substringBefore('?')?.substringBefore('#') ?: return null
    val normalized = raw
        .replace(GYM_ROUTE_ID_PATTERN, ":gymId")
        .replace(EQUIPMENT_ROUTE_ID_PATTERN, ":equipmentId")
        .replace(UUID_PATTERN, ":id")
        .replace(CUID_PATTERN, ":id")
    return normalized.take(MAX_SAFE_TEXT).takeIf { SAFE_PATH.matches(it) }
}

internal fun safeCorrelation(value: String?): String? {
    val candidate = value?.trim() ?: return null
    if (!SAFE_CORRELATION.matches(candidate)) return null
    if (TOKEN_SHAPE.matches(candidate) || TOKEN_HASH.matches(candidate)) return null
    return candidate
}

internal fun safeDiagnosticLabel(value: String?, fallback: String? = null): String? {
    val input = value?.trim() ?: return fallback
    if (SENSITIVE_TEXT_PATTERNS.any { it.containsMatchIn(input) }) return fallback
    return input.lowercase()
        .replace(Regex("[^a-z0-9._:-]+"), "-")
        .trim('-')
        .take(64)
        .takeIf { it.isNotEmpty() }
        ?: fallback
}

internal fun safeExceptionClass(error: Throwable?): String? = generateSequence(error) { it.cause }
    .take(8)
    .mapNotNull { cause ->
        cause.javaClass.simpleName
            .takeIf { SAFE_CLASS.matches(it) }
            ?.take(80)
    }
    .lastOrNull()

internal fun safeCommit(value: String): String = value.trim()
    .takeIf { Regex("^[A-Za-z0-9._-]{1,64}$").matches(it) }
    ?: "unknown"

internal fun safeMethod(value: String?): String? = value
    ?.uppercase()
    ?.takeIf { SAFE_METHOD.matches(it) }

internal fun SettingsDiagnosticEvent.sanitizedForPersistence(): SettingsDiagnosticEvent = copy(
    eventId = safeCorrelation(eventId) ?: "redacted-event",
    kind = safeDiagnosticLabel(kind, "event") ?: "event",
    app = SettingsDiagnosticAppInfo(
        packageName = safeBuildText(app.packageName, "unknown-package"),
        versionName = safeBuildText(app.versionName, "unknown-version"),
        versionCode = app.versionCode.coerceAtLeast(0),
        buildType = safeBuildText(app.buildType, "unknown-build"),
        commit = safeCommit(app.commit),
    ),
    attemptId = safeCorrelation(attemptId),
    correlationId = safeCorrelation(correlationId),
    subrequest = safeDiagnosticLabel(subrequest),
    origin = sanitizeOrigin(origin),
    path = sanitizePath(path),
    method = safeMethod(method),
    authority = SettingsDiagnosticAuthority(
        selected = sanitizeOrigin(authority.selected),
        primary = sanitizeOrigin(authority.primary),
        fallback = sanitizeOrigin(authority.fallback),
        session = sanitizeOrigin(authority.session),
    ),
    statusCode = statusCode?.takeIf { it in 100..599 },
    category = safeDiagnosticLabel(category, "redacted") ?: "redacted",
    errorCode = safeDiagnosticLabel(errorCode),
    authOutcome = safeDiagnosticLabel(authOutcome),
    durationMs = durationMs?.coerceIn(0, 300_000),
    retryDecision = safeDiagnosticLabel(retryDecision),
    networkClass = safeDiagnosticLabel(networkClass, "unknown") ?: "unknown",
    exceptionClass = exceptionClass?.takeIf { SAFE_CLASS.matches(it) },
    appState = safeDiagnosticLabel(appState, "unknown") ?: "unknown",
    lifecycleMarker = safeDiagnosticLabel(lifecycleMarker),
)

private fun safeBuildText(value: String, fallback: String): String {
    if (SENSITIVE_TEXT_PATTERNS.any { it.containsMatchIn(value) }) return fallback
    return value.take(80).takeIf { SAFE_BUILD_TEXT.matches(it) } ?: fallback
}

private val SAFE_CORRELATION = Regex("^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
private val TOKEN_SHAPE = Regex("^gma_[A-Za-z0-9_-]{43}$")
private val TOKEN_HASH = Regex("^[A-Fa-f0-9]{64}$")
private val SAFE_METHOD = Regex("^[A-Z]{1,12}$")
private val SAFE_CLASS = Regex("^[A-Za-z][A-Za-z0-9_$]{0,79}$")
private val SAFE_BUILD_TEXT = Regex("^[A-Za-z0-9._+-]{1,80}$")
private val SAFE_PATH = Regex("^/[A-Za-z0-9._~!$&'()*+,;=:@%/-]{0,255}$")
private val UUID_PATTERN = Regex(
    "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}",
)
private val GYM_ROUTE_ID_PATTERN = Regex("(?<=/api/gyms/)[^/]+")
private val EQUIPMENT_ROUTE_ID_PATTERN = Regex("(?<=/api/gym-equipment/)[^/]+")
private val CUID_PATTERN = Regex("(?i)\\bc[a-z0-9]{20,31}\\b")
private val SENSITIVE_TEXT_PATTERNS = listOf(
    Regex("(?i)bearer\\s+[^\\s]+"),
    Regex("(?i)(password|cookie|session[_-]?token)\\s*[:=]\\s*[^\\s]+"),
    Regex("[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}"),
    Regex("gma_[A-Za-z0-9_-]{43}"),
    Regex("(?i)^[a-f0-9]{64}$"),
    Regex("[A-Za-z]:\\\\"),
    Regex("/(?:home|users)/", RegexOption.IGNORE_CASE),
)
private const val MAX_SAFE_TEXT = 256
