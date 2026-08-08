package org.sharteman.gymcoach.ui.programs

import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import kotlinx.coroutines.launch
import org.sharteman.gymcoach.R
import org.sharteman.gymcoach.data.errors.AppErrorContext
import org.sharteman.gymcoach.data.errors.AppErrorDataState
import org.sharteman.gymcoach.data.errors.AppErrorOperation
import org.sharteman.gymcoach.data.model.ExerciseDto
import org.sharteman.gymcoach.data.model.ProgramDto
import org.sharteman.gymcoach.data.model.ProgramExerciseDto
import org.sharteman.gymcoach.data.model.WorkoutDto
import org.sharteman.gymcoach.data.programs.ManagedProgramDto
import org.sharteman.gymcoach.data.programs.ProgramExerciseInput
import org.sharteman.gymcoach.data.programs.ProgramInput
import org.sharteman.gymcoach.data.programs.ProgramsCatalogDataSource
import org.sharteman.gymcoach.data.programs.ProgramsCatalogRepository
import org.sharteman.gymcoach.data.programs.WorkoutInput
import org.sharteman.gymcoach.ui.friendlyErrorMessage
import org.sharteman.gymcoach.ui.localization.exerciseDisplayName
import java.time.DayOfWeek
import java.time.format.TextStyle
import java.util.Locale

@Composable
fun ProgramsScreen(
    baseUrl: String,
    token: String,
    onBack: () -> Unit,
    onOpenWebPath: (String) -> Unit,
    initialProgramId: String? = null,
    initialWorkoutId: String? = null,
    initialProgram: ProgramDto? = null,
    onChanged: () -> Unit = {},
) {
    val repository = remember(baseUrl, token) { ProgramsCatalogRepository.remote(baseUrl, token) }
    var seedReady by remember(repository, initialProgram?.id) { mutableStateOf(initialProgram == null) }
    LaunchedEffect(repository, initialProgram) {
        initialProgram?.let { repository.seedActiveProgram(it) }
        seedReady = true
    }
    if (!seedReady) {
        LoadingRow()
        return
    }
    ProgramsScreen(
        dataSource = repository,
        onBack = onBack,
        onOpenWebPath = onOpenWebPath,
        initialProgramId = initialProgramId,
        initialWorkoutId = initialWorkoutId,
        onChanged = onChanged,
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProgramsScreen(
    dataSource: ProgramsCatalogDataSource,
    onBack: () -> Unit,
    onOpenWebPath: (String) -> Unit = {},
    initialProgramId: String? = null,
    initialWorkoutId: String? = null,
    onChanged: () -> Unit = {},
) {
    val context = LocalContext.current
    var selectedProgramId by remember(initialProgramId) { mutableStateOf(initialProgramId) }
    if (selectedProgramId != null) {
        ProgramDetailScreen(
            dataSource = dataSource,
            programId = selectedProgramId!!,
            initialWorkoutId = initialWorkoutId,
            onBack = {
                if (initialProgramId != null) onBack()
                else selectedProgramId = null
            },
            onChanged = onChanged,
        )
        return
    }

    val scope = rememberCoroutineScope()
    var programs by remember { mutableStateOf<List<ManagedProgramDto>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var editProgram by remember { mutableStateOf<ManagedProgramDto?>(null) }
    var creating by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf<ManagedProgramDto?>(null) }

    fun reload() {
        scope.launch {
            loading = true
            error = null
            runCatching { dataSource.listPrograms() }
                .onSuccess { programs = it }
                .onFailure { error = context.programFailure(it, AppErrorOperation.LOAD) }
            loading = false
        }
    }
    LaunchedEffect(dataSource) { reload() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.programs_title)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = null)
                    }
                },
                actions = {
                    IconButton(onClick = { creating = true }, modifier = Modifier.testTag("program-create")) {
                        Icon(Icons.Outlined.Add, contentDescription = stringResource(R.string.program_create))
                    }
                },
            )
        },
    ) { insets ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(insets).testTag("programs-list"),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { onOpenWebPath("/programs/new/template") }) {
                        Text(stringResource(R.string.program_templates_web))
                    }
                    OutlinedButton(onClick = { onOpenWebPath("/programs/generate") }) {
                        Text(stringResource(R.string.program_generate_web))
                    }
                }
            }
            if (loading) {
                item { LoadingRow() }
            } else if (error != null) {
                item { ErrorCard(error, ::reload) }
            } else if (programs.isEmpty()) {
                item {
                    Card {
                        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(stringResource(R.string.programs_empty), style = MaterialTheme.typography.titleMedium)
                            Text(
                                stringResource(R.string.programs_empty_hint),
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Button(onClick = { creating = true }) { Text(stringResource(R.string.program_create)) }
                        }
                    }
                }
            } else {
                items(programs, key = { it.id }) { program ->
                    ProgramCard(
                        program = program,
                        onOpen = { selectedProgramId = program.id },
                        onEdit = { editProgram = program },
                        onDelete = { deleting = program },
                        onToggleActive = {
                            scope.launch {
                                runCatching { dataSource.setProgramActive(program.id, !program.isActive) }
                                    .onSuccess { reload() }
                                    .onFailure { error = context.programFailure(it, AppErrorOperation.SAVE) }
                            }
                        },
                    )
                }
            }
        }
    }

    if (creating || editProgram != null) {
        ProgramEditorDialog(
            program = editProgram,
            onDismiss = { creating = false; editProgram = null },
            onSave = { input ->
                scope.launch {
                    runCatching {
                        editProgram?.let { dataSource.updateProgram(it.id, input) }
                            ?: dataSource.createProgram(input)
                    }.onSuccess {
                        creating = false
                        editProgram = null
                        reload()
                    }.onFailure { error = context.programFailure(it, AppErrorOperation.SAVE) }
                }
            },
        )
    }
    deleting?.let { program ->
        ConfirmDeleteDialog(
            message = stringResource(R.string.confirm_program_delete, program.name),
            onDismiss = { deleting = null },
            onConfirm = {
                deleting = null
                scope.launch {
                    runCatching { dataSource.deleteProgram(program.id) }
                        .onSuccess { reload() }
                        .onFailure { error = context.programFailure(it, AppErrorOperation.DELETE) }
                }
            },
        )
    }
}

