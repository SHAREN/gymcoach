package org.sharteman.gymcoach.data.coach

import android.content.Context
import org.sharteman.gymcoach.data.security.AccountStore
import org.sharteman.gymcoach.data.security.SecureAccountStore
import org.sharteman.gymcoach.data.network.ServerEndpointResolver

class CoachRepository(
    private val accountStore: AccountStore,
    private val remote: CoachRemote,
) {
    private val endpointResolver = ServerEndpointResolver(accountStore)

    suspend fun loadOverview(): CoachOverviewDto = withCredentials(remote::overview)

    suspend fun requestDebrief(): GeneratedDebriefDto = withCredentials(remote::generateDebrief)

    suspend fun saveNote(note: String?) = withCredentials { baseUrl, token ->
        remote.updateNote(baseUrl, token, note)
    }

    suspend fun applyAdjustments(
        debriefId: String,
        adjustments: List<CoachAdjustment>,
    ): ApplyAdjustmentsResponse = withCredentials { baseUrl, token ->
        remote.applyAdjustments(baseUrl, token, debriefId, adjustments)
    }

    suspend fun loadConversations(): List<ConversationSummaryDto> =
        withCredentials(remote::conversations)

    suspend fun loadMessages(conversationId: String): List<ChatMessage> =
        withCredentials { baseUrl, token ->
            remote.messages(baseUrl, token, conversationId).messages.map { message ->
                ChatMessage(
                    role = if (message.role == "ASSISTANT") ChatRole.ASSISTANT else ChatRole.USER,
                    content = message.content,
                )
            }
        }

    suspend fun sendMessage(
        conversationId: String?,
        message: String,
        sessionId: String?,
    ): ChatReply = withCredentials { baseUrl, token ->
        remote.sendMessage(
            baseUrl,
            token,
            SendChatRequest(conversationId, message, sessionId),
        )
    }

    private suspend fun <T> withCredentials(block: suspend (String, String) -> T): T {
        val token = requireNotNull(accountStore.getAccessToken()) { "Not signed in" }
        return endpointResolver.execute { baseUrl -> block(baseUrl, token) }
    }

    companion object {
        fun create(context: Context): CoachRepository = CoachRepository(
            accountStore = SecureAccountStore(context.applicationContext),
            remote = CoachApi(),
        )
    }
}
