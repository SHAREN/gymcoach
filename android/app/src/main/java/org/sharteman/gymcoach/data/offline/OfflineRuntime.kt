package org.sharteman.gymcoach.data.offline

import android.content.Context
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import org.sharteman.gymcoach.data.local.GymCoachDatabase
import org.sharteman.gymcoach.data.network.HistoryProgressApiClient
import org.sharteman.gymcoach.data.programs.ProgramsCatalogApi
import org.sharteman.gymcoach.data.programs.ProgramsCatalogRepository
import org.sharteman.gymcoach.data.security.AccountStore
import org.sharteman.gymcoach.data.security.SecureAccountStore

object OfflineRuntime {
    @Volatile private var dependencies: Dependencies? = null

    fun initialize(context: Context, scheduleSync: () -> Unit) {
        if (dependencies != null) return
        synchronized(this) {
            if (dependencies != null) return
            val applicationContext = context.applicationContext
            val persistence = RoomOfflinePersistence(
                GymCoachDatabase.get(applicationContext).offlineDao(),
            )
            dependencies = Dependencies(
                persistence = persistence,
                networkStatus = AndroidNetworkStatus(applicationContext),
                accountStore = SecureAccountStore(applicationContext),
                scheduleSync = scheduleSync,
            )
        }
    }

    fun programsRepository(baseUrl: String, token: String): ProgramsCatalogRepository? {
        val current = dependencies ?: return null
        val userId = current.accountStore.userId ?: return null
        return ProgramsCatalogRepository.offline(
            remote = ProgramsCatalogApi(baseUrl, token),
            accountKey = accountKey(baseUrl, userId),
            persistence = current.persistence,
            networkStatus = current.networkStatus,
            scheduleSync = current.scheduleSync,
        )
    }

    suspend fun syncPending(): Boolean {
        val current = dependencies ?: return true
        val userId = current.accountStore.userId ?: return true
        val token = current.accountStore.getAccessToken() ?: return true
        val baseUrl = current.accountStore.serverUrl
        return OfflineSyncEngine(current.persistence, current.networkStatus).sync(
            accountKey = accountKey(baseUrl, userId),
            baseUrl = baseUrl,
            token = token,
            catalogRemote = ProgramsCatalogApi(baseUrl, token),
            historyApi = HistoryProgressApiClient(),
        )
    }

    suspend fun hasPendingChanges(): Boolean {
        val current = dependencies ?: return false
        val userId = current.accountStore.userId ?: return false
        return current.persistence.operations(accountKey(current.accountStore.serverUrl, userId)).isNotEmpty()
    }

    suspend fun clearCurrentAccountData() {
        val current = dependencies ?: return
        val userId = current.accountStore.userId ?: return
        current.persistence.clearAccount(accountKey(current.accountStore.serverUrl, userId))
    }

    fun persistence(): OfflinePersistence? = dependencies?.persistence
    fun networkStatus(): NetworkStatus? = dependencies?.networkStatus
    fun controller(): OfflineMutationController? = dependencies?.let {
        OfflineMutationController(it.persistence, it.scheduleSync)
    }
    fun scheduleSync() = dependencies?.scheduleSync?.invoke()
    fun issues(): Flow<List<OfflineSyncIssue>> {
        val current = dependencies ?: return emptyFlow()
        val userId = current.accountStore.userId ?: return emptyFlow()
        return current.persistence.observeIssues(accountKey(current.accountStore.serverUrl, userId))
    }

    fun pendingCount(): Flow<Int> {
        val current = dependencies ?: return emptyFlow()
        val userId = current.accountStore.userId ?: return emptyFlow()
        return current.persistence.observePendingCount(accountKey(current.accountStore.serverUrl, userId))
    }

    private data class Dependencies(
        val persistence: OfflinePersistence,
        val networkStatus: NetworkStatus,
        val accountStore: AccountStore,
        val scheduleSync: () -> Unit,
    )
}

fun accountKey(baseUrl: String, userId: String): String = "${baseUrl.trimEnd('/')}|$userId"
