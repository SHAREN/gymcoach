package org.sharteman.gymcoach.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import org.sharteman.gymcoach.R
import org.sharteman.gymcoach.data.model.ProgramExerciseDto
import org.sharteman.gymcoach.ui.localization.exerciseDisplayName

private enum class ExerciseMenuView { MAIN, SETS, REPS, DROP_SETS, SUPERSET, NOTE, REMOVE }

@Composable
internal fun ActiveExerciseMenuDialog(
    exercise: ProgramExerciseDto,
    exercises: List<ProgramExerciseDto>,
    busy: Boolean,
    onUpdate: (ProgramExerciseDto) -> Unit,
    onSuperset: (String?) -> Unit,
    onReplace: () -> Unit,
    onRemove: () -> Unit,
    onInformation: () -> Unit,
    onDismiss: () -> Unit,
) {
    var view by rememberSaveable(exercise.id) { mutableStateOf(ExerciseMenuView.MAIN) }
    var repsMinText by rememberSaveable(exercise.id) { mutableStateOf(exercise.targetRepsMin.toString()) }
    var repsMaxText by rememberSaveable(exercise.id) { mutableStateOf(exercise.targetRepsMax.toString()) }
    var note by rememberSaveable(exercise.id) { mutableStateOf(exercise.notes.orEmpty()) }
    val index = exercises.indexOfFirst { it.id == exercise.id }
    val previous = exercises.getOrNull(index - 1)
    val next = exercises.getOrNull(index + 1)

    AlertDialog(
        modifier = Modifier.testTag("active-exercise-menu"),
        onDismissRequest = { if (!busy) onDismiss() },
        title = {
            Text(
                if (view == ExerciseMenuView.MAIN) {
                    stringResource(
                        R.string.exercise_actions_for,
                        exerciseDisplayName(exercise.exercise.name),
                    )
                } else {
                    exerciseMenuTitle(view)
                },
            )
        },
        text = {
            when (view) {
                ExerciseMenuView.MAIN -> Column(
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    ExerciseMenuButton(
                        text = stringResource(R.string.exercise_target_sets),
                        value = exercise.targetSets.toString(),
                        tag = "exercise-menu-target-sets",
                        busy = busy,
                    ) { view = ExerciseMenuView.SETS }
                    ExerciseMenuButton(
                        text = stringResource(R.string.exercise_target_reps),
                        value = "${exercise.targetRepsMin}-${exercise.targetRepsMax}",
                        tag = "exercise-menu-target-reps",
                        busy = busy,
                    ) { view = ExerciseMenuView.REPS }
                    ExerciseMenuButton(
                        text = stringResource(R.string.exercise_drop_sets),
                        value = exercise.targetDropSets.toString(),
                        tag = "exercise-menu-drop-sets",
                        busy = busy,
                    ) { view = ExerciseMenuView.DROP_SETS }
                    ExerciseMenuButton(
                        text = stringResource(R.string.exercise_superset),
                        value = exercise.supersetGroup?.toString(),
                        tag = "exercise-menu-superset",
                        busy = busy,
                    ) { view = ExerciseMenuView.SUPERSET }
                    ExerciseMenuButton(
                        text = stringResource(R.string.exercise_program_note),
                        tag = "exercise-menu-note",
                        busy = busy,
                    ) {
                        note = exercise.notes.orEmpty()
                        view = ExerciseMenuView.NOTE
                    }
                    ExerciseMenuButton(
                        text = stringResource(R.string.exercise_replace_action),
                        tag = "exercise-menu-replace",
                        busy = busy,
                        onClick = onReplace,
                    )
                    ExerciseMenuButton(
                        text = stringResource(R.string.exercise_remove_action),
                        tag = "exercise-menu-remove",
                        busy = busy,
                        destructive = true,
                    ) { view = ExerciseMenuView.REMOVE }
                    ExerciseMenuButton(
                        text = stringResource(R.string.exercise_information),
                        tag = "exercise-menu-information",
                        busy = busy,
                        onClick = onInformation,
                    )
                }

                ExerciseMenuView.SETS -> ValueList(
                    values = (1..20).toList(),
                    selected = exercise.targetSets,
                    tagPrefix = "exercise-target-sets",
                    busy = busy,
                ) { onUpdate(exercise.copy(targetSets = it)) }

                ExerciseMenuView.DROP_SETS -> ValueList(
                    values = (0..10).toList(),
                    selected = exercise.targetDropSets,
                    tagPrefix = "exercise-drop-sets",
                    busy = busy,
                ) { onUpdate(exercise.copy(targetDropSets = it)) }

                ExerciseMenuView.REPS -> Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    val repsMin = repsMinText.toIntOrNull()
                    val repsMax = repsMaxText.toIntOrNull()
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(
                            value = repsMinText,
                            onValueChange = { value ->
                                if (value.length <= 2 && value.all(Char::isDigit)) repsMinText = value
                            },
                            modifier = Modifier.weight(1f).testTag("exercise-reps-min"),
                            label = { Text(stringResource(R.string.repetitions_min)) },
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                            singleLine = true,
                        )
                        OutlinedTextField(
                            value = repsMaxText,
                            onValueChange = { value ->
                                if (value.length <= 2 && value.all(Char::isDigit)) repsMaxText = value
                            },
                            modifier = Modifier.weight(1f).testTag("exercise-reps-max"),
                            label = { Text(stringResource(R.string.repetitions_max)) },
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                            singleLine = true,
                        )
                    }
                    Button(
                        onClick = {
                            onUpdate(
                                exercise.copy(
                                    targetRepsMin = requireNotNull(repsMin),
                                    targetRepsMax = requireNotNull(repsMax),
                                ),
                            )
                        },
                        enabled = !busy && repsMin != null && repsMax != null &&
                            repsMin in 1..50 && repsMax in repsMin..50,
                        modifier = Modifier.fillMaxWidth().testTag("exercise-reps-save"),
                    ) { Text(stringResource(R.string.save)) }
                }

                ExerciseMenuView.NOTE -> Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedTextField(
                        value = note,
                        onValueChange = { if (it.length <= 2000) note = it },
                        modifier = Modifier.fillMaxWidth().testTag("exercise-note-input"),
                        label = { Text(stringResource(R.string.exercise_program_note_hint)) },
                        minLines = 4,
                        maxLines = 8,
                    )
                    Button(
                        onClick = { onUpdate(exercise.copy(notes = note.trim().ifEmpty { null })) },
                        enabled = !busy,
                        modifier = Modifier.fillMaxWidth().testTag("exercise-note-save"),
                    ) { Text(stringResource(R.string.save)) }
                }

                ExerciseMenuView.SUPERSET -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (exercise.supersetGroup != null) {
                        ExerciseMenuButton(
                            text = stringResource(R.string.exercise_superset_dissolve),
                            tag = "exercise-superset-dissolve",
                            busy = busy,
                        ) { onSuperset(null) }
                    }
                    previous?.let { neighbor ->
                        if (neighbor.supersetGroup != exercise.supersetGroup || exercise.supersetGroup == null) {
                            ExerciseMenuButton(
                                text = stringResource(
                                    R.string.exercise_superset_link_previous,
                                    exerciseDisplayName(neighbor.exercise.name),
                                ),
                                tag = "exercise-superset-previous",
                                busy = busy,
                            ) { onSuperset(neighbor.id) }
                        }
                    }
                    next?.let { neighbor ->
                        if (neighbor.supersetGroup != exercise.supersetGroup || exercise.supersetGroup == null) {
                            ExerciseMenuButton(
                                text = stringResource(
                                    R.string.exercise_superset_link_next,
                                    exerciseDisplayName(neighbor.exercise.name),
                                ),
                                tag = "exercise-superset-next",
                                busy = busy,
                            ) { onSuperset(neighbor.id) }
                        }
                    }
                    if (exercise.supersetGroup == null && previous == null && next == null) {
                        Text(stringResource(R.string.exercise_superset_no_neighbors))
                    }
                }

                ExerciseMenuView.REMOVE -> Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(
                        if (exercises.size == 1) {
                            stringResource(R.string.exercise_remove_last)
                        } else {
                            stringResource(
                                R.string.exercise_remove_warning,
                                exerciseDisplayName(exercise.exercise.name),
                            )
                        },
                    )
                    Button(
                        onClick = onRemove,
                        enabled = !busy && exercises.size > 1,
                        modifier = Modifier.fillMaxWidth().testTag("exercise-remove-confirm"),
                    ) { Text(stringResource(R.string.exercise_remove_action)) }
                }
            }
        },
        confirmButton = {},
        dismissButton = {
            TextButton(
                onClick = {
                    if (view == ExerciseMenuView.MAIN) onDismiss() else view = ExerciseMenuView.MAIN
                },
                enabled = !busy,
            ) {
                Text(stringResource(if (view == ExerciseMenuView.MAIN) R.string.cancel else R.string.back))
            }
        },
    )
}

