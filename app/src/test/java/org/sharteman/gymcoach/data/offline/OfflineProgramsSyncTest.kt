package org.sharteman.gymcoach.data.offline

import java.io.IOException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.sharteman.gymcoach.data.model.ExerciseDto
import org.sharteman.gymcoach.data.model.ExerciseLoadProfileDto
import org.sharteman.gymcoach.data.model.MuscleLoadDimensionDto
import org.sharteman.gymcoach.data.model.MobileHistorySessionDto
import org.sharteman.gymcoach.data.model.MobileHistorySnapshot
import org.sharteman.gymcoach.data.model.ProgramExerciseDto
import org.sharteman.gymcoach.data.model.TaggedLoadDimensionDto
import org.sharteman.gymcoach.data.model.WorkoutDto
import org.sharteman.gymcoach.data.network.ApiException
import org.sharteman.gymcoach.data.network.HistoryMutationRemote
import org.sharteman.gymcoach.data.programs.ClientMutationMetadata
import org.sharteman.gymcoach.data.programs.ExerciseInput
import org.sharteman.gymcoach.data.programs.ManagedProgramDto
import org.sharteman.gymcoach.data.programs.ProgramExerciseInput
import org.sharteman.gymcoach.data.programs.ProgramInput
import org.sharteman.gymcoach.data.programs.ProgramsCatalogRemoteDataSource
import org.sharteman.gymcoach.data.programs.ProgramsCatalogRepository
import org.sharteman.gymcoach.data.programs.WorkoutInput

class OfflineProgramsSyncTest {
    @Test
    fun `offline exercise edit preserves non-editable metadata and program targets`() {
        val trainingDates = listOf("2026-07-01T08:00:00Z", "2026-07-03T08:00:00Z")
        val loadProfile = ExerciseLoadProfileDto(
            version = 1,
            algorithmVersion = "exercise-load-profile-v1",
            classification = "CLASSIFIED",
            provenance = "TEST",
            confidence = "HIGH",
            primaryMuscles = MuscleLoadDimensionDto("CLASSIFIED"),
            secondaryMuscles = MuscleLoadDimensionDto("CLASSIFIED"),
            movementPatterns = TaggedLoadDimensionDto("CLASSIFIED"),
            fatigueTags = TaggedLoadDimensionDto("CLASSIFIED"),
            jointStress = TaggedLoadDimensionDto("CLASSIFIED"),
        )
        val exercise = ExerciseDto(
            id = "exercise_1",
            userId = "user_1",
            name = "Bench press",
            muscleGroup = "CHEST",
            category = "COMPOUND",
            loadProfile = loadProfile,
            trainingDates = trainingDates,
        )
        val target = ProgramExerciseDto(
            id = "target_1",
            workoutId = "workout_1",
            exerciseId = exercise.id,
            order = 1,
            targetSets = 4,
            targetDropSets = 1,
            targetRepsMin = 8,
            targetRepsMax = 12,
            targetRIR = 2,
            restSec = 150,
            notes = "Keep target draft",
            exercise = exercise,
        )
        val snapshot = CatalogSnapshot(
            programs = listOf(
                ManagedProgramDto(
                    id = "program_1",
                    name = "Program",
                    phase = "Base",
                    workouts = listOf(
                        WorkoutDto(
                            id = "workout_1",
                            programId = "program_1",
                            name = "Workout",
                            order = 1,
                            exercises = listOf(target),
                        ),
                    ),
                ),
            ),
            exercises = listOf(exercise),
        )
        val mutation = UpdateExerciseMutation(
            operationId = "op_00000000000000000000000000000001",
            exerciseId = "exercise_1",
            input = ExerciseInput(
                name = "Updated bench press",
                muscleGroup = "CHEST",
                category = "COMPOUND",
                defaultRestSec = 120,
                notes = null,
                usesBodyweight = false,
                equipmentType = "BARBELL",
            ),
            expected = ExerciseInput(
                name = exercise.name,
                muscleGroup = exercise.muscleGroup,
                category = exercise.category,
                defaultRestSec = exercise.defaultRestSec,
                notes = exercise.notes,
                usesBodyweight = exercise.usesBodyweight,
                equipmentType = exercise.equipmentType,
            ),
        )

        val result = applyCatalogMutations(snapshot, listOf(mutation))
        val updated = result.exercises.single()
        val updatedTarget = result.programs.single().workouts.single().exercises.single()

        assertEquals("Updated bench press", updated.name)
        assertEquals("user_1", updated.userId)
        assertEquals(loadProfile, updated.loadProfile)
        assertEquals(trainingDates, updated.trainingDates)
        assertEquals(target.copy(exercise = updated), updatedTarget)
    }

