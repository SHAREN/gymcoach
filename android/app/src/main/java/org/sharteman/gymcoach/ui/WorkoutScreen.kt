package org.sharteman.gymcoach.ui

import android.content.Context

import androidx.compose.foundation.BorderStroke
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
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Flag
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.Pause
import androidx.compose.material.icons.outlined.Remove
import androidx.compose.material.icons.outlined.RestartAlt
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import coil.compose.SubcomposeAsyncImage
import coil.compose.SubcomposeAsyncImageContent
import coil.imageLoader
import coil.request.ImageRequest
import org.sharteman.gymcoach.R
import org.sharteman.gymcoach.data.local.LocalSetEntity
import org.sharteman.gymcoach.data.media.ExerciseMediaCatalog
import org.sharteman.gymcoach.data.model.BootstrapResponse
import org.sharteman.gymcoach.data.model.ExerciseDto
import org.sharteman.gymcoach.data.model.LastPerformanceDto
import org.sharteman.gymcoach.data.model.PerformanceSetDto
import org.sharteman.gymcoach.data.model.ProgramExerciseDto
import org.sharteman.gymcoach.data.model.ReturnRecommendationDto
import org.sharteman.gymcoach.data.programs.ExerciseInput
import org.sharteman.gymcoach.data.programs.hasSameGeneralMetadata
import org.sharteman.gymcoach.data.repository.GymCoachRepository
import org.sharteman.gymcoach.training.LoadConstraints
import org.sharteman.gymcoach.training.FrozenEquipmentLoadState
import org.sharteman.gymcoach.training.ResolvedEquipmentLoadProfile
import org.sharteman.gymcoach.training.SetRecommendation
import org.sharteman.gymcoach.training.SetTableMetric
import org.sharteman.gymcoach.training.constrainGymWeight
import org.sharteman.gymcoach.training.constraintsFor
import org.sharteman.gymcoach.training.formatSetTableMetric
import org.sharteman.gymcoach.training.frozenEquipmentLoadState
import org.sharteman.gymcoach.training.fromDisplayWeight
import org.sharteman.gymcoach.training.gymWeightOptions
import org.sharteman.gymcoach.training.isAchievableLoad
import org.sharteman.gymcoach.training.nominalResistanceKg
import org.sharteman.gymcoach.training.normalizeSetTableMetrics
import org.sharteman.gymcoach.training.plannedDeloadWeight
import org.sharteman.gymcoach.training.recommendNextSetFromSharedContract
import org.sharteman.gymcoach.training.resolveExerciseInventory
import org.sharteman.gymcoach.training.resolveSharedNextSetTarget
import org.sharteman.gymcoach.training.roundWeight
import org.sharteman.gymcoach.training.selectedEquipment
import org.sharteman.gymcoach.training.setTableMetricEnabled
import org.sharteman.gymcoach.training.toDisplayWeight
import org.sharteman.gymcoach.ui.localization.exerciseDisplayName
import org.sharteman.gymcoach.ui.localization.muscleGroupDisplayName
import org.sharteman.gymcoach.ui.programs.ExerciseAddDialog
import org.sharteman.gymcoach.ui.programs.ExerciseReplacementDialog
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.max
import kotlin.math.abs

