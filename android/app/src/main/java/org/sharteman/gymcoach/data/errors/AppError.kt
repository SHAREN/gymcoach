package org.sharteman.gymcoach.data.errors

import android.database.sqlite.SQLiteException
import java.io.FileNotFoundException
import java.io.IOException
import java.io.InterruptedIOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.Locale
import javax.net.ssl.SSLException
import kotlinx.serialization.SerializationException
import org.sharteman.gymcoach.data.coach.CoachApiException
import org.sharteman.gymcoach.data.network.ApiException
import org.sharteman.gymcoach.data.repository.MobileAuthenticationRequiredException
import org.sharteman.gymcoach.data.settings.SettingsErrorKind
import org.sharteman.gymcoach.data.settings.SettingsException

enum class AppErrorCategory {
    OFFLINE,
    TIMEOUT,
    SERVER_TEMPORARY,
    AUTH_REQUIRED,
    APP_UPDATE_REQUIRED,
    CLIENT_SERVER_INCOMPATIBLE,
    VALIDATION_OR_LEGACY_OPERATION,
    CONFLICT,
    NOT_FOUND_OR_DELETED,
    LOCAL_STORAGE,
    PERMISSION_OR_FILE_EXPORT,
    UNKNOWN,
}

enum class AppErrorDataState {
    SAVED_LOCALLY,
    QUEUED_LOCALLY,
    NOT_SAVED,
    UNKNOWN,
}

enum class AppErrorOperation {
    SYNC,
    LOAD,
    SAVE,
    DELETE,
    SIGN_IN,
    IMPORT,
    EXPORT,
    UPDATE,
    OTHER,
}

enum class AppErrorRecoveryAction {
    RETRY,
    SIGN_IN,
    UPDATE_APP,
    REVIEW_INPUT,
    REFRESH,
    REMOVE_QUEUED_OPERATION,
    CHOOSE_ANOTHER_FILE,
    CONTACT_SUPPORT,
    NONE,
}

data class AppErrorContext(
    val categoryHint: AppErrorCategory? = null,
    val operation: AppErrorOperation = AppErrorOperation.OTHER,
    val dataState: AppErrorDataState = AppErrorDataState.UNKNOWN,
    val online: Boolean? = null,
    val operationType: String? = null,
    val queueItemId: String? = null,
    val attemptCount: Int? = null,
    val createdAtEpochMs: Long? = null,
    val lastRetryAtEpochMs: Long? = null,
    val httpStatus: Int? = null,
    val correlationId: String? = null,
    val errorCode: String? = null,
    val serverResponse: String? = null,
    val exceptionClass: String? = null,
    val stackTrace: String? = null,
)

data class AppErrorTechnicalDetails(
    val category: AppErrorCategory,
    val errorCode: String?,
    val operationType: String?,
    val queueItemId: String?,
    val attemptCount: Int?,
    val createdAtEpochMs: Long?,
    val lastRetryAtEpochMs: Long?,
    val httpStatus: Int?,
    val correlationId: String?,
    val sanitizedServerResponse: String?,
    val exceptionClass: String?,
    val sanitizedStackTrace: String?,
)

data class UserFacingError(
    val category: AppErrorCategory,
    val dataState: AppErrorDataState,
    val operation: AppErrorOperation,
    val retryable: Boolean,
    val recoveryAction: AppErrorRecoveryAction,
    val technical: AppErrorTechnicalDetails,
)

