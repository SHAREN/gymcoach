package org.sharteman.gymcoach.ui.coach

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import org.sharteman.gymcoach.R
import org.sharteman.gymcoach.data.errors.AppErrorContext
import org.sharteman.gymcoach.data.errors.AppErrorDataState
import org.sharteman.gymcoach.data.errors.AppErrorOperation
import org.sharteman.gymcoach.data.coach.CoachAdjustment
import org.sharteman.gymcoach.data.coach.CoachContextDto
import org.sharteman.gymcoach.data.coach.CoachDebriefDto
import org.sharteman.gymcoach.data.coach.CoachOverviewDto
import org.sharteman.gymcoach.data.coach.CoachRepository
import org.sharteman.gymcoach.data.coach.firstCoachLine
import org.sharteman.gymcoach.data.coach.parseCoachResponse
import org.sharteman.gymcoach.data.coach.withDefaults
import org.sharteman.gymcoach.ui.friendlyErrorMessage
import org.sharteman.gymcoach.ui.localization.exerciseDisplayName

data class CoachUiState(
    val loading: Boolean = true,
    val overview: CoachOverviewDto? = null,
    val activeDebriefId: String? = null,
    val note: String = "",
    val savedNote: String = "",
    val generating: Boolean = false,
    val savingNote: Boolean = false,
    val applying: Boolean = false,
    val selectedAdjustments: Set<Int> = emptySet(),
    val error: String? = null,
    val feedback: String? = null,
)

