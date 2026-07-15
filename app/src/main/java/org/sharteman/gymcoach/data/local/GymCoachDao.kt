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

    @Query("SELECT * FROM watch_processed_events WHERE eventId = :eventId")
    suspend fun getProcessedWatchEvent(eventId: String): WatchProcessedEventEntity?

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertWatchInboxEvent(entity: WatchInboxEventEntity): Long

    @Query("SELECT * FROM watch_inbox_events WHERE eventId = :eventId")
    suspend fun getWatchInboxEvent(eventId: String): WatchInboxEventEntity?

    @Query(
        "UPDATE watch_inbox_events SET status = :status, resultStatus = :resultStatus, " +
            "resultRevision = :resultRevision, errorCode = :errorCode, " +
            "processedAtEpochMs = :processedAtEpochMs WHERE eventId = :eventId",
    )
    suspend fun finishWatchInboxEvent(
        eventId: String,
        status: String,
        resultStatus: String,
        resultRevision: Long,
        errorCode: String?,
        processedAtEpochMs: Long,
    )

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertWatchOutboxEvent(entity: WatchOutboxEventEntity): Long

    @Query("SELECT * FROM watch_outbox_events WHERE eventId = :eventId")
    suspend fun getWatchOutboxEvent(eventId: String): WatchOutboxEventEntity?

    @Query(
        "SELECT * FROM watch_outbox_events WHERE status IN ('PENDING', 'SENT') " +
            "ORDER BY revision, timestampEpochMs, eventId",
    )
    suspend fun getReplayableWatchOutboxEvents(): List<WatchOutboxEventEntity>

    @Query(
        "SELECT * FROM watch_outbox_events WHERE sessionId = :sessionId " +
            "AND status IN ('PENDING', 'SENT') ORDER BY revision, timestampEpochMs, eventId",
    )
    suspend fun getReplayableWatchOutboxEvents(sessionId: String): List<WatchOutboxEventEntity>

    @Query("SELECT COUNT(*) FROM watch_outbox_events WHERE status IN ('PENDING', 'SENT')")
    suspend fun countReplayableWatchOutboxEvents(): Int

    @Query("SELECT COUNT(*) FROM watch_outbox_events WHERE status IN ('PENDING', 'SENT')")
    fun observeReplayableWatchOutboxEventCount(): Flow<Int>

    @Query(
        "UPDATE watch_outbox_events SET status = 'SENT', attempts = attempts + 1, " +
            "lastAttemptAtEpochMs = :attemptedAtEpochMs, errorCode = NULL WHERE eventId = :eventId",
    )
    suspend fun markWatchOutboxAttempt(eventId: String, attemptedAtEpochMs: Long)

    @Query(
        "UPDATE watch_outbox_events SET status = :status, ackStatus = :ackStatus, " +
            "errorCode = :errorCode, acknowledgedAtEpochMs = :acknowledgedAtEpochMs " +
            "WHERE eventId = :eventId",
    )
    suspend fun updateWatchOutboxAcknowledgement(
        eventId: String,
        status: String,
        ackStatus: String,
        errorCode: String?,
        acknowledgedAtEpochMs: Long,
    )

    @Query("DELETE FROM watch_outbox_events WHERE eventId IN (:eventIds)")
    suspend fun deleteWatchOutboxEvents(eventIds: List<String>)

    @Upsert
    suspend fun saveWatchResyncMarker(entity: WatchResyncMarkerEntity)

    @Query("SELECT * FROM watch_resync_markers WHERE sessionId = :sessionId")
    suspend fun getWatchResyncMarker(sessionId: String): WatchResyncMarkerEntity?

    @Query("SELECT * FROM watch_resync_markers ORDER BY updatedAtEpochMs, sessionId")
    suspend fun getWatchResyncMarkers(): List<WatchResyncMarkerEntity>

    @Query("DELETE FROM watch_resync_markers WHERE sessionId = :sessionId AND revision <= :throughRevision")
    suspend fun deleteWatchResyncMarker(sessionId: String, throughRevision: Long)

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertWatchAckJournal(entity: WatchAckJournalEntity): Long

    @Query("SELECT * FROM watch_ack_journal WHERE ackId = :ackId")
    suspend fun getWatchAckJournal(ackId: String): WatchAckJournalEntity?

    @Query(
        "DELETE FROM watch_ack_journal WHERE ackId NOT IN (" +
            "SELECT ackId FROM watch_ack_journal ORDER BY receivedAtEpochMs DESC, ackId DESC LIMIT :keepLatest" +
            ")",
    )
    suspend fun pruneWatchAckJournal(keepLatest: Int)

    @Upsert
    suspend fun saveWatchPeer(entity: WatchPeerEntity)

    @Query("SELECT * FROM watch_peers WHERE deviceId = :deviceId")
    suspend fun getWatchPeer(deviceId: String): WatchPeerEntity?

    @Query("SELECT * FROM watch_peers ORDER BY updatedAtEpochMs DESC LIMIT 1")
    fun observeLatestWatchPeer(): Flow<WatchPeerEntity?>

    @Upsert
    suspend fun saveWatchConflict(entity: WatchConflictEntity)

    @Query("SELECT * FROM watch_conflicts WHERE sessionId = :sessionId ORDER BY detectedAtEpochMs, conflictId")
    suspend fun getWatchConflicts(sessionId: String): List<WatchConflictEntity>

    @Query("SELECT COUNT(*) FROM watch_conflicts WHERE status = 'UNRESOLVED'")
    fun observeUnresolvedWatchConflictCount(): Flow<Int>

    @Upsert
    suspend fun saveWatchFileTransfer(entity: WatchFileTransferEntity)

    @Query(
        "SELECT * FROM watch_file_transfers WHERE transferId = :transferId " +
            "ORDER BY sequence",
    )
    suspend fun getWatchFileTransferParts(transferId: String): List<WatchFileTransferEntity>

    @Query(
        "SELECT * FROM watch_file_transfers WHERE relatedEventId = :eventId " +
            "ORDER BY sequence",
    )
    suspend fun getWatchFileTransfersForEvent(eventId: String): List<WatchFileTransferEntity>

    @Transaction
    suspend fun applyWatchAcknowledgement(
        journal: WatchAckJournalEntity,
        eventIds: List<String>,
        deleteAcknowledgedEvents: Boolean,
        outboxStatus: String,
        ackStatus: String,
        errorCode: String?,
        acknowledgedAtEpochMs: Long,
        conflicts: List<WatchConflictEntity>,
        peer: WatchPeerEntity?,
    ): Boolean {
        if (insertWatchAckJournal(journal) == -1L) return false
        if (deleteAcknowledgedEvents) {
            if (eventIds.isNotEmpty()) deleteWatchOutboxEvents(eventIds)
        } else {
            eventIds.forEach { eventId ->
                updateWatchOutboxAcknowledgement(
                    eventId = eventId,
                    status = outboxStatus,
                    ackStatus = ackStatus,
                    errorCode = errorCode,
                    acknowledgedAtEpochMs = acknowledgedAtEpochMs,
                )
            }
        }
        conflicts.forEach { saveWatchConflict(it) }
        peer?.let { candidate ->
            val existing = getWatchPeer(candidate.deviceId)
            saveWatchPeer(
                if (existing != null && existing.sessionId == candidate.sessionId) {
                    candidate.copy(
                        lastRevision = maxOf(existing.lastRevision, candidate.lastRevision),
                        lastSyncAtEpochMs = maxOf(
                            existing.lastSyncAtEpochMs ?: 0,
                            candidate.lastSyncAtEpochMs ?: 0,
                        ).takeIf { it > 0 },
                        updatedAtEpochMs = maxOf(existing.updatedAtEpochMs, candidate.updatedAtEpochMs),
                    )
                } else if (existing == null) {
                    candidate
                } else {
                    existing
                },
            )
        }
        pruneWatchAckJournal(500)
        return true
    }

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

    @Query("DELETE FROM watch_inbox_events")
    suspend fun clearWatchInboxEvents()

    @Query("DELETE FROM watch_outbox_events")
    suspend fun clearWatchOutboxEvents()

    @Query("DELETE FROM watch_resync_markers")
    suspend fun clearWatchResyncMarkers()

    @Query("DELETE FROM watch_ack_journal")
    suspend fun clearWatchAckJournal()

    @Query("DELETE FROM watch_conflicts")
    suspend fun clearWatchConflicts()

    @Query("DELETE FROM watch_file_transfers")
    suspend fun clearWatchFileTransfers()

    @Query("DELETE FROM watch_peers")
    suspend fun clearWatchPeers()

    @Transaction
    suspend fun clearAccountData() {
        clearOutbox()
        clearWatchFileTransfers()
        clearWatchConflicts()
        clearWatchAckJournal()
        clearWatchOutboxEvents()
        clearWatchResyncMarkers()
        clearWatchInboxEvents()
        clearWatchPeers()
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
        marker: WatchResyncMarkerEntity? = null,
    ) {
        saveSession(session)
        enqueue(operation)
        saveActiveWorkoutRuntime(runtime)
        marker?.let { saveWatchResyncMarker(it) }
    }

    @Transaction
    suspend fun saveFinishedSessionOperationAndBootstrap(
        session: LocalSessionEntity,
        operation: SyncOutboxEntity,
        bootstrap: BootstrapCacheEntity?,
        watchEvent: WatchOutboxEventEntity? = null,
    ) {
        saveSession(session)
        enqueue(operation)
        deleteActiveWorkoutRuntime(session.id)
        watchEvent?.let { insertWatchOutboxEvent(it) }
        deleteWatchResyncMarker(session.id, Long.MAX_VALUE)
        bootstrap?.let { saveBootstrap(it) }
    }

    @Transaction
    suspend fun saveActiveWorkoutRuntimeAndMarker(
        runtime: ActiveWorkoutRuntimeEntity,
        marker: WatchResyncMarkerEntity?,
    ) {
        saveActiveWorkoutRuntime(runtime)
        marker?.let { saveWatchResyncMarker(it) }
    }

    @Transaction
    suspend fun saveSetOperationRuntimeAndMarker(
        set: LocalSetEntity,
        operation: SyncOutboxEntity,
        runtime: ActiveWorkoutRuntimeEntity,
        marker: WatchResyncMarkerEntity?,
    ) {
        saveSet(set)
        enqueue(operation)
        saveActiveWorkoutRuntime(runtime)
        marker?.let { saveWatchResyncMarker(it) }
    }

    @Transaction
    suspend fun deleteSetOperationRuntimeAndMarker(
        setId: String,
        operation: SyncOutboxEntity,
        runtime: ActiveWorkoutRuntimeEntity,
        marker: WatchResyncMarkerEntity?,
    ) {
        markSetDeleted(setId)
        enqueue(operation)
        saveActiveWorkoutRuntime(runtime)
        marker?.let { saveWatchResyncMarker(it) }
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
    suspend fun applyWatchFinishedEvent(
        processed: WatchProcessedEventEntity,
        session: LocalSessionEntity,
        operation: SyncOutboxEntity,
    ): Boolean {
        if (insertProcessedWatchEvent(processed) == -1L) return false
        saveSession(session)
        enqueue(operation)
        deleteActiveWorkoutRuntime(session.id)
        deleteWatchResyncMarker(session.id, Long.MAX_VALUE)
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
