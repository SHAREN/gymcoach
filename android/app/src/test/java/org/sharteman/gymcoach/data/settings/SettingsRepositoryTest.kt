package org.sharteman.gymcoach.data.settings

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.sharteman.gymcoach.data.network.ServerEndpointResolver
import org.sharteman.gymcoach.data.network.ServerReachabilityProbe
import org.sharteman.gymcoach.data.security.AccountStore

class SettingsRepositoryTest {
    @Test
    fun `loads profile from fallback when primary settings request is unavailable`() = runTest {
        val accountStore = FakeAccountStore()
        val attempts = mutableListOf<String>()
        val expected = snapshot()
        val repository = SettingsRepository.failover(
            accountStore = accountStore,
            token = "token",
            endpointResolver = ServerEndpointResolver(accountStore, ServerReachabilityProbe { true }),
            remoteFactory = { baseUrl, _ ->
                object : SettingsDataSourceStub() {
                    override suspend fun load(): SettingsSnapshot {
                        attempts += baseUrl
                        if (baseUrl == PRIMARY) {
                            throw SettingsException(SettingsErrorKind.SERVER_UNAVAILABLE)
                        }
                        return expected
                    }
                }
            },
        )

        assertEquals(expected, repository.load())
        assertEquals(listOf(PRIMARY, FALLBACK), attempts)
        assertEquals(FALLBACK, accountStore.serverUrl)
        assertTrue(accountStore.isAuthenticated)
    }

    @Test
    fun `repeated settings loads preserve a valid session`() = runTest {
        val accountStore = FakeAccountStore()
        var loads = 0
        val expected = snapshot()
        val repository = SettingsRepository.failover(
            accountStore = accountStore,
            token = "token",
            endpointResolver = ServerEndpointResolver(accountStore, ServerReachabilityProbe { true }),
            remoteFactory = { baseUrl, _ ->
                object : SettingsDataSourceStub() {
                    override suspend fun load(): SettingsSnapshot {
                        assertEquals(PRIMARY, baseUrl)
                        loads += 1
                        return expected
                    }
                }
            },
        )

        repeat(3) { assertEquals(expected, repository.load()) }

        assertEquals(3, loads)
        assertTrue(accountStore.isAuthenticated)
    }

    @Test
    fun `route specific 401 preserves a session validated by bootstrap`() = runTest {
        val accountStore = FakeAccountStore()
        val repository = rejectedSettingsRepository(
            accountStore = accountStore,
            statusCode = 401,
            validation = SettingsSessionValidation.VALID,
        )

        val failure = runCatching { repository.load() }.exceptionOrNull() as SettingsException

        assertEquals(SettingsErrorKind.SESSION_ROUTE_REJECTED, failure.kind)
        assertTrue(accountStore.isAuthenticated)
    }

    @Test
    fun `route specific 403 preserves a session validated by bootstrap`() = runTest {
        val accountStore = FakeAccountStore()
        val repository = rejectedSettingsRepository(
            accountStore = accountStore,
            statusCode = 403,
            validation = SettingsSessionValidation.VALID,
        )

        val failure = runCatching { repository.load() }.exceptionOrNull() as SettingsException

        assertEquals(SettingsErrorKind.SESSION_ROUTE_REJECTED, failure.kind)
        assertTrue(accountStore.isAuthenticated)
    }

    @Test
    fun `confirmed invalid credentials clear only the access token`() = runTest {
        val accountStore = FakeAccountStore()
        val repository = rejectedSettingsRepository(
            accountStore = accountStore,
            statusCode = 401,
            validation = SettingsSessionValidation.INVALID,
        )

        val failure = runCatching { repository.load() }.exceptionOrNull() as SettingsException

        assertEquals(SettingsErrorKind.AUTHENTICATION, failure.kind)
        assertTrue(!accountStore.isAuthenticated)
        assertEquals("user_1", accountStore.userId)
        assertEquals("user@example.com", accountStore.userEmail)
        assertEquals(PRIMARY, accountStore.primaryServerUrl)
        assertEquals(FALLBACK, accountStore.fallbackServerUrl)
    }

    @Test
    fun `unconfirmed session validation preserves the token`() = runTest {
        val accountStore = FakeAccountStore()
        val repository = rejectedSettingsRepository(
            accountStore = accountStore,
            statusCode = 401,
            validation = SettingsSessionValidation.UNCONFIRMED,
        )

        val failure = runCatching { repository.load() }.exceptionOrNull() as SettingsException

        assertEquals(SettingsErrorKind.SESSION_VALIDATION_UNAVAILABLE, failure.kind)
        assertTrue(accountStore.isAuthenticated)
    }

    @Test
    fun `fallback backend mismatch validates against the login authority`() = runTest {
        val accountStore = FakeAccountStore().apply { serverUrl = FALLBACK }
        var validatedUrl: String? = null
        val repository = SettingsRepository.failover(
            accountStore = accountStore,
            token = "token",
            endpointResolver = ServerEndpointResolver(
                accountStore,
                ServerReachabilityProbe { url -> url == FALLBACK },
            ),
            sessionValidator = SettingsSessionValidator { baseUrl, token ->
                validatedUrl = baseUrl
                assertEquals("token", token)
                SettingsSessionValidation.VALID
            },
            remoteFactory = { baseUrl, _ ->
                object : SettingsDataSourceStub() {
                    override suspend fun load(): SettingsSnapshot {
                        assertEquals(FALLBACK, baseUrl)
                        throw SettingsException(SettingsErrorKind.AUTHENTICATION, statusCode = 401)
                    }
                }
            },
        )

        val failure = runCatching { repository.load() }.exceptionOrNull() as SettingsException

        assertEquals(SettingsErrorKind.ENDPOINT_MISMATCH, failure.kind)
        assertEquals(PRIMARY, validatedUrl)
        assertEquals(FALLBACK, accountStore.serverUrl)
        assertTrue(accountStore.isAuthenticated)
    }

