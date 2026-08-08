package org.sharteman.gymcoach.ui.programs

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.sharteman.gymcoach.R
import org.sharteman.gymcoach.data.errors.AppErrorContext
import org.sharteman.gymcoach.data.errors.AppErrorDataState
import org.sharteman.gymcoach.data.errors.AppErrorOperation
import org.sharteman.gymcoach.data.model.ExerciseDto
import org.sharteman.gymcoach.data.model.ExerciseHistorySessionDto
import org.sharteman.gymcoach.data.model.MobileProgressPointDto
import org.sharteman.gymcoach.data.programs.ExerciseInput
import org.sharteman.gymcoach.data.programs.ProgramsCatalogDataSource
import org.sharteman.gymcoach.data.programs.ProgramsCatalogRepository
import org.sharteman.gymcoach.ui.ExerciseDetailsDialog
import org.sharteman.gymcoach.ui.ExerciseEditorDialog
import org.sharteman.gymcoach.ui.friendlyErrorMessage
import org.sharteman.gymcoach.ui.localization.exerciseDisplayName

@Composable
fun ExerciseCatalogScreen(
    baseUrl: String,
    token: String,
    onBack: () -> Unit,
    historyByExerciseId: Map<String, List<ExerciseHistorySessionDto>> = emptyMap(),
    progressPointsByExerciseId: Map<String, List<MobileProgressPointDto>> = emptyMap(),
    unit: String = "KG",
    bodyweightKg: Double? = null,
    ownerUserId: String? = null,
    canFetchProgress: Boolean = true,
    onOpenProgress: ((String) -> Unit)? = null,
    onOpenHistory: ((String, String) -> Unit)? = null,
) {
    val repository = remember(baseUrl, token) { ProgramsCatalogRepository.remote(baseUrl, token) }
    ExerciseCatalogScreen(
        dataSource = repository,
        serverUrl = baseUrl,
        onBack = onBack,
        historyByExerciseId = historyByExerciseId,
        progressPointsByExerciseId = progressPointsByExerciseId,
        unit = unit,
        bodyweightKg = bodyweightKg,
        ownerUserId = ownerUserId,
        canFetchProgress = canFetchProgress,
        onOpenProgress = onOpenProgress,
        onOpenHistory = onOpenHistory,
    )
}
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ExerciseCatalogScreen(
    dataSource: ProgramsCatalogDataSource,
    serverUrl: String,
    onBack: () -> Unit,
    historyByExerciseId: Map<String, List<ExerciseHistorySessionDto>> = emptyMap(),
    progressPointsByExerciseId: Map<String, List<MobileProgressPointDto>> = emptyMap(),
    unit: String = "KG",
    bodyweightKg: Double? = null,
    ownerUserId: String? = null,
    canFetchProgress: Boolean = true,
    onOpenProgress: ((String) -> Unit)? = null,
    onOpenHistory: ((String, String) -> Unit)? = null,
    onUpdateExercise: suspend (ExerciseDto, ExerciseInput) -> ExerciseDto = { exercise, input ->
        dataSource.updateExercise(exercise.id, input)
    },
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var exercises by remember { mutableStateOf<List<ExerciseDto>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var query by remember { mutableStateOf("") }
    var muscle by remember { mutableStateOf<String?>(null) }
    var equipment by remember { mutableStateOf<String?>(null) }
    var creating by remember { mutableStateOf(false) }
    var detailId by rememberSaveable { mutableStateOf<String?>(null) }
    var deleting by remember { mutableStateOf<ExerciseDto?>(null) }

    fun reload() {
        scope.launch {
            loading = true
            error = null
            runCatching { dataSource.listExercises() }
                .onSuccess { exercises = it }
                .onFailure {
                    error = context.friendlyErrorMessage(
                        it,
                        AppErrorContext(
                            operation = AppErrorOperation.LOAD,
                            dataState = AppErrorDataState.SAVED_LOCALLY,
                        ),
                    )
                }
            loading = false
        }
    }
    LaunchedEffect(dataSource) { reload() }
    val filtered = remember(exercises, query, muscle, equipment) {
        sortCatalogExercisesByTrainingDays(
            filterCatalogExercises(exercises, query, muscle, equipment),
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.exercise_catalog_title)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = null)
                    }
                },
                actions = {
                    IconButton(onClick = { creating = true }, modifier = Modifier.testTag("exercise-create")) {
                        Icon(Icons.Outlined.Add, contentDescription = stringResource(R.string.exercise_create))
                    }
                },
            )
        },
    ) { insets ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(insets).testTag("exercise-catalog-list"),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            item {
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    label = { Text(stringResource(R.string.exercise_catalog_search)) },
                    modifier = Modifier.fillMaxWidth().testTag("exercise-search"),
                    singleLine = true,
                )
            }
            item {
                ExerciseFilterControls(
                    muscleGroup = muscle,
                    equipmentType = equipment,
                    onMuscleGroupChange = { muscle = it },
                    onEquipmentTypeChange = { equipment = it },
                    onReset = {
                        muscle = null
                        equipment = null
                    },
                )
            }
            if (loading) item { LoadingRow() }
            else if (error != null) item { ErrorCard(error, ::reload) }
            else if (filtered.isEmpty()) item {
                Text(
                    stringResource(R.string.exercise_catalog_empty),
                    modifier = Modifier.fillMaxWidth().padding(28.dp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            else items(filtered, key = { it.id }) { exercise ->
                ExerciseCatalogCard(
                    exercise = exercise,
                    serverUrl = serverUrl,
                    trainedDayCount = exerciseTrainingDayCount(exercise.trainingDates),
                    onOpen = { detailId = exercise.id },
                )
            }
        }
    }

    if (creating) {
        ExerciseEditorDialog(
            exercise = null,
            onDismiss = { creating = false },
            onSave = dataSource::createExercise,
            onSaved = { created ->
                creating = false
                exercises = exercises.filterNot { it.id == created.id } + created
            },
        )
    }
    exercises.firstOrNull { it.id == detailId }?.let { exercise ->
        ExerciseDetailsDialog(
            exercise = exercise,
            history = historyByExerciseId[exercise.id].orEmpty(),
            fallbackPerformance = null,
            progressPoints = progressPointsByExerciseId[exercise.id].orEmpty(),
            unit = unit,
            bodyweightKg = bodyweightKg,
            serverUrl = serverUrl,
            onDismiss = { detailId = null },
            onOpenProgress = if (
                onOpenProgress != null &&
                (canFetchProgress || progressPointsByExerciseId.containsKey(exercise.id))
                ) {
                { exerciseId ->
                    detailId = null
                    onOpenProgress(exerciseId)
                }
            } else null,
            onOpenHistory = onOpenHistory?.let { openHistory ->
                { sessionId, startedAt ->
                    detailId = null
                    openHistory(sessionId, startedAt)
                }
            },
            editableUserId = ownerUserId,
            onUpdateExercise = onUpdateExercise,
            onExerciseUpdated = { updated ->
                exercises = exercises.map { current ->
                    if (current.id == updated.id) updated else current
                }
                detailId = updated.id
            },
            onDelete = if (exercise.userId != null && exercise.userId == ownerUserId) {
                { detailId = null; deleting = exercise }
            } else null,
            backLabelRes = R.string.back_to_exercise_catalog,
            showCloseAction = false,
        )
    }
    deleting?.let { exercise ->
        ConfirmDeleteDialog(
            message = stringResource(
                R.string.confirm_exercise_delete,
                exerciseDisplayName(exercise.name),
            ),
            onDismiss = { deleting = null },
            onConfirm = {
                deleting = null
                scope.launch {
                    runCatching { dataSource.deleteExercise(exercise.id) }
                        .onSuccess { reload() }
                        .onFailure {
                            error = context.friendlyErrorMessage(
                                it,
                                AppErrorContext(
                                    operation = AppErrorOperation.DELETE,
                                    dataState = AppErrorDataState.UNKNOWN,
                                ),
                            )
                        }
                }
            },
        )
    }
}