fun classifyAppError(
    error: Throwable?,
    context: AppErrorContext = AppErrorContext(),
): UserFacingError {
    val causes = generateSequence(error) { it.cause }.take(MAX_CAUSE_DEPTH).toList()
    val apiError = causes.filterIsInstance<ApiException>().firstOrNull()
    val settingsError = causes.filterIsInstance<SettingsException>().firstOrNull()
    val coachError = causes.filterIsInstance<CoachApiException>().firstOrNull()
    val status = context.httpStatus ?: apiError?.statusCode ?: settingsError?.statusCode ?: coachError?.statusCode
    val rawServerResponse = context.serverResponse
        ?: apiError?.serverResponse
        ?: apiError?.serverMessage
        ?: settingsError?.serverMessage
        ?: error?.message
    val errorCode = context.errorCode ?: apiError?.errorCode ?: settingsError?.errorCode
    val category = context.categoryHint ?: classifyCategory(
        causes = causes,
        settingsError = settingsError,
        status = status,
        errorCode = errorCode,
        serverResponse = rawServerResponse,
        context = context,
    )
    val retryable = isRetryable(category)
    return UserFacingError(
        category = category,
        dataState = context.dataState,
        operation = context.operation,
        retryable = retryable,
        recoveryAction = recoveryAction(category, context),
        technical = AppErrorTechnicalDetails(
            category = category,
            errorCode = sanitizeDiagnosticIdentifier(errorCode),
            operationType = sanitizeDiagnosticIdentifier(context.operationType),
            queueItemId = sanitizeDiagnosticIdentifier(context.queueItemId),
            attemptCount = context.attemptCount?.coerceAtLeast(0),
            createdAtEpochMs = context.createdAtEpochMs?.takeIf { it > 0 },
            lastRetryAtEpochMs = context.lastRetryAtEpochMs?.takeIf { it > 0 },
            httpStatus = status?.takeIf { it in 100..599 },
            correlationId = sanitizeDiagnosticIdentifier(
                context.correlationId ?: apiError?.correlationId ?: settingsError?.correlationId,
            ),
            sanitizedServerResponse = sanitizeDiagnosticText(rawServerResponse),
            exceptionClass = sanitizeExceptionClass(context.exceptionClass ?: error?.javaClass?.name),
            sanitizedStackTrace = context.stackTrace?.let(::sanitizeDiagnosticText)
                ?: error?.let(::sanitizedStackTrace),
        ),
    )
}

private fun classifyCategory(
    causes: List<Throwable>,
    settingsError: SettingsException?,
    status: Int?,
    errorCode: String?,
    serverResponse: String?,
    context: AppErrorContext,
): AppErrorCategory {
    if (causes.any { it is MobileAuthenticationRequiredException }) {
        return AppErrorCategory.AUTH_REQUIRED
    }
    settingsError?.let { return it.kind.toAppErrorCategory() }
    status?.let {
        return categoryForHttpStatus(it, errorCode, serverResponse)
    }
    if (context.online == false && causes.any { it is IOException }) {
        return AppErrorCategory.OFFLINE
    }
    if (causes.any { it is SerializationException }) {
        return AppErrorCategory.CLIENT_SERVER_INCOMPATIBLE
    }
    if (causes.any { it is SocketTimeoutException || it is InterruptedIOException }) {
        return AppErrorCategory.TIMEOUT
    }
    if (causes.any { it is UnknownHostException || it is ConnectException }) {
        return AppErrorCategory.OFFLINE
    }
    if (causes.any { it is SSLException }) {
        return AppErrorCategory.SERVER_TEMPORARY
    }
    if (causes.any { it is SQLiteException }) {
        return AppErrorCategory.LOCAL_STORAGE
    }
    if (causes.any { it is SecurityException || it is FileNotFoundException }) {
        return if (context.operation in setOf(AppErrorOperation.EXPORT, AppErrorOperation.IMPORT)) {
            AppErrorCategory.PERMISSION_OR_FILE_EXPORT
        } else {
            AppErrorCategory.LOCAL_STORAGE
        }
    }
    val combined = listOfNotNull(errorCode, serverResponse)
        .joinToString(" ")
        .lowercase(Locale.ROOT)
    if (combined.containsSchemaMarker()) return AppErrorCategory.CLIENT_SERVER_INCOMPATIBLE
    if (combined.contains("not found") || combined.contains("deleted")) {
        return AppErrorCategory.NOT_FOUND_OR_DELETED
    }
    if (combined.contains("conflict") || combined.contains("stale")) {
        return AppErrorCategory.CONFLICT
    }
    if (
        combined.contains("invalid") ||
        combined.contains("validation") ||
        combined.contains("rejected") ||
        combined.contains("cannot be decoded") ||
        combined.contains("corrupt") ||
        combined.contains("legacy operation")
    ) {
        return AppErrorCategory.VALIDATION_OR_LEGACY_OPERATION
    }
    if (causes.any { it is IOException }) {
        return if (context.operation in setOf(AppErrorOperation.EXPORT, AppErrorOperation.IMPORT)) {
            AppErrorCategory.PERMISSION_OR_FILE_EXPORT
        } else if (combined.contains("offline") || context.online == false) {
            AppErrorCategory.OFFLINE
        } else {
            AppErrorCategory.SERVER_TEMPORARY
        }
    }
    return AppErrorCategory.UNKNOWN
}

