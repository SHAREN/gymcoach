package org.sharteman.gymcoach.data.repository

import java.io.IOException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.sharteman.gymcoach.data.local.BootstrapCacheEntity
import org.sharteman.gymcoach.data.local.ActiveWorkoutRuntimeEntity
import org.sharteman.gymcoach.data.local.GymCoachDao
import org.sharteman.gymcoach.data.local.LocalSessionEntity
import org.sharteman.gymcoach.data.local.LocalSetEntity
import org.sharteman.gymcoach.data.local.ProgressCacheEntity
import org.sharteman.gymcoach.data.local.RestRecoverySummaryEntity
import org.sharteman.gymcoach.data.local.SyncOutboxEntity
import org.sharteman.gymcoach.data.local.WatchProcessedEventEntity
import org.sharteman.gymcoach.data.local.WatchSensorBatchEntity
import org.sharteman.gymcoach.data.local.WatchSensorSampleEntity
import org.sharteman.gymcoach.data.model.BootstrapResponse
import org.sharteman.gymcoach.data.model.DeleteSetOperation
import org.sharteman.gymcoach.data.model.DeleteSessionOperation
import org.sharteman.gymcoach.data.model.ExerciseDto
import org.sharteman.gymcoach.data.model.ExerciseHistorySessionDto
import org.sharteman.gymcoach.data.model.FinishSessionOperation
import org.sharteman.gymcoach.data.model.LoginRequest
import org.sharteman.gymcoach.data.model.LoginResponse
import org.sharteman.gymcoach.data.model.MobileSetPayload
import org.sharteman.gymcoach.data.model.MobileProgressExerciseDto
import org.sharteman.gymcoach.data.model.MobileProgressPointDto
import org.sharteman.gymcoach.data.model.MobileProgressSnapshot
import org.sharteman.gymcoach.data.model.MobileUser
import org.sharteman.gymcoach.data.model.ProfileDto
import org.sharteman.gymcoach.data.model.ReadinessCheckinRequest
import org.sharteman.gymcoach.data.model.ProgramDto
import org.sharteman.gymcoach.data.model.ProgramExerciseDto
import org.sharteman.gymcoach.data.model.SessionDto
import org.sharteman.gymcoach.data.model.SetDto
import org.sharteman.gymcoach.data.model.SyncBatchRequest
import org.sharteman.gymcoach.data.model.SyncBatchResponse
import org.sharteman.gymcoach.data.model.SyncOperation
import org.sharteman.gymcoach.data.model.SyncOperationResult
import org.sharteman.gymcoach.data.model.StartSessionOperation
import org.sharteman.gymcoach.data.model.MobileSessionPayload
import org.sharteman.gymcoach.data.model.UpdateTargetSetsOperation
import org.sharteman.gymcoach.data.model.UpsertSetOperation
import org.sharteman.gymcoach.data.model.WorkoutDto
import org.sharteman.gymcoach.data.network.MobileApi
import org.sharteman.gymcoach.data.network.ApiException
import org.sharteman.gymcoach.data.security.AccountStore

class GymCoachRepositorySyncTest {
    @Test
    fun startWorkoutPersistsActiveRuntimeWithoutASecondSessionModel() = runTest {
        val fixture = fixture()
        val workout = requireNotNull(bootstrapWithTargetSets(3).activeProgram).workouts.single()

        val sessionId = fixture.repository.startWorkout(workout, gymId = null)

        val session = requireNotNull(fixture.dao.getSession(sessionId))
        val runtime = requireNotNull(fixture.dao.getActiveWorkoutRuntime(sessionId))
        assertEquals(session.id, runtime.sessionId)
        assertEquals(workout.id, runtime.workoutId)
        assertEquals(workout.exercises.single().exerciseId, runtime.activeExerciseId)
        assertEquals(1L, runtime.revision)
        assertEquals("PHONE", runtime.updatedBy)
        assertEquals(1, fixture.dao.queuedOperations().size)
        assertEquals(1, fixture.syncCounter.count)
    }

    @Test
    fun refreshProgressSavesTheLatestSnapshotInTheOfflineCache() = runTest {
        val fixture = fixture()
        val expected = progressSnapshot(generatedAt = "2026-07-14T08:00:00Z")
        fixture.api.progressResponse = expected

        val actual = fixture.repository.refreshProgress()

        assertEquals(expected, actual)
        assertEquals(1, fixture.api.progressCalls)
        val cached = requireNotNull(fixture.dao.getProgress())
        assertEquals(
            expected,
            fixture.api.json.decodeFromString<MobileProgressSnapshot>(cached.payloadJson),
        )
        assertTrue(cached.updatedAtEpochMs > 0)
    }

    @Test
    fun targetedProgressRefreshForwardsTheSelectedExerciseId() = runTest {
        val fixture = fixture()

        fixture.repository.refreshProgress("exercise_old")

        assertEquals(listOf("exercise_old"), fixture.api.progressExerciseIds)
    }

    @Test
    fun failedProgressRefreshPreservesTheExistingOfflineCache() = runTest {
        val fixture = fixture()
        val existing = progressSnapshot(generatedAt = "2026-07-13T08:00:00Z")
        fixture.dao.saveProgress(
            ProgressCacheEntity(
                payloadJson = fixture.api.json.encodeToString(existing),
                updatedAtEpochMs = 1234L,
            ),
        )
        fixture.api.progressFailure = IOException("progress unavailable")

        val result = runCatching { fixture.repository.refreshProgress() }

        assertTrue(result.exceptionOrNull() is IOException)
        assertEquals(1, fixture.api.progressCalls)
        val cached = requireNotNull(fixture.dao.getProgress())
        assertEquals(1234L, cached.updatedAtEpochMs)
        assertEquals(
            existing,
            fixture.api.json.decodeFromString<MobileProgressSnapshot>(cached.payloadJson),
        )
    }