@Composable
fun CoachScreen(
    onBack: () -> Unit,
    onOpenChat: () -> Unit,
    repository: CoachRepository = CoachRepository.create(LocalContext.current),
) {
    val context = LocalContext.current
    var state by remember { mutableStateOf(CoachUiState()) }
    var confirmApply by remember { mutableStateOf(false) }
    val noteSaved = stringResource(R.string.coach_native_note_saved)
    val noteCleared = stringResource(R.string.coach_native_note_cleared)
    val appliedTemplate = stringResource(R.string.coach_native_apply_result)

    suspend fun refresh(preferredDebriefId: String? = state.activeDebriefId) {
        state = state.copy(loading = state.overview == null, error = null)
        runCatching { repository.loadOverview() }
            .onSuccess { overview ->
                val activeId = preferredDebriefId
                    ?.takeIf { id -> overview.history.any { it.id == id } }
                    ?: overview.history.firstOrNull()?.id
                state = state.copy(
                    loading = false,
                    overview = overview,
                    activeDebriefId = activeId,
                    note = overview.coachNote.orEmpty(),
                    savedNote = overview.coachNote.orEmpty(),
                    selectedAdjustments = defaultSelection(overview, activeId),
                    error = null,
                )
            }
            .onFailure { error ->
                state = state.copy(
                    loading = false,
                    error = context.friendlyErrorMessage(
                        error,
                        AppErrorContext(
                            operation = AppErrorOperation.LOAD,
                            dataState = AppErrorDataState.SAVED_LOCALLY,
                        ),
                    ),
                )
            }
    }

    CoachScreenContent(
        state = state,
        onBack = onBack,
        onOpenChat = onOpenChat,
        onRetry = { state = state.copy(loading = true) },
        onNoteChange = { state = state.copy(note = it, feedback = null) },
        onSaveNote = {
            if (!state.savingNote && state.note.length <= COACH_NOTE_LIMIT) {
                state = state.copy(savingNote = true, error = null, feedback = null)
            }
        },
        onClearNote = {
            if (!state.savingNote) state = state.copy(note = "", savingNote = true, error = null)
        },
        onRequestDebrief = {
            if (!state.generating) state = state.copy(generating = true, error = null, feedback = null)
        },
        onSelectDebrief = { id ->
            state = state.copy(
                activeDebriefId = id,
                selectedAdjustments = defaultSelection(state.overview, id),
                feedback = null,
            )
        },
        onToggleAdjustment = { index, selected ->
            state = state.copy(
                selectedAdjustments = if (selected) {
                    state.selectedAdjustments + index
                } else {
                    state.selectedAdjustments - index
                },
            )
        },
        onApplySelected = { confirmApply = true },
    )

    LaunchedEffect(state.loading) { if (state.loading) refresh() }
    LaunchedEffect(state.savingNote) {
        if (!state.savingNote) return@LaunchedEffect
        val trimmed = state.note.trim().takeIf { it.isNotEmpty() }
        runCatching { repository.saveNote(trimmed) }
            .onSuccess {
                state = state.copy(
                    savingNote = false,
                    note = trimmed.orEmpty(),
                    savedNote = trimmed.orEmpty(),
                    feedback = if (trimmed == null) noteCleared else noteSaved,
                )
            }
            .onFailure {
                state = state.copy(
                    savingNote = false,
                    error = context.friendlyErrorMessage(
                        it,
                        AppErrorContext(
                            operation = AppErrorOperation.SAVE,
                            dataState = AppErrorDataState.NOT_SAVED,
                        ),
                    ),
                )
            }
    }
    LaunchedEffect(state.generating) {
        if (!state.generating) return@LaunchedEffect
        runCatching { repository.requestDebrief() }
            .onSuccess { generated ->
                state = state.copy(generating = false)
                refresh(generated.id)
            }
            .onFailure {
                state = state.copy(
                    generating = false,
                    error = context.friendlyErrorMessage(
                        it,
                        AppErrorContext(
                            operation = AppErrorOperation.SAVE,
                            dataState = AppErrorDataState.NOT_SAVED,
                        ),
                    ),
                )
            }
    }

    if (confirmApply) {
        val selected = selectedAdjustments(state)
        CoachApplyConfirmationDialog(
            selectedCount = selected.size,
            applying = state.applying,
            onConfirm = { state = state.copy(applying = true, error = null) },
            onDismiss = { confirmApply = false },
        )
    }

    LaunchedEffect(state.applying) {
        if (!state.applying) return@LaunchedEffect
        val activeId = state.activeDebriefId
        val adjustments = selectedAdjustments(state)
        if (activeId == null || adjustments.isEmpty()) {
            state = state.copy(applying = false)
            confirmApply = false
            return@LaunchedEffect
        }
        runCatching { repository.applyAdjustments(activeId, adjustments) }
            .onSuccess { result ->
                confirmApply = false
                state = state.copy(
                    applying = false,
                    feedback = appliedTemplate.format(result.applied.size, result.skipped.size),
                )
                refresh(activeId)
            }
            .onFailure {
                confirmApply = false
                state = state.copy(
                    applying = false,
                    error = context.friendlyErrorMessage(
                        it,
                        AppErrorContext(
                            operation = AppErrorOperation.SAVE,
                            dataState = AppErrorDataState.UNKNOWN,
                        ),
                    ),
                )
            }
    }
}

