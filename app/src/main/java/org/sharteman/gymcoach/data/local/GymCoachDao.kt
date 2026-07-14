package org.sharteman.gymcoach.data.local

import androidx.room.Dao
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

@Dao
interface GymCoachDao {
    @Query("SELECT * FROM bootstrap_cache WHERE `key` = 1")
    fun observeBootstrap(): Flow<BootstrapCacheEntity?>

    @Query("SELECT * FROM bootstrap_cache WHERE `key` = 1")
    suspend fun getBootstrap(): BootstrapCacheEntity?

    @Upsert
    suspend fun saveBootstrap(entity: BootstrapCacheEntity)

    @Query("SELECT * FROM progress_cache WHERE `key` = 1")
    fun observeProgress(): Flow<ProgressCacheEntity?>

    @Query("SELECT * FROM progress_cache WHERE `key` = 1")
    suspend fun getProgress(): ProgressCacheEntity?

    @Upsert
    suspend fun saveProgress(entity: ProgressCacheEntity)

    @Query("SELECT * FROM local_sessions WHERE finishedAt IS NULL ORDER BY startedAt DESC")
    fun observeOpenSessions(): Flow<List<LocalSessionEntity>>

    @Query("SELECT * FROM local_sessions WHERE finishedAt IS NULL ORDER BY startedAt DESC")
    suspend fun getOpenSessions(): List<LocalSessionEntity>

    @Query("SELECT * FROM local_sessions WHERE id = :sessionId")
    fun observeSession(sessionId: String): Flow<LocalSessionEntity?>

    @Query("SELECT * FROM local_sessions WHERE id = :sessionId")
    suspend fun getSession(sessionId: String): LocalSessionEntity?

    @Query("SELECT * FROM local_sessions WHERE workoutId = :workoutId AND finishedAt IS NULL LIMIT 1")
    suspend fun findOpenSessionForWorkout(workoutId: String): LocalSessionEntity?

    @Upsert
    suspend fun saveSession(entity: LocalSessionEntity)

    @Query("DELETE FROM local_sessions WHERE id = :sessionId")
    suspend fun deleteSessionLocal(sessionId: String)

    @Query("SELECT * FROM local_sets WHERE sessionId = :sessionId AND deleted = 0 ORDER BY completedAt, setNumber")
    fun observeSets(sessionId: String): Flow<List<LocalSetEntity>>

    @Query("SELECT * FROM local_sets WHERE sessionId = :sessionId AND deleted = 0 ORDER BY completedAt, setNumber")
    suspend fun getSets(sessionId: String): List<LocalSetEntity>

    @Query("SELECT * FROM local_sets WHERE sessionId = :sessionId ORDER BY completedAt, setNumber")
    suspend fun getAllSets(sessionId: String): List<LocalSetEntity>

    @Query("SELECT * FROM local_sets WHERE id = :setId")
    suspend fun getSet(setId: String): LocalSetEntity?

    @Upsert
    suspend fun saveSet(entity: LocalSetEntity)

    @Query("UPDATE local_sets SET deleted = 1 WHERE id = :setId")
    suspend fun markSetDeleted(setId: String)

    @Query("DELETE FROM local_sets WHERE id = :setId")
    suspend fun deleteSetLocal(setId: String)

    @Query("SELECT * FROM sync_outbox WHERE status IN ('PENDING', 'FAILED') ORDER BY sequence LIMIT :limit")
    suspend fun pendingOperations(limit: Int = 500): List<SyncOutboxEntity>

    @Upsert
    suspend fun enqueue(entity: SyncOutboxEntity)

    @Query("SELECT * FROM sync_outbox ORDER BY sequence")
    suspend fun queuedOperations(): List<SyncOutboxEntity>

    @Query("SELECT * FROM sync_outbox WHERE status = 'BLOCKED' ORDER BY sequence LIMIT 1")
    fun observeBlockedOperation(): Flow<SyncOutboxEntity?>

    @Query("DELETE FROM sync_outbox WHERE operationId IN (:operationIds)")
    suspend fun removeOperations(operationIds: List<String>)

    @Query("UPDATE sync_outbox SET status = 'FAILED', attempts = attempts + 1, lastError = :error WHERE operationId = :operationId")
    suspend fun markOperationFailed(operationId: String, error: String)

    @Query("UPDATE sync_outbox SET status = 'BLOCKED', attempts = attempts + 1, lastError = :error WHERE operationId = :operationId")
    suspend fun markOperationBlocked(operationId: String, error: String)

    @Query("UPDATE sync_outbox SET status = 'PENDING', lastError = NULL WHERE operationId = :operationId")
    suspend fun retryOperation(operationId: String)

    @Query("UPDATE sync_outbox SET status = 'PENDING' WHERE status = 'SYNCING'")
    suspend fun recoverInterruptedOperations()

    @Query("SELECT COUNT(*) FROM sync_outbox WHERE status IN ('PENDING', 'FAILED', 'SYNCING', 'BLOCKED')")
    fun observePendingCount(): Flow<Int>

    @Query("DELETE FROM bootstrap_cache")
    suspend fun clearBootstrap()

    @Query("DELETE FROM progress_cache")
    suspend fun clearProgress()

    @Query("DELETE FROM local_sessions")
    suspend fun clearSessions()

    @Query("DELETE FROM sync_outbox")
    suspend fun clearOutbox()

    @Transaction
    suspend fun clearAccountData() {
        clearOutbox()
        clearSessions()
        clearBootstrap()
        clearProgress()
    }

    @Transaction
    suspend fun saveSetAndOperation(set: LocalSetEntity, operation: SyncOutboxEntity) {
        saveSet(set)
        enqueue(operation)
    }

    @Transaction
    suspend fun saveSessionAndOperation(session: LocalSessionEntity, operation: SyncOutboxEntity) {
        saveSession(session)
        enqueue(operation)
    }

    @Transaction
    suspend fun saveBootstrapAndOperation(
        bootstrap: BootstrapCacheEntity,
        operation: SyncOutboxEntity,
    ) {
        saveBootstrap(bootstrap)
        enqueue(operation)
    }

    @Transaction
    suspend fun saveBootstrapAndRemoveOperations(
        bootstrap: BootstrapCacheEntity,
        operationIds: List<String>,
    ) {
        saveBootstrap(bootstrap)
        removeOperations(operationIds)
    }

    @Transaction
    suspend fun deleteSetAndOperation(setId: String, operation: SyncOutboxEntity) {
        markSetDeleted(setId)
        enqueue(operation)
    }

    @Transaction
    suspend fun discardSessionChanges(sessionId: String, operationIds: List<String>) {
        removeOperations(operationIds)
        deleteSessionLocal(sessionId)
    }
}