private const val WORKOUT_UI_PREFERENCES = "gymcoach-workout-ui"
private const val SET_TABLE_METRIC_KEY = "set-table-metric"

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WorkoutScreen(
    repository: GymCoachRepository,
    sessionId: String,
    bootstrap: BootstrapResponse?,
    online: Boolean,
    ownerUserId: String?,
    onUpdateExercise: suspend (ExerciseDto, ExerciseInput) -> ExerciseDto,
    onAskCoach: () -> Unit,
    onOpenProgress: (String) -> Unit,
    onOpenHistory: (String, String) -> Unit,
    onExit: () -> Unit,
) {
    val context = LocalContext.current
    val workoutPreferences = remember(context) {
        context.applicationContext.getSharedPreferences(WORKOUT_UI_PREFERENCES, Context.MODE_PRIVATE)
    }
    val session by repository.observeSession(sessionId).collectAsState(initial = null)
    val allSets by repository.observeSets(sessionId).collectAsState(initial = emptyList())
    val activeRuntime by repository.observeActiveWorkoutRuntime(sessionId).collectAsState(initial = null)
    val targetSetOverrides by repository.observeActiveTargetSetOverrides(sessionId)
        .collectAsState(initial = emptyList())
    val progressSnapshot by repository.progress.collectAsState(initial = null)
    val workout = remember(bootstrap, session?.workoutId) {
        bootstrap?.activeProgram?.workouts?.firstOrNull { it.id == session?.workoutId }
            ?: bootstrap?.openSessions?.firstOrNull { it.id == sessionId }?.workout
    }
    val scope = rememberCoroutineScope()
    var selectedIndex by rememberSaveable { mutableIntStateOf(0) }
    var restEndsAt by rememberSaveable { mutableLongStateOf(0L) }
    var restRemaining by remember { mutableIntStateOf(0) }
    var showSummary by rememberSaveable { mutableStateOf(false) }
    var controlsDialog by remember { mutableStateOf(false) }
    var exerciseMenuDialog by rememberSaveable { mutableStateOf(false) }
    var addExerciseDialog by rememberSaveable { mutableStateOf(false) }
    var exerciseMutationBusy by remember { mutableStateOf(false) }
    var replacementDialog by rememberSaveable { mutableStateOf(false) }
    var replacementBusy by remember { mutableStateOf(false) }
    var resetDialog by remember { mutableStateOf(false) }
    var resetBusy by remember { mutableStateOf(false) }
    var detailsExerciseId by rememberSaveable { mutableStateOf<String?>(null) }
    var setTableMetricNames by rememberSaveable {
        mutableStateOf(workoutPreferences.getString(SET_TABLE_METRIC_KEY, null))
    }
    val setTableMetrics = normalizeSetTableMetrics(
        setTableMetricNames
            ?.split(',')
            ?.mapNotNull { stored -> SetTableMetric.entries.firstOrNull { it.name == stored } },
    )
    val onSetTableMetricToggle: (SetTableMetric, Boolean) -> Unit = { metric, enabled ->
        val next = setTableMetricEnabled(setTableMetrics, metric, enabled)
        val stored = next.joinToString(",") { it.name }
        setTableMetricNames = stored
        workoutPreferences.edit().putString(SET_TABLE_METRIC_KEY, stored).apply()
    }
    val snackbar = remember { SnackbarHostState() }
    val resetError = stringResource(R.string.workout_reset_error)
    val setUpdateError = stringResource(R.string.set_update_error)
    val setSaveError = stringResource(R.string.set_save_error)
    val setDeleteError = stringResource(R.string.set_delete_error)
    val restStartError = stringResource(R.string.rest_start_error)
    val exerciseReplaceError = stringResource(R.string.exercise_replace_error)
    val exerciseReplaceWaitForRest = stringResource(R.string.exercise_replace_wait_for_rest)
    val exerciseChangeError = stringResource(R.string.exercise_change_error)
    val exerciseRemoveError = stringResource(R.string.exercise_remove_error)
    val exerciseAddError = stringResource(R.string.exercise_add_error)
    val equipmentPreferenceSaveError = stringResource(R.string.equipment_preference_save_error)

    if (session == null || workout == null) {
        Scaffold(topBar = { TopAppBar(title = { Text("GymCoach") }) }) { padding ->
            Column(Modifier.fillMaxSize().padding(padding).padding(24.dp)) {
                Text(stringResource(R.string.no_cached_program))
                Spacer(Modifier.height(16.dp))
                OutlinedButton(onClick = onExit) { Text(stringResource(R.string.cancel)) }
            }
        }
        return
    }

    val exercises = workout.exercises
    val detailsExercise = detailsExerciseId?.let { exerciseId ->
        exercises.firstOrNull { it.exerciseId == exerciseId }?.exercise
    }
    if (selectedIndex !in exercises.indices) selectedIndex = 0
    fun selectExercise(index: Int, persist: Boolean = true, preserveRest: Boolean = false) {
        val selected = exercises.getOrNull(index) ?: return
        selectedIndex = index
        if (persist) {
            scope.launch {
                repository.updateActiveExercise(
                    sessionId,
                    selected.exerciseId,
                    preserveRest = preserveRest,
                )
            }
        }
    }
    LaunchedEffect(activeRuntime?.activeExerciseId, exercises) {
        val runtimeIndex = exercises.indexOfFirst { it.exerciseId == activeRuntime?.activeExerciseId }
        if (runtimeIndex >= 0 && runtimeIndex != selectedIndex) selectExercise(runtimeIndex, persist = false)
    }
    val current = exercises.getOrNull(selectedIndex) ?: return
    val manualTargetSets = targetSetOverrides.associate { override ->
        override.programExerciseId to override.targetSets
    }
    val legacyReturnRecommendations =
        bootstrap?.returnRecommendationsByWorkout?.get(workout.id).orEmpty()
    val equipmentReturnRecommendations =
        bootstrap?.returnRecommendationsByEquipmentByWorkout?.get(workout.id).orEmpty()
    val gym = bootstrap?.gyms?.firstOrNull { it.id == session?.gymId }
    var selectedEquipmentByExercise by rememberSaveable {
        mutableStateOf(emptyMap<String, String>())
    }
    val equipmentSelectionKeys = exercises.mapTo(mutableSetOf(), ::workoutEquipmentSelectionKey)
    LaunchedEffect(equipmentSelectionKeys) {
        selectedEquipmentByExercise = retainWorkoutEquipmentSelections(
            selectedEquipmentByExercise,
            exercises,
        )
    }
    val equipmentIdsByExercise = exercises.associate { exercise ->
        exercise.id to resolveWorkoutEquipmentId(
            exercise = exercise,
            gym = gym,
            sets = allSets,
            selectedEquipmentId = selectedEquipmentByExercise[workoutEquipmentSelectionKey(exercise)],
        )
    }
    val effectiveReturnRecommendations = exercises.mapNotNull { exercise ->
        val recommendation = selectReturnRecommendationForEquipment(
            recommendations = equipmentReturnRecommendations[exercise.id],
            fallback = legacyReturnRecommendations[exercise.id],
            fallbackPerformance = bootstrap?.lastPerformances?.get(exercise.exerciseId),
            fallbackGymId = bootstrap?.profile?.activeGymId,
            gymId = session?.gymId,
            gymEquipmentId = equipmentIdsByExercise[exercise.id],
        )
        resolveEquipmentCalibrationProgress(
            exercise = exercise,
            recommendation = recommendation,
            sets = allSets,
            gymEquipmentId = equipmentIdsByExercise[exercise.id],
        )?.let { exercise.id to it }
    }.toMap()
    val currentEquipmentId = equipmentIdsByExercise[current.id]
    val inventory = resolveExerciseInventory(current, gym, currentEquipmentId)
    val selectedProfile = selectedEquipment(inventory)
    val legacyLastPerformance = bootstrap?.lastPerformances?.get(current.exerciseId)
    val equipmentLastPerformance = selectLastPerformanceForEquipment(
        performances = bootstrap?.lastPerformancesByEquipment?.get(current.exerciseId),
        fallback = legacyLastPerformance,
        gymId = session?.gymId,
        gymEquipmentId = currentEquipmentId,
    )
    val returnRecommendation = effectiveReturnRecommendations[current.id]
    val target = resolveSharedNextSetTarget(
        current,
        returnRecommendation,
        manualTargetSets[current.id],
    ) ?: current.copy(targetSets = manualTargetSets[current.id] ?: current.targetSets)
    val currentSets = allSets.filter { it.exerciseId == current.exerciseId && !it.deleted }
    val selectedEquipmentDto = gym?.equipment?.firstOrNull { it.id == selectedProfile?.equipmentId }
    val comparableSets = selectedProfile?.let { profile ->
        currentSets.filter { it.gymEquipmentId == profile.equipmentId }
    } ?: currentSets
    val previousPerformanceSelection = selectPreviousExercisePerformance(
        exerciseId = current.exerciseId,
        historyByExerciseId = bootstrap?.exerciseHistoryByExerciseId.orEmpty(),
        fallback = legacyLastPerformance,
        currentSessionId = sessionId,
        gymId = session?.gymId,
        gymEquipmentId = currentEquipmentId,
    )
    val previousPerformance = previousPerformanceSelection?.performance
    val exerciseSetProgress = workoutExerciseSetProgress(
        exercises = exercises,
        sets = allSets,
        returnRecommendations = effectiveReturnRecommendations,
        manualTargetSets = manualTargetSets,
    )
    val currentSetProgress = exerciseSetProgress.first { it.programExerciseId == current.id }
    val plannedRows = currentSetProgress.plannedRows
    val completedWorkingRows = currentSetProgress.completedRows
    val totalPlannedRows = exerciseSetProgress.sumOf { it.plannedRows }
    val totalCompletedRows = exerciseSetProgress.sumOf { it.completedRows }
    val completedExerciseIds = completedWorkoutExerciseIds(
        exercises = exercises,
        sets = allSets,
        returnRecommendations = effectiveReturnRecommendations,
        manualTargetSets = manualTargetSets,
    )
    val unit = bootstrap?.profile?.unit ?: "KG"
    val lastWorking = comparableSets.lastOrNull { !it.isWarmup && !it.isDropSet }
    val recoverySec = lastWorking?.let {
        Duration.between(Instant.parse(it.completedAt), Instant.now()).seconds.coerceIn(0, 86_400).toInt()
    }
    val intervening = lastWorking?.let { last ->
        allSets.filter { it.exerciseId != current.exerciseId && it.completedAt > last.completedAt }
            .maxByOrNull { it.completedAt }
    }
    val interveningExercise = intervening?.let { set ->
        exercises.firstOrNull { it.exerciseId == set.exerciseId }
    }
    val sameMuscleSuperset = current.supersetGroup != null &&
        interveningExercise?.supersetGroup == current.supersetGroup &&
        interveningExercise.exercise.muscleGroup == current.exercise.muscleGroup
    val readinessBlocksIncrease = bootstrap?.readiness?.let { readiness ->
        readiness.readiness <= 2 || (readiness.soreness?.get(current.exercise.muscleGroup) ?: 0) >= 4
    } ?: false
    val loadConstraints = inventory.constraints
    val plannedDeloadCeiling = if (bootstrap?.profile?.deloadActive == true) {
        equipmentLastPerformance?.maxWeight?.let { previousWeight ->
            plannedDeloadWeight(previousWeight, loadConstraints)
        }
    } else {
        null
    }
    val recommendation = recommendNextSetFromSharedContract(
        programExercise = current,
        returnRecommendation = returnRecommendation,
        completedSets = comparableSets,
        recoverySec = recoverySec,
        sameMuscleSuperset = sameMuscleSuperset,
        allowLoadIncrease = bootstrap?.profile?.deloadActive != true && !readinessBlocksIncrease,
        plannedDeloadCeiling = plannedDeloadCeiling,
        constraints = loadConstraints,
    )

    if (showSummary) {
        WorkoutSummaryScreen(
            workoutName = workout.name,
            sessionStartedAt = session?.startedAt.orEmpty(),
            sets = allSets,
            exercises = exercises,
            exerciseSetProgress = exerciseSetProgress,
            bodyweightKg = bootstrap?.profile?.bodyweight,
            unit = unit,
            onBack = { showSummary = false },
            onFinish = { notes, rpe ->
                scope.launch {
                    repository.finishSession(sessionId, notes, rpe)
                    onExit()
                }
            },
        )
        return
    }

    var weightText by rememberSaveable(current.id, current.exerciseId) { mutableStateOf("") }
    var repsText by rememberSaveable(current.id, current.exerciseId) { mutableStateOf("") }
    var rirText by rememberSaveable(current.id, current.exerciseId) {
        mutableStateOf(target.targetRIR.toString())
    }
    var notesText by rememberSaveable(current.id, current.exerciseId) { mutableStateOf("") }
    var isWarmup by rememberSaveable(current.id, current.exerciseId) { mutableStateOf(false) }
    var isDropSet by rememberSaveable(current.id, current.exerciseId) { mutableStateOf(false) }
    var preserveInputsAfterExerciseEdit by remember(current.id, current.exerciseId) {
        mutableStateOf(false)
    }
    var completedExerciseEdit by remember(current.id, current.exerciseId) {
        mutableStateOf<ExerciseDto?>(null)
    }
    val autofillKey = workoutInputAutofillKey(
        exerciseId = current.id,
        comparableSetCount = comparableSets.size,
        recommendation = recommendation,
        equipmentId = selectedProfile?.equipmentId,
        returnSuggestedWeight = returnRecommendation?.suggestedWeight,
        lastPerformanceSessionId = equipmentLastPerformance?.sessionId,
    )
    var lastAppliedAutofillKey by rememberSaveable(current.id, current.exerciseId) {
        mutableStateOf<String?>(null)
    }
    var hasAppliedAutofill by rememberSaveable(current.id, current.exerciseId) {
        mutableStateOf(false)
    }
    var observedAutofillKey by remember(current.id, current.exerciseId) {
        mutableStateOf<String?>(null)
    }

    LaunchedEffect(autofillKey) {
        if (shouldPreserveRestoredWorkoutInputs(
                hasAppliedAutofill = hasAppliedAutofill,
                observedAutofillKey = observedAutofillKey,
                weightText = weightText,
                repsText = repsText,
                rirText = rirText,
            )
        ) {
            observedAutofillKey = autofillKey
            lastAppliedAutofillKey = autofillKey
            return@LaunchedEffect
        }
        observedAutofillKey = autofillKey
        if (preserveInputsAfterExerciseEdit) return@LaunchedEffect
        if (!shouldApplyWorkoutInputAutofill(
                lastAppliedKey = lastAppliedAutofillKey,
                currentKey = autofillKey,
                weightText = weightText,
                repsText = repsText,
                rirText = rirText,
            )
        ) {
            return@LaunchedEffect
        }
        val rawCandidateWeight = if (returnRecommendation == null) {
            null
        } else {
            recommendation?.weight
                ?: returnRecommendation.suggestedWeight
                ?: equipmentLastPerformance?.maxWeight
        }
        val candidateWeight = rawCandidateWeight?.let { candidate ->
            plannedDeloadCeiling?.let { ceiling -> minOf(candidate, ceiling) } ?: candidate
        }
        val initialWeight = if (returnRecommendation == null) {
            null
        } else {
            candidateWeight?.let {
                constrainGymWeight(it, it, inventory.constraints)
            } ?: selectedProfile?.attainableLoads?.firstOrNull()
        }
        if (initialWeight == null) {
            weightText = ""
        } else {
            weightText = formatWeight(roundWeight(toDisplayWeight(initialWeight, unit), 2))
        }
        if (returnRecommendation == null) {
            repsText = ""
            rirText = ""
        } else {
            repsText = (recommendation?.reps ?: target.targetRepsMin).toString()
            rirText = (recommendation?.rir ?: target.targetRIR).toString()
        }
        lastAppliedAutofillKey = autofillKey
        hasAppliedAutofill = true
    }

    LaunchedEffect(current.exercise, completedExerciseEdit) {
        val updated = completedExerciseEdit ?: return@LaunchedEffect
        if (current.exercise.hasSameGeneralMetadata(updated)) {
            completedExerciseEdit = null
            preserveInputsAfterExerciseEdit = false
        }
    }

    LaunchedEffect(activeRuntime?.restEndsAtEpochMs) {
        val persistedRestEnd = activeRuntime?.restEndsAtEpochMs ?: 0L
        if (persistedRestEnd != restEndsAt) restEndsAt = persistedRestEnd
    }

    LaunchedEffect(restEndsAt) {
        val activeEnd = restEndsAt
        while (restEndsAt > System.currentTimeMillis()) {
            restRemaining = max(0, ((restEndsAt - System.currentTimeMillis() + 999) / 1000).toInt())
            delay(250)
        }
        restRemaining = 0
        if (activeEnd > 0 && activeEnd <= System.currentTimeMillis()) {
            restEndsAt = 0
            repository.finishRest(sessionId, activeEnd)
        }
    }

    Scaffold(
        topBar = {
            WorkoutHeader(
                workoutName = workout.name,
                exercises = exercises,
                selectedIndex = selectedIndex,
                completedExerciseIds = completedExerciseIds,
                serverUrl = repository.serverUrl,
                selectionEnabled = restRemaining == 0,
                progress = if (totalPlannedRows == 0) {
                    0f
                } else {
                    (totalCompletedRows.toFloat() / totalPlannedRows).coerceIn(0f, 1f)
                },
                onSelect = { index ->
                    selectExercise(index)
                },
                onOpen = { detailsExerciseId = it.id },
                onAdd = { addExerciseDialog = true },
                onOpenControls = { controlsDialog = true },
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .testTag("workout-content"),
            contentPadding = PaddingValues(bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            item {
                ExerciseSummaryCard(
                    exercise = target,
                    completedRows = completedWorkingRows,
                    plannedRows = plannedRows,
                    returnRecommendation = returnRecommendation,
                    onActions = { exerciseMenuDialog = true },
                )
            }
            if (!inventory.isAvailable || inventory.equipment.isNotEmpty()) {
                item {
                    EquipmentSelectorCard(
                        inventoryAvailable = inventory.isAvailable,
                        equipment = inventory.equipment,
                        selectedEquipmentId = selectedProfile?.equipmentId,
                        selectionRequired = inventory.requiresEquipmentSelection && selectedProfile == null,
                        onSelect = { equipmentId ->
                            val key = workoutEquipmentSelectionKey(current)
                            val previous = selectedEquipmentByExercise[key]
                            selectedEquipmentByExercise = selectedEquipmentByExercise + (key to equipmentId)
                            scope.launch {
                                runCatching {
                                    repository.updatePreferredEquipment(
                                        gymId = requireNotNull(gym).id,
                                        exerciseId = current.exerciseId,
                                        preferredEquipmentId = equipmentId,
                                    )
                                }.onFailure {
                                    if (selectedEquipmentByExercise[key] == equipmentId) {
                                        selectedEquipmentByExercise = if (previous == null) {
                                            selectedEquipmentByExercise - key
                                        } else {
                                            selectedEquipmentByExercise + (key to previous)
                                        }
                                    }
                                    snackbar.showSnackbar(equipmentPreferenceSaveError)
                                }
                            }
                        },
                    )
                }
            }
            item {
                StrengthSetEditor(
                    mode = StrengthSetEditorMode.ACTIVE,
                    sets = currentSets,
                    target = target,
                    lastPerformance = previousPerformance,
                    unit = unit,
                    metrics = setTableMetrics,
                    onMetricToggle = onSetTableMetricToggle,
                    loadConstraints = loadConstraints,
                    selectedEquipment = selectedProfile,
                    submissionEnabled = inventory.isAvailable &&
                        (!inventory.requiresEquipmentSelection || selectedProfile != null),
                    recommendation = recommendation,
                    weightText = weightText,
                    repsText = repsText,
                    rirText = rirText,
                    notesText = notesText,
                    isWarmup = isWarmup,
                    isDropSet = isDropSet,
                    onWeightChange = { weightText = it },
                    onRepsChange = { repsText = it },
                    onRirChange = { rirText = it },
                    onNotesChange = { notesText = it },
                    onWarmupChange = {
                        isWarmup = it
                        if (it) isDropSet = false
                    },
                    onDropSetChange = {
                        isDropSet = it
                        if (it) isWarmup = false
                    },
                    onUpdateSet = { set, weight, reps, rir, _ ->
                        runWorkoutSetMutation(snackbar, setUpdateError) {
                            repository.updateSet(set, weight, reps, rir)
                        }
                    },
                    onDelete = { set ->
                        runWorkoutSetMutation(snackbar, setDeleteError) {
                            repository.deleteSet(set.id)
                        }
                    },
                    onTargetSetsChange = { targetSets ->
                        scope.launch {
                            runCatching {
                                repository.updateActiveTargetSets(
                                    sessionId = sessionId,
                                    programExerciseId = current.id,
                                    targetSets = targetSets,
                                    effectiveTargetDropSets = target.targetDropSets,
                                )
                            }.onFailure {
                                snackbar.showSnackbar(exerciseChangeError)
                            }
                        }
                    },
                    onConfirm = confirm@{
                        val displayWeight = weightText.replace(',', '.').toDoubleOrNull()
                        val weight = displayWeight?.let { roundWeight(fromDisplayWeight(it, unit), 2) }
                        val reps = repsText.toIntOrNull()
                        val rir = if (rirText.isBlank()) null else rirText.toIntOrNull()
                        if (weight == null || reps == null || (!rirText.isBlank() && rir == null)) {
                            return@confirm false
                        }
                        val addedSet = try {
                            repository.addSet(
                                sessionId = sessionId,
                                exerciseId = current.exerciseId,
                                weight = weight,
                                reps = reps,
                                rir = rir,
                                notes = notesText,
                                equipment = selectedEquipmentDto,
                                isWarmup = isWarmup,
                                isDropSet = isDropSet,
                            )
                        } catch (error: CancellationException) {
                            throw error
                        } catch (_: Exception) {
                            snackbar.showSnackbar(setSaveError)
                            return@confirm false
                        }
                        notesText = ""
                        if (!isWarmup) isDropSet = false
                        val restStartedAt = System.currentTimeMillis()
                        val proposedRestEnd = restStartedAt + target.restSec * 1000L
                        val restStarted = try {
                            repository.startRest(
                                sessionId,
                                addedSet.id,
                                restStartedAt,
                                proposedRestEnd,
                            )
                        } catch (error: CancellationException) {
                            throw error
                        } catch (_: Exception) {
                            false
                        }
                        if (restStarted) {
                            restEndsAt = proposedRestEnd
                        } else {
                            snackbar.showSnackbar(restStartError)
                        }
                        val next = nextIncompleteWorkoutExerciseIndex(
                            exercises = exercises,
                            sets = allSets,
                            returnRecommendations = effectiveReturnRecommendations,
                            currentIndex = selectedIndex,
                            submittedSet = addedSet,
                            manualTargetSets = manualTargetSets,
                        )
                        if (next != null) selectExercise(next, preserveRest = true)
                        true
                    },
                )
            }
            if (restRemaining > 0) {
                item {
                    RestTimerCard(
                        remainingSec = restRemaining,
                        totalSec = target.restSec,
                        recommendation = recommendation,
                        unit = unit,
                        onAdd30 = {
                            val updatedEnd = restEndsAt + 30_000
                            restEndsAt = updatedEnd
                            scope.launch { repository.updateRest(sessionId, updatedEnd, "ADD_30_SECONDS") }
                        },
                        onSkip = {
                            restEndsAt = 0
                            scope.launch { repository.skipRest(sessionId) }
                        },
                    )
                }
            }
            if (previousPerformanceSelection != null) {
                item {
                    PreviousPerformanceCard(
                        selection = previousPerformanceSelection,
                        unit = unit,
                        metrics = setTableMetrics,
                        onMetricToggle = onSetTableMetricToggle,
                    )
                }
            }
            item {
                SessionActions(
                    canGoPrevious = selectedIndex > 0,
                    canGoNext = selectedIndex < exercises.lastIndex,
                    navigationEnabled = restRemaining == 0,
                    online = online,
                    onPrevious = { selectExercise(selectedIndex - 1) },
                    onNext = { selectExercise(selectedIndex + 1) },
                    onAskCoach = onAskCoach,
                    onFinish = { showSummary = true },
                )
            }
            item { Spacer(Modifier.height(8.dp)) }
        }
    }

    if (exerciseMenuDialog) {
        ActiveExerciseMenuDialog(
            exercise = current,
            effectiveTargetSets = target.targetSets,
            minimumTargetSets = minimumManualTargetSets(target, currentSets),
            exercises = exercises,
            equipmentName = selectedProfile?.equipmentName,
            busy = exerciseMutationBusy,
            onUpdate = { updated ->
                scope.launch {
                    exerciseMutationBusy = true
                    try {
                        repository.updateProgramExercisePrescription(sessionId, updated)
                        exerciseMenuDialog = false
                    } catch (error: CancellationException) {
                        throw error
                    } catch (_: Exception) {
                        snackbar.showSnackbar(exerciseChangeError)
                    } finally {
                        exerciseMutationBusy = false
                    }
                }
            },
            onTargetSetsChange = { targetSets ->
                scope.launch {
                    exerciseMutationBusy = true
                    try {
                        repository.updateActiveTargetSets(
                            sessionId = sessionId,
                            programExerciseId = current.id,
                            targetSets = targetSets,
                            effectiveTargetDropSets = target.targetDropSets,
                        )
                        exerciseMenuDialog = false
                    } catch (error: CancellationException) {
                        throw error
                    } catch (_: Exception) {
                        snackbar.showSnackbar(exerciseChangeError)
                    } finally {
                        exerciseMutationBusy = false
                    }
                }
            },
            onSuperset = { neighborId ->
                scope.launch {
                    exerciseMutationBusy = true
                    try {
                        repository.mutateProgramExerciseSuperset(sessionId, current.id, neighborId)
                        exerciseMenuDialog = false
                    } catch (error: CancellationException) {
                        throw error
                    } catch (_: Exception) {
                        snackbar.showSnackbar(exerciseChangeError)
                    } finally {
                        exerciseMutationBusy = false
                    }
                }
            },
            onReplace = {
                if (restRemaining > 0) {
                    scope.launch { snackbar.showSnackbar(exerciseReplaceWaitForRest) }
                } else {
                    exerciseMenuDialog = false
                    replacementDialog = true
                }
            },
            onRemove = {
                scope.launch {
                    exerciseMutationBusy = true
                    try {
                        repository.removeProgramExercise(sessionId, current.id)
                        exerciseMenuDialog = false
                    } catch (error: CancellationException) {
                        throw error
                    } catch (_: Exception) {
                        snackbar.showSnackbar(exerciseRemoveError)
                    } finally {
                        exerciseMutationBusy = false
                    }
                }
            },
            onInformation = {
                exerciseMenuDialog = false
                detailsExerciseId = current.exerciseId
            },
            onDismiss = { if (!exerciseMutationBusy) exerciseMenuDialog = false },
        )
    }
    if (addExerciseDialog) {
        ExerciseAddDialog(
            catalog = bootstrap?.catalog.orEmpty(),
            excludedExerciseIds = exercises.mapTo(mutableSetOf()) { it.exerciseId },
            trainingDatesByExerciseId = bootstrap?.exerciseHistoryByExerciseId.orEmpty()
                .mapValues { (_, sessions) -> sessions.map { it.startedAt } },
            serverUrl = repository.serverUrl,
            busy = exerciseMutationBusy,
            onConfirm = { exercise ->
                scope.launch {
                    exerciseMutationBusy = true
                    try {
                        repository.addProgramExercise(sessionId, workout.id, exercise.id)
                        addExerciseDialog = false
                    } catch (error: CancellationException) {
                        throw error
                    } catch (_: Exception) {
                        snackbar.showSnackbar(exerciseAddError)
                    } finally {
                        exerciseMutationBusy = false
                    }
                }
            },
            onDismiss = { if (!exerciseMutationBusy) addExerciseDialog = false },
        )
    }
    if (controlsDialog) {
        WorkoutControlsDialog(
            workoutName = workout.name,
            startedAt = session?.startedAt.orEmpty(),
            onComplete = {
                controlsDialog = false
                showSummary = true
            },
            onPause = {
                controlsDialog = false
                onExit()
            },
            onReset = {
                controlsDialog = false
                resetDialog = true
            },
            onDismiss = { controlsDialog = false },
        )
    }
    if (replacementDialog) {
        ExerciseReplacementDialog(
            currentExercise = current.exercise,
            catalog = bootstrap?.catalog.orEmpty(),
            trainingDatesByExerciseId = bootstrap?.exerciseHistoryByExerciseId.orEmpty()
                .mapValues { (_, sessions) -> sessions.map { it.startedAt } },
            serverUrl = repository.serverUrl,
            loggedSetCount = currentSets.size,
            busy = replacementBusy,
            onConfirm = { replacement ->
                scope.launch {
                    replacementBusy = true
                    try {
                        repository.replaceProgramExercise(
                            sessionId = sessionId,
                            programExerciseId = current.id,
                            replacementExerciseId = replacement.id,
                        )
                        replacementDialog = false
                    } catch (error: CancellationException) {
                        throw error
                    } catch (_: Exception) {
                        snackbar.showSnackbar(exerciseReplaceError)
                    } finally {
                        replacementBusy = false
                    }
                }
            },
            onDismiss = { if (!replacementBusy) replacementDialog = false },
        )
    }
    if (resetDialog) {
        AlertDialog(
            onDismissRequest = { if (!resetBusy) resetDialog = false },
            title = { Text(stringResource(R.string.workout_reset_title)) },
            text = { Text(stringResource(R.string.workout_reset_warning)) },
            confirmButton = {
                Button(
                    onClick = {
                        scope.launch {
                            resetBusy = true
                            runCatching { repository.resetSession(sessionId) }
                                .onSuccess {
                                    resetDialog = false
                                    onExit()
                                }
                                .onFailure { snackbar.showSnackbar(resetError) }
                            resetBusy = false
                        }
                    },
                    enabled = !resetBusy,
                ) {
                    Text(stringResource(if (resetBusy) R.string.deleting else R.string.workout_reset_confirm))
                }
            },
            dismissButton = {
                TextButton(onClick = { resetDialog = false }, enabled = !resetBusy) {
                    Text(stringResource(R.string.cancel))
                }
            },
        )
    }
    detailsExercise?.let { exercise ->
        ExerciseDetailsDialog(
            exercise = exercise,
            history = bootstrap?.exerciseHistoryByExerciseId?.get(exercise.id).orEmpty(),
            fallbackPerformance = bootstrap?.lastPerformances?.get(exercise.id),
            progressPoints = progressSnapshot?.exercises
                ?.firstOrNull { it.id == exercise.id }
                ?.points
                .orEmpty(),
            unit = unit,
            bodyweightKg = bootstrap?.profile?.bodyweight,
            serverUrl = repository.serverUrl,
            onOpenProgress = if (
                online || progressSnapshot?.exercises?.any { it.id == exercise.id } == true
            ) {
                { exerciseId ->
                    detailsExerciseId = null
                    onOpenProgress(exerciseId)
                }
            } else null,
            onOpenHistory = { historySessionId, startedAt ->
                detailsExerciseId = null
                onOpenHistory(historySessionId, startedAt)
            },
            onDismiss = { detailsExerciseId = null },
            editableUserId = ownerUserId,
            onUpdateExercise = { currentExercise, input ->
                preserveInputsAfterExerciseEdit = true
                try {
                    onUpdateExercise(currentExercise, input).also { updated ->
                        completedExerciseEdit = updated
                    }
                } catch (error: CancellationException) {
                    preserveInputsAfterExerciseEdit = false
                    throw error
                } catch (error: Exception) {
                    preserveInputsAfterExerciseEdit = false
                    throw error
                }
            },
        )
    }
}

@Composable
private fun WorkoutHeader(
    workoutName: String,
    exercises: List<ProgramExerciseDto>,
    selectedIndex: Int,
    completedExerciseIds: Set<String>,
    serverUrl: String,
    selectionEnabled: Boolean,
    progress: Float,
    onSelect: (Int) -> Unit,
    onOpen: (ExerciseDto) -> Unit,
    onAdd: () -> Unit,
    onOpenControls: () -> Unit,
) {
    Surface(color = MaterialTheme.colorScheme.background) {
        Column(
            modifier = Modifier.fillMaxWidth().statusBarsPadding().padding(top = 4.dp, bottom = 8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        workoutName,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        "${selectedIndex + 1} / ${exercises.size}",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
                IconButton(onClick = onOpenControls) {
                    Icon(
                        Icons.Outlined.MoreVert,
                        contentDescription = stringResource(R.string.workout_controls),
                    )
                }
            }
            LinearProgressIndicator(
                progress = { progress },
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).height(5.dp),
                trackColor = MaterialTheme.colorScheme.surfaceVariant,
            )
            ExerciseStrip(
                exercises = exercises,
                selectedIndex = selectedIndex,
                completedExerciseIds = completedExerciseIds,
                serverUrl = serverUrl,
                selectionEnabled = selectionEnabled,
                onSelect = onSelect,
                onOpen = onOpen,
                onAdd = onAdd,
            )
            HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.35f))
        }
    }
}

