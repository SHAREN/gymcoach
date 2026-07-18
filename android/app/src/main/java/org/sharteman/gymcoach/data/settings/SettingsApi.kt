package org.sharteman.gymcoach.data.settings

import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
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
import org.sharteman.gymcoach.data.model.ExerciseDto
import org.sharteman.gymcoach.data.network.resolveAndroidDownloadUrl

interface SettingsDataSource {
    suspend fun load(): SettingsSnapshot
    suspend fun saveProfile(input: SettingsProfileInput): SettingsProfileDto
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
) : SettingsDataSource {
    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        explicitNulls = true
    }

    override suspend fun load(): SettingsSnapshot {
        val profile = request<SettingsProfileDto>("GET", "/api/profile")
        val gyms = request<SettingsGymListDto>("GET", "/api/gyms")
        val exercises = request<List<ExerciseDto>>("GET", "/api/mobile/exercises")
        val inventories = gyms.gyms.associate { gym ->
            gym.id to loadGymInventory(gym.id).normalizeSystemProfiles(gym, exercises)
        }
        return SettingsSnapshot(profile, gyms, exercises, inventories)
    }

    override suspend fun saveProfile(input: SettingsProfileInput): SettingsProfileDto =
        request("PATCH", "/api/profile", json.encodeToString(input))

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

    override suspend fun exportBackup(): String = requestRaw("GET", "/api/backup")

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
        val responseBody = requestRaw(method, path, body, authenticated)
        return try {
            json.decodeFromString(responseBody)
        } catch (error: SerializationException) {
            throw SettingsException(
                SettingsErrorKind.INVALID_RESPONSE,
                serverMessage = "The server returned an unreadable response.",
                cause = error,
            )
        }
    }

    private suspend fun requestRaw(
        method: String,
        path: String,
        body: String? = null,
        authenticated: Boolean = true,
    ): String = withContext(Dispatchers.IO) {
        try {
            val builder = Request.Builder().url("${baseUrl.trimEnd('/')}$path")
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
                if (!response.isSuccessful) {
                    val envelope = runCatching {
                        json.decodeFromString<ApiErrorResponse>(responseBody)
                    }.getOrNull()
                    throw SettingsException(
                        kind = settingsErrorKindForStatus(response.code),
                        statusCode = response.code,
                        serverMessage = envelope?.error,
                    )
                }
                responseBody
            }
        } catch (error: SettingsException) {
            throw error
        } catch (error: Throwable) {
            throw SettingsException(classifySettingsError(error), cause = error)
        }
    }

    companion object {
        private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()

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
    is ConnectException -> SettingsErrorKind.SERVER_UNAVAILABLE
    is SerializationException -> SettingsErrorKind.INVALID_RESPONSE
    else -> SettingsErrorKind.OFFLINE.takeIf {
        error is java.io.IOException
    } ?: SettingsErrorKind.UNKNOWN
}
