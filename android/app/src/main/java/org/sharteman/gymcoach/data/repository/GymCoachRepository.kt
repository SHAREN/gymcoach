package org.sharteman.gymcoach.data.repository

import android.os.Build
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.launch
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import org.sharteman.gymcoach.data.local.BootstrapCacheEntity
import org.sharteman.gymcoach.data.local.ActiveTargetSetOverrideEntity
import org.sharteman.gymcoach.data.local.ActiveWorkoutRuntimeEntity
import org.sharteman.gymcoach.data.local.GymCoachDao
import org.sharteman.gymcoach.data.local.LocalSessionEntity
import org.sharteman.gymcoach.data.local.LocalSetEntity
import org.sharteman.gymcoach.data.local.ProgressCacheEntity
import org.sharteman.gymcoach.data.local.RestRecoverySummaryEntity
import org.sharteman.gymcoach.data.local.SyncOutboxEntity
import org.sharteman.gymcoach.data.local.WatchProcessedEventEntity
import org.sharteman.gymcoach.data.local.WatchConflictEntity
import org.sharteman.gymcoach.data.local.WatchOutboxEventEntity
import org.sharteman.gymcoach.data.local.WatchResyncMarkerEntity
import org.sharteman.gymcoach.data.local.WatchSensorBatchEntity
import org.sharteman.gymcoach.data.local.WatchSensorSampleEntity
import org.sharteman.gymcoach.data.errors.AppErrorCategory
import org.sharteman.gymcoach.data.errors.AppErrorContext
import org.sharteman.gymcoach.data.errors.AppErrorDataState
import org.sharteman.gymcoach.data.errors.AppErrorOperation
import org.sharteman.gymcoach.data.errors.UserFacingError
import org.sharteman.gymcoach.data.errors.classifyAppError
import org.sharteman.gymcoach.data.model.BootstrapResponse
import org.sharteman.gymcoach.data.model.CoachingProfileDto
import org.sharteman.gymcoach.data.model.DeleteSetOperation
import org.sharteman.gymcoach.data.model.DeleteSessionOperation
import org.sharteman.gymcoach.data.model.ExerciseDto
import org.sharteman.gymcoach.data.model.ExerciseHistorySessionDto
import org.sharteman.gymcoach.data.model.ExerciseHistorySetDto
import org.sharteman.gymcoach.data.model.FinishSessionOperation
import org.sharteman.gymcoach.data.model.GymEquipmentDto
import org.sharteman.gymcoach.data.model.GymExerciseConfigDto
import org.sharteman.gymcoach.data.model.LoginRequest
import org.sharteman.gymcoach.data.model.LoginResponse
import org.sharteman.gymcoach.data.model.MobileFrozenEquipmentLoadSnapshot
import org.sharteman.gymcoach.data.model.MobileFrozenEquipmentSnapshot
import org.sharteman.gymcoach.data.model.MobileFrozenPlateInventoryItemSnapshot
import org.sharteman.gymcoach.data.model.MobileFrozenPlatePoolSnapshot
import org.sharteman.gymcoach.data.model.MobileSessionPayload
import org.sharteman.gymcoach.data.model.MobileSetPayload
import org.sharteman.gymcoach.data.model.MobileProgressSnapshot
import org.sharteman.gymcoach.data.model.MobileWorkoutExerciseMutationDto
import org.sharteman.gymcoach.data.model.MutateWorkoutExercisesOperation
import org.sharteman.gymcoach.data.model.ProgramExerciseDto
import org.sharteman.gymcoach.data.model.ReadinessCheckinRequest
import org.sharteman.gymcoach.data.model.ReplaceProgramExerciseOperation
import org.sharteman.gymcoach.data.model.StartSessionOperation
import org.sharteman.gymcoach.data.model.SyncBatchRequest
import org.sharteman.gymcoach.data.model.SyncBatchResponse
import org.sharteman.gymcoach.data.model.SyncOperation
import org.sharteman.gymcoach.data.model.UpdateTargetSetsOperation
import org.sharteman.gymcoach.data.model.UpdatePreferredEquipmentOperation
import org.sharteman.gymcoach.data.model.UpsertSetOperation
import org.sharteman.gymcoach.data.model.WorkoutDto
import org.sharteman.gymcoach.data.model.mergeCoachingProfilesByTimestamp
import org.sharteman.gymcoach.data.network.MobileApi
import org.sharteman.gymcoach.data.network.ServerEndpointResolver
import org.sharteman.gymcoach.data.offline.OfflineRuntime
import org.sharteman.gymcoach.data.offline.OfflineSyncLock
import org.sharteman.gymcoach.data.offline.CatalogSnapshot
import org.sharteman.gymcoach.data.offline.OFFLINE_DOMAIN_CATALOG
import org.sharteman.gymcoach.data.offline.UpdateExerciseMutation
import org.sharteman.gymcoach.data.offline.accountKey
import org.sharteman.gymcoach.data.offline.catalogCacheKey
import org.sharteman.gymcoach.data.offline.offlineJson
import org.sharteman.gymcoach.data.network.ApiException
import org.sharteman.gymcoach.data.programs.ExerciseInput
import org.sharteman.gymcoach.data.programs.withGeneralMetadata
import org.sharteman.gymcoach.data.security.AccountStore
import org.sharteman.gymcoach.data.security.normalizeOptionalServerUrl
import org.sharteman.gymcoach.data.security.normalizeServerUrl
import org.sharteman.gymcoach.watch.sync.NoOpWatchPhoneCommandPublisher
import org.sharteman.gymcoach.watch.sync.WatchPhoneCommandPublisher
import org.sharteman.gymcoach.watch.data.CanonicalJson
import org.sharteman.gymcoach.watch.domain.WatchEventEnvelopeDto
import org.sharteman.gymcoach.watch.domain.WatchEventSource
import org.sharteman.gymcoach.watch.domain.WatchEventType
import org.sharteman.gymcoach.watch.domain.WatchProtocol
import org.sharteman.gymcoach.training.FrozenEquipmentLoadState
import org.sharteman.gymcoach.training.frozenEquipmentLoadState
import org.sharteman.gymcoach.training.isAchievableLoad
import org.sharteman.gymcoach.training.resolveEquipmentType
import java.time.Duration
import java.time.Instant
import java.io.IOException
import java.util.UUID

data class WatchSetEventApplyResult(
    val applied: Boolean,
    val errorCode: String? = null,
)

