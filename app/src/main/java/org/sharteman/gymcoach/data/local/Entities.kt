package org.sharteman.gymcoach.data.local

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(tableName = "bootstrap_cache")
data class BootstrapCacheEntity(
    @PrimaryKey val key: Int = 1,
    val payloadJson: String,
    val updatedAtEpochMs: Long,
)

@Entity(tableName = "progress_cache")
data class ProgressCacheEntity(
    @PrimaryKey val key: Int = 1,
    val payloadJson: String,
    val updatedAtEpochMs: Long,
)

@Entity(
    tableName = "local_sessions",
    indices = [Index("workoutId"), Index("finishedAt")],
)
data class LocalSessionEntity(
    @PrimaryKey val id: String,
    val workoutId: String,
    val gymId: String?,
    val startedAt: String,
    val finishedAt: String? = null,
    val notes: String? = null,
    val sessionRpe: Int? = null,
)

@Entity(
    tableName = "local_sets",
    foreignKeys = [
        ForeignKey(
            entity = LocalSessionEntity::class,
            parentColumns = ["id"],
            childColumns = ["sessionId"],
            onDelete = ForeignKey.CASCADE,
        ),
    ],
    indices = [Index("sessionId"), Index(value = ["sessionId", "exerciseId", "setNumber"])],
)
data class LocalSetEntity(
    @PrimaryKey val id: String,
    val sessionId: String,
    val exerciseId: String,
    val setNumber: Int,
    val weight: Double,
    val reps: Int,
    val rir: Int?,
    val durationSec: Int? = null,
    val distanceM: Double? = null,
    val avgHr: Int? = null,
    val maxHr: Int? = null,
    val minHr: Int? = null,
    val startHr: Int? = null,
    val endHr: Int? = null,
    val hrSampleCount: Int? = null,
    val notes: String? = null,
    val isWarmup: Boolean = false,
    val isDropSet: Boolean = false,
    val recoverySec: Int? = null,
    val completedAt: String,
    val deleted: Boolean = false,
    val exerciseSessionId: String? = null,
    val startedAt: String? = null,
    val source: String? = null,
    val watchRevision: Long? = null,
)

@Entity(
    tableName = "active_workout_runtime",
    foreignKeys = [
        ForeignKey(
            entity = LocalSessionEntity::class,
            parentColumns = ["id"],
            childColumns = ["sessionId"],
            onDelete = ForeignKey.CASCADE,
        ),
    ],
    indices = [Index("workoutId"), Index("updatedAtEpochMs")],
)
data class ActiveWorkoutRuntimeEntity(
    @PrimaryKey val sessionId: String,
    val workoutId: String,
    val status: String = "ACTIVE",
    val activeExerciseId: String? = null,
    val activeSetId: String? = null,
    val setStartedAtEpochMs: Long? = null,
    val pausedAtEpochMs: Long? = null,
    val restStartedAtEpochMs: Long? = null,
    val restEndsAtEpochMs: Long? = null,
    val restDurationSeconds: Int? = null,
    val workoutAccumulatedPauseMs: Long = 0,
    val setAccumulatedPauseMs: Long = 0,
    val restPausedRemainingMs: Long? = null,
    val revision: Long = 1,
    val updatedAtEpochMs: Long,
    val updatedBy: String = "PHONE",
)

@Entity(
    tableName = "watch_processed_events",
    indices = [Index("sessionId"), Index("processedAtEpochMs")],
)
data class WatchProcessedEventEntity(
    @PrimaryKey val eventId: String,
    val sessionId: String,
    val revision: Long,
    val processedAtEpochMs: Long,
    val canonicalEventHash: String = "",
    val resultStatus: String = "APPLIED",
    val resultRevision: Long = revision,
    val errorCode: String? = null,
)

