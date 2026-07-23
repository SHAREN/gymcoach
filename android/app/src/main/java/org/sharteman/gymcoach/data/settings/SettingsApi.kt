package org.sharteman.gymcoach.data.settings

import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.UUID
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerializationException
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.sharteman.gymcoach.data.model.ApiErrorResponse
import org.sharteman.gymcoach.data.model.CoachingProfilePatchInput
import org.sharteman.gymcoach.data.model.CoachingProfilePatchRequest
import org.sharteman.gymcoach.data.model.ExerciseDto
import org.sharteman.gymcoach.data.diagnostics.NoOpSettingsDiagnosticSink
import org.sharteman.gymcoach.data.diagnostics.SettingsDiagnosticSink
import org.sharteman.gymcoach.data.diagnostics.SettingsRequestDiagnostic
import org.sharteman.gymcoach.data.diagnostics.safeCorrelation
import org.sharteman.gymcoach.data.diagnostics.safeDiagnosticLabel
import org.sharteman.gymcoach.data.network.resolveAndroidDownloadUrl

interface CoachingProfileRemoteDataSource {
    suspend fun loadProfile(): SettingsProfileDto
    suspend fun saveCoachingProfile(input: CoachingProfilePatchInput): SettingsProfileDto
}

interface SettingsDataSource : CoachingProfileRemoteDataSource {
    suspend fun load(): SettingsSnapshot
    override suspend fun loadProfile(): SettingsProfileDto = load().profile
    suspend fun loadGyms(): SettingsGymListDto = load().gymList
    suspend fun loadExercises(): List<ExerciseDto> = load().exercises
    fun withDiagnosticAttempt(attemptId: String): SettingsDataSource = this
    suspend fun saveProfile(input: SettingsProfileInput): SettingsProfileDto
    override suspend fun saveCoachingProfile(input: CoachingProfilePatchInput): SettingsProfileDto =
        throw UnsupportedOperationException("Coaching profile writes are unavailable.")
    suspend fun createGym(input: SettingsGymInput): SettingsGymDto
    suspend fun updateGym(id: String, input: SettingsGymUpdateInput): SettingsGymDto
    suspend fun activateGym(id: String)
    suspend fun deleteGym(id: String)
    suspend fun loadGymInventory(gymId: String): SettingsGymInventoryDto
    suspend fun saveGymEquipment(
        gymId: String,
        equipmentId: String?,
        input: SettingsGymEquipmentInput,
    )
    suspend fun saveDumbbellsSystemProfile(
        gymId: String,
        input: SettingsDumbbellsSystemProfileInput,
    )
    suspend fun saveBarbellSystemProfile(
        gymId: String,
        input: SettingsBarbellSystemProfileInput,
    )
    suspend fun deleteGymEquipment(equipmentId: String)
    suspend fun setGymEquipmentImageUrl(equipmentId: String, imageUrl: String)
    suspend fun uploadGymEquipmentImage(equipmentId: String, imageBase64: String, mimeType: String)
    suspend fun clearGymEquipmentImage(equipmentId: String)
    fun equipmentImageAuthorization(): String? = null
    suspend fun latestRelease(): AndroidReleaseDto
    fun releaseDownloadUrl(release: AndroidReleaseDto): String
    suspend fun exportBackup(): String
    suspend fun restoreBackup(payload: String)
    suspend fun previewImport(
        format: SettingsImportFormat,
        fileName: String,
        payload: String,
        unit: String,
    ): SettingsImportPreview
    suspend fun confirmImport(preview: SettingsImportPreview): JsonObject
}

