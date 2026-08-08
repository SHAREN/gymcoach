package org.sharteman.gymcoach.data.repository

import java.io.IOException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.yield
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.sharteman.gymcoach.data.local.BootstrapCacheEntity
import org.sharteman.gymcoach.data.local.ActiveTargetSetOverrideEntity
import org.sharteman.gymcoach.data.local.ActiveWorkoutRuntimeEntity
import org.sharteman.gymcoach.data.local.GymCoachDao
import org.sharteman.gymcoach.data.local.LocalSessionEntity
import org.sharteman.gymcoach.data.local.LocalSetEntity
import org.sharteman.gymcoach.data.local.ProgressCacheEntity
import org.sharteman.gymcoach.data.local.RestRecoverySummaryEntity
import org.sharteman.gymcoach.data.local.SyncOutboxEntity
import org.sharteman.gymcoach.data.local.WorkoutStructureDraftEntity
import org.sharteman.gymcoach.data.local.WatchProcessedEventEntity
import org.sharteman.gymcoach.data.local.WatchInboxEventEntity
import org.sharteman.gymcoach.data.local.WatchOutboxEventEntity
import org.sharteman.gymcoach.data.local.WatchAckJournalEntity
import org.sharteman.gymcoach.data.local.WatchPeerEntity
import org.sharteman.gymcoach.data.local.WatchConflictEntity
import org.sharteman.gymcoach.data.local.WatchFileTransferEntity
import org.sharteman.gymcoach.data.local.WatchSensorBatchEntity
import org.sharteman.gymcoach.data.local.WatchSensorSampleEntity
import org.sharteman.gymcoach.data.local.WatchResyncMarkerEntity
import org.sharteman.gymcoach.data.errors.AppErrorCategory
import org.sharteman.gymcoach.data.model.BootstrapResponse
import org.sharteman.gymcoach.data.model.ActiveWorkoutExerciseDefaultsDto
import org.sharteman.gymcoach.data.model.CoachingFieldDto
import org.sharteman.gymcoach.data.model.CoachingProfileDto
import org.sharteman.gymcoach.data.model.DeleteSetOperation
import org.sharteman.gymcoach.data.model.DeleteSessionOperation
import org.sharteman.gymcoach.data.model.ExerciseDto
import org.sharteman.gymcoach.data.model.ExerciseHistorySessionDto
import org.sharteman.gymcoach.data.model.FinishSessionOperation
import org.sharteman.gymcoach.data.model.GymDto
import org.sharteman.gymcoach.data.model.GymEquipmentDto
import org.sharteman.gymcoach.data.model.GymEquipmentExerciseDto
import org.sharteman.gymcoach.data.model.GymExerciseConfigDto
import org.sharteman.gymcoach.data.model.GymPlateInventoryItemDto
import org.sharteman.gymcoach.data.model.GymPlatePoolDto
import org.sharteman.gymcoach.data.model.LoginRequest
import org.sharteman.gymcoach.data.model.LoginResponse
import org.sharteman.gymcoach.data.model.MobileSetPayload
import org.sharteman.gymcoach.data.model.MobileProgressExerciseDto
import org.sharteman.gymcoach.data.model.MobileProgressPointDto
import org.sharteman.gymcoach.data.model.MobileProgressSnapshot
import org.sharteman.gymcoach.data.model.MobileUser
import org.sharteman.gymcoach.data.model.MutateWorkoutExercisesOperation
import org.sharteman.gymcoach.data.model.ProfileDto
import org.sharteman.gymcoach.data.model.ReadinessCheckinRequest
import org.sharteman.gymcoach.data.model.ReplaceProgramExerciseOperation
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
import org.sharteman.gymcoach.data.model.UpdatePreferredEquipmentOperation
import org.sharteman.gymcoach.data.model.UpsertSetOperation
import org.sharteman.gymcoach.data.model.WorkoutDto
import org.sharteman.gymcoach.data.network.MobileApi
import org.sharteman.gymcoach.data.network.ApiException
import org.sharteman.gymcoach.data.security.AccountStore
import org.sharteman.gymcoach.watch.sync.NoOpWatchPhoneCommandPublisher
import org.sharteman.gymcoach.watch.sync.WatchPhoneCommandPublisher
import org.sharteman.gymcoach.watch.data.GymCoachWatchWorkoutRepository
import org.sharteman.gymcoach.watch.data.PersistentWatchWorkoutGateway
import org.sharteman.gymcoach.watch.data.WatchWorkoutProtocolCodec
import org.sharteman.gymcoach.watch.domain.WatchEventEnvelopeDto
import org.sharteman.gymcoach.watch.domain.WatchEventSource
import org.sharteman.gymcoach.watch.domain.WatchEventType
import org.sharteman.gymcoach.watch.domain.WatchHeartRateSummaryDto
import org.sharteman.gymcoach.watch.domain.WatchProtocol
import org.sharteman.gymcoach.watch.domain.WatchProtocolErrorCode
import org.sharteman.gymcoach.watch.domain.WatchProtocolException
import org.sharteman.gymcoach.watch.domain.WatchSetRecordDto
import org.sharteman.gymcoach.watch.domain.WatchSyncAckStatus

@OptIn(ExperimentalCoroutinesApi::class)
class GymCoachRepositorySyncTest {
    @Test
    fun phoneWorkoutMutationsPublishOrderedWatchCommandsWithoutTouchingServerOutbox() = runTest {
        val publisher = RecordingWatchPublisher()
        val fixture = fixture(publisher)
        val workout = requireNotNull(bootstrapWithTargetSets(3).activeProgram).workouts.single()

        val sessionId = fixture.repository.startWorkout(workout, gymId = null)
        fixture.repository.updateActiveExercise(sessionId, "exercise_2", updatedAtEpochMs = 2_000)
        val set = fixture.repository.addSet(sessionId, "exercise_2", 80.0, 8, 2, null)
        fixture.repository.startRest(sessionId, set.id, 3_000, 123_000)
        fixture.repository.updateActiveExercise(
            sessionId,
            "exercise_superset_next",
            updatedAtEpochMs = 3_500,
            preserveRest = true,
        )
        assertEquals(123_000L, fixture.dao.getActiveWorkoutRuntime(sessionId)?.restEndsAtEpochMs)
        fixture.repository.updateRest(sessionId, 153_000, "ADD_30_SECONDS")
        fixture.repository.skipRest(sessionId, 4_000)
        fixture.repository.updateSet(set, 82.5, 9, 1)
        fixture.repository.deleteSet(set.id)
        fixture.repository.finishSession(sessionId, null, 8)

        assertEquals(
            listOf("START", "EXERCISE", "SET_COMPLETED", "REST_STARTED", "EXERCISE", "REST_UPDATED", "REST_SKIPPED", "SET_UPDATED", "SET_DELETED", "FINISH"),
            publisher.commands,
        )
        assertEquals(5, fixture.dao.queuedOperations().size)
        assertEquals(listOf("ADD_30_SECONDS"), publisher.restReasons)
    }

    @Test
    fun watchPublisherFailureNeverMakesCompletedPhoneMutationFail() = runTest {
        val fixture = fixture(RecordingWatchPublisher(fail = true))
        val workout = requireNotNull(bootstrapWithTargetSets(3).activeProgram).workouts.single()

        val sessionId = fixture.repository.startWorkout(workout, gymId = null)
        val set = fixture.repository.addSet(sessionId, "exercise_1", 80.0, 8, 2, null)

        assertEquals(set.id, fixture.dao.getSet(set.id)?.id)
        assertEquals(2, fixture.dao.queuedOperations().size)
        val conflicts = fixture.dao.getWatchConflicts(sessionId)
        assertEquals(2, conflicts.size)
        assertTrue(conflicts.all { it.errorCode == "PHONE_EVENT_MAPPING_FAILED" })
        assertEquals(2L, fixture.dao.getWatchResyncMarker(sessionId)?.revision)
    }

    @Test
    fun syncSchedulerFailureNeverTurnsADurableSetSaveIntoARetryableFailure() = runTest {
        val fixture = fixture()
        val workout = requireNotNull(bootstrapWithTargetSets(3).activeProgram).workouts.single()
        val sessionId = fixture.repository.startWorkout(workout, gymId = null)
        fixture.syncCounter.failure = IllegalStateException("scheduler unavailable")

        val set = fixture.repository.addSet(sessionId, "exercise_1", 80.0, 8, 2, null)

        assertEquals(set.id, fixture.dao.getSet(set.id)?.id)
        assertEquals(2, fixture.dao.queuedOperations().size)
        assertEquals(2, fixture.syncCounter.count)
    }

    @Test
    fun watchFinishUsesServerOutboxTransactionWithoutEchoPublisherCall() = runTest {
        val publisher = RecordingWatchPublisher()
        val fixture = fixture(publisher)
        val workout = requireNotNull(bootstrapWithTargetSets(3).activeProgram).workouts.single()
        val sessionId = fixture.repository.startWorkout(workout, gymId = null)
        val runtime = requireNotNull(fixture.repository.activeWorkoutRuntime(sessionId)).copy(
            status = "FINISHED",
            revision = 2,
            updatedAtEpochMs = 5_000,
            updatedBy = "WATCH",
        )

        val applied = fixture.repository.applyWatchFinishedEvent(
            processed = WatchProcessedEventEntity(
                eventId = "75000000-0000-0000-0000-000000000001",
                sessionId = sessionId,
                revision = 2,
                processedAtEpochMs = 5_000,
                canonicalEventHash = "a".repeat(64),
                resultRevision = 2,
            ),
            runtime = runtime,
            finishedAtEpochMs = 5_000,
        )

        assertTrue(applied)
        assertTrue(fixture.dao.getSession(sessionId)?.finishedAt != null)
        assertEquals(null, fixture.dao.getActiveWorkoutRuntime(sessionId))
        assertTrue(
            fixture.dao.queuedOperations().any { entry ->
                fixture.api.json.decodeFromString<SyncOperation>(entry.payloadJson) is FinishSessionOperation
            },
        )
        assertEquals(listOf("START"), publisher.commands)
    }

    @Test
    fun concurrentPhoneUpdateAndDeleteUseMonotonicWatchRevisionsAndDeleteWins() = runTest {
        val publisher = RecordingWatchPublisher()
        val fixture = fixture(publisher)
        val workout = requireNotNull(bootstrapWithTargetSets(3).activeProgram).workouts.single()
        val sessionId = fixture.repository.startWorkout(workout, gymId = null)
        val set = fixture.repository.addSet(sessionId, "exercise_1", 80.0, 8, 2, null)

        listOf(
            async { fixture.repository.updateSet(set, 82.5, 9, 1) },
            async { fixture.repository.deleteSet(set.id) },
        ).awaitAll()

        assertTrue(fixture.dao.getSet(set.id)?.deleted == true)
        assertEquals(listOf(3L, 4L), publisher.revisions.takeLast(2).sorted())
        assertEquals(setOf("SET_UPDATED", "SET_DELETED"), publisher.commands.takeLast(2).toSet())
    }

    @Test
    fun concurrentFinishPreventsSetMutationAfterRuntimeDeletionAndQueuesExactWatchFinish() = runTest {
        val publisher = RecordingWatchPublisher()
        val fixture = fixture(publisher)
        val workout = requireNotNull(bootstrapWithTargetSets(3).activeProgram).workouts.single()
        val sessionId = fixture.repository.startWorkout(workout, gymId = null)
        val set = fixture.repository.addSet(sessionId, "exercise_1", 80.0, 8, 2, null)

        val finish = async { fixture.repository.finishSession(sessionId, null, 8) }
        val update = async {
            yield()
            runCatching { fixture.repository.updateSet(set, 90.0, 10, 1) }.exceptionOrNull()
        }
        finish.await()
        val updateFailure = update.await()

        assertEquals(null, fixture.dao.getActiveWorkoutRuntime(sessionId))
        assertEquals(80.0, fixture.dao.getSet(set.id)?.weight ?: 0.0, 0.0)
        assertTrue(updateFailure is IllegalStateException)
        val watchFinish = fixture.dao.getReplayableWatchOutboxEvents(sessionId).single()
        assertEquals(WatchEventType.WORKOUT_FINISHED.name, watchFinish.eventType)
        assertEquals(3L, watchFinish.revision)
    }

    @Test
    fun suspendedWatchPublisherDoesNotBlockLaterPersistedMutation() = runTest {
        val publishEntered = CompletableDeferred<Unit>()
        val releasePublisher = CompletableDeferred<Unit>()
        val restPublished = CompletableDeferred<Unit>()
        val publisher = RecordingWatchPublisher(
            afterSetCompleted = {
                publishEntered.complete(Unit)
                releasePublisher.await()
            },
            afterRestStarted = { restPublished.complete(Unit) },
        )
        val fixture = fixture(publisher, backgroundScope)
        val workout = requireNotNull(bootstrapWithTargetSets(3).activeProgram).workouts.single()
        val sessionId = fixture.repository.startWorkout(workout, gymId = null)

        val addSet = async {
            fixture.repository.addSet(sessionId, "exercise_1", 80.0, 8, 2, null)
        }
        publishEntered.await()
        val persistedSet = fixture.dao.getSets(sessionId).single()
        assertEquals(2L, fixture.dao.getActiveWorkoutRuntime(sessionId)?.revision)
        assertTrue(addSet.isCompleted)
        assertEquals(persistedSet.id, addSet.await().id)

        val startRest = async {
            fixture.repository.startRest(sessionId, persistedSet.id, 3_000, 123_000)
        }
        runCurrent()

        assertTrue(startRest.isCompleted)
        startRest.await()
        val runtime = requireNotNull(fixture.dao.getActiveWorkoutRuntime(sessionId))
        assertEquals(3L, runtime.revision)
        assertEquals(123_000L, runtime.restEndsAtEpochMs)
        assertEquals(3L, fixture.dao.getWatchResyncMarker(sessionId)?.revision)
        assertEquals(
            listOf("START_SESSION", "UPSERT_SET"),
            fixture.dao.queuedOperations().map { it.type },
        )
        assertEquals(listOf(2L), publisher.revisions.takeLast(1))
        assertEquals(listOf("SET_COMPLETED"), publisher.commands.takeLast(1))

        releasePublisher.complete(Unit)
        restPublished.await()
        assertEquals(listOf(2L, 3L), publisher.revisions.takeLast(2))
        assertEquals(listOf("SET_COMPLETED", "REST_STARTED"), publisher.commands.takeLast(2))
    }

    @Test
    fun queuedWatchPublisherSurvivesTransportFailureAndProcessesTheNextCommand() = runTest {
        val restPublished = CompletableDeferred<Unit>()
        val publisher = RecordingWatchPublisher(
            failOnceOn = "SET_COMPLETED",
            afterRestStarted = { restPublished.complete(Unit) },
        )
        val fixture = fixture(publisher, backgroundScope)
        val workout = requireNotNull(bootstrapWithTargetSets(3).activeProgram).workouts.single()
        val sessionId = fixture.repository.startWorkout(workout, gymId = null)
        val set = fixture.repository.addSet(sessionId, "exercise_1", 80.0, 8, 2, null)

        fixture.repository.startRest(sessionId, set.id, 3_000, 123_000)
        restPublished.await()

        assertEquals(listOf("START", "SET_COMPLETED", "REST_STARTED"), publisher.attempts)
        assertEquals(listOf("START", "REST_STARTED"), publisher.commands)
        assertEquals(1, fixture.dao.getWatchConflicts(sessionId).size)
        assertTrue(fixture.dao.getWatchResyncMarker(sessionId) != null)
    }