    @Test
    fun finishedOfflineSessionImmediatelyUpdatesAndPreservesExerciseHistory() = runTest {
        val fixture = fixture()
        fixture.dao.saveBootstrap(
            BootstrapCacheEntity(
                payloadJson = fixture.api.json.encodeToString(bootstrap()),
                updatedAtEpochMs = 1L,
            ),
        )
        val session = LocalSessionEntity(
            id = "session_finished_offline",
            workoutId = "workout_1",
            gymId = null,
            startedAt = "2026-07-15T10:00:00Z",
        )
        fixture.dao.saveSession(session)
        fixture.dao.saveSet(
            LocalSetEntity(
                id = "set_finished_offline",
                sessionId = session.id,
                exerciseId = "exercise_1",
                setNumber = 1,
                weight = 82.5,
                reps = 8,
                rir = 1,
                completedAt = "2026-07-15T10:05:00Z",
            ),
        )

        fixture.repository.finishSession(session.id, null, 8)

        suspend fun cachedHistory(): List<ExerciseHistorySessionDto> {
            val cached = requireNotNull(fixture.dao.getBootstrap())
            return fixture.api.json.decodeFromString<BootstrapResponse>(cached.payloadJson)
                .exerciseHistoryByExerciseId
                .getValue("exercise_1")
        }
        assertEquals(session.id, cachedHistory().single().sessionId)
        assertEquals(82.5, cachedHistory().single().sets.single().weight, 0.0)

        fixture.api.bootstrapResponse = bootstrap()
        fixture.repository.refreshBootstrap()
        assertEquals(session.id, cachedHistory().single().sessionId)

        fixture.repository.resetSession(session.id)
        val resetCache = requireNotNull(fixture.dao.getBootstrap())
        assertFalse(
            fixture.api.json.decodeFromString<BootstrapResponse>(resetCache.payloadJson)
                .exerciseHistoryByExerciseId
                .containsKey("exercise_1"),
        )
    }

    @Test
    fun discardingRejectedOfflineSessionRemovesCachedExerciseHistory() = runTest {
        val fixture = fixture()
        val sessionId = "session_discard_history"
        fixture.dao.saveBootstrap(
            BootstrapCacheEntity(
                payloadJson = fixture.api.json.encodeToString(
                    bootstrap(
                        exerciseHistoryByExerciseId = mapOf(
                            "exercise_1" to listOf(
                                ExerciseHistorySessionDto(
                                    sessionId = sessionId,
                                    startedAt = "2026-07-15T10:00:00Z",
                                    localOnly = true,
                                ),
                            ),
                        ),
                    ),
                ),
                updatedAtEpochMs = 1L,
            ),
        )
        fixture.dao.saveSession(
            LocalSessionEntity(
                id = sessionId,
                workoutId = "workout_1",
                gymId = null,
                startedAt = "2026-07-15T10:00:00Z",
                finishedAt = "2026-07-15T11:00:00Z",
            ),
        )
        val finish = FinishSessionOperation(
            operationId = "operation_discard_history",
            sessionId = sessionId,
            finishedAt = "2026-07-15T11:00:00Z",
        )
        fixture.dao.enqueue(fixture.outbox(finish))
        fixture.dao.markOperationBlocked(finish.operationId, "Session not found.")
        fixture.api.bootstrapFailure = IOException("offline")

        fixture.repository.discardBlockedChange()

        val cached = requireNotNull(fixture.dao.getBootstrap())
        assertFalse(
            fixture.api.json.decodeFromString<BootstrapResponse>(cached.payloadJson)
                .exerciseHistoryByExerciseId
                .containsKey("exercise_1"),
        )
    }

    @Test
    fun savingReadinessRefreshesTheBootstrapCache() = runTest {
        val fixture = fixture()
        fixture.api.bootstrapResponse = bootstrap()

        fixture.repository.saveReadiness(4, 3, "  Busy day  ")

        assertEquals(
            listOf(ReadinessCheckinRequest(4, 3, "Busy day")),
            fixture.api.readinessRequests,
        )
        assertTrue(fixture.dao.getBootstrap() != null)
    }

    @Test
    fun committedReadinessIsNotReportedAsFailedWhenRefreshFails() = runTest {
        val fixture = fixture()
        fixture.api.bootstrapFailure = IOException("refresh unavailable")

        val result = runCatching { fixture.repository.saveReadiness(4, 3, null) }

        assertTrue(result.isSuccess)
        assertEquals(1, fixture.api.readinessRequests.size)
    }

    @Test
    fun resettingSessionPersistsDeleteIntentAcrossRefreshAndRestart() = runTest {
        val fixture = fixture()
        val session = LocalSessionEntity(
            id = "session_reset",
            workoutId = "workout_1",
            gymId = null,
            startedAt = "2026-07-13T10:00:00Z",
        )
        fixture.dao.saveSession(session)
        fixture.dao.enqueue(
            fixture.outbox(
                StartSessionOperation(
                    operationId = "operation_reset_start",
                    session = MobileSessionPayload(session.id, session.workoutId, null, session.startedAt),
                ),
            ),
        )

        fixture.repository.resetSession(session.id)

        assertEquals(null, fixture.dao.getSession(session.id))
        val queued = fixture.dao.queuedOperations()
        assertEquals(1, queued.size)
        assertEquals(
            session.id,
            (fixture.api.json.decodeFromString<SyncOperation>(queued.single().payloadJson) as DeleteSessionOperation)
                .sessionId,
        )

        fixture.api.bootstrapResponse = bootstrap(
            openSessions = listOf(
                SessionDto(
                    id = session.id,
                    workoutId = session.workoutId,
                    startedAt = session.startedAt,
                ),
            ),
        )
        fixture.repository.refreshBootstrap()
        assertEquals(null, fixture.dao.getSession(session.id))

        fixture.api.syncHandler = { request ->
            if (request.operations.any { it is DeleteSessionOperation }) {
                fixture.api.bootstrapResponse = bootstrap()
            }
            SyncBatchResponse(
                serverTime = "2026-07-13T12:00:00Z",
                results = request.operations.map {
                    SyncOperationResult(operationId = it.operationId, status = "APPLIED")
                },
            )
        }
        assertTrue(fixture.repository.syncPending())
        assertEquals(null, fixture.dao.getSession(session.id))
        assertTrue(fixture.dao.queuedOperations().isEmpty())
    }