    @Test
    fun `offline exercise replay blocks when server metadata diverged from expected snapshot`() = runTest {
        val persistence = InMemoryOfflinePersistence()
        val account = "account"
        val expected = ExerciseInput("Original", "CHEST", "COMPOUND", 90, null, false, "BARBELL")
        val updated = expected.copy(name = "Offline edit")
        val mutation = UpdateExerciseMutation(
            operationId = "op_00000000000000000000000000000001",
            exerciseId = "exercise_1",
            input = updated,
            expected = expected,
        )
        persistence.saveCatalog(
            account,
            CatalogSnapshot(exercises = listOf(exerciseFromInput("exercise_1", expected))),
        )
        persistence.enqueue(account, mutation)
        val remote = FakeCatalogRemote().apply {
            currentExercise = exerciseFromInput("exercise_1", expected).copy(name = "Newer server edit")
        }

        val accepted = OfflineSyncEngine(persistence, NetworkStatus { true }).sync(
            account,
            "https://example.test",
            "token",
            remote,
            HistoryMutationRemote { _, _, _ -> },
        )

        assertFalse(accepted)
        assertEquals(0, remote.updateExerciseCalls)
        assertEquals(OFFLINE_STATUS_BLOCKED, persistence.operation(mutation.operationId)?.status)
    }

    @Test
    fun `offline exercise replay updates matching expected metadata with stable operation id`() = runTest {
        val persistence = InMemoryOfflinePersistence()
        val account = "account"
        val expected = ExerciseInput("Original", "CHEST", "COMPOUND", 90, null, false, "BARBELL")
        val updated = expected.copy(name = "Offline edit")
        val mutation = UpdateExerciseMutation(
            operationId = "op_00000000000000000000000000000001",
            exerciseId = "exercise_1",
            input = updated,
            expected = expected,
        )
        persistence.saveCatalog(
            account,
            CatalogSnapshot(exercises = listOf(exerciseFromInput("exercise_1", expected))),
        )
        persistence.enqueue(account, mutation)
        val remote = FakeCatalogRemote().apply {
            currentExercise = exerciseFromInput("exercise_1", expected).copy(
                trainingDates = listOf("2026-07-01T08:00:00Z"),
            )
        }

        assertTrue(
            OfflineSyncEngine(persistence, NetworkStatus { true }).sync(
                account,
                "https://example.test",
                "token",
                remote,
                HistoryMutationRemote { _, _, _ -> },
            ),
        )
        assertEquals(1, remote.updateExerciseCalls)
        assertEquals(mutation.operationId, remote.lastMetadata?.operationId)
        assertEquals(mutation.exerciseId, remote.lastMetadata?.clientEntityId)
        assertEquals(updated.name, remote.currentExercise?.name)
        assertEquals(listOf("2026-07-01T08:00:00Z"), remote.currentExercise?.trainingDates)
    }

    @Test
    fun `offline exercise replay treats already applied metadata as idempotent success`() = runTest {
        val persistence = InMemoryOfflinePersistence()
        val account = "account"
        val expected = ExerciseInput("Original", "CHEST", "COMPOUND", 90, null, false, "BARBELL")
        val updated = expected.copy(name = "Offline edit")
        val mutation = UpdateExerciseMutation(
            operationId = "op_00000000000000000000000000000001",
            exerciseId = "exercise_1",
            input = updated,
            expected = expected,
        )
        persistence.saveCatalog(
            account,
            CatalogSnapshot(exercises = listOf(exerciseFromInput("exercise_1", expected))),
        )
        persistence.enqueue(account, mutation)
        val remote = FakeCatalogRemote().apply {
            currentExercise = exerciseFromInput("exercise_1", updated)
        }

        assertTrue(
            OfflineSyncEngine(persistence, NetworkStatus { true }).sync(
                account,
                "https://example.test",
                "token",
                remote,
                HistoryMutationRemote { _, _, _ -> },
            ),
        )
        assertEquals(0, remote.updateExerciseCalls)
        assertTrue(persistence.operations(account).isEmpty())
        val cached = offlineJson.decodeFromString<CatalogSnapshot>(
            persistence.readCache(catalogCacheKey(account))!!,
        )
        assertEquals(updated, cached.exerciseEditReceipts[mutation.exerciseId])
    }

