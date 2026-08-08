package org.sharteman.gymcoach.data.repository

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import org.junit.runner.RunWith
import org.sharteman.gymcoach.data.local.GymCoachDatabase
import org.sharteman.gymcoach.data.local.SyncOutboxEntity
import org.sharteman.gymcoach.data.model.BootstrapResponse
import org.sharteman.gymcoach.data.model.DeleteSetOperation
import org.sharteman.gymcoach.data.model.LoginRequest
import org.sharteman.gymcoach.data.model.LoginResponse
import org.sharteman.gymcoach.data.model.MobileProgressSnapshot
import org.sharteman.gymcoach.data.model.ReadinessCheckinRequest
import org.sharteman.gymcoach.data.model.SyncBatchRequest
import org.sharteman.gymcoach.data.model.SyncBatchResponse
import org.sharteman.gymcoach.data.model.SyncOperation
import org.sharteman.gymcoach.data.model.SyncOperationResult
import org.sharteman.gymcoach.data.model.UpdatePreferredEquipmentOperation
import org.sharteman.gymcoach.data.network.ApiException
import org.sharteman.gymcoach.data.network.MobileApi
import org.sharteman.gymcoach.data.security.AccountStore

@RunWith(AndroidJUnit4::class)
class SyncOutboxIsolationInstrumentedTest {
    @Test
    fun incompatibleOperationDoesNotBlockIndependentTailInRealRoom() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val database = Room.inMemoryDatabaseBuilder(context, GymCoachDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        try {
            val dao = database.dao()
            val api = IsolationApi()
            val incompatible = UpdatePreferredEquipmentOperation(
                operationId = "instrumented_incompatible",
                gymId = "gym_1",
                exerciseId = "exercise_1",
                preferredEquipmentId = "equipment_1",
            )
            val independent = DeleteSetOperation(
                operationId = "instrumented_independent",
                setId = "set_independent",
            )
            dao.enqueue(api.outbox(incompatible))
            dao.enqueue(api.outbox(independent))
            val repository = GymCoachRepository(
                dao = dao,
                accountStore = InstrumentedAccountStore(),
                api = api,
                scheduleSyncNow = {},
                schedulePeriodicSync = {},
            )

            assertFalse(repository.syncPending())

            val remaining = dao.queuedOperations().single()
            assertEquals(incompatible.operationId, remaining.operationId)
            assertEquals("BLOCKED", remaining.status)
            assertEquals(
                listOf(
                    listOf(incompatible.operationId, independent.operationId),
                    listOf(incompatible.operationId),
                    listOf(independent.operationId),
                ),
                api.syncCalls.map { request -> request.operations.map { it.operationId } },
            )
        } finally {
            database.close()
        }
    }

    private class IsolationApi : MobileApi {
        override val json = Json {
            ignoreUnknownKeys = true
            encodeDefaults = true
            explicitNulls = true
            classDiscriminator = "type"
        }
        val syncCalls = mutableListOf<SyncBatchRequest>()

        fun outbox(operation: SyncOperation) = SyncOutboxEntity(
            operationId = operation.operationId,
            type = operation.wireType(),
            payloadJson = json.encodeToString<SyncOperation>(operation),
        )

        override suspend fun sync(
            baseUrl: String,
            token: String,
            request: SyncBatchRequest,
        ): SyncBatchResponse {
            syncCalls += request
            if (request.operations.any { it.operationId == "instrumented_incompatible" }) {
                throw ApiException(400, "Invalid discriminator value.")
            }
            return SyncBatchResponse(
                serverTime = "2026-08-08T10:00:00Z",
                results = request.operations.map {
                    SyncOperationResult(it.operationId, "APPLIED")
                },
            )
        }

        override suspend fun bootstrap(baseUrl: String, token: String) = BootstrapResponse(
            schemaVersion = 9,
            calculationVersion = "instrumented",
            serverTime = "2026-08-08T10:00:00Z",
            profile = org.sharteman.gymcoach.data.model.ProfileDto(
                id = "user_instrumented",
                email = "instrumented@example.test",
            ),
        )

        override suspend fun progress(
            baseUrl: String,
            token: String,
            exerciseId: String?,
        ) = MobileProgressSnapshot(
            schemaVersion = 1,
            generatedAt = "2026-08-08T10:00:00Z",
        )

        override suspend fun login(baseUrl: String, request: LoginRequest): LoginResponse =
            error("Not used")

        override suspend fun saveReadiness(
            baseUrl: String,
            token: String,
            request: ReadinessCheckinRequest,
        ) = Unit

        override suspend fun createWebSession(baseUrl: String, token: String): List<String> =
            error("Not used")

        override suspend fun logout(baseUrl: String, token: String) = Unit
    }

    private class InstrumentedAccountStore : AccountStore {
        override val deviceId = "instrumented_device"
        override var serverUrl = "https://example.test"
        override var userId: String? = "user_instrumented"
        override var userEmail: String? = "instrumented@example.test"
        private var token: String? = "instrumented_token"

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
}
