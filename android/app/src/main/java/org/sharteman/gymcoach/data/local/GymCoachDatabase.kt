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
        SyncOutboxEntity::class,
        OfflineReadCacheEntity::class,
        OfflineMutationEntity::class,
    ],
    version = 4,
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
            ).addMigrations(MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4).build().also { instance = it }
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
    }
}
