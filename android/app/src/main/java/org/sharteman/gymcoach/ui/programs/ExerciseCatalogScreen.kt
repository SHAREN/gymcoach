package org.sharteman.gymcoach.ui.programs

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
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
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.EventAvailable
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import coil.compose.AsyncImage
import kotlinx.coroutines.launch
import org.sharteman.gymcoach.R
import org.sharteman.gymcoach.data.media.ExerciseMediaCatalog
import org.sharteman.gymcoach.data.model.ExerciseDto
import org.sharteman.gymcoach.data.model.ExerciseHistorySessionDto
import org.sharteman.gymcoach.data.model.MobileProgressPointDto
import org.sharteman.gymcoach.data.programs.ExerciseInput
import org.sharteman.gymcoach.data.programs.ProgramsCatalogDataSource
import org.sharteman.gymcoach.data.programs.ProgramsCatalogRepository
import org.sharteman.gymcoach.ui.ExerciseDetailsDialog
import org.sharteman.gymcoach.ui.localization.equipmentTypeDisplayName
import org.sharteman.gymcoach.ui.localization.exerciseCategoryDisplayName
import org.sharteman.gymcoach.ui.localization.exerciseDisplayName
import org.sharteman.gymcoach.ui.localization.muscleGroupDisplayName

private val muscleGroups = listOf(
    "CHEST", "BACK_WIDTH", "BACK_THICKNESS", "SHOULDERS_FRONT", "SHOULDERS_LATERAL",
    "SHOULDERS_REAR", "BICEPS", "TRICEPS", "FOREARMS", "QUADS", "HAMSTRINGS",
    "GLUTES", "CALVES", "ABS", "LOWER_BACK", "OTHER",
)
private val categories = listOf("COMPOUND", "ISOLATION", "CARDIO")
private val equipmentTypes = listOf("DUMBBELL", "BARBELL", "MACHINE", "CABLE", "BODYWEIGHT", "CARDIO", "OTHER")

@Composable
fun ExerciseCatalogScreen(
    baseUrl: String,
    token: String,
    onBack: () -> Unit,
    historyByExerciseId: Map<String, List<ExerciseHistorySessionDto>> = emptyMap(),
    progressPointsByExerciseId: Map<String, List<MobileProgressPointDto>> = emptyMap(),
    unit: String = "KG",
    bodyweightKg: Double? = null,
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
    canFetchProgress: Boolean = true,
    onOpenProgress: ((String) -> Unit)? = null,
    onOpenHistory: ((String, String) -> Unit)? = null,
) {
    val scope = rememberCoroutineScope()
    var exercises by remember { mutableStateOf<List<ExerciseDto>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var query by remember { mutableStateOf("") }
    var muscle by remember { mutableStateOf<String?>(null) }
    var category by remember { mutableStateOf<String?>(null) }
    var editor by remember { mutableStateOf<ExerciseDto?>(null) }
    var creating by remember { mutableStateOf(false) }
    var detail by remember { mutableStateOf<ExerciseDto?>(null) }
    var deleting by remember { mutableStateOf<ExerciseDto?>(null) }

    fun reload() {
        scope.launch {
            loading = true
            error = null
            runCatching { dataSource.listExercises() }
                .onSuccess { exercises = it }
                .onFailure { error = it.message }
            loading = false
        }
    }
    LaunchedEffect(dataSource) { reload() }
    val filtered = remember(exercises, query, muscle, category) {
        filterCatalogExercises(exercises, query, muscle, category)
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
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    EnumFilterButton(
                        label = stringResource(
                            R.string.filter_muscle,
                            muscle?.let(::muscleGroupDisplayName)
                                ?: stringResource(R.string.filter_all),
                        ),
                        value = muscle,
                        values = muscleGroups,
                        displayValue = ::muscleGroupDisplayName,
                        onValue = { muscle = it },
                    )
                    EnumFilterButton(
                        label = stringResource(
                            R.string.filter_category,
                            category?.let(::exerciseCategoryDisplayName)
                                ?: stringResource(R.string.filter_all),
                        ),
                        value = category,
                        values = categories,
                        displayValue = ::exerciseCategoryDisplayName,
                        onValue = { category = it },
                    )
                }
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
                    onOpen = { detail = exercise },
                )
            }
        }
    }

    if (creating || editor != null) {
        ExerciseEditorDialog(
            exercise = editor,
            onDismiss = { creating = false; editor = null },
            onSave = { input ->
                scope.launch {
                    runCatching {
                        editor?.let { dataSource.updateExercise(it.id, input) }
                            ?: dataSource.createExercise(input)
                    }.onSuccess {
                        creating = false
                        editor = null
                        detail = null
                        reload()
                    }.onFailure { error = it.message }
                }
            },
        )
    }
    detail?.let { exercise ->
        ExerciseDetailsDialog(
            exercise = exercise,
            history = historyByExerciseId[exercise.id].orEmpty(),
            fallbackPerformance = null,
            progressPoints = progressPointsByExerciseId[exercise.id].orEmpty(),
            unit = unit,
            bodyweightKg = bodyweightKg,
            serverUrl = serverUrl,
            onDismiss = { detail = null },
            onOpenProgress = if (
                onOpenProgress != null &&
                (canFetchProgress || progressPointsByExerciseId.containsKey(exercise.id))
            ) {
                { exerciseId ->
                    detail = null
                    onOpenProgress(exerciseId)
                }
            } else null,
            onOpenHistory = onOpenHistory?.let { openHistory ->
                { sessionId, startedAt ->
                    detail = null
                    openHistory(sessionId, startedAt)
                }
            },
            onEdit = { detail = null; editor = exercise },
            onDelete = { detail = null; deleting = exercise },
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
                        .onFailure { error = it.message }
                }
            },
        )
    }
}