    @Test
    fun `offline catalog survives repository restart and deleting a local program removes dependents`() = runTest {
        val persistence = InMemoryOfflinePersistence()
        val account = "https://example.test|user_1"
        persistence.saveCatalog(account, CatalogSnapshot())
        var schedules = 0
        val first = repository(persistence, account, connected = false) { schedules++ }

        val program = first.createProgram(ProgramInput("Offline plan", "Base"))
        first.createWorkout(program.id, WorkoutInput("Day A", 1))

        val restarted = repository(persistence, account, connected = false) { schedules++ }
        assertEquals(listOf("Offline plan"), restarted.listPrograms().map { it.name })
        assertEquals(2, persistence.operations(account).size)

        restarted.deleteProgram(program.id)

        assertTrue(persistence.operations(account).isEmpty())
        val afterSecondRestart = repository(persistence, account, connected = false) { schedules++ }
        assertTrue(afterSecondRestart.listPrograms().isEmpty())
        assertTrue(schedules >= 3)
    }

    @Test
    fun `retry resets a blocked operation and schedules actual synchronization`() = runTest {
        val persistence = InMemoryOfflinePersistence()
        val mutation = DeleteHistorySessionMutation("op_00000000000000000000000000000001", "session_1")
        persistence.enqueue("account", mutation)
        persistence.markBlocked(mutation.operationId, "Session not found.")
        var schedules = 0

        val retried = OfflineMutationController(persistence) { schedules++ }.retry(mutation.operationId)

        assertTrue(retried)
        val stored = persistence.operation(mutation.operationId)!!
        assertEquals(OFFLINE_STATUS_PENDING, stored.status)
        assertEquals(0L, stored.nextAttemptAtEpochMs)
        assertEquals(null, stored.lastError)
        assertEquals(1, schedules)
    }

    @Test
    fun `discard removes a rejected create and all dependent optimistic operations permanently`() = runTest {
        val persistence = InMemoryOfflinePersistence()
        val account = "account"
        persistence.saveCatalog(account, CatalogSnapshot())
        val program = CreateProgramMutation(
            "op_00000000000000000000000000000001",
            "mob_program_00000000000000000000000000000001",
            ProgramInput("Rejected", "Base"),
        )
        val workout = CreateWorkoutMutation(
            "op_00000000000000000000000000000002",
            program.programId,
            "mob_workout_00000000000000000000000000000001",
            WorkoutInput("Day A", 1),
        )
        persistence.enqueue(account, program)
        persistence.enqueue(account, workout)
        persistence.markBlocked(program.operationId, "Conflict")

        assertTrue(OfflineMutationController(persistence) {}.discard(program.operationId))

        assertTrue(persistence.operations(account).isEmpty())
        val restarted = repository(persistence, account, connected = false) {}
        assertTrue(restarted.listPrograms().isEmpty())
        assertEquals(null, persistence.operation(program.operationId))
    }

    @Test
    fun `sync retries transient errors with exponential backoff and keeps the optimistic overlay`() = runTest {
        val persistence = InMemoryOfflinePersistence()
        val account = "account"
        persistence.saveCatalog(account, CatalogSnapshot())
        val operation = CreateProgramMutation(
            "op_00000000000000000000000000000001",
            "mob_program_00000000000000000000000000000001",
            ProgramInput("Offline", "Base"),
        )
        persistence.enqueue(account, operation)
        val remote = FakeCatalogRemote().apply { failure = IOException("offline") }

        val result = runCatching {
            OfflineSyncEngine(persistence, NetworkStatus { true }) { 1_000L }.sync(
                account,
                "https://example.test",
                "token",
                remote,
                HistoryMutationRemote { _, _, _ -> },
            )
        }

        assertTrue(result.exceptionOrNull() is OfflineSyncRetryException)
        val failed = persistence.operation(operation.operationId)!!
        assertEquals(OFFLINE_STATUS_FAILED, failed.status)
        assertEquals(1, failed.attempts)
        assertEquals(6_000L, failed.nextAttemptAtEpochMs)
        assertEquals(
            listOf("Offline"),
            applyCatalogMutations(CatalogSnapshot(), listOf(failed.mutation)).programs.map { it.name },
        )
    }