    @Test
    fun inboundWatchMutationSerializesWithPhoneFinishWithoutResurrectingRuntime() = runTest {
        val publisher = RecordingWatchPublisher()
        val fixture = fixture(publisher)
        val bootstrap = bootstrapWithTargetSets(3)
        fixture.dao.saveBootstrap(
            BootstrapCacheEntity(
                payloadJson = fixture.api.json.encodeToString(bootstrap),
                updatedAtEpochMs = 1,
            ),
        )
        val workout = requireNotNull(bootstrap.activeProgram).workouts.single()
        val sessionId = fixture.repository.startWorkout(workout, gymId = null)
        val set = fixture.repository.addSet(sessionId, "exercise_1", 80.0, 8, 2, null)
        val codec = WatchWorkoutProtocolCodec()
        val watchEvent = WatchEventEnvelopeDto(
            protocolVersion = WatchProtocol.VERSION,
            schemaVersion = WatchProtocol.SCHEMA_VERSION,
            eventId = WATCH_CONCURRENT_EVENT_ID,
            sessionId = sessionId,
            type = WatchEventType.SET_UPDATED,
            timestamp = 4_000,
            source = WatchEventSource.WATCH,
            deviceId = "watch-concurrent",
            revision = 3,
            payload = codec.encodeSetRecordPayload(
                WatchSetRecordDto(
                    setId = set.id,
                    sessionId = sessionId,
                    exerciseSessionId = "program_exercise_1",
                    setNumber = set.setNumber,
                    weight = 90.0,
                    reps = 10,
                    rir = 1,
                    startedAt = 3_000,
                    completedAt = 4_000,
                    source = WatchEventSource.WATCH,
                    heartRateSummary = WatchHeartRateSummaryDto(null, null, null, null, null, 0),
                    sensorSummary = buildJsonObject {},
                    revision = 3,
                ),
            ),
        )
        val gateway = PersistentWatchWorkoutGateway(
            repository = GymCoachWatchWorkoutRepository(fixture.repository),
            phoneDeviceId = fixture.accountStore.deviceId,
        )
        val lockHeld = CompletableDeferred<Unit>()
        val releaseLock = CompletableDeferred<Unit>()
        val holder = async {
            fixture.repository.withWatchMutationLock {
                lockHeld.complete(Unit)
                releaseLock.await()
            }
        }
        lockHeld.await()
        val finish = async { fixture.repository.finishSession(sessionId, null, 8) }
        runCurrent()
        val watchApply = async { gateway.applyWatchEvent(watchEvent) }
        runCurrent()

        assertFalse(finish.isCompleted)
        assertFalse(watchApply.isCompleted)
        releaseLock.complete(Unit)
        holder.await()
        finish.await()
        val watchResult = watchApply.await()

        assertEquals(WatchSyncAckStatus.REJECTED, watchResult.status)
        assertEquals("SESSION_NOT_FOUND", watchResult.errorCode)
        assertEquals(null, fixture.dao.getActiveWorkoutRuntime(sessionId))
        assertTrue(fixture.dao.getSession(sessionId)?.finishedAt != null)
        assertEquals(80.0, fixture.dao.getSet(set.id)?.weight ?: 0.0, 0.0)
        assertEquals(null, fixture.dao.getProcessedWatchEvent(WATCH_CONCURRENT_EVENT_ID))
        assertEquals(
            listOf("START_SESSION", "UPSERT_SET", "FINISH_SESSION"),
            fixture.dao.queuedOperations().map { it.type },
        )
        val watchFinish = fixture.dao.getReplayableWatchOutboxEvents(sessionId).single()
        assertEquals(WatchEventType.WORKOUT_FINISHED.name, watchFinish.eventType)
        assertEquals(3L, watchFinish.revision)
    }

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
    fun staleBootstrapCannotReplaceNewerCachedCoachingProfileFields() = runTest {
        val fixture = fixture()
        val initial = bootstrap().copy(
            profile = bootstrap().profile.copy(
                coachingProfile = CoachingProfileDto(
                    updatedAt = "2026-07-18T10:00:00.000Z",
                    healthStatus = CoachingFieldDto(
                        state = "KNOWN",
                        value = "NO_SIGNIFICANT_ISSUES",
                        updatedAt = "2026-07-18T10:00:00.000Z",
                    ),
                ),
            ),
        )
        fixture.api.bootstrapResponse = initial
        fixture.repository.refreshBootstrap()
        fixture.repository.mergeCoachingProfileIntoBootstrap(
            requireNotNull(initial.profile.coachingProfile).copy(
                updatedAt = "2026-07-18T12:00:00.000Z",
                healthStatus = CoachingFieldDto(
                    state = "KNOWN",
                    value = "TRAIN_WITH_LIMITATIONS",
                    updatedAt = "2026-07-18T12:00:00.000Z",
                ),
            ),
        )

        fixture.api.bootstrapResponse = initial.copy(serverTime = "2026-07-18T12:01:00.000Z")
        val refreshed = fixture.repository.refreshBootstrap()
        val cached = fixture.api.json.decodeFromString<BootstrapResponse>(
            requireNotNull(fixture.dao.getBootstrap()).payloadJson,
        )

        assertEquals("TRAIN_WITH_LIMITATIONS", refreshed.profile.coachingProfile?.healthStatus?.value)
        assertEquals("TRAIN_WITH_LIMITATIONS", cached.profile.coachingProfile?.healthStatus?.value)
        assertEquals("2026-07-18T12:00:00.000Z", cached.profile.coachingProfile?.healthStatus?.updatedAt)
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
    fun rejectionKeepsTheFailedOperationButSyncsAnIndependentTail() = runTest {
        val fixture = fixture()
        repeat(3) { index ->
            fixture.dao.enqueue(fixture.outbox(DeleteSetOperation("operation_$index", "set_$index")))
        }
        fixture.api.syncHandler = { request ->
            if (request.operations.size == 3) {
                SyncBatchResponse(
                    serverTime = "2026-07-13T12:00:00Z",
                    results = listOf(
                        SyncOperationResult(request.operations[0].operationId, "APPLIED"),
                        SyncOperationResult(request.operations[1].operationId, "REJECTED", error = "bad data"),
                    ),
                )
            } else {
                SyncBatchResponse(
                    serverTime = "2026-07-13T12:00:00Z",
                    results = request.operations.map {
                        SyncOperationResult(it.operationId, "APPLIED")
                    },
                )
            }
        }

        assertFalse(fixture.repository.syncPending())

        val queue = fixture.dao.queuedOperations()
        assertEquals(listOf("operation_1"), queue.map { it.operationId })
        assertEquals("BLOCKED", queue.single().status)
        assertEquals(listOf(3, 1), fixture.api.syncCalls.map { it.operations.size })
    }

    @Test
    fun invalidDiscriminatorBatchIsolatesThePermanentOperationAndSyncsTheRest() = runTest {
        val fixture = fixture()
        val incompatible = UpdatePreferredEquipmentOperation(
            operationId = "operation_legacy_discriminator",
            gymId = "gym_1",
            exerciseId = "exercise_1",
            preferredEquipmentId = "equipment_1",
        )
        val independent = DeleteSetOperation("operation_independent", "set_independent")
        fixture.dao.enqueue(fixture.outbox(incompatible))
        fixture.dao.enqueue(fixture.outbox(independent))
        fixture.api.syncHandler = { request ->
            if (request.operations.any { it.operationId == incompatible.operationId }) {
                throw ApiException(
                    400,
                    "Invalid discriminator value. Expected START_SESSION | UPSERT_SET.",
                    errorCode = "invalid_discriminator",
                    correlationId = "request-sync-123",
                )
            }
            SyncBatchResponse(
                serverTime = "2026-07-13T12:00:00Z",
                results = request.operations.map {
                    SyncOperationResult(it.operationId, "APPLIED")
                },
            )
        }

        assertFalse(fixture.repository.syncPending())

        val blocked = fixture.dao.queuedOperations().single()
        assertEquals(incompatible.operationId, blocked.operationId)
        assertEquals("BLOCKED", blocked.status)
        assertEquals(AppErrorCategory.CLIENT_SERVER_INCOMPATIBLE.name, blocked.lastErrorCategory)
        assertEquals(400, blocked.lastHttpStatus)
        assertEquals("invalid_discriminator", blocked.lastErrorCode)
        assertEquals("request-sync-123", blocked.lastCorrelationId)
        assertTrue(blocked.lastExceptionClass?.endsWith("ApiException") == true)
        assertTrue(blocked.lastStackTrace?.contains("ApiException") == true)
        val issue = fixture.repository.syncIssue.first()
        assertEquals(AppErrorCategory.CLIENT_SERVER_INCOMPATIBLE, issue?.userError?.category)
        assertFalse(requireNotNull(issue).canRetry)
        assertEquals(listOf(2, 1, 1), fixture.api.syncCalls.map { it.operations.size })
        assertEquals(
            listOf(
                listOf(incompatible.operationId, independent.operationId),
                listOf(incompatible.operationId),
                listOf(independent.operationId),
            ),
            fixture.api.syncCalls.map { request -> request.operations.map { it.operationId } },
        )
    }

    @Test
    fun persistedPermanentFailureDoesNotBlockIndependentWorkAfterRestart() = runTest {
        val fixture = fixture()
        val blocked = UpdatePreferredEquipmentOperation(
            operationId = "operation_blocked_before_restart",
            gymId = "gym_1",
            exerciseId = "exercise_1",
            preferredEquipmentId = "equipment_1",
        )
        val independent = DeleteSetOperation("operation_after_restart", "set_after_restart")
        fixture.dao.enqueue(fixture.outbox(blocked))
        fixture.dao.enqueue(fixture.outbox(independent))
        fixture.dao.markOperationBlocked(blocked.operationId, "Invalid discriminator value.")
        val restarted = GymCoachRepository(
            dao = fixture.dao,
            accountStore = fixture.accountStore,
            api = fixture.api,
            scheduleSyncNow = { fixture.syncCounter.count++ },
            schedulePeriodicSync = {},
        )

        assertFalse(restarted.syncPending())

        assertEquals(listOf(blocked.operationId), fixture.dao.queuedOperations().map { it.operationId })
        assertEquals(
            listOf(independent.operationId),
            fixture.api.syncCalls.single().operations.map { it.operationId },
        )
    }

    @Test
    fun permanentSessionFailureBlocksItsDependentsButNotAnotherSession() = runTest {
        val fixture = fixture()
        val blockedStart = StartSessionOperation(
            operationId = "operation_bad_start",
            session = MobileSessionPayload(
                id = "session_bad",
                workoutId = "workout_1",
                gymId = null,
                startedAt = "2026-07-13T10:00:00Z",
            ),
        )
        val dependentSet = UpsertSetOperation(
            operationId = "operation_dependent_set",
            set = MobileSetPayload(
                id = "set_dependent",
                sessionId = blockedStart.session.id,
                exerciseId = "exercise_1",
                setNumber = 1,
                weight = 80.0,
                reps = 8,
                rir = 2,
                completedAt = "2026-07-13T10:05:00Z",
            ),
        )
        val independent = DeleteSetOperation("operation_other_session", "set_other")
        fixture.dao.enqueue(fixture.outbox(blockedStart))
        fixture.dao.enqueue(fixture.outbox(dependentSet))
        fixture.dao.enqueue(fixture.outbox(independent))
        fixture.api.syncHandler = { request ->
            if (request.operations.any { it.operationId == blockedStart.operationId }) {
                throw ApiException(400, "Invalid discriminator value.")
            }
            SyncBatchResponse(
                serverTime = "2026-07-13T12:00:00Z",
                results = request.operations.map {
                    SyncOperationResult(it.operationId, "APPLIED")
                },
            )
        }

        assertFalse(fixture.repository.syncPending())

        val remaining = fixture.dao.queuedOperations()
        assertEquals(
            listOf(blockedStart.operationId, dependentSet.operationId),
            remaining.map { it.operationId },
        )
        assertEquals("BLOCKED", remaining[0].status)
        assertEquals("PENDING", remaining[1].status)
        assertEquals(
            listOf(
                listOf(blockedStart.operationId, dependentSet.operationId, independent.operationId),
                listOf(blockedStart.operationId),
                listOf(independent.operationId),
            ),
            fixture.api.syncCalls.map { request -> request.operations.map { it.operationId } },
        )
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
    fun watchHeartRateSummaryQueuesServerUpdateAndSurvivesBootstrapRefresh() = runTest {
        val fixture = fixture()
        val session = LocalSessionEntity(
            id = "session_watch_hr",
            workoutId = "workout_1",
            gymId = null,
            startedAt = "2026-07-13T10:00:00Z",
        )
        val set = LocalSetEntity(
            id = "set_watch_hr",
            sessionId = session.id,
            exerciseId = "exercise_1",
            setNumber = 1,
            weight = 90.0,
            reps = 8,
            rir = 2,
            completedAt = "2026-07-13T10:05:00Z",
        )
        fixture.dao.saveSession(session)
        fixture.dao.saveSet(set)

        assertTrue(
            fixture.repository.updateSetHeartRateSummary(
                setId = set.id,
                minHr = 120,
                maxHr = 170,
                avgHr = 150,
                startHr = 125,
                endHr = 165,
                sampleCount = 20,
            ),
        )
        val operation = fixture.dao.queuedOperations().single()
        val decoded = fixture.api.json.decodeFromString<SyncOperation>(operation.payloadJson)
        assertEquals(150, (decoded as UpsertSetOperation).set.avgHr)
        assertEquals(170, decoded.set.maxHr)

        fixture.dao.clearOutbox()
        fixture.api.bootstrapResponse = bootstrap(
            openSessions = listOf(
                SessionDto(
                    id = session.id,
                    workoutId = session.workoutId,
                    startedAt = session.startedAt,
                    sets = listOf(
                        SetDto(
                            id = set.id,
                            sessionId = set.sessionId,
                            exerciseId = set.exerciseId,
                            setNumber = set.setNumber,
                            weight = set.weight,
                            reps = set.reps,
                            rir = set.rir,
                            avgHr = 150,
                            maxHr = 170,
                            completedAt = set.completedAt,
                        ),
                    ),
                ),
            ),
        )
        fixture.repository.refreshBootstrap()

        val refreshed = fixture.dao.getSet(set.id)
        assertEquals(120, refreshed?.minHr)
        assertEquals(125, refreshed?.startHr)
        assertEquals(165, refreshed?.endHr)
        assertEquals(20, refreshed?.hrSampleCount)
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
    fun replacingExerciseWithoutLoggedSetsUpdatesProgramRuntimeOutboxAndWatchMarker() = runTest {
        val publisher = RecordingWatchPublisher()
        val fixture = fixture(publisher)
        val sessionId = fixture.prepareExerciseReplacementSession()

        assertTrue(fixture.repository.replaceProgramExercise(
            sessionId = sessionId,
            programExerciseId = "program_exercise_1",
            replacementExerciseId = "exercise_2",
        ))

        val cached = requireNotNull(fixture.repository.cachedBootstrapSnapshot())
        assertEquals("exercise_1", cached.activeProgramExerciseId())
        assertEquals("exercise_1", cached.openSessionExerciseId(sessionId))
        assertEquals(
            "exercise_2",
            fixture.repository.activeWorkoutBootstrapSnapshot(sessionId)?.activeProgramExerciseId(),
        )
        assertEquals("exercise_2", fixture.repository.activeWorkoutRuntime(sessionId)?.activeExerciseId)
        assertTrue(fixture.repository.localSets(sessionId).isEmpty())
        assertTrue(fixture.dao.queuedOperations().isEmpty())

        fixture.finishAndQueueProgramDecision(sessionId)

        val operation = fixture.decodeWorkoutMutation(fixture.dao.queuedOperations().single())
        assertEquals(sessionId, operation.sessionId)
        assertTrue(operation.programDecision)
        assertEquals("exercise_1", operation.previousExercises.single().exerciseId)
        assertEquals("exercise_2", operation.exercises.single().exerciseId)
        assertEquals(null, fixture.repository.activeWorkoutRuntime(sessionId))
        assertEquals("APPLY_QUEUED", fixture.dao.getWorkoutStructureDraft(sessionId)?.status)
        assertEquals(listOf("EXERCISE", "FINISH"), publisher.commands)
    }

    @Test
    fun replacingExerciseKeepsLoggedSetsAttachedToTheOriginalExercise() = runTest {
        val fixture = fixture()
        val sessionId = fixture.prepareExerciseReplacementSession(loggedSetCount = 2)
        val before = fixture.repository.localSets(sessionId)

        fixture.repository.replaceProgramExercise(
            sessionId = sessionId,
            programExerciseId = "program_exercise_1",
            replacementExerciseId = "exercise_2",
        )

        assertEquals(before, fixture.repository.localSets(sessionId))
        assertEquals(listOf("exercise_1", "exercise_1"), before.map { it.exerciseId })
        assertEquals(listOf("set_replace_1", "set_replace_2"), before.map { it.id })
        assertEquals("exercise_2", fixture.repository.activeWorkoutRuntime(sessionId)?.activeExerciseId)
        assertEquals("exercise_1", fixture.repository.cachedBootstrapSnapshot()?.activeProgramExerciseId())
        assertEquals(
            "exercise_2",
            fixture.repository.activeWorkoutBootstrapSnapshot(sessionId)?.activeProgramExerciseId(),
        )
    }

    @Test
    fun staleBootstrapRefreshPreservesPendingExerciseReplacement() = runTest {
        val fixture = fixture()
        val sessionId = fixture.prepareExerciseReplacementSession()
        val stale = fixture.api.bootstrapResponse
        fixture.repository.replaceProgramExercise(
            sessionId = sessionId,
            programExerciseId = "program_exercise_1",
            replacementExerciseId = "exercise_2",
        )
        fixture.api.bootstrapResponse = stale

        val refreshed = fixture.repository.refreshBootstrap()

        assertEquals("exercise_1", refreshed.activeProgramExerciseId())
        assertEquals("exercise_1", refreshed.openSessionExerciseId(sessionId))
        assertEquals(
            "exercise_2",
            fixture.repository.activeWorkoutBootstrapSnapshot(sessionId)?.activeProgramExerciseId(),
        )
        assertEquals("exercise_2", fixture.repository.activeWorkoutRuntime(sessionId)?.activeExerciseId)
        assertTrue(fixture.dao.queuedOperations().isEmpty())
    }

    @Test
    fun networkFailureKeepsReplacementDurableAcrossRepositoryRestartAndRetriesOnce() = runTest {
        val fixture = fixture()
        val sessionId = fixture.prepareExerciseReplacementSession(loggedSetCount = 1)
        fixture.repository.replaceProgramExercise(
            sessionId = sessionId,
            programExerciseId = "program_exercise_1",
            replacementExerciseId = "exercise_2",
        )
        fixture.finishAndQueueProgramDecision(sessionId)
        fixture.api.syncFailure = IOException("offline")

        val failed = runCatching { fixture.repository.syncPending() }

        assertTrue(failed.exceptionOrNull() is IOException)
        assertEquals("FAILED", fixture.dao.queuedOperations().single().status)
        assertEquals("exercise_2", fixture.repository.cachedBootstrapSnapshot()?.activeProgramExerciseId())
        assertEquals(null, fixture.repository.activeWorkoutRuntime(sessionId))
        val restarted = GymCoachRepository(
            dao = fixture.dao,
            accountStore = fixture.accountStore,
            api = fixture.api,
            scheduleSyncNow = { fixture.syncCounter.count++ },
            schedulePeriodicSync = {},
        )
        assertEquals("exercise_2", restarted.cachedBootstrapSnapshot()?.activeProgramExerciseId())
        assertEquals(null, restarted.activeWorkoutRuntime(sessionId))
        assertEquals("exercise_1", restarted.localSets(sessionId).single().exerciseId)

        fixture.api.syncFailure = null
        fixture.api.syncCalls.clear()
        fixture.api.syncHandler = { request ->
            fixture.api.bootstrapResponse = replaceProgramExerciseInBootstrap(
                fixture.api.bootstrapResponse,
                "program_exercise_1",
                "exercise_2",
            )
            SyncBatchResponse(
                serverTime = "2026-07-13T12:00:00Z",
                results = request.operations.map {
                    SyncOperationResult(operationId = it.operationId, status = "APPLIED")
                },
            )
        }

        assertTrue(restarted.syncPending())
        assertEquals(1, fixture.api.syncCalls.size)
        assertEquals(1, fixture.api.syncCalls.single().operations.filterIsInstance<MutateWorkoutExercisesOperation>().size)
        assertTrue(fixture.dao.queuedOperations().isEmpty())
        assertEquals("exercise_2", restarted.cachedBootstrapSnapshot()?.activeProgramExerciseId())
        assertEquals(null, restarted.activeWorkoutRuntime(sessionId))
    }

    @Test
    fun rejectedReplacementRollsBackProgramRuntimeAndWatchMarker() = runTest {
        val publisher = RecordingWatchPublisher()
        val fixture = fixture(publisher)
        val sessionId = fixture.prepareExerciseReplacementSession(loggedSetCount = 1)
        fixture.repository.replaceProgramExercise(
            sessionId = sessionId,
            programExerciseId = "program_exercise_1",
            replacementExerciseId = "exercise_2",
        )
        fixture.finishAndQueueProgramDecision(sessionId)
        fixture.api.syncHandler = { request ->
            SyncBatchResponse(
                serverTime = "2026-07-13T12:00:00Z",
                results = request.operations.map {
                    SyncOperationResult(it.operationId, "REJECTED", error = "stale exercise")
                },
            )
        }

        assertFalse(fixture.repository.syncPending())

        assertEquals("BLOCKED", fixture.dao.queuedOperations().single().status)
        assertEquals("exercise_1", fixture.repository.cachedBootstrapSnapshot()?.activeProgramExerciseId())
        assertEquals(null, fixture.repository.activeWorkoutRuntime(sessionId))
        assertEquals("exercise_1", fixture.repository.localSets(sessionId).single().exerciseId)
        assertEquals("PENDING", fixture.dao.getWorkoutStructureDraft(sessionId)?.status)
        assertEquals(listOf("EXERCISE", "FINISH"), publisher.commands)
    }

    @Test
    fun staleRejectedReplacementReconcilesProgramRuntimeAndWatchMarkerToAuthoritativeExercise() = runTest {
        val publisher = RecordingWatchPublisher()
        val fixture = fixture(publisher)
        val sessionId = fixture.prepareExerciseReplacementSession(loggedSetCount = 1)
        fixture.repository.replaceProgramExercise(
            sessionId = sessionId,
            programExerciseId = "program_exercise_1",
            replacementExerciseId = "exercise_2",
        )
        fixture.finishAndQueueProgramDecision(sessionId)
        fixture.api.bootstrapResponse = replaceProgramExerciseInBootstrap(
            fixture.api.bootstrapResponse,
            "program_exercise_1",
            "exercise_3",
        )
        fixture.api.syncHandler = { request ->
            SyncBatchResponse(
                serverTime = "2026-07-13T12:00:00Z",
                results = request.operations.map {
                    SyncOperationResult(it.operationId, "REJECTED", error = "stale exercise")
                },
            )
        }

        assertFalse(fixture.repository.syncPending())

        assertEquals("BLOCKED", fixture.dao.queuedOperations().single().status)
        val cached = requireNotNull(fixture.repository.cachedBootstrapSnapshot())
        assertEquals("exercise_3", cached.activeProgramExerciseId())
        assertEquals("exercise_3", cached.openSessionExerciseId(sessionId))
        assertEquals(null, fixture.repository.activeWorkoutRuntime(sessionId))
        assertEquals("PENDING", fixture.dao.getWorkoutStructureDraft(sessionId)?.status)
        assertEquals("exercise_1", fixture.repository.localSets(sessionId).single().exerciseId)
        assertEquals(listOf("EXERCISE", "FINISH"), publisher.commands)
    }

    @Test
    fun blockedReplacementReconcilesToAuthoritativeExerciseAfterRepositoryRestart() = runTest {
        val publisher = RecordingWatchPublisher()
        val fixture = fixture(publisher)
        val sessionId = fixture.prepareExerciseReplacementSession()
        fixture.repository.replaceProgramExercise(
            sessionId = sessionId,
            programExerciseId = "program_exercise_1",
            replacementExerciseId = "exercise_2",
        )
        fixture.finishAndQueueProgramDecision(sessionId)
        val blocked = fixture.dao.queuedOperations().single()
        fixture.dao.markOperationBlocked(blocked.operationId, "stale exercise")
        fixture.api.bootstrapResponse = replaceProgramExerciseInBootstrap(
            fixture.api.bootstrapResponse,
            "program_exercise_1",
            "exercise_3",
        )
        val restarted = GymCoachRepository(
            dao = fixture.dao,
            accountStore = fixture.accountStore,
            api = fixture.api,
            scheduleSyncNow = { fixture.syncCounter.count++ },
            schedulePeriodicSync = {},
            watchCommandPublisher = publisher,
        )

        assertFalse(restarted.syncPending())

        assertEquals("BLOCKED", fixture.dao.queuedOperations().single().status)
        assertEquals("exercise_3", restarted.cachedBootstrapSnapshot()?.activeProgramExerciseId())
        assertEquals(null, restarted.activeWorkoutRuntime(sessionId))
        assertEquals("APPLY_QUEUED", fixture.dao.getWorkoutStructureDraft(sessionId)?.status)
        assertEquals(listOf("EXERCISE", "FINISH"), publisher.commands)
    }

    @Test
    fun rejectedReplacementWithDeletedAuthoritativeTargetClearsTheImpossibleOperationSafely() = runTest {
        val publisher = RecordingWatchPublisher()
        val fixture = fixture(publisher)
        val sessionId = fixture.prepareExerciseReplacementSession(loggedSetCount = 1)
        fixture.repository.replaceProgramExercise(
            sessionId = sessionId,
            programExerciseId = "program_exercise_1",
            replacementExerciseId = "exercise_2",
        )
        fixture.finishAndQueueProgramDecision(sessionId)
        fixture.api.bootstrapResponse = removeProgramExerciseFromBootstrap(
            fixture.api.bootstrapResponse,
            "program_exercise_1",
        ).copy(
            catalog = fixture.api.bootstrapResponse.catalog.filterNot { it.id == "exercise_2" },
        )
        fixture.api.syncHandler = { request ->
            SyncBatchResponse(
                serverTime = "2026-07-13T12:00:00Z",
                results = request.operations.map {
                    SyncOperationResult(it.operationId, "REJECTED", error = "target deleted")
                },
            )
        }

        assertFalse(fixture.repository.syncPending())

        assertEquals("BLOCKED", fixture.dao.queuedOperations().single().status)
        assertEquals(
            null,
            findProgramExercise(
                requireNotNull(fixture.repository.cachedBootstrapSnapshot()),
                "program_exercise_1",
            ),
        )
        assertEquals(null, fixture.repository.activeWorkoutRuntime(sessionId))
        assertEquals("PENDING", fixture.dao.getWorkoutStructureDraft(sessionId)?.status)
        assertEquals("exercise_1", fixture.repository.localSets(sessionId).single().exerciseId)
        assertEquals(listOf("EXERCISE", "FINISH"), publisher.commands)
        assertFalse(fixture.repository.syncPending())
    }

    @Test
    fun retryingBlockedProgramDecisionWithDeletedTargetFailsClosed() = runTest {
        val publisher = RecordingWatchPublisher()
        val fixture = fixture(publisher)
        val sessionId = fixture.prepareExerciseReplacementSession()
        fixture.repository.replaceProgramExercise(
            sessionId = sessionId,
            programExerciseId = "program_exercise_1",
            replacementExerciseId = "exercise_2",
        )
        fixture.finishAndQueueProgramDecision(sessionId)
        val blocked = fixture.dao.queuedOperations().single()
        fixture.dao.markOperationBlocked(blocked.operationId, "target deleted")
        fixture.api.bootstrapResponse = removeProgramExerciseFromBootstrap(
            fixture.api.bootstrapResponse,
            "program_exercise_1",
        ).copy(
            catalog = fixture.api.bootstrapResponse.catalog.filterNot { it.id == "exercise_2" },
        )
        fixture.repository.refreshBootstrap()

        val retry = runCatching { fixture.repository.retryBlockedChange() }

        assertTrue(retry.exceptionOrNull() is IllegalStateException)
        assertEquals("BLOCKED", fixture.dao.queuedOperations().single().status)
        assertEquals(null, fixture.repository.activeWorkoutRuntime(sessionId))
    }

    @Test
    fun discardingBlockedReplacementWithDeletedTargetClearsItAndTheStaleRuntime() = runTest {
        val publisher = RecordingWatchPublisher()
        val fixture = fixture(publisher)
        val sessionId = fixture.prepareExerciseReplacementSession()
        fixture.repository.replaceProgramExercise(
            sessionId = sessionId,
            programExerciseId = "program_exercise_1",
            replacementExerciseId = "exercise_2",
        )
        fixture.finishAndQueueProgramDecision(sessionId)
        val blocked = fixture.dao.queuedOperations().single()
        fixture.dao.markOperationBlocked(blocked.operationId, "target deleted")
        fixture.api.bootstrapResponse = removeProgramExerciseFromBootstrap(
            fixture.api.bootstrapResponse,
            "program_exercise_1",
        )

        fixture.repository.discardBlockedChange()

        assertTrue(fixture.dao.queuedOperations().isEmpty())
        assertEquals(null, fixture.repository.activeWorkoutRuntime(sessionId))
        assertEquals("KEPT_FOR_SESSION", fixture.dao.getWorkoutStructureDraft(sessionId)?.status)
    }

    @Test
    fun retryingRejectedProgramDecisionWithConcurrentProgramChangeFailsClosed() = runTest {
        val fixture = fixture()
        val sessionId = fixture.prepareExerciseReplacementSession()
        fixture.repository.replaceProgramExercise(
            sessionId = sessionId,
            programExerciseId = "program_exercise_1",
            replacementExerciseId = "exercise_2",
        )
        fixture.finishAndQueueProgramDecision(sessionId)
        fixture.api.bootstrapResponse = replaceProgramExerciseInBootstrap(
            fixture.api.bootstrapResponse,
            "program_exercise_1",
            "exercise_3",
        )
        fixture.api.syncHandler = { request ->
            SyncBatchResponse(
                serverTime = "2026-07-13T12:00:00Z",
                results = request.operations.map {
                    SyncOperationResult(it.operationId, "REJECTED", error = "stale exercise")
                },
            )
        }
        assertFalse(fixture.repository.syncPending())
        assertEquals("exercise_3", fixture.repository.cachedBootstrapSnapshot()?.activeProgramExerciseId())
        assertEquals(null, fixture.repository.activeWorkoutRuntime(sessionId))
        fixture.api.syncCalls.clear()
        fixture.api.syncHandler = { request ->
            fixture.api.bootstrapResponse = replaceProgramExerciseInBootstrap(
                fixture.api.bootstrapResponse,
                "program_exercise_1",
                "exercise_2",
            )
            SyncBatchResponse(
                serverTime = "2026-07-13T12:00:00Z",
                results = request.operations.map {
                    SyncOperationResult(it.operationId, "APPLIED")
                },
            )
        }

        val retry = runCatching { fixture.repository.retryBlockedChange() }

        assertTrue(retry.exceptionOrNull() is IllegalStateException)
        assertEquals("BLOCKED", fixture.dao.queuedOperations().single().status)
        assertEquals("PENDING", fixture.dao.getWorkoutStructureDraft(sessionId)?.status)
        assertTrue(fixture.api.syncCalls.isEmpty())
    }

    @Test
    fun discardingStaleRejectedReplacementKeepsAuthoritativeProgramRuntimeAndWatchMarker() = runTest {
        val publisher = RecordingWatchPublisher()
        val fixture = fixture(publisher)
        val sessionId = fixture.prepareExerciseReplacementSession(loggedSetCount = 1)
        fixture.repository.replaceProgramExercise(
            sessionId = sessionId,
            programExerciseId = "program_exercise_1",
            replacementExerciseId = "exercise_2",
        )
        fixture.finishAndQueueProgramDecision(sessionId)
        fixture.api.bootstrapResponse = replaceProgramExerciseInBootstrap(
            fixture.api.bootstrapResponse,
            "program_exercise_1",
            "exercise_3",
        )
        fixture.api.syncHandler = { request ->
            SyncBatchResponse(
                serverTime = "2026-07-13T12:00:00Z",
                results = request.operations.map {
                    SyncOperationResult(it.operationId, "REJECTED", error = "stale exercise")
                },
            )
        }
        assertFalse(fixture.repository.syncPending())

        fixture.repository.discardBlockedChange()

        assertTrue(fixture.dao.queuedOperations().isEmpty())
        val cached = requireNotNull(fixture.repository.cachedBootstrapSnapshot())
        assertEquals("exercise_3", cached.activeProgramExerciseId())
        assertEquals("exercise_3", cached.openSessionExerciseId(sessionId))
        assertEquals(null, fixture.repository.activeWorkoutRuntime(sessionId))
        assertEquals("KEPT_FOR_SESSION", fixture.dao.getWorkoutStructureDraft(sessionId)?.status)
        assertEquals("exercise_1", fixture.repository.localSets(sessionId).single().exerciseId)
        assertEquals(listOf("EXERCISE", "FINISH"), publisher.commands)
    }

    @Test
    fun secondReplacementUpdatesTheSameDraftWithoutSyncingIntermediateState() = runTest {
        val fixture = fixture()
        val sessionId = fixture.prepareExerciseReplacementSession()
        fixture.repository.replaceProgramExercise(
            sessionId = sessionId,
            programExerciseId = "program_exercise_1",
            replacementExerciseId = "exercise_2",
        )

        val second = runCatching {
            fixture.repository.replaceProgramExercise(
                sessionId = sessionId,
                programExerciseId = "program_exercise_1",
                replacementExerciseId = "exercise_1",
            )
        }

        assertTrue(second.getOrNull() == true)
        assertTrue(fixture.dao.queuedOperations().isEmpty())
        assertEquals("exercise_1", fixture.repository.cachedBootstrapSnapshot()?.activeProgramExerciseId())
        assertEquals(
            "exercise_1",
            fixture.repository.activeWorkoutBootstrapSnapshot(sessionId)?.activeProgramExerciseId(),
        )
        assertEquals("exercise_1", fixture.repository.activeWorkoutRuntime(sessionId)?.activeExerciseId)
    }

    @Test
    fun activeTargetSetOverridePersistsAcrossBootstrapRefreshAndRejectsCompletedSetReduction() = runTest {
        val fixture = fixture()
        val sessionId = fixture.prepareWorkoutExerciseMutationSession(loggedSetCount = 2)

        val rejected = runCatching {
            fixture.repository.updateActiveTargetSets(
                sessionId = sessionId,
                programExerciseId = "program_exercise_1",
                targetSets = 1,
                effectiveTargetDropSets = 0,
            )
        }
        fixture.repository.updateActiveTargetSets(
            sessionId = sessionId,
            programExerciseId = "program_exercise_1",
            targetSets = 4,
            effectiveTargetDropSets = 0,
        )
        fixture.repository.refreshBootstrap()

        assertTrue(rejected.exceptionOrNull() is IllegalArgumentException)
        assertEquals(3, fixture.dao.cachedTargetSets())
        assertEquals(
            4,
            fixture.repository.activeWorkoutBootstrapSnapshot(sessionId)
                ?.let { findProgramExerciseTargetSets(it, "program_exercise_1") },
        )
        assertEquals(
            4,
            fixture.repository.observeActiveTargetSetOverrides(sessionId)
                .first()
                .single()
                .targetSets,
        )
        assertTrue(fixture.dao.queuedOperations().isEmpty())
    }

    @Test
    fun choosingTheExistingProgramCountStillCreatesADurableSessionOverrideWithoutSyncNoise() = runTest {
        val fixture = fixture()
        val sessionId = fixture.prepareWorkoutExerciseMutationSession()

        fixture.repository.updateActiveTargetSets(
            sessionId = sessionId,
            programExerciseId = "program_exercise_1",
            targetSets = 3,
            effectiveTargetDropSets = 0,
        )

        assertEquals(
            3,
            fixture.repository.observeActiveTargetSetOverrides(sessionId)
                .first()
                .single()
                .targetSets,
        )
        assertTrue(fixture.dao.queuedOperations().isEmpty())
    }

    @Test
    fun workoutPrescriptionMutationIsOfflineFirstAndSurvivesAStaleBootstrap() = runTest {
        val fixture = fixture()
        val sessionId = fixture.prepareWorkoutExerciseMutationSession(loggedSetCount = 1)
        val current = requireNotNull(findProgramExercise(
            requireNotNull(fixture.repository.cachedBootstrapSnapshot()),
            "program_exercise_1",
        ))

        assertTrue(
            fixture.repository.updateProgramExercisePrescription(
                sessionId,
                current.copy(
                    targetSets = 5,
                    targetDropSets = 1,
                    targetRepsMin = 10,
                    targetRepsMax = 15,
                    notes = "Controlled eccentric",
                ),
            ),
        )
        fixture.repository.refreshBootstrap()

        val updated = requireNotNull(findProgramExercise(
            requireNotNull(fixture.repository.activeWorkoutBootstrapSnapshot(sessionId)),
            "program_exercise_1",
        ))
        assertEquals(5, updated.targetSets)
        assertEquals(1, updated.targetDropSets)
        assertEquals(10, updated.targetRepsMin)
        assertEquals(15, updated.targetRepsMax)
        assertEquals("Controlled eccentric", updated.notes)
        assertEquals("exercise_1", fixture.repository.localSets(sessionId).single().exerciseId)
        assertEquals(
            3,
            findProgramExerciseTargetSets(
                requireNotNull(fixture.repository.cachedBootstrapSnapshot()),
                "program_exercise_1",
            ),
        )
        assertTrue(fixture.dao.queuedOperations().isEmpty())
    }

    @Test
    fun finishingWithoutStructuralChangesCreatesNoPendingProgramDecision() = runTest {
        val fixture = fixture()
        val sessionId = fixture.prepareWorkoutExerciseMutationSession(loggedSetCount = 1)
        fixture.repository.ensureWorkoutStructureDraft(sessionId)

        fixture.repository.finishSession(sessionId, "Done", 7)

        assertEquals("KEPT_FOR_SESSION", fixture.dao.getWorkoutStructureDraft(sessionId)?.status)
        assertTrue(fixture.repository.observePendingWorkoutStructureDrafts().first().isEmpty())
        assertEquals("Done", fixture.repository.localSession(sessionId)?.notes)
        assertEquals(1, fixture.repository.localSets(sessionId).size)
    }

    @Test
    fun onlyThisWorkoutKeepsHistoryAndLeavesProgramBaselineAcrossRestart() = runTest {
        val fixture = fixture()
        val sessionId = fixture.prepareWorkoutExerciseMutationSession(loggedSetCount = 1)
        val current = requireNotNull(
            findProgramExercise(
                requireNotNull(fixture.repository.cachedBootstrapSnapshot()),
                "program_exercise_1",
            ),
        )
        fixture.repository.updateProgramExercisePrescription(
            sessionId,
            current.copy(targetSets = 5, notes = "Session experiment"),
        )
        fixture.repository.finishSession(sessionId, null, 8)

        assertEquals(sessionId, fixture.repository.observePendingWorkoutStructureDrafts().first().single().sessionId)
        fixture.repository.keepWorkoutStructureChangesForSession(sessionId)

        assertEquals(3, fixture.dao.cachedTargetSets())
        assertEquals("KEPT_FOR_SESSION", fixture.dao.getWorkoutStructureDraft(sessionId)?.status)
        assertEquals(1, fixture.repository.localSets(sessionId).size)
        val restarted = GymCoachRepository(
            dao = fixture.dao,
            accountStore = fixture.accountStore,
            api = fixture.api,
            scheduleSyncNow = {},
            schedulePeriodicSync = {},
        )
        assertTrue(restarted.observePendingWorkoutStructureDrafts().first().isEmpty())
        assertEquals(3, restarted.cachedBootstrapSnapshot()?.let {
            findProgramExerciseTargetSets(it, "program_exercise_1")
        })
    }

    @Test
    fun preferredEquipmentIsOptimisticDurableAndProtectedFromStaleBootstrap() = runTest {
        val fixture = fixture()
        fixture.api.bootstrapResponse = preferredEquipmentBootstrap(preferredEquipmentId = "equipment_a")
        fixture.repository.refreshBootstrap()

        fixture.repository.updatePreferredEquipment("gym_1", "exercise_1", "equipment_b")

        assertEquals("equipment_b", fixture.dao.cachedPreferredEquipment("gym_1", "exercise_1"))
        val queued = fixture.dao.queuedOperations()
        assertEquals(1, queued.size)
        assertEquals("equipment_b", fixture.decodePreferredEquipmentOperation(queued.single()).preferredEquipmentId)
        val scheduledAfterFirstSelection = fixture.syncCounter.count

        fixture.repository.updatePreferredEquipment("gym_1", "exercise_1", "equipment_b")

        assertEquals(listOf(queued.single().operationId), fixture.dao.queuedOperations().map { it.operationId })
        assertEquals(scheduledAfterFirstSelection, fixture.syncCounter.count)

        fixture.api.bootstrapResponse = preferredEquipmentBootstrap(preferredEquipmentId = "equipment_a")
        val refreshed = fixture.repository.refreshBootstrap()
        assertEquals(
            "equipment_b",
            refreshed.gyms.single().exerciseConfigs.single().preferredEquipmentId,
        )

        val restarted = GymCoachRepository(
            dao = fixture.dao,
            accountStore = fixture.accountStore,
            api = fixture.api,
            scheduleSyncNow = { fixture.syncCounter.count++ },
            schedulePeriodicSync = {},
        )
        assertEquals(
            "equipment_b",
            restarted.cachedBootstrapSnapshot()?.gyms?.single()?.exerciseConfigs?.single()
                ?.preferredEquipmentId,
        )
    }

    @Test
    fun activeEquipmentPreferenceIsImmediateAndExcludedFromTheProgramDecision() = runTest {
        val fixture = fixture()
        fixture.api.bootstrapResponse = preferredEquipmentBootstrap(preferredEquipmentId = "equipment_a")
        val bootstrap = fixture.repository.refreshBootstrap()
        val workout = requireNotNull(bootstrap.activeProgram).workouts.single()
        val sessionId = fixture.repository.startWorkout(workout, "gym_1")
        fixture.dao.removeOperations(
            fixture.dao.queuedOperations().map { it.operationId },
        )

        fixture.repository.updatePreferredEquipment(
            gymId = "gym_1",
            exerciseId = "exercise_1",
            preferredEquipmentId = "equipment_b",
        )
        fixture.repository.finishSession(sessionId, null, null)

        assertTrue(fixture.repository.observePendingWorkoutStructureDrafts().first().isEmpty())
        assertEquals("equipment_b", fixture.dao.cachedPreferredEquipment("gym_1", "exercise_1"))
        assertEquals("KEPT_FOR_SESSION", fixture.dao.getWorkoutStructureDraft(sessionId)?.status)
    }

    @Test
    fun newerPreferredEquipmentReplacesOlderQueuedChoiceAndSurvivesOfflineRetry() = runTest {
        val fixture = fixture()
        fixture.api.bootstrapResponse = preferredEquipmentBootstrap(preferredEquipmentId = "equipment_a")
        fixture.repository.refreshBootstrap()
        fixture.repository.updatePreferredEquipment("gym_1", "exercise_1", "equipment_b")
        fixture.repository.updatePreferredEquipment("gym_1", "exercise_1", "equipment_a")

        val queued = fixture.dao.queuedOperations()
        assertEquals(1, queued.size)
        assertEquals("equipment_a", fixture.decodePreferredEquipmentOperation(queued.single()).preferredEquipmentId)

        fixture.api.syncFailure = IOException("offline")
        assertTrue(runCatching { fixture.repository.syncPending() }.exceptionOrNull() is IOException)
        assertEquals("equipment_a", fixture.dao.cachedPreferredEquipment("gym_1", "exercise_1"))
        assertEquals(1, fixture.dao.queuedOperations().size)

        fixture.api.syncFailure = null
        fixture.api.bootstrapResponse = preferredEquipmentBootstrap(preferredEquipmentId = "equipment_a")
        assertTrue(fixture.repository.syncPending())
        assertTrue(fixture.dao.queuedOperations().isEmpty())
        assertEquals("equipment_a", fixture.dao.cachedPreferredEquipment("gym_1", "exercise_1"))
    }

    @Test
    fun invalidOrUnlinkedPreferredEquipmentNeverChangesCacheOrOutbox() = runTest {
        val fixture = fixture()
        fixture.api.bootstrapResponse = preferredEquipmentBootstrap(preferredEquipmentId = "equipment_a")
        fixture.repository.refreshBootstrap()

        val result = runCatching {
            fixture.repository.updatePreferredEquipment("gym_1", "exercise_1", "equipment_unlinked")
        }
        val wrongType = runCatching {
            fixture.repository.updatePreferredEquipment("gym_1", "exercise_1", "equipment_wrong")
        }

        assertTrue(result.exceptionOrNull() is IllegalArgumentException)
        assertTrue(wrongType.exceptionOrNull() is IllegalArgumentException)
        assertEquals("equipment_a", fixture.dao.cachedPreferredEquipment("gym_1", "exercise_1"))
        assertTrue(fixture.dao.queuedOperations().isEmpty())
    }

    @Test
    fun activeDraftAcceptsFurtherChangesWithoutCreatingProgramSyncNoise() = runTest {
        val fixture = fixture()
        val sessionId = fixture.prepareWorkoutExerciseMutationSession()
        fixture.repository.replaceProgramExercise(
            sessionId = sessionId,
            programExerciseId = "program_exercise_1",
            replacementExerciseId = "exercise_3",
        )
        val current = requireNotNull(findProgramExercise(
            requireNotNull(fixture.repository.cachedBootstrapSnapshot()),
            "program_exercise_2",
        ))

        val result = runCatching {
            fixture.repository.updateProgramExercisePrescription(
                sessionId,
                current.copy(notes = "wait for sync"),
            )
        }

        assertTrue(result.getOrNull() == true)
        val active = requireNotNull(fixture.repository.activeWorkoutBootstrapSnapshot(sessionId))
        assertEquals("wait for sync", findProgramExercise(active, "program_exercise_2")?.notes)
        assertEquals("exercise_3", findProgramExercise(active, "program_exercise_1")?.exerciseId)
        assertTrue(fixture.dao.queuedOperations().isEmpty())
    }

    @Test
    fun workoutExerciseAddRemoveAndSupersetMutationsAreAtomic() = runTest {
        val addFixture = fixture()
        val addSessionId = addFixture.prepareWorkoutExerciseMutationSession()
        val addedId = addFixture.repository.addProgramExercise(addSessionId, "workout_1", "exercise_3")
        val addedExercises = findWorkout(
            requireNotNull(addFixture.repository.activeWorkoutBootstrapSnapshot(addSessionId)),
            "workout_1",
        )?.exercises.orEmpty()
        assertTrue(addedExercises.any { it.id == addedId && it.exerciseId == "exercise_3" })
        assertTrue(addFixture.dao.queuedOperations().isEmpty())
        assertEquals("exercise_3", addFixture.repository.activeWorkoutRuntime(addSessionId)?.activeExerciseId)

        val removeFixture = fixture()
        val removeSessionId = removeFixture.prepareWorkoutExerciseMutationSession(loggedSetCount = 1)
        assertEquals(
            "exercise_2",
            removeFixture.repository.removeProgramExercise(removeSessionId, "program_exercise_1"),
        )
        val removed = requireNotNull(removeFixture.repository.activeWorkoutBootstrapSnapshot(removeSessionId))
        assertEquals(listOf("exercise_2"), findWorkout(removed, "workout_1")?.exercises?.map { it.exerciseId })
        assertEquals("exercise_1", removeFixture.repository.localSets(removeSessionId).single().exerciseId)
        assertEquals("exercise_2", removeFixture.repository.activeWorkoutRuntime(removeSessionId)?.activeExerciseId)

        val supersetFixture = fixture()
        val supersetSessionId = supersetFixture.prepareWorkoutExerciseMutationSession()
        assertTrue(
            supersetFixture.repository.mutateProgramExerciseSuperset(
                supersetSessionId,
                "program_exercise_1",
                "program_exercise_2",
            ),
        )
        val linked = findWorkout(
            requireNotNull(supersetFixture.repository.activeWorkoutBootstrapSnapshot(supersetSessionId)),
            "workout_1",
        )?.exercises.orEmpty()
        assertEquals(listOf(1, 1), linked.map { it.supersetGroup })
    }

    @Test
    fun addUsesBootstrapDefaultsAndRapidRepeatCannotCreateADuplicateExercise() = runTest {
        val fixture = fixture()
        val defaults = ActiveWorkoutExerciseDefaultsDto(
            targetSets = 2,
            targetDropSets = 1,
            targetRepsMin = 6,
            targetRepsMax = 9,
            targetRIR = 3,
            autoregulationMode = "PRESERVE_REPS",
            fatigueRate = 1.1,
            loadAdjustmentPct = 2.5,
        )
        val sessionId = fixture.prepareWorkoutExerciseMutationSession(defaults = defaults)

        val addedId = fixture.repository.addProgramExercise(sessionId, "workout_1", "exercise_3")
        val repeated = runCatching {
            fixture.repository.addProgramExercise(sessionId, "workout_1", "exercise_3")
        }

        val added = findWorkout(
            requireNotNull(fixture.repository.activeWorkoutBootstrapSnapshot(sessionId)),
            "workout_1",
        )?.exercises?.single { it.id == addedId } ?: error("Added exercise missing")
        assertEquals(defaults.targetSets, added.targetSets)
        assertEquals(defaults.targetDropSets, added.targetDropSets)
        assertEquals(defaults.targetRepsMin, added.targetRepsMin)
        assertEquals(defaults.targetRepsMax, added.targetRepsMax)
        assertEquals(defaults.targetRIR, added.targetRIR)
        assertEquals(defaults.autoregulationMode, added.autoregulationMode)
        assertEquals(defaults.fatigueRate, added.fatigueRate)
        assertEquals(defaults.loadAdjustmentPct, added.loadAdjustmentPct)
        assertTrue(repeated.exceptionOrNull() is IllegalArgumentException)
        assertTrue(fixture.dao.queuedOperations().isEmpty())
    }

    @Test
    fun failedWorkoutMutationRetriesExactlyOnceAndDuplicateAcceptanceClearsTheOutbox() = runTest {
        val fixture = fixture()
        val sessionId = fixture.prepareWorkoutExerciseMutationSession()
        val current = requireNotNull(findProgramExercise(
            requireNotNull(fixture.repository.cachedBootstrapSnapshot()),
            "program_exercise_1",
        ))
        fixture.repository.updateProgramExercisePrescription(sessionId, current.copy(targetSets = 6))
        fixture.finishAndQueueProgramDecision(sessionId)
        fixture.api.syncFailure = IOException("offline")

        assertTrue(runCatching { fixture.repository.syncPending() }.exceptionOrNull() is IOException)
        assertEquals("FAILED", fixture.dao.queuedOperations().single().status)
        fixture.repository.refreshBootstrap()
        assertEquals(
            6,
            findProgramExerciseTargetSets(
                requireNotNull(fixture.repository.cachedBootstrapSnapshot()),
                "program_exercise_1",
            ),
        )

        fixture.api.syncFailure = null
        fixture.api.syncCalls.clear()
        fixture.api.syncHandler = { request ->
            val operation = request.operations.single() as MutateWorkoutExercisesOperation
            fixture.api.bootstrapResponse = replaceWorkoutExercisesInBootstrap(
                fixture.api.bootstrapResponse,
                operation.workoutId,
                operation.exercises.map {
                    it.toProgramExerciseDto(fixture.api.bootstrapResponse, operation.workoutId)
                },
            )
            SyncBatchResponse(
                serverTime = "2026-07-22T12:00:00Z",
                results = listOf(SyncOperationResult(operation.operationId, "DUPLICATE")),
            )
        }

        assertTrue(fixture.repository.syncPending())
        assertEquals(1, fixture.api.syncCalls.size)
        assertTrue(fixture.dao.queuedOperations().isEmpty())
        assertEquals(
            6,
            findProgramExerciseTargetSets(
                requireNotNull(fixture.repository.cachedBootstrapSnapshot()),
                "program_exercise_1",
            ),
        )
    }

    @Test
    fun rejectedWorkoutMutationRollsBackProgramAndActiveExerciseButPreservesSets() = runTest {
        val fixture = fixture()
        val sessionId = fixture.prepareWorkoutExerciseMutationSession(loggedSetCount = 1)
        fixture.repository.removeProgramExercise(sessionId, "program_exercise_1")
        fixture.finishAndQueueProgramDecision(sessionId)
        fixture.api.syncHandler = { request ->
            SyncBatchResponse(
                serverTime = "2026-07-22T12:00:00Z",
                results = request.operations.map {
                    SyncOperationResult(it.operationId, "REJECTED", error = "stale workout")
                },
            )
        }

        assertFalse(fixture.repository.syncPending())

        assertEquals("BLOCKED", fixture.dao.queuedOperations().single().status)
        assertEquals(
            listOf("exercise_1", "exercise_2"),
            findWorkout(
                requireNotNull(fixture.repository.cachedBootstrapSnapshot()),
                "workout_1",
            )?.exercises?.map { it.exerciseId },
        )
        assertEquals(null, fixture.repository.activeWorkoutRuntime(sessionId))
        assertEquals("exercise_1", fixture.repository.localSets(sessionId).single().exerciseId)
        assertEquals("PENDING", fixture.dao.getWorkoutStructureDraft(sessionId)?.status)
    }

    @Test
    fun equipmentIdentityAndLoadSnapshotStayWithTheOfflineSetAndOutbox() = runTest {
        val fixture = fixture()
        val bootstrap = bootstrapWithTargetSets(3)
        fixture.api.bootstrapResponse = bootstrap
        fixture.repository.refreshBootstrap()
        val workout = requireNotNull(bootstrap.activeProgram).workouts.single()
        val sessionId = fixture.repository.startWorkout(workout, gymId = "gym_1")
        val equipment = GymEquipmentDto(
            id = "equipment_cable_1",
            gymId = "gym_1",
            name = "Cable station",
            snapshotRevisionId = "revision_cable_1",
            equipmentType = "CABLE",
            loadType = "SELECTORIZED",
            weightOptions = listOf(40.0, 45.0, 50.0),
            selectedLoadMultiplier = 0.5,
        )

        val set = fixture.repository.addSet(
            sessionId = sessionId,
            exerciseId = "exercise_1",
            weight = 50.0,
            reps = 10,
            rir = 2,
            notes = null,
            equipment = equipment,
        )

        assertEquals(equipment.id, set.gymEquipmentId)
        assertEquals("Cable station", set.equipmentNameSnapshot)
        assertEquals(50.0, set.selectedLoadKg ?: 0.0, 0.001)
        assertEquals(25.0, set.nominalResistanceKg ?: 0.0, 0.001)
        assertTrue(set.equipmentLoadSnapshotJson?.contains("\"loadType\":\"SELECTORIZED\"") == true)
        val operation = fixture.dao.queuedOperations()
            .map { TestApi.jsonConfig.decodeFromString<SyncOperation>(it.payloadJson) }
            .filterIsInstance<UpsertSetOperation>()
            .single()
        assertEquals(equipment.id, operation.set.gymEquipmentId)
        assertEquals(50.0, operation.set.weight, 0.001)

        fixture.repository.updateSet(set, weight = 45.0, reps = 11, rir = 2)
        val updated = requireNotNull(fixture.dao.getSet(set.id))
        assertEquals(equipment.id, updated.gymEquipmentId)
        assertEquals("Cable station", updated.equipmentNameSnapshot)
        assertEquals(0.5, updated.selectedLoadMultiplierSnapshot ?: 0.0, 0.001)
        assertEquals(45.0, updated.selectedLoadKg ?: 0.0, 0.001)
        assertEquals(22.5, updated.nominalResistanceKg ?: 0.0, 0.001)
        assertTrue(updated.equipmentLoadSnapshotJson?.contains("\"selectedLoadKg\":45.0") == true)
    }

    @Test
    fun watchSetUpdateRetainsFrozenEquipmentIdentityAndUpdatesMutableLoadFacts() = runTest {
        val fixture = fixture()
        val sessionId = fixture.startTestWorkout(gymId = "gym_1")
        val equipment = GymEquipmentDto(
            id = "equipment_watch_1",
            gymId = "gym_1",
            name = "Watch cable",
            snapshotRevisionId = "revision_watch_1",
            equipmentType = "CABLE",
            loadType = "SELECTORIZED",
            weightOptions = listOf(45.0, 50.0),
            selectedLoadMultiplier = 0.5,
        )
        val created = fixture.repository.addSet(
            sessionId = sessionId,
            exerciseId = "exercise_1",
            weight = 50.0,
            reps = 10,
            rir = 2,
            notes = null,
            equipment = equipment,
        )
        val currentRuntime = requireNotNull(fixture.dao.getActiveWorkoutRuntime(sessionId))
        val watchRuntime = currentRuntime.copy(
            revision = currentRuntime.revision + 1,
            updatedAtEpochMs = 9_000,
            updatedBy = "WATCH",
        )
        val incoming = created.copy(
            weight = 45.0,
            reps = 11,
            gymEquipmentId = null,
            equipmentNameSnapshot = null,
            selectedLoadKg = null,
            selectedLoadMultiplierSnapshot = null,
            nominalResistanceKg = null,
            equipmentLoadSnapshotJson = null,
        )

        assertTrue(
            fixture.repository.applyWatchSetEvent(
                processed = WatchProcessedEventEntity(
                    eventId = "76000000-0000-0000-0000-000000000001",
                    sessionId = sessionId,
                    revision = watchRuntime.revision,
                    processedAtEpochMs = 9_000,
                    canonicalEventHash = "b".repeat(64),
                    resultRevision = watchRuntime.revision,
                ),
                set = incoming,
                runtime = watchRuntime,
            ).applied,
        )

        val updated = requireNotNull(fixture.dao.getSet(created.id))
        assertEquals(equipment.id, updated.gymEquipmentId)
        assertEquals(equipment.name, updated.equipmentNameSnapshot)
        assertEquals(equipment.selectedLoadMultiplier, updated.selectedLoadMultiplierSnapshot ?: 0.0, 0.0)
        assertEquals(45.0, updated.weight, 0.0)
        assertEquals(45.0, updated.selectedLoadKg ?: 0.0, 0.0)
        assertEquals(22.5, updated.nominalResistanceKg ?: 0.0, 0.0)
        assertTrue(updated.equipmentLoadSnapshotJson?.contains("revision_watch_1") == true)
        assertTrue(updated.equipmentLoadSnapshotJson?.contains("\"selectedLoadKg\":45.0") == true)
    }

    @Test
    fun watchFirstSetInfersSingleLinkedEquipmentAndQueuesFrozenSnapshot() = runTest {
        val fixture = fixture()
        val equipment = plateLoadedEquipment().copy(
            exerciseLinks = listOf(GymEquipmentExerciseDto(exerciseId = "exercise_1")),
        )
        val response = bootstrapWithTargetSets(3).copy(
            gyms = listOf(
                GymDto(
                    id = equipment.gymId,
                    name = "Equipment-first gym",
                    inventoryMode = "EQUIPMENT_FIRST",
                    equipment = listOf(equipment),
                ),
            ),
        )
        fixture.api.bootstrapResponse = response
        fixture.repository.refreshBootstrap()
        val sessionId = fixture.repository.startWorkout(
            requireNotNull(response.activeProgram).workouts.single(),
            equipment.gymId,
        )
        val currentRuntime = requireNotNull(fixture.dao.getActiveWorkoutRuntime(sessionId))
        val watchRuntime = currentRuntime.copy(
            revision = currentRuntime.revision + 1,
            updatedAtEpochMs = 10_000,
            updatedBy = "WATCH",
        )
        val incoming = watchSet(
            id = "watch_set_equipment_single",
            sessionId = sessionId,
            weight = 70.0,
        )

        val result = fixture.repository.applyWatchSetEvent(
            processed = watchProcessedEvent(
                id = "watch_equipment_event_single",
                sessionId = sessionId,
                revision = watchRuntime.revision,
            ),
            set = incoming,
            runtime = watchRuntime,
        )

        assertTrue(result.applied)
        assertEquals(null, result.errorCode)
        val saved = requireNotNull(fixture.dao.getSet(incoming.id))
        assertEquals(equipment.id, saved.gymEquipmentId)
        assertEquals(equipment.name, saved.equipmentNameSnapshot)
        assertEquals(70.0, saved.selectedLoadKg ?: 0.0, 0.001)
        assertTrue(saved.equipmentLoadSnapshotJson?.contains("\"version\":2") == true)
        assertTrue(saved.equipmentLoadSnapshotJson?.contains(equipment.snapshotRevisionId!!) == true)
        val queued = fixture.upsertEntries().single()
        assertEquals(equipment.id, queued.second.set.gymEquipmentId)
        val frozen = requireNotNull(queued.second.set.frozenEquipmentSnapshot)
        assertEquals(equipment.snapshotRevisionId, frozen.equipmentLoadSnapshot.revisionId)
        assertEquals(listOf(4, null, 8), frozen.equipmentLoadSnapshot.platePool?.plates?.map { it.quantity })
        assertEquals(watchRuntime, fixture.dao.getActiveWorkoutRuntime(sessionId))
    }

    @Test
    fun watchFirstSetRejectsAmbiguousEquipmentWithoutAdvancingMutationState() = runTest {
        val fixture = fixture()
        val first = plateLoadedEquipment().copy(
            exerciseLinks = listOf(GymEquipmentExerciseDto(exerciseId = "exercise_1")),
        )
        val second = first.copy(
            id = "equipment_plate_0002",
            name = "Second plate-loaded press",
            snapshotRevisionId = "revision_plate_0002",
        )
        val response = bootstrapWithTargetSets(3).copy(
            gyms = listOf(
                GymDto(
                    id = first.gymId,
                    name = "Equipment-first gym",
                    inventoryMode = "EQUIPMENT_FIRST",
                    equipment = listOf(first, second),
                ),
            ),
        )
        fixture.api.bootstrapResponse = response
        fixture.repository.refreshBootstrap()
        val sessionId = fixture.repository.startWorkout(
            requireNotNull(response.activeProgram).workouts.single(),
            first.gymId,
        )
        val currentRuntime = requireNotNull(fixture.dao.getActiveWorkoutRuntime(sessionId))
        val attemptedRuntime = currentRuntime.copy(
            revision = currentRuntime.revision + 1,
            updatedAtEpochMs = 11_000,
            updatedBy = "WATCH",
        )
        val incoming = watchSet(
            id = "watch_set_equipment_ambiguous",
            sessionId = sessionId,
            weight = 70.0,
        )
        val processed = watchProcessedEvent(
            id = "watch_equipment_event_ambiguous",
            sessionId = sessionId,
            revision = attemptedRuntime.revision,
        )
        val queuedBefore = fixture.dao.queuedOperations()

        val result = fixture.repository.applyWatchSetEvent(processed, incoming, attemptedRuntime)

        assertFalse(result.applied)
        assertEquals("EQUIPMENT_SELECTION_REQUIRED", result.errorCode)
        assertEquals(null, fixture.dao.getSet(incoming.id))
        assertEquals(currentRuntime, fixture.dao.getActiveWorkoutRuntime(sessionId))
        assertEquals(null, fixture.dao.getProcessedWatchEvent(processed.eventId))
        assertEquals(queuedBefore, fixture.dao.queuedOperations())
        val conflict = fixture.dao.getWatchConflicts(sessionId).single()
        assertEquals(processed.eventId, conflict.eventId)
        assertEquals("UNRESOLVED", conflict.status)
        assertEquals("EQUIPMENT_SELECTION_REQUIRED", conflict.errorCode)
        assertEquals(currentRuntime.revision, conflict.localRevision)
        assertEquals(attemptedRuntime.revision, conflict.remoteRevision)

        fixture.api.bootstrapResponse = response.copy(
            gyms = response.gyms.map { it.copy(equipment = listOf(first)) },
        )
        fixture.repository.refreshBootstrap()
        val replay = fixture.repository.applyWatchSetEvent(processed, incoming, attemptedRuntime)

        assertTrue(replay.applied)
        assertEquals(null, replay.errorCode)
        assertEquals(first.id, fixture.dao.getSet(incoming.id)?.gymEquipmentId)
        assertEquals(attemptedRuntime, fixture.dao.getActiveWorkoutRuntime(sessionId))
        assertEquals(processed, fixture.dao.getProcessedWatchEvent(processed.eventId))
        val resolved = fixture.dao.getWatchConflicts(sessionId).single()
        assertEquals("RESOLVED", resolved.status)
        assertEquals("REPLAY_APPLIED", resolved.resolution)
        assertEquals(processed.processedAtEpochMs, resolved.resolvedAtEpochMs)
    }

    @Test
    fun newEquipmentSetQueuesCompleteFrozenV2Snapshot() = runTest {
        val fixture = fixture()
        val sessionId = fixture.startTestWorkout(gymId = "gym_equipment_0001")
        val equipment = plateLoadedEquipment()

        val set = fixture.repository.addSet(
            sessionId = sessionId,
            exerciseId = "exercise_1",
            weight = 70.0,
            reps = 10,
            rir = 2,
            notes = null,
            equipment = equipment,
        )

        assertEquals(equipment.id, set.gymEquipmentId)
        assertEquals(equipment.name, set.equipmentNameSnapshot)
        assertEquals(70.0, set.selectedLoadKg ?: 0.0, 0.001)
        assertEquals(equipment.selectedLoadMultiplier, set.selectedLoadMultiplierSnapshot ?: 0.0, 0.0)
        assertEquals(null, set.nominalResistanceKg)
        assertTrue(set.equipmentLoadSnapshotJson?.contains("\"version\":2") == true)
        val queued = fixture.upsertEntries().single()
        val frozen = requireNotNull(queued.second.set.frozenEquipmentSnapshot)
        val load = frozen.equipmentLoadSnapshot
        assertEquals(equipment.id, queued.second.set.gymEquipmentId)
        assertEquals(70.0, queued.second.set.weight, 0.001)
        assertEquals(equipment.name, frozen.equipmentNameSnapshot)
        assertEquals(70.0, frozen.selectedLoadKg, 0.001)
        assertEquals(equipment.selectedLoadMultiplier, frozen.selectedLoadMultiplierSnapshot, 0.0)
        assertEquals(null, frozen.nominalResistanceKg)
        assertEquals(2, load.version)
        assertEquals(equipment.snapshotRevisionId, load.revisionId)
        assertEquals(equipment.id, load.gymEquipmentId)
        assertEquals(equipment.loadType, load.loadType)
        assertEquals(equipment.equipmentType, load.equipmentType)
        assertEquals(70.0, load.selectedLoadKg, 0.001)
        assertEquals(equipment.selectedLoadMultiplier, load.selectedLoadMultiplier, 0.0)
        assertEquals(null, load.nominalResistanceKg)
        assertEquals(equipment.weightOptions, load.weightOptions)
        assertEquals(equipment.baseLoadKg, load.baseLoadKg, 0.001)
        assertEquals(equipment.loadingSides, load.loadingSides)
        assertEquals(equipment.platePool?.id, load.platePool?.id)
        assertEquals(equipment.platePool?.name, load.platePool?.name)
        assertEquals(equipment.platePool?.compatibilityKey, load.platePool?.compatibilityKey)
        assertEquals(listOf(20.0, 5.0, 1.25), load.platePool?.plates?.map { it.weightKg })
        assertEquals(listOf(4, null, 8), load.platePool?.plates?.map { it.quantity })
        assertFalse(queued.first.payloadJson.contains("equipmentSnapshotAction"))
    }

    @Test
    fun ordinaryOfflineEditOmitsFrozenSnapshotAfterCreate() = runTest {
        val fixture = fixture()
        val sessionId = fixture.startTestWorkout(gymId = "gym_equipment_0001")
        val equipment = plateLoadedEquipment()
        val set = fixture.repository.addSet(
            sessionId = sessionId,
            exerciseId = "exercise_1",
            weight = 70.0,
            reps = 10,
            rir = 2,
            notes = null,
            equipment = equipment,
        )
        val createJson = fixture.upsertEntries().single().first.payloadJson

        fixture.repository.updateSet(set, weight = 80.0, reps = 11, rir = 2)

        val queued = fixture.upsertEntries()
        assertEquals(2, queued.size)
        assertEquals(createJson, queued[0].first.payloadJson)
        val create = queued[0].second
        val edit = queued[1].second
        assertTrue(create.set.frozenEquipmentSnapshot != null)
        assertEquals(null, edit.set.frozenEquipmentSnapshot)
        assertEquals(null, edit.set.gymEquipmentId)
        assertEquals(80.0, edit.set.weight, 0.001)
        assertFalse(queued[1].first.payloadJson.contains("gymEquipmentId"))
        assertFalse(queued[1].first.payloadJson.contains("frozenEquipmentSnapshot"))
        assertFalse(queued[1].first.payloadJson.contains("equipmentSnapshotAction"))
        val updated = requireNotNull(fixture.dao.getSet(set.id))
        assertEquals(equipment.id, updated.gymEquipmentId)
        assertEquals(equipment.name, updated.equipmentNameSnapshot)
        assertEquals(equipment.selectedLoadMultiplier, updated.selectedLoadMultiplierSnapshot ?: 0.0, 0.0)
        assertEquals(80.0, updated.selectedLoadKg ?: 0.0, 0.001)
        assertTrue(updated.equipmentLoadSnapshotJson?.contains(equipment.snapshotRevisionId!!) == true)
        assertTrue(updated.equipmentLoadSnapshotJson?.contains("\"selectedLoadKg\":80.0") == true)
    }

    @Test
    fun frozenEquipmentSnapshotStillConstrainsEditingAfterEquipmentDeletion() = runTest {
        val fixture = fixture()
        val equipment = plateLoadedEquipment().copy(
            exerciseLinks = listOf(GymEquipmentExerciseDto(exerciseId = "exercise_1")),
        )
        val response = equipmentFirstBootstrap(equipment)
        fixture.api.bootstrapResponse = response
        fixture.repository.refreshBootstrap()
        val sessionId = fixture.repository.startWorkout(
            requireNotNull(response.activeProgram).workouts.single(),
            equipment.gymId,
        )
        val set = fixture.repository.addSet(
            sessionId = sessionId,
            exerciseId = "exercise_1",
            weight = 70.0,
            reps = 10,
            rir = 2,
            notes = null,
            equipment = equipment,
        )
        fixture.api.bootstrapResponse = response.copy(
            gyms = response.gyms.map { it.copy(equipment = emptyList()) },
        )
        fixture.repository.refreshBootstrap()

        fixture.repository.updateSet(set, weight = 80.0, reps = 11, rir = 1)

        val updated = requireNotNull(fixture.dao.getSet(set.id))
        assertEquals(equipment.id, updated.gymEquipmentId)
        assertEquals(equipment.snapshotRevisionId, equipmentSnapshotRevision(updated))
        assertEquals(80.0, updated.weight, 0.001)
        assertEquals(80.0, updated.selectedLoadKg ?: 0.0, 0.001)
    }

    @Test
    fun frozenEquipmentSnapshotIgnoresChangedCurrentEquipmentConstraints() = runTest {
        val fixture = fixture()
        val equipment = plateLoadedEquipment().copy(
            exerciseLinks = listOf(GymEquipmentExerciseDto(exerciseId = "exercise_1")),
        )
        val response = equipmentFirstBootstrap(equipment)
        fixture.api.bootstrapResponse = response
        fixture.repository.refreshBootstrap()
        val sessionId = fixture.repository.startWorkout(
            requireNotNull(response.activeProgram).workouts.single(),
            equipment.gymId,
        )
        val set = fixture.repository.addSet(
            sessionId = sessionId,
            exerciseId = "exercise_1",
            weight = 70.0,
            reps = 10,
            rir = 2,
            notes = null,
            equipment = equipment,
        )
        val changedEquipment = equipment.copy(
            snapshotRevisionId = "revision_plate_changed",
            baseLoadKg = 25.0,
            platePool = equipment.platePool?.copy(
                plates = listOf(GymPlateInventoryItemDto(weightKg = 25.0, quantity = 2)),
            ),
        )
        fixture.api.bootstrapResponse = response.copy(
            gyms = response.gyms.map { it.copy(equipment = listOf(changedEquipment)) },
        )
        fixture.repository.refreshBootstrap()

        fixture.repository.updateSet(set, weight = 80.0, reps = 12, rir = 1)

        val updated = requireNotNull(fixture.dao.getSet(set.id))
        assertEquals(equipment.snapshotRevisionId, equipmentSnapshotRevision(updated))
        assertEquals(80.0, updated.weight, 0.001)
        assertTrue(updated.equipmentLoadSnapshotJson?.contains("revision_plate_changed") == false)
    }

    @Test
    fun impossibleFrozenEquipmentLoadIsRejectedBeforeAnyPhoneOrWatchMutation() = runTest {
        val publisher = RecordingWatchPublisher()
        val fixture = fixture(watchPublisher = publisher)
        val equipment = plateLoadedEquipment().copy(
            exerciseLinks = listOf(GymEquipmentExerciseDto(exerciseId = "exercise_1")),
        )
        val response = equipmentFirstBootstrap(equipment)
        fixture.api.bootstrapResponse = response
        fixture.repository.refreshBootstrap()
        val sessionId = fixture.repository.startWorkout(
            requireNotNull(response.activeProgram).workouts.single(),
            equipment.gymId,
        )
        val set = fixture.repository.addSet(
            sessionId = sessionId,
            exerciseId = "exercise_1",
            weight = 70.0,
            reps = 10,
            rir = 2,
            notes = null,
            equipment = equipment,
        )
        val savedBefore = requireNotNull(fixture.dao.getSet(set.id))
        val runtimeBefore = requireNotNull(fixture.dao.getActiveWorkoutRuntime(sessionId))
        val queuedBefore = fixture.dao.queuedOperations()
        val commandsBefore = publisher.commands.toList()

        val failure = runCatching {
            fixture.repository.updateSet(set, weight = 77.0, reps = 12, rir = 1)
        }.exceptionOrNull()

        assertTrue(failure is IllegalArgumentException)
        assertEquals(savedBefore, fixture.dao.getSet(set.id))
        assertEquals(runtimeBefore, fixture.dao.getActiveWorkoutRuntime(sessionId))
        assertEquals(queuedBefore, fixture.dao.queuedOperations())
        assertEquals(commandsBefore, publisher.commands)
    }

    @Test
    fun unsupportedMalformedAndMismatchedFrozenSnapshotsFailClosed() = runTest {
        val fixture = fixture()
        val equipment = plateLoadedEquipment().copy(
            exerciseLinks = listOf(GymEquipmentExerciseDto(exerciseId = "exercise_1")),
        )
        val response = equipmentFirstBootstrap(equipment)
        fixture.api.bootstrapResponse = response
        fixture.repository.refreshBootstrap()
        val sessionId = fixture.repository.startWorkout(
            requireNotNull(response.activeProgram).workouts.single(),
            equipment.gymId,
        )
        val created = fixture.repository.addSet(
            sessionId = sessionId,
            exerciseId = "exercise_1",
            weight = 70.0,
            reps = 10,
            rir = 2,
            notes = null,
            equipment = equipment,
        )
        val validSnapshot = requireNotNull(created.equipmentLoadSnapshotJson)
        val invalidSnapshots = listOf(
            validSnapshot.replace("\"version\":2", "\"version\":1"),
            validSnapshot.replace("\"version\":2", "\"version\":99"),
            "{not-json",
            validSnapshot.replace(equipment.id, "different_equipment_id"),
        )

        invalidSnapshots.forEach { snapshot ->
            val invalidSet = created.copy(equipmentLoadSnapshotJson = snapshot)
            fixture.dao.saveSet(invalidSet)
            val runtimeBefore = requireNotNull(fixture.dao.getActiveWorkoutRuntime(sessionId))
            val queuedBefore = fixture.dao.queuedOperations()

            val failure = runCatching {
                fixture.repository.updateSet(invalidSet, weight = 80.0, reps = 11, rir = 1)
            }.exceptionOrNull()

            assertTrue(failure is IllegalStateException)
            assertEquals(invalidSet, fixture.dao.getSet(created.id))
            assertEquals(runtimeBefore, fixture.dao.getActiveWorkoutRuntime(sessionId))
            assertEquals(queuedBefore, fixture.dao.queuedOperations())
        }
    }

    @Test
    fun trustedFrozenV2SnapshotSurvivesSetNullAndStillRejectsImpossibleLoad() = runTest {
        val publisher = RecordingWatchPublisher()
        val fixture = fixture(watchPublisher = publisher)
        val equipment = plateLoadedEquipment().copy(
            exerciseLinks = listOf(GymEquipmentExerciseDto(exerciseId = "exercise_1")),
        )
        val response = equipmentFirstBootstrap(equipment)
        fixture.api.bootstrapResponse = response
        fixture.repository.refreshBootstrap()
        val sessionId = fixture.repository.startWorkout(
            requireNotNull(response.activeProgram).workouts.single(),
            equipment.gymId,
        )
        val created = fixture.repository.addSet(
            sessionId = sessionId,
            exerciseId = "exercise_1",
            weight = 70.0,
            reps = 10,
            rir = 2,
            notes = null,
            equipment = equipment,
        )
        fixture.dao.saveSet(created.copy(gymEquipmentId = null))

        fixture.repository.updateSet(created, weight = 80.0, reps = 11, rir = 1)

        val accepted = requireNotNull(fixture.dao.getSet(created.id))
        assertEquals(null, accepted.gymEquipmentId)
        assertEquals(equipment.snapshotRevisionId, equipmentSnapshotRevision(accepted))
        assertEquals(80.0, accepted.weight, 0.001)
        val runtimeBefore = requireNotNull(fixture.dao.getActiveWorkoutRuntime(sessionId))
        val queuedBefore = fixture.dao.queuedOperations()
        val commandsBefore = publisher.commands.toList()

        val failure = runCatching {
            fixture.repository.updateSet(accepted, weight = 77.0, reps = 12, rir = 1)
        }.exceptionOrNull()

        assertTrue(failure is IllegalArgumentException)
        assertEquals(accepted, fixture.dao.getSet(created.id))
        assertEquals(runtimeBefore, fixture.dao.getActiveWorkoutRuntime(sessionId))
        assertEquals(queuedBefore, fixture.dao.queuedOperations())
        assertEquals(commandsBefore, publisher.commands)
    }

    @Test
    fun equipmentWeightIsCanonicalAcrossSetPayloadAndSnapshot() = runTest {
        val fixture = fixture()
        val sessionId = fixture.startTestWorkout(gymId = "gym_equipment_0001")
        val equipment = GymEquipmentDto(
            id = "equipment_selector_0001",
            gymId = "gym_equipment_0001",
            name = "Precise cable",
            snapshotRevisionId = "revision_selector_0001",
            equipmentType = "CABLE",
            loadType = "SELECTORIZED",
            weightOptions = listOf(20.0, 25.0),
            selectedLoadMultiplier = 0.006,
        )

        val set = fixture.repository.addSet(
            sessionId = sessionId,
            exerciseId = "exercise_1",
            weight = 20.004,
            reps = 10,
            rir = 2,
            notes = null,
            equipment = equipment,
        )
        assertEquals(20.0, set.weight, 0.0)
        assertEquals(20.0, set.selectedLoadKg ?: 0.0, 0.0)
        assertEquals(0.12, set.nominalResistanceKg ?: 0.0, 0.0)
        val create = fixture.upsertEntries().single().second
        val frozen = requireNotNull(create.set.frozenEquipmentSnapshot)
        assertEquals(20.0, create.set.weight, 0.0)
        assertEquals(create.set.weight, frozen.selectedLoadKg, 0.0)
        assertEquals(create.set.weight, frozen.equipmentLoadSnapshot.selectedLoadKg, 0.0)
        assertEquals(0.006, frozen.selectedLoadMultiplierSnapshot, 0.0)
        assertEquals(0.12, frozen.nominalResistanceKg ?: 0.0, 0.0)

        fixture.repository.updateSet(set, weight = 25.004, reps = 11, rir = 2)
        val updated = requireNotNull(fixture.dao.getSet(set.id))
        assertEquals(25.0, updated.weight, 0.0)
        assertEquals(25.0, updated.selectedLoadKg ?: 0.0, 0.0)
        assertEquals(0.15, updated.nominalResistanceKg ?: 0.0, 0.0)
        val edit = fixture.upsertEntries()[1].second
        assertEquals(25.0, edit.set.weight, 0.0)
        assertEquals(null, edit.set.gymEquipmentId)
        assertEquals(null, edit.set.frozenEquipmentSnapshot)
        assertFalse(fixture.upsertEntries()[1].first.payloadJson.contains("gymEquipmentId"))
    }

    @Test
    fun bootstrapEquipmentMutationOrDeletionDoesNotRewriteQueuedCreate() = runTest {
        val fixture = fixture()
        val sessionId = fixture.startTestWorkout(gymId = "gym_equipment_0001")
        val equipment = plateLoadedEquipment()
        fixture.repository.addSet(
            sessionId = sessionId,
            exerciseId = "exercise_1",
            weight = 70.0,
            reps = 10,
            rir = 2,
            notes = null,
            equipment = equipment,
        )
        val createJson = fixture.upsertEntries().single().first.payloadJson

        fixture.api.bootstrapResponse = bootstrap(
            gyms = listOf(
                GymDto(
                    id = equipment.gymId,
                    name = "Updated gym",
                    inventoryMode = "EQUIPMENT_FIRST",
                    equipment = listOf(
                        equipment.copy(
                            name = "Changed after offline logging",
                            snapshotRevisionId = "revision_plate_changed_0001",
                            selectedLoadMultiplier = 1.5,
                            baseLoadKg = 99.0,
                            weightOptions = listOf(10.0),
                        ),
                    ),
                ),
            ),
        )
        fixture.repository.refreshBootstrap()
        assertEquals(createJson, fixture.upsertEntries().single().first.payloadJson)

        fixture.api.bootstrapResponse = bootstrap(
            gyms = listOf(
                GymDto(
                    id = equipment.gymId,
                    name = "Updated gym",
                    inventoryMode = "EQUIPMENT_FIRST",
                ),
            ),
        )
        fixture.repository.refreshBootstrap()
        assertEquals(createJson, fixture.upsertEntries().single().first.payloadJson)
    }

    @Test
    fun frozenCreateAndIdentityFreeEditSyncInOrderAfterEquipmentDeletion() = runTest {
        val fixture = fixture()
        val equipment = plateLoadedEquipment()
        val sessionId = fixture.startTestWorkout(gymId = equipment.gymId)
        val set = fixture.repository.addSet(
            sessionId = sessionId,
            exerciseId = "exercise_1",
            weight = 70.0,
            reps = 10,
            rir = 2,
            notes = null,
            equipment = equipment,
        )
        fixture.repository.updateSet(set, weight = 80.0, reps = 11, rir = 1)
        fixture.api.bootstrapResponse = bootstrap(
            gyms = listOf(
                GymDto(
                    id = equipment.gymId,
                    name = "Updated gym",
                    inventoryMode = "EQUIPMENT_FIRST",
                ),
            ),
        )
        fixture.repository.refreshBootstrap()
        val localBeforeSync = requireNotNull(fixture.dao.getSet(set.id))
        val sessionBeforeSync = requireNotNull(fixture.dao.getSession(sessionId))
        fixture.api.bootstrapResponse = bootstrap(
            gyms = listOf(
                GymDto(
                    id = equipment.gymId,
                    name = "Updated gym",
                    inventoryMode = "EQUIPMENT_FIRST",
                ),
            ),
            openSessions = listOf(
                SessionDto(
                    id = sessionId,
                    workoutId = sessionBeforeSync.workoutId,
                    gymId = sessionBeforeSync.gymId,
                    startedAt = sessionBeforeSync.startedAt,
                    sets = listOf(
                        SetDto(
                            id = localBeforeSync.id,
                            sessionId = localBeforeSync.sessionId,
                            exerciseId = localBeforeSync.exerciseId,
                            gymEquipmentId = localBeforeSync.gymEquipmentId,
                            equipmentNameSnapshot = localBeforeSync.equipmentNameSnapshot,
                            selectedLoadKg = localBeforeSync.selectedLoadKg,
                            selectedLoadMultiplierSnapshot = localBeforeSync.selectedLoadMultiplierSnapshot,
                            nominalResistanceKg = localBeforeSync.nominalResistanceKg,
                            equipmentLoadSnapshot = Json.parseToJsonElement(
                                requireNotNull(localBeforeSync.equipmentLoadSnapshotJson),
                            ).jsonObject,
                            setNumber = localBeforeSync.setNumber,
                            weight = localBeforeSync.weight,
                            reps = localBeforeSync.reps,
                            rir = localBeforeSync.rir,
                            completedAt = localBeforeSync.completedAt,
                        ),
                    ),
                ),
            ),
        )

        val queuedBeforeSync = fixture.upsertEntries()
        assertEquals(2, queuedBeforeSync.size)
        fixture.api.syncHandler = { request ->
            val upserts = request.operations.filterIsInstance<UpsertSetOperation>()
            assertEquals(2, upserts.size)
            val create = upserts[0]
            val edit = upserts[1]
            assertEquals(equipment.id, create.set.gymEquipmentId)
            assertEquals(
                equipment.snapshotRevisionId,
                create.set.frozenEquipmentSnapshot?.equipmentLoadSnapshot?.revisionId,
            )
            assertEquals(null, edit.set.gymEquipmentId)
            assertEquals(null, edit.set.frozenEquipmentSnapshot)
            assertFalse(queuedBeforeSync[1].first.payloadJson.contains("gymEquipmentId"))
            assertFalse(queuedBeforeSync[1].first.payloadJson.contains("frozenEquipmentSnapshot"))
            assertFalse(queuedBeforeSync[1].first.payloadJson.contains("equipmentSnapshotAction"))
            SyncBatchResponse(
                serverTime = "2026-07-13T12:00:00Z",
                results = request.operations.map { operation ->
                    SyncOperationResult(operation.operationId, "APPLIED")
                },
            )
        }

        assertTrue(fixture.repository.syncPending())
        assertTrue(fixture.dao.queuedOperations().isEmpty())
        val local = requireNotNull(fixture.dao.getSet(set.id))
        assertEquals(equipment.id, local.gymEquipmentId)
        assertTrue(local.equipmentLoadSnapshotJson?.contains(equipment.snapshotRevisionId!!) == true)
        assertEquals(80.0, local.weight, 0.0)
        assertEquals(11, local.reps)
        assertEquals(1, local.rir)
    }

    @Test
    fun legacyQueuedSetPayloadStillOmitsAbsentEquipmentIdentityAfterDecode() {
        val legacyJson = """
            {
              "type":"UPSERT_SET",
              "operationId":"operation_legacy",
              "set":{
                "id":"set_legacy",
                "sessionId":"session_legacy",
                "exerciseId":"exercise_legacy",
                "setNumber":1,
                "weight":40.0,
                "reps":10,
                "rir":null,
                "isWarmup":false,
                "isDropSet":false,
                "completedAt":"2026-07-13T10:05:00Z"
              }
            }
        """.trimIndent()

        val operation = TestApi.jsonConfig.decodeFromString<SyncOperation>(legacyJson)
        val encoded = TestApi.jsonConfig.encodeToString<SyncOperation>(operation)

        assertFalse(encoded.contains("gymEquipmentId"))
        assertFalse(encoded.contains("equipmentSnapshotAction"))
        assertFalse(encoded.contains("frozenEquipmentSnapshot"))
    }

    @Test
    fun noEquipmentSetUsesTheLegacySyncPath() = runTest {
        val fixture = fixture()
        val sessionId = fixture.startTestWorkout(gymId = null)
        fixture.repository.addSet(
            sessionId = sessionId,
            exerciseId = "exercise_1",
            weight = 40.004,
            reps = 10,
            rir = 2,
            notes = null,
        )
        val queued = fixture.upsertEntries().single()
        assertEquals(40.004, queued.second.set.weight, 0.0)
        assertEquals(null, queued.second.set.gymEquipmentId)
        assertEquals(null, queued.second.set.frozenEquipmentSnapshot)
        assertFalse(queued.first.payloadJson.contains("frozenEquipmentSnapshot"))

        assertTrue(fixture.repository.syncPending())
        assertTrue(fixture.dao.queuedOperations().isEmpty())
    }

    @Test
    fun schemaV3BootstrapDecodesRevisionAndCompletePlateInventory() {
        val bootstrapJson = """
            {
              "schemaVersion":3,
              "calculationVersion":"equipment-v1",
              "serverTime":"2026-07-15T10:00:00Z",
              "profile":{"id":"user_schema_0001","email":"schema@example.com"},
              "gyms":[{
                "id":"gym_schema_0001",
                "name":"Schema gym",
                "inventoryMode":"EQUIPMENT_FIRST",
                "equipment":[{
                  "id":"equipment_schema_0001",
                  "gymId":"gym_schema_0001",
                  "name":"Schema press",
                  "snapshotRevisionId":"revision_schema_0001",
                  "equipmentType":"MACHINE",
                  "loadType":"PLATE_LOADED",
                  "weightOptions":[5.0,10.0],
                  "selectedLoadMultiplier":0.333333,
                  "baseLoadKg":20.0,
                  "loadingSides":2,
                  "platePoolId":"plate_pool_schema_0001",
                  "platePool":{
                    "id":"plate_pool_schema_0001",
                    "gymId":"gym_schema_0001",
                    "name":"Olympic plates",
                    "compatibilityKey":"olympic_50mm",
                    "plates":[
                      {"weightKg":20.0,"quantity":4},
                      {"weightKg":5.0,"quantity":null}
                    ]
                  }
                }]
              }]
            }
        """.trimIndent()

        val equipment = TestApi.jsonConfig.decodeFromString<BootstrapResponse>(bootstrapJson)
            .gyms.single().equipment.single()
        assertEquals("revision_schema_0001", equipment.snapshotRevisionId)
        assertEquals(0.333333, equipment.selectedLoadMultiplier, 0.0)
        assertEquals(listOf(5.0, 10.0), equipment.weightOptions)
        assertEquals(listOf(4, null), equipment.platePool?.plates?.map { it.quantity })
    }

    @Test
    fun legacyV1EquipmentPayloadAndBootstrapCacheRemainReadable() {
        val legacyOperationJson = """
            {
              "type":"UPSERT_SET",
              "operationId":"operation_legacy_equipment",
              "set":{
                "id":"set_legacy_equipment",
                "sessionId":"session_legacy_equipment",
                "exerciseId":"exercise_legacy_equipment",
                "gymEquipmentId":"equipment_legacy_0001",
                "setNumber":1,
                "weight":40.0,
                "reps":10,
                "rir":null,
                "isWarmup":false,
                "isDropSet":false,
                "completedAt":"2026-07-13T10:05:00Z"
              }
            }
        """.trimIndent()
        val operation = TestApi.jsonConfig.decodeFromString<SyncOperation>(legacyOperationJson)
            as UpsertSetOperation
        assertEquals("equipment_legacy_0001", operation.set.gymEquipmentId)
        assertEquals(null, operation.set.frozenEquipmentSnapshot)
        val encoded = TestApi.jsonConfig.encodeToString<SyncOperation>(operation)
        assertFalse(encoded.contains("frozenEquipmentSnapshot"))

        val legacyBootstrapJson = """
            {
              "schemaVersion":1,
              "calculationVersion":"legacy",
              "serverTime":"2026-07-13T10:00:00Z",
              "profile":{"id":"user_legacy_0001","email":"legacy@example.com"},
              "gyms":[{
                "id":"gym_legacy_0001",
                "name":"Legacy gym",
                "equipment":[{
                  "id":"equipment_legacy_0001",
                  "gymId":"gym_legacy_0001",
                  "name":"Legacy machine"
                }]
              }]
            }
        """.trimIndent()
        val bootstrap = TestApi.jsonConfig.decodeFromString<BootstrapResponse>(legacyBootstrapJson)
        assertEquals(null, bootstrap.gyms.single().equipment.single().snapshotRevisionId)
    }

    @Test
    fun bootstrapImportsServerEquipmentSnapshotsIntoRoomState() = runTest {
        val fixture = fixture()
        fixture.api.bootstrapResponse = bootstrap(
            openSessions = listOf(
                SessionDto(
                    id = "session_equipment",
                    workoutId = "workout_1",
                    gymId = "gym_1",
                    startedAt = "2026-07-13T10:00:00Z",
                    sets = listOf(
                        SetDto(
                            id = "set_equipment",
                            sessionId = "session_equipment",
                            exerciseId = "exercise_1",
                            gymEquipmentId = "equipment_cable_1",
                            equipmentNameSnapshot = "Cable station",
                            selectedLoadKg = 50.0,
                            selectedLoadMultiplierSnapshot = 0.5,
                            nominalResistanceKg = 25.0,
                            equipmentLoadSnapshot = Json.parseToJsonElement(
                                "{\"version\":1,\"loadType\":\"SELECTORIZED\"}",
                            ).jsonObject,
                            setNumber = 1,
                            weight = 50.0,
                            reps = 10,
                            rir = 2,
                            completedAt = "2026-07-13T10:05:00Z",
                        ),
                    ),
                ),
            ),
        )

        fixture.repository.refreshBootstrap()

        val imported = requireNotNull(fixture.dao.getSet("set_equipment"))
        assertEquals("equipment_cable_1", imported.gymEquipmentId)
        assertEquals(25.0, imported.nominalResistanceKg ?: 0.0, 0.001)
        assertTrue(imported.equipmentLoadSnapshotJson?.contains("SELECTORIZED") == true)
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
    fun explicitLogoutClearsAuthenticationAndAccountIdentity() = runTest {
        val fixture = fixture()

        fixture.repository.logout()

        assertFalse(fixture.accountStore.isAuthenticated)
        assertEquals(null, fixture.accountStore.userId)
        assertEquals(null, fixture.accountStore.userEmail)
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

        assertEquals(
            SyncIssueDiscardScope.SESSION_AND_RELATED_CHANGES,
            requireNotNull(fixture.repository.syncIssue.first()).discardScope,
        )

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

        assertEquals(
            SyncIssueDiscardScope.SINGLE_OPERATION,
            requireNotNull(fixture.repository.syncIssue.first()).discardScope,
        )

        fixture.repository.discardBlockedChange()

        assertEquals(listOf(goodUpsert.operationId), fixture.dao.queuedOperations().map { it.operationId })
        assertEquals(session, fixture.dao.getSession(session.id))
    }

    @Test
    fun permanentSessionNotFoundDoesNotEnterAnInfiniteManualRetryLoop() = runTest {
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
        assertFalse(requireNotNull(fixture.repository.syncIssue.first()).canRetry)

        fixture.repository.retryBlockedChange()

        val retried = fixture.dao.queuedOperations().single()
        assertEquals("BLOCKED", retried.status)
        assertEquals("Session not found.", retried.lastError)
        assertEquals(0L, retried.lastRetryRequestedAtEpochMs)
        assertEquals(0, fixture.syncCounter.count)
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

    private fun fixture(
        watchPublisher: WatchPhoneCommandPublisher = NoOpWatchPhoneCommandPublisher,
        watchCommandScope: CoroutineScope? = null,
    ): Fixture {
        val dao = InMemoryDao()
        val api = TestApi()
        val accountStore = TestAccountStore()
        val syncCounter = SyncCounter()
        val repository = GymCoachRepository(
            dao = dao,
            accountStore = accountStore,
            api = api,
            scheduleSyncNow = {
                syncCounter.count++
                syncCounter.failure?.let { throw it }
            },
            schedulePeriodicSync = {},
            watchCommandPublisher = watchPublisher,
            watchCommandScope = watchCommandScope,
        )
        return Fixture(dao, api, accountStore, repository, syncCounter)
    }

    private fun watchSet(
        id: String,
        sessionId: String,
        weight: Double,
    ) = LocalSetEntity(
        id = id,
        sessionId = sessionId,
        exerciseId = "exercise_1",
        setNumber = 1,
        weight = weight,
        reps = 8,
        rir = 2,
        completedAt = "2026-07-13T12:00:10Z",
        exerciseSessionId = "program_exercise_1",
        startedAt = "2026-07-13T12:00:00Z",
        source = "WATCH",
        watchRevision = 2,
    )

    private fun watchProcessedEvent(
        id: String,
        sessionId: String,
        revision: Long,
    ) = WatchProcessedEventEntity(
        eventId = id,
        sessionId = sessionId,
        revision = revision,
        processedAtEpochMs = 10_000,
        canonicalEventHash = "c".repeat(64),
        resultRevision = revision,
    )

    private fun bootstrap(
        openSessions: List<SessionDto> = emptyList(),
        activeProgram: ProgramDto? = null,
        exerciseHistoryByExerciseId: Map<String, List<ExerciseHistorySessionDto>> = emptyMap(),
        gyms: List<GymDto> = emptyList(),
        catalog: List<ExerciseDto> = emptyList(),
    ) = BootstrapResponse(
        schemaVersion = 1,
        calculationVersion = "test",
        serverTime = "2026-07-13T12:00:00Z",
        profile = ProfileDto(id = "user_1", email = "user@example.com"),
        activeProgram = activeProgram,
        gyms = gyms,
        catalog = catalog,
        openSessions = openSessions,
        exerciseHistoryByExerciseId = exerciseHistoryByExerciseId,
    )

    private fun plateLoadedEquipment() = GymEquipmentDto(
        id = "equipment_plate_0001",
        gymId = "gym_equipment_0001",
        name = "Plate-loaded press",
        snapshotRevisionId = "revision_plate_0001",
        equipmentType = "MACHINE",
        loadType = "PLATE_LOADED",
        weightOptions = listOf(5.0, 10.0),
        selectedLoadMultiplier = 0.333333,
        baseLoadKg = 20.0,
        loadingSides = 2,
        platePoolId = "plate_pool_0001",
        platePool = GymPlatePoolDto(
            id = "plate_pool_0001",
            gymId = "gym_equipment_0001",
            name = "Olympic plates",
            compatibilityKey = "olympic_50mm",
            plates = listOf(
                GymPlateInventoryItemDto(weightKg = 20.0, quantity = 4),
                GymPlateInventoryItemDto(weightKg = 5.0, quantity = null),
                GymPlateInventoryItemDto(weightKg = 1.25, quantity = 8),
            ),
        ),
    )

    private fun equipmentFirstBootstrap(vararg equipment: GymEquipmentDto): BootstrapResponse =
        bootstrapWithTargetSets(3).copy(
            gyms = listOf(
                GymDto(
                    id = equipment.first().gymId,
                    name = "Equipment-first gym",
                    inventoryMode = "EQUIPMENT_FIRST",
                    equipment = equipment.toList(),
                ),
            ),
        )

    private fun preferredEquipmentBootstrap(
        preferredEquipmentId: String?,
    ): BootstrapResponse {
        val base = bootstrapWithTargetSets(3)
        fun equipment(id: String, name: String) = GymEquipmentDto(
            id = id,
            gymId = "gym_1",
            name = name,
            equipmentType = "BARBELL",
            loadType = "PLATE_LOADED",
            baseLoadKg = if (id == "equipment_a") 20.0 else 15.0,
            exerciseLinks = listOf(GymEquipmentExerciseDto(exerciseId = "exercise_1")),
        )
        return base.copy(
            profile = base.profile.copy(activeGymId = "gym_1"),
            gyms = listOf(
                GymDto(
                    id = "gym_1",
                    name = "Preferred equipment gym",
                    inventoryMode = "EQUIPMENT_FIRST",
                    exerciseConfigs = listOf(
                        GymExerciseConfigDto(
                            gymId = "gym_1",
                            exerciseId = "exercise_1",
                            preferredEquipmentId = preferredEquipmentId,
                        ),
                    ),
                    equipment = listOf(
                        equipment("equipment_a", "20 kg bar"),
                        equipment("equipment_b", "15 kg bar"),
                        GymEquipmentDto(
                            id = "equipment_wrong",
                            gymId = "gym_1",
                            name = "Wrong machine",
                            equipmentType = "MACHINE",
                            exerciseLinks = listOf(
                                GymEquipmentExerciseDto(exerciseId = "exercise_1"),
                            ),
                        ),
                    ),
                ),
            ),
        )
    }

    private fun equipmentSnapshotRevision(set: LocalSetEntity): String? =
        set.equipmentLoadSnapshotJson?.let { snapshot ->
            TestApi.jsonConfig.parseToJsonElement(snapshot)
                .jsonObject["revisionId"]
                ?.toString()
                ?.trim('"')
        }

    private fun bootstrapWithTargetSets(targetSets: Int): BootstrapResponse {
        val originalExercise = ExerciseDto(
            id = "exercise_1",
            name = "Bench press",
            muscleGroup = "CHEST",
            category = "STRENGTH",
            equipmentType = "BARBELL",
        )
        val replacementExercise = ExerciseDto(
            id = "exercise_2",
            name = "Incline dumbbell press",
            muscleGroup = "CHEST",
            category = "STRENGTH",
            equipmentType = "DUMBBELL",
        )
        val authoritativeThirdExercise = ExerciseDto(
            id = "exercise_3",
            name = "Machine chest press",
            muscleGroup = "CHEST",
            category = "STRENGTH",
            equipmentType = "MACHINE",
        )
        return bootstrap(
            catalog = listOf(originalExercise, replacementExercise, authoritativeThirdExercise),
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
                            exercise = originalExercise,
                        ),
                    ),
                ),
            ),
            ),
        )
    }

