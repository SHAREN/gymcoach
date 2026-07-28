package org.sharteman.gymcoach.data.network

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.sharteman.gymcoach.data.model.ApiErrorResponse
import org.sharteman.gymcoach.data.model.HistoricalSetAddRequest
import org.sharteman.gymcoach.data.model.HistoricalSetUpdateRequest
import org.sharteman.gymcoach.data.model.MobileGoalRequest
import org.sharteman.gymcoach.data.model.MobileHistorySnapshot
import org.sharteman.gymcoach.data.model.MobileVolumeTargetClearRequest
import org.sharteman.gymcoach.data.model.MobileVolumeTargetRequest
import java.util.concurrent.TimeUnit

fun interface HistoryMutationRemote {
    suspend fun deleteHistorySession(baseUrl: String, token: String, sessionId: String)
}

class HistoryProgressApiClient : HistoryMutationRemote {
    val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        explicitNulls = true
    }

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    suspend fun history(
        baseUrl: String,
        token: String,
        month: String,
        programId: String?,
    ): MobileHistorySnapshot {
        val url = baseUrl.trimEnd('/').toHttpUrl().newBuilder()
            .addPathSegments("api/mobile/history")
            .addQueryParameter("month", month)
            .apply { if (programId != null) addQueryParameter("programId", programId) }
            .build()
        return execute(Request.Builder().url(url).bearer(token).get().build())
    }

    override suspend fun deleteHistorySession(baseUrl: String, token: String, sessionId: String) {
        executeWithoutBody(
            Request.Builder()
                .url("${baseUrl.trimEnd('/')}/api/mobile/history/$sessionId")
                .bearer(token)
                .delete()
                .build(),
        )
    }

    suspend fun updateHistoricalSet(
        baseUrl: String,
        token: String,
        setId: String,
        request: HistoricalSetUpdateRequest,
    ) {
        executeWithoutBody(
            Request.Builder()
                .url("${baseUrl.trimEnd('/')}/api/sets/$setId")
                .bearer(token)
                .patch(json.encodeToString(request).toRequestBody(JSON_MEDIA_TYPE))
                .build(),
        )
    }

    suspend fun addHistoricalSet(
        baseUrl: String,
        token: String,
        sessionId: String,
        request: HistoricalSetAddRequest,
    ) {
        post(
            baseUrl,
            token,
            "api/sessions/$sessionId/historical-sets",
            json.encodeToString(request),
        )
    }

    suspend fun deleteHistoricalSet(baseUrl: String, token: String, setId: String) {
        executeWithoutBody(
            Request.Builder()
                .url("${baseUrl.trimEnd('/')}/api/sets/$setId")
                .bearer(token)
                .delete()
                .build(),
        )
    }

    suspend fun saveGoal(baseUrl: String, token: String, request: MobileGoalRequest) {
        post(baseUrl, token, "api/mobile/progress/goals", json.encodeToString(request))
    }

    suspend fun deleteGoal(baseUrl: String, token: String, goalId: String) {
        executeWithoutBody(
            Request.Builder()
                .url("${baseUrl.trimEnd('/')}/api/mobile/progress/goals/$goalId")
                .bearer(token)
                .delete()
                .build(),
        )
    }

    suspend fun saveVolumeTarget(
        baseUrl: String,
        token: String,
        request: MobileVolumeTargetRequest,
    ) {
        post(baseUrl, token, "api/mobile/progress/volume-targets", json.encodeToString(request))
    }

    suspend fun clearVolumeTarget(
        baseUrl: String,
        token: String,
        request: MobileVolumeTargetClearRequest,
    ) {
        executeWithoutBody(
            Request.Builder()
                .url("${baseUrl.trimEnd('/')}/api/mobile/progress/volume-targets")
                .bearer(token)
                .delete(json.encodeToString(request).toRequestBody(JSON_MEDIA_TYPE))
                .build(),
        )
    }

    suspend fun startDeload(baseUrl: String, token: String) {
        post(baseUrl, token, "api/mobile/progress/deload", "{}")
    }

    suspend fun endDeload(baseUrl: String, token: String) {
        executeWithoutBody(
            Request.Builder()
                .url("${baseUrl.trimEnd('/')}/api/mobile/progress/deload")
                .bearer(token)
                .delete()
                .build(),
        )
    }

    private suspend fun post(baseUrl: String, token: String, path: String, body: String) {
        executeWithoutBody(
            Request.Builder()
                .url("${baseUrl.trimEnd('/')}/$path")
                .bearer(token)
                .post(body.toRequestBody(JSON_MEDIA_TYPE))
                .build(),
        )
    }

    private suspend inline fun <reified T> execute(request: Request): T = withContext(Dispatchers.IO) {
        client.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) throw apiException(response.code, response.header("Retry-After"), body)
            json.decodeFromString<T>(body)
        }
    }

    private suspend fun executeWithoutBody(request: Request) = withContext(Dispatchers.IO) {
        client.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) throw apiException(response.code, response.header("Retry-After"), body)
        }
    }

    private fun apiException(status: Int, retryAfter: String?, body: String): ApiException {
        val envelope = runCatching { json.decodeFromString<ApiErrorResponse>(body) }.getOrNull()
        return ApiException(
            statusCode = status,
            serverMessage = envelope?.error,
            errorCode = envelope?.code,
            retryAfterSeconds = retryAfter?.toIntOrNull(),
        )
    }

    private fun Request.Builder.bearer(token: String): Request.Builder =
        header("Authorization", "Bearer $token")

    private companion object {
        val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()
    }
}
