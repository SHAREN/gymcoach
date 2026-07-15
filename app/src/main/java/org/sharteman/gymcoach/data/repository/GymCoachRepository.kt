package org.sharteman.gymcoach.data.repository

import android.os.Build
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import org.sharteman.gymcoach.data.local.BootstrapCacheEntity
import org.sharteman.gymcoach.data.local.GymCoachDao
import org.sharteman.gymcoach.data.local.LocalSessionEntity
import org.sharteman.gymcoach.data.local.LocalSetEntity
import org.sharteman.gymcoach.data.local.SyncOutboxEntity
import org.sharteman.gymcoach.data.model.BootstrapResponse
import org.sharteman.gymcoach.data.model.DeleteSetOperation
import org.sharteman.gymcoach.data.model.FinishSessionOperation
import org.sharteman.gymcoach.data.model.GymEquipmentDto
import org.sharteman.gymcoach.data.model.LoginRequest
import org.sharteman.gymcoach.data.model.MobileFrozenEquipmentLoadSnapshot
import org.sharteman.gymcoach.data.model.MobileFrozenEquipmentSnapshot
import org.sharteman.gymcoach.data.model.MobileFrozenPlateInventoryItemSnapshot
import org.sharteman.gymcoach.data.model.MobileFrozenPlatePoolSnapshot
import org.sharteman.gymcoach.data.model.MobileSessionPayload
import org.sharteman.gymcoach.data.model.MobileSetPayload
import org.sharteman.gymcoach.data.model.StartSessionOperation
import org.sharteman.gymcoach.data.model.SyncBatchRequest
import org.sharteman.gymcoach.data.model.SyncOperation
import org.sharteman.gymcoach.data.model.UpsertSetOperation
import org.sharteman.gymcoach.data.model.WorkoutDto
import org.sharteman.gymcoach.data.network.MobileApi
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
    val openSessions: Flow<List<LocalSessionEntity>> = dao.observeOpenSessions()
    val pendingCount: Flow<Int> = dao.observePendingCount()
    val syncIssue: Flow<SyncIssue?> = dao.observeBlockedOperation().map { operation ->
        operation?.let {
            SyncIssue(
                operationId = it.operationId,
                message = it.lastError ?: "Server rejected a queued change.",
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
        val previousIdentity = accountStore.userId ?: accountStore.userEmail
        val accountChanged = previousIdentity != null &&
            (previousIdentity != response.user.id && previousIdentity != response.user.email ||
                accountStore.serverUrl != candidateServerUrl)
        if (accountChanged) dao.clearAccountData()
        accountStore.serverUrl = candidateServerUrl
        accountStore.setAccessToken(response.accessToken)
        accountStore.userId = response.user.id
        accountStore.userEmail = response.user.email
        refreshBootstrap()
        schedulePeriodicSync()
    }

    suspend fun logout() = syncMutex.withLock {
        check(dao.queuedOperations().isEmpty()) { "Sync pending changes before signing out." }
        val token = accountStore.getAccessToken()
        if (token != null) runCatching { api.logout(accountStore.serverUrl, token) }
        accountStore.clearAccount()
        dao.clearAccountData()
    }

    suspend fun retryBlockedChange() = syncMutex.withLock {
        val blocked = dao.queuedOperations().firstOrNull { it.status == "BLOCKED" } ?: return@withLock
        dao.retryOperation(blocked.operationId)
        scheduleSyncNow()
    }

    suspend fun discardBlockedChange() = syncMutex.withLock {
        val queue = dao.queuedOperations()
        val blocked = queue.firstOrNull { it.status == "BLOCKED" } ?: return@withLock
        val operation = runCatching {
            api.json.decodeFromString<SyncOperation>(blocked.payloadJson)
        }.getOrNull()
        if (operation is StartSessionOperation) {
            val sessionId = operation.session.id
            val localSetIds = dao.getAllSets(sessionId).mapTo(mutableSetOf()) { it.id }
            val relatedOperationIds = queue.mapNotNull { entry ->
                val queued = runCatching {
                    api.json.decodeFromString<SyncOperation>(entry.payloadJson)
                }.getOrNull()
                val related = when (queued) {
                    is StartSessionOperation -> queued.session.id == sessionId
                    is UpsertSetOperation -> queued.set.sessionId == sessionId
                    is FinishSessionOperation -> queued.sessionId == sessionId
                    is DeleteSetOperation -> queued.setId in localSetIds
                    null -> entry.operationId == blocked.operationId
                }
                entry.operationId.takeIf { related }
            }
            dao.removeOperations(relatedOperationIds)
            dao.deleteSessionLocal(sessionId)
        } else {
            dao.removeOperations(listOf(blocked.operationId))
        }
        runCatching { refreshBootstrap() }
        scheduleSyncNow()
    }

    suspend fun refreshBootstrap(): BootstrapResponse {
        val token = requireNotNull(accountStore.getAccessToken()) { "Not signed in" }
        val response = api.bootstrap(accountStore.serverUrl, token)
        dao.saveBootstrap(
            BootstrapCacheEntity(
                payloadJson = api.json.encodeToString(response),
                updatedAtEpochMs = System.currentTimeMillis(),
            ),
        )
        importOpenSessions(response)
        return response
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
        val now = Instant.now()
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
        dao.saveSetAndOperation(
            set,
            outbox(
                upsertOperation(
                    set = set,
                    includeEquipmentIdentity = true,
                    frozenEquipmentSnapshot = frozenEquipmentSnapshot,
                ),
            ),
        )
        scheduleSyncNow()
        return set
    }

    suspend fun updateSet(set: LocalSetEntity, weight: Double, reps: Int, rir: Int?) {
        require(weight.isFinite() && weight in 0.0..500.0) { "Weight must be between 0 and 500." }
        require(reps in 1..100) { "Repetitions must be between 1 and 100." }
        require(rir == null || rir in 0..5) { "RIR must be between 0 and 5." }
        val selectedLoad = set.selectedLoadKg?.let { roundLoad(weight) }
        val storedWeight = selectedLoad ?: weight
        val nominalResistance = if (
            selectedLoad != null &&
            set.selectedLoadMultiplierSnapshot != null &&
            (
                snapshotLoadType(set.equipmentLoadSnapshotJson) == "SELECTORIZED" ||
                    set.nominalResistanceKg != null
                )
        ) {
            roundLoad(selectedLoad * set.selectedLoadMultiplierSnapshot)
        } else {
            set.nominalResistanceKg
        }
        val updated = set.copy(
            weight = storedWeight,
            reps = reps,
            rir = rir,
            selectedLoadKg = selectedLoad,
            nominalResistanceKg = nominalResistance,
            equipmentLoadSnapshotJson = updateEquipmentSnapshotJson(
                set.equipmentLoadSnapshotJson,
                selectedLoad,
                nominalResistance,
            ),
            deleted = false,
        )
        dao.saveSetAndOperation(
            updated,
            outbox(upsertOperation(set = updated, includeEquipmentIdentity = false)),
        )
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
        type = operation::class.simpleName.orEmpty(),
        payloadJson = api.json.encodeToString<SyncOperation>(operation),
    )

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
    val complete: Boolean,
)

internal fun pendingMutationTargets(
    entries: List<SyncOutboxEntity>,
    json: Json,
): PendingMutationTargets {
    val sessionIds = mutableSetOf<String>()
    val setIds = mutableSetOf<String>()
    for (entry in entries) {
        val operation = runCatching { json.decodeFromString<SyncOperation>(entry.payloadJson) }
            .getOrElse { return PendingMutationTargets(sessionIds, setIds, complete = false) }
        when (operation) {
            is StartSessionOperation -> sessionIds += operation.session.id
            is FinishSessionOperation -> sessionIds += operation.sessionId
            is UpsertSetOperation -> setIds += operation.set.id
            is DeleteSetOperation -> setIds += operation.setId
        }
    }
    return PendingMutationTargets(sessionIds, setIds, complete = true)
}

class MobileAuthenticationRequiredException : IOException("Sign in again to synchronize local data.")

data class SyncIssue(
    val operationId: String,
    val message: String,
)
