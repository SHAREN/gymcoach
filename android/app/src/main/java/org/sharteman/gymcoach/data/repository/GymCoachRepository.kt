package org.sharteman.gymcoach.data.repository

import android.os.Build
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.sharteman.gymcoach.data.local.BootstrapCacheEntity
import org.sharteman.gymcoach.data.local.GymCoachDao
import org.sharteman.gymcoach.data.local.LocalSessionEntity
import org.sharteman.gymcoach.data.local.LocalSetEntity
import org.sharteman.gymcoach.data.local.ProgressCacheEntity
import org.sharteman.gymcoach.data.local.SyncOutboxEntity
import org.sharteman.gymcoach.data.model.BootstrapResponse
import org.sharteman.gymcoach.data.model.DeleteSetOperation
import org.sharteman.gymcoach.data.model.DeleteSessionOperation
import org.sharteman.gymcoach.data.model.FinishSessionOperation
import org.sharteman.gymcoach.data.model.LoginRequest
import org.sharteman.gymcoach.data.model.MobileSessionPayload
import org.sharteman.gymcoach.data.model.MobileSetPayload
import org.sharteman.gymcoach.data.model.MobileProgressSnapshot
import org.sharteman.gymcoach.data.model.ReadinessCheckinRequest
import org.sharteman.gymcoach.data.model.StartSessionOperation
import org.sharteman.gymcoach.data.model.SyncBatchRequest
import org.sharteman.gymcoach.data.model.SyncOperation
import org.sharteman.gymcoach.data.model.UpdateTargetSetsOperation
import org.sharteman.gymcoach.data.model.UpsertSetOperation
import org.sharteman.gymcoach.data.model.WorkoutDto
import org.sharteman.gymcoach.data.network.MobileApi
import org.sharteman.gymcoach.data.offline.OfflineRuntime
import org.sharteman.gymcoach.data.network.ApiException
import org.sharteman.gymcoach.data.security.AccountStore
import org.sharteman.gymcoach.data.security.normalizeServerUrl
import java.time.Duration
import java.time.Instant
import java.io.IOException
import java.util.UUID

