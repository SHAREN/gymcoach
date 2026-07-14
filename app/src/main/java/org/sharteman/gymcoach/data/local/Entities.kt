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
    val notes: String? = null,
    val isWarmup: Boolean = false,
    val isDropSet: Boolean = false,
    val recoverySec: Int? = null,
    val completedAt: String,
    val deleted: Boolean = false,
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
    val createdAtEpochMs: Long = System.currentTimeMillis(),
)