@Composable
private fun ExerciseStrip(
    exercises: List<ProgramExerciseDto>,
    selectedIndex: Int,
    completedExerciseIds: Set<String>,
    serverUrl: String,
    selectionEnabled: Boolean,
    onSelect: (Int) -> Unit,
    onOpen: (ExerciseDto) -> Unit,
    onAdd: () -> Unit,
) {
    val context = LocalContext.current
    val mediaCatalog = remember(context) {
        runCatching { ExerciseMediaCatalog.load(context) }.getOrNull()
    }
    val thumbnailUrls = remember(exercises, serverUrl, mediaCatalog) {
        exercises.mapNotNull { exercise ->
            mediaCatalog?.resolve(exercise.exercise.name)?.frameUrl(serverUrl)
        }.distinct()
    }
    val listState = rememberLazyListState()
    LaunchedEffect(selectedIndex) {
        listState.animateScrollToItem((selectedIndex - 1).coerceAtLeast(0))
    }
    LaunchedEffect(thumbnailUrls) {
        thumbnailUrls.forEach { url ->
            context.imageLoader.enqueue(
                ImageRequest.Builder(context)
                    .data(url)
                    .diskCacheKey(url)
                    .build(),
            )
        }
    }
    LazyRow(
        state = listState,
        modifier = Modifier.fillMaxWidth(),
        contentPadding = PaddingValues(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        items(
            count = exercises.size,
            key = { index -> exercises[index].id },
            contentType = { "exercise-thumbnail" },
        ) { index ->
            val exercise = exercises[index]
            val thumbnailUrl = mediaCatalog?.resolve(exercise.exercise.name)?.frameUrl(serverUrl)
            val selected = index == selectedIndex
            val thumbnailAlpha by animateFloatAsState(
                targetValue = exerciseThumbnailAlpha(selected),
                animationSpec = tween(durationMillis = 180),
                label = "exercise-thumbnail-emphasis",
            )
            val imageRequest = remember(thumbnailUrl) {
                thumbnailUrl?.let { url ->
                    ImageRequest.Builder(context)
                        .data(url)
                        .diskCacheKey(url)
                        .crossfade(true)
                        .build()
                }
            }
            val completed = exercise.exerciseId in completedExerciseIds
            val previousInGroup = exercise.supersetGroup != null &&
                exercises.getOrNull(index - 1)?.supersetGroup == exercise.supersetGroup
            val nextInGroup = exercise.supersetGroup != null &&
                exercises.getOrNull(index + 1)?.supersetGroup == exercise.supersetGroup
            Column(
                modifier = Modifier
                    .testTag("exercise-thumbnail-item-${exercise.id}")
                    .semantics {
                        stateDescription = if (selected) {
                            context.getString(R.string.exercise_thumbnail_active)
                        } else {
                            context.getString(R.string.exercise_thumbnail_inactive)
                        }
                    },
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Card(
                    onClick = {
                        when (exerciseStripAction(selected, selectionEnabled)) {
                            ExerciseStripAction.OPEN -> onOpen(exercise.exercise)
                            ExerciseStripAction.SELECT -> onSelect(index)
                            ExerciseStripAction.NONE -> Unit
                        }
                    },
                    modifier = Modifier
                        .width(74.dp)
                        .height(58.dp)
                        .testTag("exercise-thumbnail-$index"),
                    shape = RoundedCornerShape(7.dp),
                    border = BorderStroke(
                        if (selected) 2.dp else 1.dp,
                        if (selected) MaterialTheme.colorScheme.primary
                        else MaterialTheme.colorScheme.outline.copy(alpha = 0.55f),
                    ),
                    colors = CardDefaults.cardColors(
                        containerColor = if (selected) {
                            MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.42f)
                        } else {
                            MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.22f)
                        },
                    ),
                ) {
                    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        if (imageRequest != null) {
                            SubcomposeAsyncImage(
                                model = imageRequest,
                                contentDescription = exerciseDisplayName(exercise.exercise.name),
                                contentScale = ContentScale.Crop,
                                modifier = Modifier.fillMaxSize().graphicsLayer { alpha = thumbnailAlpha },
                                loading = {
                                    ExerciseThumbnailFallback(exerciseDisplayName(exercise.exercise.name), selected)
                                },
                                error = {
                                    ExerciseThumbnailFallback(exerciseDisplayName(exercise.exercise.name), selected)
                                },
                                success = { SubcomposeAsyncImageContent() },
                            )
                            Surface(
                                modifier = Modifier.fillMaxSize(),
                                color = if (selected) {
                                    Color.Transparent
                                } else {
                                    Color.Black.copy(alpha = 0.08f)
                                },
                            ) {}
                        } else {
                            ExerciseThumbnailFallback(exerciseDisplayName(exercise.exercise.name), selected)
                        }
                        if (completed) {
                            Surface(
                                modifier = Modifier.align(Alignment.TopEnd).padding(5.dp).size(19.dp),
                                shape = CircleShape,
                                color = MaterialTheme.colorScheme.primary,
                            ) {
                                Icon(
                                    Icons.Outlined.Check,
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.onPrimary,
                                    modifier = Modifier.padding(3.dp),
                                )
                            }
                        }
                        Text(
                            "${index + 1}",
                            modifier = Modifier.align(Alignment.BottomStart).padding(5.dp),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                if (previousInGroup || nextInGroup) {
                    HorizontalDivider(
                        thickness = 4.dp,
                        color = Color(0xFFEF4444),
                        modifier = Modifier.width(74.dp).padding(top = 4.dp),
                    )
                } else {
                    Spacer(Modifier.height(8.dp))
                }
            }
        }
        item(key = "add-exercise", contentType = "exercise-add-tile") {
            Card(
                onClick = onAdd,
                modifier = Modifier
                    .width(74.dp)
                    .height(58.dp)
                    .testTag("exercise-add-tile"),
                shape = RoundedCornerShape(7.dp),
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.primary),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.35f),
                ),
            ) {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Icon(
                        Icons.Outlined.Add,
                        contentDescription = stringResource(R.string.exercise_add_action),
                        tint = MaterialTheme.colorScheme.primary,
                    )
                }
            }
        }
    }
}

@Composable
private fun ExerciseThumbnailFallback(name: String, selected: Boolean) {
    Text(
        exerciseAbbreviation(name),
        style = MaterialTheme.typography.titleMedium,
        fontWeight = FontWeight.Bold,
        maxLines = 1,
        color = if (selected) MaterialTheme.colorScheme.primary
        else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.62f),
    )
}

