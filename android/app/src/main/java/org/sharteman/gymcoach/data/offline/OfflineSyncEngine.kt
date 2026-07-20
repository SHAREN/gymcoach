package org.sharteman.gymcoach.data.offline

import java.io.IOException
import kotlin.math.pow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import org.sharteman.gymcoach.data.model.MobileHistorySnapshot
import org.sharteman.gymcoach.data.network.ApiException
import org.sharteman.gymcoach.data.network.HistoryMutationRemote
import org.sharteman.gymcoach.data.programs.ClientMutationMetadata
import org.sharteman.gymcoach.data.programs.ProgramsCatalogRemoteDataSource
import org.sharteman.gymcoach.data.programs.hasGeneralMetadata

class OfflineSyncEngine(
    private val persistence: OfflinePersistence,
    private val networkStatus: NetworkStatus,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val mutex = OfflineSyncLock.mutex

    suspend fun sync(
        accountKey: String,
        baseUrl: String,
        token: String,
        catalogRemote: ProgramsCatalogRemoteDataSource,
        historyApi: HistoryMutationRemote,
    ): Boolean = mutex.withLock {
        if (!networkStatus.isConnected()) throw OfflineSyncRetryException("Network is unavailable.")
        while (true) {
            val queue = persistence.operations(accountKey)
            val head = queue.firstOrNull() ?: return@withLock true
            if (head.status == OFFLINE_STATUS_BLOCKED) return@withLock false
            if (head.mutation is CorruptOfflineMutation) {
                persistence.markBlocked(
                    head.mutation.operationId,
                    "Stored offline operation cannot be decoded.",
                )
                return@withLock false
            }
            if (head.nextAttemptAtEpochMs > now()) {
                throw OfflineSyncRetryException("Offline changes are waiting for the retry backoff.")
            }
            try {
                applyRemote(head.mutation, baseUrl, token, catalogRemote, historyApi)
                complete(accountKey, head.mutation)
            } catch (error: ApiException) {
                if (error.statusCode == 404 && head.mutation.isDelete()) {
                    complete(accountKey, head.mutation)
                    continue
                }
                if (error.statusCode == 401 || error.statusCode == 403) {
                    failWithBackoff(head, "Mobile authentication expired.", error.retryAfterSeconds)
                    throw error
                }
                if (error.statusCode == 408 || error.statusCode == 429 || error.statusCode >= 500) {
                    failWithBackoff(head, error.message ?: "Server is temporarily unavailable.", error.retryAfterSeconds)
                    throw OfflineSyncRetryException("Server is temporarily unavailable.", error)
                }
                persistence.markBlocked(
                    head.mutation.operationId,
                    error.message ?: "Server rejected the offline change.",
                )
                return@withLock false
            } catch (error: IOException) {
                if (error is OfflineSyncRetryException) throw error
                failWithBackoff(head, error.message ?: "Network synchronization failed.", null)
                throw OfflineSyncRetryException("Network synchronization failed.", error)
            }
        }
        @Suppress("UNREACHABLE_CODE")
        false
    }

    private suspend fun applyRemote(
        mutation: OfflineMutation,
        baseUrl: String,
        token: String,
        catalog: ProgramsCatalogRemoteDataSource,
        history: HistoryMutationRemote,
    ) {
        when (mutation) {
            is CorruptOfflineMutation -> error("Corrupt operations must be blocked before replay.")
            is CreateProgramMutation -> catalog.createProgram(
                mutation.input,
                ClientMutationMetadata(mutation.operationId, mutation.programId),
            )
            is UpdateProgramMutation -> catalog.updateProgram(mutation.programId, mutation.input)
            is DeleteProgramMutation -> catalog.deleteProgram(mutation.programId)
            is SetProgramActiveMutation -> catalog.setProgramActive(mutation.programId, mutation.active)
            is CreateWorkoutMutation -> catalog.createWorkout(
                mutation.programId,
                mutation.input,
                ClientMutationMetadata(mutation.operationId, mutation.workoutId),
            )
            is UpdateWorkoutMutation -> catalog.updateWorkout(mutation.workoutId, mutation.input)
            is DeleteWorkoutMutation -> catalog.deleteWorkout(mutation.workoutId)
            is CreateProgramExerciseMutation -> catalog.createProgramExercise(
                mutation.workoutId,
                mutation.input,
                ClientMutationMetadata(mutation.operationId, mutation.programExerciseId),
            )
            is UpdateProgramExerciseMutation ->
                catalog.updateProgramExercise(mutation.programExerciseId, mutation.input)
            is DeleteProgramExerciseMutation -> catalog.deleteProgramExercise(mutation.programExerciseId)
            is CreateExerciseMutation -> catalog.createExercise(
                mutation.input,
                ClientMutationMetadata(mutation.operationId, mutation.exerciseId),
            )
            is UpdateExerciseMutation -> {
                val current = catalog.getExercise(mutation.exerciseId)
                if (!current.hasGeneralMetadata(mutation.input)) {
                    val expected = mutation.expected
                    if (expected == null || !current.hasGeneralMetadata(expected)) {
                        throw ApiException(409, "Exercise changed before the offline edit was synchronized.")
                    }
                    catalog.updateExercise(
                        mutation.exerciseId,
                        mutation.input,
                        ClientMutationMetadata(mutation.operationId, mutation.exerciseId),
                    )
                }
            }
            is DeleteExerciseMutation -> catalog.deleteExercise(mutation.exerciseId)
            is DeleteHistorySessionMutation ->
                history.deleteHistorySession(baseUrl, token, mutation.sessionId)
        }
    }

    private suspend fun complete(accountKey: String, mutation: OfflineMutation) {
        val cacheUpdates = when (mutation.domain) {
            OFFLINE_DOMAIN_CATALOG -> {
                val cacheKey = catalogCacheKey(accountKey)
                val base = persistence.readCache(cacheKey)
                    ?.let { runCatching { offlineJson.decodeFromString<CatalogSnapshot>(it) }.getOrNull() }
                    ?: CatalogSnapshot()
                listOf(
                    OfflineCacheUpdate(
                        accountKey,
                        OFFLINE_DOMAIN_CATALOG,
                        cacheKey,
                        offlineJson.encodeToString(applyCatalogMutation(base, mutation)),
                    ),
                )
            }
            OFFLINE_DOMAIN_HISTORY -> {
                val deletedSessionId = (mutation as DeleteHistorySessionMutation).sessionId
                persistence.readDomainCaches(accountKey, OFFLINE_DOMAIN_HISTORY).mapNotNull { (key, payload) ->
                    val snapshot = runCatching {
                        offlineJson.decodeFromString<MobileHistorySnapshot>(payload)
                    }.getOrNull() ?: return@mapNotNull null
                    OfflineCacheUpdate(
                        accountKey,
                        OFFLINE_DOMAIN_HISTORY,
                        key,
                        offlineJson.encodeToString(
                            snapshot.copy(sessions = snapshot.sessions.filterNot { it.id == deletedSessionId }),
                        ),
                    )
                }
            }
            else -> emptyList()
        }
        persistence.complete(mutation.operationId, cacheUpdates)
    }

    private suspend fun failWithBackoff(
        operation: StoredOfflineMutation,
        message: String,
        retryAfterSeconds: Int?,
    ) {
        val delayMs = retryAfterSeconds?.coerceAtLeast(1)?.times(1_000L)
            ?: backoffDelayMs(operation.attempts + 1)
        persistence.markFailed(operation.mutation.operationId, message, now() + delayMs)
    }
}