    private suspend fun Fixture.prepareExerciseReplacementSession(loggedSetCount: Int = 0): String {
        val response = bootstrapWithTargetSets(3)
        val workout = requireNotNull(response.activeProgram).workouts.single()
        val sessionId = "session_replace_$loggedSetCount"
        val loggedSets = List(loggedSetCount) { index ->
            SetDto(
                id = "set_replace_${index + 1}",
                sessionId = sessionId,
                exerciseId = "exercise_1",
                setNumber = index + 1,
                weight = 80.0 + index,
                reps = 8,
                rir = 2,
                completedAt = "2026-07-13T10:0${index + 1}:00Z",
            )
        }
        api.bootstrapResponse = response.copy(
            openSessions = listOf(
                SessionDto(
                    id = sessionId,
                    programId = response.activeProgram.id,
                    workoutId = workout.id,
                    startedAt = "2026-07-13T10:00:00Z",
                    sets = loggedSets,
                    workout = workout,
                ),
            ),
        )
        repository.refreshBootstrap()
        dao.saveActiveWorkoutRuntime(
            ActiveWorkoutRuntimeEntity(
                sessionId = sessionId,
                workoutId = workout.id,
                activeExerciseId = "exercise_1",
                revision = 1,
                updatedAtEpochMs = 1_000,
            ),
        )
        return sessionId
    }

