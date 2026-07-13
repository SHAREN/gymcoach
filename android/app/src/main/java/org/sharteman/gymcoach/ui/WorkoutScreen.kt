package org.sharteman.gymcoach.ui

import androidx.compose.foundation.basicMarquee
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Flag
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.sharteman.gymcoach.R
import org.sharteman.gymcoach.data.local.LocalSetEntity
import org.sharteman.gymcoach.data.model.BootstrapResponse
import org.sharteman.gymcoach.data.model.ProgramExerciseDto
import org.sharteman.gymcoach.data.repository.GymCoachRepository
import org.sharteman.gymcoach.training.constraintsFor
import org.sharteman.gymcoach.training.recommendNextSet
import java.time.Duration
import java.time.Instant
import java.util.Locale
import kotlin.math.max

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WorkoutScreen(
    repository: GymCoachRepository,
    sessionId: String,
    bootstrap: BootstrapResponse?,
    onExit: () -> Unit,
) {
    val session by repository.observeSession(sessionId).collectAsState(initial = null)
    val allSets by repository.observeSets(sessionId).collectAsState(initial = emptyList())
    val workout = remember(bootstrap, session?.workoutId) {
        bootstrap?.activeProgram?.workouts?.firstOrNull { it.id == session?.workoutId }
            ?: bootstrap?.openSessions?.firstOrNull { it.id == sessionId }?.workout
    }
    val scope = rememberCoroutineScope()
    var selectedIndex by rememberSaveable { mutableIntStateOf(0) }
    var restEndsAt by rememberSaveable { mutableLongStateOf(0L) }
    var restRemaining by remember { mutableIntStateOf(0) }
    var finishDialog by remember { mutableStateOf(false) }
    var editSet by remember { mutableStateOf<LocalSetEntity?>(null) }

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
    if (selectedIndex !in exercises.indices) selectedIndex = 0
    val current = exercises.getOrNull(selectedIndex) ?: return
    val returnRecommendation = bootstrap?.returnRecommendationsByWorkout
        ?.get(workout.id)
        ?.get(current.id)
    val target = current.copy(
        targetSets = returnRecommendation?.targetSets ?: current.targetSets,
        targetDropSets = if (returnRecommendation?.mode != null && returnRecommendation.mode != "normal") 0 else current.targetDropSets,
        targetRIR = returnRecommendation?.targetRIR ?: current.targetRIR,
    )
    val currentSets = allSets.filter { it.exerciseId == current.exerciseId && !it.deleted }
    val lastWorking = currentSets.lastOrNull { !it.isWarmup && !it.isDropSet }
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
    val gym = bootstrap?.gyms?.firstOrNull { it.id == session?.gymId }
    val recommendation = recommendNextSet(
        programExercise = target,
        completedSets = currentSets,
        recoverySec = recoverySec,
        sameMuscleSuperset = sameMuscleSuperset,
        allowLoadIncrease = bootstrap?.profile?.deloadActive != true && !readinessBlocksIncrease,
        maxWeight = returnRecommendation?.weightCeiling,
        constraints = constraintsFor(target, gym),
    )

    var weightText by rememberSaveable(current.id) { mutableStateOf("") }
    var repsText by rememberSaveable(current.id) { mutableStateOf("") }
    var rirText by rememberSaveable(current.id) { mutableStateOf(target.targetRIR.toString()) }
    var notesText by rememberSaveable(current.id) { mutableStateOf("") }

    LaunchedEffect(current.id, currentSets.size, recommendation) {
        val lastPerformance = bootstrap?.lastPerformances?.get(current.exerciseId)
        val initialWeight = recommendation?.weight
            ?: returnRecommendation?.suggestedWeight
            ?: lastPerformance?.maxWeight
        if (initialWeight != null) weightText = formatWeight(initialWeight)
        repsText = (recommendation?.reps ?: target.targetRepsMin).toString()
        rirText = (recommendation?.rir ?: target.targetRIR).toString()
    }

    LaunchedEffect(restEndsAt) {
        while (restEndsAt > System.currentTimeMillis()) {
            restRemaining = max(0, ((restEndsAt - System.currentTimeMillis() + 999) / 1000).toInt())
            delay(250)
        }
        restRemaining = 0
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(workout.name, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = {
                    IconButton(onClick = onExit) {
                        Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = null)
                    }
                },
                actions = {
                    IconButton(onClick = { finishDialog = true }) {
                        Icon(Icons.Outlined.Flag, contentDescription = stringResource(R.string.finish_workout))
                    }
                },
            )
        },
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                ExerciseStrip(
                    exercises = exercises,
                    selectedIndex = selectedIndex,
                    completedExerciseIds = allSets.groupBy { it.exerciseId }
                        .filterValues { sets -> sets.count { !it.isWarmup && !it.isDropSet && !it.deleted } >= exercises.first { pe -> pe.exerciseId == sets.first().exerciseId }.targetSets }
                        .keys,
                    onSelect = { selectedIndex = it },
                )
            }
            item {
                Column(Modifier.padding(horizontal = 16.dp)) {
                    Text(
                        current.exercise.name,
                        style = MaterialTheme.typography.titleLarge,
                        maxLines = 1,
                        modifier = Modifier.basicMarquee(),
                    )
                    Text(
                        "${target.targetSets} x ${target.targetRepsMin}-${target.targetRepsMax} · RIR ${target.targetRIR}",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            if (recommendation != null) {
                item {
                    Card(
                        shape = RoundedCornerShape(8.dp),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                    ) {
                        Column(Modifier.padding(12.dp)) {
                            Text(stringResource(R.string.next_set), style = MaterialTheme.typography.labelLarge)
                            Text("${formatWeight(recommendation.weight)} kg × ${recommendation.reps} · RIR ${recommendation.rir}")
                            if (recommendation.confidence == "low") {
                                Text(
                                    stringResource(R.string.recommendation_low_confidence),
                                    style = MaterialTheme.typography.bodySmall,
                                )
                            }
                        }
                    }
                }
            }
            items(currentSets, key = { it.id }) { set ->
                SetRow(set = set, onEdit = { editSet = set }, onDelete = {
                    scope.launch { repository.deleteSet(set.id) }
                })
            }
            item {
                Column(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        NumericField(
                            value = weightText,
                            onValueChange = { weightText = it },
                            label = stringResource(R.string.weight),
                            decimal = true,
                            modifier = Modifier.weight(1.25f),
                        )
                        NumericField(
                            value = repsText,
                            onValueChange = { repsText = it },
                            label = stringResource(R.string.reps),
                            modifier = Modifier.weight(1f),
                        )
                        NumericField(
                            value = rirText,
                            onValueChange = { rirText = it },
                            label = stringResource(R.string.rir),
                            modifier = Modifier.weight(0.8f),
                        )
                    }
                    OutlinedTextField(
                        value = notesText,
                        onValueChange = { notesText = it },
                        label = { Text(stringResource(R.string.notes)) },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Button(
                        onClick = {
                            val weight = weightText.replace(',', '.').toDoubleOrNull() ?: return@Button
                            val reps = repsText.toIntOrNull() ?: return@Button
                            val rir = if (rirText.isBlank()) null else rirText.toIntOrNull() ?: return@Button
                            scope.launch {
                                repository.addSet(
                                    sessionId = sessionId,
                                    exerciseId = current.exerciseId,
                                    weight = weight,
                                    reps = reps,
                                    rir = rir,
                                    notes = notesText,
                                )
                                notesText = ""
                                restEndsAt = System.currentTimeMillis() + target.restSec * 1000L
                                val group = current.supersetGroup
                                if (group != null) {
                                    val next = exercises.indices.firstOrNull { index ->
                                        index != selectedIndex && exercises[index].supersetGroup == group
                                    }
                                    if (next != null) selectedIndex = next
                                }
                            }
                        },
                        enabled = isValidSetInput(weightText, repsText, rirText),
                        modifier = Modifier.fillMaxWidth().height(52.dp),
                    ) {
                        Text(stringResource(R.string.confirm_set))
                    }
                }
            }
            if (restRemaining > 0) {
                item {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            "${stringResource(R.string.rest)}: ${restRemaining / 60}:${(restRemaining % 60).toString().padStart(2, '0')}",
                            style = MaterialTheme.typography.titleMedium,
                            modifier = Modifier.weight(1f),
                        )
                        TextButton(onClick = { restEndsAt += 30_000 }) {
                            Text(stringResource(R.string.add_30))
                        }
                        TextButton(onClick = { restEndsAt = 0 }) {
                            Text(stringResource(R.string.skip))
                        }
                    }
                }
            }
            item { Spacer(Modifier.height(24.dp)) }
        }
    }

    editSet?.let { set ->
        EditSetDialog(
            set = set,
            onDismiss = { editSet = null },
            onSave = { weight, reps, rir ->
                scope.launch { repository.updateSet(set, weight, reps, rir) }
                editSet = null
            },
        )
    }
    if (finishDialog) {
        FinishDialog(
            onDismiss = { finishDialog = false },
            onFinish = { notes, rpe ->
                scope.launch {
                    repository.finishSession(sessionId, notes, rpe)
                    finishDialog = false
                    onExit()
                }
            },
        )
    }
}