@Entity(
    tableName = "watch_inbox_events",
    indices = [Index("sessionId"), Index("status"), Index("receivedAtEpochMs")],
)
data class WatchInboxEventEntity(
    @PrimaryKey val eventId: String,
    val sessionId: String,
    val revision: Long,
    val timestampEpochMs: Long,
    val canonicalEventHash: String,
    val envelopeJson: String,
    val status: String = "RECEIVED",
    val resultStatus: String? = null,
    val resultRevision: Long? = null,
    val errorCode: String? = null,
    val receivedAtEpochMs: Long,
    val processedAtEpochMs: Long? = null,
)

@Entity(
    tableName = "watch_outbox_events",
    indices = [
        Index("sessionId"),
        Index("status"),
        Index(value = ["sessionId", "revision", "timestampEpochMs", "eventId"]),
        Index("relatedTransferId"),
    ],
)
data class WatchOutboxEventEntity(
    @PrimaryKey val eventId: String,
    val sessionId: String,
    val revision: Long,
    val timestampEpochMs: Long,
    val eventType: String,
    val canonicalEventHash: String,
    val envelopeJson: String,
    val status: String = "PENDING",
    val attempts: Int = 0,
    val lastAttemptAtEpochMs: Long? = null,
    val ackStatus: String? = null,
    val errorCode: String? = null,
    val relatedTransferId: String? = null,
    val createdAtEpochMs: Long,
    val acknowledgedAtEpochMs: Long? = null,
)

@Entity(
    tableName = "watch_ack_journal",
    indices = [Index("sessionId"), Index("receivedAtEpochMs")],
)
data class WatchAckJournalEntity(
    @PrimaryKey val ackId: String,
    val sessionId: String,
    val eventIdsJson: String,
    val status: String,
    val revision: Long,
    val errorCode: String?,
    val source: String,
    val deviceId: String,
    val receivedAtEpochMs: Long,
)

@Entity(
    tableName = "watch_peers",
    indices = [Index("sessionId"), Index("lastSyncAtEpochMs")],
)
data class WatchPeerEntity(
    @PrimaryKey val deviceId: String,
    val sessionId: String?,
    val protocolVersion: String,
    val schemaVersion: Int,
    val lastRevision: Long = 0,
    val lastSyncAtEpochMs: Long? = null,
    val lastError: String? = null,
    val updatedAtEpochMs: Long,
)

@Entity(
    tableName = "watch_conflicts",
    indices = [Index("sessionId"), Index("eventId"), Index("resolution"), Index("detectedAtEpochMs")],
)
data class WatchConflictEntity(
    @PrimaryKey val conflictId: String,
    val sessionId: String,
    val eventId: String,
    val entityType: String,
    val entityId: String,
    val localRevision: Long,
    val remoteRevision: Long,
    val localEventJson: String,
    val remoteEventJson: String,
    val status: String,
    val errorCode: String?,
    val detectedAtEpochMs: Long,
    val resolution: String? = null,
    val resolvedAtEpochMs: Long? = null,
)

@Entity(
    tableName = "watch_file_transfers",
    primaryKeys = ["transferId", "sequence"],
    indices = [
        Index("sessionId"),
        Index("relatedEventId"),
        Index(value = ["payloadId", "sequence"]),
        Index("status"),
    ],
)
data class WatchFileTransferEntity(
    val transferId: String,
    val sequence: Int,
    val sessionId: String,
    val relatedEventId: String?,
    val payloadType: String,
    val payloadId: String,
    val totalSequences: Int,
    val byteLength: Int,
    val sha256: String,
    val source: String,
    val deviceId: String,
    val direction: String,
    val status: String,
    val canonicalPayloadJson: String?,
    val errorCode: String?,
    val createdAtEpochMs: Long,
    val updatedAtEpochMs: Long,
)

@Entity(
    tableName = "watch_sensor_batches",
    primaryKeys = ["batchId", "sequence"],
    foreignKeys = [
        ForeignKey(
            entity = LocalSessionEntity::class,
            parentColumns = ["id"],
            childColumns = ["sessionId"],
            onDelete = ForeignKey.CASCADE,
        ),
    ],
    indices = [Index("sessionId"), Index("createdAtEpochMs")],
)
data class WatchSensorBatchEntity(
    val batchId: String,
    val sessionId: String,
    val source: String,
    val deviceId: String,
    val createdAtEpochMs: Long,
    val sequence: Int,
    val totalSequences: Int,
    val sampleCount: Int,
    val receivedAtEpochMs: Long,
)

