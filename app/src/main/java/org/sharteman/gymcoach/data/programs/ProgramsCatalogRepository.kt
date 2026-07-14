package org.sharteman.gymcoach.data.programs

import java.io.IOException
import java.util.UUID
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import org.sharteman.gymcoach.data.model.ExerciseDto
import org.sharteman.gymcoach.data.model.ProgramExerciseDto
import org.sharteman.gymcoach.data.model.WorkoutDto
import org.sharteman.gymcoach.data.offline.CatalogSnapshot
import org.sharteman.gymcoach.data.offline.CreateExerciseMutation
import org.sharteman.gymcoach.data.offline.CreateProgramExerciseMutation
import org.sharteman.gymcoach.data.offline.CreateProgramMutation
import org.sharteman.gymcoach.data.offline.CreateWorkoutMutation
import org.sharteman.gymcoach.data.offline.DeleteExerciseMutation
import org.sharteman.gymcoach.data.offline.DeleteProgramExerciseMutation
import org.sharteman.gymcoach.data.offline.DeleteProgramMutation
import org.sharteman.gymcoach.data.offline.DeleteWorkoutMutation
import org.sharteman.gymcoach.data.offline.NetworkStatus
import org.sharteman.gymcoach.data.offline.OFFLINE_DOMAIN_CATALOG
import org.sharteman.gymcoach.data.offline.OfflineMutation
import org.sharteman.gymcoach.data.offline.OfflineMutationController
import org.sharteman.gymcoach.data.offline.OfflinePersistence
import org.sharteman.gymcoach.data.offline.OfflineRuntime
import org.sharteman.gymcoach.data.offline.SetProgramActiveMutation
import org.sharteman.gymcoach.data.offline.UpdateExerciseMutation
import org.sharteman.gymcoach.data.offline.UpdateProgramExerciseMutation
import org.sharteman.gymcoach.data.offline.UpdateProgramMutation
import org.sharteman.gymcoach.data.offline.UpdateWorkoutMutation
import org.sharteman.gymcoach.data.offline.applyCatalogMutations
import org.sharteman.gymcoach.data.offline.catalogCacheKey
import org.sharteman.gymcoach.data.offline.offlineJson