@Composable
private fun ProgramCard(
    program: ManagedProgramDto,
    onOpen: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
    onToggleActive: () -> Unit,
) {
    var menuOpen by remember { mutableStateOf(false) }
    Card(
        onClick = onOpen,
        modifier = Modifier.fillMaxWidth().testTag("program-${program.id}"),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(program.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    Text(program.phase, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (program.isActive) {
                    AssistChip(
                        onClick = onToggleActive,
                        label = { Text(stringResource(R.string.program_active)) },
                        leadingIcon = { Icon(Icons.Outlined.CheckCircle, contentDescription = null) },
                    )
                }
                IconButton(onClick = { menuOpen = true }) {
                    Icon(Icons.Outlined.MoreVert, contentDescription = null)
                }
                DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                    DropdownMenuItem(
                        text = { Text(if (program.isActive) stringResource(R.string.program_deactivate) else stringResource(R.string.program_activate)) },
                        onClick = { menuOpen = false; onToggleActive() },
                    )
                    DropdownMenuItem(
                        text = { Text(stringResource(R.string.program_edit)) },
                        leadingIcon = { Icon(Icons.Outlined.Edit, contentDescription = null) },
                        onClick = { menuOpen = false; onEdit() },
                    )
                    DropdownMenuItem(
                        text = { Text(stringResource(R.string.program_delete)) },
                        leadingIcon = { Icon(Icons.Outlined.Delete, contentDescription = null) },
                        onClick = { menuOpen = false; onDelete() },
                    )
                }
            }
            program.description?.takeIf { it.isNotBlank() }?.let {
                Text(it, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    stringResource(R.string.program_workouts_count, program.counts.workouts),
                    style = MaterialTheme.typography.labelMedium,
                )
                Text(
                    stringResource(R.string.program_sessions_count, program.counts.sessions),
                    style = MaterialTheme.typography.labelMedium,
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ProgramDetailScreen(
    dataSource: ProgramsCatalogDataSource,
    programId: String,
    initialWorkoutId: String? = null,
    onBack: () -> Unit,
    onChanged: () -> Unit = {},
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var program by remember { mutableStateOf<ManagedProgramDto?>(null) }
    var catalog by remember { mutableStateOf<List<ExerciseDto>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var editingProgram by remember { mutableStateOf(false) }
    var editingWorkout by remember { mutableStateOf<WorkoutDto?>(null) }
    var creatingWorkout by remember { mutableStateOf(false) }
    var deletingWorkout by remember { mutableStateOf<WorkoutDto?>(null) }
    var exerciseTarget by remember { mutableStateOf<Pair<WorkoutDto, ProgramExerciseDto?>?>(null) }
    var deletingExercise by remember { mutableStateOf<ProgramExerciseDto?>(null) }
    var initialWorkoutConsumed by remember(initialWorkoutId) { mutableStateOf(false) }

    fun reload() {
        scope.launch {
            loading = true
            error = null
            runCatching {
                val loadedProgram = dataSource.getProgram(programId)
                val loadedCatalog = dataSource.listExercises()
                loadedProgram to loadedCatalog
            }.onSuccess { (loadedProgram, loadedCatalog) ->
                program = loadedProgram
                catalog = loadedCatalog
            }.onFailure { error = context.programFailure(it, AppErrorOperation.LOAD) }
            loading = false
        }
    }
    LaunchedEffect(programId) { reload() }
    LaunchedEffect(initialWorkoutId, program?.id, initialWorkoutConsumed) {
        if (initialWorkoutId != null && !initialWorkoutConsumed && program != null) {
            editingWorkout = program?.workouts?.firstOrNull { it.id == initialWorkoutId }
            initialWorkoutConsumed = true
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(program?.name ?: stringResource(R.string.programs_title)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = null)
                    }
                },
                actions = {
                    if (program != null) {
                        IconButton(onClick = { editingProgram = true }) {
                            Icon(Icons.Outlined.Edit, contentDescription = stringResource(R.string.program_edit))
                        }
                    }
                },
            )
        },
    ) { insets ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(insets).testTag("program-detail"),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (loading) item { LoadingRow() }
            else if (error != null) item { ErrorCard(error, ::reload) }
            else program?.let { current ->
                item {
                    Card {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(current.name, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                                    Text(current.phase, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                                Switch(
                                    checked = current.isActive,
                                    onCheckedChange = { active ->
                                        scope.launch {
                                            runCatching { dataSource.setProgramActive(current.id, active) }
                                                .onSuccess { onChanged(); reload() }
                                                .onFailure {
                                                    error = context.programFailure(it, AppErrorOperation.SAVE)
                                                }
                                        }
                                    },
                                )
                            }
                            current.description?.takeIf { it.isNotBlank() }?.let { Text(it) }
                        }
                    }
                }
                item {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            stringResource(R.string.program_workouts),
                            modifier = Modifier.weight(1f),
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Bold,
                        )
                        FilledTonalButton(onClick = { creatingWorkout = true }) {
                            Icon(Icons.Outlined.Add, contentDescription = null)
                            Spacer(Modifier.width(6.dp))
                            Text(stringResource(R.string.program_workout_add))
                        }
                    }
                }
                items(current.workouts, key = { it.id }) { workout ->
                    WorkoutCard(
                        workout = workout,
                        onEdit = { editingWorkout = workout },
                        onDelete = { deletingWorkout = workout },
                        onAddExercise = { exerciseTarget = workout to null },
                        onEditExercise = { exerciseTarget = workout to it },
                        onDeleteExercise = { deletingExercise = it },
                    )
                }
            }
        }
    }

    if (editingProgram && program != null) {
        ProgramEditorDialog(
            program = program,
            onDismiss = { editingProgram = false },
            onSave = { input ->
                scope.launch {
                    runCatching { dataSource.updateProgram(programId, input) }
                        .onSuccess { editingProgram = false; onChanged(); reload() }
                        .onFailure { error = context.programFailure(it, AppErrorOperation.SAVE) }
                }
            },
        )
    }
    if (creatingWorkout || editingWorkout != null) {
        WorkoutEditorDialog(
            workout = editingWorkout,
            onDismiss = { creatingWorkout = false; editingWorkout = null },
            onSave = { input ->
                scope.launch {
                    runCatching {
                        editingWorkout?.let { dataSource.updateWorkout(it.id, input) }
                            ?: dataSource.createWorkout(programId, input)
                    }.onSuccess {
                        creatingWorkout = false
                        editingWorkout = null
                        onChanged()
                        reload()
                    }.onFailure { error = context.programFailure(it, AppErrorOperation.SAVE) }
                }
            },
        )
    }
    exerciseTarget?.let { (workout, existing) ->
        ProgramExerciseEditorDialog(
            catalog = catalog,
            existing = existing,
            onDismiss = { exerciseTarget = null },
            onSave = { input ->
                scope.launch {
                    runCatching {
                        existing?.let { dataSource.updateProgramExercise(it.id, input) }
                            ?: dataSource.createProgramExercise(workout.id, input)
                    }.onSuccess { exerciseTarget = null; onChanged(); reload() }
                        .onFailure { error = context.programFailure(it, AppErrorOperation.SAVE) }
                }
            },
        )
    }
    deletingWorkout?.let { workout ->
        ConfirmDeleteDialog(
            message = stringResource(R.string.confirm_workout_delete, workout.name),
            onDismiss = { deletingWorkout = null },
            onConfirm = {
                deletingWorkout = null
                scope.launch {
                    runCatching { dataSource.deleteWorkout(workout.id) }
                        .onSuccess { onChanged(); reload() }
                        .onFailure { error = context.programFailure(it, AppErrorOperation.DELETE) }
                }
            },
        )
    }
    deletingExercise?.let { target ->
        ConfirmDeleteDialog(
            message = stringResource(
                R.string.confirm_program_exercise_delete,
                exerciseDisplayName(target.exercise.name),
            ),
            onDismiss = { deletingExercise = null },
            onConfirm = {
                deletingExercise = null
                scope.launch {
                    runCatching { dataSource.deleteProgramExercise(target.id) }
                        .onSuccess { onChanged(); reload() }
                        .onFailure { error = context.programFailure(it, AppErrorOperation.DELETE) }
                }
            },
        )
    }
}

