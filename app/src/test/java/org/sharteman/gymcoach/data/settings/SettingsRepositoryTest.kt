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
    }

    @Test
    fun `does not retry authentication failure on fallback`() = runTest {
        val accountStore = FakeAccountStore()
        val attempts = mutableListOf<String>()
        val repository = SettingsRepository.failover(
            accountStore = accountStore,
            token = "token",
            endpointResolver = ServerEndpointResolver(accountStore, ServerReachabilityProbe { true }),
            remoteFactory = { baseUrl, _ ->
                object : SettingsDataSourceStub() {
                    override suspend fun load(): SettingsSnapshot {
                        attempts += baseUrl
                        throw SettingsException(SettingsErrorKind.AUTHENTICATION, statusCode = 401)
                    }
                }
            },
        )

        val failure = runCatching { repository.load() }.exceptionOrNull()

        assertTrue(failure is SettingsException)
        assertEquals(listOf(PRIMARY), attempts)
        assertEquals(PRIMARY, accountStore.serverUrl)
    }

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
        override val primaryServerUrl = PRIMARY
        override var fallbackServerUrl: String? = FALLBACK
        override var userId: String? = "user_1"
        override var userEmail: String? = "user@example.com"
        private var token: String? = "token"

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
    override suspend fun updateGym(id: String, input: SettingsGymInput): SettingsGymDto = unsupported()
    override suspend fun activateGym(id: String) = unsupported<Unit>()
    override suspend fun deleteGym(id: String) = unsupported<Unit>()
    override suspend fun loadGymInventory(gymId: String): SettingsGymInventoryDto = unsupported()
    override suspend fun saveGymEquipment(
        gymId: String,
        equipmentId: String?,
        input: SettingsGymEquipmentInput,
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
