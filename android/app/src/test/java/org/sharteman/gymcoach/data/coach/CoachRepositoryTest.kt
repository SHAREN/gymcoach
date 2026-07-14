package org.sharteman.gymcoach.data.coach

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Test
import org.sharteman.gymcoach.data.security.AccountStore

class CoachRepositoryTest {
    @Test
    fun forwardsTheMobileCredentialsAndLiveSessionContext() = runTest {
        val remote = FakeRemote()
        val repository = CoachRepository(FakeAccountStore(), remote)

        val reply = repository.sendMessage(null, "How is this set?", "session_uuid")

        assertEquals("conversation_1", reply.conversationId)
        assertEquals("https://gym.example", remote.baseUrl)
        assertEquals("gma_token", remote.token)
        assertEquals("session_uuid", remote.chatRequest?.sessionId)
        assertEquals("How is this set?", remote.chatRequest?.message)
    }

    private class FakeAccountStore : AccountStore {
        override val deviceId = "device"
        override var serverUrl = "https://gym.example"
        override var userId: String? = "user"
        override var userEmail: String? = "user@example.com"
        override fun getAccessToken() = "gma_token"
        override fun setAccessToken(token: String) = Unit
        override fun clearAccessToken() = Unit
        override fun clearAccount() = Unit
    }

    private class FakeRemote : CoachRemote {
        override val json = Json { ignoreUnknownKeys = true }
        var baseUrl: String? = null
        var token: String? = null
        var chatRequest: SendChatRequest? = null

        override suspend fun overview(baseUrl: String, token: String) = error("unused")
        override suspend fun generateDebrief(baseUrl: String, token: String) = error("unused")
        override suspend fun updateNote(baseUrl: String, token: String, note: String?) = Unit
        override suspend fun applyAdjustments(
            baseUrl: String,
            token: String,
            debriefId: String,
            adjustments: List<CoachAdjustment>,
        ) = error("unused")
        override suspend fun conversations(baseUrl: String, token: String) = emptyList<ConversationSummaryDto>()
        override suspend fun messages(baseUrl: String, token: String, conversationId: String) =
            ConversationMessagesDto()
        override suspend fun sendMessage(
            baseUrl: String,
            token: String,
            request: SendChatRequest,
        ): ChatReply {
            this.baseUrl = baseUrl
            this.token = token
            chatRequest = request
            return ChatReply("conversation_1", "Reply")
        }
    }
}