    @Test
    fun `client ids make replayed creates idempotent and history delete 404 completes`() = runTest {
        val persistence = InMemoryOfflinePersistence()
        val account = "account"
        persistence.saveCatalog(account, CatalogSnapshot())
        val create = CreateProgramMutation(
            "op_00000000000000000000000000000001",
            "mob_program_00000000000000000000000000000001",
            ProgramInput("Synced", "Base"),
        )
        persistence.enqueue(account, create)
        val remote = FakeCatalogRemote()
        val history = HistoryMutationRemote { _, _, _ -> throw ApiException(404, "Session not found.") }
        val engine = OfflineSyncEngine(persistence, NetworkStatus { true }) { 1_000L }

        assertTrue(engine.sync(account, "https://example.test", "token", remote, history))
        assertEquals(create.operationId, remote.lastMetadata?.operationId)
        assertEquals(create.programId, remote.lastMetadata?.clientEntityId)
        assertTrue(persistence.operations(account).isEmpty())

        val snapshot = MobileHistorySnapshot(
            schemaVersion = 1,
            generatedAt = "2026-07-14T00:00:00Z",
            month = "2026-07",
            sessions = listOf(historySession("session_1")),
            hasAnyHistory = true,
        )
        val historyKey = historyCacheKey(account, "2026-07", null)
        persistence.saveCache(
            account,
            OFFLINE_DOMAIN_HISTORY,
            historyKey,
            offlineJson.encodeToString(snapshot),
        )
        persistence.enqueue(
            account,
            DeleteHistorySessionMutation("op_00000000000000000000000000000002", "session_1"),
        )

        assertTrue(engine.sync(account, "https://example.test", "token", remote, history))
        val cached = offlineJson.decodeFromString<MobileHistorySnapshot>(persistence.readCache(historyKey)!!)
        assertTrue(cached.sessions.isEmpty())
        assertTrue(persistence.operations(account).isEmpty())
    }

    @Test
    fun `discard waits for an active sync then atomically removes the rejected operation`() = runTest {
        val persistence = InMemoryOfflinePersistence()
        val account = "account"
        persistence.saveCatalog(account, CatalogSnapshot())
        val operation = CreateProgramMutation(
            "op_00000000000000000000000000000001",
            "mob_program_00000000000000000000000000000001",
            ProgramInput("Conflict", "Base"),
        )
        persistence.enqueue(account, operation)
        val started = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val remote = FakeCatalogRemote().apply {
            createHandler = { _, _ ->
                started.complete(Unit)
                release.await()
                throw ApiException(409, "Conflict")
            }
        }
        val engine = OfflineSyncEngine(persistence, NetworkStatus { true })

        val sync = async {
            engine.sync(
                account,
                "https://example.test",
                "token",
                remote,
                HistoryMutationRemote { _, _, _ -> },
            )
        }
        started.await()
        val discard = async { OfflineMutationController(persistence) {}.discard(operation.operationId) }
        assertFalse(discard.isCompleted)

        release.complete(Unit)

        assertFalse(sync.await())
        assertTrue(discard.await())
        assertTrue(persistence.operations(account).isEmpty())
        val base = offlineJson.decodeFromString<CatalogSnapshot>(
            persistence.readCache(catalogCacheKey(account))!!,
        )
        assertTrue(base.programs.isEmpty())
    }

    private fun repository(
        persistence: OfflinePersistence,
        account: String,
        connected: Boolean,
        schedule: () -> Unit,
    ) = ProgramsCatalogRepository.offline(
        remote = FakeCatalogRemote(),
        accountKey = account,
        persistence = persistence,
        networkStatus = NetworkStatus { connected },
        scheduleSync = schedule,
    )

