package org.sharteman.gymcoach.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.FilterList
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import kotlinx.coroutines.CancellationException
import org.sharteman.gymcoach.data.local.LocalSetEntity
import org.sharteman.gymcoach.data.errors.AppErrorContext
import org.sharteman.gymcoach.data.errors.AppErrorDataState
import org.sharteman.gymcoach.data.errors.AppErrorOperation
import org.sharteman.gymcoach.data.model.BootstrapResponse
import org.sharteman.gymcoach.data.model.ExerciseDto
import org.sharteman.gymcoach.data.model.HistoricalSetAddRequest
import org.sharteman.gymcoach.data.model.HistoricalSetUpdateRequest
import org.sharteman.gymcoach.R
import org.sharteman.gymcoach.data.model.MobileHistoryCardioDto
import org.sharteman.gymcoach.data.model.MobileHistoryExerciseDto
import org.sharteman.gymcoach.data.model.MobileHistorySessionDto
import org.sharteman.gymcoach.data.model.MobileHistorySnapshot
import org.sharteman.gymcoach.data.model.ProgramExerciseDto
import org.sharteman.gymcoach.data.repository.HistoryProgressRepository
import org.sharteman.gymcoach.data.repository.HistoryProgressDataSource
import org.sharteman.gymcoach.data.repository.HistoryOfflineCacheMissException
import org.sharteman.gymcoach.training.roundWeight
import org.sharteman.gymcoach.training.LoadConstraints
import org.sharteman.gymcoach.training.SetTableMetric
import org.sharteman.gymcoach.training.fromDisplayWeight
import org.sharteman.gymcoach.training.resolveExerciseInventory
import org.sharteman.gymcoach.training.selectedEquipment
import org.sharteman.gymcoach.ui.localization.exerciseDisplayName
import org.sharteman.gymcoach.training.toDisplayWeight
import java.time.Instant
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale
import java.util.UUID

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HistoryScreen(
    onBack: () -> Unit,
    initialSessionId: String? = null,
    initialMonthKey: String? = null,
    dataSource: HistoryProgressDataSource? = null,
    bootstrap: BootstrapResponse? = null,
) {
    val context = LocalContext.current
    val defaultRepository = remember(context) { HistoryProgressRepository(context) }
    val repository = dataSource ?: defaultRepository
    val scope = rememberCoroutineScope()
    var monthKey by rememberSaveable(initialMonthKey) {
        mutableStateOf(initialMonthKey ?: YearMonth.now().toString())
    }
    var programId by rememberSaveable { mutableStateOf<String?>(null) }
    var selectedDay by rememberSaveable { mutableStateOf("") }
    var selectedSessionId by rememberSaveable(initialSessionId) { mutableStateOf(initialSessionId) }
    var snapshot by remember { mutableStateOf<MobileHistorySnapshot?>(null) }
    var loading by remember { mutableStateOf(false) }
    var showingCache by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var refreshNonce by remember { mutableStateOf(0) }
    var programDialogOpen by rememberSaveable { mutableStateOf(false) }
    val snackbar = remember { SnackbarHostState() }
    val mutationError = stringResource(R.string.history_edit_error)

    suspend fun refreshAfterMutation(): Boolean = try {
        snapshot = repository.refreshHistory(monthKey, programId)
        showingCache = false
        true
    } catch (error: CancellationException) {
        throw error
    } catch (_: Exception) {
        snackbar.showSnackbar(mutationError)
        false
    }

    LaunchedEffect(monthKey, programId, refreshNonce) {
        val cached = repository.cachedHistory(monthKey, programId)
        if (cached != null) {
            snapshot = cached
            showingCache = true
        }
        loading = true
        error = null
        runCatching { repository.refreshHistory(monthKey, programId) }
            .onSuccess {
                snapshot = it
                showingCache = false
            }
            .onFailure { throwable ->
                error = if (
                    cached == null &&
                    throwable is HistoryOfflineCacheMissException
                ) {
                    context.getString(R.string.history_offline_unavailable)
                } else {
                    context.friendlyErrorMessage(
                        throwable,
                        AppErrorContext(
                            operation = AppErrorOperation.LOAD,
                            dataState = if (cached == null) {
                                AppErrorDataState.UNKNOWN
                            } else {
                                AppErrorDataState.SAVED_LOCALLY
                            },
                        ),
                    )
                }
            }
        loading = false
    }

    val sessionsByDay = remember(snapshot?.sessions, monthKey) {
        nativeHistorySessionsByDay(snapshot?.sessions.orEmpty(), monthKey)
    }
    LaunchedEffect(monthKey, sessionsByDay.keys) {
        if (!selectedDay.startsWith(monthKey)) {
            selectedDay = defaultNativeHistoryDay(monthKey, sessionsByDay)
        } else if (selectedDay.isBlank()) {
            selectedDay = defaultNativeHistoryDay(monthKey, sessionsByDay)
        }
    }
    val selectedSession = snapshot?.sessions?.firstOrNull { it.id == selectedSessionId }
    LaunchedEffect(selectedSession?.startedAt) {
        selectedSession?.startedAt?.take(10)?.let { selectedDay = it }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        if (selectedSession == null) stringResource(R.string.history_native_title)
                        else selectedSession.workoutName ?: stringResource(R.string.history_free_session),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                },
                navigationIcon = {
                    IconButton(onClick = {
                        if (selectedSessionId != null) selectedSessionId = null else onBack()
                    }) {
                        Icon(
                            Icons.AutoMirrored.Outlined.ArrowBack,
                            contentDescription = stringResource(R.string.previous),
                        )
                    }
                },
                actions = {
                    if (selectedSession == null) {
                        IconButton(onClick = { refreshNonce++ }, enabled = !loading) {
                            Icon(
                                Icons.Outlined.Refresh,
                                contentDescription = stringResource(R.string.sync_now),
                            )
                        }
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        if (selectedSession != null) {
            HistorySessionDetail(
                session = selectedSession,
                unit = snapshot?.unit ?: "KG",
                bootstrap = bootstrap,
                modifier = Modifier.padding(padding),
                onUpdateSet = { set, weight, reps, rir, replacementEquipmentId ->
                    try {
                        repository.updateHistoricalSet(
                            set.id,
                            HistoricalSetUpdateRequest(
                                weight = weight,
                                reps = reps,
                                rir = rir,
                                gymEquipmentId = replacementEquipmentId,
                                equipmentSnapshotAction = replacementEquipmentId?.let { "REPLACE" },
                            ),
                        )
                        refreshAfterMutation()
                    } catch (error: CancellationException) {
                        throw error
                    } catch (_: Exception) {
                        snackbar.showSnackbar(mutationError)
                        false
                    }
                },
                onAddSet = { request ->
                    try {
                        repository.addHistoricalSet(selectedSession.id, request)
                        refreshAfterMutation()
                    } catch (error: CancellationException) {
                        throw error
                    } catch (_: Exception) {
                        snackbar.showSnackbar(mutationError)
                        false
                    }
                },
                onDeleteSet = { set ->
                    try {
                        repository.deleteHistoricalSet(set.id)
                        refreshAfterMutation()
                    } catch (error: CancellationException) {
                        throw error
                    } catch (_: Exception) {
                        snackbar.showSnackbar(mutationError)
                        false
                    }
                },
                onDelete = {
                    scope.launch {
                        loading = true
                        runCatching { repository.deleteHistorySession(selectedSession.id) }
                            .onSuccess {
                                selectedSessionId = null
                                refreshNonce++
                            }
                            .onFailure {
                                error = context.friendlyErrorMessage(
                                    it,
                                    AppErrorContext(
                                        operation = AppErrorOperation.DELETE,
                                        dataState = AppErrorDataState.UNKNOWN,
                                    ),
                                )
                            }
                        loading = false
                    }
                },
            )
        } else {
            HistoryCalendarContent(
                snapshot = snapshot,
                monthKey = monthKey,
                selectedDay = selectedDay,
                sessionsByDay = sessionsByDay,
                programId = programId,
                loading = loading,
                showingCache = showingCache,
                error = error,
                modifier = Modifier.padding(padding),
                onPreviousMonth = {
                    monthKey = YearMonth.parse(monthKey).minusMonths(1).toString()
                    selectedDay = ""
                },
                onNextMonth = {
                    monthKey = YearMonth.parse(monthKey).plusMonths(1).toString()
                    selectedDay = ""
                },
                onToday = {
                    monthKey = YearMonth.now().toString()
                    selectedDay = LocalDate.now().toString()
                },
                onSelectDay = { selectedDay = it },
                onOpenProgramFilter = { programDialogOpen = true },
                onOpenSession = { selectedSessionId = it },
            )
        }
    }

    if (programDialogOpen) {
        AlertDialog(
            onDismissRequest = { programDialogOpen = false },
            title = { Text(stringResource(R.string.history_filter_program)) },
            text = {
                LazyColumn(modifier = Modifier.fillMaxWidth().height(380.dp)) {
                    item {
                        TextButton(
                            onClick = {
                                programId = null
                                selectedDay = ""
                                programDialogOpen = false
                            },
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text(stringResource(R.string.history_all_programs)) }
                    }
                    items(snapshot?.programs.orEmpty(), key = { it.id }) { program ->
                        TextButton(
                            onClick = {
                                programId = program.id
                                selectedDay = ""
                                programDialogOpen = false
                            },
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text(program.name) }
                    }
                }
            },
            confirmButton = {},
            dismissButton = {
                TextButton(onClick = { programDialogOpen = false }) {
                    Text(stringResource(R.string.cancel))
                }
            },
        )
    }
}

@Composable
private fun HistoryCalendarContent(
    snapshot: MobileHistorySnapshot?,
    monthKey: String,
    selectedDay: String,
    sessionsByDay: Map<String, List<MobileHistorySessionDto>>,
    programId: String?,
    loading: Boolean,
    showingCache: Boolean,
    error: String?,
    modifier: Modifier,
    onPreviousMonth: () -> Unit,
    onNextMonth: () -> Unit,
    onToday: () -> Unit,
    onSelectDay: (String) -> Unit,
    onOpenProgramFilter: () -> Unit,
    onOpenSession: (String) -> Unit,
) {
    val month = YearMonth.parse(monthKey)
    val locale = Locale.getDefault()
    val grid = remember(monthKey, locale) { buildNativeHistoryMonthGrid(monthKey, locale) }
    val weekdayNames = remember(grid, locale) {
        grid.take(7).map { it.date.dayOfWeek.getDisplayName(TextStyle.SHORT, locale) }
    }
    val selectedSessions = sessionsByDay[selectedDay].orEmpty()
    val selectedProgramName = snapshot?.programs?.firstOrNull { it.id == programId }?.name

    LazyColumn(
        modifier = modifier.fillMaxSize().testTag("history-native-list"),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (loading) item { LinearProgressIndicator(modifier = Modifier.fillMaxWidth()) }
        if (showingCache) item { StatusCard(stringResource(R.string.history_offline_cache)) }
        error?.let { item { StatusCard(it, error = true) } }
        item {
            OutlinedButton(
                onClick = onOpenProgramFilter,
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(8.dp),
            ) {
                Icon(Icons.Outlined.FilterList, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text(selectedProgramName ?: stringResource(R.string.history_all_programs))
            }
        }
        item {
            Card(
                shape = RoundedCornerShape(10.dp),
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.45f)),
            ) {
                Column(modifier = Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        IconButton(onClick = onPreviousMonth) {
                            Icon(
                                Icons.AutoMirrored.Outlined.KeyboardArrowLeft,
                                contentDescription = stringResource(R.string.history_previous_month),
                            )
                        }
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(
                                month.atDay(1).format(DateTimeFormatter.ofPattern("LLLL yyyy", locale)),
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.SemiBold,
                            )
                            TextButton(onClick = onToday) { Text(stringResource(R.string.history_today)) }
                        }
                        IconButton(onClick = onNextMonth) {
                            Icon(
                                Icons.AutoMirrored.Outlined.KeyboardArrowRight,
                                contentDescription = stringResource(R.string.history_next_month),
                            )
                        }
                    }
                    Row(modifier = Modifier.fillMaxWidth()) {
                        weekdayNames.forEach { name ->
                            Text(
                                name,
                                modifier = Modifier.weight(1f),
                                textAlign = TextAlign.Center,
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    grid.chunked(7).forEach { week ->
                        Row(modifier = Modifier.fillMaxWidth()) {
                            week.forEach { day ->
                                val dateKey = day.date.toString()
                                val count = sessionsByDay[dateKey]?.size ?: 0
                                val selected = dateKey == selectedDay
                                Box(
                                    modifier = Modifier
                                        .weight(1f)
                                        .height(52.dp)
                                        .padding(2.dp)
                                        .background(
                                            when {
                                                selected -> MaterialTheme.colorScheme.primaryContainer
                                                day.inMonth -> MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f)
                                                else -> Color.Transparent
                                            },
                                            RoundedCornerShape(7.dp),
                                        )
                                        .clickable(enabled = day.inMonth) { onSelectDay(dateKey) },
                                    contentAlignment = Alignment.Center,
                                ) {
                                    if (day.inMonth) {
                                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                            Text(day.date.dayOfMonth.toString(), style = MaterialTheme.typography.bodySmall)
                                            if (count > 0) {
                                                Text(
                                                    count.toString(),
                                                    color = MaterialTheme.colorScheme.primary,
                                                    style = MaterialTheme.typography.labelSmall,
                                                    fontWeight = FontWeight.Bold,
                                                )
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        item {
            Text(
                formatHistoryDayTitle(selectedDay),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
        }
        if (!snapshot?.hasAnyHistory.orFalse()) {
            item { StatusCard(stringResource(R.string.history_empty)) }
        } else if (selectedSessions.isEmpty()) {
            item { StatusCard(stringResource(R.string.history_no_sessions_day)) }
        } else {
            items(selectedSessions, key = { it.id }) { session ->
                HistorySessionCard(session, snapshot?.unit ?: "KG", onOpenSession)
            }
        }
    }
}

@Composable
private fun HistorySessionCard(
    session: MobileHistorySessionDto,
    unit: String,
    onOpenSession: (String) -> Unit,
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .testTag("history-session-${session.id}")
            .clickable { onOpenSession(session.id) },
        shape = RoundedCornerShape(9.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.4f)),
    ) {
        Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Text(
                session.workoutName
                    ?: session.exercises.firstOrNull { it.category == "CARDIO" }?.name?.let(::exerciseDisplayName)
                    ?: stringResource(R.string.history_free_session),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                formatHistoryTime(session.startedAt),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall,
            )
            session.programName?.let { Text(it, style = MaterialTheme.typography.labelMedium) }
            if (session.cardio != null) {
                Text(formatCardioSummary(session.cardio), style = MaterialTheme.typography.bodySmall)
            } else {
                Text(
                    stringResource(
                        R.string.history_session_summary,
                        session.workingSets,
                        formatHistoryWeight(session.volume, unit),
                        session.durationMin,
                    ),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun HistorySessionDetail(
    session: MobileHistorySessionDto,
    unit: String,
    bootstrap: BootstrapResponse?,
    modifier: Modifier,
    onDelete: () -> Unit,
    onUpdateSet: suspend (LocalSetEntity, Double, Int, Int?, String?) -> Boolean,
    onAddSet: suspend (HistoricalSetAddRequest) -> Boolean,
    onDeleteSet: suspend (LocalSetEntity) -> Boolean,
) {
    var deleteDialog by rememberSaveable { mutableStateOf(false) }
    LazyColumn(
        modifier = modifier.fillMaxSize().testTag("history-session-detail"),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Card {
                Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                    session.programName?.let { Text(it, color = MaterialTheme.colorScheme.primary) }
                    Text(formatHistoryDateTime(session.startedAt), fontWeight = FontWeight.SemiBold)
                    HistoryDetailSummaryRow(stringResource(R.string.history_sets), session.workingSets.toString())
                    HistoryDetailSummaryRow(stringResource(R.string.history_exercises), session.exercises.size.toString())
                    HistoryDetailSummaryRow(
                        stringResource(R.string.history_total_volume),
                        formatHistoryWeight(session.volume, unit),
                    )
                    HistoryDetailSummaryRow(
                        stringResource(R.string.history_duration),
                        stringResource(R.string.history_minutes_value, session.durationMin),
                    )
                    session.sessionRpe?.let {
                        HistoryDetailSummaryRow(stringResource(R.string.history_session_rpe), "$it/10")
                    }
                }
            }
        }
        session.notes?.takeIf { it.isNotBlank() }?.let { notes ->
            item {
                Card {
                    Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(stringResource(R.string.history_notes), fontWeight = FontWeight.SemiBold)
                        Text(notes)
                    }
                }
            }
        }
        items(session.exercises, key = { it.id }) { exercise ->
            HistoryExerciseCard(
                session = session,
                exercise = exercise,
                unit = unit,
                bootstrap = bootstrap,
                onUpdateSet = onUpdateSet,
                onAddSet = onAddSet,
                onDeleteSet = onDeleteSet,
            )
        }
        item {
            OutlinedButton(
                onClick = { deleteDialog = true },
                modifier = Modifier.fillMaxWidth().testTag("history-delete-session"),
            ) {
                Icon(Icons.Outlined.Delete, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text(stringResource(R.string.history_delete_button))
            }
        }
    }

    if (deleteDialog) {
        AlertDialog(
            onDismissRequest = { deleteDialog = false },
            title = { Text(stringResource(R.string.history_delete_title)) },
            text = { Text(stringResource(R.string.history_delete_description)) },
            confirmButton = {
                TextButton(
                    onClick = {
                        deleteDialog = false
                        onDelete()
                    },
                    modifier = Modifier.testTag("history-delete-confirm"),
                ) { Text(stringResource(R.string.history_delete_confirm)) }
            },
            dismissButton = {
                TextButton(onClick = { deleteDialog = false }) { Text(stringResource(R.string.cancel)) }
            },
        )
    }
}

@Composable
private fun HistoryExerciseCard(
    session: MobileHistorySessionDto,
    exercise: MobileHistoryExerciseDto,
    unit: String,
    bootstrap: BootstrapResponse?,
    onUpdateSet: suspend (LocalSetEntity, Double, Int, Int?, String?) -> Boolean,
    onAddSet: suspend (HistoricalSetAddRequest) -> Boolean,
    onDeleteSet: suspend (LocalSetEntity) -> Boolean,
) {
    val context = historyLocaleContext(LocalContext.current)
    val kilometerUnit = context.getString(R.string.history_kilometer_unit)
    val meterUnit = context.getString(R.string.history_meter_unit)
    Card(
        shape = RoundedCornerShape(9.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.4f)),
    ) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(exerciseDisplayName(exercise.name), fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                Spacer(Modifier.width(8.dp))
                Text(muscleGroupLabel(exercise.muscleGroup), style = MaterialTheme.typography.labelSmall)
            }
            if (exercise.category == "CARDIO") {
                exercise.cardio?.let { Text(formatCardioSummary(it), style = MaterialTheme.typography.bodySmall) }
                CardioSetHeader()
            } else {
                Text(
                    stringResource(
                        R.string.history_exercise_strength_summary,
                        formatHistoryWeight(exercise.volume, unit),
                        formatHistoryWeight(exercise.estimated1RM, unit),
                    ),
                    modifier = Modifier.testTag("history-strength-summary-${exercise.id}"),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall,
                )
                HistoricalStrengthExerciseEditor(
                    session = session,
                    exercise = exercise,
                    unit = unit,
                    bootstrap = bootstrap,
                    onUpdateSet = onUpdateSet,
                    onAddSet = onAddSet,
                    onDeleteSet = onDeleteSet,
                )
            }
            if (exercise.category == "CARDIO") {
                exercise.sets.forEach { set ->
                    HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.2f))
                    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        HistoryCell(set.setNumber.toString(), 0.5f)
                        HistoryCell(formatHistoryDuration(set.durationSec), 1f)
                        HistoryCell(formatHistoryDistance(set.distanceM, kilometerUnit, meterUnit), 1f)
                        HistoryCell(set.avgHr?.let { "$it" } ?: "-", 0.8f)
                        HistoryCell(set.maxHr?.let { "$it" } ?: "-", 0.8f)
                    }
                    set.notes?.takeIf { it.isNotBlank() }?.let { note ->
                        Text(
                            stringResource(
                                R.string.history_set_note,
                                set.setNumber,
                                note,
                            ),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun HistoricalStrengthExerciseEditor(
    session: MobileHistorySessionDto,
    exercise: MobileHistoryExerciseDto,
    unit: String,
    bootstrap: BootstrapResponse?,
    onUpdateSet: suspend (LocalSetEntity, Double, Int, Int?, String?) -> Boolean,
    onAddSet: suspend (HistoricalSetAddRequest) -> Boolean,
    onDeleteSet: suspend (LocalSetEntity) -> Boolean,
) {
    val localSets = remember(exercise.sets) {
        exercise.sets.map { set ->
            LocalSetEntity(
                id = set.id,
                sessionId = session.id,
                exerciseId = exercise.id,
                gymEquipmentId = set.gymEquipmentId,
                equipmentNameSnapshot = set.equipmentNameSnapshot,
                selectedLoadKg = set.selectedLoadKg,
                selectedLoadMultiplierSnapshot = set.selectedLoadMultiplierSnapshot,
                nominalResistanceKg = set.nominalResistanceKg,
                equipmentLoadSnapshotJson = set.equipmentLoadSnapshot?.toString(),
                setNumber = set.setNumber,
                weight = set.weight,
                reps = set.reps,
                rir = set.rir,
                notes = set.notes,
                isWarmup = set.isWarmup,
                isDropSet = set.isDropSet,
                recoverySec = set.recoverySec,
                completedAt = set.completedAt,
            )
        }
    }
    val target = remember(session.id, exercise) {
        ProgramExerciseDto(
            id = "finished:${session.id}:${exercise.id}",
            workoutId = session.id,
            exerciseId = exercise.id,
            order = 0,
            targetSets = (localSets.count { !it.isWarmup } + 1).coerceAtLeast(1),
            targetRepsMin = localSets.lastOrNull()?.reps ?: 8,
            targetRepsMax = localSets.lastOrNull()?.reps ?: 12,
            targetRIR = localSets.lastOrNull()?.rir ?: 2,
            restSec = 0,
            exercise = ExerciseDto(
                id = exercise.id,
                name = exercise.name,
                muscleGroup = exercise.muscleGroup,
                category = exercise.category,
                usesBodyweight = exercise.usesBodyweight,
                equipmentType = exercise.equipmentType,
            ),
        )
    }
    val gym = bootstrap?.gyms?.firstOrNull { it.id == session.gymId }
    var selectedEquipmentId by rememberSaveable(session.id, exercise.id) {
        mutableStateOf(localSets.lastOrNull { it.gymEquipmentId != null }?.gymEquipmentId)
    }
    val inventory = resolveExerciseInventory(target, gym, selectedEquipmentId)
    val selectedProfile = selectedEquipment(inventory)
    LaunchedEffect(inventory.constraints.equipmentId) {
        if (selectedEquipmentId == null) selectedEquipmentId = inventory.constraints.equipmentId
    }
    val last = localSets.lastOrNull()
    var weightText by rememberSaveable(session.id, exercise.id) {
        mutableStateOf(
            formatHistoryEditorValue(
                toDisplayWeight(last?.selectedLoadKg ?: last?.weight ?: inventory.weightOptions.firstOrNull() ?: 0.0, unit),
            ),
        )
    }
    var repsText by rememberSaveable(session.id, exercise.id) {
        mutableStateOf((last?.reps ?: 8).toString())
    }
    var rirText by rememberSaveable(session.id, exercise.id) {
        mutableStateOf(last?.rir?.toString() ?: "")
    }
    var pendingAddId by rememberSaveable(session.id, exercise.id) {
        mutableStateOf(newHistoricalSetId())
    }
    var metrics by rememberSaveable(session.id, exercise.id) {
        mutableStateOf(listOf(SetTableMetric.ONE_RM))
    }

    if (!inventory.isAvailable || inventory.equipment.isNotEmpty()) {
        EquipmentSelectorCard(
            inventoryAvailable = inventory.isAvailable,
            equipment = inventory.equipment,
            selectedEquipmentId = selectedProfile?.equipmentId,
            selectionRequired = inventory.requiresEquipmentSelection && selectedProfile == null,
            onSelect = { equipmentId ->
                selectedEquipmentId = equipmentId
                inventory.equipment.firstOrNull { it.equipmentId == equipmentId }
                    ?.attainableLoads
                    ?.minByOrNull { candidate ->
                        val current = weightText.replace(',', '.').toDoubleOrNull()
                            ?.let { fromDisplayWeight(it, unit) }
                            ?: candidate
                        kotlin.math.abs(candidate - current)
                    }
                    ?.let { weightText = formatHistoryEditorValue(toDisplayWeight(it, unit)) }
            },
        )
    }

    StrengthSetEditor(
        mode = StrengthSetEditorMode.FINISHED_EDIT,
        sets = localSets,
        target = target,
        lastPerformance = null,
        unit = unit,
        metrics = metrics,
        onMetricToggle = { metric, enabled ->
            metrics = org.sharteman.gymcoach.training.setTableMetricEnabled(metrics, metric, enabled)
        },
        loadConstraints = inventory.constraints,
        selectedEquipment = selectedProfile,
        submissionEnabled = inventory.isAvailable &&
            (!inventory.requiresEquipmentSelection || selectedProfile != null),
        recommendation = null,
        weightText = weightText,
        repsText = repsText,
        rirText = rirText,
        notesText = "",
        isWarmup = false,
        isDropSet = false,
        onWeightChange = { weightText = it },
        onRepsChange = { repsText = it },
        onRirChange = { rirText = it },
        onNotesChange = {},
        onWarmupChange = {},
        onDropSetChange = {},
        onUpdateSet = onUpdateSet,
        onDelete = onDeleteSet,
        onTargetSetsChange = {},
        onConfirm = confirm@{
            val displayWeight = weightText.replace(',', '.').toDoubleOrNull()
            val weight = displayWeight?.let { roundWeight(fromDisplayWeight(it, unit), 2) }
            val reps = repsText.toIntOrNull()
            val rir = if (rirText.isBlank()) null else rirText.toIntOrNull()
            if (weight == null || reps == null || (!rirText.isBlank() && rir == null)) {
                return@confirm false
            }
            val saved = onAddSet(
                HistoricalSetAddRequest(
                    id = pendingAddId,
                    exerciseId = exercise.id,
                    gymEquipmentId = selectedProfile?.equipmentId,
                    weight = weight,
                    reps = reps,
                    rir = rir,
                ),
            )
            if (saved) pendingAddId = newHistoricalSetId()
            saved
        },
    )
}

private fun newHistoricalSetId(): String =
    "mob_set_${UUID.randomUUID().toString().replace("-", "")}"

private fun formatHistoryEditorValue(value: Double): String {
    val rounded = roundWeight(value, 2)
    return if (rounded % 1.0 == 0.0) rounded.toInt().toString() else rounded.toString()
}

@Composable
private fun StrengthSetHeader(unit: String) {
    Row(modifier = Modifier.fillMaxWidth()) {
        HistoryCell("#", 0.45f, header = true)
        HistoryCell(unit.lowercase(Locale.getDefault()), 1.25f, header = true)
        HistoryCell(stringResource(R.string.history_reps), 0.7f, header = true)
        HistoryCell("RIR", 0.6f, header = true)
        HistoryCell(stringResource(R.string.history_type), 1.1f, header = true)
    }
}

@Composable
private fun CardioSetHeader() {
    Row(modifier = Modifier.fillMaxWidth()) {
        HistoryCell("#", 0.5f, header = true)
        HistoryCell(stringResource(R.string.history_duration_short), 1f, header = true)
        HistoryCell(stringResource(R.string.history_distance_short), 1f, header = true)
        HistoryCell(stringResource(R.string.history_avg_hr), 0.8f, header = true)
        HistoryCell(stringResource(R.string.history_max_hr), 0.8f, header = true)
    }
}

@Composable
private fun RowScope.HistoryCell(value: String, weight: Float, header: Boolean = false) {
    Text(
        value,
        modifier = Modifier.weight(weight).padding(vertical = 3.dp),
        style = if (header) MaterialTheme.typography.labelSmall else MaterialTheme.typography.bodySmall,
        fontWeight = if (header) FontWeight.SemiBold else FontWeight.Normal,
        maxLines = 2,
        overflow = TextOverflow.Ellipsis,
    )
}

@Composable
private fun StatusCard(message: String, error: Boolean = false) {
    Card(
        colors = CardDefaults.cardColors(
            containerColor = if (error) MaterialTheme.colorScheme.errorContainer
            else MaterialTheme.colorScheme.surfaceVariant,
        ),
    ) {
        Text(message, modifier = Modifier.fillMaxWidth().padding(14.dp), textAlign = TextAlign.Center)
    }
}

@Composable
private fun setTypeLabel(warmup: Boolean, dropSet: Boolean): String = stringResource(
    when {
        warmup -> R.string.history_warmup
        dropSet -> R.string.history_drop_set
        else -> R.string.history_working_set
    },
)

private fun Boolean?.orFalse(): Boolean = this == true

@Composable
private fun HistoryDetailSummaryRow(label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, fontWeight = FontWeight.Medium, textAlign = TextAlign.End)
    }
}

private fun formatHistoryWeight(valueKg: Double, unit: String): String {
    val value = roundWeight(toDisplayWeight(valueKg, unit), 1)
    val number = if (value % 1.0 == 0.0) value.toInt().toString()
    else String.format(Locale.getDefault(), "%.1f", value).trimEnd('0').trimEnd('.', ',')
    return "$number ${unit.lowercase(Locale.getDefault())}"
}

private fun formatHistoryDayTitle(value: String): String = runCatching {
    LocalDate.parse(value).format(DateTimeFormatter.ofPattern("EEEE, d MMMM", Locale.getDefault()))
}.getOrElse { value }

private fun formatHistoryTime(value: String): String = runCatching {
    Instant.parse(value).atZone(ZoneId.systemDefault())
        .format(DateTimeFormatter.ofPattern("HH:mm", Locale.getDefault()))
}.getOrElse { value.take(16) }

private fun formatHistoryDateTime(value: String): String = runCatching {
    Instant.parse(value).atZone(ZoneId.systemDefault())
        .format(DateTimeFormatter.ofPattern("d MMMM yyyy, HH:mm", Locale.getDefault()))
}.getOrElse { value }

@Composable
private fun formatCardioSummary(value: MobileHistoryCardioDto): String {
    val context = historyLocaleContext(LocalContext.current)
    val distance = formatHistoryDistance(
        value.distanceM,
        context.getString(R.string.history_kilometer_unit),
        context.getString(R.string.history_meter_unit),
    )
    return listOfNotNull(
        formatHistoryDuration(value.durationSec),
        distance.takeUnless { it == "-" },
        value.avgHr?.let { context.getString(R.string.history_heart_rate_value, it) },
    ).joinToString(" · ")
}