    @Test
    fun resettingSessionReplacesBlockedSessionChainWithDurableDeleteIntent() = runTest {
        val fixture = fixture()
        val session = LocalSessionEntity(
            id = "session_reset_blocked",
            workoutId = "workout_1",
            gymId = null,
            startedAt = "2026-07-13T10:00:00Z",
        )
        val missingSet = MobileSetPayload(
            id = "set_reset_missing",
            sessionId = session.id,
            exerciseId = "exercise_1",
            setNumber = 1,
            weight = 100.0,
            reps = 5,
            completedAt = "2026-07-13T10:05:00Z",
        )
        fixture.dao.saveSession(session)
        fixture.dao.enqueue(
            fixture.outbox(
                UpsertSetOperation(
                    operationId = "operation_reset_blocked_upsert",
                    set = missingSet,
                ),
            ),
        )
        fixture.dao.markOperationBlocked(
            operationId = "operation_reset_blocked_upsert",
            error = "Session not found",
        )
        fixture.dao.enqueue(
            fixture.outbox(
                DeleteSetOperation(
                    operationId = "operation_reset_missing_delete",
                    setId = missingSet.id,
                ),
            ),
        )

        fixture.repository.resetSession(session.id)

        assertEquals(null, fixture.dao.getSession(session.id))
        val queuedAfterReset = fixture.dao.queuedOperations()
        assertEquals(1, queuedAfterReset.size)
        assertEquals(
            session.id,
            (fixture.api.json.decodeFromString<SyncOperation>(queuedAfterReset.single().payloadJson)
                as DeleteSessionOperation).sessionId,
        )

        fixture.repository.discardBlockedChange()
        val queuedAfterDiscard = fixture.dao.queuedOperations()
        assertEquals(1, queuedAfterDiscard.size)
        assertTrue(
            fixture.api.json.decodeFromString<SyncOperation>(queuedAfterDiscard.single().payloadJson)
                is DeleteSessionOperation,
        )

        fixture.api.bootstrapResponse = bootstrap(
            openSessions = listOf(
                SessionDto(
                    id = session.id,
                    workoutId = session.workoutId,
                    startedAt = session.startedAt,
                ),
            ),
        )
        fixture.repository.refreshBootstrap()

        assertEquals(null, fixture.dao.getSession(session.id))
    }

    @Test
    fun successfulWorkoutSyncAttemptsProgressRefreshWithoutDependingOnIt() = runTest {
        val fixture = fixture()
        val operation = DeleteSetOperation("operation_progress_refresh", "set_progress_refresh")
        fixture.dao.enqueue(fixture.outbox(operation))
        fixture.api.progressFailure = IOException("progress unavailable")

        val synced = fixture.repository.syncPending()

        assertTrue(synced)
        assertEquals(1, fixture.api.syncCalls.size)
        assertEquals(1, fixture.api.progressCalls)
        assertTrue(fixture.dao.queuedOperations().isEmpty())
    }

    @Test
    fun syncsAnOutboxLargerThanOneServerBatchInOrder() = runTest {
        val fixture = fixture()
        repeat(501) { index ->
            fixture.dao.enqueue(fixture.outbox(DeleteSetOperation("operation_$index", "set_$index")))
        }

        assertTrue(fixture.repository.syncPending())

        assertEquals(listOf(500, 1), fixture.api.syncCalls.map { it.operations.size })
        assertEquals(
            (0 until 501).map { "operation_$it" },
            fixture.api.syncCalls.flatMap { request -> request.operations.map { it.operationId } },
        )
        assertTrue(fixture.dao.queuedOperations().isEmpty())
    }

    @Test
    fun rejectionBlocksTheQueueHeadWithoutApplyingLaterOperations() = runTest {
        val fixture = fixture()
        repeat(3) { index ->
            fixture.dao.enqueue(fixture.outbox(DeleteSetOperation("operation_$index", "set_$index")))
        }
        fixture.api.syncHandler = { request ->
            SyncBatchResponse(
                serverTime = "2026-07-13T12:00:00Z",
                results = listOf(
                    SyncOperationResult(request.operations[0].operationId, "APPLIED"),
                    SyncOperationResult(request.operations[1].operationId, "REJECTED", error = "bad data"),
                ),
            )
        }

        assertFalse(fixture.repository.syncPending())

        val queue = fixture.dao.queuedOperations()
        assertEquals(listOf("operation_1", "operation_2"), queue.map { it.operationId })
        assertEquals("BLOCKED", queue[0].status)
        assertEquals("PENDING", queue[1].status)
        assertEquals(1, fixture.api.syncCalls.size)
    }

    @Test
    fun bootstrapDoesNotOverwriteASetWithAnUnsyncedLocalEdit() = runTest {
        val fixture = fixture()
        fixture.dao.saveSession(
            LocalSessionEntity(
                id = "session_local",
                workoutId = "workout_1",
                gymId = null,
                startedAt = "2026-07-13T10:00:00Z",
            ),
        )
        val localSet = LocalSetEntity(
            id = "set_local",
            sessionId = "session_local",
            exerciseId = "exercise_1",
            setNumber = 1,
            weight = 90.0,
            reps = 8,
            rir = 2,
            completedAt = "2026-07-13T10:05:00Z",
        )
        fixture.dao.saveSet(localSet)
        val operation = UpsertSetOperation(
            operationId = "operation_local_edit",
            set = MobileSetPayload(
                id = localSet.id,
                sessionId = localSet.sessionId,
                exerciseId = localSet.exerciseId,
                setNumber = localSet.setNumber,
                weight = localSet.weight,
                reps = localSet.reps,
                rir = localSet.rir,
                completedAt = localSet.completedAt,
            ),
        )
        fixture.dao.enqueue(fixture.outbox(operation))
        fixture.api.bootstrapResponse = bootstrap(
            openSessions = listOf(
                SessionDto(
                    id = "session_local",
                    workoutId = "workout_1",
                    startedAt = "2026-07-13T10:00:00Z",
                    sets = listOf(
                        SetDto(
                            id = "set_local",
                            sessionId = "session_local",
                            exerciseId = "exercise_1",
                            setNumber = 1,
                            weight = 80.0,
                            reps = 10,
                            rir = 2,
                            completedAt = "2026-07-13T10:05:00Z",
                        ),
                    ),
                ),
            ),
        )

        fixture.repository.refreshBootstrap()

        assertEquals(90.0, fixture.dao.getSet("set_local")?.weight ?: 0.0, 0.001)
    }

    @Test
    fun corruptedOutboxPayloadPreventsUnsafeBootstrapReconciliation() {
        val targets = pendingMutationTargets(
            entries = listOf(
                SyncOutboxEntity(
                    operationId = "operation_corrupt",
                    type = "broken",
                    payloadJson = "not-json",
                ),
            ),
            json = TestApi.jsonConfig,
        )

        assertFalse(targets.complete)
    }

