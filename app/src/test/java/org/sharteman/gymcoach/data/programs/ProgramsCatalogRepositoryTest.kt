package org.sharteman.gymcoach.data.programs

import java.io.IOException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.sharteman.gymcoach.data.model.ExerciseDto
import org.sharteman.gymcoach.data.model.ProgramDto
import org.sharteman.gymcoach.data.model.ProgramExerciseDto
import org.sharteman.gymcoach.data.model.WorkoutDto
import org.sharteman.gymcoach.data.offline.CatalogSnapshot
import org.sharteman.gymcoach.data.offline.CreateExerciseMutation
import org.sharteman.gymcoach.data.offline.NetworkStatus
import org.sharteman.gymcoach.data.offline.OFFLINE_DOMAIN_CATALOG
import org.sharteman.gymcoach.data.offline.OFFLINE_STATUS_PENDING
import org.sharteman.gymcoach.data.offline.OfflineCacheUpdate
import org.sharteman.gymcoach.data.offline.OfflineMutation
import org.sharteman.gymcoach.data.offline.OfflinePersistence
import org.sharteman.gymcoach.data.offline.OfflineSyncIssue
import org.sharteman.gymcoach.data.offline.OfflineSyncLock
import org.sharteman.gymcoach.data.offline.StoredOfflineMutation
import org.sharteman.gymcoach.data.offline.UpdateExerciseMutation
import org.sharteman.gymcoach.data.offline.catalogCacheKey
import org.sharteman.gymcoach.data.offline.offlineJson

class ProgramsCatalogRepositoryTest {
    @Test
    fun `seeded bootstrap program remains editable offline without losing catalog data`() = runTest {
        val account = "account"
        val persistence = SeedOfflinePersistence()
        val cachedExercise = exercise("exercise-1", "Cached press", listOf("2026-07-01T08:00:00Z"))
        persistence.saveCatalog(
            account,
            CatalogSnapshot(
                programs = listOf(
                    ManagedProgramDto(
                        id = "program-1",
                        name = "Cached plan",
                        phase = "Base",
                        isActive = false,
                        counts = ProgramCountsDto(workouts = 7, sessions = 12),
                    ),
                    ManagedProgramDto(
                        id = "program-2",
                        name = "Other plan",
                        phase = "Build",
                        isActive = true,
                        counts = ProgramCountsDto(workouts = 2, sessions = 3),
                    ),
                ),
                exercises = listOf(cachedExercise, exercise("exercise-2", "Cached row")),
            ),
        )
        var schedules = 0
        val repository = ProgramsCatalogRepository.offline(
            remote = FailingCatalogRemote(),
            accountKey = account,
            persistence = persistence,
            networkStatus = NetworkStatus { false },
            scheduleSync = { schedules++ },
        )
        val bootstrapExercise = exercise("exercise-1", "Bootstrap press")
        val newBootstrapExercise = exercise("exercise-3", "Bootstrap fly")
        repository.seedActiveProgram(
            ProgramDto(
                id = "program-1",
                name = "Bootstrap plan",
                phase = "Peak",
                workouts = listOf(workout("workout-1", bootstrapExercise, newBootstrapExercise)),
            ),
        )

        val seeded = repository.getProgram("program-1")
        val updatedWorkout = repository.updateWorkout("workout-1", WorkoutInput("Updated offline", 5))

        assertEquals("Bootstrap plan", seeded.name)
        assertEquals(ProgramCountsDto(workouts = 7, sessions = 12), seeded.counts)
        assertEquals("Updated offline", updatedWorkout.name)
        assertEquals(5, updatedWorkout.dayOfWeek)
        assertEquals(listOf("program-1", "program-2"), repository.listPrograms().map { it.id })
        assertTrue(repository.listPrograms().single { it.id == "program-1" }.isActive)
        assertTrue(!repository.listPrograms().single { it.id == "program-2" }.isActive)
        assertEquals(
            listOf("exercise-1", "exercise-2", "exercise-3"),
            repository.listExercises().map { it.id },
        )
        assertEquals("Bootstrap press", repository.getExercise("exercise-1").name)
        assertEquals(
            cachedExercise.trainingDates,
            repository.getExercise("exercise-1").trainingDates,
        )
        assertEquals(1, persistence.operations(account).size)
        assertEquals(1, schedules)
    }

