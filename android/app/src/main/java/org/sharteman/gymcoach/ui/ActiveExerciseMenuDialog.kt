package org.sharteman.gymcoach.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.SwapHoriz
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.sharteman.gymcoach.R
import org.sharteman.gymcoach.data.model.ProgramExerciseDto
import org.sharteman.gymcoach.ui.localization.equipmentTypeDisplayName
import org.sharteman.gymcoach.ui.localization.exerciseDisplayName

private enum class ExerciseMenuView { MAIN, SETS, REPS, DROP_SETS, SUPERSET, NOTE, REMOVE }

@OptIn(ExperimentalMaterial3Api::class)
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
    equipmentName: String? = null,
) {
    var view by rememberSaveable(exercise.id) { mutableStateOf(ExerciseMenuView.MAIN) }
    var repsMinText by rememberSaveable(exercise.id) { mutableStateOf(exercise.targetRepsMin.toString()) }
    var repsMaxText by rememberSaveable(exercise.id) { mutableStateOf(exercise.targetRepsMax.toString()) }
    var note by rememberSaveable(exercise.id) { mutableStateOf(exercise.notes.orEmpty()) }
    val index = exercises.indexOfFirst { it.id == exercise.id }
    val previous = exercises.getOrNull(index - 1)
    val next = exercises.getOrNull(index + 1)
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    ModalBottomSheet(
        modifier = Modifier.testTag("active-exercise-menu"),
        onDismissRequest = { if (!busy) onDismiss() },
        sheetState = sheetState,
    ) {
        ExerciseSheetHeader(
            title = if (view == ExerciseMenuView.MAIN) {
                exerciseDisplayName(exercise.exercise.name)
            } else {
                exerciseMenuTitle(view)
            },
            subtitle = if (view == ExerciseMenuView.MAIN) {
                equipmentName ?: equipmentTypeDisplayName(exercise.exercise.equipmentType)
            } else {
                exerciseDisplayName(exercise.exercise.name)
            },
            showBack = view != ExerciseMenuView.MAIN,
            busy = busy,
            onBack = { view = ExerciseMenuView.MAIN },
            onDismiss = onDismiss,
        )

        when (view) {
            ExerciseMenuView.MAIN -> ExerciseMenuMain(
                exercise = exercise,
                busy = busy,
                onOpen = { view = it },
                onReplace = onReplace,
                onInformation = onInformation,
            )

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

            ExerciseMenuView.REPS -> {
                val repsMin = repsMinText.toIntOrNull()
                val repsMax = repsMaxText.toIntOrNull()
                SheetScrollColumn {
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
                    ) {
                        Text(stringResource(R.string.save))
                    }
                }
            }

            ExerciseMenuView.NOTE -> SheetScrollColumn {
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
                ) {
                    Text(stringResource(R.string.save))
                }
            }

            ExerciseMenuView.SUPERSET -> SheetScrollColumn {
                if (exercise.supersetGroup != null) {
                    ExerciseSheetRow(
                        label = stringResource(R.string.exercise_superset_dissolve),
                        tag = "exercise-superset-dissolve",
                        busy = busy,
                        onClick = { onSuperset(null) },
                    )
                }
                previous?.let { neighbor ->
                    if (neighbor.supersetGroup != exercise.supersetGroup || exercise.supersetGroup == null) {
                        ExerciseSheetRow(
                            label = stringResource(
                                R.string.exercise_superset_link_previous,
                                exerciseDisplayName(neighbor.exercise.name),
                            ),
                            tag = "exercise-superset-previous",
                            busy = busy,
                            onClick = { onSuperset(neighbor.id) },
                        )
                    }
                }
                next?.let { neighbor ->
                    if (neighbor.supersetGroup != exercise.supersetGroup || exercise.supersetGroup == null) {
                        ExerciseSheetRow(
                            label = stringResource(
                                R.string.exercise_superset_link_next,
                                exerciseDisplayName(neighbor.exercise.name),
                            ),
                            tag = "exercise-superset-next",
                            busy = busy,
                            onClick = { onSuperset(neighbor.id) },
                        )
                    }
                }
                if (exercise.supersetGroup == null && previous == null && next == null) {
                    Text(
                        stringResource(R.string.exercise_superset_no_neighbors),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            ExerciseMenuView.REMOVE -> SheetScrollColumn {
                Surface(
                    modifier = Modifier.fillMaxWidth().testTag("exercise-menu-destructive-confirmation"),
                    color = MaterialTheme.colorScheme.errorContainer,
                    shape = MaterialTheme.shapes.medium,
                ) {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Text(
                            if (exercises.size == 1) {
                                stringResource(R.string.exercise_remove_last)
                            } else {
                                stringResource(
                                    R.string.exercise_remove_warning,
                                    exerciseDisplayName(exercise.exercise.name),
                                )
                            },
                            color = MaterialTheme.colorScheme.onErrorContainer,
                        )
                        Button(
                            onClick = onRemove,
                            enabled = !busy && exercises.size > 1,
                            modifier = Modifier.fillMaxWidth().testTag("exercise-remove-confirm"),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = MaterialTheme.colorScheme.error,
                                contentColor = MaterialTheme.colorScheme.onError,
                            ),
                        ) {
                            Text(stringResource(R.string.exercise_remove_action))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ExerciseSheetHeader(
    title: String,
    subtitle: String,
    showBack: Boolean,
    busy: Boolean,
    onBack: () -> Unit,
    onDismiss: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(start = 12.dp, end = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (showBack) {
            IconButton(
                onClick = onBack,
                enabled = !busy,
                modifier = Modifier.testTag("exercise-menu-back"),
            ) {
                Icon(
                    Icons.AutoMirrored.Outlined.ArrowBack,
                    contentDescription = stringResource(R.string.back),
                )
            }
        }
        Column(modifier = Modifier.weight(1f).padding(start = if (showBack) 4.dp else 8.dp)) {
            Text(
                title,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.testTag("exercise-menu-title"),
            )
            Text(
                subtitle,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.testTag("exercise-menu-equipment"),
            )
        }
        IconButton(
            onClick = onDismiss,
            enabled = !busy,
            modifier = Modifier.size(48.dp).testTag("exercise-menu-close"),
        ) {
            Icon(Icons.Outlined.Close, contentDescription = stringResource(R.string.close))
        }
    }
}

@Composable
private fun ExerciseMenuMain(
    exercise: ProgramExerciseDto,
    busy: Boolean,
    onOpen: (ExerciseMenuView) -> Unit,
    onReplace: () -> Unit,
    onInformation: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(max = 620.dp)
            .verticalScroll(rememberScrollState())
            .navigationBarsPadding()
            .testTag("exercise-menu-scroll"),
    ) {
        ExerciseSectionTitle(
            text = stringResource(R.string.exercise_parameters_section),
            tag = "exercise-menu-parameters-section",
        )
        ExerciseSheetRow(
            label = stringResource(R.string.exercise_target_sets),
            value = exercise.targetSets.toString(),
            tag = "exercise-menu-target-sets",
            busy = busy,
            onClick = { onOpen(ExerciseMenuView.SETS) },
        )
        ExerciseSheetRow(
            label = stringResource(R.string.exercise_target_reps),
            value = exercise.targetRepsMin.toString() + "-" + exercise.targetRepsMax,
            tag = "exercise-menu-target-reps",
            busy = busy,
            onClick = { onOpen(ExerciseMenuView.REPS) },
        )
        ExerciseSheetRow(
            label = stringResource(R.string.exercise_drop_sets),
            value = exercise.targetDropSets.toString(),
            tag = "exercise-menu-drop-sets",
            busy = busy,
            onClick = { onOpen(ExerciseMenuView.DROP_SETS) },
        )
        ExerciseSheetRow(
            label = stringResource(R.string.exercise_superset),
            value = exercise.supersetGroup?.toString()
                ?: stringResource(R.string.exercise_value_not_set),
            tag = "exercise-menu-superset",
            busy = busy,
            onClick = { onOpen(ExerciseMenuView.SUPERSET) },
        )
        ExerciseSheetRow(
            label = stringResource(R.string.exercise_program_note),
            value = exercise.notes?.takeIf { it.isNotBlank() }
                ?: stringResource(R.string.exercise_note_empty),
            tag = "exercise-menu-note",
            busy = busy,
            mutedValue = exercise.notes.isNullOrBlank(),
            onClick = { onOpen(ExerciseMenuView.NOTE) },
        )

        Spacer(Modifier.height(10.dp))
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        ExerciseSectionTitle(
            text = stringResource(R.string.exercise_actions_section),
            tag = "exercise-menu-actions-section",
        )
        ExerciseSheetRow(
            label = stringResource(R.string.exercise_replace_action),
            tag = "exercise-menu-replace",
            busy = busy,
            leadingIcon = {
                Icon(Icons.Outlined.SwapHoriz, contentDescription = null, modifier = Modifier.size(22.dp))
            },
            onClick = onReplace,
        )
        ExerciseSheetRow(
            label = stringResource(R.string.exercise_information),
            tag = "exercise-menu-information",
            busy = busy,
            leadingIcon = {
                Icon(Icons.Outlined.Info, contentDescription = null, modifier = Modifier.size(22.dp))
            },
            onClick = onInformation,
        )

        Spacer(Modifier.height(12.dp))
        HorizontalDivider(color = MaterialTheme.colorScheme.error.copy(alpha = 0.35f))
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 10.dp)
                .testTag("exercise-menu-destructive-section"),
        ) {
            ExerciseSheetRow(
                label = stringResource(R.string.exercise_remove_action),
                tag = "exercise-menu-remove",
                busy = busy,
                destructive = true,
                leadingIcon = {
                    Icon(
                        Icons.Outlined.DeleteOutline,
                        contentDescription = null,
                        modifier = Modifier.size(22.dp),
                        tint = MaterialTheme.colorScheme.error,
                    )
                },
                onClick = { onOpen(ExerciseMenuView.REMOVE) },
            )
        }
        Spacer(Modifier.height(12.dp))
    }
}

@Composable
private fun ExerciseSectionTitle(text: String, tag: String) {
    Text(
        text,
        modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp).testTag(tag),
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.primary,
    )
}

@Composable
private fun ExerciseSheetRow(
    label: String,
    tag: String,
    busy: Boolean,
    onClick: () -> Unit,
    value: String? = null,
    mutedValue: Boolean = false,
    destructive: Boolean = false,
    leadingIcon: (@Composable () -> Unit)? = null,
) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .clickable(enabled = !busy, onClick = onClick)
            .testTag(tag),
        color = Color.Transparent,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            leadingIcon?.invoke()
            if (leadingIcon != null) Spacer(Modifier.width(14.dp))
            Text(
                label,
                modifier = Modifier.weight(1f),
                style = MaterialTheme.typography.bodyLarge,
                color = if (destructive) MaterialTheme.colorScheme.error else Color.Unspecified,
            )
            value?.let {
                Spacer(Modifier.width(12.dp))
                Text(
                    it,
                    modifier = Modifier.weight(0.8f, fill = false),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant.copy(
                        alpha = if (mutedValue) 0.7f else 1f,
                    ),
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Spacer(Modifier.width(8.dp))
            Icon(
                Icons.Outlined.ChevronRight,
                contentDescription = null,
                modifier = Modifier.size(20.dp),
                tint = if (destructive) {
                    MaterialTheme.colorScheme.error
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant
                },
            )
        }
    }
}

@Composable
private fun SheetScrollColumn(content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(max = 560.dp)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 12.dp)
            .navigationBarsPadding()
            .imePadding()
            .testTag("exercise-menu-subflow-scroll"),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        content = content,
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
private fun ValueList(
    values: List<Int>,
    selected: Int,
    tagPrefix: String,
    busy: Boolean,
    onSelect: (Int) -> Unit,
) {
    LazyColumn(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(max = 560.dp)
            .navigationBarsPadding()
            .testTag("exercise-menu-value-list"),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        items(values) { value ->
            TextButton(
                onClick = { onSelect(value) },
                enabled = !busy,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 48.dp)
                    .testTag(tagPrefix + "-" + value),
            ) {
                Text(
                    if (value == selected) "✓ " + value else value.toString(),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}
