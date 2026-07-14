package org.sharteman.gymcoach.ui.coach

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AddComment
import androidx.compose.material.icons.filled.FitnessCenter
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import org.sharteman.gymcoach.R
import org.sharteman.gymcoach.data.coach.ChatMessage
import org.sharteman.gymcoach.data.coach.ChatRole
import org.sharteman.gymcoach.data.coach.CoachProviderDto
import org.sharteman.gymcoach.data.coach.CoachRepository
import org.sharteman.gymcoach.data.coach.ConversationSummaryDto

data class ChatUiState(
    val loading: Boolean = true,
    val provider: CoachProviderDto? = null,
    val conversations: List<ConversationSummaryDto> = emptyList(),
    val activeConversationId: String? = null,
    val messages: List<ChatMessage> = emptyList(),
    val input: String = "",
    val openingConversation: Boolean = false,
    val sending: Boolean = false,
    val pendingMessage: String? = null,
    val error: String? = null,
)

@Composable
fun ChatScreen(
    sessionId: String? = null,
    onBack: () -> Unit,
    repository: CoachRepository = CoachRepository.create(LocalContext.current),
) {
    var state by remember(sessionId) { mutableStateOf(ChatUiState()) }
    val unknownError = stringResource(R.string.coach_native_error_unknown)

    LaunchedEffect(sessionId) {
        runCatching { repository.loadOverview() }
            .onSuccess { overview ->
                val activeId = if (sessionId == null) overview.conversations.firstOrNull()?.id else null
                state = state.copy(
                    loading = false,
                    provider = overview.provider,
                    conversations = overview.conversations,
                    activeConversationId = activeId,
                )
                if (activeId != null) {
                    runCatching { repository.loadMessages(activeId) }
                        .onSuccess { state = state.copy(messages = it) }
                        .onFailure { state = state.copy(error = it.message ?: unknownError) }
                }
            }
            .onFailure { state = state.copy(loading = false, error = it.message ?: unknownError) }
    }

    ChatScreenContent(
        state = state,
        sessionId = sessionId,
        onBack = onBack,
        onNewConversation = {
            if (!state.sending) state = state.copy(
                activeConversationId = null,
                messages = emptyList(),
                error = null,
            )
        },
        onOpenConversation = { id ->
            if (!state.sending && id != state.activeConversationId) {
                state = state.copy(
                    activeConversationId = id,
                    openingConversation = true,
                    error = null,
                )
            }
        },
        onInputChange = { state = state.copy(input = it.take(MAX_CHAT_MESSAGE_LENGTH)) },
        onSend = {
            val text = state.input.trim()
            if (text.isNotEmpty() && !state.sending) {
                state = state.copy(
                    input = "",
                    messages = state.messages + ChatMessage(ChatRole.USER, text),
                    sending = true,
                    pendingMessage = text,
                    error = null,
                )
            }
        },
    )

    LaunchedEffect(state.openingConversation, state.activeConversationId) {
        if (!state.openingConversation) return@LaunchedEffect
        val id = state.activeConversationId ?: return@LaunchedEffect
        runCatching { repository.loadMessages(id) }
            .onSuccess { state = state.copy(openingConversation = false, messages = it) }
            .onFailure {
                state = state.copy(openingConversation = false, error = it.message ?: unknownError)
            }
    }

    LaunchedEffect(state.pendingMessage) {
        val text = state.pendingMessage ?: return@LaunchedEffect
        runCatching {
            repository.sendMessage(
                conversationId = state.activeConversationId,
                message = text,
                sessionId = sessionId,
            )
        }.onSuccess { reply ->
            val existing = state.conversations.any { it.id == reply.conversationId }
            state = state.copy(
                activeConversationId = reply.conversationId,
                messages = state.messages + ChatMessage(ChatRole.ASSISTANT, reply.content),
                conversations = if (existing) state.conversations else listOf(
                    ConversationSummaryDto(
                        id = reply.conversationId,
                        title = text.replace(Regex("\\s+"), " ").take(60),
                        updatedAt = java.time.Instant.now().toString(),
                    ),
                ) + state.conversations,
                sending = false,
                pendingMessage = null,
            )
        }.onFailure {
            state = state.copy(
                messages = state.messages + ChatMessage(
                    ChatRole.ASSISTANT,
                    "[error] ${it.message ?: unknownError}",
                ),
                sending = false,
                pendingMessage = null,
                error = it.message ?: unknownError,
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreenContent(
    state: ChatUiState,
    sessionId: String?,
    onBack: () -> Unit,
    onNewConversation: () -> Unit,
    onOpenConversation: (String) -> Unit,
    onInputChange: (String) -> Unit,
    onSend: () -> Unit,
) {
    Scaffold(
        modifier = Modifier.imePadding().testTag("coach-chat-screen"),
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.coach_chat_title)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = stringResource(R.string.coach_chat_back),
                        )
                    }
                },
            )
        },
        bottomBar = {
            ChatComposer(
                value = state.input,
                enabled = state.provider?.configured == true && !state.sending,
                onValueChange = onInputChange,
                onSend = onSend,
            )
        },
    ) { padding ->
        if (state.loading) {
            Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
            return@Scaffold
        }
        Column(
            Modifier.fillMaxSize().padding(padding).padding(horizontal = 12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            if (state.provider?.configured == false) {
                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer)) {
                    Text(
                        stringResource(
                            R.string.coach_native_provider_missing,
                            state.provider.label,
                            state.provider.apiKeyEnvVar,
                        ),
                        Modifier.padding(12.dp),
                    )
                }
            }
            if (sessionId != null) {
                Row(
                    Modifier.fillMaxWidth()
                        .background(MaterialTheme.colorScheme.primaryContainer, RoundedCornerShape(10.dp))
                        .padding(12.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Default.FitnessCenter, contentDescription = null)
                    Text(stringResource(R.string.coach_chat_live_session), style = MaterialTheme.typography.bodySmall)
                }
            }
            ConversationPicker(
                conversations = state.conversations,
                activeId = state.activeConversationId,
                enabled = !state.sending,
                onNewConversation = onNewConversation,
                onOpenConversation = onOpenConversation,
            )
            state.error?.let {
                Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            }
            MessageThread(
                messages = state.messages,
                loading = state.openingConversation,
                sending = state.sending,
                sessionId = sessionId,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun ConversationPicker(
    conversations: List<ConversationSummaryDto>,
    activeId: String?,
    enabled: Boolean,
    onNewConversation: () -> Unit,
    onOpenConversation: (String) -> Unit,
) {
    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        item {
            Button(onClick = onNewConversation, enabled = enabled) {
                Icon(Icons.Default.AddComment, contentDescription = null)
                Text(stringResource(R.string.coach_chat_new), Modifier.padding(start = 6.dp))
            }
        }
        items(conversations, key = { it.id }) { conversation ->
            TextButton(
                onClick = { onOpenConversation(conversation.id) },
                enabled = enabled,
                colors = androidx.compose.material3.ButtonDefaults.textButtonColors(
                    containerColor = if (conversation.id == activeId) {
                        MaterialTheme.colorScheme.primaryContainer
                    } else Color.Transparent,
                ),
            ) {
                Text(
                    conversation.title ?: stringResource(R.string.coach_chat_conversation),
                    maxLines = 1,
                )
            }
        }
    }
}

@Composable
private fun MessageThread(
    messages: List<ChatMessage>,
    loading: Boolean,
    sending: Boolean,
    sessionId: String?,
    modifier: Modifier,
) {
    val listState = rememberLazyListState()
    LaunchedEffect(messages.size, sending) {
        val count = messages.size + if (sending) 1 else 0
        if (count > 0) listState.animateScrollToItem(count - 1)
    }
    Card(modifier.fillMaxWidth()) {
        when {
            loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
            messages.isEmpty() -> Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
                Text(
                    if (sessionId == null) stringResource(R.string.coach_chat_empty)
                    else stringResource(R.string.coach_chat_empty_session),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            else -> LazyColumn(
                modifier = Modifier.fillMaxSize().padding(10.dp),
                state = listState,
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                items(messages.size) { index -> MessageBubble(messages[index]) }
                if (sending) item {
                    Box(Modifier.padding(12.dp)) { CircularProgressIndicator(Modifier.widthIn(max = 22.dp)) }
                }
            }
        }
    }
}

@Composable
private fun MessageBubble(message: ChatMessage) {
    val isUser = message.role == ChatRole.USER
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start,
    ) {
        Column(
            Modifier
                .widthIn(max = 340.dp)
                .background(
                    if (isUser) MaterialTheme.colorScheme.primary
                    else MaterialTheme.colorScheme.surfaceVariant,
                    RoundedCornerShape(12.dp),
                )
                .padding(12.dp),
        ) {
            if (isUser) {
                Text(message.content, color = MaterialTheme.colorScheme.onPrimary)
            } else {
                MarkdownContent(message.content)
            }
        }
    }
}

@Composable
private fun ChatComposer(
    value: String,
    enabled: Boolean,
    onValueChange: (String) -> Unit,
    onSend: () -> Unit,
) {
    Row(
        Modifier.fillMaxWidth()
            .background(MaterialTheme.colorScheme.surface)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.Bottom,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        OutlinedTextField(
            value = value,
            onValueChange = onValueChange,
            enabled = enabled,
            modifier = Modifier.weight(1f).testTag("coach-chat-input"),
            maxLines = 5,
            placeholder = { Text(stringResource(R.string.coach_chat_placeholder)) },
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
            keyboardActions = KeyboardActions(onSend = { if (value.isNotBlank()) onSend() }),
        )
        IconButton(
            onClick = onSend,
            enabled = enabled && value.isNotBlank(),
            modifier = Modifier.testTag("coach-chat-send"),
        ) {
            Icon(Icons.AutoMirrored.Filled.Send, contentDescription = stringResource(R.string.coach_chat_send))
        }
    }
}

private const val MAX_CHAT_MESSAGE_LENGTH = 4000
