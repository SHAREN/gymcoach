package org.sharteman.gymcoach.ui.programs

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import org.sharteman.gymcoach.R
import org.sharteman.gymcoach.data.model.ExerciseDto
import org.sharteman.gymcoach.ui.localization.exerciseDisplayName

@Composable
internal fun ExerciseReplacementDialog(
    currentExercise: ExerciseDto,
    catalog: List<ExerciseDto>,
    trainingDatesByExerciseId: Map<String, List<String>>,
    serverUrl: String,
    loggedSetCount: Int,
    busy: Boolean,
    onConfirm: (ExerciseDto) -> Unit,
    onDismiss: () -> Unit,
) {
    var query by rememberSaveable(currentExercise.id) { mutableStateOf("") }
    var muscleGroup by rememberSaveable(currentExercise.id) {
        mutableStateOf<String?>(currentExercise.muscleGroup)
    }
    var equipmentType by rememberSaveable(currentExercise.id) { mutableStateOf<String?>(null) }
    var pendingReplacementId by rememberSaveable(currentExercise.id) { mutableStateOf<String?>(null) }
    val choices = remember(catalog, query, muscleGroup, equipmentType, currentExercise.id) {
        filterCatalogExercises(
            exercises = catalog,
            query = query,
            muscleGroup = muscleGroup,
            equipmentType = equipmentType,
            excludedExerciseIds = setOf(currentExercise.id),
        )
    }
    val pendingReplacement = pendingReplacementId?.let { id -> catalog.firstOrNull { it.id == id } }

    if (pendingReplacement != null) {
        AlertDialog(
            modifier = Modifier.testTag("exercise-replacement-confirmation"),
            onDismissRequest = { if (!busy) pendingReplacementId = null },
            title = { Text(stringResource(R.string.exercise_replace_action)) },
            text = {
                Text(
                    stringResource(
                        R.string.exercise_replace_logged_warning,
                        exerciseDisplayName(currentExercise.name),
                        exerciseDisplayName(pendingReplacement.name),
                    ),
                )
            },
            confirmButton = {
                Button(
                    onClick = { onConfirm(pendingReplacement) },
                    enabled = !busy,
                    modifier = Modifier.testTag("exercise-replacement-confirm"),
                ) {
                    Text(stringResource(R.string.exercise_replace_action))
                }
            },
            dismissButton = {
                TextButton(
                    onClick = { pendingReplacementId = null },
                    enabled = !busy,
                ) {
                    Text(stringResource(R.string.cancel))
                }
            },
        )
        return
    }

    AlertDialog(
        modifier = Modifier.testTag("exercise-replacement-picker"),
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text(stringResource(R.string.exercise_replace_title)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                ExerciseFilterControls(
                    muscleGroup = muscleGroup,
                    equipmentType = equipmentType,
                    onMuscleGroupChange = { muscleGroup = it },
                    onEquipmentTypeChange = { equipmentType = it },
                    onReset = {
                        muscleGroup = null
                        equipmentType = null
                    },
                )
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    modifier = Modifier.fillMaxWidth().testTag("exercise-replacement-search"),
                    label = { Text(stringResource(R.string.exercise_catalog_search)) },
                    singleLine = true,
                )
                if (choices.isEmpty()) {
                    Text(stringResource(R.string.exercise_catalog_empty))
                } else {
                    LazyColumn(
                        modifier = Modifier.heightIn(max = 420.dp).testTag("exercise-replacement-list"),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        items(choices, key = { it.id }) { exercise ->
                            val trainingDates = trainingDatesByExerciseId[exercise.id]
                                ?: exercise.trainingDates
                            ExerciseCatalogCard(
                                exercise = exercise,
                                serverUrl = serverUrl,
                                trainedDayCount = exerciseTrainingDayCount(trainingDates),
                                tagPrefix = "replacement-exercise",
                                onOpen = {
                                    if (loggedSetCount > 0) {
                                        pendingReplacementId = exercise.id
                                    } else {
                                        onConfirm(exercise)
                                    }
                                },
                            )
                        }
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !busy) {
                Text(stringResource(R.string.cancel))
            }
        },
    )
}