@Composable
private fun WorkoutCard(
    workout: WorkoutDto,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
    onAddExercise: () -> Unit,
    onEditExercise: (ProgramExerciseDto) -> Unit,
    onDeleteExercise: (ProgramExerciseDto) -> Unit,
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column {
            Row(
                modifier = Modifier.fillMaxWidth().padding(14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(workout.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    workout.dayOfWeek?.let {
                        Text(
                            stringResource(
                                R.string.program_day_of_week_value,
                                localizedWeekdayName(it),
                            ),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                IconButton(onClick = onEdit) { Icon(Icons.Outlined.Edit, contentDescription = null) }
                IconButton(onClick = onDelete) { Icon(Icons.Outlined.Delete, contentDescription = null) }
            }
            workout.exercises.forEach { target ->
                HorizontalDivider()
                Row(
                    modifier = Modifier.fillMaxWidth().padding(14.dp).testTag("program-target-${target.id}"),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text(
                            exerciseDisplayName(target.exercise.name),
                            fontWeight = FontWeight.SemiBold,
                        )
                        Text(
                            stringResource(
                                R.string.program_targets_summary,
                                target.targetSets,
                                target.targetRepsMin,
                                target.targetRepsMax,
                                target.targetRIR,
                                target.restSec,
                            ),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        val extras = buildList {
                            if (target.targetDropSets > 0) add("${stringResource(R.string.program_drop_sets)}: ${target.targetDropSets}")
                            target.tempo?.takeIf { it.isNotBlank() }?.let { add("${stringResource(R.string.program_tempo)}: $it") }
                            target.supersetGroup?.let { add("${stringResource(R.string.program_superset_group)}: $it") }
                        }
                        if (extras.isNotEmpty()) Text(extras.joinToString(" • "), style = MaterialTheme.typography.labelSmall)
                    }
                    IconButton(onClick = { onEditExercise(target) }) {
                        Icon(Icons.Outlined.Edit, contentDescription = null)
                    }
                    IconButton(onClick = { onDeleteExercise(target) }) {
                        Icon(Icons.Outlined.Delete, contentDescription = null)
                    }
                }
            }
            TextButton(onClick = onAddExercise, modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)) {
                Icon(Icons.Outlined.Add, contentDescription = null)
                Spacer(Modifier.width(6.dp))
                Text(stringResource(R.string.program_exercise_add))
            }
        }
    }
}

@Composable
private fun ProgramEditorDialog(
    program: ManagedProgramDto?,
    onDismiss: () -> Unit,
    onSave: (ProgramInput) -> Unit,
) {
    var name by remember(program?.id) { mutableStateOf(program?.name.orEmpty()) }
    var phase by remember(program?.id) { mutableStateOf(program?.phase.orEmpty()) }
    var description by remember(program?.id) { mutableStateOf(program?.description.orEmpty()) }
    val valid = name.isNotBlank() && phase.isNotBlank()
    EditorDialog(
        title = stringResource(if (program == null) R.string.program_create else R.string.program_edit),
        onDismiss = onDismiss,
        onSave = { onSave(ProgramInput(name.trim(), phase.trim(), description.trim().ifBlank { null })) },
        saveEnabled = valid,
    ) {
        OutlinedTextField(name, { name = it }, label = { Text(stringResource(R.string.program_name)) }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(phase, { phase = it }, label = { Text(stringResource(R.string.program_phase)) }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(
            description,
            { description = it },
            label = { Text(stringResource(R.string.program_description)) },
            modifier = Modifier.fillMaxWidth(),
            minLines = 3,
        )
    }
}

@Composable
private fun WorkoutEditorDialog(
    workout: WorkoutDto?,
    onDismiss: () -> Unit,
    onSave: (WorkoutInput) -> Unit,
) {
    var name by remember(workout?.id) { mutableStateOf(workout?.name.orEmpty()) }
    var day by remember(workout?.id) { mutableStateOf(workout?.dayOfWeek) }
    var dayMenuOpen by remember(workout?.id) { mutableStateOf(false) }
    val valid = name.isNotBlank()
    EditorDialog(
        title = stringResource(if (workout == null) R.string.program_workout_add else R.string.program_workout_edit),
        onDismiss = onDismiss,
        onSave = { onSave(WorkoutInput(name.trim(), day)) },
        saveEnabled = valid,
    ) {
        OutlinedTextField(name, { name = it }, label = { Text(stringResource(R.string.program_workout_name)) }, modifier = Modifier.fillMaxWidth())
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                stringResource(R.string.program_day_of_week),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Box(Modifier.fillMaxWidth()) {
                OutlinedButton(
                    onClick = { dayMenuOpen = true },
                    modifier = Modifier.fillMaxWidth().testTag("program-workout-day"),
                ) {
                    Text(
                        day?.let(::localizedWeekdayName)
                            ?: stringResource(R.string.program_day_not_set),
                    )
                }
                DropdownMenu(
                    expanded = dayMenuOpen,
                    onDismissRequest = { dayMenuOpen = false },
                ) {
                    DropdownMenuItem(
                        text = { Text(stringResource(R.string.program_day_not_set)) },
                        onClick = { day = null; dayMenuOpen = false },
                    )
                    (1..7).forEach { weekday ->
                        DropdownMenuItem(
                            text = { Text(localizedWeekdayName(weekday)) },
                            onClick = { day = weekday; dayMenuOpen = false },
                        )
                    }
                }
            }
        }
    }
}

private fun localizedWeekdayName(day: Int): String =
    DayOfWeek.of(day).getDisplayName(TextStyle.FULL, Locale.getDefault())

@Composable
private fun ProgramExerciseEditorDialog(
    catalog: List<ExerciseDto>,
    existing: ProgramExerciseDto?,
    onDismiss: () -> Unit,
    onSave: (ProgramExerciseInput) -> Unit,
) {
    var selectedId by remember(existing?.id) { mutableStateOf(existing?.exerciseId.orEmpty()) }
    var selectorOpen by remember { mutableStateOf(false) }
    var sets by remember(existing?.id) { mutableStateOf((existing?.targetSets ?: 4).toString()) }
    var dropSets by remember(existing?.id) { mutableStateOf((existing?.targetDropSets ?: 0).toString()) }
    var repsMin by remember(existing?.id) { mutableStateOf((existing?.targetRepsMin ?: 8).toString()) }
    var repsMax by remember(existing?.id) { mutableStateOf((existing?.targetRepsMax ?: 10).toString()) }
    var rir by remember(existing?.id) { mutableStateOf((existing?.targetRIR ?: 2).toString()) }
    var rest by remember(existing?.id) { mutableStateOf((existing?.restSec ?: 90).toString()) }
    var tempo by remember(existing?.id) { mutableStateOf(existing?.tempo.orEmpty()) }
    var notes by remember(existing?.id) { mutableStateOf(existing?.notes.orEmpty()) }
    var superset by remember(existing?.id) { mutableStateOf(existing?.supersetGroup?.toString().orEmpty()) }
    val selected = catalog.firstOrNull { it.id == selectedId }
    val values = listOf(sets, dropSets, repsMin, repsMax, rir, rest).map { it.toIntOrNull() }
    val supersetValue = superset.toIntOrNull()
    val valid = selectedId.isNotBlank() && values.all { it != null } &&
        (values[0] ?: 0) in 1..20 && (values[1] ?: -1) in 0..10 &&
        (values[2] ?: 0) in 1..50 && (values[3] ?: 0) in (values[2] ?: 1)..50 &&
        (values[4] ?: -1) in 0..5 && (values[5] ?: 0) in 15..600 &&
        (superset.isBlank() || supersetValue in 1..9)

    EditorDialog(
        title = stringResource(if (existing == null) R.string.program_exercise_add else R.string.program_exercise_edit),
        onDismiss = onDismiss,
        onSave = {
            onSave(
                ProgramExerciseInput(
                    exerciseId = selectedId,
                    targetSets = sets.toInt(),
                    targetDropSets = dropSets.toInt(),
                    targetRepsMin = repsMin.toInt(),
                    targetRepsMax = repsMax.toInt(),
                    targetRIR = rir.toInt(),
                    restSec = rest.toInt(),
                    autoregulationMode = existing?.autoregulationMode ?: "PRESERVE_RIR",
                    fatigueRate = existing?.fatigueRate,
                    loadAdjustmentPct = existing?.loadAdjustmentPct,
                    tempo = tempo.trim().ifBlank { null },
                    notes = notes.trim().ifBlank { null },
                    supersetGroup = supersetValue,
                ),
            )
        },
        saveEnabled = valid,
    ) {
        Column {
            OutlinedButton(onClick = { selectorOpen = true }, modifier = Modifier.fillMaxWidth()) {
                Text(selected?.name ?: stringResource(R.string.program_choose_exercise))
            }
            DropdownMenu(expanded = selectorOpen, onDismissRequest = { selectorOpen = false }) {
                catalog.forEach { exercise ->
                    DropdownMenuItem(
                        text = { Text(exerciseDisplayName(exercise.name)) },
                        onClick = {
                            selectedId = exercise.id
                            if (existing == null) rest = exercise.defaultRestSec.toString()
                            selectorOpen = false
                        },
                    )
                }
            }
        }
        NumericPair(sets, { sets = digits(it) }, R.string.program_sets, dropSets, { dropSets = digits(it) }, R.string.program_drop_sets)
        NumericPair(repsMin, { repsMin = digits(it) }, R.string.program_reps_min, repsMax, { repsMax = digits(it) }, R.string.program_reps_max)
        NumericPair(rir, { rir = digits(it) }, R.string.rir, rest, { rest = digits(it) }, R.string.program_rest_seconds)
        NumericPair(tempo, { tempo = it.take(20) }, R.string.program_tempo, superset, { superset = digits(it) }, R.string.program_superset_group)
        OutlinedTextField(notes, { notes = it.take(2000) }, label = { Text(stringResource(R.string.program_notes)) }, modifier = Modifier.fillMaxWidth(), minLines = 2)
    }
}

@Composable
private fun NumericPair(
    first: String,
    onFirst: (String) -> Unit,
    firstLabel: Int,
    second: String,
    onSecond: (String) -> Unit,
    secondLabel: Int,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(first, onFirst, label = { Text(stringResource(firstLabel)) }, modifier = Modifier.weight(1f), singleLine = true)
        OutlinedTextField(second, onSecond, label = { Text(stringResource(secondLabel)) }, modifier = Modifier.weight(1f), singleLine = true)
    }
}

@Composable
private fun EditorDialog(
    title: String,
    onDismiss: () -> Unit,
    onSave: () -> Unit,
    saveEnabled: Boolean,
    content: @Composable ColumnScope.() -> Unit,
) {
    Dialog(onDismissRequest = onDismiss) {
        Card(shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth()) {
            LazyColumn(
                modifier = Modifier.fillMaxWidth().padding(18.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                item { Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold) }
                item { Column(verticalArrangement = Arrangement.spacedBy(10.dp), content = content) }
                item {
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                        TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) }
                        Spacer(Modifier.width(8.dp))
                        Button(onClick = onSave, enabled = saveEnabled) { Text(stringResource(R.string.save)) }
                    }
                }
            }
        }
    }
}

@Composable
internal fun ConfirmDeleteDialog(message: String, onDismiss: () -> Unit, onConfirm: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.confirm_delete_title)) },
        text = { Text(message) },
        confirmButton = { Button(onClick = onConfirm) { Text(stringResource(R.string.delete)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
    )
}

@Composable
internal fun LoadingRow() {
    Row(Modifier.fillMaxWidth().padding(32.dp), horizontalArrangement = Arrangement.Center) {
        CircularProgressIndicator()
    }
}

@Composable
internal fun ErrorCard(message: String?, onRetry: () -> Unit) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer)) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(message ?: stringResource(R.string.programs_save_failed), color = MaterialTheme.colorScheme.onErrorContainer)
            OutlinedButton(onClick = onRetry) { Text(stringResource(R.string.retry)) }
        }
    }
}

private fun digits(value: String): String = value.filter(Char::isDigit).take(3)

private fun Context.programFailure(error: Throwable, operation: AppErrorOperation): String =
    friendlyErrorMessage(
        error,
        AppErrorContext(
            operation = operation,
            dataState = when (operation) {
                AppErrorOperation.LOAD -> AppErrorDataState.SAVED_LOCALLY
                else -> AppErrorDataState.UNKNOWN
            },
        ),
    )