class GymCoachRepository(
    private val dao: GymCoachDao,
    private val accountStore: AccountStore,
    private val api: MobileApi,
    private val scheduleSyncNow: () -> Unit,
    private val schedulePeriodicSync: () -> Unit,
    private val watchCommandPublisher: WatchPhoneCommandPublisher = NoOpWatchPhoneCommandPublisher,
    watchCommandScope: CoroutineScope? = null,
) {
    private val syncMutex = Mutex()
    private val bootstrapCacheMutex = Mutex()
    private val progressRefreshMutex = Mutex()
    private val watchCommandMutex = Mutex()
    private val watchCommandQueue = watchCommandScope?.let { scope ->
        Channel<QueuedWatchCommand>(Channel.UNLIMITED).also { queue ->
            scope.launch {
                for (queued in queue) {
                    queued.released.await()
                    publishWatchSafely(queued.command)
                }
            }
        }
    }
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
            val queued = dao.queuedOperations()
            val decodedOperation = decodeSyncOperation(it)
            val sessionId = syncOperationSessionId(decodedOperation, queued)
            val userError = classifyAppError(
                error = null,
                context = AppErrorContext(
                    categoryHint = it.lastErrorCategory?.let { value ->
                        runCatching { AppErrorCategory.valueOf(value) }.getOrNull()
                    },
                    operation = AppErrorOperation.SYNC,
                    dataState = AppErrorDataState.QUEUED_LOCALLY,
                    operationType = it.type,
                    queueItemId = it.operationId,
                    attemptCount = it.attempts,
                    createdAtEpochMs = it.createdAtEpochMs,
                    lastRetryAtEpochMs = it.lastRetryRequestedAtEpochMs,
                    httpStatus = it.lastHttpStatus,
                    correlationId = it.lastCorrelationId,
                    errorCode = it.lastErrorCode,
                    serverResponse = it.lastError,
                    exceptionClass = it.lastExceptionClass,
                    stackTrace = it.lastStackTrace,
                ),
            )
            SyncIssue(
                operationId = it.operationId,
                type = it.type,
                attempts = it.attempts,
                createdAtEpochMs = it.createdAtEpochMs,
                lastRetryAtEpochMs = it.lastRetryRequestedAtEpochMs,
                userError = userError,
                discardScope = if (
                    sessionId != null &&
                    (
                        decodedOperation is StartSessionOperation ||
                            syncIssueKind(it.lastError) == SyncIssueKind.SESSION_NOT_FOUND
                        )
                ) {
                    SyncIssueDiscardScope.SESSION_AND_RELATED_CHANGES
                } else {
                    SyncIssueDiscardScope.SINGLE_OPERATION
                },
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
        accountStore.userId = response.user.id
        accountStore.userEmail = response.user.email
        // Persist the token last. SecureAccountStore commits it synchronously, which also
        // makes the preceding account and endpoint preference updates durable before login returns.
        accountStore.setAccessToken(response.accessToken)
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
        val blockedError = classifyAppError(
            error = null,
            context = AppErrorContext(
                categoryHint = blocked.lastErrorCategory?.let { value ->
                    runCatching { AppErrorCategory.valueOf(value) }.getOrNull()
                },
                operation = AppErrorOperation.SYNC,
                dataState = AppErrorDataState.QUEUED_LOCALLY,
                operationType = blocked.type,
                queueItemId = blocked.operationId,
                attemptCount = blocked.attempts,
                createdAtEpochMs = blocked.createdAtEpochMs,
                lastRetryAtEpochMs = blocked.lastRetryRequestedAtEpochMs,
                httpStatus = blocked.lastHttpStatus,
                correlationId = blocked.lastCorrelationId,
                errorCode = blocked.lastErrorCode,
                serverResponse = blocked.lastError,
                exceptionClass = blocked.lastExceptionClass,
                stackTrace = blocked.lastStackTrace,
            ),
        )
        val operation = runCatching {
            api.json.decodeFromString<SyncOperation>(blocked.payloadJson)
        }.getOrNull()
        if (operation is ReplaceProgramExerciseOperation) {
            val watchCommand = restoreBlockedExerciseReplacement(operation, blocked.operationId)
            dispatchPreparedWatchCommand(watchCommand)
            scheduleSyncSafely()
            return@withLock
        }
        if (operation is MutateWorkoutExercisesOperation) {
            val watchCommand = restoreBlockedWorkoutExerciseMutation(operation, blocked.operationId)
            dispatchPreparedWatchCommand(watchCommand)
            scheduleSyncSafely()
            return@withLock
        }
        if (!blockedError.retryable) return@withLock
        dao.retryOperation(blocked.operationId, System.currentTimeMillis())
        scheduleSyncNow()
    }

    suspend fun discardBlockedChange() = syncMutex.withLock {
        val queue = dao.queuedOperations()
        val blocked = queue.firstOrNull { it.status == "BLOCKED" } ?: return@withLock
        val operation = decodeSyncOperation(blocked)
        val sessionId = syncOperationSessionId(operation, queue)
        if (operation is ReplaceProgramExerciseOperation) {
            val authoritative = refreshBootstrap()
            val watchCommand = reconcileExerciseReplacementWithAuthoritativeBootstrap(
                operation = operation,
                authoritative = authoritative,
                operationIdToRemove = blocked.operationId,
            )
            dispatchPreparedWatchCommand(watchCommand)
            scheduleSyncSafely()
            return@withLock
        }
        if (operation is MutateWorkoutExercisesOperation) {
            val authoritative = refreshBootstrap()
            val watchCommand = reconcileWorkoutExerciseMutationRuntime(
                operation = operation,
                authoritative = authoritative,
                operationIdToRemove = blocked.operationId,
            )
            dispatchPreparedWatchCommand(watchCommand)
            scheduleSyncSafely()
            return@withLock
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
                    is UpdatePreferredEquipmentOperation -> false
                    is MutateWorkoutExercisesOperation -> false
                    is ReplaceProgramExerciseOperation -> false
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

    private fun decodeSyncOperation(entry: SyncOutboxEntity): SyncOperation? = runCatching {
        api.json.decodeFromString<SyncOperation>(entry.payloadJson)
    }.getOrNull()

    private suspend fun syncOperationSessionId(
        operation: SyncOperation?,
        queue: List<SyncOutboxEntity>,
    ): String? = when (operation) {
        is StartSessionOperation -> operation.session.id
        is UpsertSetOperation -> operation.set.sessionId
        is FinishSessionOperation -> operation.sessionId
        is DeleteSessionOperation -> operation.sessionId
        is DeleteSetOperation -> dao.getSet(operation.setId)?.sessionId
            ?: queue.asSequence()
                .mapNotNull(::decodeSyncOperation)
                .filterIsInstance<UpsertSetOperation>()
                .firstOrNull { it.set.id == operation.setId }
                ?.set
                ?.sessionId
        is UpdateTargetSetsOperation,
        is UpdatePreferredEquipmentOperation,
        is MutateWorkoutExercisesOperation,
        is ReplaceProgramExerciseOperation,
        null,
        -> null
    }

    suspend fun refreshBootstrap(): BootstrapResponse {
        val token = requireNotNull(accountStore.getAccessToken()) { "Not signed in" }
        val capturedExerciseProtection = captureExerciseEditProtection()
        val response = endpointResolver.execute { baseUrl -> api.bootstrap(baseUrl, token) }
        return persistBootstrap(response, capturedExerciseProtection)
    }

    suspend fun mergeCoachingProfileIntoBootstrap(profile: CoachingProfileDto) {
        bootstrapCacheMutex.withLock {
            val cachedEntity = dao.getBootstrap() ?: return@withLock
            val cached = runCatching {
                api.json.decodeFromString<BootstrapResponse>(cachedEntity.payloadJson)
            }.getOrNull() ?: return@withLock
            val merged = mergeCoachingProfilesByTimestamp(cached.profile.coachingProfile, profile)
                ?: return@withLock
            if (merged == cached.profile.coachingProfile) return@withLock
            dao.saveBootstrap(
                cachedEntity.copy(
                    payloadJson = api.json.encodeToString(
                        cached.copy(profile = cached.profile.copy(coachingProfile = merged)),
                    ),
                    updatedAtEpochMs = System.currentTimeMillis(),
                ),
            )
        }
    }

    suspend fun cacheExerciseMetadata(exercise: ExerciseDto) {
        bootstrapCacheMutex.withLock {
            val cachedEntity = dao.getBootstrap() ?: return@withLock
            val cached = runCatching {
                api.json.decodeFromString<BootstrapResponse>(cachedEntity.payloadJson)
            }.getOrNull() ?: return@withLock
            val updated = mergeExerciseMetadataIntoBootstrap(cached, exercise)
            if (updated == cached) return@withLock
            dao.saveBootstrap(
                cachedEntity.copy(
                    payloadJson = api.json.encodeToString(updated),
                    updatedAtEpochMs = System.currentTimeMillis(),
                ),
            )
        }
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

    private suspend fun persistBootstrap(
        response: BootstrapResponse,
        capturedExerciseProtection: Map<String, ExerciseInput> = emptyMap(),
    ): BootstrapResponse =
        bootstrapCacheMutex.withLock {
            val cachedProfile = dao.getBootstrap()?.let { cached ->
                runCatching { api.json.decodeFromString<BootstrapResponse>(cached.payloadJson) }
                    .getOrNull()
                    ?.profile
                    ?.coachingProfile
            }
            val protectedResponse = response.copy(
                profile = response.profile.copy(
                    coachingProfile = mergeCoachingProfilesByTimestamp(
                        cachedProfile,
                        response.profile.coachingProfile,
                    ),
                ),
            )
            val queuedOperations = dao.queuedOperations()
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
                bootstrap = protectedResponse,
                sessions = pendingFinishedSessions,
                deletedSessionIds = targets.deletedSessionIds,
            )
            val pendingProgramProtected = queuedOperations.fold(historyMerged) { current, entry ->
                val operation = runCatching {
                    api.json.decodeFromString<SyncOperation>(entry.payloadJson)
                }.getOrNull() ?: return@fold current
                when (operation) {
                    is UpdateTargetSetsOperation -> updateProgramExerciseTargetSets(
                        current,
                        operation.programExerciseId,
                        operation.targetSets,
                    )
                    is MutateWorkoutExercisesOperation -> if (entry.status == "BLOCKED") {
                        current
                    } else {
                        replaceWorkoutExercisesInBootstrap(
                            current,
                            operation.workoutId,
                            operation.exercises.map {
                                it.toProgramExerciseDto(current, operation.workoutId)
                            },
                        )
                    }
                    is ReplaceProgramExerciseOperation -> if (entry.status == "BLOCKED") {
                        current
                    } else {
                        replaceProgramExerciseInBootstrap(
                            current,
                            operation.programExerciseId,
                            operation.replacementExerciseId,
                        )
                    }
                    is UpdatePreferredEquipmentOperation -> if (entry.status == "BLOCKED") {
                        current
                    } else {
                        updatePreferredEquipmentInBootstrap(
                            current,
                            operation.gymId,
                            operation.exerciseId,
                            operation.preferredEquipmentId,
                        )
                    }
                    else -> current
                }
            }
            val exerciseProtection = capturedExerciseProtection + captureExerciseEditProtection()
            val protectedExerciseMetadata = exerciseProtection.entries.fold(pendingProgramProtected) { current, entry ->
                applyExerciseInputToBootstrap(current, entry.key, entry.value)
            }
            dao.saveBootstrap(
                BootstrapCacheEntity(
                    payloadJson = api.json.encodeToString(protectedExerciseMetadata),
                    updatedAtEpochMs = System.currentTimeMillis(),
                ),
            )
            importOpenSessions(protectedExerciseMetadata)
            consumeExerciseEditReceipts(exerciseProtection)
            protectedExerciseMetadata
        }

    private suspend fun captureExerciseEditProtection(): Map<String, ExerciseInput> =
        OfflineSyncLock.mutex.withLock {
            val persistence = OfflineRuntime.persistence() ?: return@withLock emptyMap()
            val accountKey = offlineAccountKey() ?: return@withLock emptyMap()
            val cacheKey = catalogCacheKey(accountKey)
            val receipts = persistence.readCache(cacheKey)
                ?.let { payload ->
                    runCatching { offlineJson.decodeFromString<CatalogSnapshot>(payload) }.getOrNull()
                }
                ?.exerciseEditReceipts
                .orEmpty()
            val pending = persistence.operations(accountKey)
                .mapNotNull { it.mutation as? UpdateExerciseMutation }
                .associate { it.exerciseId to it.input }
            receipts + pending
        }

    private suspend fun consumeExerciseEditReceipts(
        protectedEdits: Map<String, ExerciseInput>,
    ) = OfflineSyncLock.mutex.withLock {
        if (protectedEdits.isEmpty()) return@withLock
        val persistence = OfflineRuntime.persistence() ?: return@withLock
        val accountKey = offlineAccountKey() ?: return@withLock
        val cacheKey = catalogCacheKey(accountKey)
        val snapshot = persistence.readCache(cacheKey)
            ?.let { payload ->
                runCatching { offlineJson.decodeFromString<CatalogSnapshot>(payload) }.getOrNull()
            }
            ?: return@withLock
        val remainingReceipts = consumeProtectedExerciseEditReceipts(
            snapshot.exerciseEditReceipts,
            protectedEdits,
        )
        if (remainingReceipts == snapshot.exerciseEditReceipts) return@withLock
        persistence.saveCache(
            accountKey,
            OFFLINE_DOMAIN_CATALOG,
            cacheKey,
            offlineJson.encodeToString(snapshot.copy(exerciseEditReceipts = remainingReceipts)),
        )
    }

    private fun offlineAccountKey(): String? = accountStore.userId?.let { userId ->
        accountKey(accountStore.primaryServerUrl, userId)
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
                dao.saveActiveWorkoutRuntimeAndMarker(
                    runtime,
                    watchMarker(runtime, "WORKOUT_STARTED"),
                )
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
        val runtime = newActiveRuntime(session, workout, nowInstant.toEpochMilli())
        dao.saveSessionOperationAndRuntime(
            session = session,
            operation = outbox(operation),
            runtime = runtime,
            marker = watchMarker(runtime, "WORKOUT_STARTED"),
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

    fun observeActiveTargetSetOverrides(
        sessionId: String,
    ): Flow<List<ActiveTargetSetOverrideEntity>> = dao.observeActiveTargetSetOverrides(sessionId)

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

    suspend fun <T> withWatchMutationLock(block: suspend () -> T): T =
        watchCommandMutex.withLock { block() }

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
        var watchCommand: PreparedWatchCommand? = null
        val updated = watchCommandMutex.withLock {
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
                dao.saveActiveWorkoutRuntimeAndMarker(
                    updated,
                    watchMarker(
                        updated,
                        "ACTIVE_EXERCISE_CHANGED",
                        enabled = publishToWatch && updatedBy == "PHONE",
                    ),
                )
                if (publishToWatch && updatedBy == "PHONE") {
                    watchCommand = prepareWatchCommand {
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
        dispatchPreparedWatchCommand(watchCommand)
        return updated
    }

    suspend fun applyWatchRuntimeEvent(
        processed: WatchProcessedEventEntity,
        runtime: ActiveWorkoutRuntimeEntity,
    ): Boolean = dao.applyWatchRuntimeEvent(processed, runtime)

    suspend fun applyWatchFinishedEvent(
        processed: WatchProcessedEventEntity,
        runtime: ActiveWorkoutRuntimeEntity,
        finishedAtEpochMs: Long,
    ): Boolean {
        val session = dao.getSession(runtime.sessionId) ?: return false
        val finishedAt = Instant.ofEpochMilli(finishedAtEpochMs).toString()
        val updated = session.copy(finishedAt = finishedAt)
        val operation = FinishSessionOperation(
            operationId = operationId(),
            sessionId = session.id,
            finishedAt = finishedAt,
            notes = session.notes,
            sessionRpe = session.sessionRpe,
        )
        val applied = dao.applyWatchFinishedEvent(
            processed = processed,
            session = updated,
            operation = outbox(operation),
        )
        if (applied) scheduleSyncNow()
        return applied
    }

    suspend fun applyWatchSetEvent(
        processed: WatchProcessedEventEntity,
        set: LocalSetEntity,
        runtime: ActiveWorkoutRuntimeEntity,
    ): WatchSetEventApplyResult {
        val existing = dao.getSet(set.id)
        when (val frozen = existing?.let(::frozenEquipmentLoadState)) {
            FrozenEquipmentLoadState.Invalid -> {
                saveWatchEquipmentConflict(processed, set, runtime, "INVALID_EQUIPMENT_SNAPSHOT")
                return WatchSetEventApplyResult(
                    applied = false,
                    errorCode = "INVALID_EQUIPMENT_SNAPSHOT",
                )
            }
            is FrozenEquipmentLoadState.Supported -> if (
                !isAchievableLoad(frozen.constraints, set.weight)
            ) {
                saveWatchEquipmentConflict(processed, set, runtime, "INVALID_EQUIPMENT_LOAD")
                return WatchSetEventApplyResult(applied = false, errorCode = "INVALID_EQUIPMENT_LOAD")
            }
            FrozenEquipmentLoadState.NoSnapshot, null -> Unit
        }
        val inferred = if (existing == null) {
            when (val resolution = resolveNewWatchSetEquipment(set)) {
                is WatchSetEquipmentResolution.Allowed -> resolution
                is WatchSetEquipmentResolution.Rejected -> {
                    saveWatchEquipmentConflict(processed, set, runtime, resolution.errorCode)
                    return WatchSetEventApplyResult(applied = false, errorCode = resolution.errorCode)
                }
            }
        } else {
            null
        }
        val merged = if (existing == null) {
            requireNotNull(inferred).set
        } else {
            val selectedLoad = existing.selectedLoadKg?.let { roundLoad(set.weight) }
            val nominalResistance = if (
                selectedLoad != null &&
                existing.selectedLoadMultiplierSnapshot != null &&
                (
                    snapshotLoadType(existing.equipmentLoadSnapshotJson) == "SELECTORIZED" ||
                        existing.nominalResistanceKg != null
                    )
            ) {
                roundLoad(selectedLoad * existing.selectedLoadMultiplierSnapshot)
            } else {
                existing.nominalResistanceKg
            }
            set.copy(
                weight = selectedLoad ?: set.weight,
                gymEquipmentId = existing.gymEquipmentId,
                equipmentNameSnapshot = existing.equipmentNameSnapshot,
                selectedLoadKg = selectedLoad,
                selectedLoadMultiplierSnapshot = existing.selectedLoadMultiplierSnapshot,
                nominalResistanceKg = nominalResistance,
                equipmentLoadSnapshotJson = updateEquipmentSnapshotJson(
                    existing.equipmentLoadSnapshotJson,
                    selectedLoad,
                    nominalResistance,
                ),
            )
        }
        val applied = dao.applyWatchSetEvent(
            processed,
            merged,
            outbox(
                upsertOperation(
                    set = merged,
                    includeEquipmentIdentity = existing == null && inferred?.frozenSnapshot != null,
                    frozenEquipmentSnapshot = inferred?.frozenSnapshot,
                ),
            ),
            runtime,
        )
        if (applied) scheduleSyncNow()
        return WatchSetEventApplyResult(applied = applied)
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
        dao.saveSetAndOperation(
            updated,
            outbox(upsertOperation(set = updated, includeEquipmentIdentity = false)),
        )
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

    suspend fun updateActiveTargetSets(
        sessionId: String,
        programExerciseId: String,
        targetSets: Int,
        effectiveTargetDropSets: Int,
    ) {
        require(targetSets in 1..20) { "Target sets must be between 1 and 20." }
        require(effectiveTargetDropSets in 0..10) { "Target drop sets must be between 0 and 10." }
        var queuedSync = false
        syncMutex.withLock {
            watchCommandMutex.withLock {
                bootstrapCacheMutex.withLock targetSetsLock@{
                    val cached = requireNotNull(dao.getBootstrap()) {
                        "No cached program is available."
                    }
                    val bootstrap = api.json.decodeFromString<BootstrapResponse>(cached.payloadJson)
                    val exercise = requireNotNull(findProgramExercise(bootstrap, programExerciseId)) {
                        "Program exercise was not found in the cached program."
                    }
                    require(
                        effectiveTargetDropSets == 0 ||
                            effectiveTargetDropSets == exercise.targetDropSets,
                    ) { "Effective drop sets do not match the current exercise target." }
                    val session = requireNotNull(dao.getSession(sessionId)) {
                        "Workout session was not found."
                    }
                    check(session.finishedAt == null && session.workoutId == exercise.workoutId) {
                        "Workout is no longer active."
                    }
                    requireNotNull(dao.getActiveWorkoutRuntime(sessionId)) {
                        "Active workout state was not found."
                    }
                    val completed = dao.getAllSets(sessionId)
                        .filter { set ->
                            set.exerciseId == exercise.exerciseId &&
                                !set.deleted &&
                                !set.isWarmup
                        }
                    val completedRegular = completed.count { !it.isDropSet }
                    val minimumTargetSets = maxOf(
                        1,
                        completedRegular,
                        completed.size - effectiveTargetDropSets,
                    )
                    require(targetSets >= minimumTargetSets) {
                        "Target sets cannot be lower than completed working and drop sets."
                    }

                    val existingOverride = dao.getActiveTargetSetOverride(
                        sessionId,
                        programExerciseId,
                    )
                    val programChanged = exercise.targetSets != targetSets
                    if (existingOverride?.targetSets == targetSets && !programChanged) {
                        return@targetSetsLock
                    }
                    val changedAt = System.currentTimeMillis()
                    val override = ActiveTargetSetOverrideEntity(
                        sessionId = sessionId,
                        programExerciseId = programExerciseId,
                        targetSets = targetSets,
                        updatedAtEpochMs = changedAt,
                    )
                    val updatedCache = if (programChanged) {
                        cached.copy(
                            payloadJson = api.json.encodeToString(
                                updateProgramExerciseTargetSets(
                                    bootstrap,
                                    programExerciseId,
                                    targetSets,
                                ),
                            ),
                            updatedAtEpochMs = changedAt,
                        )
                    } else {
                        null
                    }
                    val operation = if (programChanged) {
                        UpdateTargetSetsOperation(
                            operationId = operationId(),
                            programExerciseId = programExerciseId,
                            targetSets = targetSets,
                            previousTargetSets = exercise.targetSets,
                        ).let(::outbox)
                    } else {
                        null
                    }
                    dao.saveActiveTargetSetOverrideAndProgram(
                        override = override,
                        bootstrap = updatedCache,
                        operation = operation,
                    )
                    queuedSync = operation != null
                }
            }
        }
        if (queuedSync) scheduleSyncSafely()
    }

    suspend fun updatePreferredEquipment(
        gymId: String,
        exerciseId: String,
        preferredEquipmentId: String,
    ) {
        val changed = bootstrapCacheMutex.withLock {
            val cached = requireNotNull(dao.getBootstrap()) { "No cached program is available." }
            val bootstrap = api.json.decodeFromString<BootstrapResponse>(cached.payloadJson)
            val gym = requireNotNull(bootstrap.gyms.firstOrNull { it.id == gymId }) {
                "Gym was not found in the cached program."
            }
            val exercise = requireNotNull(bootstrap.catalog.firstOrNull { it.id == exerciseId }) {
                "Exercise was not found in the cached catalog."
            }
            val expectedEquipmentType = resolveEquipmentType(exercise.equipmentType, exercise.name)
            require(
                gym.equipment.any { equipment ->
                    equipment.id == preferredEquipmentId &&
                        equipment.equipmentType == expectedEquipmentType &&
                        equipment.exerciseLinks.any { it.exerciseId == exerciseId }
                },
            ) { "Equipment is not linked to this exercise in the selected gym." }
            val currentPreference = gym.exerciseConfigs
                .firstOrNull { it.exerciseId == exerciseId }
                ?.preferredEquipmentId
            if (currentPreference == preferredEquipmentId) return@withLock false
            val priorOperations = dao.queuedOperations().mapNotNull { entry ->
                val operation = runCatching {
                    api.json.decodeFromString<SyncOperation>(entry.payloadJson)
                }.getOrNull() as? UpdatePreferredEquipmentOperation
                entry.operationId.takeIf {
                    operation?.gymId == gymId && operation.exerciseId == exerciseId
                }
            }
            val updated = updatePreferredEquipmentInBootstrap(
                bootstrap,
                gymId,
                exerciseId,
                preferredEquipmentId,
            )
            val operation = UpdatePreferredEquipmentOperation(
                operationId = operationId(),
                gymId = gymId,
                exerciseId = exerciseId,
                preferredEquipmentId = preferredEquipmentId,
            )
            dao.saveBootstrapAndReplaceOperations(
                bootstrap = cached.copy(
                    payloadJson = api.json.encodeToString(updated),
                    updatedAtEpochMs = System.currentTimeMillis(),
                ),
                operationIdsToRemove = priorOperations,
                operation = outbox(operation),
            )
            true
        }
        if (changed) scheduleSyncSafely()
    }

    suspend fun updateProgramExercisePrescription(
        sessionId: String,
        updated: ProgramExerciseDto,
    ): Boolean {
        validateWorkoutExerciseMutation(updated)
        return mutateWorkoutExercises(sessionId, updated.workoutId) { exercises, activeExerciseId ->
            val index = exercises.indexOfFirst { it.id == updated.id }
            require(index >= 0) { "Program exercise was not found in the cached workout." }
            exercises.toMutableList().apply { this[index] = updated } to activeExerciseId
        }
    }

    suspend fun mutateProgramExerciseSuperset(
        sessionId: String,
        programExerciseId: String,
        neighborId: String?,
    ): Boolean {
        val cached = requireNotNull(cachedBootstrapSnapshot()) { "No cached program is available." }
        val current = requireNotNull(findProgramExercise(cached, programExerciseId)) {
            "Program exercise was not found in the cached program."
        }
        return mutateWorkoutExercises(sessionId, current.workoutId) { exercises, activeExerciseId ->
            val currentIndex = exercises.indexOfFirst { it.id == programExerciseId }
            require(currentIndex >= 0) { "Program exercise was not found in the cached workout." }
            val mutable = exercises.toMutableList()
            val currentExercise = mutable[currentIndex]
            if (neighborId == null) {
                val group = currentExercise.supersetGroup
                if (group != null) {
                    mutable.indices.forEach { index ->
                        if (mutable[index].supersetGroup == group) {
                            mutable[index] = mutable[index].copy(supersetGroup = null)
                        }
                    }
                }
            } else {
                require(neighborId != programExerciseId) { "An exercise cannot be linked to itself." }
                val neighborIndex = mutable.indexOfFirst { it.id == neighborId }
                require(neighborIndex >= 0) { "Neighboring exercise was not found." }
                val neighbor = mutable[neighborIndex]
                val currentGroup = currentExercise.supersetGroup
                val neighborGroup = neighbor.supersetGroup
                when {
                    currentGroup == null && neighborGroup == null -> {
                        val used = mutable.mapNotNullTo(mutableSetOf()) { it.supersetGroup }
                        val freeGroup = (1..9).firstOrNull { it !in used }
                        requireNotNull(freeGroup) { "Superset limit reached." }
                        mutable[currentIndex] = currentExercise.copy(supersetGroup = freeGroup)
                        mutable[neighborIndex] = neighbor.copy(supersetGroup = freeGroup)
                    }
                    currentGroup == null -> {
                        mutable[currentIndex] = currentExercise.copy(supersetGroup = neighborGroup)
                    }
                    neighborGroup == null -> {
                        mutable[neighborIndex] = neighbor.copy(supersetGroup = currentGroup)
                    }
                    currentGroup != neighborGroup -> {
                        mutable.indices.forEach { index ->
                            if (mutable[index].supersetGroup == currentGroup) {
                                mutable[index] = mutable[index].copy(supersetGroup = neighborGroup)
                            }
                        }
                    }
                }
            }
            mutable to activeExerciseId
        }
    }

    suspend fun addProgramExercise(
        sessionId: String,
        workoutId: String,
        exerciseId: String,
    ): String {
        val programExerciseId = entityId("program-exercise")
        val bootstrap = requireNotNull(cachedBootstrapSnapshot()) { "No cached program is available." }
        val exercise = requireNotNull(bootstrap.catalog.firstOrNull { it.id == exerciseId }) {
            "Exercise is not available in the cached catalog."
        }
        val defaults = bootstrap.activeWorkoutExerciseDefaults
        mutateWorkoutExercises(sessionId, workoutId) { exercises, _ ->
            require(exercises.none { it.exerciseId == exerciseId }) {
                "This exercise is already in the workout."
            }
            val created = ProgramExerciseDto(
                id = programExerciseId,
                workoutId = workoutId,
                exerciseId = exerciseId,
                order = (exercises.maxOfOrNull { it.order } ?: -1) + 1,
                targetSets = defaults.targetSets,
                targetDropSets = defaults.targetDropSets,
                targetRepsMin = defaults.targetRepsMin,
                targetRepsMax = defaults.targetRepsMax,
                targetRIR = defaults.targetRIR,
                restSec = exercise.defaultRestSec,
                autoregulationMode = defaults.autoregulationMode,
                fatigueRate = defaults.fatigueRate,
                loadAdjustmentPct = defaults.loadAdjustmentPct,
                exercise = exercise,
            )
            (exercises + created) to exerciseId
        }
        return programExerciseId
    }

    suspend fun removeProgramExercise(
        sessionId: String,
        programExerciseId: String,
    ): String = mutateWorkoutExercisesForResult(sessionId, programExerciseId) { exercises, activeExerciseId ->
        require(exercises.size > 1) { "A workout must keep at least one exercise." }
        val index = exercises.indexOfFirst { it.id == programExerciseId }
        require(index >= 0) { "Program exercise was not found in the cached workout." }
        val removed = exercises[index]
        val remaining = exercises.filterIndexed { itemIndex, _ -> itemIndex != index }
            .mapIndexed { order, exercise -> exercise.copy(order = order) }
        val nextActive = if (activeExerciseId == removed.exerciseId) {
            remaining.getOrNull(index)?.exerciseId ?: remaining.last().exerciseId
        } else {
            activeExerciseId
        }
        remaining to nextActive
    }

    private suspend fun mutateWorkoutExercisesForResult(
        sessionId: String,
        programExerciseId: String,
        transform: (
            List<ProgramExerciseDto>,
            String,
        ) -> Pair<List<ProgramExerciseDto>, String>,
    ): String {
        val cached = requireNotNull(cachedBootstrapSnapshot()) { "No cached program is available." }
        val current = requireNotNull(findProgramExercise(cached, programExerciseId)) {
            "Program exercise was not found in the cached program."
        }
        var nextActiveExerciseId = current.exerciseId
        mutateWorkoutExercises(sessionId, current.workoutId) { exercises, activeExerciseId ->
            transform(exercises, activeExerciseId).also { nextActiveExerciseId = it.second }
        }
        return nextActiveExerciseId
    }

    private suspend fun mutateWorkoutExercises(
        sessionId: String,
        workoutId: String,
        transform: (
            List<ProgramExerciseDto>,
            String,
        ) -> Pair<List<ProgramExerciseDto>, String>,
    ): Boolean {
        var watchCommand: PreparedWatchCommand? = null
        val changed = syncMutex.withLock {
            watchCommandMutex.withLock {
                bootstrapCacheMutex.withLock mutationLock@{
                    val cached = requireNotNull(dao.getBootstrap()) { "No cached program is available." }
                    val bootstrap = api.json.decodeFromString<BootstrapResponse>(cached.payloadJson)
                val pendingForWorkout = dao.queuedOperations().asSequence()
                    .mapNotNull { entry ->
                        runCatching { api.json.decodeFromString<SyncOperation>(entry.payloadJson) }
                            .getOrNull()
                    }
                    .any { operation ->
                        when (operation) {
                            is MutateWorkoutExercisesOperation -> operation.workoutId == workoutId
                            is ReplaceProgramExerciseOperation ->
                                findProgramExercise(bootstrap, operation.programExerciseId)?.workoutId == workoutId
                            is UpdateTargetSetsOperation ->
                                findProgramExercise(bootstrap, operation.programExerciseId)?.workoutId == workoutId
                            else -> false
                        }
                }
                check(!pendingForWorkout) { "A workout change is still waiting to synchronize." }

                val workout = requireNotNull(findWorkout(bootstrap, workoutId)) {
                    "Workout was not found in the cached program."
                }
                val session = requireNotNull(dao.getSession(sessionId)) { "Workout session was not found." }
                check(session.finishedAt == null && session.workoutId == workoutId) {
                    "Workout is no longer active."
                }
                val runtime = requireNotNull(dao.getActiveWorkoutRuntime(sessionId)) {
                    "Active workout state was not found."
                }
                val (nextExercisesRaw, nextActiveExerciseId) = transform(
                    workout.exercises,
                    requireNotNull(runtime.activeExerciseId) { "Active exercise was not found." },
                )
                val nextExercises = nextExercisesRaw.sortedWith(
                    compareBy<ProgramExerciseDto> { it.order }.thenBy { it.id },
                )
                require(nextExercises.isNotEmpty()) { "A workout must keep at least one exercise." }
                require(nextExercises.map { it.id }.distinct().size == nextExercises.size) {
                    "Program exercise IDs must be unique."
                }
                require(nextExercises.map { it.exerciseId }.distinct().size == nextExercises.size) {
                    "A workout cannot contain the same exercise twice."
                }
                require(nextExercises.any { it.exerciseId == nextActiveExerciseId }) {
                    "Active exercise must remain in the workout."
                }
                nextExercises.forEach(::validateWorkoutExerciseMutation)
                if (nextExercises == workout.exercises && nextActiveExerciseId == runtime.activeExerciseId) {
                    return@mutationLock false
                }

                val operation = MutateWorkoutExercisesOperation(
                    operationId = operationId(),
                    sessionId = sessionId,
                    workoutId = workoutId,
                    previousExercises = workout.exercises.map(ProgramExerciseDto::toMutationDto),
                    exercises = nextExercises.map(ProgramExerciseDto::toMutationDto),
                    previousActiveExerciseId = runtime.activeExerciseId,
                    nextActiveExerciseId = nextActiveExerciseId,
                )
                val updatedBootstrap = replaceWorkoutExercisesInBootstrap(
                    bootstrap,
                    workoutId,
                    nextExercises,
                )
                val changedAt = System.currentTimeMillis()
                val updatedCache = cached.copy(
                    payloadJson = api.json.encodeToString(updatedBootstrap),
                    updatedAtEpochMs = changedAt,
                )
                if (nextActiveExerciseId == runtime.activeExerciseId) {
                    dao.saveBootstrapAndOperation(updatedCache, outbox(operation))
                } else {
                    val updatedRuntime = nextPhoneRuntime(runtime, changedAt) { current ->
                        current.copy(activeExerciseId = nextActiveExerciseId)
                    }
                    dao.saveExerciseReplacement(
                        bootstrap = updatedCache,
                        operation = outbox(operation),
                        runtime = updatedRuntime,
                        marker = watchMarker(updatedRuntime, "ACTIVE_EXERCISE_CHANGED"),
                    )
                    watchCommand = prepareWatchCommand {
                            watchCommandPublisher.activeExerciseChanged(
                                sessionId,
                                nextActiveExerciseId,
                                updatedRuntime.revision,
                                changedAt,
                            )
                        }
                }
                true
                }
            }
        }
        dispatchPreparedWatchCommand(watchCommand)
        if (changed) scheduleSyncSafely()
        return changed
    }

    suspend fun replaceProgramExercise(
        sessionId: String,
        programExerciseId: String,
        replacementExerciseId: String,
    ): Boolean = syncMutex.withLock {
        var watchCommand: PreparedWatchCommand? = null
        val replaced = watchCommandMutex.withLock {
            bootstrapCacheMutex.withLock {
                val pendingReplacement = dao.queuedOperations().asSequence()
                    .mapNotNull { entry ->
                        runCatching { api.json.decodeFromString<SyncOperation>(entry.payloadJson) }
                            .getOrNull() as? ReplaceProgramExerciseOperation
                    }
                    .firstOrNull { it.programExerciseId == programExerciseId }
                check(pendingReplacement == null) {
                    "This exercise replacement is still waiting to synchronize."
                }

                val cached = requireNotNull(dao.getBootstrap()) { "No cached program is available." }
                val bootstrap = api.json.decodeFromString<BootstrapResponse>(cached.payloadJson)
                val current = requireNotNull(findProgramExercise(bootstrap, programExerciseId)) {
                    "Program exercise was not found in the cached program."
                }
                require(replacementExerciseId != current.exerciseId) {
                    "Replacement exercise must differ from the current exercise."
                }
                requireNotNull(bootstrap.catalog.firstOrNull { it.id == replacementExerciseId }) {
                    "Replacement exercise is not available in the cached catalog."
                }
                val session = requireNotNull(dao.getSession(sessionId)) { "Workout session was not found." }
                check(session.finishedAt == null) { "Workout is no longer active." }
                check(session.workoutId == current.workoutId) {
                    "Program exercise does not belong to the active workout."
                }
                val runtime = requireNotNull(dao.getActiveWorkoutRuntime(sessionId)) {
                    "Active workout state was not found."
                }
                check(runtime.status != "FINISHED" && runtime.activeExerciseId == current.exerciseId) {
                    "The active exercise changed. Open replacement again."
                }

                val changedAt = System.currentTimeMillis()
                val updatedRuntime = nextPhoneRuntime(runtime, changedAt) { currentRuntime ->
                    currentRuntime.copy(
                        activeExerciseId = replacementExerciseId,
                        activeSetId = null,
                        setStartedAtEpochMs = null,
                        setAccumulatedPauseMs = 0,
                        restStartedAtEpochMs = null,
                        restEndsAtEpochMs = null,
                        restDurationSeconds = null,
                        restPausedRemainingMs = null,
                    )
                }
                val operation = ReplaceProgramExerciseOperation(
                    operationId = operationId(),
                    sessionId = sessionId,
                    programExerciseId = programExerciseId,
                    previousExerciseId = current.exerciseId,
                    replacementExerciseId = replacementExerciseId,
                )
                val updatedBootstrap = replaceProgramExerciseInBootstrap(
                    bootstrap,
                    programExerciseId,
                    replacementExerciseId,
                )
                dao.saveExerciseReplacement(
                    bootstrap = cached.copy(
                        payloadJson = api.json.encodeToString(updatedBootstrap),
                        updatedAtEpochMs = changedAt,
                    ),
                    operation = outbox(operation),
                    runtime = updatedRuntime,
                    marker = watchMarker(updatedRuntime, "ACTIVE_EXERCISE_CHANGED"),
                )
                watchCommand = prepareWatchCommand {
                    watchCommandPublisher.activeExerciseChanged(
                        sessionId,
                        replacementExerciseId,
                        updatedRuntime.revision,
                        changedAt,
                    )
                }
                true
            }
        }
        if (replaced) {
            dispatchPreparedWatchCommand(watchCommand)
            scheduleSyncSafely()
        }
        replaced
    }

    suspend fun addSet(
        sessionId: String,
        exerciseId: String,
        weight: Double,
        reps: Int,
        rir: Int?,
        notes: String?,
        equipment: GymEquipmentDto? = null,
        isWarmup: Boolean = false,
        isDropSet: Boolean = false,
    ): LocalSetEntity {
        require(weight.isFinite() && weight in 0.0..500.0) { "Weight must be between 0 and 500." }
        require(reps in 1..100) { "Repetitions must be between 1 and 100." }
        require(rir == null || rir in 0..5) { "RIR must be between 0 and 5." }
        var watchCommand: PreparedWatchCommand? = null
        val set = watchCommandMutex.withLock {
            val now = Instant.now()
            val currentRuntime = runtimeForPhoneSetMutation(
                sessionId = sessionId,
                exerciseId = exerciseId,
                updatedAtEpochMs = now.toEpochMilli(),
            )
            val existing = dao.getSets(sessionId)
            val exerciseSets = existing.filter { it.exerciseId == exerciseId && !it.deleted }
            require(exerciseSets.size < 50) { "A session cannot contain more than 50 sets per exercise." }
            val previous = exerciseSets.maxByOrNull { it.completedAt }
            val recoverySec = previous?.let {
                Duration.between(Instant.parse(it.completedAt), now).seconds.coerceIn(0, 86_400).toInt()
            }
            val selectedLoad = equipment?.let { roundLoad(weight) }
            val storedWeight = selectedLoad ?: weight
            val nominalResistance = equipment
                ?.takeIf { it.loadType == "SELECTORIZED" }
                ?.let { roundLoad(storedWeight * it.selectedLoadMultiplier) }
            val frozenEquipmentSnapshot = equipment?.let {
                frozenEquipmentSnapshot(it, requireNotNull(selectedLoad), nominalResistance)
            }
            val set = LocalSetEntity(
                id = entityId("set"),
                sessionId = sessionId,
                exerciseId = exerciseId,
                gymEquipmentId = equipment?.id,
                equipmentNameSnapshot = equipment?.name,
                selectedLoadKg = selectedLoad,
                selectedLoadMultiplierSnapshot = equipment?.selectedLoadMultiplier,
                nominalResistanceKg = nominalResistance,
                equipmentLoadSnapshotJson = frozenEquipmentSnapshot?.equipmentLoadSnapshot?.let {
                    api.json.encodeToString(it)
                } ?: equipment?.let {
                    equipmentSnapshotJson(it, requireNotNull(selectedLoad), nominalResistance)
                },
                setNumber = (exerciseSets.maxOfOrNull { it.setNumber } ?: 0) + 1,
                weight = storedWeight,
                reps = reps,
                rir = rir,
                notes = notes?.trim()?.take(500)?.takeIf { it.isNotEmpty() },
                isWarmup = isWarmup,
                isDropSet = isDropSet,
                recoverySec = recoverySec,
                completedAt = now.toString(),
            )
            val updatedRuntime = nextPhoneRuntime(currentRuntime, now.toEpochMilli()) { current ->
                current.copy(
                    activeExerciseId = set.exerciseId,
                    activeSetId = null,
                    setStartedAtEpochMs = null,
                    setAccumulatedPauseMs = 0,
                )
            }
            dao.saveSetOperationRuntimeAndMarker(
                set = set,
                operation = outbox(
                    upsertOperation(
                        set = set,
                        includeEquipmentIdentity = true,
                        frozenEquipmentSnapshot = frozenEquipmentSnapshot,
                    ),
                ),
                runtime = updatedRuntime,
                marker = watchMarker(updatedRuntime, "SET_COMPLETED"),
            )
            watchCommand = prepareWatchCommand {
                watchCommandPublisher.setCompleted(set, updatedRuntime.revision)
            }
            set
        }
        dispatchPreparedWatchCommand(watchCommand)
        scheduleSyncSafely()
        return set
    }

    suspend fun updateSet(set: LocalSetEntity, weight: Double, reps: Int, rir: Int?): Boolean {
        require(weight.isFinite() && weight in 0.0..500.0) { "Weight must be between 0 and 500." }
        require(reps in 1..100) { "Repetitions must be between 1 and 100." }
        require(rir == null || rir in 0..5) { "RIR must be between 0 and 5." }
        var saved = false
        var watchCommand: PreparedWatchCommand? = null
        watchCommandMutex.withLock {
            val current = dao.getSet(set.id) ?: return@withLock
            if (current.deleted) return@withLock
            val changedAt = System.currentTimeMillis()
            val currentRuntime = runtimeForPhoneSetMutation(
                sessionId = current.sessionId,
                exerciseId = current.exerciseId,
                updatedAtEpochMs = changedAt,
            )
            when (val frozen = frozenEquipmentLoadState(current)) {
                FrozenEquipmentLoadState.Invalid -> error(
                    "The recorded equipment snapshot is unsupported or invalid.",
                )
                FrozenEquipmentLoadState.NoSnapshot -> Unit
                is FrozenEquipmentLoadState.Supported -> require(
                    isAchievableLoad(frozen.constraints, weight),
                ) {
                    "Selected weight is not attainable with the recorded equipment snapshot."
                }
            }
            val selectedLoad = current.selectedLoadKg?.let { roundLoad(weight) }
            val storedWeight = selectedLoad ?: weight
            val nominalResistance = if (
                selectedLoad != null &&
                current.selectedLoadMultiplierSnapshot != null &&
                (
                    snapshotLoadType(current.equipmentLoadSnapshotJson) == "SELECTORIZED" ||
                        current.nominalResistanceKg != null
                    )
            ) {
                roundLoad(selectedLoad * current.selectedLoadMultiplierSnapshot)
            } else {
                current.nominalResistanceKg
            }
            val updated = current.copy(
                weight = storedWeight,
                reps = reps,
                rir = rir,
                selectedLoadKg = selectedLoad,
                nominalResistanceKg = nominalResistance,
                equipmentLoadSnapshotJson = updateEquipmentSnapshotJson(
                    current.equipmentLoadSnapshotJson,
                    selectedLoad,
                    nominalResistance,
                ),
                deleted = false,
            )
            val updatedRuntime = nextPhoneRuntime(currentRuntime, changedAt) { it }
            dao.saveSetOperationRuntimeAndMarker(
                set = updated,
                operation = outbox(
                    upsertOperation(set = updated, includeEquipmentIdentity = false),
                ),
                runtime = updatedRuntime,
                marker = watchMarker(updatedRuntime, "SET_UPDATED"),
            )
            watchCommand = prepareWatchCommand {
                watchCommandPublisher.setUpdated(updated, updatedRuntime.revision)
            }
            saved = true
        }
        if (saved) {
            dispatchPreparedWatchCommand(watchCommand)
            scheduleSyncSafely()
        }
        return saved
    }

    suspend fun deleteSet(setId: String): Boolean {
        var deleted = false
        var watchCommand: PreparedWatchCommand? = null
        watchCommandMutex.withLock {
            val set = dao.getSet(setId)?.takeUnless { it.deleted } ?: return@withLock
            val deletedAt = System.currentTimeMillis()
            val current = runtimeForPhoneSetMutation(
                sessionId = set.sessionId,
                exerciseId = set.exerciseId,
                updatedAtEpochMs = deletedAt,
            )
            val updated = nextPhoneRuntime(current, deletedAt) { runtime ->
                if (runtime.activeSetId == set.id) {
                    runtime.copy(activeSetId = null, setStartedAtEpochMs = null, setAccumulatedPauseMs = 0)
                } else {
                    runtime
                }
            }
            dao.deleteSetOperationRuntimeAndMarker(
                setId = setId,
                operation = outbox(DeleteSetOperation(operationId(), set.id)),
                runtime = updated,
                marker = watchMarker(updated, "SET_DELETED"),
            )
            deleted = true
            watchCommand = prepareWatchCommand {
                watchCommandPublisher.setDeleted(
                    set.sessionId,
                    set.id,
                    updated.revision,
                    current.revision,
                    deletedAt,
                )
            }
        }
        if (deleted) {
            dispatchPreparedWatchCommand(watchCommand)
            scheduleSyncSafely()
        }
        return deleted
    }

    suspend fun finishSession(sessionId: String, notes: String?, sessionRpe: Int?) {
        require(sessionRpe == null || sessionRpe in 1..10) { "Session RPE must be between 1 and 10." }
        var finished = false
        var watchCommand: PreparedWatchCommand? = null
        watchCommandMutex.withLock {
            val session = dao.getSession(sessionId) ?: return@withLock
            if (session.finishedAt != null) return@withLock
            val watchRuntime = dao.getActiveWorkoutRuntime(sessionId)
            val finishedAt = Instant.now().toString()
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
            val finishedAtEpochMs = Instant.parse(finishedAt).toEpochMilli()
            val watchEvent = watchRuntime
                ?.takeIf { watchCommandPublisher.enabled }
                ?.let { runtime ->
                    phoneWatchEvent(
                        sessionId = sessionId,
                        type = WatchEventType.WORKOUT_FINISHED,
                        revision = runtime.revision + 1,
                        timestamp = finishedAtEpochMs,
                        payload = buildJsonObject { put("finishedAt", finishedAtEpochMs) },
                    )
                }
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
                dao.saveFinishedSessionOperationAndBootstrap(
                    updated,
                    outbox(operation),
                    bootstrap,
                    watchEvent?.toOutboxEntity(),
                )
            }
            if (watchEvent != null) {
                watchCommand = prepareWatchCommand {
                    watchCommandPublisher.flush(sessionId)
                }
            }
            finished = true
        }
        if (finished) {
            dispatchPreparedWatchCommand(watchCommand)
            scheduleSyncNow()
        }
    }

    suspend fun startRest(
        sessionId: String,
        setId: String,
        startedAtEpochMs: Long,
        endsAtEpochMs: Long,
    ): Boolean {
        require(endsAtEpochMs >= startedAtEpochMs)
        var started = false
        var watchCommand: PreparedWatchCommand? = null
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
                started = true
                watchCommand = prepareWatchCommand {
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
        dispatchPreparedWatchCommand(watchCommand)
        return started
    }

    suspend fun updateRest(sessionId: String, endsAtEpochMs: Long, reason: String) {
        require(reason.isNotBlank())
        val changedAt = System.currentTimeMillis()
        var watchCommand: PreparedWatchCommand? = null
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
                watchCommand = prepareWatchCommand {
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
        dispatchPreparedWatchCommand(watchCommand)
    }

    suspend fun finishRest(sessionId: String, finishedAtEpochMs: Long = System.currentTimeMillis()) {
        var watchCommand: PreparedWatchCommand? = null
        watchCommandMutex.withLock {
            val current = dao.getActiveWorkoutRuntime(sessionId) ?: return@withLock
            val startedAt = current.restStartedAtEpochMs ?: return@withLock
            advancePhoneRuntime(sessionId, finishedAtEpochMs) { clearRestRuntime(it) }
                ?.let { runtime ->
                    watchCommand = prepareWatchCommand {
                        watchCommandPublisher.restFinished(
                            sessionId,
                            runtime.revision,
                            startedAt,
                            finishedAtEpochMs,
                        )
                    }
                }
        }
        dispatchPreparedWatchCommand(watchCommand)
    }

    suspend fun skipRest(sessionId: String, skippedAtEpochMs: Long = System.currentTimeMillis()) {
        var watchCommand: PreparedWatchCommand? = null
        watchCommandMutex.withLock {
            val current = dao.getActiveWorkoutRuntime(sessionId) ?: return@withLock
            if (current.restStartedAtEpochMs == null) return@withLock
            advancePhoneRuntime(sessionId, skippedAtEpochMs) { clearRestRuntime(it) }
                ?.let { runtime ->
                    watchCommand = prepareWatchCommand {
                        watchCommandPublisher.restSkipped(sessionId, runtime.revision, skippedAtEpochMs)
                    }
                }
        }
        dispatchPreparedWatchCommand(watchCommand)
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
                is UpdateTargetSetsOperation,
                is UpdatePreferredEquipmentOperation,
                is MutateWorkoutExercisesOperation,
                is ReplaceProgramExerciseOperation,
                null,
                -> false
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

    private suspend fun blockRejectedOperation(
        entry: SyncOutboxEntity,
        operation: SyncOperation,
        userError: UserFacingError,
    ) {
        val error = userError.technical.sanitizedServerResponse ?: "Synchronization operation rejected."
        if (operation is MutateWorkoutExercisesOperation) {
            val watchCommand = rollbackRejectedWorkoutExerciseMutation(
                operation,
                entry.operationId,
                error,
            )
            dispatchPreparedWatchCommand(watchCommand)
            persistSyncErrorMetadata(entry.operationId, userError)
            return
        }
        if (operation !is ReplaceProgramExerciseOperation) {
            val technical = userError.technical
            dao.markOperationBlockedDetailed(
                operationId = entry.operationId,
                error = error,
                category = userError.category.name,
                httpStatus = technical.httpStatus,
                errorCode = technical.errorCode,
                correlationId = technical.correlationId,
                exceptionClass = technical.exceptionClass,
                stackTrace = technical.sanitizedStackTrace,
            )
            return
        }
        val watchCommand = rollbackRejectedExerciseReplacement(operation, entry.operationId, error)
        dispatchPreparedWatchCommand(watchCommand)
        persistSyncErrorMetadata(entry.operationId, userError)
    }

    private suspend fun persistSyncErrorMetadata(operationId: String, userError: UserFacingError) {
        val technical = userError.technical
        dao.updateOperationErrorMetadata(
            operationId = operationId,
            category = userError.category.name,
            httpStatus = technical.httpStatus,
            errorCode = technical.errorCode,
            correlationId = technical.correlationId,
            exceptionClass = technical.exceptionClass,
            stackTrace = technical.sanitizedStackTrace,
        )
    }

    private suspend fun markSyncOperationFailed(entry: SyncOutboxEntity, error: Throwable) {
        val userError = syncOperationError(entry, error)
        val technical = userError.technical
        dao.markOperationFailedDetailed(
            operationId = entry.operationId,
            error = technical.sanitizedServerResponse ?: "Synchronization failed.",
            category = userError.category.name,
            httpStatus = technical.httpStatus,
            errorCode = technical.errorCode,
            correlationId = technical.correlationId,
            exceptionClass = technical.exceptionClass,
            stackTrace = technical.sanitizedStackTrace,
        )
    }

    private fun syncOperationError(
        entry: SyncOutboxEntity,
        error: Throwable? = null,
        serverResponse: String? = null,
    ): UserFacingError = classifyAppError(
        error = error,
        context = AppErrorContext(
            operation = AppErrorOperation.SYNC,
            dataState = AppErrorDataState.QUEUED_LOCALLY,
            operationType = entry.type,
            queueItemId = entry.operationId,
            attemptCount = entry.attempts + 1,
            createdAtEpochMs = entry.createdAtEpochMs,
            lastRetryAtEpochMs = entry.lastRetryRequestedAtEpochMs,
            serverResponse = serverResponse,
        ),
    )

    private suspend fun rollbackRejectedWorkoutExerciseMutation(
        operation: MutateWorkoutExercisesOperation,
        operationId: String,
        error: String,
    ): PreparedWatchCommand? = watchCommandMutex.withLock {
        bootstrapCacheMutex.withLock bootstrapLock@{
            val cached = dao.getBootstrap()
            val bootstrap = cached?.let { entity ->
                runCatching { api.json.decodeFromString<BootstrapResponse>(entity.payloadJson) }.getOrNull()
            }
            if (cached == null || bootstrap == null) {
                dao.markOperationBlocked(operationId, error)
                return@bootstrapLock null
            }
            val changedAt = System.currentTimeMillis()
            val restoredBootstrap = replaceWorkoutExercisesInBootstrap(
                bootstrap,
                operation.workoutId,
                operation.previousExercises.map {
                    it.toProgramExerciseDto(bootstrap, operation.workoutId)
                },
            )
            val currentRuntime = dao.getActiveWorkoutRuntime(operation.sessionId)
            val restoredRuntime = currentRuntime
                ?.takeIf {
                    it.status != "FINISHED" &&
                        it.activeExerciseId != operation.previousActiveExerciseId
                }
                ?.let { runtime ->
                    nextPhoneRuntime(runtime, changedAt) { current ->
                        current.copy(
                            activeExerciseId = operation.previousActiveExerciseId,
                            activeSetId = null,
                            setStartedAtEpochMs = null,
                            setAccumulatedPauseMs = 0,
                            restStartedAtEpochMs = null,
                            restEndsAtEpochMs = null,
                            restDurationSeconds = null,
                            restPausedRemainingMs = null,
                        )
                    }
                }
            dao.blockAndRollbackExerciseReplacement(
                operationId = operationId,
                error = error,
                bootstrap = cached.copy(
                    payloadJson = api.json.encodeToString(restoredBootstrap),
                    updatedAtEpochMs = changedAt,
                ),
                runtime = restoredRuntime,
                marker = restoredRuntime?.let { watchMarker(it, "ACTIVE_EXERCISE_CHANGED") },
            )
            restoredRuntime?.let { runtime ->
                prepareWatchCommand {
                    watchCommandPublisher.activeExerciseChanged(
                        operation.sessionId,
                        operation.previousActiveExerciseId,
                        runtime.revision,
                        changedAt,
                    )
                }
            }
        }
    }

    private suspend fun restoreBlockedWorkoutExerciseMutation(
        operation: MutateWorkoutExercisesOperation,
        operationId: String,
    ): PreparedWatchCommand? {
        val authoritative = refreshBootstrap()
        return watchCommandMutex.withLock {
            bootstrapCacheMutex.withLock bootstrapLock@{
                val cached = requireNotNull(dao.getBootstrap()) { "No cached program is available." }
                val workout = requireNotNull(findWorkout(authoritative, operation.workoutId)) {
                    "Workout is no longer available."
                }
                val authoritativeExercises = workout.exercises.map(ProgramExerciseDto::toMutationDto)
                    .canonicalWorkoutMutation()
                val previousExercises = operation.previousExercises.canonicalWorkoutMutation()
                val nextExercises = operation.exercises.canonicalWorkoutMutation()
                if (authoritativeExercises != previousExercises && authoritativeExercises != nextExercises) {
                    error("Workout exercises changed. Discard this change and try again.")
                }
                if (authoritativeExercises == nextExercises) {
                    val watchCommand = reconcileWorkoutExerciseMutationRuntimeLocked(
                        operation = operation,
                        authoritative = authoritative,
                        operationIdToRemove = operationId,
                    )
                    return@bootstrapLock watchCommand
                }
                val changedAt = System.currentTimeMillis()
                val restoredBootstrap = replaceWorkoutExercisesInBootstrap(
                    authoritative,
                    operation.workoutId,
                    operation.exercises.map {
                        it.toProgramExerciseDto(authoritative, operation.workoutId)
                    },
                )
                val currentRuntime = dao.getActiveWorkoutRuntime(operation.sessionId)
                val restoredRuntime = currentRuntime
                    ?.takeIf {
                        it.status != "FINISHED" &&
                            it.activeExerciseId != operation.nextActiveExerciseId
                    }
                    ?.let { runtime ->
                        nextPhoneRuntime(runtime, changedAt) { current ->
                            current.copy(
                                activeExerciseId = operation.nextActiveExerciseId,
                                activeSetId = null,
                                setStartedAtEpochMs = null,
                                setAccumulatedPauseMs = 0,
                                restStartedAtEpochMs = null,
                                restEndsAtEpochMs = null,
                                restDurationSeconds = null,
                                restPausedRemainingMs = null,
                            )
                        }
                    }
                val rewritten = outbox(operation)
                dao.retryAndRestoreExerciseReplacement(
                    operationId = operationId,
                    operationType = rewritten.type,
                    payloadJson = rewritten.payloadJson,
                    requestedAtEpochMs = changedAt,
                    bootstrap = cached.copy(
                        payloadJson = api.json.encodeToString(restoredBootstrap),
                        updatedAtEpochMs = changedAt,
                    ),
                    runtime = restoredRuntime,
                    marker = restoredRuntime?.let { watchMarker(it, "ACTIVE_EXERCISE_CHANGED") },
                )
                restoredRuntime?.let { runtime ->
                    prepareWatchCommand {
                        watchCommandPublisher.activeExerciseChanged(
                            operation.sessionId,
                            operation.nextActiveExerciseId,
                            runtime.revision,
                            changedAt,
                        )
                    }
                }
            }
        }
    }

    private suspend fun reconcileWorkoutExerciseMutationRuntime(
        operation: MutateWorkoutExercisesOperation,
        authoritative: BootstrapResponse,
        operationIdToRemove: String? = null,
    ): PreparedWatchCommand? = watchCommandMutex.withLock {
        bootstrapCacheMutex.withLock {
            reconcileWorkoutExerciseMutationRuntimeLocked(
                operation,
                authoritative,
                operationIdToRemove,
            )
        }
    }

    private suspend fun reconcileWorkoutExerciseMutationRuntimeLocked(
        operation: MutateWorkoutExercisesOperation,
        authoritative: BootstrapResponse,
        operationIdToRemove: String?,
    ): PreparedWatchCommand? {
        val cached = dao.getBootstrap() ?: return null
        val workout = findWorkout(authoritative, operation.workoutId)
        val availableExerciseIds = workout?.exercises?.mapTo(linkedSetOf()) { it.exerciseId }.orEmpty()
        val currentRuntime = dao.getActiveWorkoutRuntime(operation.sessionId)
        val safeActiveExerciseId = currentRuntime?.activeExerciseId
            ?.takeIf { it in availableExerciseIds }
            ?: operation.previousActiveExerciseId.takeIf { it in availableExerciseIds }
            ?: workout?.exercises
                ?.minWithOrNull(compareBy<ProgramExerciseDto> { it.order }.thenBy { it.id })
                ?.exerciseId
        val changedAt = System.currentTimeMillis()
        val reconciledRuntime = currentRuntime
            ?.takeIf { it.status != "FINISHED" && it.activeExerciseId != safeActiveExerciseId }
            ?.let { runtime ->
                nextPhoneRuntime(runtime, changedAt) { current ->
                    current.copy(
                        activeExerciseId = safeActiveExerciseId,
                        activeSetId = null,
                        setStartedAtEpochMs = null,
                        setAccumulatedPauseMs = 0,
                        restStartedAtEpochMs = null,
                        restEndsAtEpochMs = null,
                        restDurationSeconds = null,
                        restPausedRemainingMs = null,
                    )
                }
            }
        dao.reconcileExerciseReplacement(
            bootstrap = cached.copy(
                payloadJson = api.json.encodeToString(authoritative),
                updatedAtEpochMs = changedAt,
            ),
            operationIdToRemove = operationIdToRemove,
            runtime = reconciledRuntime,
            marker = reconciledRuntime?.let { watchMarker(it, "ACTIVE_EXERCISE_CHANGED") },
        )
        return reconciledRuntime?.let { runtime ->
            safeActiveExerciseId?.let { exerciseId ->
                prepareWatchCommand {
                    watchCommandPublisher.activeExerciseChanged(
                        operation.sessionId,
                        exerciseId,
                        runtime.revision,
                        changedAt,
                    )
                }
            }
        }
    }

    private suspend fun rollbackRejectedExerciseReplacement(
        operation: ReplaceProgramExerciseOperation,
        operationId: String,
        error: String,
    ): PreparedWatchCommand? = watchCommandMutex.withLock {
        bootstrapCacheMutex.withLock bootstrapLock@{
            val cached = dao.getBootstrap()
            val bootstrap = cached?.let { entity ->
                runCatching { api.json.decodeFromString<BootstrapResponse>(entity.payloadJson) }.getOrNull()
            }
            if (cached == null || bootstrap == null) {
                dao.markOperationBlocked(operationId, error)
                return@bootstrapLock null
            }
            val changedAt = System.currentTimeMillis()
            val restoredBootstrap = replaceProgramExerciseInBootstrap(
                bootstrap,
                operation.programExerciseId,
                operation.previousExerciseId,
            )
            val currentRuntime = dao.getActiveWorkoutRuntime(operation.sessionId)
            val restoredRuntime = currentRuntime
                ?.takeIf { it.activeExerciseId == operation.replacementExerciseId }
                ?.let { runtime ->
                    nextPhoneRuntime(runtime, changedAt) { current ->
                        current.copy(
                            activeExerciseId = operation.previousExerciseId,
                            activeSetId = null,
                            setStartedAtEpochMs = null,
                            setAccumulatedPauseMs = 0,
                            restStartedAtEpochMs = null,
                            restEndsAtEpochMs = null,
                            restDurationSeconds = null,
                            restPausedRemainingMs = null,
                        )
                    }
                }
            dao.blockAndRollbackExerciseReplacement(
                operationId = operationId,
                error = error,
                bootstrap = cached.copy(
                    payloadJson = api.json.encodeToString(restoredBootstrap),
                    updatedAtEpochMs = changedAt,
                ),
                runtime = restoredRuntime,
                marker = restoredRuntime?.let { watchMarker(it, "ACTIVE_EXERCISE_CHANGED") },
            )
            restoredRuntime?.let { runtime ->
                prepareWatchCommand {
                    watchCommandPublisher.activeExerciseChanged(
                        operation.sessionId,
                        operation.previousExerciseId,
                        runtime.revision,
                        changedAt,
                    )
                }
            }
        }
    }

    private suspend fun restoreBlockedExerciseReplacement(
        operation: ReplaceProgramExerciseOperation,
        operationId: String,
    ): PreparedWatchCommand? = watchCommandMutex.withLock {
        bootstrapCacheMutex.withLock bootstrapLock@{
            val cached = requireNotNull(dao.getBootstrap()) { "No cached program is available." }
            val bootstrap = api.json.decodeFromString<BootstrapResponse>(cached.payloadJson)
            val changedAt = System.currentTimeMillis()
            val currentRuntime = dao.getActiveWorkoutRuntime(operation.sessionId)
            val authoritativeTarget = findProgramExercise(bootstrap, operation.programExerciseId)
            if (authoritativeTarget == null) {
                val safeExerciseId = safeExerciseIdAfterRemovedTarget(
                    bootstrap = bootstrap,
                    sessionId = operation.sessionId,
                )
                val reconciledRuntime = currentRuntime
                    ?.takeIf {
                        it.status != "FINISHED" &&
                            it.activeExerciseId in setOf(
                                operation.previousExerciseId,
                                operation.replacementExerciseId,
                            ) &&
                            it.activeExerciseId != safeExerciseId
                    }
                    ?.let { runtime ->
                        nextPhoneRuntime(runtime, changedAt) { current ->
                            current.copy(
                                activeExerciseId = safeExerciseId,
                                activeSetId = null,
                                setStartedAtEpochMs = null,
                                setAccumulatedPauseMs = 0,
                                restStartedAtEpochMs = null,
                                restEndsAtEpochMs = null,
                                restDurationSeconds = null,
                                restPausedRemainingMs = null,
                            )
                        }
                    }
                dao.reconcileExerciseReplacement(
                    bootstrap = cached,
                    operationIdToRemove = operationId,
                    runtime = reconciledRuntime,
                    marker = reconciledRuntime?.let {
                        watchMarker(it, "PROGRAM_EXERCISE_REMOVED")
                    },
                )
                return@bootstrapLock safeExerciseId?.let { exerciseId ->
                    reconciledRuntime?.let { runtime ->
                        prepareWatchCommand {
                            watchCommandPublisher.activeExerciseChanged(
                                operation.sessionId,
                                exerciseId,
                                runtime.revision,
                                changedAt,
                            )
                        }
                    }
                }
            }
            requireNotNull(bootstrap.catalog.firstOrNull { it.id == operation.replacementExerciseId }) {
                "Replacement exercise is no longer available in the cached catalog."
            }
            val eligibleActiveExerciseIds = setOf(
                operation.previousExerciseId,
                operation.replacementExerciseId,
                authoritativeTarget.exerciseId,
            )
            val restoredRuntime = currentRuntime
                ?.takeIf {
                    it.status != "FINISHED" &&
                        it.activeExerciseId in eligibleActiveExerciseIds &&
                        it.activeExerciseId != operation.replacementExerciseId
                }
                ?.let { runtime ->
                    nextPhoneRuntime(runtime, changedAt) { current ->
                        current.copy(
                            activeExerciseId = operation.replacementExerciseId,
                            activeSetId = null,
                            setStartedAtEpochMs = null,
                            setAccumulatedPauseMs = 0,
                            restStartedAtEpochMs = null,
                            restEndsAtEpochMs = null,
                            restDurationSeconds = null,
                            restPausedRemainingMs = null,
                        )
                    }
                }
            if (authoritativeTarget.exerciseId == operation.replacementExerciseId) {
                dao.reconcileExerciseReplacement(
                    bootstrap = cached,
                    operationIdToRemove = operationId,
                    runtime = restoredRuntime,
                    marker = restoredRuntime?.let { watchMarker(it, "ACTIVE_EXERCISE_CHANGED") },
                )
                return@bootstrapLock restoredRuntime?.let { runtime ->
                    prepareWatchCommand {
                        watchCommandPublisher.activeExerciseChanged(
                            operation.sessionId,
                            operation.replacementExerciseId,
                            runtime.revision,
                            changedAt,
                        )
                    }
                }
            }
            val rebasedOperation = operation.copy(
                previousExerciseId = authoritativeTarget.exerciseId,
            )
            val rewrittenOutbox = outbox(rebasedOperation)
            val restoredBootstrap = replaceProgramExerciseInBootstrap(
                bootstrap,
                operation.programExerciseId,
                operation.replacementExerciseId,
            )
            dao.retryAndRestoreExerciseReplacement(
                operationId = operationId,
                operationType = rewrittenOutbox.type,
                payloadJson = rewrittenOutbox.payloadJson,
                requestedAtEpochMs = changedAt,
                bootstrap = cached.copy(
                    payloadJson = api.json.encodeToString(restoredBootstrap),
                    updatedAtEpochMs = changedAt,
                ),
                runtime = restoredRuntime,
                marker = restoredRuntime?.let { watchMarker(it, "ACTIVE_EXERCISE_CHANGED") },
            )
            restoredRuntime?.let { runtime ->
                prepareWatchCommand {
                    watchCommandPublisher.activeExerciseChanged(
                        operation.sessionId,
                        operation.replacementExerciseId,
                        runtime.revision,
                        changedAt,
                    )
                }
            }
        }
    }

    private suspend fun reconcileExerciseReplacementWithAuthoritativeBootstrap(
        operation: ReplaceProgramExerciseOperation,
        authoritative: BootstrapResponse,
        operationIdToRemove: String? = null,
    ): PreparedWatchCommand? = watchCommandMutex.withLock {
        bootstrapCacheMutex.withLock bootstrapLock@{
            val authoritativeTarget = findProgramExercise(
                authoritative,
                operation.programExerciseId,
            )
            val cached = dao.getBootstrap() ?: return@bootstrapLock null
            val currentRuntime = dao.getActiveWorkoutRuntime(operation.sessionId)
            val eligibleActiveExerciseIds = setOf(
                operation.previousExerciseId,
                operation.replacementExerciseId,
            )
            val changedAt = System.currentTimeMillis()
            if (authoritativeTarget == null) {
                val safeExerciseId = safeExerciseIdAfterRemovedTarget(
                    bootstrap = authoritative,
                    sessionId = operation.sessionId,
                )
                val reconciledRuntime = currentRuntime
                    ?.takeIf {
                        it.status != "FINISHED" &&
                            it.activeExerciseId in eligibleActiveExerciseIds &&
                            it.activeExerciseId != safeExerciseId
                    }
                    ?.let { runtime ->
                        nextPhoneRuntime(runtime, changedAt) { current ->
                            current.copy(
                                activeExerciseId = safeExerciseId,
                                activeSetId = null,
                                setStartedAtEpochMs = null,
                                setAccumulatedPauseMs = 0,
                                restStartedAtEpochMs = null,
                                restEndsAtEpochMs = null,
                                restDurationSeconds = null,
                                restPausedRemainingMs = null,
                            )
                        }
                    }
                dao.reconcileExerciseReplacement(
                    bootstrap = cached,
                    operationIdToRemove = operationIdToRemove ?: operation.operationId,
                    runtime = reconciledRuntime,
                    marker = reconciledRuntime?.let {
                        watchMarker(it, "PROGRAM_EXERCISE_REMOVED")
                    },
                )
                return@bootstrapLock safeExerciseId?.let { exerciseId ->
                    reconciledRuntime?.let { runtime ->
                        prepareWatchCommand {
                            watchCommandPublisher.activeExerciseChanged(
                                operation.sessionId,
                                exerciseId,
                                runtime.revision,
                                changedAt,
                            )
                        }
                    }
                }
            }
            val reconciledRuntime = currentRuntime
                ?.takeIf {
                    it.status != "FINISHED" &&
                        it.activeExerciseId in eligibleActiveExerciseIds &&
                        it.activeExerciseId != authoritativeTarget.exerciseId
                }
                ?.let { runtime ->
                    nextPhoneRuntime(runtime, changedAt) { current ->
                        current.copy(
                            activeExerciseId = authoritativeTarget.exerciseId,
                            activeSetId = null,
                            setStartedAtEpochMs = null,
                            setAccumulatedPauseMs = 0,
                            restStartedAtEpochMs = null,
                            restEndsAtEpochMs = null,
                            restDurationSeconds = null,
                            restPausedRemainingMs = null,
                        )
                    }
                }
            dao.reconcileExerciseReplacement(
                bootstrap = cached,
                operationIdToRemove = operationIdToRemove,
                runtime = reconciledRuntime,
                marker = reconciledRuntime?.let { watchMarker(it, "ACTIVE_EXERCISE_CHANGED") },
            )
            reconciledRuntime?.let { runtime ->
                prepareWatchCommand {
                    watchCommandPublisher.activeExerciseChanged(
                        operation.sessionId,
                        authoritativeTarget.exerciseId,
                        runtime.revision,
                        changedAt,
                    )
                }
            }
        }
    }

    private suspend fun safeExerciseIdAfterRemovedTarget(
        bootstrap: BootstrapResponse,
        sessionId: String,
    ): String? {
        val embeddedWorkout = bootstrap.openSessions.firstOrNull { it.id == sessionId }?.workout
        val workoutId = embeddedWorkout?.id ?: dao.getSession(sessionId)?.workoutId
        val workout = embeddedWorkout
            ?: bootstrap.activeProgram?.workouts?.firstOrNull { it.id == workoutId }
            ?: bootstrap.openSessions.asSequence()
                .mapNotNull { it.workout }
                .firstOrNull { it.id == workoutId }
        return workout?.exercises
            ?.minWithOrNull(compareBy<ProgramExerciseDto> { it.order }.thenBy { it.id })
            ?.exerciseId
    }

    suspend fun syncPending(): Boolean = syncMutex.withLock {
        val token = accountStore.getAccessToken() ?: return true
        dao.recoverInterruptedOperations()
        var allAccepted = true
        var rejectedReplacement: ReplaceProgramExerciseOperation? = null
        var rejectedWorkoutMutation: MutateWorkoutExercisesOperation? = null

        syncLoop@ while (true) {
            val queue = dao.queuedOperations()
            if (queue.isEmpty()) break

            val decodedQueue = mutableListOf<Pair<SyncOutboxEntity, SyncOperation>>()
            var newlyBlockedCorruptOperation = false
            val undecodableBlockedSequences = mutableSetOf<Long>()
            for (entry in queue) {
                val decodedOperation = runCatching {
                    api.json.decodeFromString<SyncOperation>(entry.payloadJson)
                }
                val operation = decodedOperation.getOrNull()
                if (operation == null) {
                    if (entry.status != "BLOCKED") {
                        val error = decodedOperation.exceptionOrNull()
                        dao.markOperationBlocked(
                            entry.operationId,
                            "Stored operation cannot be decoded: ${error?.message ?: "invalid payload"}",
                        )
                        newlyBlockedCorruptOperation = true
                    }
                    undecodableBlockedSequences += entry.sequence
                    allAccepted = false
                } else {
                    decodedQueue += entry to operation
                }
            }
            if (newlyBlockedCorruptOperation) continue@syncLoop

            val blocked = decodedQueue.filter { (entry) -> entry.status == "BLOCKED" }
            if (blocked.isNotEmpty() || undecodableBlockedSequences.isNotEmpty()) {
                allAccepted = false
            }
            blocked.asSequence().map { it.second }.forEach { operation ->
                if (rejectedReplacement == null) {
                    rejectedReplacement = operation as? ReplaceProgramExerciseOperation
                }
                if (rejectedWorkoutMutation == null) {
                    rejectedWorkoutMutation = operation as? MutateWorkoutExercisesOperation
                }
            }

            val queuedSetSessions = decodedQueue.mapNotNull { (_, operation) ->
                (operation as? UpsertSetOperation)?.let { it.set.id to it.set.sessionId }
            }.toMap().toMutableMap()
            decodedQueue.asSequence()
                .mapNotNull { (_, operation) -> operation as? DeleteSetOperation }
                .forEach { operation ->
                    if (operation.setId !in queuedSetSessions) {
                        dao.getSet(operation.setId)?.sessionId?.let { sessionId ->
                            queuedSetSessions[operation.setId] = sessionId
                        }
                    }
                }
            val blockedScopes = blocked.map { (entry, operation) ->
                entry.sequence to syncOrderingKeys(operation, queuedSetSessions)
            }
            val decoded = decodedQueue.asSequence()
                .filter { (entry) -> entry.status == "PENDING" || entry.status == "FAILED" }
                .filter { (entry, operation) ->
                    val operationScopes = syncOrderingKeys(operation, queuedSetSessions)
                    val hasUnknownPriorBlock = undecodableBlockedSequences.any { it < entry.sequence }
                    val hasRelatedPriorBlock = blockedScopes.any { (sequence, scopes) ->
                        sequence < entry.sequence && operationScopes.any(scopes::contains)
                    }
                    !hasUnknownPriorBlock && !hasRelatedPriorBlock
                }
                .take(500)
                .toList()
            if (decoded.isEmpty()) break

            var attempted = decoded
            var syncAttempt: Result<SyncBatchResponse>
            while (true) {
                syncAttempt = runCatching {
                    endpointResolver.execute { baseUrl ->
                        api.sync(
                            baseUrl,
                            token,
                            SyncBatchRequest(attempted.map { it.second }),
                        )
                    }
                }
                val error = syncAttempt.exceptionOrNull()
                val isolateClientError = error is ApiException &&
                    error.statusCode in 400..499 &&
                    error.statusCode !in setOf(401, 403, 429) &&
                    attempted.size > 1
                if (!isolateClientError) break
                attempted = listOf(attempted.first())
            }

            if (syncAttempt.isFailure) {
                val error = syncAttempt.exceptionOrNull() ?: IOException("Unknown sync failure")
                if (error is ApiException && error.statusCode in setOf(401, 403)) {
                    attempted.forEach { (entry) ->
                        markSyncOperationFailed(entry, error)
                    }
                    accountStore.clearAccessToken()
                    throw MobileAuthenticationRequiredException()
                }
                if (error is ApiException && error.statusCode in 400..499 && error.statusCode != 429) {
                    val (entry, operation) = attempted.single()
                    rejectedReplacement = operation as? ReplaceProgramExerciseOperation
                        ?: rejectedReplacement
                    rejectedWorkoutMutation = operation as? MutateWorkoutExercisesOperation
                        ?: rejectedWorkoutMutation
                    blockRejectedOperation(
                        entry = entry,
                        operation = operation,
                        userError = syncOperationError(entry, error),
                    )
                    allAccepted = false
                    continue@syncLoop
                }
                attempted.forEach { (entry) ->
                    markSyncOperationFailed(entry, error)
                }
                throw error
            }
            val response = syncAttempt.getOrThrow()

            val applied = mutableListOf<String>()
            var incompleteResponse = false
            for ((index, pair) in attempted.withIndex()) {
                val (entry, operation) = pair
                val result = response.results.getOrNull(index)
                if (result == null || result.operationId != operation.operationId) {
                    dao.markOperationFailed(entry.operationId, "Server returned an incomplete sync response.")
                    allAccepted = false
                    incompleteResponse = true
                    break
                }
                when (result.status) {
                    "APPLIED", "DUPLICATE" -> applied += result.operationId
                    "REJECTED" -> {
                        rejectedReplacement = operation as? ReplaceProgramExerciseOperation
                            ?: rejectedReplacement
                        rejectedWorkoutMutation = operation as? MutateWorkoutExercisesOperation
                            ?: rejectedWorkoutMutation
                        blockRejectedOperation(
                            entry,
                            operation,
                            syncOperationError(entry, serverResponse = result.error ?: "Rejected"),
                        )
                        allAccepted = false
                        break
                    }
                    else -> {
                        rejectedReplacement = operation as? ReplaceProgramExerciseOperation
                            ?: rejectedReplacement
                        rejectedWorkoutMutation = operation as? MutateWorkoutExercisesOperation
                            ?: rejectedWorkoutMutation
                        blockRejectedOperation(
                            entry,
                            operation,
                            syncOperationError(
                                entry,
                                serverResponse = result.error ?: "Unknown sync status",
                            ),
                        )
                        allAccepted = false
                        break
                    }
                }
            }
            if (applied.isNotEmpty()) dao.removeOperations(applied)
            if (incompleteResponse) break
        }
        runCatching { refreshBootstrap() }
            .getOrNull()
            ?.let { authoritative ->
                rejectedReplacement?.let { operation ->
                    val watchCommand = reconcileExerciseReplacementWithAuthoritativeBootstrap(
                        operation = operation,
                        authoritative = authoritative,
                    )
                    dispatchPreparedWatchCommand(watchCommand)
                }
                rejectedWorkoutMutation?.let { operation ->
                    val watchCommand = reconcileWorkoutExerciseMutationRuntime(
                        operation = operation,
                        authoritative = authoritative,
                    )
                    dispatchPreparedWatchCommand(watchCommand)
                }
            }
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
                        gymEquipmentId = set.gymEquipmentId,
                        equipmentNameSnapshot = set.equipmentNameSnapshot,
                        selectedLoadKg = set.selectedLoadKg,
                        selectedLoadMultiplierSnapshot = set.selectedLoadMultiplierSnapshot,
                        nominalResistanceKg = set.nominalResistanceKg,
                        equipmentLoadSnapshotJson = set.equipmentLoadSnapshot?.toString(),
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

    private fun upsertOperation(
        set: LocalSetEntity,
        includeEquipmentIdentity: Boolean,
        frozenEquipmentSnapshot: MobileFrozenEquipmentSnapshot? = null,
    ) = UpsertSetOperation(
        operationId = operationId(),
        set = MobileSetPayload(
            id = set.id,
            sessionId = set.sessionId,
            exerciseId = set.exerciseId,
            gymEquipmentId = set.gymEquipmentId.takeIf { includeEquipmentIdentity },
            frozenEquipmentSnapshot = frozenEquipmentSnapshot,
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
        type = operation.wireType(),
        payloadJson = api.json.encodeToString<SyncOperation>(operation),
    )

    private suspend fun advancePhoneRuntime(
        sessionId: String,
        updatedAtEpochMs: Long,
        transform: (ActiveWorkoutRuntimeEntity) -> ActiveWorkoutRuntimeEntity,
    ): ActiveWorkoutRuntimeEntity? {
        val current = dao.getActiveWorkoutRuntime(sessionId) ?: return null
        val updated = nextPhoneRuntime(current, updatedAtEpochMs, transform)
        dao.saveActiveWorkoutRuntimeAndMarker(
            updated,
            watchMarker(updated, "RUNTIME_UPDATED"),
        )
        return updated
    }

    private suspend fun runtimeForPhoneSetMutation(
        sessionId: String,
        exerciseId: String,
        updatedAtEpochMs: Long,
    ): ActiveWorkoutRuntimeEntity {
        val session = checkNotNull(dao.getSession(sessionId)) {
            "Workout session is unavailable."
        }
        check(session.finishedAt == null) { "Workout is no longer active." }
        val current = dao.getActiveWorkoutRuntime(sessionId)
        if (current != null && current.workoutId == session.workoutId && current.status != "FINISHED") {
            return current
        }
        val revision = maxOf(
            1L,
            current?.revision ?: 0L,
            dao.getLatestWatchPeerForSession(sessionId)?.lastRevision ?: 0L,
            dao.getWatchResyncMarker(sessionId)?.revision ?: 0L,
            dao.getReplayableWatchOutboxEvents(sessionId).maxOfOrNull { it.revision } ?: 0L,
            dao.getAllSets(sessionId).maxOfOrNull { it.watchRevision ?: 0L } ?: 0L,
        )
        return ActiveWorkoutRuntimeEntity(
            sessionId = session.id,
            workoutId = session.workoutId,
            activeExerciseId = exerciseId,
            revision = revision,
            updatedAtEpochMs = updatedAtEpochMs,
            updatedBy = "PHONE",
        )
    }

    private fun scheduleSyncSafely() {
        try {
            scheduleSyncNow()
        } catch (_: Exception) {
            // The durable outbox remains available for periodic or manual retry.
        }
    }

    private fun nextPhoneRuntime(
        current: ActiveWorkoutRuntimeEntity,
        updatedAtEpochMs: Long,
        transform: (ActiveWorkoutRuntimeEntity) -> ActiveWorkoutRuntimeEntity,
    ) = transform(current).copy(
            revision = current.revision + 1,
            updatedAtEpochMs = updatedAtEpochMs,
            updatedBy = "PHONE",
        )

    private fun watchMarker(
        runtime: ActiveWorkoutRuntimeEntity,
        reason: String,
        enabled: Boolean = watchCommandPublisher.enabled,
    ): WatchResyncMarkerEntity? = if (!enabled) {
        null
    } else {
        WatchResyncMarkerEntity(
            sessionId = runtime.sessionId,
            revision = runtime.revision,
            reason = reason,
            createdAtEpochMs = runtime.updatedAtEpochMs,
            updatedAtEpochMs = runtime.updatedAtEpochMs,
        )
    }

    private fun phoneWatchEvent(
        sessionId: String,
        type: WatchEventType,
        revision: Long,
        timestamp: Long,
        payload: kotlinx.serialization.json.JsonObject,
    ) = WatchEventEnvelopeDto(
        protocolVersion = WatchProtocol.VERSION,
        schemaVersion = WatchProtocol.SCHEMA_VERSION,
        eventId = UUID.randomUUID().toString(),
        sessionId = sessionId,
        type = type,
        timestamp = timestamp,
        source = WatchEventSource.PHONE,
        deviceId = accountStore.deviceId,
        revision = revision,
        payload = payload,
    )

    private fun WatchEventEnvelopeDto.toOutboxEntity(): WatchOutboxEventEntity {
        val canonical = CanonicalJson.event(this)
        return WatchOutboxEventEntity(
            eventId = eventId,
            sessionId = sessionId,
            revision = revision,
            timestampEpochMs = timestamp,
            eventType = type.name,
            canonicalEventHash = canonical.sha256,
            envelopeJson = canonical.json,
            createdAtEpochMs = timestamp,
        )
    }

    private fun prepareWatchCommand(command: suspend () -> Unit): PreparedWatchCommand {
        val queue = watchCommandQueue ?: return PreparedWatchCommand(fallback = command)
        val queued = QueuedWatchCommand(command)
        return if (queue.trySend(queued).isSuccess) {
            PreparedWatchCommand(queued = queued)
        } else {
            PreparedWatchCommand(fallback = command)
        }
    }

    private suspend fun dispatchPreparedWatchCommand(prepared: PreparedWatchCommand?) {
        prepared ?: return
        prepared.queued?.released?.complete(Unit)
        prepared.fallback?.let { publishWatchSafely(it) }
    }

    private suspend fun publishWatchSafely(block: suspend () -> Unit) {
        try {
            block()
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            val runtime = dao.getLatestActiveWorkoutRuntime()
            val conflictId = UUID.randomUUID().toString()
            runCatching {
                dao.saveWatchConflict(
                    WatchConflictEntity(
                        conflictId = conflictId,
                        sessionId = runtime?.sessionId ?: "phone_watch_command",
                        eventId = conflictId,
                        entityType = "PHONE_COMMAND",
                        entityId = conflictId,
                        localRevision = runtime?.revision ?: 0,
                        remoteRevision = 0,
                        localEventJson = "",
                        remoteEventJson = "",
                        status = "UNRESOLVED",
                        errorCode = "PHONE_EVENT_MAPPING_FAILED",
                        detectedAtEpochMs = System.currentTimeMillis(),
                    ),
                )
            }
        }
    }

    private fun clearRestRuntime(runtime: ActiveWorkoutRuntimeEntity) = runtime.copy(
        activeSetId = null,
        restStartedAtEpochMs = null,
        restEndsAtEpochMs = null,
        restDurationSeconds = null,
        restPausedRemainingMs = null,
    )

    private data class QueuedWatchCommand(
        val command: suspend () -> Unit,
        val released: CompletableDeferred<Unit> = CompletableDeferred(),
    )

    private data class PreparedWatchCommand(
        val queued: QueuedWatchCommand? = null,
        val fallback: (suspend () -> Unit)? = null,
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

    private sealed interface WatchSetEquipmentResolution {
        data class Allowed(
            val set: LocalSetEntity,
            val frozenSnapshot: MobileFrozenEquipmentSnapshot?,
        ) : WatchSetEquipmentResolution

        data class Rejected(val errorCode: String) : WatchSetEquipmentResolution
    }

    private suspend fun resolveNewWatchSetEquipment(
        set: LocalSetEntity,
    ): WatchSetEquipmentResolution {
        val session = dao.getSession(set.sessionId)
            ?: return WatchSetEquipmentResolution.Rejected("EQUIPMENT_SELECTION_REQUIRED")
        val cached = dao.getBootstrap()
            ?: return WatchSetEquipmentResolution.Rejected("EQUIPMENT_SELECTION_REQUIRED")
        val bootstrap = runCatching {
            api.json.decodeFromString<BootstrapResponse>(cached.payloadJson)
        }.getOrNull() ?: return WatchSetEquipmentResolution.Rejected("EQUIPMENT_SELECTION_REQUIRED")
        val workout = bootstrap.activeProgram?.workouts?.firstOrNull { it.id == session.workoutId }
            ?: bootstrap.openSessions.firstOrNull { it.id == session.id }?.workout
            ?: return WatchSetEquipmentResolution.Rejected("EQUIPMENT_SELECTION_REQUIRED")
        val exercise = workout.exercises.firstOrNull { it.exerciseId == set.exerciseId }?.exercise
            ?: return WatchSetEquipmentResolution.Rejected("EQUIPMENT_SELECTION_REQUIRED")
        val gymId = session.gymId
            ?: return WatchSetEquipmentResolution.Allowed(set = set, frozenSnapshot = null)
        val gym = bootstrap.gyms.firstOrNull { it.id == gymId }
            ?: return WatchSetEquipmentResolution.Rejected("EQUIPMENT_SELECTION_REQUIRED")
        if (gym.inventoryMode != "EQUIPMENT_FIRST") {
            return WatchSetEquipmentResolution.Allowed(set = set, frozenSnapshot = null)
        }
        val compatible = gym.equipment.filter { equipment ->
            equipment.exerciseLinks.any { link -> link.exerciseId == set.exerciseId }
        }
        if (compatible.isEmpty()) {
            return if (
                exercise.usesBodyweight ||
                exercise.equipmentType == "BODYWEIGHT" ||
                exercise.equipmentType == "CARDIO" ||
                exercise.category == "CARDIO"
            ) {
                WatchSetEquipmentResolution.Allowed(set = set, frozenSnapshot = null)
            } else {
                WatchSetEquipmentResolution.Rejected("EQUIPMENT_SELECTION_REQUIRED")
            }
        }
        val equipment = compatible.singleOrNull()
            ?: return WatchSetEquipmentResolution.Rejected("EQUIPMENT_SELECTION_REQUIRED")
        val selectedLoad = roundLoad(set.weight)
        val nominalResistance = equipment
            .takeIf { it.loadType == "SELECTORIZED" }
            ?.let { roundLoad(selectedLoad * it.selectedLoadMultiplier) }
        val frozenSnapshot = frozenEquipmentSnapshot(equipment, selectedLoad, nominalResistance)
            ?: return WatchSetEquipmentResolution.Rejected("EQUIPMENT_SELECTION_REQUIRED")
        val inferredSet = set.copy(
            weight = selectedLoad,
            gymEquipmentId = equipment.id,
            equipmentNameSnapshot = equipment.name,
            selectedLoadKg = selectedLoad,
            selectedLoadMultiplierSnapshot = equipment.selectedLoadMultiplier,
            nominalResistanceKg = nominalResistance,
            equipmentLoadSnapshotJson = api.json.encodeToString(
                frozenSnapshot.equipmentLoadSnapshot,
            ),
        )
        val frozenState = frozenEquipmentLoadState(inferredSet)
        if (
            frozenState !is FrozenEquipmentLoadState.Supported ||
            !isAchievableLoad(frozenState.constraints, selectedLoad)
        ) {
            return WatchSetEquipmentResolution.Rejected("INVALID_EQUIPMENT_LOAD")
        }
        return WatchSetEquipmentResolution.Allowed(
            set = inferredSet,
            frozenSnapshot = frozenSnapshot,
        )
    }

    private suspend fun saveWatchEquipmentConflict(
        processed: WatchProcessedEventEntity,
        set: LocalSetEntity,
        runtime: ActiveWorkoutRuntimeEntity,
        errorCode: String,
    ) {
        val localRevision = (runtime.revision - 1).coerceAtLeast(0)
        dao.saveWatchConflict(
            WatchConflictEntity(
                conflictId = "watch_equipment_${processed.eventId}",
                sessionId = set.sessionId,
                eventId = processed.eventId,
                entityType = "SET",
                entityId = set.id,
                localRevision = localRevision,
                remoteRevision = processed.revision,
                localEventJson = buildJsonObject {
                    put("runtimeRevision", localRevision)
                    put("gymEquipmentId", JsonNull)
                }.toString(),
                remoteEventJson = buildJsonObject {
                    put("setId", set.id)
                    put("exerciseId", set.exerciseId)
                    put("weight", set.weight)
                    put("reps", set.reps)
                    set.rir?.let { put("rir", it) } ?: put("rir", JsonNull)
                }.toString(),
                status = "UNRESOLVED",
                errorCode = errorCode,
                detectedAtEpochMs = System.currentTimeMillis(),
            ),
        )
    }

    private fun entityId(type: String) = "mob_${type}_${UUID.randomUUID().toString().replace("-", "")}"
    private fun operationId() = "op_${UUID.randomUUID().toString().replace("-", "")}"

    private fun equipmentSnapshotJson(
        equipment: GymEquipmentDto,
        selectedLoadKg: Double,
        nominalResistanceKg: Double?,
    ): String = buildJsonObject {
        put("version", 1)
        put("loadType", equipment.loadType)
        put("equipmentType", equipment.equipmentType)
        put("selectedLoadKg", selectedLoadKg)
        put("selectedLoadMultiplier", roundLoad(equipment.selectedLoadMultiplier))
        if (nominalResistanceKg == null) put("nominalResistanceKg", JsonNull)
        else put("nominalResistanceKg", nominalResistanceKg)
        put("baseLoadKg", equipment.baseLoadKg)
        put("loadingSides", equipment.loadingSides)
        val pool = equipment.platePool
        if (pool == null) {
            put("platePool", JsonNull)
        } else {
            put(
                "platePool",
                buildJsonObject {
                    put("id", pool.id)
                    put("name", pool.name)
                    put("compatibilityKey", pool.compatibilityKey)
                },
            )
        }
    }.toString()

    private fun frozenEquipmentSnapshot(
        equipment: GymEquipmentDto,
        selectedLoadKg: Double,
        nominalResistanceKg: Double?,
    ): MobileFrozenEquipmentSnapshot? {
        val revisionId = equipment.snapshotRevisionId ?: return null
        val loadSnapshot = MobileFrozenEquipmentLoadSnapshot(
            revisionId = revisionId,
            gymEquipmentId = equipment.id,
            loadType = equipment.loadType,
            equipmentType = equipment.equipmentType,
            selectedLoadKg = selectedLoadKg,
            selectedLoadMultiplier = equipment.selectedLoadMultiplier,
            nominalResistanceKg = nominalResistanceKg,
            baseLoadKg = equipment.baseLoadKg,
            loadingSides = equipment.loadingSides,
            weightOptions = equipment.weightOptions,
            platePool = equipment.platePool?.let { pool ->
                MobileFrozenPlatePoolSnapshot(
                    id = pool.id,
                    name = pool.name,
                    compatibilityKey = pool.compatibilityKey,
                    plates = pool.plates.map { plate ->
                        MobileFrozenPlateInventoryItemSnapshot(
                            weightKg = plate.weightKg,
                            quantity = plate.quantity,
                        )
                    },
                )
            },
        )
        return MobileFrozenEquipmentSnapshot(
            equipmentNameSnapshot = equipment.name,
            selectedLoadKg = selectedLoadKg,
            selectedLoadMultiplierSnapshot = equipment.selectedLoadMultiplier,
            nominalResistanceKg = nominalResistanceKg,
            equipmentLoadSnapshot = loadSnapshot,
        )
    }

    private fun snapshotLoadType(snapshotJson: String?): String? = runCatching {
        snapshotJson?.let { api.json.parseToJsonElement(it).jsonObject["loadType"]?.toString()?.trim('"') }
    }.getOrNull()

    private fun updateEquipmentSnapshotJson(
        snapshotJson: String?,
        selectedLoadKg: Double?,
        nominalResistanceKg: Double?,
    ): String? {
        if (snapshotJson == null || selectedLoadKg == null) return snapshotJson
        return runCatching {
            val current = api.json.parseToJsonElement(snapshotJson).jsonObject
            buildJsonObject {
                current.forEach { (key, value) -> put(key, value) }
                put("selectedLoadKg", selectedLoadKg)
                if (nominalResistanceKg == null) put("nominalResistanceKg", JsonNull)
                else put("nominalResistanceKg", nominalResistanceKg)
            }.toString()
        }.getOrDefault(snapshotJson)
    }

    private fun roundLoad(value: Double): Double = kotlin.math.round(value * 100) / 100
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
            is UpdatePreferredEquipmentOperation -> Unit
            is MutateWorkoutExercisesOperation -> sessionIds += operation.sessionId
            is ReplaceProgramExerciseOperation -> Unit
        }
    }
    return PendingMutationTargets(sessionIds, setIds, deletedSessionIds, complete = true)
}

internal fun SyncOperation.wireType(): String = when (this) {
    is StartSessionOperation -> "START_SESSION"
    is UpsertSetOperation -> "UPSERT_SET"
    is DeleteSetOperation -> "DELETE_SET"
    is DeleteSessionOperation -> "DELETE_SESSION"
    is UpdateTargetSetsOperation -> "UPDATE_TARGET_SETS"
    is UpdatePreferredEquipmentOperation -> "UPDATE_PREFERRED_EQUIPMENT"
    is MutateWorkoutExercisesOperation -> "MUTATE_WORKOUT_EXERCISES"
    is ReplaceProgramExerciseOperation -> "REPLACE_PROGRAM_EXERCISE"
    is FinishSessionOperation -> "FINISH_SESSION"
}

internal fun syncOrderingKeys(
    operation: SyncOperation,
    setSessions: Map<String, String> = emptyMap(),
): Set<String> = buildSet {
    fun session(id: String) {
        add("session:$id")
    }
    fun set(id: String) {
        add("set:$id")
        setSessions[id]?.let(::session)
    }
    fun programExercise(id: String) {
        add("program-exercise:$id")
    }

    when (operation) {
        is StartSessionOperation -> session(operation.session.id)
        is UpsertSetOperation -> {
            session(operation.set.sessionId)
            set(operation.set.id)
        }
        is DeleteSetOperation -> set(operation.setId)
        is DeleteSessionOperation -> session(operation.sessionId)
        is FinishSessionOperation -> session(operation.sessionId)
        is UpdateTargetSetsOperation -> programExercise(operation.programExerciseId)
        is UpdatePreferredEquipmentOperation ->
            add("preferred-equipment:${operation.gymId}:${operation.exerciseId}")
        is MutateWorkoutExercisesOperation -> {
            session(operation.sessionId)
            add("workout:${operation.workoutId}")
            (operation.previousExercises + operation.exercises).forEach { exercise ->
                programExercise(exercise.id)
            }
        }
        is ReplaceProgramExerciseOperation -> {
            session(operation.sessionId)
            programExercise(operation.programExerciseId)
        }
    }
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

internal fun findProgramExercise(
    bootstrap: BootstrapResponse,
    programExerciseId: String,
): ProgramExerciseDto? = bootstrap.activeProgram?.workouts
    ?.asSequence()
    ?.flatMap { it.exercises.asSequence() }
    ?.firstOrNull { it.id == programExerciseId }
    ?: bootstrap.openSessions.asSequence()
        .mapNotNull { it.workout }
        .flatMap { it.exercises.asSequence() }
        .firstOrNull { it.id == programExerciseId }

internal fun findWorkout(
    bootstrap: BootstrapResponse,
    workoutId: String,
): WorkoutDto? = bootstrap.activeProgram?.workouts?.firstOrNull { it.id == workoutId }
    ?: bootstrap.openSessions.asSequence()
        .mapNotNull { it.workout }
        .firstOrNull { it.id == workoutId }

internal fun validateWorkoutExerciseMutation(exercise: ProgramExerciseDto) {
    require(exercise.targetSets in 1..20) { "Target sets must be between 1 and 20." }
    require(exercise.targetDropSets in 0..10) { "Drop sets must be between 0 and 10." }
    require(exercise.targetRepsMin in 1..50 && exercise.targetRepsMax in 1..50) {
        "Target repetitions must be between 1 and 50."
    }
    require(exercise.targetRepsMin <= exercise.targetRepsMax) {
        "Maximum repetitions must be at least the minimum."
    }
    require(exercise.targetRIR in 0..5) { "Target RIR must be between 0 and 5." }
    require(exercise.restSec in 15..900) { "Rest must be between 15 and 900 seconds." }
    require(exercise.notes == null || exercise.notes.length <= 2000) {
        "Program note must not exceed 2000 characters."
    }
    require(exercise.supersetGroup == null || exercise.supersetGroup in 1..9) {
        "Superset group must be between 1 and 9."
    }
    require(exercise.autoregulationMode in setOf("PRESERVE_RIR", "PRESERVE_REPS")) {
        "Unsupported autoregulation mode."
    }
}

internal fun ProgramExerciseDto.toMutationDto() = MobileWorkoutExerciseMutationDto(
    id = id,
    exerciseId = exerciseId,
    order = order,
    targetSets = targetSets,
    targetDropSets = targetDropSets,
    targetRepsMin = targetRepsMin,
    targetRepsMax = targetRepsMax,
    targetRIR = targetRIR,
    restSec = restSec,
    tempo = tempo,
    notes = notes,
    supersetGroup = supersetGroup,
    autoregulationMode = autoregulationMode,
    fatigueRate = fatigueRate,
    loadAdjustmentPct = loadAdjustmentPct,
)

internal fun List<MobileWorkoutExerciseMutationDto>.canonicalWorkoutMutation() =
    sortedWith(compareBy<MobileWorkoutExerciseMutationDto> { it.order }.thenBy { it.id })

internal fun MobileWorkoutExerciseMutationDto.toProgramExerciseDto(
    bootstrap: BootstrapResponse,
    workoutId: String,
): ProgramExerciseDto {
    val exercise = bootstrap.catalog.firstOrNull { it.id == exerciseId }
        ?: findWorkout(bootstrap, workoutId)
            ?.exercises
            ?.firstOrNull { it.exerciseId == exerciseId }
            ?.exercise
        ?: error("Exercise $exerciseId is unavailable in the cached catalog.")
    return ProgramExerciseDto(
        id = id,
        workoutId = workoutId,
        exerciseId = exerciseId,
        order = order,
        targetSets = targetSets,
        targetDropSets = targetDropSets,
        targetRepsMin = targetRepsMin,
        targetRepsMax = targetRepsMax,
        targetRIR = targetRIR,
        restSec = restSec,
        tempo = tempo,
        notes = notes,
        supersetGroup = supersetGroup,
        autoregulationMode = autoregulationMode,
        fatigueRate = fatigueRate,
        loadAdjustmentPct = loadAdjustmentPct,
        exercise = exercise,
    )
}

internal fun replaceWorkoutExercisesInBootstrap(
    bootstrap: BootstrapResponse,
    workoutId: String,
    exercises: List<ProgramExerciseDto>,
): BootstrapResponse {
    fun updateWorkout(workout: WorkoutDto): WorkoutDto =
        if (workout.id == workoutId) workout.copy(exercises = exercises) else workout

    fun updateNormalRecommendations(
        recommendations: Map<String, org.sharteman.gymcoach.data.model.ReturnRecommendationDto>,
    ): Map<String, org.sharteman.gymcoach.data.model.ReturnRecommendationDto> {
        val byId = exercises.associateBy { it.id }
        return recommendations.mapNotNull { (programExerciseId, recommendation) ->
            val exercise = byId[programExerciseId] ?: return@mapNotNull null
            programExerciseId to if (recommendation.mode == "normal") {
                recommendation.copy(
                    targetSets = exercise.targetSets,
                    targetRIR = exercise.targetRIR,
                )
            } else {
                recommendation
            }
        }.toMap()
    }

    fun updateEquipmentRecommendations(
        recommendations: Map<
            String,
            List<org.sharteman.gymcoach.data.model.EquipmentReturnRecommendationDto>,
        >,
    ): Map<String, List<org.sharteman.gymcoach.data.model.EquipmentReturnRecommendationDto>> {
        val byId = exercises.associateBy { it.id }
        return recommendations.mapNotNull { (programExerciseId, items) ->
            val exercise = byId[programExerciseId] ?: return@mapNotNull null
            programExerciseId to items.map { item ->
                if (item.recommendation.mode == "normal") {
                    item.copy(
                        recommendation = item.recommendation.copy(
                            targetSets = exercise.targetSets,
                            targetRIR = exercise.targetRIR,
                        ),
                    )
                } else {
                    item
                }
            }
        }.toMap()
    }

    return bootstrap.copy(
        activeProgram = bootstrap.activeProgram?.let { program ->
            program.copy(workouts = program.workouts.map(::updateWorkout))
        },
        openSessions = bootstrap.openSessions.map { session ->
            session.copy(workout = session.workout?.let(::updateWorkout))
        },
        returnRecommendationsByWorkout = bootstrap.returnRecommendationsByWorkout.mapValues {
            (id, recommendations) ->
            if (id == workoutId) updateNormalRecommendations(recommendations) else recommendations
        },
        returnRecommendationsByEquipmentByWorkout =
            bootstrap.returnRecommendationsByEquipmentByWorkout.mapValues { (id, recommendations) ->
                if (id == workoutId) updateEquipmentRecommendations(recommendations) else recommendations
            },
    )
}

internal fun replaceProgramExerciseInBootstrap(
    bootstrap: BootstrapResponse,
    programExerciseId: String,
    replacementExerciseId: String,
): BootstrapResponse {
    val replacement = bootstrap.catalog.firstOrNull { it.id == replacementExerciseId }
        ?: return bootstrap
    fun updateWorkout(workout: WorkoutDto): WorkoutDto = workout.copy(
        exercises = workout.exercises.map { target ->
            if (target.id == programExerciseId) {
                target.copy(exerciseId = replacement.id, exercise = replacement)
            } else {
                target
            }
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

internal fun updatePreferredEquipmentInBootstrap(
    bootstrap: BootstrapResponse,
    gymId: String,
    exerciseId: String,
    preferredEquipmentId: String?,
): BootstrapResponse {
    val exercise = bootstrap.catalog.firstOrNull { it.id == exerciseId }
    val expectedEquipmentType = exercise?.let { resolveEquipmentType(it.equipmentType, it.name) }
    return bootstrap.copy(gyms = bootstrap.gyms.map { gym ->
        if (gym.id != gymId) return@map gym
        val linkedPreference = preferredEquipmentId?.takeIf { equipmentId ->
            gym.equipment.any { equipment ->
                equipment.id == equipmentId &&
                    equipment.equipmentType == expectedEquipmentType &&
                    equipment.exerciseLinks.any { it.exerciseId == exerciseId }
            }
        }
        val current = gym.exerciseConfigs.firstOrNull { it.exerciseId == exerciseId }
        if (current == null && linkedPreference == null) return@map gym
        val updatedConfig = current?.copy(preferredEquipmentId = linkedPreference)
            ?: GymExerciseConfigDto(
                gymId = gymId,
                exerciseId = exerciseId,
                preferredEquipmentId = linkedPreference,
            )
        gym.copy(
            exerciseConfigs = gym.exerciseConfigs
                .filterNot { it.exerciseId == exerciseId } + updatedConfig,
        )
    })
}

internal fun applyExerciseInputToBootstrap(
    bootstrap: BootstrapResponse,
    exerciseId: String,
    input: ExerciseInput,
): BootstrapResponse = updateBootstrapExercise(bootstrap, exerciseId) { current ->
    current.withGeneralMetadata(input)
}

internal fun mergeExerciseMetadataIntoBootstrap(
    bootstrap: BootstrapResponse,
    updated: ExerciseDto,
): BootstrapResponse = updateBootstrapExercise(bootstrap, updated.id) { current ->
    updated.copy(
        userId = updated.userId ?: current.userId,
        loadProfile = updated.loadProfile ?: current.loadProfile,
        trainingDates = updated.trainingDates.ifEmpty { current.trainingDates },
    )
}

internal fun consumeProtectedExerciseEditReceipts(
    receipts: Map<String, ExerciseInput>,
    protectedEdits: Map<String, ExerciseInput>,
): Map<String, ExerciseInput> = receipts.filterNot { (exerciseId, input) ->
    protectedEdits[exerciseId] == input
}

private fun updateBootstrapExercise(
    bootstrap: BootstrapResponse,
    exerciseId: String,
    update: (ExerciseDto) -> ExerciseDto,
): BootstrapResponse {
    fun updateExercise(current: ExerciseDto): ExerciseDto =
        if (current.id == exerciseId) update(current) else current

    fun updateWorkout(workout: WorkoutDto): WorkoutDto = workout.copy(
        exercises = workout.exercises.map { target ->
            if (target.exerciseId == exerciseId) {
                target.copy(exercise = updateExercise(target.exercise))
            } else {
                target
            }
        },
    )

    return bootstrap.copy(
        catalog = bootstrap.catalog.map(::updateExercise),
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
                    gymId = session.gymId,
                    localOnly = true,
                    sets = exerciseSets.sortedWith(compareBy<LocalSetEntity> { it.setNumber }.thenBy { it.completedAt })
                        .map { set ->
                            ExerciseHistorySetDto(
                                setNumber = set.setNumber,
                                weight = set.weight,
                                reps = set.reps,
                                rir = set.rir,
                                isDropSet = set.isDropSet,
                                gymEquipmentId = set.gymEquipmentId,
                                equipmentName = set.equipmentNameSnapshot,
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
    val type: String,
    val attempts: Int,
    val createdAtEpochMs: Long,
    val lastRetryAtEpochMs: Long,
    val userError: UserFacingError,
    val discardScope: SyncIssueDiscardScope = SyncIssueDiscardScope.SINGLE_OPERATION,
) {
    val canRetry: Boolean get() = userError.retryable
}

enum class SyncIssueDiscardScope {
    SINGLE_OPERATION,
    SESSION_AND_RELATED_CHANGES,
}

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