@Composable
fun CoachApplyConfirmationDialog(
    selectedCount: Int,
    applying: Boolean,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = { if (!applying) onDismiss() },
        title = { Text(stringResource(R.string.coach_native_apply_confirm_title)) },
        text = { Text(stringResource(R.string.coach_native_apply_confirm_body, selectedCount)) },
        confirmButton = {
            TextButton(
                enabled = !applying && selectedCount > 0,
                onClick = onConfirm,
                modifier = Modifier.testTag("coach-confirm-apply"),
            ) {
                if (applying) CircularProgressIndicator(Modifier.height(18.dp))
                else Text(stringResource(R.string.coach_native_apply))
            }
        },
        dismissButton = {
            TextButton(enabled = !applying, onClick = onDismiss) {
                Text(stringResource(R.string.cancel))
            }
        },
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CoachScreenContent(
    state: CoachUiState,
    onBack: () -> Unit,
    onOpenChat: () -> Unit,
    onRetry: () -> Unit,
    onNoteChange: (String) -> Unit,
    onSaveNote: () -> Unit,
    onClearNote: () -> Unit,
    onRequestDebrief: () -> Unit,
    onSelectDebrief: (String) -> Unit,
    onToggleAdjustment: (Int, Boolean) -> Unit,
    onApplySelected: () -> Unit,
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.coach_native_title)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.back_to_workout))
                    }
                },
                actions = {
                    IconButton(onClick = onOpenChat) {
                        Icon(Icons.AutoMirrored.Filled.Chat, contentDescription = stringResource(R.string.coach_native_open_chat))
                    }
                },
            )
        },
    ) { padding ->
        when {
            state.loading -> Column(
                Modifier.fillMaxSize().padding(padding),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) { CircularProgressIndicator() }
            state.overview == null -> ErrorPanel(state.error, onRetry, Modifier.padding(padding))
            else -> CoachBody(
                state = state,
                onOpenChat = onOpenChat,
                onNoteChange = onNoteChange,
                onSaveNote = onSaveNote,
                onClearNote = onClearNote,
                onRequestDebrief = onRequestDebrief,
                onSelectDebrief = onSelectDebrief,
                onToggleAdjustment = onToggleAdjustment,
                onApplySelected = onApplySelected,
                modifier = Modifier.padding(padding),
            )
        }
    }
}