    @Test
    fun `legacy session without recorded authority is preserved`() = runTest {
        val accountStore = FakeAccountStore().apply { sessionServerUrl = null }
        var validationCalled = false
        val repository = SettingsRepository.failover(
            accountStore = accountStore,
            token = "token",
            endpointResolver = ServerEndpointResolver(accountStore, ServerReachabilityProbe { true }),
            sessionValidator = SettingsSessionValidator { _, _ ->
                validationCalled = true
                SettingsSessionValidation.INVALID
            },
            remoteFactory = { _, _ ->
                object : SettingsDataSourceStub() {
                    override suspend fun load(): SettingsSnapshot {
                        throw SettingsException(SettingsErrorKind.AUTHENTICATION, statusCode = 401)
                    }
                }
            },
        )

        val failure = runCatching { repository.load() }.exceptionOrNull() as SettingsException

        assertEquals(SettingsErrorKind.SESSION_VALIDATION_UNAVAILABLE, failure.kind)
        assertTrue(!validationCalled)
        assertTrue(accountStore.isAuthenticated)
    }

    private fun rejectedSettingsRepository(
        accountStore: FakeAccountStore,
        statusCode: Int,
        validation: SettingsSessionValidation,
    ): SettingsRepository = SettingsRepository.failover(
        accountStore = accountStore,
        token = "token",
        endpointResolver = ServerEndpointResolver(accountStore, ServerReachabilityProbe { true }),
        sessionValidator = SettingsSessionValidator { baseUrl, token ->
            assertEquals(PRIMARY, baseUrl)
            assertEquals("token", token)
            validation
        },
        remoteFactory = { baseUrl, _ ->
            object : SettingsDataSourceStub() {
                override suspend fun load(): SettingsSnapshot {
                    assertEquals(PRIMARY, baseUrl)
                    throw SettingsException(
                        kind = settingsErrorKindForStatus(statusCode),
                        statusCode = statusCode,
                    )
                }
            }
        },
    )

    private fun snapshot() = SettingsSnapshot(
        profile = SettingsProfileDto(
            email = "user@example.com",
            displayName = "Renat",
            bodyweight = 82.5,
            sex = "MALE",
            heightCm = 181,
            goal = "STRENGTH",
            weeklyFrequency = 4,
            unit = "KG",
        ),
        gymList = SettingsGymListDto(),
        exercises = emptyList(),
    )

    private class FakeAccountStore : AccountStore {
        override val deviceId = "device_test"
        override var serverUrl = PRIMARY
        override var sessionServerUrl: String? = PRIMARY
        override val primaryServerUrl = PRIMARY
        override var fallbackServerUrl: String? = FALLBACK
        override var userId: String? = "user_1"
        override var userEmail: String? = "user@example.com"
        private var token: String? = "token"
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

    private companion object {
        const val PRIMARY = "https://gymcoach7.sharteman.duckdns.org"
        const val FALLBACK = "http://192.168.0.119:3030"
    }
}

private abstract class SettingsDataSourceStub : SettingsDataSource {
    override suspend fun load(): SettingsSnapshot = unsupported()
    override suspend fun saveProfile(input: SettingsProfileInput): SettingsProfileDto = unsupported()
    override suspend fun createGym(input: SettingsGymInput): SettingsGymDto = unsupported()
    override suspend fun updateGym(id: String, input: SettingsGymUpdateInput): SettingsGymDto = unsupported()
    override suspend fun activateGym(id: String) = unsupported<Unit>()
    override suspend fun deleteGym(id: String) = unsupported<Unit>()
    override suspend fun loadGymInventory(gymId: String): SettingsGymInventoryDto = unsupported()
    override suspend fun saveGymEquipment(
        gymId: String,
        equipmentId: String?,
        input: SettingsGymEquipmentInput,
    ) = unsupported<Unit>()
    override suspend fun saveDumbbellsSystemProfile(
        gymId: String,
        input: SettingsDumbbellsSystemProfileInput,
    ) = unsupported<Unit>()
    override suspend fun saveBarbellSystemProfile(
        gymId: String,
        input: SettingsBarbellSystemProfileInput,
    ) = unsupported<Unit>()
    override suspend fun deleteGymEquipment(equipmentId: String) = unsupported<Unit>()
    override suspend fun setGymEquipmentImageUrl(equipmentId: String, imageUrl: String) =
        unsupported<Unit>()
    override suspend fun uploadGymEquipmentImage(
        equipmentId: String,
        imageBase64: String,
        mimeType: String,
    ) = unsupported<Unit>()
    override suspend fun clearGymEquipmentImage(equipmentId: String) = unsupported<Unit>()
    override suspend fun latestRelease(): AndroidReleaseDto = unsupported()
    override fun releaseDownloadUrl(release: AndroidReleaseDto): String = unsupported()
    override suspend fun exportBackup(): String = unsupported()
    override suspend fun restoreBackup(payload: String) = unsupported<Unit>()
    override suspend fun previewImport(
        format: SettingsImportFormat,
        fileName: String,
        payload: String,
        unit: String,
    ): SettingsImportPreview = unsupported()
    override suspend fun confirmImport(preview: SettingsImportPreview): JsonObject = unsupported()

    private fun <T> unsupported(): T = error("Unused test method")
}
