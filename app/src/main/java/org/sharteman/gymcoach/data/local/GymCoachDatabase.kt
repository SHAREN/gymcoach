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
    ],
    version = 3,
    exportSchema = true,
)
abstract class GymCoachDatabase : RoomDatabase() {
    abstract fun dao(): GymCoachDao

    companion object {
        @Volatile private var instance: GymCoachDatabase? = null

        fun get(context: Context): GymCoachDatabase = instance ?: synchronized(this) {
            instance ?: Room.databaseBuilder(
                context.applicationContext,
                GymCoachDatabase::class.java,
                "gymcoach-android.db",
            ).addMigrations(MIGRATION_1_2, MIGRATION_2_3).build().also { instance = it }
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
    }
}
