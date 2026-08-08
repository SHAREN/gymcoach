package org.sharteman.gymcoach.data.network

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.RequestBody.Companion.toRequestBody
import org.sharteman.gymcoach.data.model.ApiErrorResponse
import org.sharteman.gymcoach.data.model.BootstrapResponse
import org.sharteman.gymcoach.data.model.LoginRequest
import org.sharteman.gymcoach.data.model.LoginResponse
import org.sharteman.gymcoach.data.model.MobileProgressSnapshot
import org.sharteman.gymcoach.data.model.ReadinessCheckinRequest
import org.sharteman.gymcoach.data.model.SyncBatchRequest
import org.sharteman.gymcoach.data.model.SyncBatchResponse
import java.io.IOException
import java.util.concurrent.TimeUnit

interface MobileApi {
    val json: Json
    suspend fun login(baseUrl: String, request: LoginRequest): LoginResponse
    suspend fun bootstrap(baseUrl: String, token: String): BootstrapResponse
    suspend fun progress(baseUrl: String, token: String, exerciseId: String? = null): MobileProgressSnapshot
    suspend fun sync(baseUrl: String, token: String, request: SyncBatchRequest): SyncBatchResponse
    suspend fun saveReadiness(baseUrl: String, token: String, request: ReadinessCheckinRequest)
    suspend fun createWebSession(baseUrl: String, token: String): List<String>
    suspend fun logout(baseUrl: String, token: String)
}

class ApiClient : MobileApi {
    override val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        explicitNulls = true
        classDiscriminator = "type"
    }

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    override suspend fun login(baseUrl: String, request: LoginRequest): LoginResponse = post(
        url = "${baseUrl.trimEnd('/')}/api/mobile/auth/login",
        body = json.encodeToString(request),
        token = null,
    )

    override suspend fun bootstrap(baseUrl: String, token: String): BootstrapResponse = get(
        url = "${baseUrl.trimEnd('/')}/api/mobile/bootstrap",
        token = token,
    )

    override suspend fun progress(
        baseUrl: String,
        token: String,
        exerciseId: String?,
    ): MobileProgressSnapshot = get(
        url = buildString {
            append(baseUrl.trimEnd('/'))
            append("/api/mobile/progress")
            exerciseId?.let {
                append("?exerciseId=")
                append(java.net.URLEncoder.encode(it, java.nio.charset.StandardCharsets.UTF_8.toString()))
            }
        },
        token = token,
    )

    override suspend fun sync(baseUrl: String, token: String, request: SyncBatchRequest): SyncBatchResponse =
        post(
            url = "${baseUrl.trimEnd('/')}/api/mobile/sync",
            body = json.encodeToString(request),
            token = token,
        )

    override suspend fun saveReadiness(
        baseUrl: String,
        token: String,
        request: ReadinessCheckinRequest,
    ) = requestWithoutResponse(
        Request.Builder()
            .url("${baseUrl.trimEnd('/')}/api/mobile/readiness")
            .header("Authorization", "Bearer $token")
            .post(json.encodeToString(request).toRequestBody(JSON_MEDIA_TYPE))
            .build(),
    )

    override suspend fun createWebSession(baseUrl: String, token: String): List<String> = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("${baseUrl.trimEnd('/')}/api/mobile/auth/web-session")
            .header("Authorization", "Bearer $token")
            .post(ByteArray(0).toRequestBody(JSON_MEDIA_TYPE))
            .build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw apiException(response, response.body?.string().orEmpty())
            }
            response.headers("Set-Cookie").also { cookies ->
                if (cookies.isEmpty()) {
                    throw ApiException(
                        statusCode = response.code,
                        serverMessage = "Server did not return a web session cookie.",
                        errorCode = "MISSING_WEB_SESSION",
                    )
                }
            }
        }
    }

    override suspend fun logout(baseUrl: String, token: String) = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("${baseUrl.trimEnd('/')}/api/mobile/auth/logout")
            .header("Authorization", "Bearer $token")
            .post(ByteArray(0).toRequestBody(JSON_MEDIA_TYPE))
            .build()
        client.newCall(request).execute().close()
    }

    private suspend fun requestWithoutResponse(request: Request) = withContext(Dispatchers.IO) {
        client.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) throw apiException(response, body)
        }
    }

    private suspend inline fun <reified T> get(url: String, token: String): T = withContext(Dispatchers.IO) {
        val request = Request.Builder().url(url).header("Authorization", "Bearer $token").get().build()
        client.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) throw apiException(response, body)
            json.decodeFromString<T>(body)
        }
    }

    private suspend inline fun <reified T> post(url: String, body: String, token: String?): T =
        withContext(Dispatchers.IO) {
            val request = Request.Builder()
                .url(url)
                .apply { if (token != null) header("Authorization", "Bearer $token") }
                .post(body.toRequestBody(JSON_MEDIA_TYPE))
                .build()
            client.newCall(request).execute().use { response ->
                val responseBody = response.body?.string().orEmpty()
                if (!response.isSuccessful) throw apiException(response, responseBody)
                json.decodeFromString<T>(responseBody)
            }
        }

    private fun apiException(response: Response, responseBody: String): ApiException {
        val envelope = runCatching {
            json.decodeFromString<ApiErrorResponse>(responseBody)
        }.getOrNull()
        return ApiException(
            statusCode = response.code,
            serverMessage = envelope?.error,
            errorCode = envelope?.code,
            retryAfterSeconds = response.header("Retry-After")?.toIntOrNull(),
            correlationId = response.header(CORRELATION_HEADER),
            serverResponse = responseBody,
        )
    }

    private companion object {
        val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()
        const val CORRELATION_HEADER = "X-GymCoach-Correlation-ID"
    }
}

class ApiException(
    val statusCode: Int,
    val serverMessage: String?,
    val errorCode: String? = null,
    val retryAfterSeconds: Int? = null,
    val correlationId: String? = null,
    val serverResponse: String? = null,
) : IOException(serverMessage?.takeIf { it.isNotBlank() } ?: "HTTP $statusCode")