    private suspend fun Fixture.prepareWorkoutExerciseMutationSession(
        loggedSetCount: Int = 0,
        defaults: ActiveWorkoutExerciseDefaultsDto = ActiveWorkoutExerciseDefaultsDto(),
    ): String {
        val base = bootstrapWithTargetSets(3).copy(activeWorkoutExerciseDefaults = defaults)
        val program = requireNotNull(base.activeProgram)
        val originalWorkout = program.workouts.single()
        val secondExercise = base.catalog.first { it.id == "exercise_2" }
        val workout = originalWorkout.copy(
            exercises = originalWorkout.exercises + ProgramExerciseDto(
                id = "program_exercise_2",
                workoutId = originalWorkout.id,
                exerciseId = secondExercise.id,
                order = 2,
                targetSets = 3,
                targetRepsMin = 8,
                targetRepsMax = 12,
                targetRIR = 2,
                restSec = 90,
                exercise = secondExercise,
            ),
        )
        val sessionId = "session_mutate_$loggedSetCount"
        val loggedSets = List(loggedSetCount) { index ->
            SetDto(
                id = "set_mutate_${index + 1}",
                sessionId = sessionId,
                exerciseId = "exercise_1",
                setNumber = index + 1,
                weight = 80.0,
                reps = 10,
                rir = 2,
                completedAt = "2026-07-22T10:0${index + 1}:00Z",
            )
        }
        api.bootstrapResponse = base.copy(
            activeProgram = program.copy(workouts = listOf(workout)),
            openSessions = listOf(
                SessionDto(
                    id = sessionId,
                    programId = program.id,
                    workoutId = workout.id,
                    startedAt = "2026-07-22T10:00:00Z",
                    sets = loggedSets,
                    workout = workout,
                ),
            ),
        )
        repository.refreshBootstrap()
        dao.saveActiveWorkoutRuntime(
            ActiveWorkoutRuntimeEntity(
                sessionId = sessionId,
                workoutId = workout.id,
                activeExerciseId = "exercise_1",
                revision = 1,
                updatedAtEpochMs = 1_000,
            ),
        )
        return sessionId
    }

