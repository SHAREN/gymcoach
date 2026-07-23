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
        assertEquals(
            listOf(PRIMARY, FALLBACK, FALLBACK, FALLBACK),
            attempts,
        )
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

        assertEquals(9, loads)
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
        assertEquals("settings-profile-401", failure.correlationId)
        assertEquals("profile", failure.subrequest)
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
    fun `legacy session validates active authority and persists it across repository restart`() = runTest {
        val accountStore = FakeAccountStore().apply { sessionServerUrl = null }
        val expected = snapshot()
        val validated = mutableListOf<String>()
        val repository = SettingsRepository.failover(
            accountStore = accountStore,
            token = "token",
            endpointResolver = ServerEndpointResolver(accountStore, ServerReachabilityProbe { true }),
            sessionValidator = SettingsSessionValidator { baseUrl, accessToken ->
                validated += baseUrl
                assertEquals("token", accessToken)
                SettingsSessionValidation.VALID
            },
            remoteFactory = { _, _ ->
                object : SettingsDataSourceStub() {
                    override suspend fun load(): SettingsSnapshot = expected
                }
            },
        )

        assertEquals(expected, repository.load())
        assertEquals(listOf(PRIMARY), validated)
        assertEquals(PRIMARY, accountStore.sessionServerUrl)
        assertEquals(PRIMARY, accountStore.serverUrl)
        assertTrue(accountStore.isAuthenticated)

        val restarted = SettingsRepository.failover(
            accountStore = accountStore,
            token = "token",
            endpointResolver = ServerEndpointResolver(accountStore, ServerReachabilityProbe { true }),
            sessionValidator = SettingsSessionValidator { _, _ ->
                error("Persisted authority must survive process restart and another update")
            },
            remoteFactory = { _, _ ->
                object : SettingsDataSourceStub() {
                    override suspend fun load(): SettingsSnapshot = expected
                }
            },
        )
        assertEquals(expected, restarted.load())
    }

    @Test
    fun `legacy migration validates active fallback first without changing primary authority`() = runTest {
        val accountStore = FakeAccountStore().apply {
            serverUrl = FALLBACK
            sessionServerUrl = null
        }
        val validated = mutableListOf<String>()
        val repository = SettingsRepository.failover(
            accountStore = accountStore,
            token = "token",
            endpointResolver = ServerEndpointResolver(
                accountStore,
                ServerReachabilityProbe { it == FALLBACK },
            ),
            sessionValidator = SettingsSessionValidator { baseUrl, _ ->
                validated += baseUrl
                SettingsSessionValidation.VALID
            },
            remoteFactory = { _, _ ->
                object : SettingsDataSourceStub() {
                    override suspend fun load(): SettingsSnapshot = snapshot()
                }
            },
        )

        repository.load()

        assertEquals(listOf(FALLBACK), validated)
        assertEquals(FALLBACK, accountStore.sessionServerUrl)
        assertEquals(FALLBACK, accountStore.serverUrl)
        assertEquals(PRIMARY, accountStore.primaryServerUrl)
    }

    @Test
    fun `legacy migration clears only tokens confirmed invalid revoked or expired`() = runTest {
        listOf(
            SettingsSessionValidation.INVALID to SettingsErrorKind.AUTHENTICATION,
            SettingsSessionValidation.REVOKED to SettingsErrorKind.TOKEN_REVOKED,
            SettingsSessionValidation.EXPIRED to SettingsErrorKind.TOKEN_EXPIRED,
        ).forEach { (validation, expectedKind) ->
            val accountStore = FakeAccountStore().apply { sessionServerUrl = null }
            val repository = SettingsRepository.failover(
                accountStore = accountStore,
                token = "token",
                sessionValidator = SettingsSessionValidator { _, _ -> validation },
                remoteFactory = { _, _ -> error("Remote Settings must not run") },
            )

            val failure = runCatching { repository.load() }.exceptionOrNull() as SettingsException

            assertEquals(expectedKind, failure.kind)
            assertTrue(!accountStore.isAuthenticated)
            assertEquals("user_1", accountStore.userId)
            assertEquals("user@example.com", accountStore.userEmail)
            assertEquals(PRIMARY, accountStore.primaryServerUrl)
        }
    }

    @Test
    fun `legacy unconfirmed validation preserves login and account data`() = runTest {
        val accountStore = FakeAccountStore().apply { sessionServerUrl = null }
        val repository = SettingsRepository.failover(
            accountStore = accountStore,
            token = "token",
            sessionValidator = SettingsSessionValidator { _, _ ->
                SettingsSessionValidation.UNCONFIRMED
            },
            remoteFactory = { _, _ -> error("Remote Settings must not run") },
        )

        val failure = runCatching { repository.load() }.exceptionOrNull() as SettingsException

        assertEquals(SettingsErrorKind.SESSION_VALIDATION_UNAVAILABLE, failure.kind)
        assertTrue(accountStore.isAuthenticated)
        assertEquals("user_1", accountStore.userId)
        assertEquals("user@example.com", accountStore.userEmail)
    }

    @Test
    fun `optional section failures preserve available settings and exact correlations`() = runTest {
        val accountStore = FakeAccountStore()
        val exerciseFailure = SettingsException(
            kind = SettingsErrorKind.INVALID_RESPONSE,
            correlationId = "settings-exercises-schema",
            subrequest = "exercises",
            route = "/api/mobile/exercises",
        )
        val equipmentFailure = SettingsException(
            kind = SettingsErrorKind.FORBIDDEN,
            statusCode = 403,
            correlationId = "settings-equipment-403",
            subrequest = "gym-equipment",
            route = "/api/gyms/gym-1/equipment",
            authority = PRIMARY,
            errorCode = "auth-rejected",
            authOutcome = "valid",
        )
        val repository = SettingsRepository.failover(
            accountStore = accountStore,
            token = "token",
            endpointResolver = ServerEndpointResolver(accountStore, ServerReachabilityProbe { true }),
            sessionValidator = SettingsSessionValidator { _, _ -> SettingsSessionValidation.VALID },
            remoteFactory = { _, _ ->
                object : SettingsDataSourceStub() {
                    override suspend fun loadProfile() = snapshot().profile
                    override suspend fun loadGyms() = SettingsGymListDto(
                        activeGymId = "gym-1",
                        gyms = listOf(SettingsGymDto("gym-1", "Gym")),
                    )
                    override suspend fun loadExercises() = throw exerciseFailure
                    override suspend fun loadGymInventory(gymId: String) = throw equipmentFailure
                }
            },
        )

        val loaded = repository.load()

        assertEquals("Renat", loaded.profile.displayName)
        assertEquals(listOf("gym-1"), loaded.gymList.gyms.map { it.id })
        assertTrue(loaded.exercises.isEmpty())
        assertTrue(loaded.gymInventories.isEmpty())
        assertEquals(
            listOf(SettingsSection.EXERCISES, SettingsSection.EQUIPMENT),
            loaded.sectionFailures.map { it.section },
        )
        assertEquals(
            listOf("settings-exercises-schema", "settings-equipment-403"),
            loaded.sectionFailures.map { it.correlationId },
        )
        assertEquals(SettingsErrorKind.SESSION_ROUTE_REJECTED, loaded.sectionFailures[1].kind)
        assertEquals("gym-equipment", loaded.sectionFailures[1].subrequest)
        assertEquals("/api/gyms/gym-1/equipment", loaded.sectionFailures[1].route)
        assertEquals(PRIMARY, loaded.sectionFailures[1].authority)
        assertEquals("valid", loaded.sectionFailures[1].authOutcome)
        assertEquals("auth-rejected", loaded.sectionFailures[1].errorCode)
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
                        correlationId = "settings-profile-$statusCode",
                        subrequest = "profile",
                        route = "/api/profile",
                        authority = baseUrl,
                        errorCode = "auth-rejected",
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
        override fun recordSessionAuthority(serverUrl: String) {
            sessionServerUrl = serverUrl
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
