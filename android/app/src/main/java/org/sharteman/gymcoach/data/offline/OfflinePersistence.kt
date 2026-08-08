package org.sharteman.gymcoach.data.offline

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.sharteman.gymcoach.data.local.OfflineDao
import org.sharteman.gymcoach.data.local.OfflineMutationEntity
import org.sharteman.gymcoach.data.local.OfflineReadCacheEntity

data class StoredOfflineMutation(
    val sequence: Long,
    val accountKey: String,
    val mutation: OfflineMutation,
    val status: String,
    val attempts: Int,
    val nextAttemptAtEpochMs: Long,
    val lastError: String?,
)

interface OfflinePersistence {
    suspend fun readCache(cacheKey: String): String?
    suspend fun readDomainCaches(accountKey: String, domain: String): Map<String, String>
    suspend fun saveCache(accountKey: String, domain: String, cacheKey: String, payloadJson: String)
    suspend fun operations(accountKey: String): List<StoredOfflineMutation>
    suspend fun operation(operationId: String): StoredOfflineMutation?
    suspend fun enqueue(accountKey: String, mutation: OfflineMutation)
    suspend fun remove(operationIds: List<String>)
    suspend fun markFailed(operationId: String, error: String, nextAttemptAtEpochMs: Long)
    suspend fun markBlocked(operationId: String, error: String)
    suspend fun retry(operationId: String)
    suspend fun complete(
        operationId: String,
        cacheUpdates: List<OfflineCacheUpdate> = emptyList(),
    )
    suspend fun clearAccount(accountKey: String)
    fun observeIssues(accountKey: String): Flow<List<OfflineSyncIssue>>
    fun observePendingCount(accountKey: String): Flow<Int>
}

data class OfflineCacheUpdate(
    val accountKey: String,
    val domain: String,
    val cacheKey: String,
    val payloadJson: String,
)

class RoomOfflinePersistence(
    private val dao: OfflineDao,
    private val json: Json = offlineJson,
) : OfflinePersistence {
    override suspend fun readCache(cacheKey: String): String? = dao.readCache(cacheKey)?.payloadJson

    override suspend fun readDomainCaches(accountKey: String, domain: String): Map<String, String> =
        dao.readDomainCaches(accountKey, domain).associate { it.cacheKey to it.payloadJson }

    override suspend fun saveCache(
        accountKey: String,
        domain: String,
        cacheKey: String,
        payloadJson: String,
    ) {
        dao.saveCache(OfflineReadCacheEntity(cacheKey, accountKey, domain, payloadJson))
    }

    override suspend fun operations(accountKey: String): List<StoredOfflineMutation> =
        dao.operations(accountKey).mapNotNull(::decode)

    override suspend fun operation(operationId: String): StoredOfflineMutation? =
        dao.operation(operationId)?.let(::decode)

    override suspend fun enqueue(accountKey: String, mutation: OfflineMutation) {
        dao.enqueue(
            OfflineMutationEntity(
                operationId = mutation.operationId,
                accountKey = accountKey,
                domain = mutation.domain,
                type = mutation::class.simpleName.orEmpty(),
                payloadJson = json.encodeToString<OfflineMutation>(mutation),
            ),
        )
    }

    override suspend fun remove(operationIds: List<String>) {
        if (operationIds.isNotEmpty()) dao.removeOperations(operationIds)
    }

    override suspend fun markFailed(operationId: String, error: String, nextAttemptAtEpochMs: Long) {
        dao.markFailed(operationId, error, nextAttemptAtEpochMs)
    }

    override suspend fun markBlocked(operationId: String, error: String) {
        dao.markBlocked(operationId, error)
    }

    override suspend fun retry(operationId: String) {
        dao.retry(operationId)
    }

    override suspend fun complete(operationId: String, cacheUpdates: List<OfflineCacheUpdate>) {
        dao.complete(
            operationId,
            cacheUpdates.map { update ->
                OfflineReadCacheEntity(
                    cacheKey = update.cacheKey,
                    accountKey = update.accountKey,
                    domain = update.domain,
                    payloadJson = update.payloadJson,
                )
            },
        )
    }

    override suspend fun clearAccount(accountKey: String) {
        dao.clearAccount(accountKey)
    }

    override fun observeIssues(accountKey: String): Flow<List<OfflineSyncIssue>> =
        dao.observeBlocked(accountKey).map { entries ->
            entries.map { entry ->
                OfflineSyncIssue(
                    operationId = entry.operationId,
                    type = entry.type,
                    message = entry.lastError ?: "Synchronization conflict.",
                    attempts = entry.attempts,
                    nextAttemptAtEpochMs = entry.nextAttemptAtEpochMs,
                    blocked = true,
                    createdAtEpochMs = entry.createdAtEpochMs,
                )
            }
        }

    override fun observePendingCount(accountKey: String): Flow<Int> = dao.observePendingCount(accountKey)

    private fun decode(entity: OfflineMutationEntity): StoredOfflineMutation = StoredOfflineMutation(
        sequence = entity.sequence,
        accountKey = entity.accountKey,
        mutation = runCatching { json.decodeFromString<OfflineMutation>(entity.payloadJson) }
            .getOrElse { CorruptOfflineMutation(entity.operationId, entity.domain) },
        status = entity.status,
        attempts = entity.attempts,
        nextAttemptAtEpochMs = entity.nextAttemptAtEpochMs,
        lastError = entity.lastError,
    )
}

val offlineJson = Json {
    ignoreUnknownKeys = true
    encodeDefaults = true
    explicitNulls = true
    classDiscriminator = "type"
}
