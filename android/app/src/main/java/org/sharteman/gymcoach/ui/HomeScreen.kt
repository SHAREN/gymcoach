package org.sharteman.gymcoach.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Chat
import androidx.compose.material.icons.automirrored.outlined.List
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.automirrored.outlined.TrendingUp
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.FitnessCenter
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.Language
import androidx.compose.material.icons.outlined.Psychology
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.SystemUpdateAlt
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material.icons.outlined.Wifi
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
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
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.sharteman.gymcoach.R
import org.sharteman.gymcoach.data.local.LocalSessionEntity
import org.sharteman.gymcoach.data.model.BootstrapResponse
import org.sharteman.gymcoach.data.model.ReadinessDto
import org.sharteman.gymcoach.data.model.WorkoutDto
import org.sharteman.gymcoach.data.repository.SyncIssue
import org.sharteman.gymcoach.data.repository.SyncIssueDiscardScope
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

@Immutable
private data class HomeDestination(
    val key: String,
    val title: String,
    val subtitle: String,
    val icon: ImageVector,
    val onClick: () -> Unit,
)

@Immutable
private data class HomeWorkoutItem(
    val id: String,
    val name: String,
    val details: String,
    val canStart: Boolean,
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    email: String?,
    bootstrap: BootstrapResponse?,
    openSessions: List<LocalSessionEntity>,
    pendingCount: Int,
    syncIssue: SyncIssue?,
    online: Boolean,
    syncing: Boolean,
    onOpenSession: (String) -> Unit,
    onStartWorkout: (WorkoutDto, String?) -> Unit,
    onSync: () -> Unit,
    onRetrySyncIssue: () -> Unit,
    onDiscardSyncIssue: () -> Unit,
    onDownloadSyncErrorReport: () -> Unit = {},
    onSaveReadiness: suspend (Int, Int, String?) -> Boolean,
    onPrograms: () -> Unit,
    onExerciseCatalog: () -> Unit,
    onHistory: () -> Unit,
    onProgress: () -> Unit,
    onCoach: () -> Unit,
    onChat: () -> Unit,
    onSettings: () -> Unit,
    onWebPanel: () -> Unit,
    currentVersion: String,
    onDownloadUpdate: () -> Unit,
    onLogout: () -> Unit,
    onEditWorkout: ((programId: String, workoutId: String) -> Unit)? = null,
    onOpenProgram: ((programId: String) -> Unit)? = null,
    serverUrl: String? = null,
) {
    var confirmDiscard by remember { mutableStateOf(false) }
    var showSyncTechnicalDetails by remember { mutableStateOf(false) }
    var showUpdateDialog by remember { mutableStateOf(false) }
    var showReadinessDialog by remember { mutableStateOf(false) }
    var selectedWorkout by remember { mutableStateOf<WorkoutDto?>(null) }
    val gyms = bootstrap?.gyms.orEmpty()
    val gymIds = remember(gyms) { gyms.map { it.id } }
    var selectedGymId by rememberSaveable(bootstrap?.profile?.activeGymId, gymIds) {
        mutableStateOf(initialGymSelection(bootstrap?.profile?.activeGymId, gymIds))
    }
    val workouts = bootstrap?.activeProgram?.workouts.orEmpty()
    val workoutById = remember(workouts) { workouts.associateBy { it.id } }
    val resources = LocalContext.current.resources
    val configuration = LocalConfiguration.current
    val locale = configuration.locales[0] ?: Locale.getDefault()
    val workoutItems = remember(workouts, locale, resources) {
        workouts.map { workout ->
            val exerciseCount = workout.exercises.size
            val exerciseCountLabel = resources.getQuantityString(
                R.plurals.exercise_count,
                exerciseCount,
                exerciseCount,
            )
            HomeWorkoutItem(
                id = workout.id,
                name = workout.name,
                details = listOfNotNull(exerciseCountLabel, workoutDayName(workout.dayOfWeek, locale))
                    .joinToString(" · "),
                canStart = workout.exercises.isNotEmpty(),
            )
        }
    }
    val openSession = openSessions.firstOrNull()
    val openWorkout = openSession?.let { active ->
        workouts.firstOrNull { it.id == active.workoutId }
            ?: bootstrap?.openSessions?.firstOrNull { it.id == active.id }?.workout
    }

    val programsTitle = stringResource(R.string.programs_title)
    val programsDescription = stringResource(R.string.home_programs_description)
    val exercisesTitle = stringResource(R.string.exercise_catalog_title)
    val exercisesDescription = stringResource(R.string.home_exercises_description)
    val historyTitle = stringResource(R.string.history_native_title)
    val historyDescription = stringResource(R.string.home_history_description)
    val progressTitle = stringResource(R.string.progress_title)
    val progressDescription = stringResource(R.string.home_progress_description)
    val coachTitle = stringResource(R.string.coach_native_title)
    val coachDescription = stringResource(R.string.home_coach_description)
    val chatTitle = stringResource(R.string.coach_chat_title)
    val chatDescription = stringResource(R.string.home_chat_description)
    val settingsTitle = stringResource(R.string.settings)
    val settingsDescription = stringResource(R.string.home_settings_description)
    val webTitle = stringResource(R.string.web_panel)
    val webDescription = stringResource(R.string.home_web_description)
    val destinations = remember(
        programsTitle,
        programsDescription,
        exercisesTitle,
        exercisesDescription,
        historyTitle,
        historyDescription,
        progressTitle,
        progressDescription,
        coachTitle,
        coachDescription,
        chatTitle,
        chatDescription,
        settingsTitle,
        settingsDescription,
        webTitle,
        webDescription,
        onPrograms,
        onExerciseCatalog,
        onHistory,
        onProgress,
        onCoach,
        onChat,
        onSettings,
        onWebPanel,
    ) { listOf(
        HomeDestination(
            "programs",
            programsTitle,
            programsDescription,
            Icons.AutoMirrored.Outlined.List,
            onPrograms,
        ),
        HomeDestination(
            "exercises",
            exercisesTitle,
            exercisesDescription,
            Icons.Outlined.FitnessCenter,
            onExerciseCatalog,
        ),
        HomeDestination(
            "history",
            historyTitle,
            historyDescription,
            Icons.Outlined.History,
            onHistory,
        ),
        HomeDestination(
            "progress",
            progressTitle,
            progressDescription,
            Icons.AutoMirrored.Outlined.TrendingUp,
            onProgress,
        ),
        HomeDestination(
            "coach",
            coachTitle,
            coachDescription,
            Icons.Outlined.Psychology,
            onCoach,
        ),
        HomeDestination(
            "chat",
            chatTitle,
            chatDescription,
            Icons.AutoMirrored.Outlined.Chat,
            onChat,
        ),
        HomeDestination(
            "settings",
            settingsTitle,
            settingsDescription,
            Icons.Outlined.Settings,
            onSettings,
        ),
        HomeDestination(
            "web",
            webTitle,
            webDescription,
            Icons.Outlined.Language,
            onWebPanel,
        ),
    ) }
    val destinationRows = remember(destinations) { homeDestinationRows(destinations) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("GymCoach")
                        email?.let {
                            Text(
                                it,
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                },
                actions = {
                    IconButton(onClick = onSync, enabled = online && !syncing) {
                        Icon(Icons.Outlined.Refresh, contentDescription = stringResource(R.string.sync_now))
                    }
                    IconButton(onClick = { showUpdateDialog = true }, enabled = online) {
                        Icon(
                            Icons.Outlined.SystemUpdateAlt,
                            contentDescription = stringResource(R.string.update_app),
                        )
                    }
                    IconButton(onClick = onLogout, enabled = pendingCount == 0) {
                        Icon(Icons.AutoMirrored.Outlined.Logout, contentDescription = stringResource(R.string.logout))
                    }
                },
            )
        },
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 16.dp)
                .testTag("home-dashboard-list"),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item(key = "connection", contentType = "status") {
                ConnectionStatus(online, syncing, pendingCount)
            }
            if (syncIssue != null) {
                item(key = "sync-issue", contentType = "status") {
                    SyncIssueCard(
                        syncIssue = syncIssue,
                        syncing = syncing,
                        onRetry = onRetrySyncIssue,
                        onDiscard = { confirmDiscard = true },
                        onTechnicalDetails = { showSyncTechnicalDetails = true },
                        onDownloadReport = onDownloadSyncErrorReport,
                    )
                }
            }
            if (openSession != null) {
                item(key = "active-session", contentType = "session") {
                    ActiveSessionCard(
                        session = openSession,
                        workoutName = openWorkout?.name,
                        onOpen = { onOpenSession(openSession.id) },
                    )
                }
            }
            item(key = "readiness", contentType = "readiness") {
                ReadinessCard(
                    readiness = bootstrap?.readiness,
                    online = online,
                    onCheckIn = { showReadinessDialog = true },
                )
            }
            if (openSession == null) {
                if (gyms.isNotEmpty()) {
                    item(key = "gym-selector", contentType = "gym-selector") {
                        GymSelector(
                            gyms = gyms.map { it.id to it.name },
                            selectedGymId = selectedGymId,
                            onSelect = { selectedGymId = it },
                        )
                    }
                }
                item(key = "workout-heading", contentType = "heading") {
                    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text(stringResource(R.string.start_workout_title), style = MaterialTheme.typography.titleLarge)
                        bootstrap?.activeProgram?.let {
                            Text(
                                stringResource(R.string.active_program_name, it.name),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
                if (workouts.isEmpty()) {
                    item(key = "empty-program", contentType = "empty") {
                        EmptyProgramCard(onPrograms)
                    }
                } else {
                    items(
                        items = workoutItems,
                        key = { "workout-${it.id}" },
                        contentType = { "workout" },
                    ) { item ->
                        val workout = requireNotNull(workoutById[item.id])
                        WorkoutRow(
                            item = item,
                            onOpen = { selectedWorkout = workout },
                            onStart = { onStartWorkout(workout, selectedGymId) },
                        )
                    }
                }
            }
            item(key = "sections-heading", contentType = "heading") {
                Text(stringResource(R.string.home_sections), style = MaterialTheme.typography.titleLarge)
            }
            items(
                items = destinationRows,
                key = { "destination-row-${it.first().key}" },
                contentType = { "destination-row" },
            ) { row ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    row.forEach { destination ->
                        DestinationCard(destination, Modifier.weight(1f))
                    }
                    if (row.size == 1) {
                        Spacer(Modifier.weight(1f))
                    }
                }
            }
            item(key = "bottom-spacer", contentType = "spacer") { Spacer(Modifier.height(24.dp)) }
        }
    }

    if (confirmDiscard) {
        DiscardSyncDialog(
            issue = syncIssue,
            onDismiss = { confirmDiscard = false },
            onConfirm = {
                confirmDiscard = false
                onDiscardSyncIssue()
            },
        )
    }
    if (showSyncTechnicalDetails && syncIssue != null) {
        val technicalTitle = stringResource(R.string.technical_details)
        val technicalDescription = stringResource(R.string.technical_details_description)
        val doneLabel = stringResource(R.string.done)
        AlertDialog(
            onDismissRequest = { showSyncTechnicalDetails = false },
            title = { Text(technicalTitle) },
            text = {
                Column(
                    modifier = Modifier
                        .heightIn(max = 420.dp)
                        .verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Text(
                        technicalDescription,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    Text(
                        technicalDetailsText(syncIssue.userError),
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.testTag("sync-technical-details"),
                    )
                }
            },
            confirmButton = {
                TextButton(
                    onClick = { showSyncTechnicalDetails = false },
                    modifier = Modifier.testTag("sync-technical-details-close"),
                ) {
                    Text(doneLabel)
                }
            },
        )
    }
    if (showUpdateDialog) {
        AlertDialog(
            onDismissRequest = { showUpdateDialog = false },
            title = { Text(stringResource(R.string.update_app)) },
            text = { Text(stringResource(R.string.update_app_description, currentVersion)) },
            confirmButton = {
                TextButton(
                    onClick = {
                        showUpdateDialog = false
                        onDownloadUpdate()
                    },
                ) { Text(stringResource(R.string.download_latest_apk)) }
            },
            dismissButton = {
                TextButton(onClick = { showUpdateDialog = false }) {
                    Text(stringResource(R.string.cancel))
                }
            },
        )
    }
    if (showReadinessDialog) {
        ReadinessCheckinDialog(
            previous = bootstrap?.readiness,
            onSave = onSaveReadiness,
            onDismiss = { showReadinessDialog = false },
        )
    }
    selectedWorkout?.let { workout ->
        WorkoutDayDetailsDialog(
            programName = bootstrap?.activeProgram?.name.orEmpty(),
            workout = workout,
            serverUrl = serverUrl,
            onStart = {
                selectedWorkout = null
                onStartWorkout(workout, selectedGymId)
            },
            onEditDay = {
                selectedWorkout = null
                onEditWorkout?.invoke(workout.programId, workout.id) ?: onPrograms()
            },
            onOpenProgram = {
                selectedWorkout = null
                onOpenProgram?.invoke(workout.programId) ?: onPrograms()
            },
            onDismiss = { selectedWorkout = null },
        )
    }
}