    @Test
    fun invalidSetInputNeverEntersTheOutbox() = runTest {
        val fixture = fixture()

        val result = runCatching {
            fixture.repository.addSet(
                sessionId = "session_1",
                exerciseId = "exercise_1",
                weight = 80.0,
                reps = 10,
                rir = 9,
                notes = null,
            )
        }

        assertTrue(result.isFailure)
        assertTrue(fixture.dao.queuedOperations().isEmpty())
    }

    @Test
    fun updatingTargetSetsOptimisticallyUpdatesCachedBootstrapAndQueuesTheChange() = runTest {
        val fixture = fixture()
        fixture.api.bootstrapResponse = bootstrapWithTargetSets(3)
        fixture.repository.refreshBootstrap()

        fixture.repository.updateTargetSets("program_exercise_1", 5)

        assertEquals(5, fixture.dao.cachedTargetSets())
        val queue = fixture.dao.queuedOperations()
        assertEquals(1, queue.size)
        val operation = fixture.decodeTargetSetsOperation(queue.single())
        assertEquals("program_exercise_1", operation.programExerciseId)
        assertEquals(3, operation.previousTargetSets)
        assertEquals(5, operation.targetSets)
    }

    @Test
    fun pendingTargetSetsOverrideSurvivesAStaleBootstrapRefresh() = runTest {
        val fixture = fixture()
        fixture.api.bootstrapResponse = bootstrapWithTargetSets(3)
        fixture.repository.refreshBootstrap()
        fixture.repository.updateTargetSets("program_exercise_1", 5)
        fixture.api.bootstrapResponse = bootstrapWithTargetSets(3)

        val refreshed = fixture.repository.refreshBootstrap()

        assertEquals(5, findProgramExerciseTargetSets(refreshed, "program_exercise_1"))
        assertEquals(5, fixture.dao.cachedTargetSets())
        assertEquals(1, fixture.dao.queuedOperations().size)
    }

    @Test
    fun targetSetsOutsideTheSupportedRangeNeverChangeCacheOrOutbox() = runTest {
        val fixture = fixture()
        fixture.api.bootstrapResponse = bootstrapWithTargetSets(3)
        fixture.repository.refreshBootstrap()

        val zeroResult = runCatching {
            fixture.repository.updateTargetSets("program_exercise_1", 0)
        }
        val twentyOneResult = runCatching {
            fixture.repository.updateTargetSets("program_exercise_1", 21)
        }

        assertTrue(zeroResult.exceptionOrNull() is IllegalArgumentException)
        assertTrue(twentyOneResult.exceptionOrNull() is IllegalArgumentException)
        assertEquals(3, fixture.dao.cachedTargetSets())
        assertTrue(fixture.dao.queuedOperations().isEmpty())
    }

    @Test
    fun discardingRejectedTargetSetsRollsBackButKeepsALaterQueuedOverride() = runTest {
        val fixture = fixture()
        fixture.api.bootstrapResponse = bootstrapWithTargetSets(3)
        fixture.repository.refreshBootstrap()
        fixture.repository.updateTargetSets("program_exercise_1", 5)
        fixture.repository.updateTargetSets("program_exercise_1", 6)
        val queuedBeforeDiscard = fixture.dao.queuedOperations()
        val rejected = queuedBeforeDiscard.first()
        val later = queuedBeforeDiscard.last()
        fixture.dao.markOperationBlocked(rejected.operationId, "Invalid target sets.")
        fixture.api.bootstrapResponse = bootstrapWithTargetSets(3)

        fixture.repository.discardBlockedChange()

        val remaining = fixture.dao.queuedOperations()
        assertEquals(listOf(later.operationId), remaining.map { it.operationId })
        val laterOperation = fixture.decodeTargetSetsOperation(remaining.single())
        assertEquals(5, laterOperation.previousTargetSets)
        assertEquals(6, laterOperation.targetSets)
        assertEquals(6, fixture.dao.cachedTargetSets())
    }

    @Test
    fun expiredAuthenticationKeepsTheOutboxAndRequiresLoginAgain() = runTest {
        val fixture = fixture()
        fixture.dao.enqueue(fixture.outbox(DeleteSetOperation("operation_auth", "set_auth")))
        fixture.api.syncFailure = ApiException(401, "Expired")

        val result = runCatching { fixture.repository.syncPending() }

        assertTrue(result.exceptionOrNull() is MobileAuthenticationRequiredException)
        assertFalse(fixture.accountStore.isAuthenticated)
        val queue = fixture.dao.queuedOperations()
        assertEquals(1, queue.size)
        assertEquals("FAILED", queue.single().status)
    }

    @Test
    fun failedInitialBootstrapDoesNotPersistTheNewLogin() = runTest {
        val fixture = fixture()
        fixture.accountStore.clearAccount()
        fixture.api.bootstrapFailure = IOException("offline")

        val result = runCatching {
            fixture.repository.login(
                email = "user@example.com",
                password = "secret",
                serverUrl = "https://example.test",
            )
        }

        assertTrue(result.exceptionOrNull() is LoginInitializationException)
        assertFalse(fixture.accountStore.isAuthenticated)
        assertEquals(null, fixture.accountStore.userEmail)
    }

    @Test
    fun discardingARejectedSessionStartRemovesItsDependentLocalWork() = runTest {
        val fixture = fixture()
        val session = LocalSessionEntity(
            id = "session_rejected",
            workoutId = "workout_1",
            gymId = null,
            startedAt = "2026-07-13T10:00:00Z",
        )
        val set = LocalSetEntity(
            id = "set_rejected",
            sessionId = session.id,
            exerciseId = "exercise_1",
            setNumber = 1,
            weight = 80.0,
            reps = 10,
            rir = 2,
            completedAt = "2026-07-13T10:05:00Z",
        )
        fixture.dao.saveSession(session)
        fixture.dao.saveSet(set)
        val start = StartSessionOperation(
            operationId = "operation_start_rejected",
            session = MobileSessionPayload(session.id, session.workoutId, null, session.startedAt),
        )
        val upsert = UpsertSetOperation(
            operationId = "operation_set_after_start",
            set = MobileSetPayload(
                id = set.id,
                sessionId = set.sessionId,
                exerciseId = set.exerciseId,
                setNumber = set.setNumber,
                weight = set.weight,
                reps = set.reps,
                rir = set.rir,
                completedAt = set.completedAt,
            ),
        )
        fixture.dao.enqueue(fixture.outbox(start))
        fixture.dao.enqueue(fixture.outbox(upsert))
        fixture.dao.markOperationBlocked(start.operationId, "Invalid gym")

        fixture.repository.discardBlockedChange()

        assertTrue(fixture.dao.queuedOperations().isEmpty())
        assertEquals(null, fixture.dao.getSession(session.id))
        assertEquals(null, fixture.dao.getSet(set.id))
    }