    @Test
    fun `identical offline exercise retry reuses one mutation and newer edit remains authoritative`() = runTest {
        val account = "account"
        val persistence = SeedOfflinePersistence()
        persistence.saveCatalog(
            account,
            CatalogSnapshot(exercises = listOf(exercise("exercise-1", "Original"))),
        )
        var schedules = 0
        val repository = ProgramsCatalogRepository.offline(
            remote = FailingCatalogRemote(),
            accountKey = account,
            persistence = persistence,
            networkStatus = NetworkStatus { false },
            scheduleSync = { schedules++ },
        )
        val original = repository.getExercise("exercise-1")
        val first = ExerciseInput("First", "CHEST", "COMPOUND", 120, null, false, "BARBELL")
        val newer = first.copy(name = "Newer")

        repository.updateExercise(original, first)
        val firstMutation = persistence.operations(account).single().mutation as UpdateExerciseMutation
        assertEquals(original.generalMetadataInput(), firstMutation.expected)
        repository.updateExercise(original, first)
        val firstResult = repository.getExercise("exercise-1")
        repository.updateExercise(firstResult, newer)
        try {
            repository.updateExercise(original, first)
            throw AssertionError("A stale editor must not overwrite a newer exercise edit.")
        } catch (_: IOException) {
            // Expected.
        }

        assertEquals(2, persistence.operations(account).size)
        assertEquals("Newer", repository.getExercise("exercise-1").name)
        assertEquals(3, schedules)
    }

    @Test
    fun `exercise update returns optimistic metadata when enqueue is synchronized immediately`() = runTest {
        val account = "account"
        val original = exercise("exercise-1", "Original", listOf("2026-07-01T08:00:00Z"))
        val persistence = SeedOfflinePersistence().apply { completeEnqueueImmediately = true }
        persistence.saveCatalog(account, CatalogSnapshot(exercises = listOf(original)))
        val repository = ProgramsCatalogRepository.offline(
            remote = FailingCatalogRemote(),
            accountKey = account,
            persistence = persistence,
            networkStatus = NetworkStatus { false },
            scheduleSync = {},
        )
        val input = original.generalMetadataInput().copy(name = "Optimistic edit")

        val updated = repository.updateExercise(original, input)

        assertEquals("Optimistic edit", updated.name)
        assertEquals(original.userId, updated.userId)
        assertEquals(original.trainingDates, updated.trainingDates)
        assertTrue(persistence.operations(account).isEmpty())
    }

    @Test
    fun `offline created exercise keeps owner and remains editable before synchronization`() = runTest {
        val account = "https://example.test|user-1"
        val persistence = SeedOfflinePersistence()
        persistence.saveCatalog(account, CatalogSnapshot())
        val repository = ProgramsCatalogRepository.offline(
            remote = FailingCatalogRemote(),
            accountKey = account,
            persistence = persistence,
            networkStatus = NetworkStatus { false },
            scheduleSync = {},
            ownerUserId = "user-1",
        )
        val created = repository.createExercise(
            ExerciseInput("Offline press", "CHEST", "COMPOUND", 90, null, false, "BARBELL"),
        )

        val updated = repository.updateExercise(
            created,
            ExerciseInput("Offline press edited", "CHEST", "COMPOUND", 120, null, false, "BARBELL"),
        )

        assertEquals("user-1", created.userId)
        assertEquals("user-1", updated.userId)
        assertEquals("Offline press edited", updated.name)
        assertEquals(2, persistence.operations(account).size)
    }

    @Test
    fun `missing or unowned offline exercise never enqueues a mutation`() = runTest {
        val account = "account"
        val persistence = SeedOfflinePersistence()
        persistence.saveCatalog(
            account,
            CatalogSnapshot(exercises = listOf(exercise("system", "System", userId = null))),
        )
        val repository = ProgramsCatalogRepository.offline(
            remote = FailingCatalogRemote(),
            accountKey = account,
            persistence = persistence,
            networkStatus = NetworkStatus { false },
            scheduleSync = {},
        )
        val input = ExerciseInput("Changed", "CHEST", "COMPOUND", 90, null, false, "OTHER")

        try {
            repository.updateExercise("missing", input)
            throw AssertionError("Missing exercise update should fail.")
        } catch (_: IOException) {
            // Expected.
        }
        try {
            repository.updateExercise("system", input)
            throw AssertionError("Unowned exercise update should fail.")
        } catch (_: IOException) {
            // Expected.
        }

        assertTrue(persistence.operations(account).isEmpty())
    }