class SettingsApi(
    private val baseUrl: String,
    private val token: String,
    private val client: OkHttpClient = defaultClient(),
    private val diagnostics: SettingsDiagnosticSink = NoOpSettingsDiagnosticSink,
    private val attemptId: String? = null,
) : SettingsDataSource {
    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        explicitNulls = true
    }
    private val patchJson = Json {
        ignoreUnknownKeys = true
        encodeDefaults = false
        explicitNulls = false
    }

    override suspend fun load(): SettingsSnapshot {
        val profile = loadProfile()
        val gyms = loadGyms()
        val exercises = loadExercises()
        val inventories = gyms.gyms.associate { gym ->
            gym.id to loadGymInventory(gym.id).normalizeSystemProfiles(gym, exercises)
        }
        return SettingsSnapshot(profile, gyms, exercises, inventories)
    }

    override suspend fun loadProfile(): SettingsProfileDto =
        request("GET", "/api/profile")

    override suspend fun loadGyms(): SettingsGymListDto =
        request("GET", "/api/gyms")

    override suspend fun loadExercises(): List<ExerciseDto> =
        request("GET", "/api/mobile/exercises")

    override fun withDiagnosticAttempt(attemptId: String): SettingsDataSource = SettingsApi(
        baseUrl = baseUrl,
        token = token,
        client = client,
        diagnostics = diagnostics,
        attemptId = attemptId,
    )

    override suspend fun saveProfile(input: SettingsProfileInput): SettingsProfileDto =
        request("PATCH", "/api/profile", json.encodeToString(input))

    override suspend fun saveCoachingProfile(input: CoachingProfilePatchInput): SettingsProfileDto =
        request(
            "PATCH",
            "/api/profile",
            patchJson.encodeToString(CoachingProfilePatchRequest(input)),
        )

    override suspend fun createGym(input: SettingsGymInput): SettingsGymDto =
        request("POST", "/api/gyms", json.encodeToString(input))

    override suspend fun updateGym(id: String, input: SettingsGymUpdateInput): SettingsGymDto =
        request("PUT", "/api/gyms/$id", json.encodeToString(input))

    override suspend fun activateGym(id: String) {
        request<JsonObject>("POST", "/api/gyms/$id/activate", "{}")
    }

    override suspend fun deleteGym(id: String) {
        request<JsonObject>("DELETE", "/api/gyms/$id")
    }

    override suspend fun loadGymInventory(gymId: String): SettingsGymInventoryDto =
        request<SettingsGymInventoryResponse>("GET", "/api/gyms/$gymId/equipment").gym

    override suspend fun saveGymEquipment(
        gymId: String,
        equipmentId: String?,
        input: SettingsGymEquipmentInput,
    ) {
        val path = equipmentId?.let { "/api/gym-equipment/$it" } ?: "/api/gyms/$gymId/equipment"
        request<JsonObject>(if (equipmentId == null) "POST" else "PUT", path, json.encodeToString(input))
    }

    override suspend fun saveDumbbellsSystemProfile(
        gymId: String,
        input: SettingsDumbbellsSystemProfileInput,
    ) {
        request<JsonObject>(
            "PUT",
            "/api/gyms/$gymId/system-profiles/dumbbells",
            json.encodeToString(input),
        )
    }

    override suspend fun saveBarbellSystemProfile(
        gymId: String,
        input: SettingsBarbellSystemProfileInput,
    ) {
        request<JsonObject>(
            "PUT",
            "/api/gyms/$gymId/system-profiles/barbell",
            json.encodeToString(input),
        )
    }

    override suspend fun deleteGymEquipment(equipmentId: String) {
        request<JsonObject>("DELETE", "/api/gym-equipment/$equipmentId")
    }

    override suspend fun setGymEquipmentImageUrl(equipmentId: String, imageUrl: String) {
        val body = buildJsonObject { put("imageUrl", imageUrl) }
        request<JsonObject>("PUT", "/api/gym-equipment/$equipmentId/image", body.toString())
    }

    override suspend fun uploadGymEquipmentImage(
        equipmentId: String,
        imageBase64: String,
        mimeType: String,
    ) {
        val body = buildJsonObject {
            put("imageBase64", imageBase64)
            put("mimeType", mimeType)
        }
        request<JsonObject>("PUT", "/api/gym-equipment/$equipmentId/image", body.toString())
    }

    override suspend fun clearGymEquipmentImage(equipmentId: String) {
        request<JsonObject>("DELETE", "/api/gym-equipment/$equipmentId/image")
    }

    override fun equipmentImageAuthorization(): String = "Bearer $token"

    override suspend fun latestRelease(): AndroidReleaseDto =
        request("GET", "/api/android/latest", authenticated = false)

    override fun releaseDownloadUrl(release: AndroidReleaseDto): String =
        resolveAndroidDownloadUrl(baseUrl, release.downloadUrl)

    override suspend fun exportBackup(): String = requestRaw("GET", "/api/backup").body

    override suspend fun restoreBackup(payload: String) {
        val parsed = try {
            json.parseToJsonElement(payload)
        } catch (error: SerializationException) {
            throw SettingsException(SettingsErrorKind.INVALID_DATA, serverMessage = "Invalid JSON.", cause = error)
        }
        val body = buildJsonObject {
            put("payload", parsed)
            put("confirmReplace", true)
        }
        request<JsonObject>("POST", "/api/backup", body.toString())
    }

    override suspend fun previewImport(
        format: SettingsImportFormat,
        fileName: String,
        payload: String,
        unit: String,
    ): SettingsImportPreview {
        val response = importRequest(format, payload, unit, "preview")
        return SettingsImportPreview(format, fileName, payload, unit, response)
    }

    override suspend fun confirmImport(preview: SettingsImportPreview): JsonObject =
        importRequest(preview.format, preview.payload, preview.unit, "confirm")

    private suspend fun importRequest(
        format: SettingsImportFormat,
        payload: String,
        unit: String,
        mode: String,
    ): JsonObject {
        val body = buildJsonObject {
            put("mode", mode)
            when (format) {
                SettingsImportFormat.STRONG -> {
                    put("csv", payload)
                    put("unit", unit)
                }
                SettingsImportFormat.HEVY -> put("csv", payload)
                SettingsImportFormat.TCX -> put("xml", payload)
                SettingsImportFormat.GPX -> put("gpx", payload)
                SettingsImportFormat.FIT -> put("fit", payload)
            }
        }
        return request("POST", "/api/import/${format.name.lowercase()}", body.toString())
    }

    private suspend inline fun <reified T> request(
        method: String,
        path: String,
        body: String? = null,
        authenticated: Boolean = true,
    ): T {
        val response = requestRaw(method, path, body, authenticated, recordSuccess = false)
        return try {
            json.decodeFromString<T>(response.body).also {
                diagnostics.recordRequest(
                    SettingsRequestDiagnostic(
                        attemptId = attemptId,
                        correlationId = response.correlationId,
                        subrequest = response.subrequest,
                        origin = baseUrl,
                        path = path,
                        method = method,
                        statusCode = response.statusCode,
                        category = response.errorCode ?: "ok",
                        durationMs = response.durationMs,
                        authOutcome = response.authOutcome,
                        errorCode = response.errorCode,
                    ),
                )
            }
        } catch (error: SerializationException) {
            diagnostics.recordRequest(
                SettingsRequestDiagnostic(
                    attemptId = attemptId,
                    correlationId = response.correlationId,
                    subrequest = response.subrequest,
                    origin = baseUrl,
                    path = path,
                    method = method,
                    statusCode = response.statusCode,
                    category = "invalid-response",
                    durationMs = response.durationMs,
                    authOutcome = response.authOutcome,
                    errorCode = "invalid-json-schema",
                    exception = error,
                ),
            )
            throw SettingsException(
                kind = SettingsErrorKind.INVALID_RESPONSE,
                serverMessage = "The server returned an unreadable response.",
                correlationId = response.correlationId,
                subrequest = response.subrequest,
                route = path,
                authority = baseUrl,
                errorCode = "invalid-json-schema",
                authOutcome = response.authOutcome,
                cause = error,
            )
        }
    }

    private suspend fun requestRaw(
        method: String,
        path: String,
        body: String? = null,
        authenticated: Boolean = true,
        recordSuccess: Boolean = true,
    ): SettingsRawResponse = withContext(Dispatchers.IO) {
        val requestCorrelationId = UUID.randomUUID().toString()
        val requestSubrequest = settingsSubrequestForPath(path)
        val startedNanos = System.nanoTime()
        try {
            val builder = Request.Builder()
                .url("${baseUrl.trimEnd('/')}$path")
                .header(CORRELATION_HEADER, requestCorrelationId)
            if (authenticated) builder.header("Authorization", "Bearer $token")
            when (method) {
                "GET" -> builder.get()
                "POST" -> builder.post((body ?: "{}").toRequestBody(JSON_MEDIA_TYPE))
                "PATCH" -> builder.patch((body ?: "{}").toRequestBody(JSON_MEDIA_TYPE))
                "PUT" -> builder.put((body ?: "{}").toRequestBody(JSON_MEDIA_TYPE))
                "DELETE" -> builder.delete()
                else -> error("Unsupported HTTP method $method")
            }
            client.newCall(builder.build()).execute().use { response ->
                val responseBody = response.body?.string().orEmpty()
                val correlationId = safeCorrelation(response.header(CORRELATION_HEADER))
                    ?: requestCorrelationId
                val subrequest = safeDiagnosticLabel(response.header(SUBREQUEST_HEADER))
                    ?: requestSubrequest
                val authOutcome = safeDiagnosticLabel(response.header(AUTH_OUTCOME_HEADER))
                val headerErrorCode = safeDiagnosticLabel(response.header(ERROR_CODE_HEADER))
                val durationMs = elapsedMillis(startedNanos)
                if (!response.isSuccessful) {
                    val envelope = runCatching {
                        json.decodeFromString<ApiErrorResponse>(responseBody)
                    }.getOrNull()
                    val kind = settingsErrorKindForStatus(response.code)
                    val errorCode = headerErrorCode
                        ?: safeDiagnosticLabel(envelope?.code)
                        ?: safeDiagnosticLabel(kind.name)
                    val failure = SettingsException(
                        kind = kind,
                        statusCode = response.code,
                        serverMessage = envelope?.error,
                        correlationId = correlationId,
                        subrequest = subrequest,
                        route = path,
                        authority = baseUrl,
                        errorCode = errorCode,
                        authOutcome = authOutcome,
                        retryable = response.code !in setOf(400, 409, 413, 422),
                    )
                    diagnostics.recordRequest(
                        SettingsRequestDiagnostic(
                            attemptId = attemptId,
                            correlationId = correlationId,
                            subrequest = subrequest,
                            origin = baseUrl,
                            path = path,
                            method = method,
                            statusCode = response.code,
                            category = errorCode ?: kind.name,
                            durationMs = durationMs,
                            authOutcome = authOutcome,
                            errorCode = errorCode,
                            exception = failure,
                        ),
                    )
                    throw failure
                }
                if (recordSuccess) {
                    diagnostics.recordRequest(
                        SettingsRequestDiagnostic(
                            attemptId = attemptId,
                            correlationId = correlationId,
                            subrequest = subrequest,
                            origin = baseUrl,
                            path = path,
                            method = method,
                            statusCode = response.code,
                            category = headerErrorCode ?: "ok",
                            durationMs = durationMs,
                            authOutcome = authOutcome,
                            errorCode = headerErrorCode,
                        ),
                    )
                }
                SettingsRawResponse(
                    body = responseBody,
                    statusCode = response.code,
                    correlationId = correlationId,
                    subrequest = subrequest,
                    authOutcome = authOutcome,
                    errorCode = headerErrorCode,
                    durationMs = durationMs,
                )
            }
        } catch (error: SettingsException) {
            throw error
        } catch (error: Throwable) {
            val kind = classifySettingsError(error)
            val failure = SettingsException(
                kind = kind,
                correlationId = requestCorrelationId,
                subrequest = requestSubrequest,
                route = path,
                authority = baseUrl,
                errorCode = safeDiagnosticLabel(kind.name),
                cause = error,
            )
            diagnostics.recordRequest(
                SettingsRequestDiagnostic(
                    attemptId = attemptId,
                    correlationId = requestCorrelationId,
                    subrequest = requestSubrequest,
                    origin = baseUrl,
                    path = path,
                    method = method,
                    statusCode = null,
                    category = kind.name,
                    durationMs = elapsedMillis(startedNanos),
                    errorCode = kind.name,
                    exception = error,
                ),
            )
            throw failure
        }
    }

    private data class SettingsRawResponse(
        val body: String,
        val statusCode: Int,
        val correlationId: String,
        val subrequest: String?,
        val authOutcome: String?,
        val errorCode: String?,
        val durationMs: Long,
    )

    companion object {
        private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()
        private const val CORRELATION_HEADER = "X-GymCoach-Correlation-ID"
        private const val SUBREQUEST_HEADER = "X-GymCoach-Settings-Subrequest"
        private const val AUTH_OUTCOME_HEADER = "X-GymCoach-Auth-Outcome"
        private const val ERROR_CODE_HEADER = "X-GymCoach-Error-Code"

        private fun defaultClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(45, TimeUnit.SECONDS)
            .writeTimeout(45, TimeUnit.SECONDS)
            .build()
    }
}

