package org.sharteman.gymcoach.data.repository

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.sharteman.gymcoach.data.local.BootstrapCacheEntity
import org.sharteman.gymcoach.data.local.GymCoachDao
import org.sharteman.gymcoach.data.local.LocalSessionEntity
import org.sharteman.gymcoach.data.local.LocalSetEntity
import org.sharteman.gymcoach.data.local.SyncOutboxEntity
import org.sharteman.gymcoach.data.model.BootstrapResponse
import org.sharteman.gymcoach.data.model.DeleteSetOperation
import org.sharteman.gymcoach.data.model.LoginRequest
import org.sharteman.gymcoach.data.model.LoginResponse
import org.sharteman.gymcoach.data.model.MobileSetPayload
import org.sharteman.gymcoach.data.model.MobileUser
import org.sharteman.gymcoach.data.model.ProfileDto
import org.sharteman.gymcoach.data.model.SessionDto
import org.sharteman.gymcoach.data.model.SetDto
import org.sharteman.gymcoach.data.model.SyncBatchRequest
import org.sharteman.gymcoach.data.model.SyncBatchResponse
import org.sharteman.gymcoach.data.model.SyncOperation
import org.sharteman.gymcoach.data.model.SyncOperationResult
import org.sharteman.gymcoach.data.model.StartSessionOperation
import org.sharteman.gymcoach.data.model.MobileSessionPayload
import org.sharteman.gymcoach.data.model.UpsertSetOperation
import org.sharteman.gymcoach.data.network.MobileApi
import org.sharteman.gymcoach.data.network.ApiException
import org.sharteman.gymcoach.data.security.AccountStore

class GymCoachRepositorySyncTest {
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

    private fun fixture(): Fixture {
        val dao = InMemoryDao()
        val api = TestApi()
        val accountStore = TestAccountStore()
        val repository = GymCoachRepository(
            dao = dao,
            accountStore = accountStore,
            api = api,
            scheduleSyncNow = {},
            schedulePeriodicSync = {},
        )
        return Fixture(dao, api, accountStore, repository)
    }

    private fun bootstrap(openSessions: List<SessionDto> = emptyList()) = BootstrapResponse(
        schemaVersion = 1,
        calculationVersion = "test",
        serverTime = "2026-07-13T12:00:00Z",
        profile = ProfileDto(id = "user_1", email = "user@example.com"),
        openSessions = openSessions,
    )

    private data class Fixture(
        val dao: InMemoryDao,
        val api: TestApi,
        val accountStore: TestAccountStore,
        val repository: GymCoachRepository,
    ) {
        fun outbox(operation: SyncOperation) = SyncOutboxEntity(
            operationId = operation.operationId,
            type = operation::class.simpleName.orEmpty(),
            payloadJson = api.json.encodeToString<SyncOperation>(operation),
        )
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
        override suspend fun bootstrap(baseUrl: String, token: String) = bootstrapResponse
        override suspend fun sync(
            baseUrl: String,
            token: String,
            request: SyncBatchRequest,
        ): SyncBatchResponse {
            syncCalls += request
            syncFailure?.let { throw it }
            return syncHandler(request)
        }
        override suspend fun createWebSession(baseUrl: String, token: String) = listOf("session=test")
        override suspend fun logout(baseUrl: String, token: String) = Unit

    }

    private class InMemoryDao : GymCoachDao {
        private val bootstrapFlow = MutableStateFlow<BootstrapCacheEntity?>(null)
        private val sessions = linkedMapOf<String, LocalSessionEntity>()
        private val sets = linkedMapOf<String, LocalSetEntity>()
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
        override suspend fun retryOperation(operationId: String) {
            updateOperation(operationId) { it.copy(status = "PENDING", lastError = null) }
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
        override suspend fun clearSessions() {
            sessions.clear()
            sets.clear()
            publishSessions()
        }
        override suspend fun clearOutbox() {
            outbox.clear()
            publishPending()
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