@Composable
private fun CoachBody(
    state: CoachUiState,
    onOpenChat: () -> Unit,
    onNoteChange: (String) -> Unit,
    onSaveNote: () -> Unit,
    onClearNote: () -> Unit,
    onRequestDebrief: () -> Unit,
    onSelectDebrief: (String) -> Unit,
    onToggleAdjustment: (Int, Boolean) -> Unit,
    onApplySelected: () -> Unit,
    modifier: Modifier,
) {
    val overview = requireNotNull(state.overview)
    val active = overview.history.firstOrNull { it.id == state.activeDebriefId }
        ?: overview.history.firstOrNull()
    val parsed = active?.let { parseCoachResponse(it.response) }
    val adjustments = parsed?.adjustments.orEmpty().map { adjustment ->
        adjustment.withDefaults(overview.programDefaults[adjustment.exerciseName])
    }
    LazyColumn(
        modifier = modifier.fillMaxSize().testTag("coach-screen"),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item { CoachContextCard(overview.context) }
        item {
            CoachNoteCard(
                note = state.note,
                savedNote = state.savedNote,
                busy = state.savingNote,
                onChange = onNoteChange,
                onSave = onSaveNote,
                onClear = onClearNote,
            )
        }
        if (!overview.provider.configured) {
            item {
                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer)) {
                    Text(
                        stringResource(
                            R.string.coach_native_provider_missing,
                            overview.provider.label,
                            overview.provider.apiKeyEnvVar,
                        ),
                        Modifier.padding(16.dp),
                        color = MaterialTheme.colorScheme.onErrorContainer,
                    )
                }
            }
        }
        item {
            Card {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Button(
                        onClick = onRequestDebrief,
                        enabled = overview.provider.configured && !state.generating,
                        modifier = Modifier.fillMaxWidth().testTag("coach-request-debrief"),
                    ) {
                        if (state.generating) CircularProgressIndicator(Modifier.height(18.dp))
                        else Icon(Icons.Default.Refresh, contentDescription = null)
                        Spacer(Modifier.padding(4.dp))
                        Text(
                            if (state.generating) stringResource(R.string.coach_native_generating)
                            else stringResource(R.string.coach_native_request_debrief),
                        )
                    }
                    OutlinedButton(onClick = onOpenChat, modifier = Modifier.fillMaxWidth()) {
                        Icon(Icons.AutoMirrored.Filled.Chat, contentDescription = null)
                        Spacer(Modifier.padding(4.dp))
                        Text(stringResource(R.string.coach_native_open_chat))
                    }
                }
            }
        }
        state.error?.let { message -> item { StatusCard(message, error = true) } }
        state.feedback?.takeIf { it.isNotBlank() }?.let { message ->
            item { StatusCard(message, error = false) }
        }
        if (active == null) {
            item {
                Card {
                    Text(
                        stringResource(R.string.coach_native_no_debriefs),
                        Modifier.padding(24.dp),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        } else {
            item { DebriefCard(active, parsed?.markdown.orEmpty(), parsed?.parseError) }
            if (adjustments.isNotEmpty()) {
                item {
                    AdjustmentsCard(
                        adjustments = adjustments,
                        selected = state.selectedAdjustments,
                        alreadyApplied = active.appliedAt != null,
                        applying = state.applying,
                        onToggle = onToggleAdjustment,
                        onApply = onApplySelected,
                    )
                }
            }
        }
        if (overview.history.size > 1) {
            item {
                Text(
                    stringResource(R.string.coach_native_history),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
            }
            items(overview.history, key = { it.id }) { debrief ->
                HistoryRow(
                    debrief = debrief,
                    selected = debrief.id == active?.id,
                    onClick = { onSelectDebrief(debrief.id) },
                )
            }
        }
    }
}

@Composable
private fun CoachContextCard(context: CoachContextDto) {
    var expanded by rememberSaveable { mutableStateOf(false) }
    val noDeload = stringResource(R.string.coach_native_no_deload)
    val deloadActive = stringResource(R.string.coach_native_deload_active)
    val deloadRecommended = stringResource(R.string.coach_native_deload_recommended)
    val stalled = stringResource(
        R.string.coach_native_stalled,
        context.stalledExercises.joinToString(", "),
    )
    Card(Modifier.fillMaxWidth().testTag("coach-context")) {
        Column {
            Row(
                Modifier.fillMaxWidth().clickable { expanded = !expanded }.padding(16.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Icon(Icons.Default.Visibility, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                Column(Modifier.weight(1f)) {
                    Text(stringResource(R.string.coach_native_context_title), fontWeight = FontWeight.SemiBold)
                    Text(
                        stringResource(
                            R.string.coach_native_context_teaser,
                            context.weeksOfHistory,
                            context.exercisesTracked,
                        ),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Icon(
                    if (expanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                    contentDescription = null,
                )
            }
            if (expanded) {
                HorizontalDivider()
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    ContextLine(
                        stringResource(R.string.coach_native_context_goals),
                        if (context.goals.isEmpty()) stringResource(R.string.coach_native_context_no_goals)
                        else context.goals.joinToString("\n") {
                            "${it.exerciseName}: ${formatNumber(it.targetWeight)} kg × ${it.targetReps} (${formatNumber(it.progressPct)}%)"
                        },
                    )
                    ContextLine(
                        stringResource(R.string.coach_native_context_recovery),
                        buildString {
                            if (context.deloadActive) append(deloadActive)
                            else if (context.deloadRecommended) append(
                                context.deloadReasons.joinToString("; ").ifBlank {
                                    deloadRecommended
                                },
                            ) else append(noDeload)
                            if (context.stalledExercises.isNotEmpty()) {
                                append("\n")
                                append(stalled)
                            }
                        },
                    )
                    ContextLine(
                        stringResource(R.string.coach_native_context_conditioning),
                        stringResource(
                            R.string.coach_native_conditioning_value,
                            context.conditioning.currentMinutes,
                            formatNumber(context.conditioning.currentKm),
                            context.conditioning.currentSessions,
                            context.conditioning.weeklyTargetMin,
                        ),
                    )
                    ContextLine(
                        stringResource(R.string.coach_native_context_readiness),
                        context.readiness?.let {
                            stringResource(
                                R.string.coach_native_readiness_value,
                                it.readiness,
                                it.sleepQuality,
                                it.daysAgo,
                            )
                        } ?: stringResource(R.string.coach_native_no_readiness),
                    )
                    Text(
                        stringResource(R.string.coach_native_context_privacy),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

@Composable
private fun ContextLine(title: String, value: String) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(title, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
        Text(value, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun CoachNoteCard(
    note: String,
    savedNote: String,
    busy: Boolean,
    onChange: (String) -> Unit,
    onSave: () -> Unit,
    onClear: () -> Unit,
) {
    Card {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(stringResource(R.string.coach_native_note_title), fontWeight = FontWeight.SemiBold)
            Text(
                stringResource(R.string.coach_native_note_description),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            OutlinedTextField(
                value = note,
                onValueChange = { if (it.length <= COACH_NOTE_LIMIT) onChange(it) },
                modifier = Modifier.fillMaxWidth().testTag("coach-note"),
                minLines = 3,
                placeholder = { Text(stringResource(R.string.coach_native_note_placeholder)) },
                supportingText = { Text("${note.length}/$COACH_NOTE_LIMIT") },
            )
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                TextButton(onClick = onClear, enabled = !busy && (note.isNotBlank() || savedNote.isNotBlank())) {
                    Text(stringResource(R.string.coach_native_clear))
                }
                Button(onClick = onSave, enabled = !busy && note.trim() != savedNote.trim()) {
                    if (busy) CircularProgressIndicator(Modifier.height(18.dp))
                    else Text(stringResource(R.string.save))
                }
            }
        }
    }
}

@Composable
private fun DebriefCard(debrief: CoachDebriefDto, markdown: String, parseError: String?) {
    Card(Modifier.fillMaxWidth().testTag("coach-active-debrief")) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(
                        stringResource(R.string.coach_native_debrief_from, formatCoachDate(debrief.createdAt)),
                        fontWeight = FontWeight.SemiBold,
                    )
                    Text(
                        stringResource(R.string.coach_native_week_of, formatCoachDate(debrief.weekStart)),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (debrief.appliedAt != null) {
                    AssistChip(
                        onClick = {},
                        label = { Text(stringResource(R.string.coach_native_applied)) },
                        leadingIcon = { Icon(Icons.Default.CheckCircle, contentDescription = null) },
                    )
                }
            }
            HorizontalDivider()
            MarkdownContent(markdown)
            if (parseError != null) {
                Text(
                    stringResource(R.string.coach_native_adjustments_ignored),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
            }
        }
    }
}

@Composable
private fun AdjustmentsCard(
    adjustments: List<CoachAdjustment>,
    selected: Set<Int>,
    alreadyApplied: Boolean,
    applying: Boolean,
    onToggle: (Int, Boolean) -> Unit,
    onApply: () -> Unit,
) {
    Card(Modifier.fillMaxWidth().testTag("coach-adjustments")) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(stringResource(R.string.coach_native_adjustments_title), fontWeight = FontWeight.SemiBold)
            Text(
                stringResource(R.string.coach_native_adjustments_description),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            adjustments.forEachIndexed { index, adjustment ->
                Card(
                    colors = CardDefaults.cardColors(
                        containerColor = if (index in selected && !alreadyApplied) {
                            MaterialTheme.colorScheme.primaryContainer
                        } else MaterialTheme.colorScheme.surfaceVariant
                    ),
                    shape = RoundedCornerShape(10.dp),
                ) {
                    Row(Modifier.padding(12.dp), verticalAlignment = Alignment.Top) {
                        Checkbox(
                            checked = index in selected && !alreadyApplied,
                            onCheckedChange = { onToggle(index, it) },
                            enabled = !alreadyApplied && !applying,
                        )
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(
                                exerciseDisplayName(adjustment.exerciseName),
                                fontWeight = FontWeight.SemiBold,
                            )
                            Text(adjustment.summary, style = MaterialTheme.typography.bodyMedium)
                            adjustment.rationale?.takeIf { it.isNotBlank() }?.let {
                                Text(it, style = MaterialTheme.typography.bodySmall)
                            }
                            Text(
                                adjustmentValues(adjustment),
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.primary,
                            )
                        }
                    }
                }
            }
            Button(
                onClick = onApply,
                enabled = !alreadyApplied && !applying && selected.isNotEmpty(),
                modifier = Modifier.fillMaxWidth().testTag("coach-apply-selected"),
            ) {
                Text(
                    if (alreadyApplied) stringResource(R.string.coach_native_applied)
                    else stringResource(R.string.coach_native_apply_selected, selected.size),
                )
            }
        }
    }
}

@Composable
private fun HistoryRow(debrief: CoachDebriefDto, selected: Boolean, onClick: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        colors = CardDefaults.cardColors(
            containerColor = if (selected) MaterialTheme.colorScheme.primaryContainer
            else MaterialTheme.colorScheme.surface,
        ),
    ) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(formatCoachDate(debrief.createdAt), fontWeight = FontWeight.Medium)
                Text(
                    firstCoachLine(debrief.response),
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (debrief.appliedAt != null) Icon(Icons.Default.CheckCircle, contentDescription = null)
        }
    }
}

@Composable
private fun StatusCard(message: String, error: Boolean) {
    Card(
        colors = CardDefaults.cardColors(
            containerColor = if (error) MaterialTheme.colorScheme.errorContainer
            else MaterialTheme.colorScheme.secondaryContainer,
        ),
    ) {
        Text(message, Modifier.padding(14.dp))
    }
}

@Composable
private fun ErrorPanel(error: String?, onRetry: () -> Unit, modifier: Modifier = Modifier) {
    Column(
        modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(error ?: stringResource(R.string.coach_native_error_unknown))
        Spacer(Modifier.height(12.dp))
        Button(onClick = onRetry) { Text(stringResource(R.string.retry)) }
    }
}

private fun defaultSelection(overview: CoachOverviewDto?, activeId: String?): Set<Int> {
    val active = overview?.history?.firstOrNull { it.id == activeId } ?: return emptySet()
    if (active.appliedAt != null) return emptySet()
    return parseCoachResponse(active.response).adjustments.indices.toSet()
}

private fun selectedAdjustments(state: CoachUiState): List<CoachAdjustment> {
    val overview = state.overview ?: return emptyList()
    val active = overview.history.firstOrNull { it.id == state.activeDebriefId } ?: return emptyList()
    return parseCoachResponse(active.response).adjustments.map { adjustment ->
        adjustment.withDefaults(overview.programDefaults[adjustment.exerciseName])
    }.filterIndexed { index, _ -> index in state.selectedAdjustments }
}

@Composable
private fun adjustmentValues(adjustment: CoachAdjustment): String {
    val values = buildList {
    if (adjustment.suggestedSets != null) add(
        stringResource(R.string.coach_native_value_sets, adjustment.suggestedSets),
    )
    if (adjustment.suggestedRepsMin != null || adjustment.suggestedRepsMax != null) {
        add(
            stringResource(
                R.string.coach_native_value_reps,
                adjustment.suggestedRepsMin?.toString() ?: "?",
                adjustment.suggestedRepsMax?.toString() ?: "?",
            ),
        )
    }
    if (adjustment.suggestedRIR != null) add("RIR ${adjustment.suggestedRIR}")
    if (adjustment.suggestedRestSec != null) add(
        stringResource(R.string.seconds_value, adjustment.suggestedRestSec),
    )
    if (adjustment.suggestedLoad != null) add("${formatNumber(adjustment.suggestedLoad)} kg")
    }
    return values.joinToString(" · ")
}

private fun formatCoachDate(value: String): String = runCatching {
    DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM)
        .format(Instant.parse(value).atZone(ZoneId.systemDefault()))
}.getOrDefault(value.take(10))

private fun formatNumber(value: Double): String = if (value % 1.0 == 0.0) {
    value.toInt().toString()
} else String.format(java.util.Locale.getDefault(), "%.1f", value)

private const val COACH_NOTE_LIMIT = 500