@Composable
private fun ExerciseCatalogCard(exercise: ExerciseDto, serverUrl: String, onOpen: () -> Unit) {
    val context = LocalContext.current
    val media = remember(exercise.name) {
        runCatching { ExerciseMediaCatalog.load(context).resolve(exercise.name) }.getOrNull()
    }
    val trainedDays = remember(exercise.trainingDates) {
        exerciseTrainingDayCount(exercise.trainingDates)
    }
    Card(onClick = onOpen, modifier = Modifier.fillMaxWidth().testTag("exercise-${exercise.id}")) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Surface(
                modifier = Modifier.size(72.dp),
                shape = RoundedCornerShape(10.dp),
                color = MaterialTheme.colorScheme.surfaceVariant,
            ) {
                if (media != null) {
                    AsyncImage(
                        model = media.frameUrl(serverUrl),
                        contentDescription = exerciseDisplayName(exercise.name),
                        contentScale = ContentScale.Fit,
                    )
                } else {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(Icons.Outlined.Image, contentDescription = null)
                    }
                }
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    exerciseDisplayName(exercise.name),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                )
                Row(
                    modifier = Modifier.testTag("exercise-${exercise.id}-trained-days"),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(5.dp),
                ) {
                    Icon(
                        Icons.Outlined.EventAvailable,
                        contentDescription = null,
                        modifier = Modifier.size(15.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        stringResource(R.string.exercise_trained_days, trainedDays),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Text(
                    muscleGroupDisplayName(exercise.muscleGroup),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    "${exerciseCategoryDisplayName(exercise.category)} • " +
                        equipmentTypeDisplayName(exercise.equipmentType),
                    style = MaterialTheme.typography.labelMedium,
                )
            }
        }
    }
}