    @Test
    fun `bootstrap seed keeps unconfirmed edit receipt but removes absent authoritative exercises`() = runTest {
        val account = "account"
        val persistence = SeedOfflinePersistence()
        val input = ExerciseInput("Edited", "CHEST", "COMPOUND", 120, null, false, "BARBELL")
        persistence.saveCatalog(
            account,
            CatalogSnapshot(
                exercises = listOf(exercise("exercise-1", "Original").copy(name = "Edited")),
                exerciseEditReceipts = mapOf("exercise-1" to input),
            ),
        )
        val repository = ProgramsCatalogRepository.offline(
            remote = FailingCatalogRemote(),
            accountKey = account,
            persistence = persistence,
            networkStatus = NetworkStatus { false },
            scheduleSync = {},
        )

        repository.seedExerciseCatalog(listOf(exercise("exercise-1", "Stale server value")))
        assertEquals("Edited", repository.getExercise("exercise-1").name)

        repository.seedExerciseCatalog(emptyList())
        try {
            repository.getExercise("exercise-1")
            throw AssertionError("An exercise absent from the authoritative catalog must be removed.")
        } catch (_: IOException) {
            // Expected.
        }
    }

    @Test
    fun `authoritative exercise seed retains only absent local exercises with pending creates`() = runTest {
        val account = "account"
        val pendingId = "mob_exercise_pending"
        val orphanId = "mob_exercise_orphan"
        val pendingInput = ExerciseInput("Pending", "CHEST", "COMPOUND")
        val persistence = SeedOfflinePersistence()
        persistence.saveCatalog(
            account,
            CatalogSnapshot(
                exercises = listOf(
                    exercise(pendingId, "Pending"),
                    exercise(orphanId, "Orphan"),
                ),
            ),
        )
        persistence.enqueue(
            account,
            CreateExerciseMutation("op_pending", pendingId, pendingInput, "user-1"),
        )
        val repository = ProgramsCatalogRepository.offline(
            remote = FailingCatalogRemote(),
            accountKey = account,
            persistence = persistence,
            networkStatus = NetworkStatus { false },
            scheduleSync = {},
        )

        repository.seedExerciseCatalog(emptyList())

        assertEquals(pendingId, repository.getExercise(pendingId).id)
        try {
            repository.getExercise(orphanId)
            throw AssertionError("An absent local exercise without a pending create must be removed.")
        } catch (_: IOException) {
            // Expected.
        }
    }

    @Test
    fun `catalog refresh protects captured receipt without resurrecting a concurrently consumed receipt`() = runTest {
        val account = "account"
        val input = ExerciseInput("Edited", "CHEST", "COMPOUND", 120, null, false, "BARBELL")
        val persistence = SeedOfflinePersistence()
        persistence.saveCatalog(
            account,
            CatalogSnapshot(
                exercises = listOf(exercise("exercise-1", "Edited")),
                exerciseEditReceipts = mapOf("exercise-1" to input),
            ),
        )
        val started = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val remote = FailingCatalogRemote().apply {
            listExercisesHandler = {
                started.complete(Unit)
                release.await()
                listOf(exercise("exercise-1", "Stale server value"))
            }
        }
        val repository = ProgramsCatalogRepository.offline(
            remote = remote,
            accountKey = account,
            persistence = persistence,
            networkStatus = NetworkStatus { true },
            scheduleSync = {},
        )

        val refresh = async { repository.listExercises() }
        started.await()
        OfflineSyncLock.mutex.withLock {
            val current = offlineJson.decodeFromString<CatalogSnapshot>(
                persistence.readCache(catalogCacheKey(account))!!,
            )
            persistence.saveCatalog(account, current.copy(exerciseEditReceipts = emptyMap()))
        }
        release.complete(Unit)

        assertEquals("Edited", refresh.await().single().name)
        val stored = offlineJson.decodeFromString<CatalogSnapshot>(
            persistence.readCache(catalogCacheKey(account))!!,
        )
        assertEquals("Edited", stored.exercises.single().name)
        assertTrue(stored.exerciseEditReceipts.isEmpty())
    }

    private fun workout(id: String, vararg exercises: ExerciseDto) = WorkoutDto(
        id = id,
        programId = "program-1",
        name = "Monday",
        dayOfWeek = 1,
        order = 1,
        exercises = exercises.mapIndexed { index, exercise ->
            ProgramExerciseDto(
                id = "target-${index + 1}",
                workoutId = id,
                exerciseId = exercise.id,
                order = index + 1,
                targetSets = 4,
                targetRepsMin = 8,
                targetRepsMax = 10,
                targetRIR = 2,
                restSec = 120,
                exercise = exercise,
            )
        },
    )