@Composable
private fun ConnectionStatus(online: Boolean, syncing: Boolean, pendingCount: Int) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            if (online) Icons.Outlined.Wifi else Icons.Outlined.CloudOff,
            contentDescription = null,
            tint = if (online) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.secondary,
        )
        Spacer(Modifier.width(8.dp))
        Column {
            Text(
                stringResource(
                    when {
                        syncing -> R.string.syncing_now
                        online -> R.string.online
                        else -> R.string.offline
                    },
                ),
                style = MaterialTheme.typography.labelLarge,
            )
            if (pendingCount > 0) {
                Text(
                    stringResource(R.string.pending_changes, pendingCount),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun SyncIssueCard(
    syncIssue: SyncIssue,
    syncing: Boolean,
    onRetry: () -> Unit,
    onDiscard: () -> Unit,
    onTechnicalDetails: () -> Unit,
    onDownloadReport: () -> Unit,
) {
    val context = LocalContext.current
    val stateDescription = stringResource(
        if (syncIssue.canRetry) {
            R.string.sync_issue_state_description_retryable
        } else {
            R.string.sync_issue_state_description_permanent
        },
    )
    Card(
        shape = RoundedCornerShape(10.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
        modifier = Modifier
            .fillMaxWidth()
            .semantics { this.stateDescription = stateDescription }
            .testTag("sync-issue-card"),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.WarningAmber, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text(stringResource(R.string.sync_issue_title), style = MaterialTheme.typography.titleMedium)
            }
            Text(
                context.syncIssueSummary(syncIssue.userError),
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.testTag("sync-issue-friendly-summary"),
            )
            Text(
                stringResource(
                    R.string.sync_operation_description,
                    context.syncOperationDescription(syncIssue.type),
                ),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onErrorContainer.copy(alpha = 0.78f),
            )
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                if (syncIssue.canRetry) {
                    Button(
                        onClick = onRetry,
                        enabled = !syncing,
                        modifier = Modifier.fillMaxWidth().testTag("sync-retry"),
                    ) {
                        Text(stringResource(if (syncing) R.string.syncing_now else R.string.retry))
                    }
                }
                OutlinedButton(
                    onClick = onDiscard,
                    enabled = !syncing,
                    modifier = Modifier.fillMaxWidth().testTag("sync-delete-problem-change"),
                ) {
                    Text(stringResource(R.string.sync_delete_problem_change))
                }
                TextButton(
                    onClick = onTechnicalDetails,
                    modifier = Modifier.fillMaxWidth().testTag("sync-technical-details-open"),
                ) {
                    Text(stringResource(R.string.technical_details))
                }
                TextButton(
                    onClick = onDownloadReport,
                    modifier = Modifier.fillMaxWidth().testTag("sync-download-report"),
                ) {
                    Text(stringResource(R.string.download_error_report))
                }
            }
        }
    }
}

@Composable
private fun ActiveSessionCard(
    session: LocalSessionEntity,
    workoutName: String?,
    onOpen: () -> Unit,
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(stringResource(R.string.active_session_title), style = MaterialTheme.typography.titleMedium)
            Text(
                stringResource(
                    R.string.active_session_description,
                    workoutName ?: stringResource(R.string.session_fallback),
                    formatSessionStartedAt(session.startedAt),
                ),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Button(onClick = onOpen, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.resume))
            }
        }
    }
}