private fun categoryForHttpStatus(
    status: Int,
    errorCode: String?,
    serverResponse: String?,
): AppErrorCategory {
    val combined = listOfNotNull(errorCode, serverResponse)
        .joinToString(" ")
        .lowercase(Locale.ROOT)
    return when {
        status in setOf(401, 403) -> AppErrorCategory.AUTH_REQUIRED
        status == 408 -> AppErrorCategory.TIMEOUT
        status == 409 -> AppErrorCategory.CONFLICT
        status == 404 || status == 410 -> AppErrorCategory.NOT_FOUND_OR_DELETED
        status == 426 -> AppErrorCategory.APP_UPDATE_REQUIRED
        status == 429 || status in 500..599 -> AppErrorCategory.SERVER_TEMPORARY
        combined.containsSchemaMarker() -> AppErrorCategory.CLIENT_SERVER_INCOMPATIBLE
        status in 400..499 -> AppErrorCategory.VALIDATION_OR_LEGACY_OPERATION
        else -> AppErrorCategory.UNKNOWN
    }
}

private fun String.containsSchemaMarker(): Boolean = listOf(
    "invalid discriminator",
    "unsupported operation",
    "unsupported client",
    "schema",
    "client version",
    "update required",
).any(::contains)

private fun SettingsErrorKind.toAppErrorCategory(): AppErrorCategory = when (this) {
    SettingsErrorKind.AUTHENTICATION,
    SettingsErrorKind.TOKEN_REVOKED,
    SettingsErrorKind.TOKEN_EXPIRED,
    SettingsErrorKind.FORBIDDEN,
    -> AppErrorCategory.AUTH_REQUIRED
    SettingsErrorKind.SESSION_ROUTE_REJECTED,
    SettingsErrorKind.ENDPOINT_MISMATCH,
    SettingsErrorKind.SESSION_VALIDATION_UNAVAILABLE,
    SettingsErrorKind.INVALID_RESPONSE,
    -> AppErrorCategory.CLIENT_SERVER_INCOMPATIBLE
    SettingsErrorKind.NOT_FOUND -> AppErrorCategory.NOT_FOUND_OR_DELETED
    SettingsErrorKind.INVALID_DATA -> AppErrorCategory.VALIDATION_OR_LEGACY_OPERATION
    SettingsErrorKind.RATE_LIMIT,
    SettingsErrorKind.BAD_GATEWAY,
    SettingsErrorKind.SERVER_UNAVAILABLE,
    SettingsErrorKind.TLS,
    SettingsErrorKind.TRANSPORT,
    -> AppErrorCategory.SERVER_TEMPORARY
    SettingsErrorKind.DNS,
    SettingsErrorKind.OFFLINE,
    -> AppErrorCategory.OFFLINE
    SettingsErrorKind.TIMEOUT -> AppErrorCategory.TIMEOUT
    SettingsErrorKind.UNKNOWN -> AppErrorCategory.UNKNOWN
}

private fun isRetryable(category: AppErrorCategory): Boolean = category in setOf(
    AppErrorCategory.OFFLINE,
    AppErrorCategory.TIMEOUT,
    AppErrorCategory.SERVER_TEMPORARY,
    AppErrorCategory.CONFLICT,
    AppErrorCategory.PERMISSION_OR_FILE_EXPORT,
)

