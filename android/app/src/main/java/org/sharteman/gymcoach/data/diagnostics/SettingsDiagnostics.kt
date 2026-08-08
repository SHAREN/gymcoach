package org.sharteman.gymcoach.data.diagnostics

import android.app.Activity
import android.app.Application
import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Bundle
import android.os.SystemClock
import java.io.File
import java.time.Instant
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import org.sharteman.gymcoach.BuildConfig
import org.sharteman.gymcoach.data.security.AccountStore
import org.sharteman.gymcoach.data.security.SecureAccountStore
import org.sharteman.gymcoach.data.settings.SettingsException
import org.sharteman.gymcoach.data.errors.UserFacingError

class SettingsDiagnostics private constructor(
    private val context: Context,
    private val accountStore: AccountStore,
    private val store: FileSettingsDiagnosticEventStore,
    private val appInfo: SettingsDiagnosticAppInfo,
    private val nowEpochMs: () -> Long,
    private val elapsedRealtimeMs: () -> Long,
) : SettingsDiagnosticSink {
    private val foreground = AtomicBoolean(false)
    private val startedActivities = AtomicInteger(0)

    override fun recordRequest(input: SettingsRequestDiagnostic) {
        append(
            kind = "settings-request",
            attemptId = input.attemptId,
            correlationId = input.correlationId,
            subrequest = input.subrequest,
            origin = input.origin,
            path = input.path,
            method = input.method,
            statusCode = input.statusCode,
            category = input.category,
            errorCode = input.errorCode,
            authOutcome = input.authOutcome,
            durationMs = input.durationMs,
            retryDecision = input.retryDecision,
            exception = input.exception,
        )
    }

    override fun recordAttempt(
        attemptId: String,
        phase: String,
        section: String?,
        error: SettingsException?,
    ) {
        append(
            kind = "settings-attempt",
            attemptId = attemptId,
            correlationId = error?.correlationId,
            subrequest = section ?: error?.subrequest,
            origin = error?.authority,
            path = error?.route,
            statusCode = error?.statusCode,
            category = error?.kind?.name ?: phase,
            errorCode = error?.errorCode,
            authOutcome = error?.authOutcome,
            retryDecision = when {
                error == null -> phase
                error.retryable -> "retryable-$phase"
                else -> "terminal-$phase"
            },
            exception = error,
        )
    }

    override fun recordEndpoint(input: SettingsEndpointDiagnostic) {
        append(
            kind = "endpoint-decision",
            origin = input.origin,
            category = input.category,
            retryDecision = input.decision,
            exception = input.exception,
        )
    }

    fun recordAppError(error: UserFacingError) {
        append(
            kind = "app-error",
            correlationId = error.technical.correlationId,
            subrequest = error.technical.operationType ?: error.operation.name,
            statusCode = error.technical.httpStatus,
            category = error.category.name,
            errorCode = error.technical.errorCode,
            retryDecision = if (error.retryable) "retryable" else "permanent",
        )
    }

    fun install(application: Application) {
        val preferences = application.getSharedPreferences(
            "gymcoach-settings-diagnostics-state",
            Context.MODE_PRIVATE,
        )
        val previousVersion = preferences.getInt("last-version-code", 0)
        val marker = when {
            previousVersion == 0 -> "first-install"
            previousVersion != appInfo.versionCode -> "in-place-update"
            else -> "process-restart"
        }
        append(
            kind = "lifecycle",
            category = "process-start",
            lifecycleMarker = marker,
        )
        preferences.edit().putInt("last-version-code", appInfo.versionCode).apply()
        application.registerActivityLifecycleCallbacks(
            object : Application.ActivityLifecycleCallbacks {
                override fun onActivityStarted(activity: Activity) {
                    if (startedActivities.incrementAndGet() == 1) {
                        foreground.set(true)
                        append(
                            kind = "lifecycle",
                            category = "foreground",
                            lifecycleMarker = activity.javaClass.simpleName,
                        )
                    }
                }

                override fun onActivityStopped(activity: Activity) {
                    val remaining = startedActivities.updateAndGet { value ->
                        (value - 1).coerceAtLeast(0)
                    }
                    if (remaining == 0) {
                        foreground.set(false)
                        append(
                            kind = "lifecycle",
                            category = "background",
                            lifecycleMarker = activity.javaClass.simpleName,
                        )
                    }
                }

                override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
                override fun onActivityResumed(activity: Activity) = Unit
                override fun onActivityPaused(activity: Activity) = Unit
                override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
                override fun onActivityDestroyed(activity: Activity) = Unit
            },
        )
    }

    fun snapshot(): List<SettingsDiagnosticEvent> = store.snapshot()

    fun clear(): Boolean = store.clear()

    internal fun retentionPolicy(): SettingsDiagnosticRetentionPolicy = store.policy()

    internal fun accountState(): SettingsDiagnosticAccountState = SettingsDiagnosticAccountState(
        loggedIn = runCatching { accountStore.getAccessToken() != null }.getOrDefault(false),
        selectedAuthority = runCatching { sanitizeOrigin(accountStore.serverUrl) }.getOrNull(),
        primaryAuthority = runCatching { sanitizeOrigin(accountStore.primaryServerUrl) }.getOrNull(),
        fallbackAuthority = runCatching { sanitizeOrigin(accountStore.fallbackServerUrl) }.getOrNull(),
        sessionAuthority = runCatching { sanitizeOrigin(accountStore.sessionServerUrl) }.getOrNull(),
    )

    internal fun appInfo(): SettingsDiagnosticAppInfo = appInfo

    internal fun networkClass(): String = currentNetworkClass(context)

    private fun append(
        kind: String,
        attemptId: String? = null,
        correlationId: String? = null,
        subrequest: String? = null,
        origin: String? = null,
        path: String? = null,
        method: String? = null,
        statusCode: Int? = null,
        category: String,
        errorCode: String? = null,
        authOutcome: String? = null,
        durationMs: Long? = null,
        retryDecision: String? = null,
        exception: Throwable? = null,
        lifecycleMarker: String? = null,
    ) {
        runCatching {
            val timestamp = nowEpochMs()
            val event = SettingsDiagnosticEvent(
                eventId = UUID.randomUUID().toString(),
                utcTimestamp = Instant.ofEpochMilli(timestamp).toString(),
                deviceEpochMs = timestamp,
                elapsedRealtimeMs = elapsedRealtimeMs(),
                kind = safeDiagnosticLabel(kind, "event") ?: "event",
                app = appInfo,
                attemptId = safeCorrelation(attemptId),
                correlationId = safeCorrelation(correlationId),
                subrequest = safeDiagnosticLabel(subrequest),
                origin = sanitizeOrigin(origin),
                path = sanitizePath(path),
                method = safeMethod(method),
                authority = SettingsDiagnosticAuthority(
                    selected = sanitizeOrigin(accountStore.serverUrl),
                    primary = sanitizeOrigin(accountStore.primaryServerUrl),
                    fallback = sanitizeOrigin(accountStore.fallbackServerUrl),
                    session = sanitizeOrigin(accountStore.sessionServerUrl),
                ),
                statusCode = statusCode?.takeIf { it in 100..599 },
                category = safeDiagnosticLabel(category, "unknown") ?: "unknown",
                errorCode = safeDiagnosticLabel(errorCode),
                authOutcome = safeDiagnosticLabel(authOutcome),
                durationMs = durationMs?.coerceIn(0, 300_000),
                retryDecision = safeDiagnosticLabel(retryDecision),
                networkClass = currentNetworkClass(context),
                exceptionClass = safeExceptionClass(exception),
                appState = if (foreground.get()) "foreground" else "background",
                lifecycleMarker = safeDiagnosticLabel(lifecycleMarker),
            )
            store.append(event)
        }
    }

    companion object {
        fun create(context: Context): SettingsDiagnostics {
            val appContext = context.applicationContext
            return SettingsDiagnostics(
                context = appContext,
                accountStore = SecureAccountStore(appContext),
                store = FileSettingsDiagnosticEventStore(
                    File(appContext.filesDir, "settings-diagnostics"),
                ),
                appInfo = SettingsDiagnosticAppInfo(
                    packageName = BuildConfig.APPLICATION_ID,
                    versionName = BuildConfig.VERSION_NAME,
                    versionCode = BuildConfig.VERSION_CODE,
                    buildType = BuildConfig.BUILD_TYPE,
                    commit = safeCommit(BuildConfig.SOURCE_COMMIT),
                ),
                nowEpochMs = System::currentTimeMillis,
                elapsedRealtimeMs = SystemClock::elapsedRealtime,
            )
        }

        internal fun createForTest(
            context: Context,
            accountStore: AccountStore,
            directory: File,
            policy: SettingsDiagnosticRetentionPolicy,
            appInfo: SettingsDiagnosticAppInfo,
            nowEpochMs: () -> Long,
            elapsedRealtimeMs: () -> Long,
        ) = SettingsDiagnostics(
            context = context,
            accountStore = accountStore,
            store = FileSettingsDiagnosticEventStore(directory, policy, nowEpochMs),
            appInfo = appInfo,
            nowEpochMs = nowEpochMs,
            elapsedRealtimeMs = elapsedRealtimeMs,
        )
    }
}

private fun currentNetworkClass(context: Context): String = runCatching {
    val manager = context.getSystemService(ConnectivityManager::class.java)
        ?: return@runCatching "unknown"
    val network = manager.activeNetwork ?: return@runCatching "none"
    val capabilities = manager.getNetworkCapabilities(network) ?: return@runCatching "unknown"
    when {
        capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN) -> "vpn"
        capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
        capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
        capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
        else -> "other"
    }
}.getOrDefault("unknown")