    @Test
    fun discardingAMissingSessionSetRemovesTheWholeOrphanedSessionChain() = runTest {
        val fixture = fixture()
        val session = LocalSessionEntity(
            id = "session_deleted_on_server",
            workoutId = "workout_1",
            gymId = null,
            startedAt = "2026-07-13T10:00:00Z",
        )
        val firstSet = LocalSetEntity(
            id = "set_orphaned_1",
            sessionId = session.id,
            exerciseId = "exercise_1",
            setNumber = 1,
            weight = 80.0,
            reps = 10,
            rir = 2,
            completedAt = "2026-07-13T10:05:00Z",
        )
        val secondSet = firstSet.copy(
            id = "set_orphaned_2",
            setNumber = 2,
            completedAt = "2026-07-13T10:08:00Z",
        )
        val otherSession = session.copy(id = "session_unrelated")
        val otherSet = firstSet.copy(
            id = "set_unrelated",
            sessionId = otherSession.id,
        )
        fixture.dao.saveSession(session)
        fixture.dao.saveSet(firstSet)
        fixture.dao.saveSet(secondSet)
        fixture.dao.saveSession(otherSession)
        fixture.dao.saveSet(otherSet)
        val firstUpsert = UpsertSetOperation(
            operationId = "operation_orphaned_1",
            set = MobileSetPayload(
                id = firstSet.id,
                sessionId = session.id,
                exerciseId = firstSet.exerciseId,
                setNumber = firstSet.setNumber,
                weight = firstSet.weight,
                reps = firstSet.reps,
                rir = firstSet.rir,
                completedAt = firstSet.completedAt,
            ),
        )
        val secondUpsert = UpsertSetOperation(
            operationId = "operation_orphaned_2",
            set = MobileSetPayload(
                id = secondSet.id,
                sessionId = session.id,
                exerciseId = secondSet.exerciseId,
                setNumber = secondSet.setNumber,
                weight = secondSet.weight,
                reps = secondSet.reps,
                rir = secondSet.rir,
                completedAt = secondSet.completedAt,
            ),
        )
        val finish = FinishSessionOperation(
            operationId = "operation_orphaned_finish",
            sessionId = session.id,
            finishedAt = "2026-07-13T11:00:00Z",
        )
        val unrelatedUpsert = UpsertSetOperation(
            operationId = "operation_unrelated",
            set = MobileSetPayload(
                id = otherSet.id,
                sessionId = otherSession.id,
                exerciseId = otherSet.exerciseId,
                setNumber = otherSet.setNumber,
                weight = otherSet.weight,
                reps = otherSet.reps,
                rir = otherSet.rir,
                completedAt = otherSet.completedAt,
            ),
        )
        fixture.dao.enqueue(fixture.outbox(firstUpsert))
        fixture.dao.enqueue(fixture.outbox(secondUpsert))
        fixture.dao.enqueue(fixture.outbox(finish))
        fixture.dao.enqueue(fixture.outbox(unrelatedUpsert))
        fixture.dao.markOperationBlocked(firstUpsert.operationId, "Session not found.")

        fixture.repository.discardBlockedChange()

        assertEquals(
            listOf(unrelatedUpsert.operationId),
            fixture.dao.queuedOperations().map { it.operationId },
        )
        assertEquals(null, fixture.dao.getSession(session.id))
        assertEquals(null, fixture.dao.getSet(firstSet.id))
        assertEquals(null, fixture.dao.getSet(secondSet.id))
        assertEquals(otherSession, fixture.dao.getSession(otherSession.id))
        assertEquals(otherSet, fixture.dao.getSet(otherSet.id))
    }

    @Test
    fun discardingAnOrdinaryRejectedSetKeepsOtherSessionChanges() = runTest {
        val fixture = fixture()
        val session = LocalSessionEntity(
            id = "session_with_one_bad_set",
            workoutId = "workout_1",
            gymId = null,
            startedAt = "2026-07-13T10:00:00Z",
        )
        val firstSet = LocalSetEntity(
            id = "set_bad",
            sessionId = session.id,
            exerciseId = "exercise_1",
            setNumber = 1,
            weight = 80.0,
            reps = 10,
            rir = 2,
            completedAt = "2026-07-13T10:05:00Z",
        )
        val secondSet = firstSet.copy(id = "set_good", setNumber = 2)
        fixture.dao.saveSession(session)
        fixture.dao.saveSet(firstSet)
        fixture.dao.saveSet(secondSet)
        val badUpsert = UpsertSetOperation(
            operationId = "operation_bad_set",
            set = MobileSetPayload(
                id = firstSet.id,
                sessionId = session.id,
                exerciseId = firstSet.exerciseId,
                setNumber = firstSet.setNumber,
                weight = firstSet.weight,
                reps = firstSet.reps,
                rir = firstSet.rir,
                completedAt = firstSet.completedAt,
            ),
        )
        val goodUpsert = UpsertSetOperation(
            operationId = "operation_good_set",
            set = MobileSetPayload(
                id = secondSet.id,
                sessionId = session.id,
                exerciseId = secondSet.exerciseId,
                setNumber = secondSet.setNumber,
                weight = secondSet.weight,
                reps = secondSet.reps,
                rir = secondSet.rir,
                completedAt = secondSet.completedAt,
            ),
        )
        fixture.dao.enqueue(fixture.outbox(badUpsert))
        fixture.dao.enqueue(fixture.outbox(goodUpsert))
        fixture.dao.markOperationBlocked(badUpsert.operationId, "Invalid repetitions.")

        fixture.repository.discardBlockedChange()

        assertEquals(listOf(goodUpsert.operationId), fixture.dao.queuedOperations().map { it.operationId })
        assertEquals(session, fixture.dao.getSession(session.id))
    }

