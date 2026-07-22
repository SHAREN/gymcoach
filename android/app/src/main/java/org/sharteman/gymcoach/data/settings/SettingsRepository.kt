package org.sharteman.gymcoach.data.settings

import android.content.Context
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.JsonObject
import org.sharteman.gymcoach.data.model.CoachingProfilePatchInput
import org.sharteman.gymcoach.data.network.ApiClient
import org.sharteman.gymcoach.data.network.ApiException
import org.sharteman.gymcoach.data.network.MobileApi
import org.sharteman.gymcoach.data.network.ServerEndpointResolver
import org.sharteman.gymcoach.data.security.AccountStore
import org.sharteman.gymcoach.data.security.SecureAccountStore

internal enum class SettingsSessionValidation {
    VALID,
    INVALID,
    UNCONFIRMED,
}

internal fun interface SettingsSessionValidator {
    suspend fun validate(baseUrl: String, token: String): SettingsSessionValidation
}

private class BootstrapSettingsSessionValidator(
    private val api: MobileApi = ApiClient(),
) : SettingsSessionValidator {
    override suspend fun validate(baseUrl: String, token: String): SettingsSessionValidation = try {
        api.bootstrap(baseUrl, token)
        SettingsSessionValidation.VALID
    } catch (error: CancellationException) {
        throw error
    } catch (error: ApiException) {
        if (error.statusCode in setOf(401, 403)) {
            SettingsSessionValidation.INVALID
        } else {
            SettingsSessionValidation.UNCONFIRMED
        }
    } catch (_: Throwable) {
        SettingsSessionValidation.UNCONFIRMED
    }
}

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
            sessionValidator: SettingsSessionValidator = BootstrapSettingsSessionValidator(),
            remoteFactory: (String, String) -> SettingsDataSource = { baseUrl, accessToken ->
                SettingsApi(baseUrl, accessToken)
            },
        ): SettingsRepository = SettingsRepository(
            FailoverSettingsDataSource(
                accountStore,
                token,
                endpointResolver,
                sessionValidator,
                remoteFactory,
            ),
        )
    }
}

private class FailoverSettingsDataSource(
    private val accountStore: AccountStore,
    private val token: String,
    private val endpointResolver: ServerEndpointResolver,
    private val sessionValidator: SettingsSessionValidator,
    private val remoteFactory: (String, String) -> SettingsDataSource,
) : SettingsDataSource {
    private val remotes = mutableMapOf<String, SettingsDataSource>()

    override suspend fun load(): SettingsSnapshot = withRemote { load() }

    override suspend fun loadProfile(): SettingsProfileDto = withRemote { loadProfile() }

    override suspend fun saveProfile(input: SettingsProfileInput): SettingsProfileDto =
        withRemote { saveProfile(input) }

    override suspend fun saveCoachingProfile(input: CoachingProfilePatchInput): SettingsProfileDto =
        withRemote { saveCoachingProfile(input) }

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
        if (error.statusCode in setOf(401, 403)) {
            throw classifyCredentialFailure(error)
        }
        throw error
    }

    private suspend fun classifyCredentialFailure(error: SettingsException): SettingsException {
        val sessionServerUrl = accountStore.sessionServerUrl
            ?: return retainedSessionFailure(SettingsErrorKind.SESSION_VALIDATION_UNAVAILABLE, error)
        return when (sessionValidator.validate(sessionServerUrl, token)) {
            SettingsSessionValidation.INVALID -> {
                accountStore.clearAccessToken()
                SettingsException(
                    kind = SettingsErrorKind.AUTHENTICATION,
                    statusCode = error.statusCode,
                    cause = error,
                )
            }
            SettingsSessionValidation.VALID -> retainedSessionFailure(
                kind = if (accountStore.serverUrl == sessionServerUrl) {
                    SettingsErrorKind.SESSION_ROUTE_REJECTED
                } else {
                    SettingsErrorKind.ENDPOINT_MISMATCH
                },
                error = error,
            )
            SettingsSessionValidation.UNCONFIRMED -> retainedSessionFailure(
                SettingsErrorKind.SESSION_VALIDATION_UNAVAILABLE,
                error,
            )
        }
    }

    private fun retainedSessionFailure(
        kind: SettingsErrorKind,
        error: SettingsException,
    ) = SettingsException(
        kind = kind,
        statusCode = error.statusCode,
        cause = error,
    )

    private fun remote(baseUrl: String): SettingsDataSource = synchronized(remotes) {
        remotes.getOrPut(baseUrl) { remoteFactory(baseUrl, token) }
    }
}