    private suspend fun Fixture.finishAndQueueProgramDecision(sessionId: String) {
        repository.finishSession(sessionId, null, null)
        val finishOperationIds = dao.queuedOperations().mapNotNull { entry ->
            val operation = api.json.decodeFromString<SyncOperation>(entry.payloadJson)
            entry.operationId.takeIf { operation is FinishSessionOperation }
        }
        dao.removeOperations(finishOperationIds)
        val draft = requireNotNull(repository.observeWorkoutStructureDraft(sessionId).first())
        check(draft.status == "PENDING")
        check(
            draft.baseline.exercises.map { it.exerciseId } !=
                draft.current.exercises.map { it.exerciseId } ||
                draft.baseline.exercises.map { it.toMutationDto() } !=
                draft.current.exercises.map { it.toMutationDto() },
        )
        repository.applyWorkoutStructureChangesToProgram(sessionId)
    }

    private fun BootstrapResponse.activeProgramExerciseId(): String? =
        activeProgram?.workouts?.singleOrNull()?.exercises?.singleOrNull()?.exerciseId

    private fun BootstrapResponse.openSessionExerciseId(sessionId: String): String? =
        openSessions.firstOrNull { it.id == sessionId }
            ?.workout
            ?.exercises
            ?.singleOrNull()
            ?.exerciseId