@Composable
private fun ExerciseEditorDialog(
    exercise: ExerciseDto?,
    onDismiss: () -> Unit,
    onSave: (ExerciseInput) -> Unit,
) {
    var name by remember(exercise?.id) { mutableStateOf(exercise?.name.orEmpty()) }
    var muscle by remember(exercise?.id) { mutableStateOf(exercise?.muscleGroup ?: muscleGroups.first()) }
    var category by remember(exercise?.id) { mutableStateOf(exercise?.category ?: categories.first()) }
    var equipment by remember(exercise?.id) { mutableStateOf(exercise?.equipmentType ?: equipmentTypes.last()) }
    var rest by remember(exercise?.id) { mutableStateOf((exercise?.defaultRestSec ?: 90).toString()) }
    var notes by remember(exercise?.id) { mutableStateOf(exercise?.notes.orEmpty()) }
    var bodyweight by remember(exercise?.id) { mutableStateOf(exercise?.usesBodyweight ?: false) }
    val restValue = rest.toIntOrNull()
    val valid = name.isNotBlank() && restValue in 15..600

    Dialog(onDismissRequest = onDismiss) {
        Card(
            shape = RoundedCornerShape(16.dp),
            modifier = Modifier.fillMaxWidth().testTag("exercise-editor"),
        ) {
            LazyColumn(
                contentPadding = PaddingValues(18.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                item {
                    Text(
                        stringResource(if (exercise == null) R.string.exercise_create else R.string.exercise_edit),
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold,
                    )
                }
                item {
                    OutlinedTextField(
                        name,
                        { name = it.take(120) },
                        label = { Text(stringResource(R.string.exercise_name)) },
                        modifier = Modifier.fillMaxWidth().testTag("exercise-editor-name"),
                    )
                }
                item {
                    EnumPicker(
                        stringResource(R.string.exercise_muscle_group),
                        muscle,
                        muscleGroups,
                        ::muscleGroupDisplayName,
                    ) { muscle = it }
                }
                item {
                    EnumPicker(
                        stringResource(R.string.exercise_category),
                        category,
                        categories,
                        ::exerciseCategoryDisplayName,
                    ) { category = it }
                }
                item {
                    EnumPicker(
                        stringResource(R.string.exercise_equipment_type),
                        equipment,
                        equipmentTypes,
                        ::equipmentTypeDisplayName,
                    ) { equipment = it }
                }
                item {
                    OutlinedTextField(
                        rest,
                        { rest = it.filter(Char::isDigit).take(3) },
                        label = { Text(stringResource(R.string.exercise_default_rest)) },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                item {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked = bodyweight, onCheckedChange = { bodyweight = it })
                        Text(stringResource(R.string.exercise_bodyweight))
                    }
                }
                item {
                    OutlinedTextField(
                        notes,
                        { notes = it.take(2000) },
                        label = { Text(stringResource(R.string.program_notes)) },
                        modifier = Modifier.fillMaxWidth(),
                        minLines = 3,
                    )
                }
                item {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                        TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) }
                        Spacer(Modifier.width(8.dp))
                        Button(
                            enabled = valid,
                            onClick = {
                                onSave(
                                    ExerciseInput(
                                        name = name.trim(),
                                        muscleGroup = muscle,
                                        category = category,
                                        defaultRestSec = restValue!!,
                                        notes = notes.trim().ifBlank { null },
                                        usesBodyweight = bodyweight,
                                        equipmentType = equipment,
                                    ),
                                )
                            },
                        ) { Text(stringResource(R.string.save)) }
                    }
                }
            }
        }
    }
}

@Composable
private fun EnumPicker(
    label: String,
    value: String,
    values: List<String>,
    displayValue: (String) -> String,
    onValue: (String) -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    Column {
        Text(label, style = MaterialTheme.typography.labelMedium)
        OutlinedButton(onClick = { open = true }, modifier = Modifier.fillMaxWidth()) {
            Text(displayValue(value))
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            values.forEach { option ->
                DropdownMenuItem(
                    text = { Text(displayValue(option)) },
                    onClick = { open = false; onValue(option) },
                )
            }
        }
    }
}

@Composable
private fun EnumFilterButton(
    label: String,
    value: String?,
    values: List<String>,
    displayValue: (String) -> String,
    onValue: (String?) -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    Column {
        OutlinedButton(onClick = { open = true }) { Text(label, maxLines = 1, overflow = TextOverflow.Ellipsis) }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(
                text = { Text(stringResource(R.string.filter_all)) },
                onClick = { open = false; onValue(null) },
            )
            values.forEach { option ->
                DropdownMenuItem(
                    text = { Text(displayValue(option)) },
                    onClick = { open = false; onValue(option) },
                )
            }
        }
    }
}

internal fun filterCatalogExercises(
    exercises: List<ExerciseDto>,
    query: String,
    muscleGroup: String?,
    category: String?,
    language: String = java.util.Locale.getDefault().language,
): List<ExerciseDto> = exercises.filter { exercise ->
    (query.isBlank() || exercise.name.contains(query.trim(), ignoreCase = true) ||
        exerciseDisplayName(exercise.name, language).contains(query.trim(), ignoreCase = true)) &&
        (muscleGroup == null || exercise.muscleGroup == muscleGroup) &&
        (category == null || exercise.category == category)
}