@Composable
private fun ExerciseSummaryCard(
    exercise: ProgramExerciseDto,
    completedRows: Int,
    plannedRows: Int,
    returnRecommendation: ReturnRecommendationDto? = null,
    onActions: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        shape = RoundedCornerShape(8.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.45f)),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.18f),
        ),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Row(verticalAlignment = Alignment.Top) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        exerciseDisplayName(exercise.exercise.name),
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        muscleGroupDisplayName(exercise.exercise.muscleGroup),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Surface(
                        shape = RoundedCornerShape(6.dp),
                        color = MaterialTheme.colorScheme.primaryContainer,
                    ) {
                        Text(
                            "$completedRows / $plannedRows",
                            modifier = Modifier.padding(horizontal = 9.dp, vertical = 5.dp),
                            style = MaterialTheme.typography.labelLarge,
                            color = MaterialTheme.colorScheme.onPrimaryContainer,
                        )
                    }
                    IconButton(
                        onClick = onActions,
                        modifier = Modifier.testTag("active-exercise-actions"),
                    ) {
                        Icon(
                            Icons.Outlined.MoreVert,
                            contentDescription = stringResource(R.string.exercise_actions),
                        )
                    }
                }
            }
            Text(
                "${exercise.targetSets} × ${exercise.targetRepsMin}-${exercise.targetRepsMax}  ·  " +
                    "RIR ${exercise.targetRIR}  ·  " +
                    "${exercise.restSec / 60}:${(exercise.restSec % 60).toString().padStart(2, '0')}",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            exercise.tempo?.takeIf { it.isNotBlank() }?.let { tempo ->
                Text(
                    stringResource(R.string.tempo_value, tempo),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            exercise.notes?.takeIf { it.isNotBlank() }?.let { note ->
                Text(
                    note,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (returnRecommendation?.calibrationRequired == true) {
                ReturnCalibrationEvidence(returnRecommendation)
            }
        }
    }
}

@Composable
internal fun ReturnCalibrationEvidence(recommendation: ReturnRecommendationDto) {
    val evidence = returnCalibrationEvidence(recommendation) ?: return
    Surface(
        modifier = Modifier.fillMaxWidth().testTag("return-calibration-evidence"),
        shape = RoundedCornerShape(6.dp),
        color = MaterialTheme.colorScheme.tertiaryContainer,
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(10.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(
                stringResource(
                    if (evidence.calibrationKind == "equipment") {
                        R.string.equipment_calibration_title
                    } else {
                        R.string.return_calibration_title
                    },
                ),
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onTertiaryContainer,
            )
            if (evidence.calibrationKind == "equipment") {
                Text(
                    stringResource(
                        R.string.equipment_calibration_description,
                        evidence.movementSessionCount,
                    ),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onTertiaryContainer,
                )
            }
            Text(
                stringResource(
                    when (evidence.movementConfidence) {
                        "high" -> R.string.movement_confidence_high
                        "medium" -> R.string.movement_confidence_medium
                        else -> R.string.movement_confidence_low
                    },
                ),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onTertiaryContainer,
            )
            Text(
                stringResource(
                    when (evidence.equipmentConfidence) {
                        "high" -> R.string.equipment_confidence_high
                        "medium" -> R.string.equipment_confidence_medium
                        else -> R.string.equipment_confidence_low
                    },
                ),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onTertiaryContainer,
            )
            if (evidence.calibrationKind != "equipment") {
                Text(
                    when (evidence.historyBasis) {
                        "recent-and-long-term" -> stringResource(
                            R.string.return_history_recent_and_long_term,
                            evidence.recentHistorySessionCount,
                            evidence.longTermHistorySessionCount,
                        )
                        "recent-exact" -> stringResource(
                            R.string.return_history_recent,
                            evidence.recentHistorySessionCount,
                        )
                        "long-term-exact" -> stringResource(
                            R.string.return_history_long_term,
                            evidence.longTermHistorySessionCount,
                        )
                        else -> stringResource(R.string.return_history_none)
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onTertiaryContainer,
                )
            }
            if (evidence.calibrationKind == "return") {
                evidence.returnGapDays?.let { returnGapDays ->
                    Text(
                        if (evidence.followsPriorGap) {
                            stringResource(R.string.return_prior_gap, returnGapDays)
                        } else {
                            stringResource(R.string.return_gap, returnGapDays)
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onTertiaryContainer,
                    )
                }
            }
            if (evidence.nonComparableHistorySessionCount > 0) {
                Text(
                    stringResource(
                        R.string.return_non_comparable_history,
                        evidence.nonComparableHistorySessionCount,
                    ),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onTertiaryContainer,
                )
            }
            if (evidence.calibrationKind == "equipment") {
                Text(
                    stringResource(
                        R.string.equipment_calibration_progress,
                        evidence.equipmentWorkingSetCount.coerceAtMost(2),
                    ),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onTertiaryContainer,
                )
            }
            Text(
                stringResource(
                    R.string.return_calibration_targets,
                    recommendation.targetSets,
                    recommendation.targetRIR,
                ),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onTertiaryContainer,
            )
        }
    }
}

@Composable
internal fun EquipmentSelectorCard(
    inventoryAvailable: Boolean,
    equipment: List<ResolvedEquipmentLoadProfile>,
    selectedEquipmentId: String?,
    selectionRequired: Boolean,
    onSelect: (String) -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        shape = RoundedCornerShape(8.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (inventoryAvailable) {
                MaterialTheme.colorScheme.surface
            } else {
                MaterialTheme.colorScheme.errorContainer
            },
        ),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (!inventoryAvailable) {
                Text(
                    stringResource(R.string.exercise_equipment_unavailable),
                    color = MaterialTheme.colorScheme.onErrorContainer,
                )
            } else {
                Text(
                    stringResource(R.string.select_equipment),
                    style = MaterialTheme.typography.labelLarge,
                )
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(equipment, key = { it.equipmentId }) { option ->
                        FilterChip(
                            modifier = Modifier.testTag("equipment-option-${option.equipmentId}"),
                            selected = option.equipmentId == selectedEquipmentId,
                            onClick = { onSelect(option.equipmentId) },
                            label = { Text(option.equipmentName) },
                        )
                    }
                }
                if (selectionRequired) {
                    Text(
                        stringResource(R.string.equipment_selection_required),
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        }
    }
}

private fun loadConstraintsForSet(
    loadConstraints: LoadConstraints,
    set: LocalSetEntity,
): LoadConstraints {
    when (val frozen = frozenEquipmentLoadState(set)) {
        FrozenEquipmentLoadState.Invalid -> return LoadConstraints(
            equipmentType = loadConstraints.equipmentType,
            isAvailable = false,
        )
        FrozenEquipmentLoadState.NoSnapshot -> Unit
        is FrozenEquipmentLoadState.Supported -> return frozen.constraints
    }
    if (loadConstraints.equipmentOptions.isEmpty()) return loadConstraints
    val equipmentId = set.gymEquipmentId
    return if (
        equipmentId != null &&
        loadConstraints.equipmentOptions.any { it.equipmentId == equipmentId }
    ) {
        loadConstraints.copy(equipmentId = equipmentId)
    } else {
        LoadConstraints(equipmentType = loadConstraints.equipmentType)
    }
}

internal enum class StrengthSetEditorMode { ACTIVE, FINISHED_EDIT }

@Composable
internal fun StrengthSetEditor(
    mode: StrengthSetEditorMode,
    sets: List<LocalSetEntity>,
    target: ProgramExerciseDto,
    lastPerformance: LastPerformanceDto?,
    unit: String,
    metrics: List<SetTableMetric>,
    onMetricToggle: (SetTableMetric, Boolean) -> Unit,
    loadConstraints: LoadConstraints,
    selectedEquipment: ResolvedEquipmentLoadProfile?,
    submissionEnabled: Boolean,
    recommendation: SetRecommendation?,
    weightText: String,
    repsText: String,
    rirText: String,
    notesText: String,
    isWarmup: Boolean,
    isDropSet: Boolean,
    onWeightChange: (String) -> Unit,
    onRepsChange: (String) -> Unit,
    onRirChange: (String) -> Unit,
    onNotesChange: (String) -> Unit,
    onWarmupChange: (Boolean) -> Unit,
    onDropSetChange: (Boolean) -> Unit,
    onUpdateSet: suspend (LocalSetEntity, Double, Int, Int?, String?) -> Boolean,
    onDelete: suspend (LocalSetEntity) -> Boolean,
    onTargetSetsChange: (Int) -> Unit,
    onConfirm: suspend () -> Boolean,
) {
    val scope = rememberCoroutineScope()
    var optionsExpanded by rememberSaveable(target.id) { mutableStateOf(false) }
    var pickerKind by rememberSaveable(target.id) { mutableStateOf<String?>(null) }
    var pickerSetId by rememberSaveable(target.id) { mutableStateOf<String?>(null) }
    var setCountOpen by rememberSaveable(target.id) { mutableStateOf(false) }
    var metricDialogOpen by rememberSaveable(target.id) { mutableStateOf(false) }
    var editingSetId by rememberSaveable(target.id) { mutableStateOf<String?>(null) }
    var editingWeightText by rememberSaveable(target.id) { mutableStateOf("") }
    var editingRepsText by rememberSaveable(target.id) { mutableStateOf("") }
    var editingRirText by rememberSaveable(target.id) { mutableStateOf("") }
    var editingReplacementEquipmentId by rememberSaveable(target.id) { mutableStateOf<String?>(null) }
    var equipmentPickerSetId by rememberSaveable(target.id) { mutableStateOf<String?>(null) }
    var pendingDeleteConfirmationId by rememberSaveable(target.id) { mutableStateOf<String?>(null) }
    var updatingSetId by remember(target.id) { mutableStateOf<String?>(null) }
    var deletingSetId by remember(target.id) { mutableStateOf<String?>(null) }
    var submittingSet by remember(target.id) { mutableStateOf(false) }
    var appliedRecommendationKey by rememberSaveable(target.id) { mutableStateOf<String?>(null) }
    val displaySets = displayedWorkoutSets(sets)
    fun mutationInProgress() = updatingSetId != null || deletingSetId != null || submittingSet
    val mutationBusy = mutationInProgress()
    val pickerSet = displaySets.firstOrNull { it.set.id == pickerSetId }?.set
    val pickerLoadConstraints = pickerSet?.let { set ->
        editingReplacementEquipmentId
            ?.takeIf { editingSetId == set.id }
            ?.let { replacementId -> loadConstraints.copy(equipmentId = replacementId) }
            ?: loadConstraintsForSet(loadConstraints, set)
    } ?: loadConstraints
    val completedPlannedRows = displaySets.count { !it.set.isWarmup }
    val plannedRows = target.targetSets + target.targetDropSets
    val activeNumber = displaySets.count { it.workingNumber != null } + 1
    val upcomingSets = if (mode == StrengthSetEditorMode.ACTIVE) {
        upcomingWorkoutSets(
            displayedSets = displaySets,
            targetWorkingSets = target.targetSets,
            targetDropSets = target.targetDropSets,
            activeIsWarmup = isWarmup,
            activeIsDropSet = isDropSet,
        )
    } else {
        emptyList()
    }
    val referenceWeightText = if (pickerSetId != null) editingWeightText else weightText
    val referenceWeightKg = referenceWeightText.replace(',', '.').toDoubleOrNull()
        ?.let { fromDisplayWeight(it, unit) }
        ?: 0.0
    val configuredWeights = gymWeightOptions(pickerLoadConstraints, referenceWeightKg)
    val fallbackStep = if (target.exercise.category == "ISOLATION") 1.0 else 2.5
    val weightOptionsKg = configuredWeights.ifEmpty {
        List(81) { index -> index * fallbackStep }
    }
    val weightOptions = weightOptionsKg
        .map { weight ->
            val decimals = if (unit.equals("LB", ignoreCase = true)) 1 else 2
            roundWeight(toDisplayWeight(weight, unit), decimals)
        }
        .distinct()
        .sorted()
    val currentRecommendationKey = recommendationKey(recommendation)
    val applyRecommendationDescription = stringResource(R.string.apply_set_recommendation)
    val recommendationActionVisible = mode == StrengthSetEditorMode.ACTIVE &&
        recommendation != null && !isWarmup && !isDropSet
    val canApplyRecommendation = !mutationBusy && submissionEnabled && recommendationActionVisible && recommendationCanApply(
        appliedKey = appliedRecommendationKey,
        currentKey = currentRecommendationKey,
    )
    LaunchedEffect(currentRecommendationKey) {
        appliedRecommendationKey = null
    }

    fun startEditing(set: LocalSetEntity): Boolean {
        if (mutationInProgress()) return false
        if (editingSetId != set.id) {
            val draft = draftFromSet(set, unit)
            editingSetId = set.id
            editingWeightText = draft.weightText
            editingRepsText = draft.repsText
            editingRirText = draft.rirText
            editingReplacementEquipmentId = null
        }
        return true
    }

    fun openCompletedPicker(set: LocalSetEntity, kind: SetValuePickerKind) {
        if (!startEditing(set)) return
        pickerSetId = set.id
        pickerKind = kind.name
    }

    fun stopEditing() {
        editingSetId = null
        pickerSetId = null
        pickerKind = null
        editingReplacementEquipmentId = null
        equipmentPickerSetId = null
    }

    fun constraintsForEditingSet(set: LocalSetEntity): LoadConstraints =
        editingReplacementEquipmentId?.let { replacementId ->
            loadConstraints.copy(equipmentId = replacementId)
        } ?: loadConstraintsForSet(loadConstraints, set)

    fun saveEditedSet(
        set: LocalSetEntity,
        draft: EditableSetDraft = EditableSetDraft(
            weightText = editingWeightText,
            repsText = editingRepsText,
            rirText = editingRirText,
        ),
    ) {
        if (mutationInProgress()) return
        val parsed = draft.parse(unit) ?: return
        if (!isAchievableLoad(constraintsForEditingSet(set), parsed.weight)) return
        updatingSetId = set.id
        scope.launch {
            try {
                if (
                    onUpdateSet(
                        set,
                        parsed.weight,
                        parsed.reps,
                        parsed.rir,
                        editingReplacementEquipmentId,
                    ) && editingSetId == set.id
                ) {
                    stopEditing()
                }
            } finally {
                if (updatingSetId == set.id) updatingSetId = null
            }
        }
    }

    fun deleteCompletedSet(set: LocalSetEntity) {
        if (mutationInProgress()) return
        deletingSetId = set.id
        scope.launch {
            try {
                if (onDelete(set) && editingSetId == set.id) stopEditing()
            } finally {
                if (deletingSetId == set.id) deletingSetId = null
            }
        }
    }

    fun submitActiveSet() {
        if (mutationInProgress()) return
        submittingSet = true
        scope.launch {
            try {
                onConfirm()
            } finally {
                submittingSet = false
            }
        }
    }

    fun applyRecommendation() {
        val value = recommendation ?: return
        val draft = recommendationDraft(value, unit)
        onWeightChange(draft.weightText)
        onRepsChange(draft.repsText)
        onRirChange(draft.rirText)
        appliedRecommendationKey = currentRecommendationKey
    }
    val activeNumberActionModifier = if (recommendationActionVisible) {
        Modifier
            .testTag("apply-set-recommendation")
            .semantics { contentDescription = applyRecommendationDescription }
            .clickable(enabled = canApplyRecommendation, onClick = ::applyRecommendation)
    } else {
        Modifier
    }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
            .testTag("strength-set-editor-${mode.name.lowercase(Locale.ROOT)}"),
        shape = RoundedCornerShape(8.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.55f)),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        SetTableHeader(
            unit = unit,
            metrics = metrics,
            setCountEnabled = mode == StrengthSetEditorMode.ACTIVE,
            onSetCountClick = { if (mode == StrengthSetEditorMode.ACTIVE) setCountOpen = true },
            onMetricClick = { metricDialogOpen = true },
        )
        displaySets.forEach { displaySet ->
            val set = displaySet.set
            HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.22f))
            CompletedSetTableRow(
                set = set,
                displayNumber = displaySet.workingNumber,
                unit = unit,
                metrics = metrics,
                isEditing = editingSetId == set.id,
                isUpdating = updatingSetId == set.id || deletingSetId == set.id,
                interactionEnabled = !mutationBusy,
                weightIsAllowed = editingWeightText.replace(',', '.').toDoubleOrNull()
                    ?.let { fromDisplayWeight(it, unit) }
                    ?.let { isAchievableLoad(constraintsForEditingSet(set), it) } == true,
                weightText = editingWeightText,
                repsText = editingRepsText,
                rirText = editingRirText,
                onWeightClick = { openCompletedPicker(set, SetValuePickerKind.WEIGHT) },
                onRepsClick = { openCompletedPicker(set, SetValuePickerKind.REPS) },
                onRirClick = { openCompletedPicker(set, SetValuePickerKind.RIR) },
                onEdit = { startEditing(set) },
                onSave = { saveEditedSet(set) },
                onCancel = ::stopEditing,
                onDelete = {
                    if (mode == StrengthSetEditorMode.FINISHED_EDIT) {
                        pendingDeleteConfirmationId = set.id
                    } else {
                        deleteCompletedSet(set)
                    }
                },
            )
            if (
                mode == StrengthSetEditorMode.FINISHED_EDIT &&
                editingSetId == set.id &&
                loadConstraints.equipmentOptions.isNotEmpty()
            ) {
                val replacementName = editingReplacementEquipmentId?.let { replacementId ->
                    loadConstraints.equipmentOptions.firstOrNull {
                        it.equipmentId == replacementId
                    }?.equipmentName
                }
                TextButton(
                    onClick = { equipmentPickerSetId = set.id },
                    enabled = !mutationBusy,
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag("completed-set-${set.id}-equipment"),
                ) {
                    Text(
                        replacementName
                            ?: set.equipmentNameSnapshot
                            ?: stringResource(R.string.history_edit_equipment),
                    )
                }
            }
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.4f))
        Surface(color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.24f)) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 7.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(5.dp),
            ) {
                Box(
                    modifier = Modifier
                        .weight(0.52f)
                        .height(50.dp)
                        .then(activeNumberActionModifier),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        when {
                            isWarmup -> "W"
                            isDropSet -> "D"
                            else -> activeNumber.toString()
                        },
                        textAlign = TextAlign.Center,
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.primary,
                    )
                    if (canApplyRecommendation) {
                        Surface(
                            modifier = Modifier
                                .align(Alignment.TopEnd)
                                .size(8.dp)
                                .testTag("set-recommendation-dot"),
                            shape = CircleShape,
                            color = Color(0xFF0EA5E9),
                        ) {}
                    }
                }
                SetPickerField(
                    value = weightText,
                    onClick = {
                        pickerSetId = null
                        pickerKind = SetValuePickerKind.WEIGHT.name
                    },
                    enabled = submissionEnabled && !mutationBusy,
                    modifier = Modifier.weight(1.25f).testTag("active-weight-picker"),
                )
                SetPickerField(
                    value = repsText,
                    onClick = {
                        pickerSetId = null
                        pickerKind = SetValuePickerKind.REPS.name
                    },
                    enabled = submissionEnabled && !mutationBusy,
                    modifier = Modifier.weight(0.9f).testTag("active-reps-picker"),
                )
                SetPickerField(
                    value = rirText,
                    onClick = {
                        pickerSetId = null
                        pickerKind = SetValuePickerKind.RIR.name
                    },
                    enabled = submissionEnabled && !mutationBusy,
                    modifier = Modifier.weight(0.78f).testTag("active-rir-picker"),
                )
                metrics.forEach { metric ->
                    SetMetricCell(
                        value = if (isWarmup) {
                            "–"
                        } else {
                            formatSetTableMetric(
                                metric = metric,
                                weightKg = weightText.replace(',', '.').toDoubleOrNull()
                                    ?.let { fromDisplayWeight(it, unit) }
                                    ?: 0.0,
                                reps = repsText.toIntOrNull() ?: 0,
                                unit = unit,
                            )
                        },
                        weight = setMetricColumnWeight(metrics.size),
                    )
                }
                FilledIconButton(
                    onClick = ::submitActiveSet,
                    enabled = !mutationBusy && submissionEnabled &&
                        isValidSetInput(weightText, repsText, rirText, unit) &&
                        weightText.replace(',', '.').toDoubleOrNull()
                            ?.let { fromDisplayWeight(it, unit) }
                            ?.let { isAchievableLoad(loadConstraints, it) } == true,
                    modifier = Modifier.size(40.dp).testTag("active-set-confirm"),
                    shape = RoundedCornerShape(6.dp),
                ) {
                    Icon(
                        Icons.Outlined.Check,
                        contentDescription = stringResource(R.string.confirm_set),
                    )
                }
            }
        }
        upcomingSets.forEach { upcoming ->
            HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.18f))
            UpcomingSetTableRow(
                rowNumber = upcoming.rowNumber,
                isDropSet = upcoming.isDropSet,
                previous = lastPerformance?.sets?.getOrNull(upcoming.performanceIndex),
                unit = unit,
                metrics = metrics,
            )
        }
        if (mode == StrengthSetEditorMode.ACTIVE) {
            HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.3f))
            Column(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 6.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
            TextButton(
                onClick = { optionsExpanded = !optionsExpanded },
                modifier = Modifier.testTag("active-set-options"),
            ) {
                Icon(Icons.Outlined.Tune, contentDescription = null, modifier = Modifier.size(17.dp))
                Spacer(Modifier.width(6.dp))
                Text(stringResource(R.string.set_options))
            }
            if (optionsExpanded || isWarmup || isDropSet || notesText.isNotBlank()) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(
                        selected = isWarmup,
                        onClick = { onWarmupChange(!isWarmup) },
                        label = { Text(stringResource(R.string.warmup_set)) },
                    )
                    FilterChip(
                        selected = isDropSet,
                        onClick = { onDropSetChange(!isDropSet) },
                        label = { Text(stringResource(R.string.drop_set)) },
                    )
                }
                OutlinedTextField(
                    value = notesText,
                    onValueChange = onNotesChange,
                    placeholder = { Text(stringResource(R.string.notes_optional)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth().testTag("active-set-notes"),
                )
            }
            val enteredWeightKg = weightText.replace(',', '.').toDoubleOrNull()
                ?.let { fromDisplayWeight(it, unit) }
            val nominalResistance = enteredWeightKg?.let {
                nominalResistanceKg(selectedEquipment, it)
            }
            if (nominalResistance != null) {
                Text(
                    stringResource(
                        R.string.nominal_resistance_estimate,
                        formatWeight(roundWeight(toDisplayWeight(nominalResistance, unit), 2)),
                        unit.uppercase(Locale.getDefault()),
                    ),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            }
        }
    }

    pickerKind?.let { kindName ->
        val kind = SetValuePickerKind.valueOf(kindName)
        val editingPicker = pickerSetId != null
        SetValuePickerDialog(
            kind = kind,
            value = when (kind) {
                SetValuePickerKind.WEIGHT -> if (editingPicker) editingWeightText else weightText
                SetValuePickerKind.REPS -> if (editingPicker) editingRepsText else repsText
                SetValuePickerKind.RIR -> if (editingPicker) editingRirText else rirText
            },
            options = when (kind) {
                SetValuePickerKind.WEIGHT -> weightOptions
                SetValuePickerKind.REPS -> (1..30).map(Int::toDouble)
                SetValuePickerKind.RIR -> (0..5).map(Int::toDouble)
            },
            unit = unit,
            loadConstraints = pickerLoadConstraints,
            onDismiss = {
                pickerKind = null
                pickerSetId = null
            },
            onConfirm = { selected ->
                if (editingPicker) {
                    val currentDraft = EditableSetDraft(
                        weightText = editingWeightText,
                        repsText = editingRepsText,
                        rirText = editingRirText,
                    )
                    val nextDraft = when (kind) {
                        SetValuePickerKind.WEIGHT -> currentDraft.copy(weightText = selected)
                        SetValuePickerKind.REPS -> currentDraft.copy(repsText = selected)
                        SetValuePickerKind.RIR -> currentDraft.copy(rirText = selected)
                    }
                    editingWeightText = nextDraft.weightText
                    editingRepsText = nextDraft.repsText
                    editingRirText = nextDraft.rirText
                    sets.firstOrNull { it.id == pickerSetId }?.let { saveEditedSet(it, nextDraft) }
                } else {
                    when (kind) {
                        SetValuePickerKind.WEIGHT -> onWeightChange(selected)
                        SetValuePickerKind.REPS -> onRepsChange(selected)
                        SetValuePickerKind.RIR -> onRirChange(selected)
                    }
                    appliedRecommendationKey = null
                }
                pickerKind = null
                pickerSetId = null
            },
        )
    }
    equipmentPickerSetId?.let { targetSetId ->
        val targetSet = sets.firstOrNull { it.id == targetSetId }
        if (targetSet != null) {
            AlertDialog(
                onDismissRequest = { equipmentPickerSetId = null },
                title = { Text(stringResource(R.string.history_edit_equipment)) },
                text = {
                    EquipmentSelectorCard(
                        inventoryAvailable = loadConstraints.isAvailable,
                        equipment = loadConstraints.equipmentOptions,
                        selectedEquipmentId = editingReplacementEquipmentId ?: targetSet.gymEquipmentId,
                        selectionRequired = false,
                        onSelect = { equipmentId ->
                            editingReplacementEquipmentId = equipmentId
                            val profile = loadConstraints.equipmentOptions.firstOrNull {
                                it.equipmentId == equipmentId
                            }
                            val currentWeight = editingWeightText.replace(',', '.').toDoubleOrNull()
                                ?.let { fromDisplayWeight(it, unit) }
                                ?: targetSet.weight
                            profile?.attainableLoads?.minByOrNull { candidate ->
                                abs(candidate - currentWeight)
                            }?.let { attainable ->
                                editingWeightText = formatWeight(
                                    roundWeight(toDisplayWeight(attainable, unit), 2),
                                )
                            }
                            equipmentPickerSetId = null
                        },
                    )
                },
                confirmButton = {},
                dismissButton = {
                    TextButton(onClick = { equipmentPickerSetId = null }) {
                        Text(stringResource(R.string.cancel))
                    }
                },
            )
        }
    }
    pendingDeleteConfirmationId?.let { setId ->
        val set = sets.firstOrNull { it.id == setId }
        if (set != null) {
            AlertDialog(
                onDismissRequest = { pendingDeleteConfirmationId = null },
                title = { Text(stringResource(R.string.history_delete_set_title)) },
                text = { Text(stringResource(R.string.history_delete_set_description)) },
                confirmButton = {
                    TextButton(
                        onClick = {
                            pendingDeleteConfirmationId = null
                            deleteCompletedSet(set)
                        },
                        modifier = Modifier.testTag("finished-set-delete-confirm"),
                    ) {
                        Text(stringResource(R.string.delete))
                    }
                },
                dismissButton = {
                    TextButton(onClick = { pendingDeleteConfirmationId = null }) {
                        Text(stringResource(R.string.cancel))
                    }
                },
            )
        }
    }
    if (setCountOpen && mode == StrengthSetEditorMode.ACTIVE) {
        PlannedSetCountDialog(
            totalSets = plannedRows,
            minSets = max(1 + target.targetDropSets, completedPlannedRows),
            maxSets = 20 + target.targetDropSets,
            onDismiss = { setCountOpen = false },
            onConfirm = { totalSets ->
                onTargetSetsChange(totalSets - target.targetDropSets)
                setCountOpen = false
            },
        )
    }
    if (metricDialogOpen) {
        SetTableMetricDialog(
            selected = metrics,
            onDismiss = { metricDialogOpen = false },
            onToggle = onMetricToggle,
        )
    }
}

