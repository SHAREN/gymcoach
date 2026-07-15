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