fun settingsErrorKindForStatus(statusCode: Int): SettingsErrorKind = when (statusCode) {
    400, 409, 413, 422 -> SettingsErrorKind.INVALID_DATA
    401 -> SettingsErrorKind.AUTHENTICATION
    403 -> SettingsErrorKind.FORBIDDEN
    404 -> SettingsErrorKind.NOT_FOUND
    429 -> SettingsErrorKind.RATE_LIMIT
    502, 504 -> SettingsErrorKind.BAD_GATEWAY
    500, 503 -> SettingsErrorKind.SERVER_UNAVAILABLE
    else -> SettingsErrorKind.UNKNOWN
}

fun classifySettingsError(error: Throwable): SettingsErrorKind = when (error) {
    is UnknownHostException -> SettingsErrorKind.DNS
    is SocketTimeoutException -> SettingsErrorKind.TIMEOUT
    is SSLException -> SettingsErrorKind.TLS
    is ConnectException -> SettingsErrorKind.TRANSPORT
    is SerializationException -> SettingsErrorKind.INVALID_RESPONSE
    else -> SettingsErrorKind.OFFLINE.takeIf {
        error is java.io.IOException
    } ?: SettingsErrorKind.UNKNOWN
}

private fun settingsSubrequestForPath(path: String): String? = when {
    path == "/api/profile" -> "profile"
    path == "/api/gyms" -> "gyms"
    path == "/api/mobile/exercises" -> "exercises"
    Regex("^/api/gyms/[^/]+/equipment$").matches(path) -> "gym-equipment"
    else -> null
}

private fun elapsedMillis(startedNanos: Long): Long =
    ((System.nanoTime() - startedNanos) / 1_000_000L).coerceIn(0, 300_000)