    @Test
    fun retryingSessionNotFoundRecordsTheRequestAndSchedulesARealSync() = runTest {
        val fixture = fixture()
        val operation = UpsertSetOperation(
            operationId = "operation_retry_missing_session",
            set = MobileSetPayload(
                id = "set_retry_missing_session",
                sessionId = "session_retry_missing",
                exerciseId = "exercise_1",
                setNumber = 1,
                weight = 80.0,
                reps = 8,
                rir = 2,
                completedAt = "2026-07-14T10:05:00Z",
            ),
        )
        fixture.dao.enqueue(fixture.outbox(operation))
        fixture.dao.markOperationBlocked(operation.operationId, "Session not found.")
        assertTrue(requireNotNull(fixture.repository.syncIssue.first()).canRetry)

        fixture.repository.retryBlockedChange()

        val retried = fixture.dao.queuedOperations().single()
        assertEquals("PENDING", retried.status)
        assertEquals(null, retried.lastError)
        assertTrue(retried.lastRetryRequestedAtEpochMs > 0)
        assertEquals(1, fixture.syncCounter.count)
    }

    @Test
    fun discardingMissingSessionConflictRemovesAllEightDependentsAfterRestart() = runTest {
        val fixture = fixture()
        val sessionId = "session_missing_after_cancel"
        repeat(7) { index ->
            val operation = UpsertSetOperation(
                operationId = "operation_missing_$index",
                set = MobileSetPayload(
                    id = "set_missing_$index",
                    sessionId = sessionId,
                    exerciseId = "exercise_1",
                    setNumber = index + 1,
                    weight = 80.0,
                    reps = 8,
                    rir = 2,
                    completedAt = "2026-07-14T10:0${index}:00Z",
                ),
            )
            fixture.dao.enqueue(fixture.outbox(operation))
        }
        val finish = FinishSessionOperation(
            operationId = "operation_missing_finish",
            sessionId = sessionId,
            finishedAt = "2026-07-14T11:00:00Z",
        )
        fixture.dao.enqueue(fixture.outbox(finish))
        fixture.dao.markOperationBlocked(
            fixture.dao.queuedOperations().first().operationId,
            "Session not found.",
        )

        fixture.repository.discardBlockedChange()

        assertTrue(fixture.dao.queuedOperations().isEmpty())
        assertEquals(null, fixture.dao.getSession(sessionId))
        assertEquals(null, fixture.dao.observeBlockedOperation().first())

        val restarted = GymCoachRepository(
            dao = fixture.dao,
            accountStore = fixture.accountStore,
            api = fixture.api,
            scheduleSyncNow = { fixture.syncCounter.count++ },
            schedulePeriodicSync = {},
        )
        restarted.refreshBootstrap()

        assertTrue(fixture.dao.queuedOperations().isEmpty())
        assertEquals(null, fixture.dao.observeBlockedOperation().first())
    }

    private fun fixture(): Fixture {
        val dao = InMemoryDao()
        val api = TestApi()
        val accountStore = TestAccountStore()
        val syncCounter = SyncCounter()
        val repository = GymCoachRepository(
            dao = dao,
            accountStore = accountStore,
            api = api,
            scheduleSyncNow = { syncCounter.count++ },
            schedulePeriodicSync = {},
        )
        return Fixture(dao, api, accountStore, repository, syncCounter)
    }

    private fun bootstrap(
        openSessions: List<SessionDto> = emptyList(),
        activeProgram: ProgramDto? = null,
        exerciseHistoryByExerciseId: Map<String, List<ExerciseHistorySessionDto>> = emptyMap(),
    ) = BootstrapResponse(
        schemaVersion = 1,
        calculationVersion = "test",
        serverTime = "2026-07-13T12:00:00Z",
        profile = ProfileDto(id = "user_1", email = "user@example.com"),
        activeProgram = activeProgram,
        openSessions = openSessions,
        exerciseHistoryByExerciseId = exerciseHistoryByExerciseId,
    )

    private fun bootstrapWithTargetSets(targetSets: Int) = bootstrap(
        activeProgram = ProgramDto(
            id = "program_1",
            name = "Test program",
            phase = "HYPERTROPHY",
            workouts = listOf(
                WorkoutDto(
                    id = "workout_1",
                    programId = "program_1",
                    name = "Workout A",
                    order = 1,
                    exercises = listOf(
                        ProgramExerciseDto(
                            id = "program_exercise_1",
                            workoutId = "workout_1",
                            exerciseId = "exercise_1",
                            order = 1,
                            targetSets = targetSets,
                            targetRepsMin = 8,
                            targetRepsMax = 12,
                            targetRIR = 2,
                            restSec = 120,
                            exercise = ExerciseDto(
                                id = "exercise_1",
                                name = "Bench press",
                                muscleGroup = "CHEST",
                                category = "STRENGTH",
                            ),
                        ),
                    ),
                ),
            ),
        ),
    )

    private fun progressSnapshot(generatedAt: String) = MobileProgressSnapshot(
        schemaVersion = 1,
        generatedAt = generatedAt,
        exercises = listOf(
            MobileProgressExerciseDto(
                id = "exercise_progress_1",
                name = "Bench press",
                muscleGroup = "CHEST",
                points = listOf(
                    MobileProgressPointDto(
                        sessionStartedAt = "2026-07-12T10:00:00Z",
                        maxWeight = 80.0,
                        estimated1RM = 101.3,
                        totalVolume = 2400.0,
                        topSetReps = 8,
                        maxReps = 10,
                        totalReps = 30,
                    ),
                ),
            ),
        ),
    )

    private data class Fixture(
        val dao: InMemoryDao,
        val api: TestApi,
        val accountStore: TestAccountStore,
        val repository: GymCoachRepository,
        val syncCounter: SyncCounter,
    ) {
        fun outbox(operation: SyncOperation) = SyncOutboxEntity(
            operationId = operation.operationId,
            type = operation::class.simpleName.orEmpty(),
            payloadJson = api.json.encodeToString<SyncOperation>(operation),
        )

        fun decodeTargetSetsOperation(entity: SyncOutboxEntity): UpdateTargetSetsOperation =
            api.json.decodeFromString<SyncOperation>(entity.payloadJson) as UpdateTargetSetsOperation
    }

    private class SyncCounter(var count: Int = 0)

    private class TestAccountStore : AccountStore {
        override val deviceId = "device_test_0001"
        override var serverUrl = "https://example.test"
        override var userId: String? = "user_1"
        override var userEmail: String? = "user@example.com"
        private var token: String? = "gma_test_token"
        val isAuthenticated: Boolean get() = token != null

        override fun getAccessToken() = token
        override fun setAccessToken(token: String) {
            this.token = token
        }
        override fun clearAccessToken() {
            token = null
        }
        override fun clearAccount() {
            token = null
            userId = null
            userEmail = null
        }
    }

