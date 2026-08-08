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

    @Test
    fun migration7To8CreatesDurableWatchRepairMarkers() {
        helper.createDatabase(TEST_DB_V8, 7).close()

        helper.runMigrationsAndValidate(
            TEST_DB_V8,
            8,
            true,
            GymCoachDatabase.MIGRATION_7_8,
        ).use { database ->
            database.execSQL(
                "INSERT INTO watch_resync_markers " +
                    "(sessionId, revision, reason, createdAtEpochMs, updatedAtEpochMs) " +
                    "VALUES ('session_v8', 3, 'SET_UPDATED', 1000, 1000)",
            )
            database.query(
                "SELECT revision, reason FROM watch_resync_markers WHERE sessionId = 'session_v8'",
            ).use { cursor ->
                cursor.moveToFirst()
                assertEquals(3L, cursor.getLong(0))
                assertEquals("SET_UPDATED", cursor.getString(1))
            }
        }
    }

    @Test
    fun migration8To9AddsEquipmentSnapshotsWithoutChangingWatchState() {
        helper.createDatabase(TEST_DB_V9, 8).apply {
            execSQL(
                "INSERT INTO local_sessions " +
                    "(id, workoutId, gymId, startedAt, finishedAt, notes, sessionRpe) VALUES " +
                    "('session_v9', 'workout_v9', 'gym_v9', '2026-07-15T06:00:00Z', NULL, NULL, NULL)",
            )
            execSQL(
                "INSERT INTO local_sets " +
                    "(id, sessionId, exerciseId, setNumber, weight, reps, rir, durationSec, " +
                    "distanceM, avgHr, maxHr, notes, isWarmup, isDropSet, recoverySec, " +
                    "completedAt, deleted, exerciseSessionId, startedAt, source, watchRevision, " +
                    "minHr, startHr, endHr, hrSampleCount) VALUES " +
                    "('set_v9', 'session_v9', 'exercise_v9', 1, 80, 10, 2, NULL, NULL, NULL, " +
                    "NULL, NULL, 0, 0, NULL, '2026-07-15T06:01:00Z', 0, NULL, NULL, " +
                    "'PHONE', NULL, NULL, NULL, NULL, NULL)",
            )
            execSQL(
                "INSERT INTO watch_resync_markers " +
                    "(sessionId, revision, reason, createdAtEpochMs, updatedAtEpochMs) " +
                    "VALUES ('session_v9', 4, 'SET_COMPLETED', 1000, 1000)",
            )
            close()
        }

        helper.runMigrationsAndValidate(
            TEST_DB_V9,
            9,
            true,
            GymCoachDatabase.MIGRATION_8_9,
        ).use { database ->
            database.query(
                "SELECT gymEquipmentId, equipmentNameSnapshot, selectedLoadKg, " +
                    "selectedLoadMultiplierSnapshot, nominalResistanceKg, equipmentLoadSnapshotJson " +
                    "FROM local_sets WHERE id = 'set_v9'",
            ).use { cursor ->
                cursor.moveToFirst()
                repeat(6) { index -> assertEquals(true, cursor.isNull(index)) }
            }
            database.query(
                "SELECT revision, reason FROM watch_resync_markers WHERE sessionId = 'session_v9'",
            ).use { cursor ->
                cursor.moveToFirst()
                assertEquals(4L, cursor.getLong(0))
                assertEquals("SET_COMPLETED", cursor.getString(1))
            }
        }
    }

    @Test
    fun migration9To10AddsDurableActiveTargetSetOverrides() {
        helper.createDatabase(TEST_DB_V10, 9).apply {
            execSQL(
                "INSERT INTO local_sessions " +
                    "(id, workoutId, gymId, startedAt, finishedAt, notes, sessionRpe) VALUES " +
                    "('session_v10', 'workout_v10', NULL, '2026-07-30T10:00:00Z', NULL, NULL, NULL)",
            )
            close()
        }

        helper.runMigrationsAndValidate(
            TEST_DB_V10,
            10,
            true,
            GymCoachDatabase.MIGRATION_9_10,
        ).use { database ->
            database.execSQL(
                "INSERT INTO active_target_set_overrides " +
                    "(sessionId, programExerciseId, targetSets, updatedAtEpochMs) " +
                    "VALUES ('session_v10', 'program_exercise_v10', 4, 1000)",
            )
            database.query(
                "SELECT targetSets FROM active_target_set_overrides " +
                    "WHERE sessionId = 'session_v10' AND programExerciseId = 'program_exercise_v10'",
            ).use { cursor ->
                cursor.moveToFirst()
                assertEquals(4, cursor.getInt(0))
            }
        }
    }

    @Test
    fun migration10To11NormalizesWireTypesAndRetriesLegacyDiscriminatorFailures() {
        helper.createDatabase(TEST_DB_V11, 10).apply {
            val legacyTypes = listOf(
                "StartSessionOperation" to "START_SESSION",
                "UpsertSetOperation" to "UPSERT_SET",
                "DeleteSetOperation" to "DELETE_SET",
                "DeleteSessionOperation" to "DELETE_SESSION",
                "UpdateTargetSetsOperation" to "UPDATE_TARGET_SETS",
                "UpdatePreferredEquipmentOperation" to "UPDATE_PREFERRED_EQUIPMENT",
                "MutateWorkoutExercisesOperation" to "MUTATE_WORKOUT_EXERCISES",
                "ReplaceProgramExerciseOperation" to "REPLACE_PROGRAM_EXERCISE",
                "FinishSessionOperation" to "FINISH_SESSION",
            )
            legacyTypes.forEachIndexed { index, (legacyType, wireType) ->
                execSQL(
                    "INSERT INTO sync_outbox " +
                        "(operationId, type, payloadJson, status, attempts, lastError, " +
                        "lastRetryRequestedAtEpochMs, createdAtEpochMs) " +
                        "VALUES (?, ?, ?, 'PENDING', 0, NULL, 0, ?)",
                    arrayOf<Any>(
                        "operation_type_$index",
                        legacyType,
                        "{\"type\":\"$wireType\",\"operationId\":\"operation_type_$index\"}",
                        index,
                    ),
                )
            }
            execSQL(
                "INSERT INTO sync_outbox " +
                    "(operationId, type, payloadJson, status, attempts, lastError, " +
                    "lastRetryRequestedAtEpochMs, createdAtEpochMs) VALUES " +
                    "('operation_incompatible', 'UpdatePreferredEquipmentOperation', " +
                    "'{\"type\":\"UPDATE_PREFERRED_EQUIPMENT\",\"operationId\":\"operation_incompatible\",\"gymId\":\"gym_1\",\"exerciseId\":\"exercise_1\",\"preferredEquipmentId\":null}', " +
                    "'BLOCKED', 1, 'Invalid discriminator value. Expected START_SESSION | UPSERT_SET.', 99, 1000)",
            )
            execSQL(
                "INSERT INTO sync_outbox " +
                    "(operationId, type, payloadJson, status, attempts, lastError, " +
                    "lastRetryRequestedAtEpochMs, createdAtEpochMs) VALUES " +
                    "('operation_other', 'DeleteSetOperation', " +
                    "'{\"type\":\"DELETE_SET\",\"operationId\":\"operation_other\",\"setId\":\"set_1\"}', " +
                    "'BLOCKED', 2, 'Set no longer exists.', 88, 1001)",
            )
            close()
        }

        helper.runMigrationsAndValidate(
            TEST_DB_V11,
            11,
            true,
            GymCoachDatabase.MIGRATION_10_11,
        ).use { database ->
            val expectedWireTypes = listOf(
                "START_SESSION",
                "UPSERT_SET",
                "DELETE_SET",
                "DELETE_SESSION",
                "UPDATE_TARGET_SETS",
                "UPDATE_PREFERRED_EQUIPMENT",
                "MUTATE_WORKOUT_EXERCISES",
                "REPLACE_PROGRAM_EXERCISE",
                "FINISH_SESSION",
            )
            database.query(
                "SELECT type FROM sync_outbox WHERE operationId LIKE 'operation_type_%' " +
                    "ORDER BY createdAtEpochMs",
            ).use { cursor ->
                val actual = buildList {
                    while (cursor.moveToNext()) add(cursor.getString(0))
                }
                assertEquals(expectedWireTypes, actual)
            }
            database.query(
                "SELECT type, status, lastError, lastRetryRequestedAtEpochMs " +
                    "FROM sync_outbox WHERE operationId = 'operation_incompatible'",
            ).use { cursor ->
                cursor.moveToFirst()
                assertEquals("UPDATE_PREFERRED_EQUIPMENT", cursor.getString(0))
                assertEquals("PENDING", cursor.getString(1))
                assertEquals(true, cursor.isNull(2))
                assertEquals(0L, cursor.getLong(3))
            }
            database.query(
                "SELECT type, status, lastError, lastRetryRequestedAtEpochMs " +
                    "FROM sync_outbox WHERE operationId = 'operation_other'",
            ).use { cursor ->
                cursor.moveToFirst()
                assertEquals("DELETE_SET", cursor.getString(0))
                assertEquals("BLOCKED", cursor.getString(1))
                assertEquals("Set no longer exists.", cursor.getString(2))
                assertEquals(88L, cursor.getLong(3))
            }
        }
    }

    @Test
    fun migration11To12AddsStructuredErrorMetadataWithoutChangingQueuedOperations() {
        helper.createDatabase(TEST_DB_V12, 11).apply {
            execSQL(
                "INSERT INTO sync_outbox " +
                    "(operationId, type, payloadJson, status, attempts, lastError, " +
                    "lastRetryRequestedAtEpochMs, createdAtEpochMs) VALUES " +
                    "('operation_legacy_error', 'UPSERT_SET', '{}', 'BLOCKED', 3, " +
                    "'Invalid legacy operation.', 77, 1000)",
            )
            close()
        }

        helper.runMigrationsAndValidate(
            TEST_DB_V12,
            12,
            true,
            GymCoachDatabase.MIGRATION_11_12,
        ).use { database ->
            database.query(
                "SELECT type, status, attempts, lastError, lastRetryRequestedAtEpochMs, " +
                    "lastErrorCategory, lastHttpStatus, lastErrorCode, lastCorrelationId, " +
                    "lastExceptionClass, lastStackTrace " +
                    "FROM sync_outbox WHERE operationId = 'operation_legacy_error'",
            ).use { cursor ->
                cursor.moveToFirst()
                assertEquals("UPSERT_SET", cursor.getString(0))
                assertEquals("BLOCKED", cursor.getString(1))
                assertEquals(3, cursor.getInt(2))
                assertEquals("Invalid legacy operation.", cursor.getString(3))
                assertEquals(77L, cursor.getLong(4))
                assertEquals(true, cursor.isNull(5))
                assertEquals(true, cursor.isNull(6))
                assertEquals(true, cursor.isNull(7))
                assertEquals(true, cursor.isNull(8))
                assertEquals(true, cursor.isNull(9))
                assertEquals(true, cursor.isNull(10))
            }
        }
    }

    @Test
    fun migration12To13AddsDurableWorkoutStructureDecisions() {
        helper.createDatabase(TEST_DB_V13, 12).apply {
            execSQL(
                "INSERT INTO local_sessions " +
                    "(id, workoutId, gymId, startedAt, finishedAt, notes, sessionRpe) VALUES " +
                    "('session_v13', 'workout_v13', 'gym_v13', " +
                    "'2026-08-08T10:00:00Z', NULL, NULL, NULL)",
            )
            close()
        }

        helper.runMigrationsAndValidate(
            TEST_DB_V13,
            13,
            true,
            GymCoachDatabase.MIGRATION_12_13,
        ).use { database ->
            database.execSQL(
                "INSERT INTO workout_structure_drafts " +
                    "(sessionId, workoutId, baselineJson, currentJson, status, updatedAtEpochMs) " +
                    "VALUES ('session_v13', 'workout_v13', '{\"baseline\":true}', " +
                    "'{\"current\":true}', 'PENDING', 1234)",
            )
            database.query(
                "SELECT workoutId, baselineJson, currentJson, status, updatedAtEpochMs " +
                    "FROM workout_structure_drafts WHERE sessionId = 'session_v13'",
            ).use { cursor ->
                cursor.moveToFirst()
                assertEquals("workout_v13", cursor.getString(0))
                assertEquals("{\"baseline\":true}", cursor.getString(1))
                assertEquals("{\"current\":true}", cursor.getString(2))
                assertEquals("PENDING", cursor.getString(3))
                assertEquals(1234L, cursor.getLong(4))
            }
        }
    }

    private companion object {
        const val TEST_DB = "gymcoach-migration-test"
        const val TEST_DB_V5 = "gymcoach-migration-v5-test"
        const val TEST_DB_V6 = "gymcoach-migration-v6-test"
        const val TEST_DB_V7 = "gymcoach-migration-v7-test"
        const val TEST_DB_V8 = "gymcoach-migration-v8-test"
        const val TEST_DB_V9 = "gymcoach-migration-v9-test"
        const val TEST_DB_V10 = "gymcoach-migration-v10-test"
        const val TEST_DB_V11 = "gymcoach-migration-v11-test"
        const val TEST_DB_V12 = "gymcoach-migration-v12-test"
        const val TEST_DB_V13 = "gymcoach-migration-v13-test"
    }
}