@Composable
private fun ReadinessCard(
    readiness: ReadinessDto?,
    online: Boolean,
    onCheckIn: () -> Unit,
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(stringResource(R.string.readiness_title), style = MaterialTheme.typography.titleMedium)
            if (readiness == null) {
                Text(
                    stringResource(R.string.readiness_empty),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                Text(
                    stringResource(
                        R.string.readiness_summary,
                        readiness.readiness,
                        readiness.sleepQuality,
                    ),
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    stringResource(R.string.readiness_age_hours, readiness.ageHours.toInt()),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                readiness.note?.takeIf { it.isNotBlank() }?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall)
                }
            }
            OutlinedButton(onClick = onCheckIn, enabled = online) {
                Text(
                    stringResource(
                        if (readiness == null) R.string.readiness_add else R.string.readiness_update,
                    ),
                )
            }
        }
    }
}

@Composable
private fun GymSelector(
    gyms: List<Pair<String, String>>,
    selectedGymId: String?,
    onSelect: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(stringResource(R.string.training_gym), style = MaterialTheme.typography.titleSmall)
        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            items(gyms, key = { it.first }) { gym ->
                FilterChip(
                    selected = gym.first == selectedGymId,
                    onClick = { onSelect(gym.first) },
                    label = { Text(gym.second) },
                )
            }
        }
        Text(
            stringResource(R.string.training_gym_description),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun EmptyProgramCard(onPrograms: () -> Unit) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(stringResource(R.string.no_cached_program), color = MaterialTheme.colorScheme.onSurfaceVariant)
            Button(onClick = onPrograms) { Text(stringResource(R.string.programs_title)) }
        }
    }
}