class GymCoachRepository(
    private val dao: GymCoachDao,
    private val accountStore: AccountStore,
    private val api: MobileApi,
    private val scheduleSyncNow: () -> Unit,
    private val schedulePeriodicSync: () -> Unit,
) {
    private val syncMutex = Mutex()
    val bootstrap: Flow<BootstrapResponse?> = dao.observeBootstrap().map { cached ->
        cached?.let { runCatching { api.json.decodeFromString<BootstrapResponse>(it.payloadJson) }.getOrNull() }
    }
    val progress: Flow<MobileProgressSnapshot?> = dao.observeProgress().map { cached ->
        cached?.let { runCatching { api.json.decodeFromString<MobileProgressSnapshot>(it.payloadJson) }.getOrNull() }
    }
    val openSessions: Flow<List<LocalSessionEntity>> = dao.observeOpenSessions()
    val pendingCount: Flow<Int> = dao.observePendingCount()
    val syncIssue: Flow<SyncIssue?> = dao.observeBlockedOperation().map { operation ->
        operation?.let {
            val kind = syncIssueKind(it.lastError)
            SyncIssue(
                operationId = it.operationId,
                message = it.lastError ?: "Server rejected a queued change.",
                kind = kind,
                canRetry = true,
            )
        }
    }

    val isLoggedIn: Boolean get() = accountStore.getAccessToken() != null
    val serverUrl: String get() = accountStore.serverUrl
    val email: String? get() = accountStore.userEmail

    suspend fun login(email: String, password: String, serverUrl: String) = syncMutex.withLock {
        val candidateServerUrl = normalizeServerUrl(serverUrl)
        val response = api.login(
            candidateServerUrl,
            LoginRequest(
                email = email.trim(),
                password = password,
                deviceId = accountStore.deviceId,
                deviceName = "${Build.MANUFACTURER} ${Build.MODEL}".trim()
                    .ifBlank { "Android device" },
            ),
        )
        val initialBootstrap = try {
            api.bootstrap(candidateServerUrl, response.accessToken)
        } catch (error: CancellationException) {
            throw error
        } catch (error: Throwable) {
            throw LoginInitializationException(error)
        }
        val previousIdentity = accountStore.userId ?: accountStore.userEmail
        val accountChanged = previousIdentity != null &&
            (previousIdentity != response.user.id && previousIdentity != response.user.email ||
                accountStore.serverUrl != candidateServerUrl)
        if (accountChanged) {
            dao.clearAccountData()
            OfflineRuntime.clearCurrentAccountData()
        }
        accountStore.serverUrl = candidateServerUrl
        accountStore.setAccessToken(response.accessToken)
        accountStore.userId = response.user.id
        accountStore.userEmail = response.user.email
        persistBootstrap(initialBootstrap)
        runCatching { refreshProgress() }
        schedulePeriodicSync()
    }

    suspend fun logout() = syncMutex.withLock {
        check(dao.queuedOperations().isEmpty()) { "Sync pending changes before signing out." }
        check(!OfflineRuntime.hasPendingChanges()) { "Sync pending offline changes before signing out." }
        val token = accountStore.getAccessToken()
        if (token != null) runCatching { api.logout(accountStore.serverUrl, token) }
        OfflineRuntime.clearCurrentAccountData()
        accountStore.clearAccount()
        dao.clearAccountData()
    }

    suspend fun retryBlockedChange() = syncMutex.withLock {
        val blocked = dao.queuedOperations().firstOrNull { it.status == "BLOCKED" } ?: return@withLock
        dao.retryOperation(blocked.operationId, System.currentTimeMillis())
        scheduleSyncNow()
    }

    suspend fun discardBlockedChange() = syncMutex.withLock {
        val queue = dao.queuedOperations()
        val blocked = queue.firstOrNull { it.status == "BLOCKED" } ?: return@withLock
        val operation = runCatching {
            api.json.decodeFromString<SyncOperation>(blocked.payloadJson)
        }.getOrNull()
        val sessionId = when (operation) {
            is StartSessionOperation -> operation.session.id
            is UpsertSetOperation -> operation.set.sessionId
            is FinishSessionOperation -> operation.sessionId
            is DeleteSessionOperation -> operation.sessionId
            is DeleteSetOperation -> dao.getSet(operation.setId)?.sessionId
                ?: queue.asSequence()
                    .mapNotNull { entry ->
                        runCatching { api.json.decodeFromString<SyncOperation>(entry.payloadJson) }.getOrNull()
                    }
                    .filterIsInstance<UpsertSetOperation>()
                    .firstOrNull { it.set.id == operation.setId }
                    ?.set
                    ?.sessionId
            is UpdateTargetSetsOperation -> null
            null -> null
        }
        if (operation is UpdateTargetSetsOperation) {
            val cached = dao.getBootstrap()
            val decoded = cached?.let {
                runCatching { api.json.decodeFromString<BootstrapResponse>(it.payloadJson) }.getOrNull()
            }
            if (cached != null && decoded != null) {
                var reverted = updateProgramExerciseTargetSets(
                    decoded,
                    operation.programExerciseId,
                    operation.previousTargetSets,
                )
                queue.asSequence()
                    .filter { it.sequence > blocked.sequence && it.operationId != blocked.operationId }
                    .mapNotNull { entry ->
                        runCatching { api.json.decodeFromString<SyncOperation>(entry.payloadJson) }
                            .getOrNull() as? UpdateTargetSetsOperation
                    }
                    .filter { it.programExerciseId == operation.programExerciseId }
                    .forEach { queued ->
                        reverted = updateProgramExerciseTargetSets(
                            reverted,
                            queued.programExerciseId,
                            queued.targetSets,
                        )
                    }
                dao.saveBootstrapAndRemoveOperations(
                    cached.copy(
                        payloadJson = api.json.encodeToString(reverted),
                        updatedAtEpochMs = System.currentTimeMillis(),
                    ),
                    listOf(blocked.operationId),
                )
            } else {
                dao.removeOperations(listOf(blocked.operationId))
            }
            runCatching { refreshBootstrap() }
            scheduleSyncNow()
            return@withLock
        }
        val discardWholeSession = operation is StartSessionOperation ||
            syncIssueKind(blocked.lastError) == SyncIssueKind.SESSION_NOT_FOUND
        if (discardWholeSession && sessionId != null) {
            val localSetIds = dao.getAllSets(sessionId).mapTo(mutableSetOf()) { it.id }
            val relatedOperationIds = queue.mapNotNull { entry ->
                val queued = runCatching {
                    api.json.decodeFromString<SyncOperation>(entry.payloadJson)
                }.getOrNull()
                val related = when (queued) {
                    is StartSessionOperation -> queued.session.id == sessionId
                    is UpsertSetOperation -> queued.set.sessionId == sessionId
                    is FinishSessionOperation -> queued.sessionId == sessionId
                    is DeleteSessionOperation -> queued.sessionId == sessionId
                    is DeleteSetOperation -> queued.setId in localSetIds
                    is UpdateTargetSetsOperation -> false
                    null -> entry.operationId == blocked.operationId
                }
                entry.operationId.takeIf { related }
            }
            dao.discardSessionChanges(sessionId, relatedOperationIds)
        } else {
            dao.removeOperations(listOf(blocked.operationId))
        }
        runCatching { refreshBootstrap() }
        scheduleSyncNow()
    }

    suspend fun refreshBootstrap(): BootstrapResponse {
        val token = requireNotNull(accountStore.getAccessToken()) { "Not signed in" }
        val response = api.bootstrap(accountStore.serverUrl, token)
        return persistBootstrap(response)
    }

    suspend fun refreshProgress(): MobileProgressSnapshot {
        val token = requireNotNull(accountStore.getAccessToken()) { "Not signed in" }
        val response = api.progress(accountStore.serverUrl, token)
        dao.saveProgress(
            ProgressCacheEntity(
                payloadJson = api.json.encodeToString(response),
                updatedAtEpochMs = System.currentTimeMillis(),
            ),
        )
        return response
    }

    suspend fun saveReadiness(readiness: Int, sleepQuality: Int, note: String?) {
        require(readiness in 1..5) { "Readiness must be between 1 and 5." }
        require(sleepQuality in 1..5) { "Sleep quality must be between 1 and 5." }
        val trimmedNote = note?.trim()?.takeIf { it.isNotEmpty() }
        require(trimmedNote == null || trimmedNote.length <= 500) {
            "Readiness note must not exceed 500 characters."
        }
        val token = requireNotNull(accountStore.getAccessToken()) { "Not signed in" }
        api.saveReadiness(
            accountStore.serverUrl,
            token,
            ReadinessCheckinRequest(readiness, sleepQuality, trimmedNote),
        )
        runCatching { refreshBootstrap() }
    }

    private suspend fun persistBootstrap(response: BootstrapResponse): BootstrapResponse {
        val pendingTargetUpdates = dao.queuedOperations().mapNotNull { entry ->
            runCatching { api.json.decodeFromString<SyncOperation>(entry.payloadJson) }
                .getOrNull() as? UpdateTargetSetsOperation
        }
        val effective = pendingTargetUpdates.fold(response) { current, operation ->
            updateProgramExerciseTargetSets(current, operation.programExerciseId, operation.targetSets)
        }
        dao.saveBootstrap(
            BootstrapCacheEntity(
                payloadJson = api.json.encodeToString(effective),
                updatedAtEpochMs = System.currentTimeMillis(),
            ),
        )
        importOpenSessions(effective)
        return effective
    }

    suspend fun createWebSessionCookies(): List<String> {
        val token = requireNotNull(accountStore.getAccessToken()) { "Not signed in" }
        return api.createWebSession(accountStore.serverUrl, token)
    }

    suspend fun startWorkout(workout: WorkoutDto, gymId: String?): String {
        dao.findOpenSessionForWorkout(workout.id)?.let { return it.id }
        val now = Instant.now().toString()
        val session = LocalSessionEntity(
            id = entityId("session"),
            workoutId = workout.id,
            gymId = gymId,
            startedAt = now,
        )
        val operation = StartSessionOperation(
            operationId = operationId(),
            session = MobileSessionPayload(
                id = session.id,
                workoutId = session.workoutId,
                gymId = session.gymId,
                startedAt = session.startedAt,
            ),
        )
        dao.saveSessionAndOperation(session, outbox(operation))
        scheduleSyncNow()
        return session.id
    }

    fun observeSession(sessionId: String): Flow<LocalSessionEntity?> = dao.observeSession(sessionId)
    fun observeSets(sessionId: String): Flow<List<LocalSetEntity>> = dao.observeSets(sessionId)

    suspend fun updateTargetSets(programExerciseId: String, targetSets: Int) {
        require(targetSets in 1..20) { "Target sets must be between 1 and 20." }
        val cached = requireNotNull(dao.getBootstrap()) { "No cached program is available." }
        val bootstrap = api.json.decodeFromString<BootstrapResponse>(cached.payloadJson)
        val previousTargetSets = requireNotNull(
            findProgramExerciseTargetSets(bootstrap, programExerciseId),
        ) { "Program exercise was not found in the cached program." }
        if (previousTargetSets == targetSets) return
        val updated = updateProgramExerciseTargetSets(bootstrap, programExerciseId, targetSets)
        val operation = UpdateTargetSetsOperation(
            operationId = operationId(),
            programExerciseId = programExerciseId,
            targetSets = targetSets,
            previousTargetSets = previousTargetSets,
        )
        dao.saveBootstrapAndOperation(
            cached.copy(
                payloadJson = api.json.encodeToString(updated),
                updatedAtEpochMs = System.currentTimeMillis(),
            ),
            outbox(operation),
        )
        scheduleSyncNow()
    }

    suspend fun addSet(
        sessionId: String,
        exerciseId: String,
        weight: Double,
        reps: Int,
        rir: Int?,
        notes: String?,
        isWarmup: Boolean = false,
        isDropSet: Boolean = false,
    ): LocalSetEntity {
        require(weight.isFinite() && weight in 0.0..500.0) { "Weight must be between 0 and 500." }
        require(reps in 1..100) { "Repetitions must be between 1 and 100." }
        require(rir == null || rir in 0..5) { "RIR must be between 0 and 5." }
        val now = Instant.now()
        val existing = dao.getSets(sessionId)
        val exerciseSets = existing.filter { it.exerciseId == exerciseId && !it.deleted }
        require(exerciseSets.size < 50) { "A session cannot contain more than 50 sets per exercise." }
        val previous = exerciseSets.maxByOrNull { it.completedAt }
        val recoverySec = previous?.let {
            Duration.between(Instant.parse(it.completedAt), now).seconds.coerceIn(0, 86_400).toInt()
        }
        val set = LocalSetEntity(
            id = entityId("set"),
            sessionId = sessionId,
            exerciseId = exerciseId,
            setNumber = (exerciseSets.maxOfOrNull { it.setNumber } ?: 0) + 1,
            weight = weight,
            reps = reps,
            rir = rir,
            notes = notes?.trim()?.take(500)?.takeIf { it.isNotEmpty() },
            isWarmup = isWarmup,
            isDropSet = isDropSet,
            recoverySec = recoverySec,
            completedAt = now.toString(),
        )
        dao.saveSetAndOperation(set, outbox(upsertOperation(set)))
        scheduleSyncNow()
        return set
    }

    suspend fun updateSet(set: LocalSetEntity, weight: Double, reps: Int, rir: Int?) {
        require(weight.isFinite() && weight in 0.0..500.0) { "Weight must be between 0 and 500." }
        require(reps in 1..100) { "Repetitions must be between 1 and 100." }
        require(rir == null || rir in 0..5) { "RIR must be between 0 and 5." }
        val updated = set.copy(weight = weight, reps = reps, rir = rir, deleted = false)
        dao.saveSetAndOperation(updated, outbox(upsertOperation(updated)))
        scheduleSyncNow()
    }

    suspend fun deleteSet(setId: String) {
        val set = dao.getSet(setId) ?: return
        dao.deleteSetAndOperation(
            setId = setId,
            operation = outbox(DeleteSetOperation(operationId(), set.id)),
        )
        scheduleSyncNow()
    }

    suspend fun finishSession(sessionId: String, notes: String?, sessionRpe: Int?) {
        require(sessionRpe == null || sessionRpe in 1..10) { "Session RPE must be between 1 and 10." }
        val session = dao.getSession(sessionId) ?: return
        val finishedAt = session.finishedAt ?: Instant.now().toString()
        val updated = session.copy(
            finishedAt = finishedAt,
            notes = notes?.trim()?.take(2000)?.takeIf { it.isNotEmpty() },
            sessionRpe = sessionRpe,
        )
        val operation = FinishSessionOperation(
            operationId = operationId(),
            sessionId = sessionId,
            finishedAt = finishedAt,
            notes = updated.notes,
            sessionRpe = sessionRpe,
        )
        dao.saveSessionAndOperation(updated, outbox(operation))
        scheduleSyncNow()
    }

    suspend fun resetSession(sessionId: String) {
        if (dao.getSession(sessionId) == null) return
        val localSetIds = dao.getAllSets(sessionId).mapTo(mutableSetOf()) { it.id }
        val queue = dao.queuedOperations()
        val decodedQueue = queue.map { entry ->
            entry to runCatching {
                api.json.decodeFromString<SyncOperation>(entry.payloadJson)
            }.getOrNull()
        }
        val queuedSetSessions = decodedQueue.mapNotNull { (_, queued) ->
            (queued as? UpsertSetOperation)?.let { it.set.id to it.set.sessionId }
        }.toMap()
        val priorOperationIds = decodedQueue.mapNotNull { (entry, queued) ->
            val related = when (queued) {
                is StartSessionOperation -> queued.session.id == sessionId
                is UpsertSetOperation -> queued.set.sessionId == sessionId
                is FinishSessionOperation -> queued.sessionId == sessionId
                is DeleteSessionOperation -> queued.sessionId == sessionId
                is DeleteSetOperation -> queued.setId in localSetIds ||
                    queuedSetSessions[queued.setId] == sessionId
                is UpdateTargetSetsOperation, null -> false
            }
            entry.operationId.takeIf { related }
        }
        val operation = DeleteSessionOperation(operationId(), sessionId)
        dao.resetSessionAndOperation(sessionId, priorOperationIds, outbox(operation))
        scheduleSyncNow()
    }

    suspend fun syncPending(): Boolean = syncMutex.withLock {
        val token = accountStore.getAccessToken() ?: return true
        dao.recoverInterruptedOperations()
        var allAccepted = true

        while (true) {
            val queue = dao.queuedOperations()
            if (queue.firstOrNull()?.status == "BLOCKED") {
                allAccepted = false
                break
            }
            val pending = queue.takeWhile { it.status != "BLOCKED" }
                .filter { it.status == "PENDING" || it.status == "FAILED" }
                .take(500)
            if (pending.isEmpty()) break

            val decoded = mutableListOf<Pair<SyncOutboxEntity, SyncOperation>>()
            for (entry in pending) {
                val decodedOperation = runCatching {
                    api.json.decodeFromString<SyncOperation>(entry.payloadJson)
                }
                if (decodedOperation.isFailure) {
                    val error = decodedOperation.exceptionOrNull()
                    dao.markOperationBlocked(
                        entry.operationId,
                        "Stored operation cannot be decoded: ${error?.message ?: "invalid payload"}",
                    )
                    allAccepted = false
                    break
                }
                val operation = decodedOperation.getOrThrow()
                decoded += entry to operation
            }
            if (decoded.isEmpty()) break

            val syncAttempt = runCatching {
                api.sync(
                    accountStore.serverUrl,
                    token,
                    SyncBatchRequest(decoded.map { it.second }),
                )
            }
            if (syncAttempt.isFailure) {
                val error = syncAttempt.exceptionOrNull() ?: IOException("Unknown sync failure")
                if (error is ApiException && error.statusCode in setOf(401, 403)) {
                    decoded.forEach { (entry) ->
                        dao.markOperationFailed(entry.operationId, "Mobile authentication expired.")
                    }
                    accountStore.clearAccessToken()
                    throw MobileAuthenticationRequiredException()
                }
                if (error is ApiException && error.statusCode in 400..499 && error.statusCode != 429) {
                    dao.markOperationBlocked(
                        decoded.first().first.operationId,
                        error.message ?: "Server rejected the synchronization batch.",
                    )
                    allAccepted = false
                    break
                }
                decoded.forEach { (entry) ->
                    dao.markOperationFailed(entry.operationId, error.message ?: "Network sync failed")
                }
                throw error
            }
            val response = syncAttempt.getOrThrow()

            val applied = mutableListOf<String>()
            var stopAfterCurrentBatch = decoded.size < pending.size
            for ((index, pair) in decoded.withIndex()) {
                val (entry, operation) = pair
                val result = response.results.getOrNull(index)
                if (result == null || result.operationId != operation.operationId) {
                    dao.markOperationFailed(entry.operationId, "Server returned an incomplete sync response.")
                    allAccepted = false
                    stopAfterCurrentBatch = true
                    break
                }
                when (result.status) {
                    "APPLIED", "DUPLICATE" -> applied += result.operationId
                    "REJECTED" -> {
                        dao.markOperationBlocked(result.operationId, result.error ?: "Rejected")
                        allAccepted = false
                        stopAfterCurrentBatch = true
                        break
                    }
                    else -> {
                        dao.markOperationBlocked(result.operationId, result.error ?: "Unknown sync status")
                        allAccepted = false
                        stopAfterCurrentBatch = true
                        break
                    }
                }
            }
            if (applied.isNotEmpty()) dao.removeOperations(applied)
            if (stopAfterCurrentBatch) break
        }
        runCatching { refreshBootstrap() }
        runCatching { refreshProgress() }
        allAccepted
    }

    private suspend fun importOpenSessions(bootstrap: BootstrapResponse) {
        val protected = pendingMutationTargets(dao.queuedOperations(), api.json)
        if (!protected.complete) return
        val serverSessionIds = bootstrap.openSessions.mapTo(mutableSetOf()) { it.id }
        for (localSession in dao.getOpenSessions()) {
            if (localSession.id !in serverSessionIds && localSession.id !in protected.sessionIds) {
                dao.deleteSessionLocal(localSession.id)
            }
        }
        for (session in bootstrap.openSessions) {
            if (session.id in protected.deletedSessionIds) continue
            val workoutId = session.workoutId ?: continue
            if (session.id !in protected.sessionIds) {
                dao.saveSession(
                    LocalSessionEntity(
                        id = session.id,
                        workoutId = workoutId,
                        gymId = session.gymId,
                        startedAt = session.startedAt,
                        finishedAt = session.finishedAt,
                        notes = session.notes,
                        sessionRpe = session.sessionRpe,
                    ),
                )
            }
            val serverSetIds = session.sets.mapTo(mutableSetOf()) { it.id }
            for (localSet in dao.getAllSets(session.id)) {
                if (localSet.id !in serverSetIds && localSet.id !in protected.setIds) {
                    dao.deleteSetLocal(localSet.id)
                }
            }
            for (set in session.sets) {
                if (set.id in protected.setIds) continue
                dao.saveSet(
                    LocalSetEntity(
                        id = set.id,
                        sessionId = set.sessionId,
                        exerciseId = set.exerciseId,
                        setNumber = set.setNumber,
                        weight = set.weight,
                        reps = set.reps,
                        rir = set.rir,
                        durationSec = set.durationSec,
                        distanceM = set.distanceM,
                        avgHr = set.avgHr,
                        maxHr = set.maxHr,
                        notes = set.notes,
                        isWarmup = set.isWarmup,
                        isDropSet = set.isDropSet,
                        recoverySec = set.recoverySec,
                        completedAt = set.completedAt,
                    ),
                )
            }
        }
    }

    private fun upsertOperation(set: LocalSetEntity) = UpsertSetOperation(
        operationId = operationId(),
        set = MobileSetPayload(
            id = set.id,
            sessionId = set.sessionId,
            exerciseId = set.exerciseId,
            setNumber = set.setNumber,
            weight = set.weight,
            reps = set.reps,
            rir = set.rir,
            durationSec = set.durationSec,
            distanceM = set.distanceM,
            avgHr = set.avgHr,
            maxHr = set.maxHr,
            notes = set.notes,
            isWarmup = set.isWarmup,
            isDropSet = set.isDropSet,
            recoverySec = set.recoverySec,
            completedAt = set.completedAt,
        ),
    )

    private fun outbox(operation: SyncOperation) = SyncOutboxEntity(
        operationId = operation.operationId,
        type = operation::class.simpleName.orEmpty(),
        payloadJson = api.json.encodeToString<SyncOperation>(operation),
    )

    private fun entityId(type: String) = "mob_${type}_${UUID.randomUUID().toString().replace("-", "")}"
    private fun operationId() = "op_${UUID.randomUUID().toString().replace("-", "")}"
}

