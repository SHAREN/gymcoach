package org.sharteman.gymcoach.data.local

import androidx.room.Dao
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

@Dao
interface OfflineDao {
    @Query("SELECT * FROM offline_read_cache WHERE cacheKey = :cacheKey")
    suspend fun readCache(cacheKey: String): OfflineReadCacheEntity?

    @Query("SELECT * FROM offline_read_cache WHERE accountKey = :accountKey AND domain = :domain")
    suspend fun readDomainCaches(accountKey: String, domain: String): List<OfflineReadCacheEntity>

    @Upsert
    suspend fun saveCache(entity: OfflineReadCacheEntity)

    @Query("DELETE FROM offline_read_cache WHERE accountKey = :accountKey")
    suspend fun clearAccountCaches(accountKey: String)

    @Query("SELECT * FROM offline_mutation_outbox WHERE accountKey = :accountKey ORDER BY sequence")
    suspend fun operations(accountKey: String): List<OfflineMutationEntity>

    @Query("SELECT * FROM offline_mutation_outbox WHERE operationId = :operationId LIMIT 1")
    suspend fun operation(operationId: String): OfflineMutationEntity?

    @Upsert
    suspend fun enqueue(entity: OfflineMutationEntity)

    @Query("DELETE FROM offline_mutation_outbox WHERE operationId IN (:operationIds)")
    suspend fun removeOperations(operationIds: List<String>)

    @Query(
        "UPDATE offline_mutation_outbox SET status = 'FAILED', attempts = attempts + 1, " +
            "nextAttemptAtEpochMs = :nextAttemptAtEpochMs, lastError = :error " +
            "WHERE operationId = :operationId",
    )
    suspend fun markFailed(operationId: String, error: String, nextAttemptAtEpochMs: Long)

    @Query(
        "UPDATE offline_mutation_outbox SET status = 'BLOCKED', attempts = attempts + 1, " +
            "nextAttemptAtEpochMs = 0, lastError = :error WHERE operationId = :operationId",
    )
    suspend fun markBlocked(operationId: String, error: String)

    @Query(
        "UPDATE offline_mutation_outbox SET status = 'PENDING', nextAttemptAtEpochMs = 0, " +
            "lastError = NULL WHERE operationId = :operationId",
    )
    suspend fun retry(operationId: String)

    @Query(
        "SELECT * FROM offline_mutation_outbox " +
            "WHERE accountKey = :accountKey AND status = 'BLOCKED' ORDER BY sequence",
    )
    fun observeBlocked(accountKey: String): Flow<List<OfflineMutationEntity>>

    @Query(
        "SELECT COUNT(*) FROM offline_mutation_outbox " +
        "WHERE accountKey = :accountKey AND status IN ('PENDING', 'FAILED', 'BLOCKED')",
    )
    fun observePendingCount(accountKey: String): Flow<Int>

    @Query("DELETE FROM offline_mutation_outbox WHERE accountKey = :accountKey")
    suspend fun clearAccountOperations(accountKey: String)

    @Transaction
    suspend fun complete(
        operationId: String,
        caches: List<OfflineReadCacheEntity>,
    ) {
        caches.forEach { saveCache(it) }
        removeOperations(listOf(operationId))
    }

    @Transaction
    suspend fun clearAccount(accountKey: String) {
        clearAccountOperations(accountKey)
        clearAccountCaches(accountKey)
    }
}