@Composable
private fun WorkoutRow(
    item: HomeWorkoutItem,
    onOpen: () -> Unit,
    onStart: () -> Unit,
) {
    Card(
        onClick = onOpen,
        modifier = Modifier.fillMaxWidth().testTag("home-workout-${item.id}"),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(item.name, style = MaterialTheme.typography.titleMedium)
                Text(
                    item.details,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Button(
                onClick = onStart,
                enabled = item.canStart,
                modifier = Modifier.testTag("home-workout-start-${item.id}"),
            ) {
                Text(stringResource(R.string.start))
            }
        }
    }
}

@Composable
private fun DestinationCard(
    destination: HomeDestination,
    modifier: Modifier = Modifier,
) {
    Card(onClick = destination.onClick, modifier = modifier.height(118.dp)) {
        Column(
            modifier = Modifier.fillMaxSize().padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Icon(destination.icon, contentDescription = null, modifier = Modifier.size(24.dp))
            Text(destination.title, style = MaterialTheme.typography.titleSmall)
            Text(
                destination.subtitle,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun DiscardSyncDialog(
    issue: SyncIssue?,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit,
) {
    val title = stringResource(R.string.sync_delete_problem_change)
    val consequence = LocalContext.current.syncDiscardConsequence(issue)
    val cancelLabel = stringResource(R.string.cancel)
    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text(title)
        },
        text = {
            Column(
                modifier = Modifier
                    .heightIn(max = 280.dp)
                    .verticalScroll(rememberScrollState()),
            ) {
                Text(
                    consequence,
                    modifier = Modifier.testTag("sync-delete-consequence"),
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = onConfirm,
                modifier = Modifier.testTag("sync-delete-confirm"),
            ) { Text(title) }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(cancelLabel) }
        },
    )
}

@Composable
private fun ReadinessCheckinDialog(
    previous: ReadinessDto?,
    onSave: suspend (Int, Int, String?) -> Boolean,
    onDismiss: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var readiness by rememberSaveable(previous?.createdAt) {
        mutableIntStateOf(previous?.readiness ?: 0)
    }
    var sleep by rememberSaveable(previous?.createdAt) {
        mutableIntStateOf(previous?.sleepQuality ?: 0)
    }
    var note by rememberSaveable(previous?.createdAt) { mutableStateOf(previous?.note.orEmpty()) }
    var saving by remember { mutableStateOf(false) }
    var validationError by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = { if (!saving) onDismiss() },
        title = { Text(stringResource(R.string.readiness_checkin_title)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                ReadinessScale(
                    label = stringResource(R.string.readiness_overall),
                    value = readiness,
                    onChange = {
                        readiness = it
                        validationError = false
                    },
                )
                ReadinessScale(
                    label = stringResource(R.string.readiness_sleep),
                    value = sleep,
                    onChange = {
                        sleep = it
                        validationError = false
                    },
                )
                OutlinedTextField(
                    value = note,
                    onValueChange = { if (it.length <= 500) note = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text(stringResource(R.string.readiness_note)) },
                    placeholder = { Text(stringResource(R.string.readiness_note_placeholder)) },
                    minLines = 2,
                )
                if (validationError) {
                    Text(
                        stringResource(R.string.readiness_rate_both),
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    if (readiness !in 1..5 || sleep !in 1..5) {
                        validationError = true
                    } else {
                        scope.launch {
                            saving = true
                            if (onSave(readiness, sleep, note)) onDismiss()
                            saving = false
                        }
                    }
                },
                enabled = !saving,
            ) {
                Text(stringResource(if (saving) R.string.saving else R.string.save))
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !saving) { Text(stringResource(R.string.cancel)) }
        },
    )
}

@Composable
private fun ReadinessScale(label: String, value: Int, onChange: (Int) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(label, style = MaterialTheme.typography.labelLarge)
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            (1..5).forEach { score ->
                FilterChip(
                    selected = score == value,
                    onClick = { onChange(score) },
                    label = { Text(score.toString()) },
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

private fun formatSessionStartedAt(value: String): String = runCatching {
    Instant.parse(value).atZone(ZoneId.systemDefault()).format(
        DateTimeFormatter.ofLocalizedDateTime(FormatStyle.SHORT),
    )
}.getOrElse { value.take(16).replace('T', ' ') }

internal fun initialGymSelection(activeGymId: String?, gymIds: List<String>): String? =
    activeGymId?.takeIf { it in gymIds } ?: gymIds.firstOrNull()

internal fun <T> homeDestinationRows(destinations: List<T>): List<List<T>> = destinations.chunked(2)