internal data class PendingMutationTargets(
    val sessionIds: Set<String>,
    val setIds: Set<String>,
    val deletedSessionIds: Set<String>,
    val complete: Boolean,
)

internal fun pendingMutationTargets(
    entries: List<SyncOutboxEntity>,
    json: Json,
): PendingMutationTargets {
    val sessionIds = mutableSetOf<String>()
    val setIds = mutableSetOf<String>()
    val deletedSessionIds = mutableSetOf<String>()
    for (entry in entries) {
        val operation = runCatching { json.decodeFromString<SyncOperation>(entry.payloadJson) }
            .getOrElse {
                return PendingMutationTargets(
                    sessionIds,
                    setIds,
                    deletedSessionIds,
                    complete = false,
                )
            }
        when (operation) {
            is StartSessionOperation -> sessionIds += operation.session.id
            is FinishSessionOperation -> sessionIds += operation.sessionId
            is UpsertSetOperation -> {
                sessionIds += operation.set.sessionId
                setIds += operation.set.id
            }
            is DeleteSetOperation -> setIds += operation.setId
            is DeleteSessionOperation -> {
                sessionIds += operation.sessionId
                deletedSessionIds += operation.sessionId
            }
            is UpdateTargetSetsOperation -> Unit
        }
    }
    return PendingMutationTargets(sessionIds, setIds, deletedSessionIds, complete = true)
}