    private fun exercise(
        id: String,
        name: String,
        trainingDates: List<String> = emptyList(),
        userId: String? = "user-1",
    ) = ExerciseDto(
        id = id,
        userId = userId,
        name = name,
        muscleGroup = "CHEST",
        category = "COMPOUND",
        trainingDates = trainingDates,
    )
}

private class SeedOfflinePersistence : OfflinePersistence {
    private val caches = linkedMapOf<String, OfflineCacheUpdate>()
    private val queue = mutableListOf<StoredOfflineMutation>()
    private var nextSequence = 1L
    var completeEnqueueImmediately = false

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
        queue.filter { it.accountKey == accountKey }

    override suspend fun operation(operationId: String): StoredOfflineMutation? =
        queue.firstOrNull { it.mutation.operationId == operationId }

    override suspend fun enqueue(accountKey: String, mutation: OfflineMutation) {
        if (completeEnqueueImmediately) return
        queue += StoredOfflineMutation(
            sequence = nextSequence++,
            accountKey = accountKey,
            mutation = mutation,
            status = OFFLINE_STATUS_PENDING,
            attempts = 0,
            nextAttemptAtEpochMs = 0,
            lastError = null,
        )
    }

    override suspend fun remove(operationIds: List<String>) {
        queue.removeIf { it.mutation.operationId in operationIds }
    }

    override suspend fun markFailed(operationId: String, error: String, nextAttemptAtEpochMs: Long) = Unit
    override suspend fun markBlocked(operationId: String, error: String) = Unit
    override suspend fun retry(operationId: String) = Unit

    override suspend fun complete(operationId: String, cacheUpdates: List<OfflineCacheUpdate>) {
        cacheUpdates.forEach { caches[it.cacheKey] = it }
        remove(listOf(operationId))
    }

    override suspend fun clearAccount(accountKey: String) {
        queue.removeIf { it.accountKey == accountKey }
        caches.entries.removeIf { it.value.accountKey == accountKey }
    }

    override fun observeIssues(accountKey: String): Flow<List<OfflineSyncIssue>> = flowOf(emptyList())
    override fun observePendingCount(accountKey: String): Flow<Int> = flowOf(queue.size)
}

private class FailingCatalogRemote : ProgramsCatalogRemoteDataSource {
    var listExercisesHandler: (suspend () -> List<ExerciseDto>)? = null
    private fun unavailable(): Nothing = error("Remote catalog must not be used while offline.")

    override suspend fun listPrograms(): List<ManagedProgramDto> = unavailable()
    override suspend fun getProgram(id: String): ManagedProgramDto = unavailable()
    override suspend fun createProgram(input: ProgramInput): ManagedProgramDto = unavailable()
    override suspend fun createProgram(
        input: ProgramInput,
        metadata: ClientMutationMetadata,
    ): ManagedProgramDto = unavailable()
    override suspend fun updateProgram(id: String, input: ProgramInput): ManagedProgramDto = unavailable()
    override suspend fun deleteProgram(id: String) = unavailable()
    override suspend fun setProgramActive(id: String, active: Boolean): ManagedProgramDto = unavailable()
    override suspend fun createWorkout(programId: String, input: WorkoutInput): WorkoutDto = unavailable()
    override suspend fun createWorkout(
        programId: String,
        input: WorkoutInput,
        metadata: ClientMutationMetadata,
    ): WorkoutDto = unavailable()
    override suspend fun updateWorkout(id: String, input: WorkoutInput): WorkoutDto = unavailable()
    override suspend fun deleteWorkout(id: String) = unavailable()
    override suspend fun createProgramExercise(
        workoutId: String,
        input: ProgramExerciseInput,
    ): ProgramExerciseDto = unavailable()
    override suspend fun createProgramExercise(
        workoutId: String,
        input: ProgramExerciseInput,
        metadata: ClientMutationMetadata,
    ): ProgramExerciseDto = unavailable()
    override suspend fun updateProgramExercise(
        id: String,
        input: ProgramExerciseInput,
    ): ProgramExerciseDto = unavailable()
    override suspend fun deleteProgramExercise(id: String) = unavailable()
    override suspend fun listExercises(): List<ExerciseDto> = listExercisesHandler?.invoke() ?: unavailable()
    override suspend fun getExercise(id: String): ExerciseDto = unavailable()
    override suspend fun createExercise(input: ExerciseInput): ExerciseDto = unavailable()
    override suspend fun createExercise(
        input: ExerciseInput,
        metadata: ClientMutationMetadata,
    ): ExerciseDto = unavailable()
    override suspend fun updateExercise(id: String, input: ExerciseInput): ExerciseDto = unavailable()
    override suspend fun deleteExercise(id: String) = unavailable()
}