class ProgramsCatalogRepository private constructor(
    private val remote: ProgramsCatalogRemoteDataSource,
    private val accountKey: String?,
    private val persistence: OfflinePersistence?,
    private val networkStatus: NetworkStatus,
    private val scheduleSync: () -> Unit,
) : ProgramsCatalogDataSource {
    private val mutex = Mutex()

    override suspend fun listPrograms(): List<ManagedProgramDto> = mutex.withLock {
        val base = refreshCatalogPart { current ->
            val remotePrograms = remote.listPrograms()
            current.copy(
                programs = remotePrograms.map { loaded ->
                    val cached = current.programs.firstOrNull { it.id == loaded.id }
                    if (loaded.workouts.isEmpty() && cached?.workouts?.isNotEmpty() == true) {
                        loaded.copy(workouts = cached.workouts)
                    } else {
                        loaded
                    }
                },
            )
        }
        view(base).programs
    }

    override suspend fun getProgram(id: String): ManagedProgramDto = mutex.withLock {
        val base = refreshCatalogPart { current ->
            val loaded = remote.getProgram(id)
            current.copy(programs = current.programs.filterNot { it.id == id } + loaded)
        }
        view(base).programs.firstOrNull { it.id == id }
            ?: throw IOException("Program is not available offline.")
    }

    override suspend fun createProgram(input: ProgramInput): ManagedProgramDto = mutex.withLock {
        if (persistence == null) return@withLock remote.createProgram(input)
        val mutation = CreateProgramMutation(operationId(), entityId("program"), input)
        enqueue(mutation)
        view(loadBase()).programs.first { it.id == mutation.programId }
    }

    override suspend fun updateProgram(id: String, input: ProgramInput): ManagedProgramDto = mutex.withLock {
        if (persistence == null) return@withLock remote.updateProgram(id, input)
        enqueue(UpdateProgramMutation(operationId(), id, input))
        view(loadBase()).programs.firstOrNull { it.id == id }
            ?: throw IOException("Program is not available offline.")
    }

    override suspend fun deleteProgram(id: String) = mutex.withLock {
        if (persistence == null) return@withLock remote.deleteProgram(id)
        if (!discardUnsyncedCreate { it is CreateProgramMutation && it.programId == id }) {
            enqueue(DeleteProgramMutation(operationId(), id))
        }
    }

    override suspend fun setProgramActive(id: String, active: Boolean): ManagedProgramDto = mutex.withLock {
        if (persistence == null) return@withLock remote.setProgramActive(id, active)
        enqueue(SetProgramActiveMutation(operationId(), id, active))
        view(loadBase()).programs.firstOrNull { it.id == id }
            ?: throw IOException("Program is not available offline.")
    }

    override suspend fun createWorkout(programId: String, input: WorkoutInput): WorkoutDto = mutex.withLock {
        if (persistence == null) return@withLock remote.createWorkout(programId, input)
        val mutation = CreateWorkoutMutation(operationId(), programId, entityId("workout"), input)
        enqueue(mutation)
        view(loadBase()).programs.flatMap { it.workouts }.first { it.id == mutation.workoutId }
    }

    override suspend fun updateWorkout(id: String, input: WorkoutInput): WorkoutDto = mutex.withLock {
        if (persistence == null) return@withLock remote.updateWorkout(id, input)
        enqueue(UpdateWorkoutMutation(operationId(), id, input))
        view(loadBase()).programs.flatMap { it.workouts }.firstOrNull { it.id == id }
            ?: throw IOException("Workout is not available offline.")
    }

    override suspend fun deleteWorkout(id: String) = mutex.withLock {
        if (persistence == null) return@withLock remote.deleteWorkout(id)
        if (!discardUnsyncedCreate { it is CreateWorkoutMutation && it.workoutId == id }) {
            enqueue(DeleteWorkoutMutation(operationId(), id))
        }
    }

    override suspend fun createProgramExercise(
        workoutId: String,
        input: ProgramExerciseInput,
    ): ProgramExerciseDto = mutex.withLock {
        if (persistence == null) return@withLock remote.createProgramExercise(workoutId, input)
        val mutation = CreateProgramExerciseMutation(
            operationId(),
            workoutId,
            entityId("program_exercise"),
            input,
        )
        enqueue(mutation)
        view(loadBase()).programs.asSequence()
            .flatMap { it.workouts.asSequence() }
            .flatMap { it.exercises.asSequence() }
            .first { it.id == mutation.programExerciseId }
    }

    override suspend fun updateProgramExercise(
        id: String,
        input: ProgramExerciseInput,
    ): ProgramExerciseDto = mutex.withLock {
        if (persistence == null) return@withLock remote.updateProgramExercise(id, input)
        enqueue(UpdateProgramExerciseMutation(operationId(), id, input))
        view(loadBase()).programs.asSequence()
            .flatMap { it.workouts.asSequence() }
            .flatMap { it.exercises.asSequence() }
            .firstOrNull { it.id == id }
            ?: throw IOException("Program exercise is not available offline.")
    }

    override suspend fun deleteProgramExercise(id: String) = mutex.withLock {
        if (persistence == null) return@withLock remote.deleteProgramExercise(id)
        if (!discardUnsyncedCreate {
                it is CreateProgramExerciseMutation && it.programExerciseId == id
            }
        ) {
            enqueue(DeleteProgramExerciseMutation(operationId(), id))
        }
    }

    override suspend fun listExercises(): List<ExerciseDto> = mutex.withLock {
        val base = refreshCatalogPart { current -> current.copy(exercises = remote.listExercises()) }
        view(base).exercises
    }

    override suspend fun getExercise(id: String): ExerciseDto = mutex.withLock {
        val base = refreshCatalogPart { current ->
            val loaded = remote.getExercise(id)
            current.copy(exercises = current.exercises.filterNot { it.id == id } + loaded)
        }
        view(base).exercises.firstOrNull { it.id == id }
            ?: throw IOException("Exercise is not available offline.")
    }

    override suspend fun createExercise(input: ExerciseInput): ExerciseDto = mutex.withLock {
        if (persistence == null) return@withLock remote.createExercise(input)
        val mutation = CreateExerciseMutation(operationId(), entityId("exercise"), input)
        enqueue(mutation)
        view(loadBase()).exercises.first { it.id == mutation.exerciseId }
    }

    override suspend fun updateExercise(id: String, input: ExerciseInput): ExerciseDto = mutex.withLock {
        if (persistence == null) return@withLock remote.updateExercise(id, input)
        enqueue(UpdateExerciseMutation(operationId(), id, input))
        view(loadBase()).exercises.firstOrNull { it.id == id }
            ?: throw IOException("Exercise is not available offline.")
    }

    override suspend fun deleteExercise(id: String) = mutex.withLock {
        if (persistence == null) return@withLock remote.deleteExercise(id)
        if (!discardUnsyncedCreate { it is CreateExerciseMutation && it.exerciseId == id }) {
            enqueue(DeleteExerciseMutation(operationId(), id))
        }
    }

    suspend fun retryChange(operationId: String): Boolean = controller()?.retry(operationId) ?: false

    suspend fun discardChange(operationId: String): Boolean = controller()?.discard(operationId) ?: false

    private suspend fun refreshCatalogPart(
        remoteLoad: suspend (CatalogSnapshot) -> CatalogSnapshot,
    ): CatalogSnapshot {
        val cached = loadBaseOrNull()
        if (persistence == null || accountKey == null) return remoteLoad(CatalogSnapshot())
        if (!networkStatus.isConnected()) {
            return cached ?: throw IOException("No network connection and no cached catalog data.")
        }
        val loaded = runCatching { remoteLoad(cached ?: CatalogSnapshot()) }
            .getOrElse { error -> return cached ?: throw error }
        saveBase(loaded)
        return loaded
    }

    private suspend fun loadBase(): CatalogSnapshot = loadBaseOrNull() ?: CatalogSnapshot()

    private suspend fun loadBaseOrNull(): CatalogSnapshot? {
        val store = persistence ?: return null
        val key = accountKey ?: return null
        return store.readCache(catalogCacheKey(key))?.let { payload ->
            runCatching { offlineJson.decodeFromString<CatalogSnapshot>(payload) }.getOrNull()
        }
    }

    private suspend fun saveBase(snapshot: CatalogSnapshot) {
        val store = persistence ?: return
        val key = accountKey ?: return
        store.saveCache(
            key,
            OFFLINE_DOMAIN_CATALOG,
            catalogCacheKey(key),
            offlineJson.encodeToString(snapshot),
        )
    }

    private suspend fun view(base: CatalogSnapshot): CatalogSnapshot {
        val store = persistence ?: return base
        val key = accountKey ?: return base
        return applyCatalogMutations(base, store.operations(key).map { it.mutation })
    }

    private suspend fun enqueue(mutation: OfflineMutation) {
        val store = persistence
        val key = accountKey
        check(store != null && key != null) { "Offline persistence is not configured." }
        store.enqueue(key, mutation)
        scheduleSync()
    }

    private suspend fun discardUnsyncedCreate(predicate: (OfflineMutation) -> Boolean): Boolean {
        val store = persistence ?: return false
        val key = accountKey ?: return false
        val create = store.operations(key).firstOrNull { predicate(it.mutation) } ?: return false
        return OfflineMutationController(store, scheduleSync).discard(create.mutation.operationId)
    }

    private fun controller(): OfflineMutationController? {
        val store = persistence ?: return null
        return OfflineMutationController(store, scheduleSync)
    }

    private fun entityId(type: String) = "mob_${type}_${uuid()}"
    private fun operationId() = "op_${uuid()}"
    private fun uuid() = UUID.randomUUID().toString().replace("-", "")

    companion object {
        fun remote(baseUrl: String, token: String): ProgramsCatalogRepository =
            OfflineRuntime.programsRepository(baseUrl, token)
                ?: ProgramsCatalogRepository(
                    remote = ProgramsCatalogApi(baseUrl, token),
                    accountKey = null,
                    persistence = null,
                    networkStatus = NetworkStatus { true },
                    scheduleSync = {},
                )

        fun offline(
            remote: ProgramsCatalogRemoteDataSource,
            accountKey: String,
            persistence: OfflinePersistence,
            networkStatus: NetworkStatus,
            scheduleSync: () -> Unit,
        ): ProgramsCatalogRepository = ProgramsCatalogRepository(
            remote,
            accountKey,
            persistence,
            networkStatus,
            scheduleSync,
        )
    }
}
