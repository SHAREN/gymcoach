package org.sharteman.gymcoach.data.local

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(
    entities = [
        BootstrapCacheEntity::class,
        ProgressCacheEntity::class,
        LocalSessionEntity::class,
        LocalSetEntity::class,
        ActiveWorkoutRuntimeEntity::class,
        WatchProcessedEventEntity::class,
        WatchInboxEventEntity::class,
        WatchOutboxEventEntity::class,
        WatchResyncMarkerEntity::class,
        WatchAckJournalEntity::class,
        WatchPeerEntity::class,
        WatchConflictEntity::class,
        WatchFileTransferEntity::class,
        WatchSensorBatchEntity::class,
        WatchSensorSampleEntity::class,
        RestRecoverySummaryEntity::class,
        SyncOutboxEntity::class,
        OfflineReadCacheEntity::class,
        OfflineMutationEntity::class,
    ],
    version = 9,
    exportSchema = true,
)
abstract class GymCoachDatabase : RoomDatabase() {
    abstract fun dao(): GymCoachDao
    abstract fun offlineDao(): OfflineDao

    companion object {
        @Volatile private var instance: GymCoachDatabase? = null

        fun get(context: Context): GymCoachDatabase = instance ?: synchronized(this) {
            instance ?: Room.databaseBuilder(
                context.applicationContext,
                GymCoachDatabase::class.java,
                "gymcoach-android.db",
            ).addMigrations(
                MIGRATION_1_2,
                MIGRATION_2_3,
                MIGRATION_3_4,
                MIGRATION_4_5,
                MIGRATION_5_6,
                MIGRATION_6_7,
                MIGRATION_7_8,
                MIGRATION_8_9,
            )
                .build()
                .also { instance = it }
        }

        private val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    "CREATE UNIQUE INDEX IF NOT EXISTS index_sync_outbox_operationId " +
                        "ON sync_outbox(operationId)",
                )
            }
        }

        private val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS progress_cache (" +
                        "`key` INTEGER NOT NULL, " +
                        "payloadJson TEXT NOT NULL, " +
                        "updatedAtEpochMs INTEGER NOT NULL, " +
                        "PRIMARY KEY(`key`))",
                )
            }
        }

        val MIGRATION_3_4 = object : Migration(3, 4) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    "ALTER TABLE sync_outbox ADD COLUMN lastRetryRequestedAtEpochMs " +
                        "INTEGER NOT NULL DEFAULT 0",
                )
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS offline_read_cache (" +
                        "cacheKey TEXT NOT NULL, " +
                        "accountKey TEXT NOT NULL, " +
                        "domain TEXT NOT NULL, " +
                        "payloadJson TEXT NOT NULL, " +
                        "updatedAtEpochMs INTEGER NOT NULL, " +
                        "PRIMARY KEY(cacheKey))",
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS index_offline_read_cache_accountKey " +
                        "ON offline_read_cache(accountKey)",
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS index_offline_read_cache_domain " +
                        "ON offline_read_cache(domain)",
                )
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS offline_mutation_outbox (" +
                        "sequence INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, " +
                        "operationId TEXT NOT NULL, " +
                        "accountKey TEXT NOT NULL, " +
                        "domain TEXT NOT NULL, " +
                        "type TEXT NOT NULL, " +
                        "payloadJson TEXT NOT NULL, " +
                        "status TEXT NOT NULL, " +
                        "attempts INTEGER NOT NULL, " +
                        "nextAttemptAtEpochMs INTEGER NOT NULL, " +
                        "lastError TEXT, " +
                        "createdAtEpochMs INTEGER NOT NULL)",
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS index_offline_mutation_outbox_accountKey " +
                        "ON offline_mutation_outbox(accountKey)",
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS index_offline_mutation_outbox_status " +
                        "ON offline_mutation_outbox(status)",
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS index_offline_mutation_outbox_nextAttemptAtEpochMs " +
                        "ON offline_mutation_outbox(nextAttemptAtEpochMs)",
                )
                db.execSQL(
                    "CREATE UNIQUE INDEX IF NOT EXISTS index_offline_mutation_outbox_operationId " +
                        "ON offline_mutation_outbox(operationId)",
                )
            }
        }

        val MIGRATION_4_5 = object : Migration(4, 5) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE local_sets ADD COLUMN exerciseSessionId TEXT")
                db.execSQL("ALTER TABLE local_sets ADD COLUMN startedAt TEXT")
                db.execSQL("ALTER TABLE local_sets ADD COLUMN source TEXT")
                db.execSQL("ALTER TABLE local_sets ADD COLUMN watchRevision INTEGER")
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS active_workout_runtime (" +
                        "sessionId TEXT NOT NULL, " +
                        "workoutId TEXT NOT NULL, " +
                        "status TEXT NOT NULL, " +
                        "activeExerciseId TEXT, " +
                        "activeSetId TEXT, " +
                        "setStartedAtEpochMs INTEGER, " +
                        "pausedAtEpochMs INTEGER, " +
                        "restStartedAtEpochMs INTEGER, " +
                        "restEndsAtEpochMs INTEGER, " +
                        "restDurationSeconds INTEGER, " +
                        "revision INTEGER NOT NULL, " +
                        "updatedAtEpochMs INTEGER NOT NULL, " +
                        "updatedBy TEXT NOT NULL, " +
                        "PRIMARY KEY(sessionId), " +
                        "FOREIGN KEY(sessionId) REFERENCES local_sessions(id) " +
                        "ON UPDATE NO ACTION ON DELETE CASCADE)",
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS index_active_workout_runtime_workoutId " +
                        "ON active_workout_runtime(workoutId)",
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS index_active_workout_runtime_updatedAtEpochMs " +
                        "ON active_workout_runtime(updatedAtEpochMs)",
                )
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS watch_processed_events (" +
                        "eventId TEXT NOT NULL, " +
                        "sessionId TEXT NOT NULL, " +
                        "revision INTEGER NOT NULL, " +
                        "processedAtEpochMs INTEGER NOT NULL, " +
                        "PRIMARY KEY(eventId))",
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS index_watch_processed_events_sessionId " +
                        "ON watch_processed_events(sessionId)",
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS index_watch_processed_events_processedAtEpochMs " +
                        "ON watch_processed_events(processedAtEpochMs)",
                )
            }
        }

        val MIGRATION_5_6 = object : Migration(5, 6) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE local_sets ADD COLUMN minHr INTEGER")
                db.execSQL("ALTER TABLE local_sets ADD COLUMN startHr INTEGER")
                db.execSQL("ALTER TABLE local_sets ADD COLUMN endHr INTEGER")
                db.execSQL("ALTER TABLE local_sets ADD COLUMN hrSampleCount INTEGER")
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS watch_sensor_batches (" +
                        "batchId TEXT NOT NULL, " +
                        "sessionId TEXT NOT NULL, " +
                        "source TEXT NOT NULL, " +
                        "deviceId TEXT NOT NULL, " +
                        "createdAtEpochMs INTEGER NOT NULL, " +
                        "sequence INTEGER NOT NULL, " +
                        "totalSequences INTEGER NOT NULL, " +
                        "sampleCount INTEGER NOT NULL, " +
                        "receivedAtEpochMs INTEGER NOT NULL, " +
                        "PRIMARY KEY(batchId, sequence), " +
                        "FOREIGN KEY(sessionId) REFERENCES local_sessions(id) " +
                        "ON UPDATE NO ACTION ON DELETE CASCADE)",
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS index_watch_sensor_batches_sessionId " +
                        "ON watch_sensor_batches(sessionId)",
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS index_watch_sensor_batches_createdAtEpochMs " +
                        "ON watch_sensor_batches(createdAtEpochMs)",
                )
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS watch_sensor_samples (" +
                        "sampleId TEXT NOT NULL, " +
                        "batchId TEXT NOT NULL, " +
                        "batchSequence INTEGER NOT NULL, " +
                        "sessionId TEXT NOT NULL, " +
                        "exerciseSessionId TEXT, " +
                        "setId TEXT, " +
                        "phase TEXT NOT NULL, " +
                        "sensorType TEXT NOT NULL, " +
                        "numericValue REAL, " +
                        "textValue TEXT, " +
                        "booleanValue INTEGER, " +
                        "unit TEXT NOT NULL, " +
                        "timestampEpochMs INTEGER NOT NULL, " +
                        "source TEXT NOT NULL, " +
                        "valid INTEGER NOT NULL, " +
                        "quality TEXT, " +
                        "PRIMARY KEY(sampleId), " +
                        "FOREIGN KEY(batchId, batchSequence) " +
                        "REFERENCES watch_sensor_batches(batchId, sequence) " +
                        "ON UPDATE NO ACTION ON DELETE CASCADE)",
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS index_watch_sensor_samples_batchId_batchSequence " +
                        "ON watch_sensor_samples(batchId, batchSequence)",
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS index_watch_sensor_samples_sessionId " +
                        "ON watch_sensor_samples(sessionId)",
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS index_watch_sensor_samples_setId " +
                        "ON watch_sensor_samples(setId)",
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS index_watch_sensor_samples_sessionId_phase_timestampEpochMs " +
                        "ON watch_sensor_samples(sessionId, phase, timestampEpochMs)",
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS index_watch_sensor_samples_sessionId_setId_phase_timestampEpochMs " +
                        "ON watch_sensor_samples(sessionId, setId, phase, timestampEpochMs)",
                )
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS rest_recovery_summaries (" +
                        "restId TEXT NOT NULL, " +
                        "sessionId TEXT NOT NULL, " +
                        "setId TEXT NOT NULL, " +
                        "restStartedAtEpochMs INTEGER NOT NULL, " +
                        "restEndedAtEpochMs INTEGER NOT NULL, " +
                        "startHr REAL, " +
                        "minHr REAL, " +
                        "avgHr REAL, " +
                        "hr30 REAL, " +
                        "hr60 REAL, " +
                        "drop30 REAL, " +
                        "drop60 REAL, " +
                        "hrSampleCount INTEGER NOT NULL, " +
                        "skipped INTEGER NOT NULL, " +
                        "updatedAtEpochMs INTEGER NOT NULL, " +
                        "PRIMARY KEY(restId), " +
                        "FOREIGN KEY(sessionId) REFERENCES local_sessions(id) " +
                        "ON UPDATE NO ACTION ON DELETE CASCADE)",
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS index_rest_recovery_summaries_sessionId " +
                        "ON rest_recovery_summaries(sessionId)",
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS index_rest_recovery_summaries_setId " +
                        "ON rest_recovery_summaries(setId)",
                )
                db.execSQL(
                    "CREATE UNIQUE INDEX IF NOT EXISTS " +
                        "index_rest_recovery_summaries_sessionId_setId_restStartedAtEpochMs " +
                        "ON rest_recovery_summaries(sessionId, setId, restStartedAtEpochMs)",
                )
            }
        }

        val MIGRATION_6_7 = object : Migration(6, 7) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    "ALTER TABLE active_workout_runtime ADD COLUMN " +
                        "workoutAccumulatedPauseMs INTEGER NOT NULL DEFAULT 0",
                )
                db.execSQL(
                    "ALTER TABLE active_workout_runtime ADD COLUMN " +
                        "setAccumulatedPauseMs INTEGER NOT NULL DEFAULT 0",
                )
                db.execSQL(
                    "ALTER TABLE active_workout_runtime ADD COLUMN restPausedRemainingMs INTEGER",
                )
                db.execSQL(
                    "ALTER TABLE watch_processed_events ADD COLUMN " +
                        "canonicalEventHash TEXT NOT NULL DEFAULT ''",
                )
                db.execSQL(
                    "ALTER TABLE watch_processed_events ADD COLUMN " +
                        "resultStatus TEXT NOT NULL DEFAULT 'APPLIED'",
                )
                db.execSQL(
                    "ALTER TABLE watch_processed_events ADD COLUMN " +
                        "resultRevision INTEGER NOT NULL DEFAULT 0",
                )
                db.execSQL("ALTER TABLE watch_processed_events ADD COLUMN errorCode TEXT")

                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS watch_inbox_events (" +
                        "eventId TEXT NOT NULL, sessionId TEXT NOT NULL, revision INTEGER NOT NULL, " +
                        "timestampEpochMs INTEGER NOT NULL, canonicalEventHash TEXT NOT NULL, " +
                        "envelopeJson TEXT NOT NULL, status TEXT NOT NULL, resultStatus TEXT, " +
                        "resultRevision INTEGER, errorCode TEXT, receivedAtEpochMs INTEGER NOT NULL, " +
                        "processedAtEpochMs INTEGER, PRIMARY KEY(eventId))",
                )
                db.execSQL("CREATE INDEX IF NOT EXISTS index_watch_inbox_events_sessionId ON watch_inbox_events(sessionId)")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_watch_inbox_events_status ON watch_inbox_events(status)")
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS index_watch_inbox_events_receivedAtEpochMs " +
                        "ON watch_inbox_events(receivedAtEpochMs)",
                )

                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS watch_outbox_events (" +
                        "eventId TEXT NOT NULL, sessionId TEXT NOT NULL, revision INTEGER NOT NULL, " +
                        "timestampEpochMs INTEGER NOT NULL, eventType TEXT NOT NULL, " +
                        "canonicalEventHash TEXT NOT NULL, envelopeJson TEXT NOT NULL, " +
                        "status TEXT NOT NULL, attempts INTEGER NOT NULL, lastAttemptAtEpochMs INTEGER, " +
                        "ackStatus TEXT, errorCode TEXT, relatedTransferId TEXT, " +
                        "createdAtEpochMs INTEGER NOT NULL, acknowledgedAtEpochMs INTEGER, " +
                        "PRIMARY KEY(eventId))",
                )
                db.execSQL("CREATE INDEX IF NOT EXISTS index_watch_outbox_events_sessionId ON watch_outbox_events(sessionId)")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_watch_outbox_events_status ON watch_outbox_events(status)")
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS index_watch_outbox_events_sessionId_revision_timestampEpochMs_eventId " +
                        "ON watch_outbox_events(sessionId, revision, timestampEpochMs, eventId)",
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS index_watch_outbox_events_relatedTransferId " +
                        "ON watch_outbox_events(relatedTransferId)",
                )

                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS watch_ack_journal (" +
                        "ackId TEXT NOT NULL, sessionId TEXT NOT NULL, eventIdsJson TEXT NOT NULL, " +
                        "status TEXT NOT NULL, revision INTEGER NOT NULL, errorCode TEXT, " +
                        "source TEXT NOT NULL, deviceId TEXT NOT NULL, receivedAtEpochMs INTEGER NOT NULL, " +
                        "PRIMARY KEY(ackId))",
                )
                db.execSQL("CREATE INDEX IF NOT EXISTS index_watch_ack_journal_sessionId ON watch_ack_journal(sessionId)")
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS index_watch_ack_journal_receivedAtEpochMs " +
                        "ON watch_ack_journal(receivedAtEpochMs)",
                )

                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS watch_peers (" +
                        "deviceId TEXT NOT NULL, sessionId TEXT, protocolVersion TEXT NOT NULL, " +
                        "schemaVersion INTEGER NOT NULL, lastRevision INTEGER NOT NULL, " +
                        "lastSyncAtEpochMs INTEGER, lastError TEXT, updatedAtEpochMs INTEGER NOT NULL, " +
                        "PRIMARY KEY(deviceId))",
                )
                db.execSQL("CREATE INDEX IF NOT EXISTS index_watch_peers_sessionId ON watch_peers(sessionId)")
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS index_watch_peers_lastSyncAtEpochMs " +
                        "ON watch_peers(lastSyncAtEpochMs)",
                )

                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS watch_conflicts (" +
                        "conflictId TEXT NOT NULL, sessionId TEXT NOT NULL, eventId TEXT NOT NULL, " +
                        "entityType TEXT NOT NULL, entityId TEXT NOT NULL, localRevision INTEGER NOT NULL, " +
                        "remoteRevision INTEGER NOT NULL, localEventJson TEXT NOT NULL, " +
                        "remoteEventJson TEXT NOT NULL, status TEXT NOT NULL, errorCode TEXT, " +
                        "detectedAtEpochMs INTEGER NOT NULL, resolution TEXT, resolvedAtEpochMs INTEGER, " +
                        "PRIMARY KEY(conflictId))",
                )
                db.execSQL("CREATE INDEX IF NOT EXISTS index_watch_conflicts_sessionId ON watch_conflicts(sessionId)")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_watch_conflicts_eventId ON watch_conflicts(eventId)")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_watch_conflicts_resolution ON watch_conflicts(resolution)")
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS index_watch_conflicts_detectedAtEpochMs " +
                        "ON watch_conflicts(detectedAtEpochMs)",
                )

                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS watch_file_transfers (" +
                        "transferId TEXT NOT NULL, sequence INTEGER NOT NULL, sessionId TEXT NOT NULL, " +
                        "relatedEventId TEXT, payloadType TEXT NOT NULL, payloadId TEXT NOT NULL, " +
                        "totalSequences INTEGER NOT NULL, byteLength INTEGER NOT NULL, sha256 TEXT NOT NULL, " +
                        "source TEXT NOT NULL, deviceId TEXT NOT NULL, direction TEXT NOT NULL, " +
                        "status TEXT NOT NULL, canonicalPayloadJson TEXT, errorCode TEXT, " +
                        "createdAtEpochMs INTEGER NOT NULL, updatedAtEpochMs INTEGER NOT NULL, " +
                        "PRIMARY KEY(transferId, sequence))",
                )
                db.execSQL("CREATE INDEX IF NOT EXISTS index_watch_file_transfers_sessionId ON watch_file_transfers(sessionId)")
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS index_watch_file_transfers_relatedEventId " +
                        "ON watch_file_transfers(relatedEventId)",
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS index_watch_file_transfers_payloadId_sequence " +
                        "ON watch_file_transfers(payloadId, sequence)",
                )
                db.execSQL("CREATE INDEX IF NOT EXISTS index_watch_file_transfers_status ON watch_file_transfers(status)")
            }
        }

        val MIGRATION_7_8 = object : Migration(7, 8) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS watch_resync_markers (" +
                        "sessionId TEXT NOT NULL, revision INTEGER NOT NULL, reason TEXT NOT NULL, " +
                        "createdAtEpochMs INTEGER NOT NULL, updatedAtEpochMs INTEGER NOT NULL, " +
                        "PRIMARY KEY(sessionId))",
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS index_watch_resync_markers_updatedAtEpochMs " +
                        "ON watch_resync_markers(updatedAtEpochMs)",
                )
            }
        }

        val MIGRATION_8_9 = object : Migration(8, 9) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE local_sets ADD COLUMN gymEquipmentId TEXT")
                db.execSQL("ALTER TABLE local_sets ADD COLUMN equipmentNameSnapshot TEXT")
                db.execSQL("ALTER TABLE local_sets ADD COLUMN selectedLoadKg REAL")
                db.execSQL("ALTER TABLE local_sets ADD COLUMN selectedLoadMultiplierSnapshot REAL")
                db.execSQL("ALTER TABLE local_sets ADD COLUMN nominalResistanceKg REAL")
                db.execSQL("ALTER TABLE local_sets ADD COLUMN equipmentLoadSnapshotJson TEXT")
            }
        }
    }
}