    private class TestApi : MobileApi {
        companion object {
            val jsonConfig = Json {
                ignoreUnknownKeys = true
                encodeDefaults = true
                explicitNulls = true
                classDiscriminator = "type"
            }

            fun bootstrapStatic() = BootstrapResponse(
                schemaVersion = 1,
                calculationVersion = "test",
                serverTime = "2026-07-13T12:00:00Z",
                profile = ProfileDto(id = "user_1", email = "user@example.com"),
            )
        }

        override val json = jsonConfig
        var bootstrapResponse = bootstrapStatic()
        var bootstrapFailure: Throwable? = null
        var progressResponse = MobileProgressSnapshot(
            schemaVersion = 1,
            generatedAt = "2026-07-13T12:00:00Z",
        )
        var progressFailure: Throwable? = null
        var progressCalls = 0
        val progressExerciseIds = mutableListOf<String?>()
        val readinessRequests = mutableListOf<ReadinessCheckinRequest>()
        val syncCalls = mutableListOf<SyncBatchRequest>()
        var syncFailure: Throwable? = null
        var syncHandler: (SyncBatchRequest) -> SyncBatchResponse = { request ->
            SyncBatchResponse(
                serverTime = "2026-07-13T12:00:00Z",
                results = request.operations.map {
                    SyncOperationResult(operationId = it.operationId, status = "APPLIED")
                },
            )
        }

        override suspend fun login(baseUrl: String, request: LoginRequest) = LoginResponse(
            accessToken = "gma_test_token",
            user = MobileUser("user_1", request.email),
        )
        override suspend fun bootstrap(baseUrl: String, token: String): BootstrapResponse {
            bootstrapFailure?.let { throw it }
            return bootstrapResponse
        }
        override suspend fun progress(
            baseUrl: String,
            token: String,
            exerciseId: String?,
        ): MobileProgressSnapshot {
            progressCalls += 1
            progressExerciseIds += exerciseId
            progressFailure?.let { throw it }
            return progressResponse
        }
        override suspend fun sync(
            baseUrl: String,
            token: String,
            request: SyncBatchRequest,
        ): SyncBatchResponse {
            syncCalls += request
            syncFailure?.let { throw it }
            return syncHandler(request)
        }
        override suspend fun saveReadiness(
            baseUrl: String,
            token: String,
            request: ReadinessCheckinRequest,
        ) {
            readinessRequests += request
        }
        override suspend fun createWebSession(baseUrl: String, token: String) = listOf("session=test")
        override suspend fun logout(baseUrl: String, token: String) = Unit

    }

    private class InMemoryDao : GymCoachDao {
        private val bootstrapFlow = MutableStateFlow<BootstrapCacheEntity?>(null)
        private val progressFlow = MutableStateFlow<ProgressCacheEntity?>(null)
        private val sessions = linkedMapOf<String, LocalSessionEntity>()
        private val sets = linkedMapOf<String, LocalSetEntity>()
        private val activeRuntimes = linkedMapOf<String, ActiveWorkoutRuntimeEntity>()
        private val processedWatchEvents = mutableSetOf<String>()
        private val sensorBatches = linkedMapOf<Pair<String, Int>, WatchSensorBatchEntity>()
        private val sensorSamples = linkedMapOf<String, WatchSensorSampleEntity>()
        private val restSummaries = linkedMapOf<String, RestRecoverySummaryEntity>()
        private val outbox = mutableListOf<SyncOutboxEntity>()
        private val openSessionsFlow = MutableStateFlow<List<LocalSessionEntity>>(emptyList())
        private val pendingCountFlow = MutableStateFlow(0)
        private val blockedOperationFlow = MutableStateFlow<SyncOutboxEntity?>(null)
        private var nextSequence = 1L

