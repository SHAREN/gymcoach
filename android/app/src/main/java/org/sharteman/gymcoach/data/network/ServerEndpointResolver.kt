package org.sharteman.gymcoach.data.network

import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerializationException
import okhttp3.OkHttpClient
import okhttp3.Request
import org.sharteman.gymcoach.data.coach.CoachApiException
import org.sharteman.gymcoach.data.security.AccountStore
import org.sharteman.gymcoach.data.settings.SettingsErrorKind
import org.sharteman.gymcoach.data.settings.SettingsException

fun interface ServerReachabilityProbe {
    suspend fun isReachable(baseUrl: String): Boolean
}

data class ServerEndpointEvent(
    val baseUrl: String,
    val decision: String,
    val category: String,
    val exception: Throwable? = null,
)

class HttpServerReachabilityProbe(
    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(3, TimeUnit.SECONDS)
        .readTimeout(5, TimeUnit.SECONDS)
        .writeTimeout(5, TimeUnit.SECONDS)
        .build(),
) : ServerReachabilityProbe {
    override suspend fun isReachable(baseUrl: String): Boolean = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("${baseUrl.trimEnd('/')}/api/android/latest")
            .get()
            .build()
        try {
            client.newCall(request).execute().use { response ->
                response.code !in GATEWAY_FAILURE_CODES
            }
        } catch (error: CancellationException) {
            throw error
        } catch (_: IOException) {
            false
        }
    }

    private companion object {
        val GATEWAY_FAILURE_CODES = setOf(502, 503, 504)
    }
}

class ServerEndpointResolver(
    private val accountStore: AccountStore,
    private val probe: ServerReachabilityProbe = HttpServerReachabilityProbe(),
    private val nowEpochMs: () -> Long = System::currentTimeMillis,
    private val primaryRetryIntervalMs: Long = TimeUnit.MINUTES.toMillis(5),
    private val observer: (ServerEndpointEvent) -> Unit = {},
) {
    private val mutex = Mutex()
    private var lastPrimaryCheckEpochMs = 0L

    suspend fun resolve(forcePrimaryCheck: Boolean = false): String = mutex.withLock {
        resolveLocked(forcePrimaryCheck)
    }

    suspend fun recordSelectedEndpoint(baseUrl: String) = mutex.withLock {
        accountStore.activateServerUrl(baseUrl)
        lastPrimaryCheckEpochMs = nowEpochMs()
    }

    suspend fun <T> execute(
        forcePrimaryCheck: Boolean = false,
        block: suspend (String) -> T,
    ): T {
        val first = resolve(forcePrimaryCheck)
        try {
            return block(first)
        } catch (error: CancellationException) {
            throw error
        } catch (error: Throwable) {
            if (!isEndpointUnavailable(error)) throw error
            val alternate = alternateFor(first) ?: throw error
            record(first, "failover", "primary-attempt-failed", error)
            return try {
                val result = block(alternate)
                recordSelectedEndpoint(alternate)
                record(alternate, "failover", "alternate-succeeded")
                result
            } catch (alternateError: CancellationException) {
                throw alternateError
            } catch (alternateError: Throwable) {
                record(alternate, "failover", "alternate-failed", alternateError)
                alternateError.addSuppressed(error)
                throw alternateError
            }
        }
    }

    private suspend fun resolveLocked(forcePrimaryCheck: Boolean): String {
        val primary = accountStore.primaryServerUrl
        val fallback = accountStore.fallbackServerUrl?.takeUnless { it == primary }
        val active = accountStore.serverUrl.takeIf { it == primary || it == fallback } ?: primary
        if (fallback == null) {
            accountStore.activateServerUrl(primary)
            record(primary, "select", "primary-only")
            return primary
        }
        val now = nowEpochMs()
        val primaryRetryDue = now - lastPrimaryCheckEpochMs >= primaryRetryIntervalMs
        if (!forcePrimaryCheck && active == primary) {
            record(primary, "select", "active-primary")
            return primary
        }
        if (!forcePrimaryCheck && active == fallback && !primaryRetryDue) {
            record(active, "select", "stale-fallback-retained")
            return active
        }

        lastPrimaryCheckEpochMs = now
        if (probe.isReachable(primary)) {
            accountStore.activateServerUrl(primary)
            record(primary, "select", "primary-recovered")
            return primary
        }
        if (probe.isReachable(fallback)) {
            accountStore.activateServerUrl(fallback)
            record(fallback, "select", "fallback-selected")
            return fallback
        }
        record(active, "select", "no-endpoint-confirmed")
        return active
    }

    private fun alternateFor(current: String): String? {
        val primary = accountStore.primaryServerUrl
        val fallback = accountStore.fallbackServerUrl?.takeUnless { it == primary }
        return when (current) {
            primary -> fallback
            fallback -> primary
            else -> fallback ?: primary
        }
    }

    private fun record(
        baseUrl: String,
        decision: String,
        category: String,
        exception: Throwable? = null,
    ) {
        runCatching {
            observer(ServerEndpointEvent(baseUrl, decision, category, exception))
        }
    }
}

internal fun isEndpointUnavailable(error: Throwable): Boolean {
    val causes = generateSequence(error) { it.cause }.take(8).toList()
    causes.filterIsInstance<ApiException>().firstOrNull()?.let { apiError ->
        return apiError.statusCode in setOf(408, 502, 503, 504)
    }
    causes.filterIsInstance<CoachApiException>().firstOrNull()?.let { apiError ->
        return apiError.statusCode in setOf(408, 502, 503, 504)
    }
    causes.filterIsInstance<SettingsException>().firstOrNull()?.let { apiError ->
        return apiError.statusCode in setOf(408, 502, 503, 504) || apiError.kind in setOf(
            SettingsErrorKind.BAD_GATEWAY,
            SettingsErrorKind.SERVER_UNAVAILABLE,
            SettingsErrorKind.DNS,
            SettingsErrorKind.TIMEOUT,
            SettingsErrorKind.TLS,
            SettingsErrorKind.TRANSPORT,
            SettingsErrorKind.OFFLINE,
        )
    }
    if (causes.any { it is SerializationException || it is IllegalArgumentException }) return false
    return causes.any {
        it is UnknownHostException ||
            it is ConnectException ||
            it is SocketTimeoutException ||
            it is SSLException ||
            it is IOException
    }
}
