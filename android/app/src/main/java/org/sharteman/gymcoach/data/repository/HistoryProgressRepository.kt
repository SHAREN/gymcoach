package org.sharteman.gymcoach.data.repository

import android.content.Context
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import org.sharteman.gymcoach.data.model.MobileGoalRequest
import org.sharteman.gymcoach.data.model.HistoricalSetAddRequest
import org.sharteman.gymcoach.data.model.HistoricalSetUpdateRequest
import org.sharteman.gymcoach.data.model.MobileHistorySnapshot
import org.sharteman.gymcoach.data.model.MobileVolumeTargetClearRequest
import org.sharteman.gymcoach.data.model.MobileVolumeTargetRequest
import org.sharteman.gymcoach.data.network.HistoryProgressApiClient
import org.sharteman.gymcoach.data.network.ServerEndpointResolver
import org.sharteman.gymcoach.data.offline.DeleteHistorySessionMutation
import org.sharteman.gymcoach.data.offline.NetworkStatus
import org.sharteman.gymcoach.data.offline.OFFLINE_DOMAIN_HISTORY
import org.sharteman.gymcoach.data.offline.OfflineMutationController
import org.sharteman.gymcoach.data.offline.OfflinePersistence
import org.sharteman.gymcoach.data.offline.OfflineRuntime
import org.sharteman.gymcoach.data.offline.accountKey
import org.sharteman.gymcoach.data.offline.historyCacheKey
import org.sharteman.gymcoach.data.offline.offlineJson
import org.sharteman.gymcoach.data.security.AccountStore
import org.sharteman.gymcoach.data.security.SecureAccountStore
import java.io.IOException
import java.util.UUID

interface HistoryProgressDataSource {
    suspend fun cachedHistory(month: String, programId: String?): MobileHistorySnapshot?
    suspend fun refreshHistory(month: String, programId: String?): MobileHistorySnapshot
    suspend fun deleteHistorySession(sessionId: String)
    suspend fun updateHistoricalSet(setId: String, request: HistoricalSetUpdateRequest) {
        throw UnsupportedOperationException("Historical set editing is unavailable.")
    }
    suspend fun addHistoricalSet(sessionId: String, request: HistoricalSetAddRequest) {
        throw UnsupportedOperationException("Historical set editing is unavailable.")
    }
    suspend fun deleteHistoricalSet(setId: String) {
        throw UnsupportedOperationException("Historical set editing is unavailable.")
    }
    suspend fun saveGoal(exerciseId: String, targetWeightKg: Double, targetReps: Int)
    suspend fun deleteGoal(goalId: String)
    suspend fun saveVolumeTarget(muscleGroup: String, mev: Int, mrv: Int)
    suspend fun clearVolumeTarget(muscleGroup: String)
    suspend fun startDeload()
    suspend fun endDeload()
    suspend fun retryOfflineChange(operationId: String): Boolean = false
    suspend fun discardOfflineChange(operationId: String): Boolean = false
}