@Composable
private fun SetTableHeader(
    unit: String,
    metrics: List<SetTableMetric>,
    setCountEnabled: Boolean,
    onSetCountClick: () -> Unit,
    onMetricClick: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .weight(0.52f)
                .height(30.dp)
                .testTag("set-count-button")
                .clickable(enabled = setCountEnabled, onClick = onSetCountClick),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                "#",
                textAlign = TextAlign.Center,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (setCountEnabled) {
                Icon(
                    Icons.Outlined.Tune,
                    contentDescription = stringResource(R.string.choose_set_count),
                    modifier = Modifier.align(Alignment.TopEnd).size(11.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        TableHeaderCell(unit.uppercase(Locale.getDefault()), 1.25f)
        TableHeaderCell("REPS", 0.9f)
        TableHeaderCell("RIR", 0.78f)
        metrics.forEach { metric ->
            TableHeaderCell(
                setTableMetricShortLabel(metric),
                setMetricColumnWeight(metrics.size),
                Modifier.testTag("set-metric-header-${metric.name}"),
            )
        }
        MetricSelectorHeader(
            onClick = onMetricClick,
            weight = 0.95f,
            tag = "set-metric-selector",
        )
    }
}

@Composable
private fun RowScope.TableHeaderCell(
    value: String,
    weight: Float,
    modifier: Modifier = Modifier,
) {
    Text(
        value,
        modifier = modifier.weight(weight),
        textAlign = TextAlign.Center,
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

@Composable
private fun RowScope.MetricSelectorHeader(
    onClick: () -> Unit,
    weight: Float,
    tag: String,
) {
    Box(
        modifier = Modifier
            .weight(weight)
            .testTag(tag)
            .clickable(onClick = onClick)
            .padding(vertical = 4.dp),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            Icons.Outlined.Edit,
            contentDescription = stringResource(R.string.choose_set_metric),
            modifier = Modifier.size(15.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun CompletedSetTableRow(
    set: LocalSetEntity,
    displayNumber: Int?,
    unit: String,
    metrics: List<SetTableMetric>,
    isEditing: Boolean,
    isUpdating: Boolean,
    interactionEnabled: Boolean,
    weightIsAllowed: Boolean,
    weightText: String,
    repsText: String,
    rirText: String,
    onWeightClick: () -> Unit,
    onRepsClick: () -> Unit,
    onRirClick: () -> Unit,
    onEdit: () -> Unit,
    onSave: () -> Unit,
    onCancel: () -> Unit,
    onDelete: () -> Unit,
) {
    val accessibilityNumber = displayNumber ?: set.setNumber
    val tagSuffix = displayNumber?.toString() ?: set.id
    val weightDescription = stringResource(R.string.set_weight_description, accessibilityNumber)
    val repsDescription = stringResource(R.string.set_reps_description, accessibilityNumber)
    val rirDescription = stringResource(R.string.set_rir_description, accessibilityNumber)
    Surface(
        color = if (isEditing) {
            MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.12f)
        } else {
            Color.Transparent
        },
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .testTag("completed-set-$tagSuffix")
                .padding(horizontal = 6.dp, vertical = 5.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
        Text(
            when {
                set.isWarmup -> "W"
                set.isDropSet -> "D"
                else -> requireNotNull(displayNumber).toString()
            },
            modifier = Modifier.weight(0.52f),
            textAlign = TextAlign.Center,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (isEditing) {
            SetPickerField(
                value = weightText,
                onClick = onWeightClick,
                enabled = interactionEnabled,
                accessibilityDescription = weightDescription,
                modifier = Modifier.weight(1.25f).testTag("completed-set-$tagSuffix-weight-editor"),
            )
            SetPickerField(
                value = repsText,
                onClick = onRepsClick,
                enabled = interactionEnabled,
                accessibilityDescription = repsDescription,
                modifier = Modifier.weight(0.9f).testTag("completed-set-$tagSuffix-reps-editor"),
            )
            SetPickerField(
                value = rirText,
                onClick = onRirClick,
                enabled = interactionEnabled,
                accessibilityDescription = rirDescription,
                modifier = Modifier.weight(0.78f).testTag("completed-set-$tagSuffix-rir-editor"),
            )
        } else {
            CompletedWeightCell(
                set = set,
                unit = unit,
                onClick = onWeightClick,
                tag = "completed-set-$tagSuffix-weight",
                accessibilityDescription = weightDescription,
                enabled = interactionEnabled,
            )
            SetValueCell(
                value = set.reps.toString(),
                weight = 0.9f,
                onClick = onRepsClick,
                tag = "completed-set-$tagSuffix-reps",
                accessibilityDescription = repsDescription,
                enabled = interactionEnabled,
            )
            SetValueCell(
                value = set.rir?.toString() ?: "–",
                weight = 0.78f,
                onClick = onRirClick,
                tag = "completed-set-$tagSuffix-rir",
                accessibilityDescription = rirDescription,
                enabled = interactionEnabled,
            )
        }
        metrics.forEach { metric ->
            SetMetricCell(
                if (set.isWarmup) {
                    "–"
                } else if (isEditing) {
                    formatSetTableMetric(
                        metric = metric,
                        weightKg = weightText.replace(',', '.').toDoubleOrNull()
                            ?.let { fromDisplayWeight(it, unit) }
                            ?: set.weight,
                        reps = repsText.toIntOrNull() ?: set.reps,
                        unit = unit,
                    )
                } else {
                    formatSetTableMetric(metric, set.weight, set.reps, unit)
                },
                setMetricColumnWeight(metrics.size),
            )
        }
        Row(
            modifier = Modifier.weight(0.95f),
            horizontalArrangement = Arrangement.Center,
        ) {
            if (isEditing) {
                IconButton(
                    onClick = onSave,
                    enabled = !isUpdating &&
                        weightIsAllowed &&
                        isValidSetInput(weightText, repsText, rirText, unit),
                    modifier = Modifier.size(30.dp).testTag("completed-set-$tagSuffix-save"),
                ) {
                    Icon(
                        Icons.Outlined.Check,
                        contentDescription = stringResource(R.string.save),
                        modifier = Modifier.size(17.dp),
                    )
                }
                IconButton(
                    onClick = onCancel,
                    enabled = !isUpdating,
                    modifier = Modifier.size(30.dp).testTag("completed-set-$tagSuffix-cancel"),
                ) {
                    Icon(
                        Icons.Outlined.Close,
                        contentDescription = stringResource(R.string.cancel),
                        modifier = Modifier.size(17.dp),
                    )
                }
            } else {
                IconButton(
                    onClick = onEdit,
                    enabled = interactionEnabled,
                    modifier = Modifier.size(30.dp).testTag("completed-set-$tagSuffix-edit"),
                ) {
                    Icon(
                        Icons.Outlined.Edit,
                        contentDescription = stringResource(R.string.edit),
                        modifier = Modifier.size(17.dp),
                    )
                }
                IconButton(
                    onClick = onDelete,
                    enabled = interactionEnabled,
                    modifier = Modifier.size(30.dp).testTag("completed-set-$tagSuffix-delete"),
                ) {
                    Icon(
                        Icons.Outlined.Delete,
                        contentDescription = stringResource(R.string.delete),
                        modifier = Modifier.size(17.dp),
                    )
                }
            }
        }
    }
    }
}

@Composable
private fun RowScope.CompletedWeightCell(
    set: LocalSetEntity,
    unit: String,
    onClick: () -> Unit,
    tag: String,
    accessibilityDescription: String,
    enabled: Boolean,
) {
    val displayedWeight = set.selectedLoadKg ?: set.weight
    val hasEquipmentMetadata = set.equipmentNameSnapshot != null || set.nominalResistanceKg != null
    Box(
        modifier = Modifier
            .weight(1.25f)
            .height(if (hasEquipmentMetadata) 58.dp else 44.dp)
            .testTag(tag)
            .semantics { contentDescription = accessibilityDescription }
            .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                formatWeight(roundWeight(toDisplayWeight(displayedWeight, unit), 2)),
                textAlign = TextAlign.Center,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium,
            )
            set.equipmentNameSnapshot?.let { name ->
                Text(
                    name,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            set.nominalResistanceKg?.let { nominal ->
                Text(
                    stringResource(
                        R.string.nominal_short,
                        formatWeight(roundWeight(toDisplayWeight(nominal, unit), 2)),
                        unit.uppercase(Locale.getDefault()),
                    ),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun RowScope.SetValueCell(value: String, weight: Float) {
    Text(
        value,
        modifier = Modifier.weight(weight),
        textAlign = TextAlign.Center,
        style = MaterialTheme.typography.bodyMedium,
        fontWeight = FontWeight.Medium,
    )
}

@Composable
private fun RowScope.SetValueCell(
    value: String,
    weight: Float,
    onClick: () -> Unit,
    tag: String,
    accessibilityDescription: String,
    enabled: Boolean,
) {
    Box(
        modifier = Modifier
            .weight(weight)
            .height(44.dp)
            .testTag(tag)
            .semantics { contentDescription = accessibilityDescription }
            .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            value,
            textAlign = TextAlign.Center,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Medium,
        )
    }
}

@Composable
private fun RowScope.SetMetricCell(value: String, weight: Float) {
    Text(
        value,
        modifier = Modifier.weight(weight),
        textAlign = TextAlign.Center,
        style = MaterialTheme.typography.bodySmall,
        fontWeight = FontWeight.Medium,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}

@Composable
private fun UpcomingSetTableRow(
    rowNumber: Int,
    isDropSet: Boolean,
    previous: PerformanceSetDto?,
    unit: String,
    metrics: List<SetTableMetric>,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            if (isDropSet) "D" else rowNumber.toString(),
            modifier = Modifier.weight(0.52f),
            textAlign = TextAlign.Center,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        UpcomingValue(
            previous?.let { formatWeight(roundWeight(toDisplayWeight(it.weight, unit), 2)) } ?: "–",
            1.25f,
        )
        UpcomingValue(previous?.reps?.toString() ?: "–", 0.9f)
        UpcomingValue(previous?.rir?.toString() ?: "–", 0.78f)
        metrics.forEach { metric ->
            UpcomingValue(
                previous?.let { formatSetTableMetric(metric, it.weight, it.reps, unit) } ?: "–",
                setMetricColumnWeight(metrics.size),
            )
        }
        Spacer(Modifier.weight(0.95f))
    }
}

@Composable
private fun RowScope.UpcomingValue(value: String, weight: Float) {
    Text(
        value,
        modifier = Modifier.weight(weight),
        textAlign = TextAlign.Center,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}

@Composable
private fun SetTableMetricDialog(
    selected: List<SetTableMetric>,
    onDismiss: () -> Unit,
    onToggle: (SetTableMetric, Boolean) -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.choose_set_metric)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                SetTableMetric.entries.forEach { metric ->
                    val isSelected = metric in selected
                    val canDisable = !isSelected || selected.size > 1
                    TextButton(
                        onClick = { onToggle(metric, !isSelected) },
                        enabled = canDisable,
                        modifier = Modifier
                            .fillMaxWidth()
                            .testTag("set-metric-option-${metric.name}"),
                    ) {
                        Text(
                            text = setTableMetricLongLabel(metric),
                            modifier = Modifier.weight(1f),
                            textAlign = TextAlign.Start,
                        )
                        if (isSelected) {
                            Icon(
                                Icons.Outlined.Check,
                                contentDescription = null,
                                modifier = Modifier.size(18.dp),
                            )
                        }
                    }
                }
                Text(
                    text = stringResource(R.string.set_metric_disclaimer),
                    modifier = Modifier.padding(top = 8.dp),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = onDismiss,
                modifier = Modifier.testTag("set-metric-done"),
            ) {
                Text(stringResource(R.string.done))
            }
        },
        dismissButton = {},
    )
}

private fun setMetricColumnWeight(metricCount: Int): Float = if (metricCount > 1) 0.78f else 0.9f

@Composable
private fun setTableMetricShortLabel(metric: SetTableMetric): String = stringResource(
    when (metric) {
        SetTableMetric.ONE_RM -> R.string.set_metric_one_rm_short
        SetTableMetric.TEN_RM -> R.string.set_metric_ten_rm_short
        SetTableMetric.VOLUME -> R.string.set_metric_volume_short
    },
)

@Composable
private fun setTableMetricLongLabel(metric: SetTableMetric): String = stringResource(
    when (metric) {
        SetTableMetric.ONE_RM -> R.string.set_metric_one_rm
        SetTableMetric.TEN_RM -> R.string.set_metric_ten_rm
        SetTableMetric.VOLUME -> R.string.set_metric_volume
    },
)

@Composable
private fun SetPickerField(
    value: String,
    onClick: () -> Unit,
    modifier: Modifier,
    enabled: Boolean = true,
    accessibilityDescription: String? = null,
) {
    val accessibleModifier = if (accessibilityDescription == null) {
        modifier
    } else {
        modifier.semantics { contentDescription = accessibilityDescription }
    }
    Surface(
        modifier = accessibleModifier.height(50.dp).clickable(enabled = enabled, onClick = onClick),
        shape = RoundedCornerShape(5.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
        color = MaterialTheme.colorScheme.surface,
    ) {
        Box(contentAlignment = Alignment.Center) {
            Text(
                text = value.ifBlank { "—" },
                textAlign = TextAlign.Center,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}

@Composable
internal fun RestTimerCard(
    remainingSec: Int,
    totalSec: Int,
    recommendation: SetRecommendation?,
    unit: String,
    onAdd30: () -> Unit,
    onSkip: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        shape = RoundedCornerShape(8.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.55f)),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        stringResource(R.string.rest),
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        "${remainingSec / 60}:${(remainingSec % 60).toString().padStart(2, '0')}",
                        style = MaterialTheme.typography.headlineMedium,
                        fontWeight = FontWeight.Bold,
                    )
                }
                recommendation?.let {
                    Text(
                        "${formatWeight(roundWeight(toDisplayWeight(it.weight, unit), 2))} " +
                            "${unit.lowercase(Locale.getDefault())} × ${it.reps}\nRIR ${it.rir}",
                        textAlign = TextAlign.End,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            LinearProgressIndicator(
                progress = {
                    if (totalSec <= 0) 0f else (remainingSec.toFloat() / totalSec).coerceIn(0f, 1f)
                },
                modifier = Modifier.fillMaxWidth().height(6.dp),
                trackColor = MaterialTheme.colorScheme.surfaceVariant,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(
                    onClick = onAdd30,
                    modifier = Modifier.weight(1f),
                    shape = RoundedCornerShape(6.dp),
                ) {
                    Text(stringResource(R.string.add_30))
                }
                OutlinedButton(
                    onClick = onSkip,
                    modifier = Modifier.weight(1f),
                    shape = RoundedCornerShape(6.dp),
                ) {
                    Text(stringResource(R.string.skip))
                }
            }
        }
    }
}

@Composable
internal fun PreviousPerformanceCard(
    selection: PreviousPerformanceSelection,
    unit: String,
    metrics: List<SetTableMetric>,
    onMetricToggle: (SetTableMetric, Boolean) -> Unit,
) {
    val performance = selection.performance
    var metricDialogOpen by rememberSaveable { mutableStateOf(false) }
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
            .testTag("previous-performance-card"),
        shape = RoundedCornerShape(8.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.45f)),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.16f),
        ),
    ) {
        Column(modifier = Modifier.fillMaxWidth()) {
            Column(
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                verticalArrangement = Arrangement.spacedBy(3.dp),
            ) {
                Text(
                    stringResource(
                        R.string.previous_workout,
                        formatPerformanceDate(performance.sessionStartedAt),
                    ),
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (selection.equipmentNames.isNotEmpty()) {
                    Text(
                        stringResource(
                            R.string.previous_workout_equipment,
                            selection.equipmentNames.joinToString(),
                        ),
                        modifier = Modifier.testTag("previous-performance-equipment"),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                when (selection.comparability) {
                    PreviousPerformanceComparability.EXACT_EQUIPMENT -> Unit
                    PreviousPerformanceComparability.EQUIPMENT_NOT_RECORDED -> Text(
                        stringResource(R.string.previous_workout_equipment_not_recorded),
                        modifier = Modifier.testTag("previous-performance-provenance"),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    PreviousPerformanceComparability.DIFFERENT_EQUIPMENT -> Text(
                        stringResource(R.string.previous_workout_different_equipment),
                        modifier = Modifier.testTag("previous-performance-provenance"),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.25f))
            Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 7.dp)) {
                TableHeaderCell("#", 0.52f)
                TableHeaderCell(unit.uppercase(Locale.getDefault()), 1.25f)
                TableHeaderCell("REPS", 0.9f)
                TableHeaderCell("RIR", 0.78f)
                metrics.forEach { metric ->
                    TableHeaderCell(
                        setTableMetricShortLabel(metric),
                        setMetricColumnWeight(metrics.size),
                        Modifier.testTag("previous-set-metric-header-${metric.name}"),
                    )
                }
                MetricSelectorHeader(
                    onClick = { metricDialogOpen = true },
                    weight = 0.95f,
                    tag = "previous-set-metric-selector",
                )
            }
            performance.sets.forEachIndexed { index, set ->
                HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.16f))
                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 8.dp),
                ) {
                    SetValueCell(if (set.isDropSet) "D" else "${index + 1}", 0.52f)
                    SetValueCell(
                        formatWeight(roundWeight(toDisplayWeight(set.weight, unit), 2)),
                        1.25f,
                    )
                    SetValueCell(set.reps.toString(), 0.9f)
                    SetValueCell(set.rir?.toString() ?: "–", 0.78f)
                    metrics.forEach { metric ->
                        SetMetricCell(
                            formatSetTableMetric(metric, set.weight, set.reps, unit),
                            setMetricColumnWeight(metrics.size),
                        )
                    }
                    Spacer(Modifier.weight(0.95f))
                }
            }
        }
    }
    if (metricDialogOpen) {
        SetTableMetricDialog(
            selected = metrics,
            onDismiss = { metricDialogOpen = false },
            onToggle = onMetricToggle,
        )
    }
}

@Composable
private fun SessionActions(
    canGoPrevious: Boolean,
    canGoNext: Boolean,
    navigationEnabled: Boolean,
    online: Boolean,
    onPrevious: () -> Unit,
    onNext: () -> Unit,
    onAskCoach: () -> Unit,
    onFinish: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        OutlinedButton(
            onClick = onAskCoach,
            enabled = online,
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(6.dp),
        ) {
            Icon(Icons.Outlined.ChatBubbleOutline, contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text(stringResource(R.string.ask_coach))
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.35f))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(
                onClick = onPrevious,
                enabled = canGoPrevious && navigationEnabled,
                modifier = Modifier.weight(1f),
                shape = RoundedCornerShape(6.dp),
                contentPadding = PaddingValues(horizontal = 6.dp),
            ) {
                Icon(
                    Icons.AutoMirrored.Outlined.ArrowBack,
                    contentDescription = null,
                    modifier = Modifier.size(17.dp),
                )
                Spacer(Modifier.width(3.dp))
                Text(stringResource(R.string.previous), maxLines = 1)
            }
            Button(
                onClick = onFinish,
                modifier = Modifier.weight(1f),
                shape = RoundedCornerShape(6.dp),
                contentPadding = PaddingValues(horizontal = 6.dp),
            ) {
                Icon(Icons.Outlined.Flag, contentDescription = null, modifier = Modifier.size(17.dp))
                Spacer(Modifier.width(4.dp))
                Text(stringResource(R.string.finish_short), maxLines = 1)
            }
            OutlinedButton(
                onClick = onNext,
                enabled = canGoNext && navigationEnabled,
                modifier = Modifier.weight(1f),
                shape = RoundedCornerShape(6.dp),
                contentPadding = PaddingValues(horizontal = 6.dp),
            ) {
                Text(stringResource(R.string.next), maxLines = 1)
                Spacer(Modifier.width(3.dp))
                Icon(
                    Icons.AutoMirrored.Outlined.ArrowForward,
                    contentDescription = null,
                    modifier = Modifier.size(17.dp),
                )
            }
        }
    }
}

@Composable
private fun WorkoutControlsDialog(
    workoutName: String,
    startedAt: String,
    onComplete: () -> Unit,
    onPause: () -> Unit,
    onReset: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.workout_controls)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(workoutName, style = MaterialTheme.typography.titleMedium)
                Text(
                    stringResource(R.string.workout_started_at, formatWorkoutStartedAt(startedAt)),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Button(onClick = onComplete, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Outlined.Flag, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text(stringResource(R.string.workout_review_summary))
                }
                OutlinedButton(onClick = onPause, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Outlined.Pause, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text(stringResource(R.string.workout_pause))
                }
                OutlinedButton(
                    onClick = onReset,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Icon(Icons.Outlined.RestartAlt, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text(stringResource(R.string.workout_reset_title))
                }
            }
        },
        confirmButton = {},
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) }
        },
    )
}