@Composable
private fun ExerciseStrip(
    exercises: List<ProgramExerciseDto>,
    selectedIndex: Int,
    completedExerciseIds: Set<String>,
    onSelect: (Int) -> Unit,
) {
    LazyRow(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        items(exercises.indices.toList(), key = { exercises[it].id }) { index ->
            val exercise = exercises[index]
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                AssistChip(
                    onClick = { onSelect(index) },
                    label = {
                        Text(
                            exercise.exercise.name.take(12),
                            maxLines = 1,
                            color = if (index == selectedIndex) {
                                MaterialTheme.colorScheme.onPrimaryContainer
                            } else {
                                MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.65f)
                            },
                        )
                    },
                    leadingIcon = if (exercise.exerciseId in completedExerciseIds) {
                        { Text("✓") }
                    } else null,
                )
                if (exercise.supersetGroup != null) {
                    HorizontalDivider(
                        thickness = 3.dp,
                        color = Color(0xFFB23A32),
                        modifier = Modifier.width(48.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun SetRow(set: LocalSetEntity, onEdit: () -> Unit, onDelete: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(stringResource(R.string.set_row, set.setNumber), modifier = Modifier.width(88.dp))
        Text("${formatWeight(set.weight)} kg", modifier = Modifier.weight(1f))
        Text("${set.reps}", modifier = Modifier.width(42.dp))
        Text("RIR ${set.rir ?: "-"}", modifier = Modifier.width(64.dp))
        IconButton(onClick = onEdit) { Icon(Icons.Outlined.Edit, contentDescription = null) }
        IconButton(onClick = onDelete) { Icon(Icons.Outlined.Delete, contentDescription = null) }
    }
}

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
private fun EditSetDialog(
    set: LocalSetEntity,
    onDismiss: () -> Unit,
    onSave: (Double, Int, Int?) -> Unit,
) {
    var weight by remember { mutableStateOf(formatWeight(set.weight)) }
    var reps by remember { mutableStateOf(set.reps.toString()) }
    var rir by remember { mutableStateOf(set.rir?.toString().orEmpty()) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.edit)) },
        text = {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                NumericField(weight, { weight = it }, stringResource(R.string.weight), Modifier.weight(1f), true)
                NumericField(reps, { reps = it }, stringResource(R.string.reps), Modifier.weight(1f))
                NumericField(rir, { rir = it }, stringResource(R.string.rir), Modifier.weight(1f))
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    val parsedWeight = weight.replace(',', '.').toDoubleOrNull() ?: return@TextButton
                    val parsedReps = reps.toIntOrNull() ?: return@TextButton
                    val parsedRir = if (rir.isBlank()) null else rir.toIntOrNull() ?: return@TextButton
                    onSave(parsedWeight, parsedReps, parsedRir)
                },
                enabled = isValidSetInput(weight, reps, rir),
            ) { Text(stringResource(R.string.save)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
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

private fun isValidSetInput(weight: String, reps: String, rir: String): Boolean {
    val parsedWeight = weight.replace(',', '.').toDoubleOrNull()
    val parsedReps = reps.toIntOrNull()
    val parsedRir = if (rir.isBlank()) null else rir.toIntOrNull() ?: return false
    return parsedWeight != null && parsedWeight.isFinite() && parsedWeight in 0.0..500.0 &&
        parsedReps in 1..100 && (parsedRir == null || parsedRir in 0..5)
}