class HistoryProgressRepository(
    context: Context,
    private val accountStore: AccountStore = SecureAccountStore(context.applicationContext),
    private val api: HistoryProgressApiClient = HistoryProgressApiClient(),
    private val offlinePersistence: OfflinePersistence? = OfflineRuntime.persistence(),
    private val networkStatus: NetworkStatus = OfflineRuntime.networkStatus() ?: NetworkStatus { true },
    private val scheduleSync: () -> Unit = { OfflineRuntime.scheduleSync() },
) : HistoryProgressDataSource {
    private val cache = HistoryReadCache(context.applicationContext, api)
    private val endpointResolver = ServerEndpointResolver(accountStore)

    override suspend fun cachedHistory(month: String, programId: String?): MobileHistorySnapshot? {
        val account = credentials()
        val key = accountKey(account.accountKeyServerUrl, account.userId)
        val cacheKey = historyCacheKey(key, month, programId)
        val stored = offlinePersistence?.readCache(cacheKey)
        val legacy = cache.read(account.userId, month, programId)
        val snapshot = stored
            ?.let { runCatching { offlineJson.decodeFromString<MobileHistorySnapshot>(it) }.getOrNull() }
            ?: legacy
        if (stored == null && legacy != null) {
            offlinePersistence?.saveCache(
                key,
                OFFLINE_DOMAIN_HISTORY,
                cacheKey,
                offlineJson.encodeToString(legacy),
            )
        }
        return snapshot?.let { applyPendingHistoryDeletes(key, it) }
    }

    override suspend fun refreshHistory(month: String, programId: String?): MobileHistorySnapshot {
        val account = credentials()
        if (!networkStatus.isConnected()) {
            return cachedHistory(month, programId)
                ?: throw HistoryOfflineCacheMissException()
        }
        val accountKey = accountKey(account.accountKeyServerUrl, account.userId)
        val remote = endpointResolver.execute { baseUrl ->
            api.history(baseUrl, account.token, month, programId)
        }.also {
            cache.write(account.userId, month, programId, it)
            offlinePersistence?.saveCache(
                accountKey,
                OFFLINE_DOMAIN_HISTORY,
                historyCacheKey(accountKey, month, programId),
                offlineJson.encodeToString(it),
            )
        }
        return applyPendingHistoryDeletes(accountKey, remote)
    }

    override suspend fun deleteHistorySession(sessionId: String) {
        val account = credentials()
        val persistence = offlinePersistence
        if (persistence == null) {
            endpointResolver.execute { baseUrl ->
                api.deleteHistorySession(baseUrl, account.token, sessionId)
            }
            cache.clearUser(account.userId)
            return
        }
        persistence.enqueue(
            accountKey(account.accountKeyServerUrl, account.userId),
            DeleteHistorySessionMutation(operationId(), sessionId),
        )
        scheduleSync()
    }

    override suspend fun updateHistoricalSet(setId: String, request: HistoricalSetUpdateRequest) {
        val account = onlineCredentials()
        endpointResolver.execute { baseUrl ->
            api.updateHistoricalSet(baseUrl, account.token, setId, request)
        }
        cache.clearUser(account.userId)
    }

    override suspend fun addHistoricalSet(sessionId: String, request: HistoricalSetAddRequest) {
        val account = onlineCredentials()
        endpointResolver.execute { baseUrl ->
            api.addHistoricalSet(baseUrl, account.token, sessionId, request)
        }
        cache.clearUser(account.userId)
    }

    override suspend fun deleteHistoricalSet(setId: String) {
        val account = onlineCredentials()
        endpointResolver.execute { baseUrl ->
            api.deleteHistoricalSet(baseUrl, account.token, setId)
        }
        cache.clearUser(account.userId)
    }

    override suspend fun saveGoal(exerciseId: String, targetWeightKg: Double, targetReps: Int) {
        val account = credentials()
        endpointResolver.execute { baseUrl ->
            api.saveGoal(
                baseUrl,
                account.token,
                MobileGoalRequest(exerciseId, targetWeightKg, targetReps),
            )
        }
    }

    override suspend fun deleteGoal(goalId: String) {
        val account = credentials()
        endpointResolver.execute { baseUrl -> api.deleteGoal(baseUrl, account.token, goalId) }
    }

    override suspend fun saveVolumeTarget(muscleGroup: String, mev: Int, mrv: Int) {
        val account = credentials()
        endpointResolver.execute { baseUrl ->
            api.saveVolumeTarget(
                baseUrl,
                account.token,
                MobileVolumeTargetRequest(muscleGroup, mev, mrv),
            )
        }
    }

    override suspend fun clearVolumeTarget(muscleGroup: String) {
        val account = credentials()
        endpointResolver.execute { baseUrl ->
            api.clearVolumeTarget(
                baseUrl,
                account.token,
                MobileVolumeTargetClearRequest(muscleGroup),
            )
        }
    }

    override suspend fun startDeload() {
        val account = credentials()
        endpointResolver.execute { baseUrl -> api.startDeload(baseUrl, account.token) }
    }

    override suspend fun endDeload() {
        val account = credentials()
        endpointResolver.execute { baseUrl -> api.endDeload(baseUrl, account.token) }
    }

    override suspend fun retryOfflineChange(operationId: String): Boolean =
        offlinePersistence?.let { OfflineMutationController(it, scheduleSync).retry(operationId) } ?: false

    override suspend fun discardOfflineChange(operationId: String): Boolean =
        offlinePersistence?.let { OfflineMutationController(it, scheduleSync).discard(operationId) } ?: false

    private suspend fun applyPendingHistoryDeletes(
        accountKey: String,
        snapshot: MobileHistorySnapshot,
    ): MobileHistorySnapshot {
        val deletedSessionIds = offlinePersistence?.operations(accountKey).orEmpty()
            .mapNotNull { (it.mutation as? DeleteHistorySessionMutation)?.sessionId }
            .toSet()
        return if (deletedSessionIds.isEmpty()) snapshot else snapshot.copy(
            sessions = snapshot.sessions.filterNot { it.id in deletedSessionIds },
        )
    }

    private fun operationId() = "op_${UUID.randomUUID().toString().replace("-", "")}"

    private fun credentials(): Credentials {
        val userId = accountStore.userId ?: throw MobileAuthenticationRequiredException()
        val token = accountStore.getAccessToken() ?: throw MobileAuthenticationRequiredException()
        return Credentials(userId, accountStore.primaryServerUrl, token)
    }

    private fun onlineCredentials(): Credentials {
        if (!networkStatus.isConnected()) throw HistoryOfflineMutationException()
        return credentials()
    }
}

class HistoryOfflineCacheMissException : IOException(
    "No network connection and no cached history data.",
)

class HistoryOfflineMutationException : IOException(
    "Historical workout changes require a server connection.",
)

private data class Credentials(
    val userId: String,
    val accountKeyServerUrl: String,
    val token: String,
)

private class HistoryReadCache(context: Context, private val api: HistoryProgressApiClient) {
    private val preferences = context.getSharedPreferences("gymcoach-history-cache", Context.MODE_PRIVATE)

    fun read(userId: String, month: String, programId: String?): MobileHistorySnapshot? =
        preferences.getString(key(userId, month, programId), null)?.let { payload ->
            runCatching { api.json.decodeFromString<MobileHistorySnapshot>(payload) }.getOrNull()
        }

    fun write(userId: String, month: String, programId: String?, snapshot: MobileHistorySnapshot) {
        preferences.edit()
            .putString(key(userId, month, programId), api.json.encodeToString(snapshot))
            .apply()
    }

    fun clearUser(userId: String) {
        val prefix = "$userId|"
        val editor = preferences.edit()
        preferences.all.keys.filter { it.startsWith(prefix) }.forEach(editor::remove)
        editor.apply()
    }

    private fun key(userId: String, month: String, programId: String?): String =
        "$userId|$month|${programId ?: "all"}"
}