internal data class WorkoutSummaryStats(
    val workingSets: Int,
    val totalReps: Int,
    val volumeKg: Double,
)

internal fun workoutSummaryStats(
    sets: List<LocalSetEntity>,
    exercises: List<ProgramExerciseDto>,
    bodyweightKg: Double?,
): WorkoutSummaryStats {
    val exerciseById = exercises.associateBy { it.exerciseId }
    val workingSets = sets.filter { !it.deleted && !it.isWarmup }
    return WorkoutSummaryStats(
        workingSets = workingSets.size,
        totalReps = workingSets.sumOf { set ->
            val exercise = exerciseById[set.exerciseId]?.exercise
            if (set.durationSec == null && exercise?.category != "CARDIO") set.reps else 0
        },
        volumeKg = workingSets.sumOf { set ->
            val exercise = exerciseById[set.exerciseId]?.exercise
            if (set.durationSec != null || exercise?.category == "CARDIO") {
                0.0
            } else {
                val effectiveLoad = set.weight + if (exercise?.usesBodyweight == true) {
                    bodyweightKg ?: 0.0
                } else {
                    0.0
                }
                effectiveLoad * set.reps
            }
        },
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun WorkoutSummaryScreen(
    workoutName: String,
    sessionStartedAt: String,
    sets: List<LocalSetEntity>,
    exercises: List<ProgramExerciseDto>,
    exerciseSetProgress: List<WorkoutExerciseSetProgress>,
    bodyweightKg: Double?,
    unit: String,
    onBack: () -> Unit,
    onFinish: (String?, Int?) -> Unit,
) {
    val progressByProgramExerciseId = remember(exerciseSetProgress) {
        exerciseSetProgress.associateBy { progress -> progress.programExerciseId }
    }
    val stats = remember(sets, exercises, bodyweightKg) {
        workoutSummaryStats(sets, exercises, bodyweightKg)
    }
    val durationMinutes = remember(sessionStartedAt) {
        runCatching {
            Duration.between(Instant.parse(sessionStartedAt), Instant.now()).toMinutes().coerceAtLeast(0)
        }.getOrDefault(0)
    }
    var notes by rememberSaveable { mutableStateOf("") }
    var sessionRpe by rememberSaveable { mutableStateOf<Int?>(null) }
    var finishing by remember { mutableStateOf(false) }
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.workout_summary_title)) },
                navigationIcon = {
                    IconButton(onClick = onBack, enabled = !finishing) {
                        Icon(
                            Icons.AutoMirrored.Outlined.ArrowBack,
                            contentDescription = stringResource(R.string.previous),
                        )
                    }
                },
            )
        },
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(workoutName, style = MaterialTheme.typography.headlineSmall)
                    Text(
                        stringResource(R.string.workout_started_at, formatWorkoutStartedAt(sessionStartedAt)),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    SummaryStat(
                        label = stringResource(R.string.workout_summary_duration),
                        value = stringResource(R.string.workout_summary_minutes, durationMinutes),
                        modifier = Modifier.weight(1f),
                    )
                    SummaryStat(
                        label = stringResource(R.string.workout_summary_sets),
                        value = stats.workingSets.toString(),
                        modifier = Modifier.weight(1f),
                    )
                    SummaryStat(
                        label = stringResource(R.string.workout_summary_volume),
                        value = "${formatWeight(roundWeight(toDisplayWeight(stats.volumeKg, unit), 2))} ${unit.lowercase(Locale.getDefault())}",
                        modifier = Modifier.weight(1f),
                    )
                }
            }
            item {
                Text(
                    stringResource(R.string.workout_summary_reps, stats.totalReps),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(
                            stringResource(R.string.workout_summary_exercises),
                            style = MaterialTheme.typography.titleMedium,
                        )
                        exercises.forEachIndexed { index, exercise ->
                            val progress = progressByProgramExerciseId.getValue(exercise.id)
                            val completed = progress.completedRows
                            val planned = progress.plannedRows
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                Icon(
                                    if (completed >= planned) Icons.Outlined.Check else Icons.Outlined.Remove,
                                    contentDescription = null,
                                    tint = if (completed >= planned) {
                                        MaterialTheme.colorScheme.primary
                                    } else {
                                        MaterialTheme.colorScheme.onSurfaceVariant
                                    },
                                )
                                Text(
                                    exerciseDisplayName(exercise.exercise.name),
                                    modifier = Modifier.weight(1f),
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                Text(
                                    stringResource(R.string.workout_summary_set_progress, completed, planned),
                                    style = MaterialTheme.typography.labelMedium,
                                )
                            }
                            if (index != exercises.lastIndex) HorizontalDivider()
                        }
                    }
                }
            }
            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(stringResource(R.string.session_rpe), style = MaterialTheme.typography.titleSmall)
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        items((1..10).toList()) { value ->
                            FilterChip(
                                selected = sessionRpe == value,
                                onClick = { sessionRpe = value.takeUnless { it == sessionRpe } },
                                label = { Text(value.toString()) },
                            )
                        }
                    }
                }
            }
            item {
                OutlinedTextField(
                    value = notes,
                    onValueChange = { if (it.length <= 2000) notes = it },
                    label = { Text(stringResource(R.string.notes)) },
                    placeholder = { Text(stringResource(R.string.workout_summary_notes_hint)) },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 3,
                )
            }
            item {
                Button(
                    onClick = {
                        finishing = true
                        onFinish(notes.trim().takeIf { it.isNotEmpty() }, sessionRpe)
                    },
                    enabled = !finishing,
                    modifier = Modifier.fillMaxWidth().height(58.dp),
                ) {
                    Text(
                        stringResource(
                            if (finishing) R.string.saving else R.string.finish_workout,
                        ),
                    )
                }
            }
        }
    }
}