@Composable
private fun exerciseMenuTitle(view: ExerciseMenuView): String = stringResource(
    when (view) {
        ExerciseMenuView.SETS -> R.string.exercise_target_sets
        ExerciseMenuView.REPS -> R.string.exercise_target_reps
        ExerciseMenuView.DROP_SETS -> R.string.exercise_drop_sets
        ExerciseMenuView.SUPERSET -> R.string.exercise_superset
        ExerciseMenuView.NOTE -> R.string.exercise_program_note
        ExerciseMenuView.REMOVE -> R.string.exercise_remove_title
        ExerciseMenuView.MAIN -> R.string.exercise_actions
    },
)

@Composable
private fun ExerciseMenuButton(
    text: String,
    tag: String,
    busy: Boolean,
    value: String? = null,
    destructive: Boolean = false,
    onClick: () -> Unit,
) {
    OutlinedButton(
        onClick = onClick,
        enabled = !busy,
        modifier = Modifier.fillMaxWidth().testTag(tag),
    ) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(text, color = if (destructive) MaterialTheme.colorScheme.error else Color.Unspecified)
            value?.let { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
    }
}

@Composable
private fun ValueList(
    values: List<Int>,
    selected: Int,
    tagPrefix: String,
    busy: Boolean,
    onSelect: (Int) -> Unit,
) {
    LazyColumn(
        modifier = Modifier.fillMaxWidth().heightIn(max = 420.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        items(values) { value ->
            Button(
                onClick = { onSelect(value) },
                enabled = !busy,
                modifier = Modifier.fillMaxWidth().testTag("$tagPrefix-$value"),
            ) {
                Text(if (value == selected) "✓ $value" else value.toString())
            }
        }
    }
}