private fun recoveryAction(
    category: AppErrorCategory,
    context: AppErrorContext,
): AppErrorRecoveryAction = when (category) {
    AppErrorCategory.OFFLINE,
    AppErrorCategory.TIMEOUT,
    AppErrorCategory.SERVER_TEMPORARY,
    -> AppErrorRecoveryAction.RETRY
    AppErrorCategory.AUTH_REQUIRED -> AppErrorRecoveryAction.SIGN_IN
    AppErrorCategory.APP_UPDATE_REQUIRED,
    AppErrorCategory.CLIENT_SERVER_INCOMPATIBLE,
    -> AppErrorRecoveryAction.UPDATE_APP
    AppErrorCategory.VALIDATION_OR_LEGACY_OPERATION -> if (context.queueItemId != null) {
        AppErrorRecoveryAction.REMOVE_QUEUED_OPERATION
    } else {
        AppErrorRecoveryAction.REVIEW_INPUT
    }
    AppErrorCategory.CONFLICT -> AppErrorRecoveryAction.REFRESH
    AppErrorCategory.NOT_FOUND_OR_DELETED -> if (context.queueItemId != null) {
        AppErrorRecoveryAction.REMOVE_QUEUED_OPERATION
    } else {
        AppErrorRecoveryAction.REFRESH
    }
    AppErrorCategory.LOCAL_STORAGE -> AppErrorRecoveryAction.CONTACT_SUPPORT
    AppErrorCategory.PERMISSION_OR_FILE_EXPORT -> AppErrorRecoveryAction.CHOOSE_ANOTHER_FILE
    AppErrorCategory.UNKNOWN -> AppErrorRecoveryAction.CONTACT_SUPPORT
}

fun sanitizeDiagnosticIdentifier(value: String?): String? = value
    ?.trim()
    ?.takeIf { SAFE_IDENTIFIER.matches(it) }
    ?.take(MAX_IDENTIFIER_LENGTH)

fun sanitizeDiagnosticText(value: String?): String? {
    val input = value?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    var sanitized = input.take(MAX_RAW_TEXT)
    REDACTION_PATTERNS.forEach { (pattern, replacement) ->
        sanitized = pattern.replace(sanitized, replacement)
    }
    sanitized = sanitized.replace(WINDOWS_PATH, "[redacted-path]")
        .replace(UNIX_HOME_PATH, "[redacted-path]")
    return sanitized.take(MAX_SANITIZED_TEXT)
}

private fun sanitizedStackTrace(error: Throwable): String? {
    val bounded = error.stackTraceToString()
        .lineSequence()
        .take(MAX_STACK_LINES)
        .joinToString("\n")
    return sanitizeDiagnosticText(bounded)
}

private fun sanitizeExceptionClass(value: String?): String? = value
    ?.takeIf { SAFE_EXCEPTION_CLASS.matches(it) }
    ?.take(MAX_EXCEPTION_CLASS_LENGTH)

private val SAFE_IDENTIFIER = Regex("^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
private val SAFE_EXCEPTION_CLASS = Regex("^[A-Za-z][A-Za-z0-9_.$]{0,199}$")
private val WINDOWS_PATH = Regex("(?i)[A-Z]:\\\\[^\\r\\n\\t]+")
private val UNIX_HOME_PATH = Regex("(?i)/(?:home|users)/[^\\s]+")
private val REDACTION_PATTERNS = listOf(
    Regex("(?i)(authorization\\s*[:=]\\s*)(?:bearer\\s+)?[^\\s,;]+") to "$1[redacted]",
    Regex("(?i)(bearer\\s+)[A-Za-z0-9._~+/-]+={0,2}") to "$1[redacted]",
    Regex("(?i)((?:set-)?cookie\\s*[:=]\\s*)[^\\r\\n;]+") to "$1[redacted]",
    Regex(
        "(?i)([\"']?(?:access[_-]?token|refresh[_-]?token|password|passwd|secret|cookie|" +
            "authorization|email|medical|passport|diagnosis|injury|pain|notes|payload)[\"']?\\s*[:=]\\s*)" +
            "([\"'][^\"']*[\"']|[^,}\\s]+)",
    ) to "$1[redacted]",
    Regex("(?i)[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}") to "[redacted-email]",
    Regex("(?i)gma_[A-Za-z0-9_-]{20,}") to "[redacted-token]",
    Regex("\\beyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\b") to "[redacted-jwt]",
    Regex("(?im)^.*\\b(?:passport|medical|diagnosis|injury|pain)\\b.*$") to
        "[redacted-sensitive-line]",
)
private const val MAX_CAUSE_DEPTH = 8
private const val MAX_IDENTIFIER_LENGTH = 128
private const val MAX_EXCEPTION_CLASS_LENGTH = 200
private const val MAX_RAW_TEXT = 32 * 1024
private const val MAX_SANITIZED_TEXT = 8 * 1024
private const val MAX_STACK_LINES = 24