@Entity(
    tableName = "watch_sensor_samples",
    foreignKeys = [
        ForeignKey(
            entity = WatchSensorBatchEntity::class,
            parentColumns = ["batchId", "sequence"],
            childColumns = ["batchId", "batchSequence"],
            onDelete = ForeignKey.CASCADE,
        ),
    ],
    indices = [
        Index(value = ["batchId", "batchSequence"]),
        Index("sessionId"),
        Index("setId"),
        Index(value = ["sessionId", "phase", "timestampEpochMs"]),
        Index(value = ["sessionId", "setId", "phase", "timestampEpochMs"]),
    ],
)
data class WatchSensorSampleEntity(
    @PrimaryKey val sampleId: String,
    val batchId: String,
    val batchSequence: Int,
    val sessionId: String,
    val exerciseSessionId: String?,
    val setId: String?,
    val phase: String,
    val sensorType: String,
    val numericValue: Double?,
    val textValue: String?,
    val booleanValue: Boolean?,
    val unit: String,
    val timestampEpochMs: Long,
    val source: String,
    val valid: Boolean,
    val quality: String?,
)

@Entity(
    tableName = "rest_recovery_summaries",
    foreignKeys = [
        ForeignKey(
            entity = LocalSessionEntity::class,
            parentColumns = ["id"],
            childColumns = ["sessionId"],
            onDelete = ForeignKey.CASCADE,
        ),
    ],
    indices = [
        Index("sessionId"),
        Index("setId"),
        Index(value = ["sessionId", "setId", "restStartedAtEpochMs"], unique = true),
    ],
)
data class RestRecoverySummaryEntity(
    @PrimaryKey val restId: String,
    val sessionId: String,
    val setId: String,
    val restStartedAtEpochMs: Long,
    val restEndedAtEpochMs: Long,
    val startHr: Double?,
    val minHr: Double?,
    val avgHr: Double?,
    val hr30: Double?,
    val hr60: Double?,
    val drop30: Double?,
    val drop60: Double?,
    val hrSampleCount: Int,
    val skipped: Boolean,
    val updatedAtEpochMs: Long,
)

@Entity(
    tableName = "sync_outbox",
    indices = [Index("status"), Index("createdAtEpochMs"), Index(value = ["operationId"], unique = true)],
)
data class SyncOutboxEntity(
    @PrimaryKey(autoGenerate = true) val sequence: Long = 0,
    val operationId: String,
    val type: String,
    val payloadJson: String,
    val status: String = "PENDING",
    val attempts: Int = 0,
    val lastError: String? = null,
    val lastRetryRequestedAtEpochMs: Long = 0,
    val createdAtEpochMs: Long = System.currentTimeMillis(),
)

@Entity(
    tableName = "offline_read_cache",
    indices = [Index("accountKey"), Index("domain")],
)
data class OfflineReadCacheEntity(
    @PrimaryKey val cacheKey: String,
    val accountKey: String,
    val domain: String,
    val payloadJson: String,
    val updatedAtEpochMs: Long = System.currentTimeMillis(),
)

@Entity(
    tableName = "offline_mutation_outbox",
    indices = [
        Index("accountKey"),
        Index("status"),
        Index("nextAttemptAtEpochMs"),
        Index(value = ["operationId"], unique = true),
    ],
)
data class OfflineMutationEntity(
    @PrimaryKey(autoGenerate = true) val sequence: Long = 0,
    val operationId: String,
    val accountKey: String,
    val domain: String,
    val type: String,
    val payloadJson: String,
    val status: String = "PENDING",
    val attempts: Int = 0,
    val nextAttemptAtEpochMs: Long = 0,
    val lastError: String? = null,
    val createdAtEpochMs: Long = System.currentTimeMillis(),
)
