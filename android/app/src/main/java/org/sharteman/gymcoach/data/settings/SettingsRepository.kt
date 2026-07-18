package org.sharteman.gymcoach.data.settings

import android.content.Context
import kotlinx.serialization.json.JsonObject
import org.sharteman.gymcoach.data.network.ServerEndpointResolver
import org.sharteman.gymcoach.data.security.AccountStore
import org.sharteman.gymcoach.data.security.SecureAccountStore

class SettingsRepository(
    private val remote: SettingsDataSource,
) : SettingsDataSource by remote {
    companion object {
        fun create(context: Context): SettingsRepository {
            val account = SecureAccountStore(context.applicationContext)
            val token = account.getAccessToken()
                ?: throw SettingsException(SettingsErrorKind.AUTHENTICATION)
            return failover(account, token)
        }

        internal fun failover(
            accountStore: AccountStore,
            token: String,
            endpointResolver: ServerEndpointResolver = ServerEndpointResolver(accountStore),
            remoteFactory: (String, String) -> SettingsDataSource = { baseUrl, accessToken ->
                SettingsApi(baseUrl, accessToken)
            },
        ): SettingsRepository = SettingsRepository(
            FailoverSettingsDataSource(accountStore, token, endpointResolver, remoteFactory),
        )
    }
}

private class FailoverSettingsDataSource(
    private val accountStore: AccountStore,
    private val token: String,
    private val endpointResolver: ServerEndpointResolver,
    private val remoteFactory: (String, String) -> SettingsDataSource,
) : SettingsDataSource {
    private val remotes = mutableMapOf<String, SettingsDataSource>()

    override suspend fun load(): SettingsSnapshot = withRemote { load() }

    override suspend fun saveProfile(input: SettingsProfileInput): SettingsProfileDto =
        withRemote { saveProfile(input) }

    override suspend fun createGym(input: SettingsGymInput): SettingsGymDto =
        withRemote { createGym(input) }

    override suspend fun updateGym(id: String, input: SettingsGymUpdateInput): SettingsGymDto =
        withRemote { updateGym(id, input) }

    override suspend fun activateGym(id: String) = withRemote { activateGym(id) }

    override suspend fun deleteGym(id: String) = withRemote { deleteGym(id) }

    override suspend fun loadGymInventory(gymId: String): SettingsGymInventoryDto =
        withRemote { loadGymInventory(gymId) }

    override suspend fun saveGymEquipment(
        gymId: String,
        equipmentId: String?,
        input: SettingsGymEquipmentInput,
    ) = withRemote { saveGymEquipment(gymId, equipmentId, input) }

    override suspend fun saveDumbbellsSystemProfile(
        gymId: String,
        input: SettingsDumbbellsSystemProfileInput,
    ) = withRemote { saveDumbbellsSystemProfile(gymId, input) }

    override suspend fun saveBarbellSystemProfile(
        gymId: String,
        input: SettingsBarbellSystemProfileInput,
    ) = withRemote { saveBarbellSystemProfile(gymId, input) }

    override suspend fun deleteGymEquipment(equipmentId: String) =
        withRemote { deleteGymEquipment(equipmentId) }

    override suspend fun setGymEquipmentImageUrl(equipmentId: String, imageUrl: String) =
        withRemote { setGymEquipmentImageUrl(equipmentId, imageUrl) }

    override suspend fun uploadGymEquipmentImage(
        equipmentId: String,
        imageBase64: String,
        mimeType: String,
    ) = withRemote { uploadGymEquipmentImage(equipmentId, imageBase64, mimeType) }

    override suspend fun clearGymEquipmentImage(equipmentId: String) =
        withRemote { clearGymEquipmentImage(equipmentId) }

    override fun equipmentImageAuthorization(): String = "Bearer $token"

    override suspend fun latestRelease(): AndroidReleaseDto = withRemote { latestRelease() }

    override fun releaseDownloadUrl(release: AndroidReleaseDto): String =
        remote(accountStore.serverUrl).releaseDownloadUrl(release)

    override suspend fun exportBackup(): String = withRemote { exportBackup() }

    override suspend fun restoreBackup(payload: String) = withRemote { restoreBackup(payload) }

    override suspend fun previewImport(
        format: SettingsImportFormat,
        fileName: String,
        payload: String,
        unit: String,
    ): SettingsImportPreview = withRemote { previewImport(format, fileName, payload, unit) }

    override suspend fun confirmImport(preview: SettingsImportPreview): JsonObject =
        withRemote { confirmImport(preview) }

    private suspend fun <T> withRemote(block: suspend SettingsDataSource.() -> T): T = try {
        endpointResolver.execute { baseUrl -> remote(baseUrl).block() }
    } catch (error: SettingsException) {
        if (error.kind == SettingsErrorKind.AUTHENTICATION) {
            accountStore.clearAccessToken()
        }
        throw error
    }

    private fun remote(baseUrl: String): SettingsDataSource = synchronized(remotes) {
        remotes.getOrPut(baseUrl) { remoteFactory(baseUrl, token) }
    }
}
