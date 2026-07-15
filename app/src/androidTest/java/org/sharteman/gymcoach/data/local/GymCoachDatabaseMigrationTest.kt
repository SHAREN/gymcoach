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

    @Test
    fun migration4To5PreservesSetsAndCreatesRestartableWatchRuntime() {
        helper.createDatabase(TEST_DB_V5, 4).apply {
            execSQL(
                "INSERT INTO local_sessions " +
                    "(id, workoutId, gymId, startedAt, finishedAt, notes, sessionRpe) " +
                    "VALUES ('mob_session_opaque', 'workout_opaque', NULL, " +
                    "'2026-07-15T03:00:00Z', NULL, NULL, NULL)",
            )
            execSQL(
                "INSERT INTO local_sets " +
                    "(id, sessionId, exerciseId, setNumber, weight, reps, rir, durationSec, " +
                    "distanceM, avgHr, maxHr, notes, isWarmup, isDropSet, recoverySec, " +
                    "completedAt, deleted) VALUES " +
                    "('mob_set_opaque', 'mob_session_opaque', 'exercise_opaque', 1, 100, 8, 2, " +
                    "NULL, NULL, NULL, NULL, NULL, 0, 0, NULL, '2026-07-15T03:01:00Z', 0)",
            )
            close()
        }

        helper.runMigrationsAndValidate(
            TEST_DB_V5,
            5,
            true,
            GymCoachDatabase.MIGRATION_4_5,
        ).use { database ->
            database.query(
                "SELECT exerciseSessionId, startedAt, source, watchRevision " +
                    "FROM local_sets WHERE id = 'mob_set_opaque'",
            ).use { cursor ->
                cursor.moveToFirst()
                assertEquals(true, cursor.isNull(0))
                assertEquals(true, cursor.isNull(1))
                assertEquals(true, cursor.isNull(2))
                assertEquals(true, cursor.isNull(3))
            }
            database.execSQL(
                "INSERT INTO active_workout_runtime " +
                    "(sessionId, workoutId, status, activeExerciseId, activeSetId, " +
                    "setStartedAtEpochMs, pausedAtEpochMs, restStartedAtEpochMs, " +
                    "restEndsAtEpochMs, restDurationSeconds, revision, updatedAtEpochMs, updatedBy) VALUES " +
                    "('mob_session_opaque', 'workout_opaque', 'ACTIVE', 'exercise_opaque', " +
                    "'watch_set_opaque', 1000, NULL, NULL, NULL, NULL, 3, 2000, 'WATCH')",
            )
            database.query(
                "SELECT activeExerciseId, activeSetId, setStartedAtEpochMs, revision, updatedBy " +
                    "FROM active_workout_runtime WHERE sessionId = 'mob_session_opaque'",
            ).use { cursor ->
                cursor.moveToFirst()
                assertEquals("exercise_opaque", cursor.getString(0))
                assertEquals("watch_set_opaque", cursor.getString(1))
                assertEquals(1000L, cursor.getLong(2))
                assertEquals(3L, cursor.getLong(3))
                assertEquals("WATCH", cursor.getString(4))
            }
        }
    }

    private companion object {
        const val TEST_DB = "gymcoach-migration-test"
        const val TEST_DB_V5 = "gymcoach-migration-v5-test"
    }
}