    private fun removeProgramExerciseFromBootstrap(
        bootstrap: BootstrapResponse,
        programExerciseId: String,
    ): BootstrapResponse {
        fun removeFromWorkout(workout: WorkoutDto): WorkoutDto = workout.copy(
            exercises = workout.exercises.filterNot { it.id == programExerciseId },
        )
        return bootstrap.copy(
            activeProgram = bootstrap.activeProgram?.let { program ->
                program.copy(workouts = program.workouts.map(::removeFromWorkout))
            },
            openSessions = bootstrap.openSessions.map { session ->
                session.copy(workout = session.workout?.let(::removeFromWorkout))
            },
        )
    }

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

    private suspend fun Fixture.startTestWorkout(gymId: String?): String {
        val response = bootstrapWithTargetSets(3)
        api.bootstrapResponse = response
        repository.refreshBootstrap()
        val workout = requireNotNull(response.activeProgram).workouts.single()
        return repository.startWorkout(workout, gymId)
    }

    private data class Fixture(
        val dao: InMemoryDao,
        val api: TestApi,
        val accountStore: TestAccountStore,
        val repository: GymCoachRepository,
        val syncCounter: SyncCounter,
    ) {
        fun outbox(operation: SyncOperation) = SyncOutboxEntity(
            operationId = operation.operationId,
            type = operation.wireType(),
            payloadJson = api.json.encodeToString<SyncOperation>(operation),
        )

        fun decodeTargetSetsOperation(entity: SyncOutboxEntity): UpdateTargetSetsOperation =
            api.json.decodeFromString<SyncOperation>(entity.payloadJson) as UpdateTargetSetsOperation

        fun decodePreferredEquipmentOperation(
            entity: SyncOutboxEntity,
        ): UpdatePreferredEquipmentOperation =
            api.json.decodeFromString<SyncOperation>(entity.payloadJson) as UpdatePreferredEquipmentOperation

        fun decodeReplacementOperation(entity: SyncOutboxEntity): ReplaceProgramExerciseOperation =
            api.json.decodeFromString<SyncOperation>(entity.payloadJson) as ReplaceProgramExerciseOperation

        fun decodeWorkoutMutation(entity: SyncOutboxEntity): MutateWorkoutExercisesOperation =
            api.json.decodeFromString<SyncOperation>(entity.payloadJson) as MutateWorkoutExercisesOperation

        suspend fun upsertEntries(): List<Pair<SyncOutboxEntity, UpsertSetOperation>> =
            dao.queuedOperations().mapNotNull { entity ->
                val operation = api.json.decodeFromString<SyncOperation>(entity.payloadJson)
                (operation as? UpsertSetOperation)?.let { entity to it }
            }
    }