@Composable
private fun SummaryStat(label: String, value: String, modifier: Modifier = Modifier) {
    Card(modifier = modifier) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp, horizontal = 6.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(label, style = MaterialTheme.typography.labelSmall)
            Text(value, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
        }
    }
}

private fun formatWorkoutStartedAt(value: String): String = runCatching {
    Instant.parse(value).atZone(ZoneId.systemDefault()).format(
        DateTimeFormatter.ofPattern("dd.MM.yyyy HH:mm", Locale.getDefault()),
    )
}.getOrElse { value.take(16).replace('T', ' ') }

private fun exerciseAbbreviation(name: String): String {
    val words = name.trim().split(Regex("\\s+")).filter { word ->
        word.any { it.isLetterOrDigit() }
    }
    return when {
        words.isEmpty() -> "?"
        words.size == 1 -> words.first().take(3).uppercase(Locale.getDefault())
        else -> words.take(3).joinToString("") { it.take(1) }.uppercase(Locale.getDefault())
    }
}

internal suspend fun runWorkoutSetMutation(
    snackbar: SnackbarHostState,
    errorMessage: String,
    mutation: suspend () -> Boolean,
): Boolean = try {
    mutation().also { succeeded ->
        if (!succeeded) snackbar.showSnackbar(errorMessage)
    }
} catch (error: CancellationException) {
    throw error
} catch (_: Exception) {
    snackbar.showSnackbar(errorMessage)
    false
}

private fun formatPerformanceDate(value: String): String = runCatching {
    Instant.parse(value).atZone(ZoneId.systemDefault()).format(
        DateTimeFormatter.ofPattern("dd MMM yyyy", Locale.getDefault()),
    )
}.getOrElse { value.take(10) }

internal fun workoutInputAutofillKey(
    exerciseId: String,
    comparableSetCount: Int,
    recommendation: SetRecommendation?,
    equipmentId: String?,
    returnSuggestedWeight: Double?,
    lastPerformanceSessionId: String?,
): String = listOf(
    exerciseId,
    comparableSetCount,
    recommendation?.weight,
    recommendation?.reps,
    recommendation?.rir,
    recommendation?.reason,
    recommendation?.predictedRepsAtSameLoad,
    recommendation?.fatigueLoss,
    recommendation?.confidence,
    equipmentId,
    returnSuggestedWeight,
    lastPerformanceSessionId,
).joinToString("|")

internal fun shouldApplyWorkoutInputAutofill(
    lastAppliedKey: String?,
    currentKey: String,
    weightText: String,
    repsText: String,
    rirText: String,
): Boolean = lastAppliedKey != currentKey ||
    weightText.isBlank() && repsText.isBlank() && rirText.isBlank()

internal fun shouldPreserveRestoredWorkoutInputs(
    hasAppliedAutofill: Boolean,
    observedAutofillKey: String?,
    weightText: String,
    repsText: String,
    rirText: String,
): Boolean = hasAppliedAutofill && observedAutofillKey == null &&
    (weightText.isNotBlank() || repsText.isNotBlank() || rirText.isNotBlank())

internal fun workoutEquipmentSelectionKey(target: ProgramExerciseDto): String =
    "${target.id}|${target.exerciseId}"

