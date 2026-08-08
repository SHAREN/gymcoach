package org.sharteman.gymcoach.data.repository

import android.content.Context
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.withLock
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
import org.sharteman.gymcoach.data.offline.UpdateHistoricalSetMutation
import org.sharteman.gymcoach.data.offline.AddHistoricalSetMutation
import org.sharteman.gymcoach.data.offline.DeleteHistoricalSetMutation
import org.sharteman.gymcoach.data.offline.NetworkStatus
import org.sharteman.gymcoach.data.offline.OFFLINE_DOMAIN_HISTORY
import org.sharteman.gymcoach.data.offline.OfflineMutationController
import org.sharteman.gymcoach.data.offline.OfflinePersistence
import org.sharteman.gymcoach.data.offline.OfflineRuntime
import org.sharteman.gymcoach.data.offline.OfflineSyncLock
import org.sharteman.gymcoach.data.offline.OfflineCacheUpdate
import org.sharteman.gymcoach.data.offline.OfflineMutation
import org.sharteman.gymcoach.data.offline.applyHistoryMutation
import org.sharteman.gymcoach.data.offline.applyHistoryMutations
import org.sharteman.gymcoach.data.offline.accountKey
import org.sharteman.gymcoach.data.offline.historyCacheKey
import org.sharteman.gymcoach.data.offline.offlineJson
import org.sharteman.gymcoach.data.security.AccountStore
import org.sharteman.gymcoach.data.security.SecureAccountStore
import org.sharteman.gymcoach.data.network.ApiException
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
    suspend fun hasPendingHistoricalChanges(): Boolean = false
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
        return snapshot?.let { applyPendingHistoryMutations(key, it) }
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
        return applyPendingHistoryMutations(accountKey, remote)
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
        val account = credentials()
        val key = accountKey(account.accountKeyServerUrl, account.userId)
        val context = historicalSetContext(key, setId)
        commitHistoricalMutation(
            account = account,
            mutation = UpdateHistoricalSetMutation(
                operationId = operationId(),
                setId = setId,
                sessionId = context?.first,
                exerciseId = context?.second,
                request = request,
            ),
        ) { baseUrl ->
            api.updateHistoricalSet(baseUrl, account.token, setId, request)
        }
    }

    override suspend fun addHistoricalSet(sessionId: String, request: HistoricalSetAddRequest) {
        val account = credentials()
        commitHistoricalMutation(
            account = account,
            mutation = AddHistoricalSetMutation(operationId(), sessionId, request),
        ) { baseUrl ->
            api.addHistoricalSet(baseUrl, account.token, sessionId, request)
        }
    }

    override suspend fun deleteHistoricalSet(setId: String) {
        val account = credentials()
        val key = accountKey(account.accountKeyServerUrl, account.userId)
        val context = historicalSetContext(key, setId)
        commitHistoricalMutation(
            account = account,
            mutation = DeleteHistoricalSetMutation(
                operationId = operationId(),
                setId = setId,
                sessionId = context?.first,
                exerciseId = context?.second,
            ),
        ) { baseUrl ->
            api.deleteHistoricalSet(baseUrl, account.token, setId)
        }
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

    override suspend fun hasPendingHistoricalChanges(): Boolean {
        val account = credentials()
        val key = accountKey(account.accountKeyServerUrl, account.userId)
        return offlinePersistence?.operations(key).orEmpty()
            .any { it.mutation.domain == OFFLINE_DOMAIN_HISTORY }
    }

    private suspend fun applyPendingHistoryMutations(
        accountKey: String,
        snapshot: MobileHistorySnapshot,
    ): MobileHistorySnapshot {
        val pending = offlinePersistence?.operations(accountKey).orEmpty()
            .map { it.mutation }
            .filter { it.domain == OFFLINE_DOMAIN_HISTORY }
        return applyHistoryMutations(snapshot, pending)
    }

    private suspend fun commitHistoricalMutation(
        account: Credentials,
        mutation: OfflineMutation,
        remote: suspend (baseUrl: String) -> Unit,
    ) {
        val persistence = offlinePersistence
        if (persistence == null) {
            if (!networkStatus.isConnected()) throw HistoryOfflineMutationException()
            endpointResolver.execute { baseUrl -> remote(baseUrl) }
            cache.clearUser(account.userId)
            return
        }
        val key = accountKey(account.accountKeyServerUrl, account.userId)
        OfflineSyncLock.mutex.withLock {
            persistence.enqueue(key, mutation)
            scheduleSync()
            val isQueueHead = persistence.operations(key).firstOrNull()
                ?.mutation
                ?.operationId == mutation.operationId
            if (!networkStatus.isConnected() || !isQueueHead) return@withLock
            try {
                endpointResolver.execute { baseUrl -> remote(baseUrl) }
                val updates = historyCacheUpdates(key, mutation)
                persistence.complete(mutation.operationId, updates)
                cache.clearUser(account.userId)
            } catch (error: CancellationException) {
                throw error
            } catch (error: ApiException) {
                if (
                    error.statusCode == 401 ||
                    error.statusCode == 403 ||
                    error.statusCode == 408 ||
                    error.statusCode == 429 ||
                    error.statusCode >= 500
                ) {
                    return@withLock
                }
                persistence.remove(listOf(mutation.operationId))
                throw error
            } catch (_: IOException) {
                // The durable idempotent operation remains queued. A lost response may mean the
                // server already applied it, so replay is safer than surfacing a false failure.
            } catch (error: Exception) {
                persistence.remove(listOf(mutation.operationId))
                throw error
            }
        }
    }

    private suspend fun historyCacheUpdates(
        accountKey: String,
        mutation: OfflineMutation,
    ): List<OfflineCacheUpdate> = offlinePersistence
        ?.readDomainCaches(accountKey, OFFLINE_DOMAIN_HISTORY)
        .orEmpty()
        .mapNotNull { (cacheKey, payload) ->
            val snapshot = runCatching {
                offlineJson.decodeFromString<MobileHistorySnapshot>(payload)
            }.getOrNull() ?: return@mapNotNull null
            OfflineCacheUpdate(
                accountKey = accountKey,
                domain = OFFLINE_DOMAIN_HISTORY,
                cacheKey = cacheKey,
                payloadJson = offlineJson.encodeToString(applyHistoryMutation(snapshot, mutation)),
            )
        }

    private suspend fun historicalSetContext(
        accountKey: String,
        setId: String,
    ): Pair<String, String>? = offlinePersistence
        ?.readDomainCaches(accountKey, OFFLINE_DOMAIN_HISTORY)
        .orEmpty()
        .values
        .asSequence()
        .mapNotNull { payload ->
            runCatching { offlineJson.decodeFromString<MobileHistorySnapshot>(payload) }.getOrNull()
        }
        .flatMap { snapshot -> snapshot.sessions.asSequence() }
        .mapNotNull { session ->
            session.exercises.firstOrNull { exercise -> exercise.sets.any { it.id == setId } }
                ?.let { session.id to it.id }
        }
        .firstOrNull()

    private fun operationId() = "op_${UUID.randomUUID().toString().replace("-", "")}"

    private fun credentials(): Credentials {
        val userId = accountStore.userId ?: throw MobileAuthenticationRequiredException()
        val token = accountStore.getAccessToken() ?: throw MobileAuthenticationRequiredException()
        return Credentials(userId, accountStore.primaryServerUrl, token)
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
