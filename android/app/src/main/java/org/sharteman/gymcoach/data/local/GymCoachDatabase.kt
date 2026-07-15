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
        WatchSensorBatchEntity::class,
        WatchSensorSampleEntity::class,
        RestRecoverySummaryEntity::class,
        SyncOutboxEntity::class,
        OfflineReadCacheEntity::class,
        OfflineMutationEntity::class,
    ],
    version = 6,
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
    }
}
