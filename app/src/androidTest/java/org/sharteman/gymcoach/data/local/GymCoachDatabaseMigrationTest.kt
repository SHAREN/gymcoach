package org.sharteman.gymcoach.data.local

import androidx.room.testing.MigrationTestHelper
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class GymCoachDatabaseMigrationTest {
    @get:Rule
    val helper = MigrationTestHelper(
        InstrumentationRegistry.getInstrumentation(),
        GymCoachDatabase::class.java,
    )

    @Test
    fun migration3To4PreservesLegacyOutboxAndCreatesOfflineStorage() {
        helper.createDatabase(TEST_DB, 3).apply {
            execSQL(
                "INSERT INTO sync_outbox " +
                    "(operationId, type, payloadJson, status, attempts, lastError, createdAtEpochMs) " +
                    "VALUES ('operation_legacy', 'DELETE_SET', '{}', 'BLOCKED', 1, " +
                    "'Session not found.', 123)",
            )
            close()
        }

        helper.runMigrationsAndValidate(
            TEST_DB,
            4,
            true,
            GymCoachDatabase.MIGRATION_3_4,
        ).use { database ->
            database.query(
                "SELECT lastRetryRequestedAtEpochMs FROM sync_outbox " +
                    "WHERE operationId = 'operation_legacy'",
            ).use { cursor ->
                cursor.moveToFirst()
                assertEquals(0L, cursor.getLong(0))
            }
            database.query(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' " +
                    "AND name IN ('offline_read_cache', 'offline_mutation_outbox')",
            ).use { cursor ->
                cursor.moveToFirst()
                assertEquals(2, cursor.getInt(0))
            }
        }
    }

    private companion object {
        const val TEST_DB = "gymcoach-migration-test"
    }
}