        override fun observeBootstrap(): Flow<BootstrapCacheEntity?> = bootstrapFlow
        override suspend fun getBootstrap() = bootstrapFlow.value
        override suspend fun saveBootstrap(entity: BootstrapCacheEntity) {
            bootstrapFlow.value = entity
        }
        override fun observeProgress(): Flow<ProgressCacheEntity?> = progressFlow
        override suspend fun getProgress() = progressFlow.value
        override suspend fun saveProgress(entity: ProgressCacheEntity) {
            progressFlow.value = entity
        }
        override fun observeOpenSessions(): Flow<List<LocalSessionEntity>> = openSessionsFlow
        override suspend fun getOpenSessions() = sessions.values.filter { it.finishedAt == null }
            .sortedByDescending { it.startedAt }
        override fun observeSession(sessionId: String): Flow<LocalSessionEntity?> =
            MutableStateFlow(sessions[sessionId])
        override suspend fun getSession(sessionId: String) = sessions[sessionId]
        override suspend fun findOpenSessionForWorkout(workoutId: String) =
            sessions.values.firstOrNull { it.workoutId == workoutId && it.finishedAt == null }
        override suspend fun saveSession(entity: LocalSessionEntity) {
            sessions[entity.id] = entity
            publishSessions()
        }
        override suspend fun deleteSessionLocal(sessionId: String) {
            sessions.remove(sessionId)
            sets.entries.removeIf { it.value.sessionId == sessionId }
            activeRuntimes.remove(sessionId)
            publishSessions()
        }
        override fun observeSets(sessionId: String): Flow<List<LocalSetEntity>> = MutableStateFlow(
            sets.values.filter { it.sessionId == sessionId && !it.deleted }.sortedBy { it.completedAt },
        )
        override suspend fun getSets(sessionId: String) =
            sets.values.filter { it.sessionId == sessionId && !it.deleted }.sortedBy { it.completedAt }
        override suspend fun getAllSets(sessionId: String) =
            sets.values.filter { it.sessionId == sessionId }.sortedBy { it.completedAt }
        override suspend fun getSet(setId: String) = sets[setId]
        override suspend fun saveSet(entity: LocalSetEntity) {
            sets[entity.id] = entity
        }
        override suspend fun markSetDeleted(setId: String) {
            sets[setId]?.let { sets[setId] = it.copy(deleted = true) }
        }
        override suspend fun deleteSetLocal(setId: String) {
            sets.remove(setId)
        }
        override fun observeActiveWorkoutRuntime(sessionId: String): Flow<ActiveWorkoutRuntimeEntity?> =
            MutableStateFlow(activeRuntimes[sessionId])
        override suspend fun getActiveWorkoutRuntime(sessionId: String) = activeRuntimes[sessionId]
        override suspend fun getLatestActiveWorkoutRuntime() = activeRuntimes.values.maxByOrNull { it.updatedAtEpochMs }
        override suspend fun saveActiveWorkoutRuntime(entity: ActiveWorkoutRuntimeEntity) {
            activeRuntimes[entity.sessionId] = entity
        }
        override suspend fun deleteActiveWorkoutRuntime(sessionId: String) {
            activeRuntimes.remove(sessionId)
        }
        override suspend fun insertProcessedWatchEvent(entity: WatchProcessedEventEntity): Long =
            if (processedWatchEvents.add(entity.eventId)) processedWatchEvents.size.toLong() else -1L
        override suspend fun hasProcessedWatchEvent(eventId: String) =
            if (eventId in processedWatchEvents) 1 else 0
        override suspend fun hasWatchSensorBatch(batchId: String, sequence: Int) =
            if (batchId to sequence in sensorBatches) 1 else 0
        override suspend fun insertWatchSensorBatch(entity: WatchSensorBatchEntity) {
            check(sensorBatches.putIfAbsent(entity.batchId to entity.sequence, entity) == null)
        }
        override suspend fun insertWatchSensorSamples(entities: List<WatchSensorSampleEntity>) {
            check(entities.none { it.sampleId in sensorSamples })
            entities.forEach { sensorSamples[it.sampleId] = it }
        }
        override suspend fun getWatchSensorSamplesForSet(
            sessionId: String,
            setId: String,
            phase: String,
        ) = sensorSamples.values.filter {
            it.sessionId == sessionId && it.setId == setId && it.phase == phase
        }.sortedWith(compareBy(WatchSensorSampleEntity::timestampEpochMs, WatchSensorSampleEntity::sampleId))
        override suspend fun getWatchSensorSamplesForInterval(
            sessionId: String,
            setId: String,
            phase: String,
            startedAtEpochMs: Long,
            endedAtEpochMs: Long,
        ) = getWatchSensorSamplesForSet(sessionId, setId, phase).filter {
            it.timestampEpochMs in startedAtEpochMs..endedAtEpochMs
        }
        override suspend fun getRestRecoverySummaries(sessionId: String) =
            restSummaries.values.filter { it.sessionId == sessionId }
        override suspend fun getRestRecoverySummary(
            sessionId: String,
            setId: String,
            restStartedAtEpochMs: Long,
        ) = restSummaries.values.firstOrNull {
            it.sessionId == sessionId &&
                it.setId == setId &&
                it.restStartedAtEpochMs == restStartedAtEpochMs
        }
        override suspend fun saveRestRecoverySummary(entity: RestRecoverySummaryEntity) {
            restSummaries[entity.restId] = entity
        }
        override suspend fun updateSetHeartRateSummary(
            setId: String,
            minHr: Int?,
            maxHr: Int?,
            avgHr: Int?,
            startHr: Int?,
            endHr: Int?,
            sampleCount: Int,
        ): Int {
            val existing = sets[setId] ?: return 0
            sets[setId] = existing.copy(
                minHr = minHr,
                maxHr = maxHr,
                avgHr = avgHr,
                startHr = startHr,
                endHr = endHr,
                hrSampleCount = sampleCount,
            )
            return 1
        }
        override suspend fun pendingOperations(limit: Int) = outbox
            .filter { it.status == "PENDING" || it.status == "FAILED" }
            .sortedBy { it.sequence }
            .take(limit)
        override suspend fun enqueue(entity: SyncOutboxEntity) {
            check(outbox.none { it.operationId == entity.operationId })
            outbox += entity.copy(sequence = nextSequence++)
            publishPending()
        }
        override suspend fun queuedOperations() = outbox.sortedBy { it.sequence }
        override fun observeBlockedOperation(): Flow<SyncOutboxEntity?> = blockedOperationFlow
        override suspend fun removeOperations(operationIds: List<String>) {
            outbox.removeIf { it.operationId in operationIds }
            publishPending()
        }
        override suspend fun markOperationFailed(operationId: String, error: String) {
            updateOperation(operationId) { it.copy(status = "FAILED", attempts = it.attempts + 1, lastError = error) }
        }
        override suspend fun markOperationBlocked(operationId: String, error: String) {
            updateOperation(operationId) { it.copy(status = "BLOCKED", attempts = it.attempts + 1, lastError = error) }
        }
        override suspend fun retryOperation(operationId: String, requestedAtEpochMs: Long) {
            updateOperation(operationId) {
                it.copy(
                    status = "PENDING",
                    lastError = null,
                    lastRetryRequestedAtEpochMs = requestedAtEpochMs,
                )
            }
        }
        override suspend fun recoverInterruptedOperations() {
            outbox.indices.forEach { index ->
                if (outbox[index].status == "SYNCING") outbox[index] = outbox[index].copy(status = "PENDING")
            }
        }
        override fun observePendingCount(): Flow<Int> = pendingCountFlow
        override suspend fun clearBootstrap() {
            bootstrapFlow.value = null
        }
        override suspend fun clearProgress() {
            progressFlow.value = null
        }
        override suspend fun clearSessions() {
            sessions.clear()
            sets.clear()
            activeRuntimes.clear()
            publishSessions()
        }
        override suspend fun clearOutbox() {
            outbox.clear()
            publishPending()
        }
        override suspend fun clearActiveWorkoutRuntime() {
            activeRuntimes.clear()
        }
        override suspend fun clearProcessedWatchEvents() {
            processedWatchEvents.clear()
        }

        suspend fun cachedTargetSets(): Int? = getBootstrap()?.let { cached ->
            val decoded = TestApi.jsonConfig.decodeFromString<BootstrapResponse>(cached.payloadJson)
            findProgramExerciseTargetSets(decoded, "program_exercise_1")
        }

        private fun updateOperation(operationId: String, transform: (SyncOutboxEntity) -> SyncOutboxEntity) {
            val index = outbox.indexOfFirst { it.operationId == operationId }
            if (index >= 0) outbox[index] = transform(outbox[index])
            publishPending()
        }
        private fun publishSessions() {
            openSessionsFlow.value = sessions.values.filter { it.finishedAt == null }
        }
        private fun publishPending() {
            pendingCountFlow.value = outbox.size
            blockedOperationFlow.value = outbox.filter { it.status == "BLOCKED" }.minByOrNull { it.sequence }
        }
    }
}