class OfflineMutationController(
    private val persistence: OfflinePersistence,
    private val scheduleSync: () -> Unit,
) {
    private val mutex = OfflineSyncLock.mutex

    suspend fun retry(operationId: String): Boolean = mutex.withLock {
        val operation = persistence.operation(operationId) ?: return@withLock false
        persistence.retry(operation.mutation.operationId)
        scheduleSync()
        true
    }

    suspend fun discard(operationId: String): Boolean = mutex.withLock {
        val target = persistence.operation(operationId) ?: return@withLock false
        val queue = persistence.operations(target.accountKey)
        val discarded = linkedMapOf(target.mutation.operationId to target.mutation)
        var changed: Boolean
        do {
            changed = false
            queue.forEach { entry ->
                if (entry.mutation.operationId in discarded) return@forEach
                if (discarded.values.any { entry.mutation.dependsOn(it) }) {
                    discarded[entry.mutation.operationId] = entry.mutation
                    changed = true
                }
            }
        } while (changed)
        persistence.remove(discarded.keys.toList())
        scheduleSync()
        true
    }
}

internal fun OfflineMutation.isDelete(): Boolean = when (this) {
    is CorruptOfflineMutation -> false
    is DeleteProgramMutation,
    is DeleteWorkoutMutation,
    is DeleteProgramExerciseMutation,
    is DeleteExerciseMutation,
    is DeleteHistorySessionMutation,
    -> true
    else -> false
}

internal fun backoffDelayMs(attempt: Int): Long {
    val exponent = (attempt - 1).coerceIn(0, 8)
    return (5_000.0 * 2.0.pow(exponent)).toLong().coerceAtMost(15 * 60_000L)
}

class OfflineSyncRetryException(message: String, cause: Throwable? = null) : IOException(message, cause)

internal object OfflineSyncLock {
    val mutex = Mutex()
}

fun catalogCacheKey(accountKey: String): String = "$accountKey|catalog"

fun historyCacheKey(accountKey: String, month: String, programId: String?): String =
    "$accountKey|history|$month|${programId ?: "all"}"
