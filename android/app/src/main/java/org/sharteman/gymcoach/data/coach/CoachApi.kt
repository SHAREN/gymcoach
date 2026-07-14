package org.sharteman.gymcoach.data.coach

import java.io.IOException
import java.net.URLEncoder
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.sharteman.gymcoach.data.model.ApiErrorResponse

interface CoachRemote {
    val json: Json
    suspend fun overview(baseUrl: String, token: String): CoachOverviewDto
    suspend fun generateDebrief(baseUrl: String, token: String): GeneratedDebriefDto
    suspend fun updateNote(baseUrl: String, token: String, note: String?)
    suspend fun applyAdjustments(
        baseUrl: String,
        token: String,
        debriefId: String,
        adjustments: List<CoachAdjustment>,
    ): ApplyAdjustmentsResponse
    suspend fun conversations(baseUrl: String, token: String): List<ConversationSummaryDto>
    suspend fun messages(baseUrl: String, token: String, conversationId: String): ConversationMessagesDto
    suspend fun sendMessage(
        baseUrl: String,
        token: String,
        request: SendChatRequest,
    ): ChatReply
}

class CoachApi : CoachRemote {
    override val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        explicitNulls = true
    }

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    override suspend fun overview(baseUrl: String, token: String): CoachOverviewDto = get(
        url = "${baseUrl.trimEnd('/')}/api/mobile/coach/overview",
        token = token,
    )

    override suspend fun generateDebrief(baseUrl: String, token: String): GeneratedDebriefDto = post(
        url = "${baseUrl.trimEnd('/')}/api/coach",
        token = token,
        body = "{}",
    )

    override suspend fun updateNote(baseUrl: String, token: String, note: String?) {
        withContext(Dispatchers.IO) {
            requestText(
                Request.Builder()
                    .url("${baseUrl.trimEnd('/')}/api/profile")
                    .header("Authorization", "Bearer $token")
                    .patch(json.encodeToString(CoachNoteRequest(note)).toRequestBody(JSON_MEDIA_TYPE))
                    .build(),
            )
        }
    }

    override suspend fun applyAdjustments(
        baseUrl: String,
        token: String,
        debriefId: String,
        adjustments: List<CoachAdjustment>,
    ): ApplyAdjustmentsResponse = post(
        url = "${baseUrl.trimEnd('/')}/api/coach/${path(debriefId)}/apply",
        token = token,
        body = json.encodeToString(ApplyAdjustmentsRequest(adjustments)),
    )

    override suspend fun conversations(
        baseUrl: String,
        token: String,
    ): List<ConversationSummaryDto> = get(
        url = "${baseUrl.trimEnd('/')}/api/coach/chat",
        token = token,
    )

    override suspend fun messages(
        baseUrl: String,
        token: String,
        conversationId: String,
    ): ConversationMessagesDto = get(
        url = "${baseUrl.trimEnd('/')}/api/coach/chat/${path(conversationId)}",
        token = token,
    )

    override suspend fun sendMessage(
        baseUrl: String,
        token: String,
        request: SendChatRequest,
    ): ChatReply = withContext(Dispatchers.IO) {
        val httpRequest = Request.Builder()
            .url("${baseUrl.trimEnd('/')}/api/coach/chat")
            .header("Authorization", "Bearer $token")
            .post(json.encodeToString(request).toRequestBody(JSON_MEDIA_TYPE))
            .build()
        client.newCall(httpRequest).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) throw apiException(response.code, body)
            val conversationId = response.header("X-Conversation-Id")
                ?: throw CoachApiException(response.code, "Conversation id is missing.")
            ChatReply(conversationId = conversationId, content = body)
        }
    }

    private suspend inline fun <reified T> get(url: String, token: String): T = withContext(Dispatchers.IO) {
        val body = requestText(
            Request.Builder().url(url).header("Authorization", "Bearer $token").get().build(),
        )
        json.decodeFromString(body)
    }

    private suspend inline fun <reified T> post(url: String, token: String, body: String): T =
        withContext(Dispatchers.IO) {
            val response = requestText(
                Request.Builder()
                    .url(url)
                    .header("Authorization", "Bearer $token")
                    .post(body.toRequestBody(JSON_MEDIA_TYPE))
                    .build(),
            )
            json.decodeFromString(response)
        }

    private fun requestText(request: Request): String = client.newCall(request).execute().use { response ->
        val body = response.body?.string().orEmpty()
        if (!response.isSuccessful) throw apiException(response.code, body)
        body
    }

    private fun apiException(statusCode: Int, body: String): CoachApiException {
        val envelope = runCatching { json.decodeFromString<ApiErrorResponse>(body) }.getOrNull()
        return CoachApiException(statusCode, envelope?.error ?: "HTTP $statusCode")
    }

    private fun path(value: String): String = URLEncoder.encode(value, "UTF-8")

    private companion object {
        val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()
    }
}

class CoachApiException(
    val statusCode: Int,
    message: String,
) : IOException(message)