internal fun findProgramExerciseTargetSets(
    bootstrap: BootstrapResponse,
    programExerciseId: String,
): Int? = bootstrap.activeProgram?.workouts
    ?.asSequence()
    ?.flatMap { it.exercises.asSequence() }
    ?.firstOrNull { it.id == programExerciseId }
    ?.targetSets
    ?: bootstrap.openSessions.asSequence()
        .mapNotNull { it.workout }
        .flatMap { it.exercises.asSequence() }
        .firstOrNull { it.id == programExerciseId }
        ?.targetSets

internal fun updateProgramExerciseTargetSets(
    bootstrap: BootstrapResponse,
    programExerciseId: String,
    targetSets: Int,
): BootstrapResponse {
    fun updateWorkout(workout: WorkoutDto): WorkoutDto = workout.copy(
        exercises = workout.exercises.map { exercise ->
            if (exercise.id == programExerciseId) exercise.copy(targetSets = targetSets) else exercise
        },
    )
    return bootstrap.copy(
        activeProgram = bootstrap.activeProgram?.let { program ->
            program.copy(workouts = program.workouts.map(::updateWorkout))
        },
        openSessions = bootstrap.openSessions.map { session ->
            session.copy(workout = session.workout?.let(::updateWorkout))
        },
    )
}

class MobileAuthenticationRequiredException : IOException("Sign in again to synchronize local data.")

class LoginInitializationException(cause: Throwable) : IOException(
    "Credentials were accepted, but the initial data load failed.",
    cause,
)

data class SyncIssue(
    val operationId: String,
    val message: String,
    val kind: SyncIssueKind = SyncIssueKind.GENERIC,
    val canRetry: Boolean = true,
)

enum class SyncIssueKind {
    SESSION_NOT_FOUND,
    GENERIC,
}

internal fun syncIssueKind(message: String?): SyncIssueKind = when {
    message?.trim()?.removeSuffix(".")?.equals("Session not found", ignoreCase = true) == true -> {
        SyncIssueKind.SESSION_NOT_FOUND
    }
    else -> SyncIssueKind.GENERIC
}
