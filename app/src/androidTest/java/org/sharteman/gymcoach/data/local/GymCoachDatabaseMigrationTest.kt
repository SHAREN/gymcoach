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

    @Test
    fun migration5To6PreservesSetsAndCreatesChunkedSensorStorage() {
        helper.createDatabase(TEST_DB_V6, 5).apply {
            execSQL(
                "INSERT INTO local_sessions " +
                    "(id, workoutId, gymId, startedAt, finishedAt, notes, sessionRpe) " +
                    "VALUES ('mob_session_v6', 'workout_v6', NULL, " +
                    "'2026-07-15T04:00:00Z', NULL, NULL, NULL)",
            )
            execSQL(
                "INSERT INTO local_sets " +
                    "(id, sessionId, exerciseId, setNumber, weight, reps, rir, durationSec, " +
                    "distanceM, avgHr, maxHr, notes, isWarmup, isDropSet, recoverySec, " +
                    "completedAt, deleted, exerciseSessionId, startedAt, source, watchRevision) VALUES " +
                    "('mob_set_v6', 'mob_session_v6', 'exercise_v6', 1, 100, 8, 2, 60, " +
                    "NULL, 150, 170, NULL, 0, 0, NULL, '2026-07-15T04:01:00Z', 0, " +
                    "'exercise_session_v6', '2026-07-15T04:00:00Z', 'WATCH', 2)",
            )
            close()
        }

        helper.runMigrationsAndValidate(
            TEST_DB_V6,
            6,
            true,
            GymCoachDatabase.MIGRATION_5_6,
        ).use { database ->
            database.query(
                "SELECT avgHr, maxHr, minHr, startHr, endHr, hrSampleCount " +
                    "FROM local_sets WHERE id = 'mob_set_v6'",
            ).use { cursor ->
                cursor.moveToFirst()
                assertEquals(150, cursor.getInt(0))
                assertEquals(170, cursor.getInt(1))
                assertEquals(true, cursor.isNull(2))
                assertEquals(true, cursor.isNull(3))
                assertEquals(true, cursor.isNull(4))
                assertEquals(true, cursor.isNull(5))
            }
            database.execSQL(
                "INSERT INTO watch_sensor_batches " +
                    "(batchId, sessionId, source, deviceId, createdAtEpochMs, sequence, " +
                    "totalSequences, sampleCount, receivedAtEpochMs) VALUES " +
                    "('50000000-0000-0000-0000-000000000001', 'mob_session_v6', 'WATCH', " +
                    "'watch-v6', 1000, 1, 2, 1, 2000)",
            )
            database.execSQL(
                "INSERT INTO watch_sensor_batches " +
                    "(batchId, sessionId, source, deviceId, createdAtEpochMs, sequence, " +
                    "totalSequences, sampleCount, receivedAtEpochMs) VALUES " +
                    "('50000000-0000-0000-0000-000000000001', 'mob_session_v6', 'WATCH', " +
                    "'watch-v6', 1000, 2, 2, 1, 2000)",
            )
            database.execSQL(
                "INSERT INTO watch_sensor_samples " +
                    "(sampleId, batchId, batchSequence, sessionId, exerciseSessionId, setId, " +
                    "phase, sensorType, numericValue, textValue, booleanValue, unit, " +
                    "timestampEpochMs, source, valid, quality) VALUES " +
                    "('60000000-0000-0000-0000-000000000001', " +
                    "'50000000-0000-0000-0000-000000000001', 2, 'mob_session_v6', " +
                    "'exercise_session_v6', 'mob_set_v6', 'REST', 'HEART_RATE', " +
                    "NULL, NULL, NULL, 'BPM', 3000, 'WATCH', 0, 'OFF_WRIST')",
            )
            database.query(
                "SELECT COUNT(*), SUM(sampleCount) FROM watch_sensor_batches " +
                    "WHERE batchId = '50000000-0000-0000-0000-000000000001'",
            ).use { cursor ->
                cursor.moveToFirst()
                assertEquals(2, cursor.getInt(0))
                assertEquals(2, cursor.getInt(1))
            }
            database.query(
                "SELECT numericValue, valid, quality, batchSequence FROM watch_sensor_samples",
            ).use { cursor ->
                cursor.moveToFirst()
                assertEquals(true, cursor.isNull(0))
                assertEquals(0, cursor.getInt(1))
                assertEquals("OFF_WRIST", cursor.getString(2))
                assertEquals(2, cursor.getInt(3))
            }
        }
    }

    @Test
    fun migration6To7PreservesRuntimeAndProcessedEventsAndCreatesDurableWatchSync() {
        helper.createDatabase(TEST_DB_V7, 6).apply {
            execSQL(
                "INSERT INTO local_sessions " +
                    "(id, workoutId, gymId, startedAt, finishedAt, notes, sessionRpe) VALUES " +
                    "('mob_session_v7', 'workout_v7', NULL, '2026-07-15T05:00:00Z', NULL, NULL, NULL)",
            )
            execSQL(
                "INSERT INTO active_workout_runtime " +
                    "(sessionId, workoutId, status, activeExerciseId, activeSetId, " +
                    "setStartedAtEpochMs, pausedAtEpochMs, restStartedAtEpochMs, restEndsAtEpochMs, " +
                    "restDurationSeconds, revision, updatedAtEpochMs, updatedBy) VALUES " +
                    "('mob_session_v7', 'workout_v7', 'PAUSED', 'exercise_v7', 'set_v7', " +
                    "1000, 2000, 3000, 5000, 2, 7, 2000, 'WATCH')",
            )
            execSQL(
                "INSERT INTO watch_processed_events " +
                    "(eventId, sessionId, revision, processedAtEpochMs) VALUES " +
                    "('70000000-0000-0000-0000-000000000001', 'mob_session_v7', 7, 2100)",
            )
            close()
        }

        helper.runMigrationsAndValidate(
            TEST_DB_V7,
            7,
            true,
            GymCoachDatabase.MIGRATION_6_7,
        ).use { database ->
            database.query(
                "SELECT workoutAccumulatedPauseMs, setAccumulatedPauseMs, restPausedRemainingMs " +
                    "FROM active_workout_runtime WHERE sessionId = 'mob_session_v7'",
            ).use { cursor ->
                cursor.moveToFirst()
                assertEquals(0L, cursor.getLong(0))
                assertEquals(0L, cursor.getLong(1))
                assertEquals(true, cursor.isNull(2))
            }
            database.query(
                "SELECT canonicalEventHash, resultStatus, resultRevision, errorCode " +
                    "FROM watch_processed_events WHERE eventId = '70000000-0000-0000-0000-000000000001'",
            ).use { cursor ->
                cursor.moveToFirst()
                assertEquals("", cursor.getString(0))
                assertEquals("APPLIED", cursor.getString(1))
                assertEquals(0L, cursor.getLong(2))
                assertEquals(true, cursor.isNull(3))
            }
            database.query(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN (" +
                    "'watch_inbox_events', 'watch_outbox_events', 'watch_ack_journal', " +
                    "'watch_peers', 'watch_conflicts', 'watch_file_transfers')",
            ).use { cursor ->
                cursor.moveToFirst()
                assertEquals(6, cursor.getInt(0))
            }
        }
    }

    private companion object {
        const val TEST_DB = "gymcoach-migration-test"
        const val TEST_DB_V5 = "gymcoach-migration-v5-test"
        const val TEST_DB_V6 = "gymcoach-migration-v6-test"
        const val TEST_DB_V7 = "gymcoach-migration-v7-test"
    }
}
