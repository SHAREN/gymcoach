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
import org.sharteman.gymcoach.data.model.ExerciseHistorySessionDto
import org.sharteman.gymcoach.data.model.ExerciseHistorySetDto
import org.sharteman.gymcoach.data.model.FinishSessionOperation
import org.sharteman.gymcoach.data.model.LoginRequest
import org.sharteman.gymcoach.data.model.LoginResponse
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
import org.sharteman.gymcoach.data.network.ServerEndpointResolver
import org.sharteman.gymcoach.data.offline.OfflineRuntime
import org.sharteman.gymcoach.data.network.ApiException
import org.sharteman.gymcoach.data.security.AccountStore
import org.sharteman.gymcoach.data.security.normalizeOptionalServerUrl
import org.sharteman.gymcoach.data.security.normalizeServerUrl
import org.sharteman.gymcoach.watch.sync.NoOpWatchPhoneCommandPublisher
import org.sharteman.gymcoach.watch.sync.WatchPhoneCommandPublisher
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
    private val watchCommandPublisher: WatchPhoneCommandPublisher = NoOpWatchPhoneCommandPublisher,
) {
    private val syncMutex = Mutex()
    private val bootstrapCacheMutex = Mutex()
    private val progressRefreshMutex = Mutex()
    private val watchCommandMutex = Mutex()
    private val endpointResolver = ServerEndpointResolver(accountStore)
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
    val primaryServerUrl: String get() = accountStore.primaryServerUrl
    val fallbackServerUrl: String? get() = accountStore.fallbackServerUrl
    val email: String? get() = accountStore.userEmail

    suspend fun login(
        email: String,
        password: String,
        serverUrl: String,
        fallbackServerUrl: String? = accountStore.fallbackServerUrl,
    ) = syncMutex.withLock {
        val candidateServerUrl = normalizeServerUrl(serverUrl)
        val candidateFallbackServerUrl = normalizeOptionalServerUrl(fallbackServerUrl)
            ?.takeUnless { it == candidateServerUrl }
        val previousPrimaryServerUrl = accountStore.primaryServerUrl
        val loginEndpointStore = LoginEndpointStore(
            delegate = accountStore,
            primaryServerUrl = candidateServerUrl,
            fallbackServerUrl = candidateFallbackServerUrl,
        )
        val loginResult = ServerEndpointResolver(loginEndpointStore)
            .execute(forcePrimaryCheck = true) { activeServerUrl ->
                val response = api.login(
                    activeServerUrl,
                    LoginRequest(
                        email = email.trim(),
                        password = password,
                        deviceId = accountStore.deviceId,
                        deviceName = "${Build.MANUFACTURER} ${Build.MODEL}".trim()
                            .ifBlank { "Android device" },
                    ),
                )
                val initialBootstrap = try {
                    api.bootstrap(activeServerUrl, response.accessToken)
                } catch (error: CancellationException) {
                    throw error
                } catch (error: Throwable) {
                    throw LoginInitializationException(error)
                }
                LoginResult(activeServerUrl, response, initialBootstrap)
            }
        val response = loginResult.response
        val previousIdentity = accountStore.userId ?: accountStore.userEmail
        val accountChanged = previousIdentity != null &&
            (previousIdentity != response.user.id && previousIdentity != response.user.email ||
                previousPrimaryServerUrl != candidateServerUrl)
        if (accountChanged) {
            dao.clearAccountData()
            OfflineRuntime.clearCurrentAccountData()
        }
        accountStore.configureServerUrls(candidateServerUrl, candidateFallbackServerUrl)
        endpointResolver.recordSelectedEndpoint(loginResult.activeServerUrl)
        accountStore.setAccessToken(response.accessToken)
        accountStore.userId = response.user.id
        accountStore.userEmail = response.user.email
        persistBootstrap(loginResult.bootstrap)
        runCatching { refreshProgress() }
        schedulePeriodicSync()
    }

    suspend fun configureServerUrls(primaryServerUrl: String, fallbackServerUrl: String?): String {
        accountStore.configureServerUrls(primaryServerUrl, fallbackServerUrl)
        return endpointResolver.resolve(forcePrimaryCheck = true)
    }

    suspend fun logout() = syncMutex.withLock {
        check(dao.queuedOperations().isEmpty()) { "Sync pending changes before signing out." }
        check(!OfflineRuntime.hasPendingChanges()) { "Sync pending offline changes before signing out." }
        val token = accountStore.getAccessToken()
        if (token != null) runCatching {
            endpointResolver.execute { baseUrl -> api.logout(baseUrl, token) }
        }
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
            bootstrapCacheMutex.withLock {
                val bootstrap = cachedBootstrapWithoutHistorySession(sessionId)
                dao.discardSessionChanges(sessionId, relatedOperationIds, bootstrap)
            }
        } else {
            dao.removeOperations(listOf(blocked.operationId))
        }
        runCatching { refreshBootstrap() }
        scheduleSyncNow()
    }

    suspend fun refreshBootstrap(): BootstrapResponse {
        val token = requireNotNull(accountStore.getAccessToken()) { "Not signed in" }
        val response = endpointResolver.execute { baseUrl -> api.bootstrap(baseUrl, token) }
        return persistBootstrap(response)
    }

    suspend fun refreshProgress(exerciseId: String? = null): MobileProgressSnapshot =
        progressRefreshMutex.withLock {
            val token = requireNotNull(accountStore.getAccessToken()) { "Not signed in" }
            val response = endpointResolver.execute { baseUrl -> api.progress(baseUrl, token, exerciseId) }
            dao.saveProgress(
                ProgressCacheEntity(
                    payloadJson = api.json.encodeToString(response),
                    updatedAtEpochMs = System.currentTimeMillis(),
                ),
            )
            response
        }

    suspend fun saveReadiness(readiness: Int, sleepQuality: Int, note: String?) {
        require(readiness in 1..5) { "Readiness must be between 1 and 5." }
        require(sleepQuality in 1..5) { "Sleep quality must be between 1 and 5." }
        val trimmedNote = note?.trim()?.takeIf { it.isNotEmpty() }
        require(trimmedNote == null || trimmedNote.length <= 500) {
            "Readiness note must not exceed 500 characters."
        }
        val token = requireNotNull(accountStore.getAccessToken()) { "Not signed in" }
        endpointResolver.execute { baseUrl ->
            api.saveReadiness(
                baseUrl,
                token,
                ReadinessCheckinRequest(readiness, sleepQuality, trimmedNote),
            )
        }
        runCatching { refreshBootstrap() }
    }

    private suspend fun persistBootstrap(response: BootstrapResponse): BootstrapResponse =
        bootstrapCacheMutex.withLock {
            val queuedOperations = dao.queuedOperations()
            val pendingTargetUpdates = queuedOperations.mapNotNull { entry ->
                runCatching { api.json.decodeFromString<SyncOperation>(entry.payloadJson) }
                    .getOrNull() as? UpdateTargetSetsOperation
            }
            val targets = pendingMutationTargets(queuedOperations, api.json)
            val pendingFinishedSessions = if (targets.complete) {
                targets.sessionIds.mapNotNull { sessionId ->
                    dao.getSession(sessionId)
                        ?.takeIf { it.finishedAt != null }
                        ?.let { session -> session to dao.getAllSets(session.id) }
                }
            } else {
                emptyList()
            }
            val historyMerged = mergeLocalExerciseHistory(
                bootstrap = response,
                sessions = pendingFinishedSessions,
                deletedSessionIds = targets.deletedSessionIds,
            )
            val effective = pendingTargetUpdates.fold(historyMerged) { current, operation ->
                updateProgramExerciseTargetSets(current, operation.programExerciseId, operation.targetSets)
            }
            dao.saveBootstrap(
                BootstrapCacheEntity(
                    payloadJson = api.json.encodeToString(effective),
                    updatedAtEpochMs = System.currentTimeMillis(),
                ),
            )
            importOpenSessions(effective)
            effective
        }

    suspend fun createWebSessionCookies(): List<String> {
        return prepareWebSession().cookies
    }

    suspend fun prepareWebSession(): WebSession {
        val token = requireNotNull(accountStore.getAccessToken()) { "Not signed in" }
        return endpointResolver.execute(forcePrimaryCheck = true) { baseUrl ->
            WebSession(baseUrl, api.createWebSession(baseUrl, token))
        }
    }

    suspend fun startWorkout(workout: WorkoutDto, gymId: String?): String {
        dao.findOpenSessionForWorkout(workout.id)?.let { existing ->
            if (dao.getActiveWorkoutRuntime(existing.id) == null) {
                val runtime = newActiveRuntime(existing, workout, System.currentTimeMillis())
                dao.saveActiveWorkoutRuntime(runtime)
                publishWatchSafely {
                    watchCommandPublisher.workoutStarted(
                        existing.id,
                        runtime.revision,
                        Instant.parse(existing.startedAt).toEpochMilli(),
                    )
                }
            }
            return existing.id
        }
        val nowInstant = Instant.now()
        val now = nowInstant.toString()
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
        dao.saveSessionOperationAndRuntime(
            session = session,
            operation = outbox(operation),
            runtime = newActiveRuntime(session, workout, nowInstant.toEpochMilli()),
        )
        publishWatchSafely {
            watchCommandPublisher.workoutStarted(session.id, 1, nowInstant.toEpochMilli())
        }
        scheduleSyncNow()
        return session.id
    }

    fun observeSession(sessionId: String): Flow<LocalSessionEntity?> = dao.observeSession(sessionId)
    fun observeSets(sessionId: String): Flow<List<LocalSetEntity>> = dao.observeSets(sessionId)
    fun observeActiveWorkoutRuntime(sessionId: String): Flow<ActiveWorkoutRuntimeEntity?> =
        dao.observeActiveWorkoutRuntime(sessionId)

    suspend fun cachedBootstrapSnapshot(): BootstrapResponse? = dao.getBootstrap()?.let { cached ->
        runCatching { api.json.decodeFromString<BootstrapResponse>(cached.payloadJson) }.getOrNull()
    }

    suspend fun localSession(sessionId: String): LocalSessionEntity? = dao.getSession(sessionId)

    suspend fun localSets(sessionId: String): List<LocalSetEntity> = dao.getAllSets(sessionId)

    suspend fun localSet(setId: String): LocalSetEntity? = dao.getSet(setId)

    suspend fun activeWorkoutRuntime(sessionId: String): ActiveWorkoutRuntimeEntity? =
        dao.getActiveWorkoutRuntime(sessionId)

    suspend fun latestActiveWorkoutRuntime(): ActiveWorkoutRuntimeEntity? =
        dao.getLatestActiveWorkoutRuntime()

    suspend fun hasProcessedWatchEvent(eventId: String): Boolean =
        dao.hasProcessedWatchEvent(eventId) > 0

    suspend fun processedWatchEvent(eventId: String): WatchProcessedEventEntity? =
        dao.getProcessedWatchEvent(eventId)

    suspend fun hasWatchSensorBatch(batchId: String, sequence: Int): Boolean =
        dao.hasWatchSensorBatch(batchId, sequence) > 0

    suspend fun saveActiveWorkoutRuntime(runtime: ActiveWorkoutRuntimeEntity) {
        dao.saveActiveWorkoutRuntime(runtime)
    }

    suspend fun updateActiveExercise(
        sessionId: String,
        exerciseId: String,
        updatedBy: String = "PHONE",
        updatedAtEpochMs: Long = System.currentTimeMillis(),
        publishToWatch: Boolean = true,
        preserveRest: Boolean = false,
    ): ActiveWorkoutRuntimeEntity? {
        return watchCommandMutex.withLock {
            val current = dao.getActiveWorkoutRuntime(sessionId) ?: return@withLock null
            if (current.activeExerciseId == exerciseId && current.updatedBy == updatedBy) return@withLock current
            current.copy(
                activeExerciseId = exerciseId,
                activeSetId = if (preserveRest) current.activeSetId else null,
                setStartedAtEpochMs = null,
                setAccumulatedPauseMs = 0,
                restStartedAtEpochMs = if (preserveRest) current.restStartedAtEpochMs else null,
                restEndsAtEpochMs = if (preserveRest) current.restEndsAtEpochMs else null,
                restDurationSeconds = if (preserveRest) current.restDurationSeconds else null,
                restPausedRemainingMs = if (preserveRest) current.restPausedRemainingMs else null,
                revision = current.revision + 1,
                updatedAtEpochMs = updatedAtEpochMs,
                updatedBy = updatedBy,
            ).also { updated ->
                dao.saveActiveWorkoutRuntime(updated)
                if (publishToWatch && updatedBy == "PHONE") {
                    publishWatchSafely {
                        watchCommandPublisher.activeExerciseChanged(
                            sessionId,
                            exerciseId,
                            updated.revision,
                            updatedAtEpochMs,
                        )
                    }
                }
            }
        }
    }

    suspend fun applyWatchRuntimeEvent(
        processed: WatchProcessedEventEntity,
        runtime: ActiveWorkoutRuntimeEntity,
    ): Boolean = dao.applyWatchRuntimeEvent(processed, runtime)

    suspend fun applyWatchSetEvent(
        processed: WatchProcessedEventEntity,
        set: LocalSetEntity,
        runtime: ActiveWorkoutRuntimeEntity,
    ): Boolean {
        val applied = dao.applyWatchSetEvent(processed, set, outbox(upsertOperation(set)), runtime)
        if (applied) scheduleSyncNow()
        return applied
    }

    suspend fun applyWatchDeleteSetEvent(
        processed: WatchProcessedEventEntity,
        setId: String,
        runtime: ActiveWorkoutRuntimeEntity,
    ): Boolean {
        val applied = dao.applyWatchDeleteSetEvent(
            processed = processed,
            setId = setId,
            operation = outbox(DeleteSetOperation(operationId(), setId)),
            runtime = runtime,
        )
        if (applied) scheduleSyncNow()
        return applied
    }

    suspend fun applyWatchSensorBatch(
        processed: WatchProcessedEventEntity,
        batch: WatchSensorBatchEntity,
        samples: List<WatchSensorSampleEntity>,
        runtime: ActiveWorkoutRuntimeEntity,
    ): Boolean = dao.applyWatchSensorBatch(processed, batch, samples, runtime)

    suspend fun applyWatchRestEvent(
        processed: WatchProcessedEventEntity,
        runtime: ActiveWorkoutRuntimeEntity,
        summary: RestRecoverySummaryEntity?,
    ): Boolean = dao.applyWatchRestEvent(processed, runtime, summary)

    suspend fun watchSensorSamplesForSet(
        sessionId: String,
        setId: String,
        phase: String,
    ): List<WatchSensorSampleEntity> = dao.getWatchSensorSamplesForSet(sessionId, setId, phase)

    suspend fun watchSensorSamplesForInterval(
        sessionId: String,
        setId: String,
        phase: String,
        startedAtEpochMs: Long,
        endedAtEpochMs: Long,
    ): List<WatchSensorSampleEntity> = dao.getWatchSensorSamplesForInterval(
        sessionId,
        setId,
        phase,
        startedAtEpochMs,
        endedAtEpochMs,
    )

    suspend fun restRecoverySummaries(sessionId: String): List<RestRecoverySummaryEntity> =
        dao.getRestRecoverySummaries(sessionId)

    suspend fun updateSetHeartRateSummary(
        setId: String,
        minHr: Int?,
        maxHr: Int?,
        avgHr: Int?,
        startHr: Int?,
        endHr: Int?,
        sampleCount: Int,
    ): Boolean {
        val existing = dao.getSet(setId) ?: return false
        val updated = existing.copy(
            minHr = minHr,
            maxHr = maxHr,
            avgHr = avgHr,
            startHr = startHr,
            endHr = endHr,
            hrSampleCount = sampleCount,
        )
        if (updated == existing) return true
        dao.saveSetAndOperation(updated, outbox(upsertOperation(updated)))
        scheduleSyncNow()
        return true
    }

    suspend fun saveRestRecoverySummary(summary: RestRecoverySummaryEntity) {
        dao.saveRestRecoverySummary(summary)
    }

    suspend fun queuedSyncOperations(): List<SyncOutboxEntity> = dao.queuedOperations()

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
        watchCommandMutex.withLock {
            advancePhoneRuntime(set.sessionId, now.toEpochMilli()) { current ->
                current.copy(
                    activeExerciseId = set.exerciseId,
                    activeSetId = null,
                    setStartedAtEpochMs = null,
                    setAccumulatedPauseMs = 0,
                )
            }?.let { runtime ->
                publishWatchSafely { watchCommandPublisher.setCompleted(set, runtime.revision) }
            }
        }
        scheduleSyncNow()
        return set
    }

    suspend fun updateSet(set: LocalSetEntity, weight: Double, reps: Int, rir: Int?) {
        require(weight.isFinite() && weight in 0.0..500.0) { "Weight must be between 0 and 500." }
        require(reps in 1..100) { "Repetitions must be between 1 and 100." }
        require(rir == null || rir in 0..5) { "RIR must be between 0 and 5." }
        val updated = set.copy(weight = weight, reps = reps, rir = rir, deleted = false)
        dao.saveSetAndOperation(updated, outbox(upsertOperation(updated)))
        watchCommandMutex.withLock {
            advancePhoneRuntime(set.sessionId, System.currentTimeMillis()) { it }
                ?.let { runtime ->
                    publishWatchSafely { watchCommandPublisher.setUpdated(updated, runtime.revision) }
                }
        }
        scheduleSyncNow()
    }

    suspend fun deleteSet(setId: String) {
        val set = dao.getSet(setId) ?: return
        dao.deleteSetAndOperation(
            setId = setId,
            operation = outbox(DeleteSetOperation(operationId(), set.id)),
        )
        val deletedAt = System.currentTimeMillis()
        watchCommandMutex.withLock {
            val current = dao.getActiveWorkoutRuntime(set.sessionId) ?: return@withLock
            val updated = advancePhoneRuntime(set.sessionId, deletedAt) { runtime ->
                if (runtime.activeSetId == set.id) {
                    runtime.copy(activeSetId = null, setStartedAtEpochMs = null, setAccumulatedPauseMs = 0)
                } else {
                    runtime
                }
            } ?: return@withLock
            publishWatchSafely {
                watchCommandPublisher.setDeleted(
                    set.sessionId,
                    set.id,
                    updated.revision,
                    current.revision,
                    deletedAt,
                )
            }
        }
        scheduleSyncNow()
    }

    suspend fun finishSession(sessionId: String, notes: String?, sessionRpe: Int?) {
        require(sessionRpe == null || sessionRpe in 1..10) { "Session RPE must be between 1 and 10." }
        val session = dao.getSession(sessionId) ?: return
        val watchRuntime = dao.getActiveWorkoutRuntime(sessionId)
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
        bootstrapCacheMutex.withLock {
            val bootstrap = dao.getBootstrap()?.let { cached ->
                runCatching { api.json.decodeFromString<BootstrapResponse>(cached.payloadJson) }
                    .getOrNull()
                    ?.let { current ->
                        mergeLocalExerciseHistory(
                            bootstrap = current,
                            sessions = listOf(updated to dao.getAllSets(sessionId)),
                        )
                    }
                    ?.let { merged ->
                        cached.copy(
                            payloadJson = api.json.encodeToString(merged),
                            updatedAtEpochMs = System.currentTimeMillis(),
                        )
                    }
            }
            dao.saveFinishedSessionOperationAndBootstrap(updated, outbox(operation), bootstrap)
        }
        watchRuntime?.let { runtime ->
            publishWatchSafely {
                watchCommandPublisher.workoutFinished(
                    sessionId,
                    runtime.revision + 1,
                    Instant.parse(finishedAt).toEpochMilli(),
                )
            }
        }
        scheduleSyncNow()
    }

    suspend fun startRest(sessionId: String, setId: String, startedAtEpochMs: Long, endsAtEpochMs: Long) {
        require(endsAtEpochMs >= startedAtEpochMs)
        watchCommandMutex.withLock {
            advancePhoneRuntime(sessionId, startedAtEpochMs) { current ->
                current.copy(
                    activeSetId = setId,
                    restStartedAtEpochMs = startedAtEpochMs,
                    restEndsAtEpochMs = endsAtEpochMs,
                    restDurationSeconds = ((endsAtEpochMs - startedAtEpochMs) / 1_000L).toInt(),
                    restPausedRemainingMs = null,
                )
            }?.let { runtime ->
                publishWatchSafely {
                    watchCommandPublisher.restStarted(
                        sessionId,
                        setId,
                        runtime.revision,
                        startedAtEpochMs,
                        endsAtEpochMs,
                    )
                }
            }
        }
    }

    suspend fun updateRest(sessionId: String, endsAtEpochMs: Long, reason: String) {
        require(reason.isNotBlank())
        val changedAt = System.currentTimeMillis()
        watchCommandMutex.withLock {
            val current = dao.getActiveWorkoutRuntime(sessionId) ?: return@withLock
            require(current.restStartedAtEpochMs != null)
            require(endsAtEpochMs >= current.restStartedAtEpochMs)
            advancePhoneRuntime(sessionId, changedAt) { runtime ->
                runtime.copy(
                    restEndsAtEpochMs = endsAtEpochMs,
                    restDurationSeconds = ((endsAtEpochMs - runtime.restStartedAtEpochMs!!) / 1_000L).toInt(),
                )
            }?.let { runtime ->
                publishWatchSafely {
                    watchCommandPublisher.restUpdated(
                        sessionId,
                        runtime.revision,
                        endsAtEpochMs,
                        reason,
                        changedAt,
                    )
                }
            }
        }
    }

    suspend fun finishRest(sessionId: String, finishedAtEpochMs: Long = System.currentTimeMillis()) {
        watchCommandMutex.withLock {
            val current = dao.getActiveWorkoutRuntime(sessionId) ?: return@withLock
            val startedAt = current.restStartedAtEpochMs ?: return@withLock
            advancePhoneRuntime(sessionId, finishedAtEpochMs) { clearRestRuntime(it) }
                ?.let { runtime ->
                    publishWatchSafely {
                        watchCommandPublisher.restFinished(
                            sessionId,
                            runtime.revision,
                            startedAt,
                            finishedAtEpochMs,
                        )
                    }
                }
        }
    }

    suspend fun skipRest(sessionId: String, skippedAtEpochMs: Long = System.currentTimeMillis()) {
        watchCommandMutex.withLock {
            val current = dao.getActiveWorkoutRuntime(sessionId) ?: return@withLock
            if (current.restStartedAtEpochMs == null) return@withLock
            advancePhoneRuntime(sessionId, skippedAtEpochMs) { clearRestRuntime(it) }
                ?.let { runtime ->
                    publishWatchSafely {
                        watchCommandPublisher.restSkipped(sessionId, runtime.revision, skippedAtEpochMs)
                    }
                }
        }
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
        bootstrapCacheMutex.withLock {
            val bootstrap = cachedBootstrapWithoutHistorySession(sessionId)
            dao.resetSessionAndOperation(sessionId, priorOperationIds, outbox(operation), bootstrap)
        }
        scheduleSyncNow()
    }

    private suspend fun cachedBootstrapWithoutHistorySession(sessionId: String): BootstrapCacheEntity? =
        dao.getBootstrap()?.let { cached ->
            runCatching { api.json.decodeFromString<BootstrapResponse>(cached.payloadJson) }
                .getOrNull()
                ?.let { current ->
                    mergeLocalExerciseHistory(
                        bootstrap = current,
                        sessions = emptyList(),
                        deletedSessionIds = setOf(sessionId),
                    )
                }
                ?.let { merged ->
                    cached.copy(
                        payloadJson = api.json.encodeToString(merged),
                        updatedAtEpochMs = System.currentTimeMillis(),
                    )
                }
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
                endpointResolver.execute { baseUrl ->
                    api.sync(
                        baseUrl,
                        token,
                        SyncBatchRequest(decoded.map { it.second }),
                    )
                }
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
                val existing = dao.getSet(set.id)
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
                        minHr = existing?.minHr,
                        startHr = existing?.startHr,
                        endHr = existing?.endHr,
                        hrSampleCount = existing?.hrSampleCount,
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

    private suspend fun advancePhoneRuntime(
        sessionId: String,
        updatedAtEpochMs: Long,
        transform: (ActiveWorkoutRuntimeEntity) -> ActiveWorkoutRuntimeEntity,
    ): ActiveWorkoutRuntimeEntity? {
        val current = dao.getActiveWorkoutRuntime(sessionId) ?: return null
        val updated = transform(current).copy(
            revision = current.revision + 1,
            updatedAtEpochMs = updatedAtEpochMs,
            updatedBy = "PHONE",
        )
        dao.saveActiveWorkoutRuntime(updated)
        return updated
    }

    private suspend fun publishWatchSafely(block: suspend () -> Unit) {
        try {
            block()
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            // The phone mutation and server outbox are authoritative. A watch
            // transport or mapping failure must never make the user repeat it.
        }
    }

    private fun clearRestRuntime(runtime: ActiveWorkoutRuntimeEntity) = runtime.copy(
        activeSetId = null,
        restStartedAtEpochMs = null,
        restEndsAtEpochMs = null,
        restDurationSeconds = null,
        restPausedRemainingMs = null,
    )

    private fun newActiveRuntime(
        session: LocalSessionEntity,
        workout: WorkoutDto,
        updatedAtEpochMs: Long,
    ) = ActiveWorkoutRuntimeEntity(
        sessionId = session.id,
        workoutId = workout.id,
        activeExerciseId = workout.exercises.minByOrNull { it.order }?.exerciseId,
        revision = 1,
        updatedAtEpochMs = updatedAtEpochMs,
        updatedBy = "PHONE",
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

data class WebSession(val baseUrl: String, val cookies: List<String>)

private data class LoginResult(
    val activeServerUrl: String,
    val response: LoginResponse,
    val bootstrap: BootstrapResponse,
)

private class LoginEndpointStore(
    delegate: AccountStore,
    override val primaryServerUrl: String,
    override var fallbackServerUrl: String?,
) : AccountStore by delegate {
    override var serverUrl: String = primaryServerUrl

    override fun activateServerUrl(serverUrl: String) {
        this.serverUrl = serverUrl
    }

    override fun configureServerUrls(primaryServerUrl: String, fallbackServerUrl: String?) = Unit
}

internal fun mergeLocalExerciseHistory(
    bootstrap: BootstrapResponse,
    sessions: List<Pair<LocalSessionEntity, List<LocalSetEntity>>>,
    deletedSessionIds: Set<String> = emptySet(),
): BootstrapResponse {
    val localByExercise = mutableMapOf<String, MutableList<ExerciseHistorySessionDto>>()
    for ((session, sets) in sessions) {
        if (session.finishedAt == null || session.id in deletedSessionIds) continue
        sets.asSequence()
            .filterNot { it.deleted || it.isWarmup }
            .groupBy { it.exerciseId }
            .forEach { (exerciseId, exerciseSets) ->
                localByExercise.getOrPut(exerciseId, ::mutableListOf) += ExerciseHistorySessionDto(
                    sessionId = session.id,
                    startedAt = session.startedAt,
                    localOnly = true,
                    sets = exerciseSets.sortedWith(compareBy<LocalSetEntity> { it.setNumber }.thenBy { it.completedAt })
                        .map { set ->
                            ExerciseHistorySetDto(
                                setNumber = set.setNumber,
                                weight = set.weight,
                                reps = set.reps,
                                rir = set.rir,
                                isDropSet = set.isDropSet,
                                durationSec = set.durationSec,
                                distanceM = set.distanceM,
                                avgHr = set.avgHr,
                                maxHr = set.maxHr,
                            )
                        },
                )
            }
    }

    val exerciseIds = bootstrap.exerciseHistoryByExerciseId.keys + localByExercise.keys
    val merged = exerciseIds.associateWith { exerciseId ->
        val localSessions = localByExercise[exerciseId].orEmpty()
        val localSessionIds = localSessions.mapTo(mutableSetOf()) { it.sessionId }
        (localSessions + bootstrap.exerciseHistoryByExerciseId[exerciseId].orEmpty().filterNot { history ->
            history.sessionId in localSessionIds || history.sessionId in deletedSessionIds
        })
            .sortedByDescending { it.startedAt }
            .take(12)
    }.filterValues { it.isNotEmpty() }

    return bootstrap.copy(exerciseHistoryByExerciseId = merged)
}

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