    private fun historySession(id: String) = MobileHistorySessionDto(
        id = id,
        startedAt = "2026-07-14T10:00:00Z",
        finishedAt = "2026-07-14T11:00:00Z",
        durationMin = 60,
        workingSets = 3,
        volume = 1_000.0,
    )

    private fun exerciseFromInput(id: String, input: ExerciseInput) = ExerciseDto(
        id = id,
        userId = "user_1",
        name = input.name,
        muscleGroup = input.muscleGroup,
        category = input.category,
        defaultRestSec = input.defaultRestSec,
        notes = input.notes,
        usesBodyweight = input.usesBodyweight,
        equipmentType = input.equipmentType,
    )
}

private class InMemoryOfflinePersistence : OfflinePersistence {
    private val caches = linkedMapOf<String, OfflineCacheUpdate>()
    private val queue = mutableListOf<StoredOfflineMutation>()
    private val issues = MutableStateFlow<List<OfflineSyncIssue>>(emptyList())
    private val pending = MutableStateFlow(0)
    private var nextSequence = 1L

    override suspend fun readCache(cacheKey: String): String? = caches[cacheKey]?.payloadJson

    override suspend fun readDomainCaches(accountKey: String, domain: String): Map<String, String> =
        caches.filterValues { it.accountKey == accountKey && it.domain == domain }
            .mapValues { it.value.payloadJson }

    override suspend fun saveCache(accountKey: String, domain: String, cacheKey: String, payloadJson: String) {
        caches[cacheKey] = OfflineCacheUpdate(accountKey, domain, cacheKey, payloadJson)
    }

    suspend fun saveCatalog(accountKey: String, snapshot: CatalogSnapshot) {
        saveCache(
            accountKey,
            OFFLINE_DOMAIN_CATALOG,
            catalogCacheKey(accountKey),
            offlineJson.encodeToString(snapshot),
        )
    }

    override suspend fun operations(accountKey: String): List<StoredOfflineMutation> =
        queue.filter { it.accountKey == accountKey }.sortedBy { it.sequence }

    override suspend fun operation(operationId: String): StoredOfflineMutation? =
        queue.firstOrNull { it.mutation.operationId == operationId }

    override suspend fun enqueue(accountKey: String, mutation: OfflineMutation) {
        queue += StoredOfflineMutation(
            sequence = nextSequence++,
            accountKey = accountKey,
            mutation = mutation,
            status = OFFLINE_STATUS_PENDING,
            attempts = 0,
            nextAttemptAtEpochMs = 0,
            lastError = null,
        )
        publish()
    }

    override suspend fun remove(operationIds: List<String>) {
        queue.removeIf { it.mutation.operationId in operationIds }
        publish()
    }

    override suspend fun markFailed(operationId: String, error: String, nextAttemptAtEpochMs: Long) {
        update(operationId) {
            it.copy(
                status = OFFLINE_STATUS_FAILED,
                attempts = it.attempts + 1,
                nextAttemptAtEpochMs = nextAttemptAtEpochMs,
                lastError = error,
            )
        }
    }

    override suspend fun markBlocked(operationId: String, error: String) {
        update(operationId) {
            it.copy(status = OFFLINE_STATUS_BLOCKED, attempts = it.attempts + 1, lastError = error)
        }
    }

    override suspend fun retry(operationId: String) {
        update(operationId) {
            it.copy(status = OFFLINE_STATUS_PENDING, nextAttemptAtEpochMs = 0, lastError = null)
        }
    }

    override suspend fun complete(operationId: String, cacheUpdates: List<OfflineCacheUpdate>) {
        cacheUpdates.forEach { caches[it.cacheKey] = it }
        remove(listOf(operationId))
    }

    override suspend fun clearAccount(accountKey: String) {
        queue.removeIf { it.accountKey == accountKey }
        caches.entries.removeIf { it.value.accountKey == accountKey }
        publish()
    }

    override fun observeIssues(accountKey: String): Flow<List<OfflineSyncIssue>> = issues
    override fun observePendingCount(accountKey: String): Flow<Int> = pending