internal fun retainWorkoutEquipmentSelections(
    selections: Map<String, String>,
    targets: List<ProgramExerciseDto>,
): Map<String, String> {
    val activeKeys = targets.mapTo(mutableSetOf(), ::workoutEquipmentSelectionKey)
    return selections.filterKeys { it in activeKeys }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun WorkoutScreenPreview(
    initialSets: List<LocalSetEntity>? = null,
    onDeleteSet: (suspend (LocalSetEntity) -> Boolean)? = null,
    onConfirmSet: (suspend () -> Boolean)? = null,
    onUpdateExercise: (suspend (ExerciseDto, ExerciseInput) -> ExerciseDto)? = null,
    firstExerciseName: String = "Romanian Deadlift · Barbell",
    firstEquipmentName: String? = null,
) {
    var exercises by remember {
        mutableStateOf(
            listOf(
            previewProgramExercise(
                id = "romanian-deadlift",
                name = firstExerciseName,
                muscleGroup = "HAMSTRINGS",
                order = 0,
                targetSets = 5,
                targetRepsMin = 10,
                targetRepsMax = 10,
                targetRir = 2,
                restSec = 180,
                supersetGroup = 1,
            ),
            previewProgramExercise(
                id = "incline-bench",
                name = "Incline Bench Press · Dumbbell",
                muscleGroup = "CHEST",
                order = 1,
                targetSets = 4,
                targetRepsMin = 8,
                targetRepsMax = 12,
                targetRir = 2,
                restSec = 150,
                supersetGroup = 1,
                equipmentType = "DUMBBELL",
            ),
            previewProgramExercise(
                id = "triceps-pushdown",
                name = "Triceps Pushdown · Cable",
                muscleGroup = "TRICEPS",
                order = 2,
                targetSets = 3,
                targetRepsMin = 10,
                targetRepsMax = 15,
                targetRir = 2,
                restSec = 90,
                equipmentType = "CABLE",
            ),
            ),
        )
    }
    var sets by remember {
        mutableStateOf(
            initialSets ?: listOf(
                previewLocalSet("set-1", 1, 100.0, 10, 2),
                previewLocalSet("set-2", 2, 100.0, 10, 1),
            ),
        )
    }
    val previous = remember {
        PreviousPerformanceSelection(
            performance = LastPerformanceDto(
                exerciseId = "romanian-deadlift",
                sessionId = "previous-session",
                sessionStartedAt = "2026-07-06T10:00:00Z",
                sets = listOf(
                    PerformanceSetDto(95.0, 10, 2),
                    PerformanceSetDto(95.0, 10, 2),
                    PerformanceSetDto(95.0, 9, 1),
                    PerformanceSetDto(90.0, 10, 2),
                    PerformanceSetDto(85.0, 12, 1, isDropSet = true),
                ),
                maxWeight = 95.0,
                repsAtMaxWeight = 10,
            ),
            comparability = PreviousPerformanceComparability.DIFFERENT_EQUIPMENT,
            equipmentNames = listOf("Olympic bar"),
        )
    }
    var weight by remember { mutableStateOf("97.5") }
    var reps by remember { mutableStateOf("10") }
    var rir by remember { mutableStateOf("2") }
    var notes by remember { mutableStateOf("") }
    var warmup by remember { mutableStateOf(false) }
    var dropSet by remember { mutableStateOf(false) }
    var metrics by remember { mutableStateOf(listOf(SetTableMetric.ONE_RM)) }
    var previewSelectedIndex by remember { mutableIntStateOf(0) }
    var previewDetailsExerciseId by rememberSaveable { mutableStateOf<String?>(null) }
    var previewControlsDialog by rememberSaveable { mutableStateOf(false) }
    var previewExerciseMenuDialog by rememberSaveable { mutableStateOf(false) }
    var previewAddExerciseDialog by rememberSaveable { mutableStateOf(false) }
    var previewReplacementDialog by rememberSaveable { mutableStateOf(false) }
    val previewDetailsExercise = previewDetailsExerciseId?.let { exerciseId ->
        exercises.firstOrNull { it.exerciseId == exerciseId }?.exercise
    }
    val previewTarget = exercises[previewSelectedIndex]
    val previewCatalog = exercises.map { it.exercise } + listOf(
        ExerciseDto(
            id = "lying-leg-curl",
            userId = "preview-user",
            name = "Lying Leg Curl",
            muscleGroup = "HAMSTRINGS",
            category = "ISOLATION",
            equipmentType = "MACHINE",
            trainingDates = listOf("2026-07-01T10:00:00Z"),
        ),
        ExerciseDto(
            id = "seated-cable-row",
            userId = "preview-user",
            name = "Seated Cable Row",
            muscleGroup = "BACK_THICKNESS",
            category = "COMPOUND",
            equipmentType = "CABLE",
        ),
    ).distinctBy { it.id }
    val recommendation = remember {
        SetRecommendation(
            weight = 97.5,
            reps = 10,
            rir = 2,
            reason = "ON_TARGET",
            predictedRepsAtSameLoad = 10,
            fatigueLoss = 0.5,
            confidence = "high",
        )
    }

    Scaffold(
        topBar = {
            WorkoutHeader(
                workoutName = "Monday",
                exercises = exercises,
                selectedIndex = previewSelectedIndex,
                completedExerciseIds = emptySet(),
                serverUrl = "https://gymcoach7.sharteman.duckdns.org",
                selectionEnabled = true,
                progress = 2f / 12f,
                onSelect = { previewSelectedIndex = it },
                onOpen = { previewDetailsExerciseId = it.id },
                onAdd = { previewAddExerciseDialog = true },
                onOpenControls = { previewControlsDialog = true },
            )
        },
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .testTag("workout-content"),
            contentPadding = PaddingValues(bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            item {
                ExerciseSummaryCard(
                    previewTarget,
                    completedRows = if (previewSelectedIndex == 0) 2 else 0,
                    plannedRows = previewTarget.targetSets + previewTarget.targetDropSets,
                    onActions = { previewExerciseMenuDialog = true },
                )
            }
            item {
                StrengthSetEditor(
                    mode = StrengthSetEditorMode.ACTIVE,
                    sets = if (previewSelectedIndex == 0) sets else emptyList(),
                    target = previewTarget,
                    lastPerformance = previous.performance,
                    unit = "KG",
                    metrics = metrics,
                    onMetricToggle = { metric, enabled ->
                        metrics = setTableMetricEnabled(metrics, metric, enabled)
                    },
                    loadConstraints = constraintsFor(previewTarget, null),
                    selectedEquipment = null,
                    submissionEnabled = true,
                    recommendation = recommendation,
                    weightText = weight,
                    repsText = reps,
                    rirText = rir,
                    notesText = notes,
                    isWarmup = warmup,
                    isDropSet = dropSet,
                    onWeightChange = { weight = it },
                    onRepsChange = { reps = it },
                    onRirChange = { rir = it },
                    onNotesChange = { notes = it },
                    onWarmupChange = { warmup = it },
                    onDropSetChange = { dropSet = it },
                    onUpdateSet = { set, updatedWeight, updatedReps, updatedRir, _ ->
                        sets = sets.map { currentSet ->
                            if (currentSet.id == set.id) {
                                currentSet.copy(
                                    weight = updatedWeight,
                                    reps = updatedReps,
                                    rir = updatedRir,
                                )
                            } else {
                                currentSet
                            }
                        }
                        true
                    },
                    onDelete = { set ->
                        val deleted = onDeleteSet?.invoke(set) ?: false
                        if (deleted) sets = sets.filterNot { it.id == set.id }
                        deleted
                    },
                    onTargetSetsChange = {},
                    onConfirm = { onConfirmSet?.invoke() ?: false },
                )
            }
            item {
                RestTimerCard(
                    remainingSec = 105,
                    totalSec = 180,
                    recommendation = recommendation,
                    unit = "KG",
                    onAdd30 = {},
                    onSkip = {},
                )
            }
            item {
                PreviousPerformanceCard(
                    selection = previous,
                    unit = "KG",
                    metrics = metrics,
                    onMetricToggle = { metric, enabled ->
                        metrics = setTableMetricEnabled(metrics, metric, enabled)
                    },
                )
            }
            item {
                SessionActions(
                    canGoPrevious = false,
                    canGoNext = true,
                    navigationEnabled = true,
                    online = true,
                    onPrevious = {},
                    onNext = {},
                    onAskCoach = {},
                    onFinish = {},
                )
            }
        }
    }
    if (previewControlsDialog) {
        WorkoutControlsDialog(
            workoutName = "Monday",
            startedAt = "2026-07-13T10:00:00Z",
            onComplete = {},
            onPause = {},
            onReset = {},
            onDismiss = { previewControlsDialog = false },
        )
    }
    if (previewExerciseMenuDialog) {
        ActiveExerciseMenuDialog(
            exercise = previewTarget,
            effectiveTargetSets = previewTarget.targetSets,
            minimumTargetSets = 1,
            exercises = exercises,
            equipmentName = firstEquipmentName,
            busy = false,
            onUpdate = { updated ->
                exercises = exercises.map { if (it.id == updated.id) updated else it }
                previewExerciseMenuDialog = false
            },
            onTargetSetsChange = { targetSets ->
                exercises = exercises.map {
                    if (it.id == previewTarget.id) it.copy(targetSets = targetSets) else it
                }
                previewExerciseMenuDialog = false
            },
            onSuperset = { neighborId ->
                if (neighborId == null) {
                    val group = previewTarget.supersetGroup
                    exercises = exercises.map {
                        if (group != null && it.supersetGroup == group) it.copy(supersetGroup = null) else it
                    }
                } else {
                    val neighbor = exercises.first { it.id == neighborId }
                    val group = neighbor.supersetGroup ?: previewTarget.supersetGroup ?: 1
                    exercises = exercises.map {
                        if (it.id == previewTarget.id || it.id == neighbor.id) it.copy(supersetGroup = group) else it
                    }
                }
                previewExerciseMenuDialog = false
            },
            onReplace = {
                previewExerciseMenuDialog = false
                previewReplacementDialog = true
            },
            onRemove = {
                exercises = exercises.filterNot { it.id == previewTarget.id }
                    .mapIndexed { index, item -> item.copy(order = index) }
                previewSelectedIndex = previewSelectedIndex.coerceAtMost(exercises.lastIndex)
                previewExerciseMenuDialog = false
            },
            onInformation = {
                previewExerciseMenuDialog = false
                previewDetailsExerciseId = previewTarget.exerciseId
            },
            onDismiss = { previewExerciseMenuDialog = false },
        )
    }
    if (previewAddExerciseDialog) {
        ExerciseAddDialog(
            catalog = previewCatalog,
            excludedExerciseIds = exercises.mapTo(mutableSetOf()) { it.exerciseId },
            trainingDatesByExerciseId = previewCatalog.associate { it.id to it.trainingDates },
            serverUrl = "https://gymcoach7.sharteman.duckdns.org",
            busy = false,
            onConfirm = { added ->
                exercises = exercises + ProgramExerciseDto(
                    id = "preview-added-${added.id}",
                    workoutId = "preview-workout",
                    exerciseId = added.id,
                    order = exercises.size,
                    targetSets = 4,
                    targetRepsMin = 8,
                    targetRepsMax = 12,
                    targetRIR = 2,
                    restSec = added.defaultRestSec,
                    exercise = added,
                )
                previewSelectedIndex = exercises.lastIndex
                previewAddExerciseDialog = false
            },
            onDismiss = { previewAddExerciseDialog = false },
        )
    }
    if (previewReplacementDialog) {
        ExerciseReplacementDialog(
            currentExercise = previewTarget.exercise,
            catalog = previewCatalog,
            trainingDatesByExerciseId = previewCatalog.associate { it.id to it.trainingDates },
            serverUrl = "https://gymcoach7.sharteman.duckdns.org",
            loggedSetCount = sets.count { it.exerciseId == previewTarget.exerciseId && !it.deleted },
            busy = false,
            onConfirm = { replacement ->
                exercises = exercises.map { target ->
                    if (target.id == previewTarget.id) {
                        target.copy(exerciseId = replacement.id, exercise = replacement)
                    } else {
                        target
                    }
                }
                previewReplacementDialog = false
            },
            onDismiss = { previewReplacementDialog = false },
        )
    }
    previewDetailsExercise?.let { exercise ->
        ExerciseDetailsDialog(
            exercise = exercise,
            history = emptyList(),
            fallbackPerformance = previous.performance.copy(exerciseId = exercise.id),
            progressPoints = emptyList(),
            unit = "KG",
            serverUrl = "https://gymcoach7.sharteman.duckdns.org",
            onOpenProgress = {},
            onOpenHistory = { _, _ -> },
            onDismiss = { previewDetailsExerciseId = null },
            editableUserId = "preview-user",
            onUpdateExercise = onUpdateExercise,
            onExerciseUpdated = { updated ->
                exercises = exercises.map { target ->
                    if (target.exerciseId == updated.id) target.copy(exercise = updated) else target
                }
            },
        )
    }
}

private fun previewProgramExercise(
    id: String,
    name: String,
    muscleGroup: String,
    order: Int,
    targetSets: Int,
    targetRepsMin: Int,
    targetRepsMax: Int,
    targetRir: Int,
    restSec: Int,
    supersetGroup: Int? = null,
    equipmentType: String = "BARBELL",
): ProgramExerciseDto = ProgramExerciseDto(
    id = id,
    workoutId = "preview-workout",
    exerciseId = id,
    order = order,
    targetSets = targetSets,
    targetRepsMin = targetRepsMin,
    targetRepsMax = targetRepsMax,
    targetRIR = targetRir,
    restSec = restSec,
    supersetGroup = supersetGroup,
    exercise = ExerciseDto(
        id = id,
        userId = "preview-user",
        name = name,
        muscleGroup = muscleGroup,
        category = "STRENGTH",
        equipmentType = equipmentType,
    ),
)

private fun previewLocalSet(
    id: String,
    setNumber: Int,
    weight: Double,
    reps: Int,
    rir: Int,
): LocalSetEntity = LocalSetEntity(
    id = id,
    sessionId = "preview-session",
    exerciseId = "romanian-deadlift",
    setNumber = setNumber,
    weight = weight,
    reps = reps,
    rir = rir,
    completedAt = "2026-07-13T10:00:00Z",
)

@Composable
private fun NumericField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier,
    decimal: Boolean = false,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label) },
        keyboardOptions = KeyboardOptions(
            keyboardType = if (decimal) KeyboardType.Decimal else KeyboardType.Number,
        ),
        singleLine = true,
        modifier = modifier,
    )
}

@Composable
private fun PlannedSetCountDialog(
    totalSets: Int,
    minSets: Int,
    maxSets: Int,
    onDismiss: () -> Unit,
    onConfirm: (Int) -> Unit,
) {
    var selected by rememberSaveable(totalSets, minSets, maxSets) {
        mutableIntStateOf(totalSets.coerceIn(minSets, maxSets))
    }
    AlertDialog(
        modifier = Modifier.testTag("set-count-dialog"),
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.choose_set_count)) },
        text = {
            Column(
                modifier = Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(18.dp),
                ) {
                    FilledIconButton(
                        onClick = { selected -= 1 },
                        enabled = selected > minSets,
                        modifier = Modifier.size(54.dp),
                    ) {
                        Icon(Icons.Outlined.Remove, contentDescription = stringResource(R.string.decrease))
                    }
                    Text(
                        selected.toString(),
                        style = MaterialTheme.typography.displaySmall,
                        fontWeight = FontWeight.Bold,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.width(72.dp),
                    )
                    FilledIconButton(
                        onClick = { selected += 1 },
                        enabled = selected < maxSets,
                        modifier = Modifier.size(54.dp),
                    ) {
                        Icon(Icons.Outlined.Add, contentDescription = stringResource(R.string.increase))
                    }
                }
                Text(
                    stringResource(R.string.set_count_range, minSets, maxSets),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        },
        confirmButton = {
            TextButton(onClick = { onConfirm(selected) }) {
                Text(stringResource(R.string.save))
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) }
        },
    )
}

@Composable
private fun FinishDialog(onDismiss: () -> Unit, onFinish: (String?, Int?) -> Unit) {
    var notes by remember { mutableStateOf("") }
    var rpe by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.finish_workout)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                NumericField(
                    value = rpe,
                    onValueChange = { rpe = it },
                    label = stringResource(R.string.session_rpe),
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = notes,
                    onValueChange = { notes = it },
                    label = { Text(stringResource(R.string.notes)) },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    val parsedRpe = if (rpe.isBlank()) null else rpe.toIntOrNull() ?: return@TextButton
                    onFinish(notes.takeIf { it.isNotBlank() }, parsedRpe)
                },
                enabled = rpe.isBlank() || rpe.toIntOrNull() in 1..10,
            ) {
                Text(stringResource(R.string.save))
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
    )
}

private fun formatWeight(value: Double): String = if (value % 1.0 == 0.0) {
    value.toInt().toString()
} else {
    String.format(Locale.ROOT, "%.2f", value).trimEnd('0').trimEnd('.')
}

private fun isValidSetInput(weight: String, reps: String, rir: String, unit: String): Boolean {
    val parsedDisplayWeight = weight.replace(',', '.').toDoubleOrNull()
    val parsedWeight = parsedDisplayWeight?.let { fromDisplayWeight(it, unit) }
    val parsedReps = reps.toIntOrNull()
    val parsedRir = if (rir.isBlank()) null else rir.toIntOrNull() ?: return false
    return parsedWeight != null && parsedWeight.isFinite() && parsedWeight in 0.0..500.0 &&
        parsedReps in 1..100 && (parsedRir == null || parsedRir in 0..5)
}
