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
        SyncOutboxEntity::class,
        OfflineReadCacheEntity::class,
        OfflineMutationEntity::class,
    ],
    version = 5,
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
            ).addMigrations(MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4, MIGRATION_4_5)
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
    }
}
