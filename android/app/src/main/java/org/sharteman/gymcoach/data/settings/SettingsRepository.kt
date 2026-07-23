package org.sharteman.gymcoach.data.settings

import android.content.Context
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonObject
import org.sharteman.gymcoach.GymCoachApplication
import org.sharteman.gymcoach.data.diagnostics.NoOpSettingsDiagnosticSink
import org.sharteman.gymcoach.data.diagnostics.SettingsDiagnosticSink
import org.sharteman.gymcoach.data.diagnostics.SettingsDiagnostics
import org.sharteman.gymcoach.data.diagnostics.SettingsEndpointDiagnostic
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
    REVOKED,
    EXPIRED,
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
        when (error.errorCode?.lowercase()) {
            "mobile_auth_revoked" -> SettingsSessionValidation.REVOKED
            "mobile_auth_expired" -> SettingsSessionValidation.EXPIRED
            "mobile_auth_not_found", "mobile_auth_malformed", "mobile_auth_missing" ->
                SettingsSessionValidation.INVALID
            else -> if (error.statusCode in setOf(401, 403)) {
                SettingsSessionValidation.UNCONFIRMED
            } else {
                SettingsSessionValidation.UNCONFIRMED
            }
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
            val appContext = context.applicationContext
            val account = SecureAccountStore(appContext)
            val token = account.getAccessToken()
                ?: throw SettingsException(SettingsErrorKind.AUTHENTICATION)
            val diagnostics = (appContext as? GymCoachApplication)?.settingsDiagnostics
                ?: SettingsDiagnostics.create(appContext)
            return failover(account, token, diagnostics = diagnostics)
        }

        internal fun failover(
            accountStore: AccountStore,
            token: String,
            diagnostics: SettingsDiagnosticSink = NoOpSettingsDiagnosticSink,
            endpointResolver: ServerEndpointResolver = ServerEndpointResolver(
                accountStore = accountStore,
                observer = { event ->
                    diagnostics.recordEndpoint(
                        SettingsEndpointDiagnostic(
                            origin = event.baseUrl,
                            decision = event.decision,
                            category = event.category,
                            exception = event.exception,
                        ),
                    )
                },
            ),
            sessionValidator: SettingsSessionValidator = BootstrapSettingsSessionValidator(),
            remoteFactory: (String, String) -> SettingsDataSource = { baseUrl, accessToken ->
                SettingsApi(baseUrl, accessToken, diagnostics = diagnostics)
            },
        ): SettingsRepository = SettingsRepository(
            FailoverSettingsDataSource(
                accountStore,
                token,
                endpointResolver,
                sessionValidator,
                remoteFactory,
                diagnostics,
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
    private val diagnostics: SettingsDiagnosticSink,
) : SettingsDataSource {
    private val remotes = mutableMapOf<String, SettingsDataSource>()
    private val sessionMigrationMutex = Mutex()

    override suspend fun load(): SettingsSnapshot {
        val attemptId = UUID.randomUUID().toString()
        diagnostics.recordAttempt(attemptId, "started")
        return try {
            ensureSessionAuthority(attemptId)
            val profile = withRemote(attemptId, ensureSessionAuthority = false) { loadProfile() }
            val failures = mutableListOf<SettingsSectionFailure>()
            val gymList = optionalSection(attemptId, SettingsSection.GYMS, failures) {
                withRemote(attemptId, ensureSessionAuthority = false) { loadGyms() }
            } ?: SettingsGymListDto()
            val exercises = optionalSection(attemptId, SettingsSection.EXERCISES, failures) {
                withRemote(attemptId, ensureSessionAuthority = false) { loadExercises() }
            }.orEmpty()
            val inventories = buildMap {
                gymList.gyms.forEach { gym ->
                    val inventory = optionalSection(
                        attemptId,
                        SettingsSection.EQUIPMENT,
                        failures,
                    ) {
                        withRemote(attemptId, ensureSessionAuthority = false) {
                            loadGymInventory(gym.id)
                        }
                    }
                    if (inventory != null) {
                        put(gym.id, inventory.normalizeSystemProfiles(gym, exercises))
                    }
                }
            }
            SettingsSnapshot(
                profile = profile,
                gymList = gymList,
                exercises = exercises,
                gymInventories = inventories,
                sectionFailures = failures,
            ).also {
                diagnostics.recordAttempt(attemptId, "completed")
            }
        } catch (error: SettingsException) {
            diagnostics.recordAttempt(attemptId, "failed", error = error)
            throw error
        }
    }

    override suspend fun loadProfile(): SettingsProfileDto = withRemote { loadProfile() }

    override suspend fun loadGyms(): SettingsGymListDto = withRemote { loadGyms() }

    override suspend fun loadExercises() = withRemote { loadExercises() }

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

    private suspend fun <T> optionalSection(
        attemptId: String,
        section: SettingsSection,
        failures: MutableList<SettingsSectionFailure>,
        block: suspend () -> T,
    ): T? = try {
        block()
    } catch (error: SettingsException) {
        if (error.kind.isConfirmedCredentialFailure()) throw error
        failures += SettingsSectionFailure(
            section = section,
            kind = error.kind,
            statusCode = error.statusCode,
            correlationId = error.correlationId,
            subrequest = error.subrequest,
            route = error.route,
            authority = error.authority,
            errorCode = error.errorCode,
            authOutcome = error.authOutcome,
            causeClass = generateSequence<Throwable>(error) { it.cause }
                .drop(1)
                .lastOrNull()
                ?.javaClass
                ?.simpleName,
            retryable = error.retryable,
        )
        diagnostics.recordAttempt(
            attemptId = attemptId,
            phase = "section-${section.name.lowercase()}-failed",
            section = section.name,
            error = error,
        )
        null
    }

    private suspend fun <T> withRemote(
        attemptId: String = UUID.randomUUID().toString(),
        ensureSessionAuthority: Boolean = true,
        block: suspend SettingsDataSource.() -> T,
    ): T = try {
        if (ensureSessionAuthority) ensureSessionAuthority(attemptId)
        endpointResolver.execute { baseUrl ->
            remote(baseUrl).withDiagnosticAttempt(attemptId).block()
        }
    } catch (error: SettingsException) {
        if (error.statusCode in setOf(401, 403)) {
            throw classifyCredentialFailure(error)
        }
        throw error
    }

    private suspend fun ensureSessionAuthority(attemptId: String) {
        if (accountStore.sessionServerUrl != null) return
        sessionMigrationMutex.withLock {
            if (accountStore.sessionServerUrl != null) return@withLock
            val candidates = linkedSetOf<String>().apply {
                add(accountStore.serverUrl)
                add(accountStore.primaryServerUrl)
                accountStore.fallbackServerUrl?.let(::add)
            }.toList()
            val validations = mutableListOf<Pair<String, SettingsSessionValidation>>()
            candidates.forEach { candidate ->
                diagnostics.recordEndpoint(
                    SettingsEndpointDiagnostic(
                        origin = candidate,
                        decision = "legacy-authority-validation",
                        category = "started",
                    ),
                )
                val validation = sessionValidator.validate(candidate, token)
                validations += candidate to validation
                diagnostics.recordEndpoint(
                    SettingsEndpointDiagnostic(
                        origin = candidate,
                        decision = "legacy-authority-validation",
                        category = validation.name,
                    ),
                )
                if (validation == SettingsSessionValidation.VALID) {
                    accountStore.recordSessionAuthority(candidate)
                    diagnostics.recordAttempt(
                        attemptId = attemptId,
                        phase = "legacy-authority-restored",
                    )
                    return@withLock
                }
            }
            val allConfirmedInvalid = validations.isNotEmpty() && validations.all { (_, validation) ->
                validation in CONFIRMED_INVALID_VALIDATIONS
            }
            if (allConfirmedInvalid) {
                val terminal = validations.map { it.second }.credentialPriority()
                accountStore.clearAccessToken()
                throw SettingsException(
                    kind = terminal.errorKind(),
                    authority = validations.first().first,
                    errorCode = terminal.errorCode(),
                    authOutcome = terminal.authOutcome(),
                    retryable = false,
                )
            }
            throw SettingsException(
                kind = SettingsErrorKind.SESSION_VALIDATION_UNAVAILABLE,
                authority = candidates.firstOrNull(),
                errorCode = "session-validation-unavailable",
                authOutcome = "unconfirmed",
            )
        }
    }

    private suspend fun classifyCredentialFailure(error: SettingsException): SettingsException {
        val sessionServerUrl = accountStore.sessionServerUrl
            ?: return retainedSessionFailure(SettingsErrorKind.SESSION_VALIDATION_UNAVAILABLE, error)
        val validation = sessionValidator.validate(sessionServerUrl, token)
        return when (validation) {
            SettingsSessionValidation.INVALID,
            SettingsSessionValidation.REVOKED,
            SettingsSessionValidation.EXPIRED,
            -> {
                accountStore.clearAccessToken()
                SettingsException(
                    kind = validation.errorKind(),
                    statusCode = error.statusCode,
                    correlationId = error.correlationId,
                    subrequest = error.subrequest,
                    route = error.route,
                    authority = error.authority,
                    errorCode = validation.errorCode(),
                    authOutcome = validation.authOutcome(),
                    retryable = false,
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
        serverMessage = error.serverMessage,
        correlationId = error.correlationId,
        subrequest = error.subrequest,
        route = error.route,
        authority = error.authority,
        errorCode = error.errorCode,
        authOutcome = error.authOutcome,
        retryable = error.retryable,
        cause = error,
    )

    private fun remote(baseUrl: String): SettingsDataSource = synchronized(remotes) {
        remotes.getOrPut(baseUrl) { remoteFactory(baseUrl, token) }
    }

    private companion object {
        val CONFIRMED_INVALID_VALIDATIONS = setOf(
            SettingsSessionValidation.INVALID,
            SettingsSessionValidation.REVOKED,
            SettingsSessionValidation.EXPIRED,
        )
    }
}

private fun List<SettingsSessionValidation>.credentialPriority(): SettingsSessionValidation = when {
    SettingsSessionValidation.REVOKED in this -> SettingsSessionValidation.REVOKED
    SettingsSessionValidation.EXPIRED in this -> SettingsSessionValidation.EXPIRED
    else -> SettingsSessionValidation.INVALID
}

private fun SettingsSessionValidation.errorKind(): SettingsErrorKind = when (this) {
    SettingsSessionValidation.REVOKED -> SettingsErrorKind.TOKEN_REVOKED
    SettingsSessionValidation.EXPIRED -> SettingsErrorKind.TOKEN_EXPIRED
    SettingsSessionValidation.INVALID -> SettingsErrorKind.AUTHENTICATION
    SettingsSessionValidation.VALID,
    SettingsSessionValidation.UNCONFIRMED,
    -> SettingsErrorKind.SESSION_VALIDATION_UNAVAILABLE
}

private fun SettingsSessionValidation.errorCode(): String = when (this) {
    SettingsSessionValidation.REVOKED -> "mobile-auth-revoked"
    SettingsSessionValidation.EXPIRED -> "mobile-auth-expired"
    SettingsSessionValidation.INVALID -> "mobile-auth-invalid"
    SettingsSessionValidation.VALID -> "ok"
    SettingsSessionValidation.UNCONFIRMED -> "mobile-auth-unconfirmed"
}

private fun SettingsSessionValidation.authOutcome(): String = when (this) {
    SettingsSessionValidation.REVOKED -> "revoked"
    SettingsSessionValidation.EXPIRED -> "expired"
    SettingsSessionValidation.INVALID -> "not-found"
    SettingsSessionValidation.VALID -> "valid"
    SettingsSessionValidation.UNCONFIRMED -> "unavailable"
}