    private fun update(operationId: String, transform: (StoredOfflineMutation) -> StoredOfflineMutation) {
        val index = queue.indexOfFirst { it.mutation.operationId == operationId }
        if (index >= 0) queue[index] = transform(queue[index])
        publish()
    }

    private fun publish() {
        pending.value = queue.size
        issues.value = queue.filter { it.status == OFFLINE_STATUS_BLOCKED }.map {
            OfflineSyncIssue(
                operationId = it.mutation.operationId,
                type = it.mutation::class.simpleName.orEmpty(),
                message = it.lastError.orEmpty(),
                attempts = it.attempts,
                nextAttemptAtEpochMs = it.nextAttemptAtEpochMs,
                blocked = true,
            )
        }
    }
}

private class FakeCatalogRemote : ProgramsCatalogRemoteDataSource {
    var failure: Throwable? = null
    var lastMetadata: ClientMutationMetadata? = null
    var createHandler: (suspend (ProgramInput, ClientMutationMetadata) -> ManagedProgramDto)? = null
    var currentExercise: ExerciseDto? = null
    var updateExerciseCalls = 0

    override suspend fun listPrograms(): List<ManagedProgramDto> = emptyList()
    override suspend fun getProgram(id: String): ManagedProgramDto = error("unused")
    override suspend fun createProgram(input: ProgramInput): ManagedProgramDto = error("unused")
    override suspend fun createProgram(
        input: ProgramInput,
        metadata: ClientMutationMetadata,
    ): ManagedProgramDto {
        createHandler?.let { return it(input, metadata) }
        failure?.let { throw it }
        lastMetadata = metadata
        return ManagedProgramDto(metadata.clientEntityId!!, input.name, input.description, input.phase)
    }
    override suspend fun updateProgram(id: String, input: ProgramInput): ManagedProgramDto = error("unused")
    override suspend fun deleteProgram(id: String) = Unit
    override suspend fun setProgramActive(id: String, active: Boolean): ManagedProgramDto = error("unused")
    override suspend fun createWorkout(programId: String, input: WorkoutInput): WorkoutDto = error("unused")
    override suspend fun createWorkout(
        programId: String,
        input: WorkoutInput,
        metadata: ClientMutationMetadata,
    ): WorkoutDto = error("unused")
    override suspend fun updateWorkout(id: String, input: WorkoutInput): WorkoutDto = error("unused")
    override suspend fun deleteWorkout(id: String) = Unit
    override suspend fun createProgramExercise(
        workoutId: String,
        input: ProgramExerciseInput,
    ): ProgramExerciseDto = error("unused")
    override suspend fun createProgramExercise(
        workoutId: String,
        input: ProgramExerciseInput,
        metadata: ClientMutationMetadata,
    ): ProgramExerciseDto = error("unused")
    override suspend fun updateProgramExercise(
        id: String,
        input: ProgramExerciseInput,
    ): ProgramExerciseDto = error("unused")
    override suspend fun deleteProgramExercise(id: String) = Unit
    override suspend fun listExercises(): List<ExerciseDto> = emptyList()
    override suspend fun getExercise(id: String): ExerciseDto = currentExercise ?: error("unused")
    override suspend fun createExercise(input: ExerciseInput): ExerciseDto = error("unused")
    override suspend fun createExercise(
        input: ExerciseInput,
        metadata: ClientMutationMetadata,
    ): ExerciseDto = error("unused")
    override suspend fun updateExercise(id: String, input: ExerciseInput): ExerciseDto = error("unused")
    override suspend fun updateExercise(
        id: String,
        input: ExerciseInput,
        metadata: ClientMutationMetadata,
    ): ExerciseDto {
        updateExerciseCalls++
        lastMetadata = metadata
        return requireNotNull(currentExercise).copy(
            name = input.name,
            muscleGroup = input.muscleGroup,
            category = input.category,
            defaultRestSec = input.defaultRestSec,
            notes = input.notes,
            usesBodyweight = input.usesBodyweight,
            equipmentType = input.equipmentType,
        ).also { currentExercise = it }
    }
    override suspend fun deleteExercise(id: String) = Unit
}