    private class SyncCounter(
        var count: Int = 0,
        var failure: Throwable? = null,
    )

    private class RecordingWatchPublisher(
        private val fail: Boolean = false,
        private val failOnceOn: String? = null,
        private val afterSetCompleted: suspend () -> Unit = {},
        private val afterRestStarted: suspend () -> Unit = {},
    ) : WatchPhoneCommandPublisher {
        val commands = mutableListOf<String>()
        val attempts = mutableListOf<String>()
        val revisions = mutableListOf<Long>()
        val restReasons = mutableListOf<String>()
        private var failedOnce = false

        private fun record(command: String, revision: Long) {
            attempts += command
            if (fail) error("watch unavailable")
            if (!failedOnce && command == failOnceOn) {
                failedOnce = true
                throw WatchProtocolException(WatchProtocolErrorCode.TRANSPORT_FAILURE)
            }
            commands += command
            revisions += revision
        }

        override suspend fun workoutStarted(sessionId: String, revision: Long, startedAtEpochMs: Long) =
            record("START", revision)
        override suspend fun activeExerciseChanged(
            sessionId: String,
            exerciseId: String,
            revision: Long,
            changedAtEpochMs: Long,
        ) = record("EXERCISE", revision)
        override suspend fun setCompleted(set: LocalSetEntity, revision: Long) {
            record("SET_COMPLETED", revision)
            afterSetCompleted()
        }
        override suspend fun setUpdated(set: LocalSetEntity, revision: Long) = record("SET_UPDATED", revision)
        override suspend fun setDeleted(
            sessionId: String,
            setId: String,
            revision: Long,
            baseRevision: Long,
            deletedAtEpochMs: Long,
        ) = record("SET_DELETED", revision)
        override suspend fun restStarted(
            sessionId: String,
            setId: String,
            revision: Long,
            startedAtEpochMs: Long,
            endsAtEpochMs: Long,
        ) {
            record("REST_STARTED", revision)
            afterRestStarted()
        }
        override suspend fun restUpdated(
            sessionId: String,
            revision: Long,
            endsAtEpochMs: Long,
            reason: String,
            changedAtEpochMs: Long,
        ) {
            restReasons += reason
            record("REST_UPDATED", revision)
        }
        override suspend fun restFinished(
            sessionId: String,
            revision: Long,
            startedAtEpochMs: Long,
            finishedAtEpochMs: Long,
        ) = record("REST_FINISHED", revision)
        override suspend fun restSkipped(sessionId: String, revision: Long, skippedAtEpochMs: Long) =
            record("REST_SKIPPED", revision)
        override suspend fun workoutFinished(sessionId: String, revision: Long, finishedAtEpochMs: Long) =
            record("FINISH", revision)

        override suspend fun flush(sessionId: String) {
            if (fail) error("watch unavailable")
            commands += "FINISH"
        }
    }

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
        private val activeTargetSetOverrides =
            linkedMapOf<Pair<String, String>, ActiveTargetSetOverrideEntity>()
        private val activeTargetSetOverrideFlows =
            linkedMapOf<String, MutableStateFlow<List<ActiveTargetSetOverrideEntity>>>()
        private val workoutStructureDrafts = linkedMapOf<String, WorkoutStructureDraftEntity>()
        private val workoutStructureDraftFlows =
            linkedMapOf<String, MutableStateFlow<WorkoutStructureDraftEntity?>>()
        private val pendingWorkoutStructureDraftsFlow =
            MutableStateFlow<List<WorkoutStructureDraftEntity>>(emptyList())
        private val processedWatchEvents = linkedMapOf<String, WatchProcessedEventEntity>()
        private val watchInbox = linkedMapOf<String, WatchInboxEventEntity>()
        private val watchOutbox = linkedMapOf<String, WatchOutboxEventEntity>()
        private val watchResyncMarkers = linkedMapOf<String, WatchResyncMarkerEntity>()
        private val watchAcks = linkedMapOf<String, WatchAckJournalEntity>()
        private val watchPeers = linkedMapOf<String, WatchPeerEntity>()
        private val watchConflicts = linkedMapOf<String, WatchConflictEntity>()
        private val watchFiles = linkedMapOf<Pair<String, Int>, WatchFileTransferEntity>()
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
            activeTargetSetOverrides.entries.removeIf { it.value.sessionId == sessionId }
            workoutStructureDrafts.remove(sessionId)
            publishWorkoutStructureDrafts(sessionId)
            publishActiveTargetSetOverrides(sessionId)
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
        override fun observeActiveTargetSetOverrides(
            sessionId: String,
        ): Flow<List<ActiveTargetSetOverrideEntity>> = activeTargetSetOverrideFlows.getOrPut(sessionId) {
            MutableStateFlow(activeTargetSetOverridesFor(sessionId))
        }
        override suspend fun getActiveTargetSetOverride(
            sessionId: String,
            programExerciseId: String,
        ) = activeTargetSetOverrides[sessionId to programExerciseId]
        override suspend fun saveActiveTargetSetOverride(entity: ActiveTargetSetOverrideEntity) {
            activeTargetSetOverrides[entity.sessionId to entity.programExerciseId] = entity
            publishActiveTargetSetOverrides(entity.sessionId)
        }
        override suspend fun deleteActiveTargetSetOverrides(sessionId: String) {
            activeTargetSetOverrides.entries.removeIf { it.value.sessionId == sessionId }
            publishActiveTargetSetOverrides(sessionId)
        }
        override fun observeWorkoutStructureDraft(
            sessionId: String,
        ): Flow<WorkoutStructureDraftEntity?> = workoutStructureDraftFlows.getOrPut(sessionId) {
            MutableStateFlow(workoutStructureDrafts[sessionId])
        }
        override suspend fun getWorkoutStructureDraft(sessionId: String) =
            workoutStructureDrafts[sessionId]
        override fun observePendingWorkoutStructureDrafts(): Flow<List<WorkoutStructureDraftEntity>> =
            pendingWorkoutStructureDraftsFlow
        override suspend fun saveWorkoutStructureDraft(entity: WorkoutStructureDraftEntity) {
            workoutStructureDrafts[entity.sessionId] = entity
            publishWorkoutStructureDrafts(entity.sessionId)
        }
        override suspend fun updateWorkoutStructureDraftStatus(
            sessionId: String,
            status: String,
            updatedAtEpochMs: Long,
        ) {
            workoutStructureDrafts[sessionId]?.let {
                workoutStructureDrafts[sessionId] = it.copy(
                    status = status,
                    updatedAtEpochMs = updatedAtEpochMs,
                )
            }
            publishWorkoutStructureDrafts(sessionId)
        }
        override suspend fun reopenWorkoutStructureDecision(
            sessionId: String,
            updatedAtEpochMs: Long,
        ) {
            workoutStructureDrafts[sessionId]
                ?.takeIf { it.status == "APPLY_QUEUED" }
                ?.let {
                    workoutStructureDrafts[sessionId] = it.copy(
                        status = "PENDING",
                        updatedAtEpochMs = updatedAtEpochMs,
                    )
                }
            publishWorkoutStructureDrafts(sessionId)
        }
        override suspend fun completeWorkoutStructureDecision(
            sessionId: String,
            updatedAtEpochMs: Long,
        ) {
            workoutStructureDrafts[sessionId]
                ?.takeIf { it.status in setOf("PENDING", "APPLY_QUEUED") }
                ?.let {
                    workoutStructureDrafts[sessionId] = it.copy(
                        status = "APPLIED",
                        updatedAtEpochMs = updatedAtEpochMs,
                    )
                }
            publishWorkoutStructureDrafts(sessionId)
        }
        override suspend fun clearWorkoutStructureDrafts() {
            workoutStructureDrafts.clear()
            workoutStructureDraftFlows.forEach { (_, flow) -> flow.value = null }
            pendingWorkoutStructureDraftsFlow.value = emptyList()
        }
        override suspend fun insertProcessedWatchEvent(entity: WatchProcessedEventEntity): Long =
            if (processedWatchEvents.putIfAbsent(entity.eventId, entity) == null) processedWatchEvents.size.toLong() else -1L
        override suspend fun hasProcessedWatchEvent(eventId: String) =
            if (eventId in processedWatchEvents) 1 else 0
        override suspend fun getProcessedWatchEvent(eventId: String) = processedWatchEvents[eventId]
        override suspend fun insertWatchInboxEvent(entity: WatchInboxEventEntity): Long =
            if (watchInbox.putIfAbsent(entity.eventId, entity) == null) watchInbox.size.toLong() else -1L
        override suspend fun getWatchInboxEvent(eventId: String) = watchInbox[eventId]
        override suspend fun finishWatchInboxEvent(
            eventId: String,
            status: String,
            resultStatus: String,
            resultRevision: Long,
            errorCode: String?,
            processedAtEpochMs: Long,
        ) {
            watchInbox[eventId]?.let {
                watchInbox[eventId] = it.copy(
                    status = status,
                    resultStatus = resultStatus,
                    resultRevision = resultRevision,
                    errorCode = errorCode,
                    processedAtEpochMs = processedAtEpochMs,
                )
            }
        }
        override suspend fun insertWatchOutboxEvent(entity: WatchOutboxEventEntity): Long =
            if (watchOutbox.putIfAbsent(entity.eventId, entity) == null) watchOutbox.size.toLong() else -1L
        override suspend fun getWatchOutboxEvent(eventId: String) = watchOutbox[eventId]
        override suspend fun getReplayableWatchOutboxEvents() = replayableWatchOutbox(null)
        override suspend fun getReplayableWatchOutboxEvents(sessionId: String) = replayableWatchOutbox(sessionId)
        override suspend fun countReplayableWatchOutboxEvents() = replayableWatchOutbox(null).size
        override fun observeReplayableWatchOutboxEventCount(): Flow<Int> =
            MutableStateFlow(replayableWatchOutbox(null).size)
        override suspend fun markWatchOutboxAttempt(eventId: String, attemptedAtEpochMs: Long) {
            watchOutbox[eventId]?.let {
                watchOutbox[eventId] = it.copy(
                    status = "SENT",
                    attempts = it.attempts + 1,
                    lastAttemptAtEpochMs = attemptedAtEpochMs,
                )
            }
        }
        override suspend fun updateWatchOutboxAcknowledgement(
            eventId: String,
            status: String,
            ackStatus: String,
            errorCode: String?,
            acknowledgedAtEpochMs: Long,
        ) {
            watchOutbox[eventId]?.let {
                watchOutbox[eventId] = it.copy(
                    status = status,
                    ackStatus = ackStatus,
                    errorCode = errorCode,
                    acknowledgedAtEpochMs = acknowledgedAtEpochMs,
                )
            }
        }
        override suspend fun deleteWatchOutboxEvents(eventIds: List<String>) {
            eventIds.forEach(watchOutbox::remove)
        }
        override suspend fun saveWatchResyncMarker(entity: WatchResyncMarkerEntity) {
            watchResyncMarkers[entity.sessionId] = entity
        }
        override suspend fun getWatchResyncMarker(sessionId: String) = watchResyncMarkers[sessionId]
        override suspend fun getWatchResyncMarkers() = watchResyncMarkers.values.sortedBy { it.updatedAtEpochMs }
        override suspend fun deleteWatchResyncMarker(sessionId: String, throughRevision: Long) {
            watchResyncMarkers[sessionId]?.takeIf { it.revision <= throughRevision }?.let {
                watchResyncMarkers.remove(sessionId)
            }
        }
        override suspend fun insertWatchAckJournal(entity: WatchAckJournalEntity): Long =
            if (watchAcks.putIfAbsent(entity.ackId, entity) == null) watchAcks.size.toLong() else -1L
        override suspend fun getWatchAckJournal(ackId: String) = watchAcks[ackId]
        override suspend fun pruneWatchAckJournal(keepLatest: Int) {
            watchAcks.values
                .sortedWith(compareByDescending<WatchAckJournalEntity> { it.receivedAtEpochMs }.thenByDescending { it.ackId })
                .drop(keepLatest)
                .forEach { watchAcks.remove(it.ackId) }
        }
        override suspend fun saveWatchPeer(entity: WatchPeerEntity) { watchPeers[entity.deviceId] = entity }
        override suspend fun getWatchPeer(deviceId: String) = watchPeers[deviceId]
        override suspend fun getLatestWatchPeerForSession(sessionId: String) = watchPeers.values
            .filter { it.sessionId == sessionId }
            .maxByOrNull { it.updatedAtEpochMs }
        override fun observeLatestWatchPeer(): Flow<WatchPeerEntity?> =
            MutableStateFlow(watchPeers.values.maxByOrNull { it.updatedAtEpochMs })
        override suspend fun saveWatchConflict(entity: WatchConflictEntity) { watchConflicts[entity.conflictId] = entity }
        override suspend fun getWatchConflicts(sessionId: String) = watchConflicts.values.filter { it.sessionId == sessionId }
        override suspend fun resolveWatchConflictsForEvent(
            eventId: String,
            resolution: String,
            resolvedAtEpochMs: Long,
        ) {
            watchConflicts.entries.forEach { (id, conflict) ->
                if (conflict.eventId == eventId && conflict.status == "UNRESOLVED") {
                    watchConflicts[id] = conflict.copy(
                        status = "RESOLVED",
                        resolution = resolution,
                        resolvedAtEpochMs = resolvedAtEpochMs,
                    )
                }
            }
        }
        override fun observeUnresolvedWatchConflictCount(): Flow<Int> = MutableStateFlow(
            watchConflicts.values.count { it.status == "UNRESOLVED" },
        )
        override suspend fun saveWatchFileTransfer(entity: WatchFileTransferEntity) {
            watchFiles[entity.transferId to entity.sequence] = entity
        }
        override suspend fun getWatchFileTransferParts(transferId: String) =
            watchFiles.values.filter { it.transferId == transferId }.sortedBy { it.sequence }
        override suspend fun getWatchFileTransfersForEvent(eventId: String) =
            watchFiles.values.filter { it.relatedEventId == eventId }.sortedBy { it.sequence }
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
        override suspend fun markOperationFailedDetailed(
            operationId: String,
            error: String,
            category: String?,
            httpStatus: Int?,
            errorCode: String?,
            correlationId: String?,
            exceptionClass: String?,
            stackTrace: String?,
        ) {
            updateOperation(operationId) {
                it.copy(
                    status = "FAILED",
                    attempts = it.attempts + 1,
                    lastError = error,
                    lastErrorCategory = category,
                    lastHttpStatus = httpStatus,
                    lastErrorCode = errorCode,
                    lastCorrelationId = correlationId,
                    lastExceptionClass = exceptionClass,
                    lastStackTrace = stackTrace,
                )
            }
        }
        override suspend fun markOperationBlockedDetailed(
            operationId: String,
            error: String,
            category: String?,
            httpStatus: Int?,
            errorCode: String?,
            correlationId: String?,
            exceptionClass: String?,
            stackTrace: String?,
        ) {
            updateOperation(operationId) {
                it.copy(
                    status = "BLOCKED",
                    attempts = it.attempts + 1,
                    lastError = error,
                    lastErrorCategory = category,
                    lastHttpStatus = httpStatus,
                    lastErrorCode = errorCode,
                    lastCorrelationId = correlationId,
                    lastExceptionClass = exceptionClass,
                    lastStackTrace = stackTrace,
                )
            }
        }
        override suspend fun updateOperationErrorMetadata(
            operationId: String,
            category: String?,
            httpStatus: Int?,
            errorCode: String?,
            correlationId: String?,
            exceptionClass: String?,
            stackTrace: String?,
        ) {
            updateOperation(operationId) {
                it.copy(
                    lastErrorCategory = category,
                    lastHttpStatus = httpStatus,
                    lastErrorCode = errorCode,
                    lastCorrelationId = correlationId,
                    lastExceptionClass = exceptionClass,
                    lastStackTrace = stackTrace,
                )
            }
        }
        override suspend fun retryOperation(operationId: String, requestedAtEpochMs: Long) {
            updateOperation(operationId) {
                it.copy(
                    status = "PENDING",
                    lastError = null,
                    lastErrorCategory = null,
                    lastHttpStatus = null,
                    lastErrorCode = null,
                    lastCorrelationId = null,
                    lastExceptionClass = null,
                    lastStackTrace = null,
                    lastRetryRequestedAtEpochMs = requestedAtEpochMs,
                )
            }
        }
        override suspend fun retryOperationWithPayload(
            operationId: String,
            type: String,
            payloadJson: String,
            requestedAtEpochMs: Long,
        ) {
            updateOperation(operationId) {
                it.copy(
                    type = type,
                    payloadJson = payloadJson,
                    status = "PENDING",
                    lastError = null,
                    lastErrorCategory = null,
                    lastHttpStatus = null,
                    lastErrorCode = null,
                    lastCorrelationId = null,
                    lastExceptionClass = null,
                    lastStackTrace = null,
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
            activeTargetSetOverrides.clear()
            workoutStructureDrafts.clear()
            activeTargetSetOverrideFlows.forEach { (sessionId, flow) ->
                flow.value = activeTargetSetOverridesFor(sessionId)
            }
            workoutStructureDraftFlows.forEach { (_, flow) -> flow.value = null }
            pendingWorkoutStructureDraftsFlow.value = emptyList()
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
        override suspend fun clearWatchInboxEvents() { watchInbox.clear() }
        override suspend fun clearWatchOutboxEvents() { watchOutbox.clear() }
        override suspend fun clearWatchResyncMarkers() { watchResyncMarkers.clear() }
        override suspend fun clearWatchAckJournal() { watchAcks.clear() }
        override suspend fun clearWatchConflicts() { watchConflicts.clear() }
        override suspend fun clearWatchFileTransfers() { watchFiles.clear() }
        override suspend fun clearWatchPeers() { watchPeers.clear() }

        private fun activeTargetSetOverridesFor(
            sessionId: String,
        ): List<ActiveTargetSetOverrideEntity> = activeTargetSetOverrides.values
            .filter { it.sessionId == sessionId }
            .sortedBy { it.programExerciseId }

        private fun publishActiveTargetSetOverrides(sessionId: String) {
            activeTargetSetOverrideFlows[sessionId]?.value = activeTargetSetOverridesFor(sessionId)
        }

        private fun publishWorkoutStructureDrafts(sessionId: String) {
            workoutStructureDraftFlows[sessionId]?.value = workoutStructureDrafts[sessionId]
            pendingWorkoutStructureDraftsFlow.value = workoutStructureDrafts.values
                .filter { it.status == "PENDING" }
                .sortedWith(compareBy<WorkoutStructureDraftEntity> { it.updatedAtEpochMs }.thenBy { it.sessionId })
        }

        suspend fun cachedTargetSets(): Int? = getBootstrap()?.let { cached ->
            val decoded = TestApi.jsonConfig.decodeFromString<BootstrapResponse>(cached.payloadJson)
            findProgramExerciseTargetSets(decoded, "program_exercise_1")
        }

        suspend fun cachedPreferredEquipment(gymId: String, exerciseId: String): String? =
            getBootstrap()?.let { cached ->
                TestApi.jsonConfig.decodeFromString<BootstrapResponse>(cached.payloadJson)
                    .gyms
                    .firstOrNull { it.id == gymId }
                    ?.exerciseConfigs
                    ?.firstOrNull { it.exerciseId == exerciseId }
                    ?.preferredEquipmentId
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

        private fun replayableWatchOutbox(sessionId: String?) = watchOutbox.values
            .filter { it.status == "PENDING" || it.status == "SENT" }
            .filter { sessionId == null || it.sessionId == sessionId }
            .sortedWith(compareBy<WatchOutboxEventEntity> { it.revision }.thenBy { it.timestampEpochMs }.thenBy { it.eventId })
    }

    private companion object {
        const val WATCH_CONCURRENT_EVENT_ID = "75000000-0000-0000-0000-000000000002"
    }
}
