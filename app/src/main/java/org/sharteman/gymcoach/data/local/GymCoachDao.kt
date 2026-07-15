package org.sharteman.gymcoach.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
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

    @Query("SELECT * FROM active_workout_runtime WHERE sessionId = :sessionId")
    fun observeActiveWorkoutRuntime(sessionId: String): Flow<ActiveWorkoutRuntimeEntity?>

    @Query("SELECT * FROM active_workout_runtime WHERE sessionId = :sessionId")
    suspend fun getActiveWorkoutRuntime(sessionId: String): ActiveWorkoutRuntimeEntity?

    @Query("SELECT * FROM active_workout_runtime ORDER BY updatedAtEpochMs DESC LIMIT 1")
    suspend fun getLatestActiveWorkoutRuntime(): ActiveWorkoutRuntimeEntity?

    @Upsert
    suspend fun saveActiveWorkoutRuntime(entity: ActiveWorkoutRuntimeEntity)

    @Query("DELETE FROM active_workout_runtime WHERE sessionId = :sessionId")
    suspend fun deleteActiveWorkoutRuntime(sessionId: String)

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertProcessedWatchEvent(entity: WatchProcessedEventEntity): Long

    @Query("SELECT COUNT(*) FROM watch_processed_events WHERE eventId = :eventId")
    suspend fun hasProcessedWatchEvent(eventId: String): Int

    @Query(
        "SELECT COUNT(*) FROM watch_sensor_batches " +
            "WHERE batchId = :batchId AND sequence = :sequence",
    )
    suspend fun hasWatchSensorBatch(batchId: String, sequence: Int): Int

    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insertWatchSensorBatch(entity: WatchSensorBatchEntity)

    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insertWatchSensorSamples(entities: List<WatchSensorSampleEntity>)

    @Query(
        "SELECT * FROM watch_sensor_samples " +
            "WHERE sessionId = :sessionId AND setId = :setId AND phase = :phase " +
            "ORDER BY timestampEpochMs, sampleId",
    )
    suspend fun getWatchSensorSamplesForSet(
        sessionId: String,
        setId: String,
        phase: String,
    ): List<WatchSensorSampleEntity>

    @Query(
        "SELECT * FROM watch_sensor_samples " +
            "WHERE sessionId = :sessionId AND setId = :setId AND phase = :phase " +
            "AND timestampEpochMs BETWEEN :startedAtEpochMs AND :endedAtEpochMs " +
            "ORDER BY timestampEpochMs, sampleId",
    )
    suspend fun getWatchSensorSamplesForInterval(
        sessionId: String,
        setId: String,
        phase: String,
        startedAtEpochMs: Long,
        endedAtEpochMs: Long,
    ): List<WatchSensorSampleEntity>

    @Query("SELECT * FROM rest_recovery_summaries WHERE sessionId = :sessionId")
    suspend fun getRestRecoverySummaries(sessionId: String): List<RestRecoverySummaryEntity>

    @Query(
        "SELECT * FROM rest_recovery_summaries " +
            "WHERE sessionId = :sessionId AND setId = :setId " +
            "AND restStartedAtEpochMs = :restStartedAtEpochMs LIMIT 1",
    )
    suspend fun getRestRecoverySummary(
        sessionId: String,
        setId: String,
        restStartedAtEpochMs: Long,
    ): RestRecoverySummaryEntity?

    @Upsert
    suspend fun saveRestRecoverySummary(entity: RestRecoverySummaryEntity)

    @Query(
        "UPDATE local_sets SET minHr = :minHr, maxHr = :maxHr, avgHr = :avgHr, " +
            "startHr = :startHr, endHr = :endHr, hrSampleCount = :sampleCount " +
            "WHERE id = :setId",
    )
    suspend fun updateSetHeartRateSummary(
        setId: String,
        minHr: Int?,
        maxHr: Int?,
        avgHr: Int?,
        startHr: Int?,
        endHr: Int?,
        sampleCount: Int,
    ): Int

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

    @Query(
        "UPDATE sync_outbox SET status = 'PENDING', lastError = NULL, " +
            "lastRetryRequestedAtEpochMs = :requestedAtEpochMs WHERE operationId = :operationId",
    )
    suspend fun retryOperation(operationId: String, requestedAtEpochMs: Long)

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

    @Query("DELETE FROM active_workout_runtime")
    suspend fun clearActiveWorkoutRuntime()

    @Query("DELETE FROM watch_processed_events")
    suspend fun clearProcessedWatchEvents()

    @Transaction
    suspend fun clearAccountData() {
        clearOutbox()
        clearActiveWorkoutRuntime()
        clearProcessedWatchEvents()
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
    suspend fun saveSessionOperationAndRuntime(
        session: LocalSessionEntity,
        operation: SyncOutboxEntity,
        runtime: ActiveWorkoutRuntimeEntity,
    ) {
        saveSession(session)
        enqueue(operation)
        saveActiveWorkoutRuntime(runtime)
    }

    @Transaction
    suspend fun saveFinishedSessionOperationAndBootstrap(
        session: LocalSessionEntity,
        operation: SyncOutboxEntity,
        bootstrap: BootstrapCacheEntity?,
    ) {
        saveSession(session)
        enqueue(operation)
        deleteActiveWorkoutRuntime(session.id)
        bootstrap?.let { saveBootstrap(it) }
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
    suspend fun applyWatchRuntimeEvent(
        processed: WatchProcessedEventEntity,
        runtime: ActiveWorkoutRuntimeEntity,
    ): Boolean {
        if (insertProcessedWatchEvent(processed) == -1L) return false
        saveActiveWorkoutRuntime(runtime)
        return true
    }

    @Transaction
    suspend fun applyWatchSetEvent(
        processed: WatchProcessedEventEntity,
        set: LocalSetEntity,
        operation: SyncOutboxEntity,
        runtime: ActiveWorkoutRuntimeEntity,
    ): Boolean {
        if (insertProcessedWatchEvent(processed) == -1L) return false
        saveSet(set)
        enqueue(operation)
        saveActiveWorkoutRuntime(runtime)
        return true
    }

    @Transaction
    suspend fun applyWatchDeleteSetEvent(
        processed: WatchProcessedEventEntity,
        setId: String,
        operation: SyncOutboxEntity,
        runtime: ActiveWorkoutRuntimeEntity,
    ): Boolean {
        if (insertProcessedWatchEvent(processed) == -1L) return false
        markSetDeleted(setId)
        enqueue(operation)
        saveActiveWorkoutRuntime(runtime)
        return true
    }

    @Transaction
    suspend fun applyWatchSensorBatch(
        processed: WatchProcessedEventEntity,
        batch: WatchSensorBatchEntity,
        samples: List<WatchSensorSampleEntity>,
        runtime: ActiveWorkoutRuntimeEntity,
    ): Boolean {
        if (
            hasProcessedWatchEvent(processed.eventId) > 0 ||
            hasWatchSensorBatch(batch.batchId, batch.sequence) > 0
        ) {
            return false
        }
        if (insertProcessedWatchEvent(processed) == -1L) return false
        insertWatchSensorBatch(batch)
        insertWatchSensorSamples(samples)
        saveActiveWorkoutRuntime(runtime)
        return true
    }

    @Transaction
    suspend fun applyWatchRestEvent(
        processed: WatchProcessedEventEntity,
        runtime: ActiveWorkoutRuntimeEntity,
        summary: RestRecoverySummaryEntity?,
    ): Boolean {
        if (insertProcessedWatchEvent(processed) == -1L) return false
        saveActiveWorkoutRuntime(runtime)
        summary?.let { saveRestRecoverySummary(it) }
        return true
    }

    @Transaction
    suspend fun discardSessionChanges(
        sessionId: String,
        operationIds: List<String>,
        bootstrap: BootstrapCacheEntity? = null,
    ) {
        removeOperations(operationIds)
        deleteSessionLocal(sessionId)
        bootstrap?.let { saveBootstrap(it) }
    }

    @Transaction
    suspend fun resetSessionAndOperation(
        sessionId: String,
        priorOperationIds: List<String>,
        operation: SyncOutboxEntity,
        bootstrap: BootstrapCacheEntity? = null,
    ) {
        if (priorOperationIds.isNotEmpty()) removeOperations(priorOperationIds)
        deleteSessionLocal(sessionId)
        enqueue(operation)
        bootstrap?.let { saveBootstrap(it) }
    }
}
