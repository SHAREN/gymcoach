package org.sharteman.gymcoach.ui.programs

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
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

@Composable
internal fun ExerciseAddDialog(
    catalog: List<ExerciseDto>,
    excludedExerciseIds: Set<String>,
    trainingDatesByExerciseId: Map<String, List<String>>,
    serverUrl: String,
    busy: Boolean,
    onConfirm: (ExerciseDto) -> Unit,
    onDismiss: () -> Unit,
) {
    var query by rememberSaveable { mutableStateOf("") }
    var muscleGroup by rememberSaveable { mutableStateOf<String?>(null) }
    var equipmentType by rememberSaveable { mutableStateOf<String?>(null) }
    val choices = remember(catalog, query, muscleGroup, equipmentType, excludedExerciseIds) {
        filterCatalogExercises(
            exercises = catalog,
            query = query,
            muscleGroup = muscleGroup,
            equipmentType = equipmentType,
            excludedExerciseIds = excludedExerciseIds,
        )
    }

    AlertDialog(
        modifier = Modifier.testTag("exercise-add-picker"),
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text(stringResource(R.string.exercise_add_title)) },
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
                    modifier = Modifier.fillMaxWidth().testTag("exercise-add-search"),
                    label = { Text(stringResource(R.string.exercise_catalog_search)) },
                    singleLine = true,
                )
                if (choices.isEmpty()) {
                    Text(stringResource(R.string.exercise_catalog_empty))
                } else {
                    LazyColumn(
                        modifier = Modifier.heightIn(max = 420.dp).testTag("exercise-add-list"),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        items(choices, key = { it.id }) { exercise ->
                            val dates = trainingDatesByExerciseId[exercise.id] ?: exercise.trainingDates
                            ExerciseCatalogCard(
                                exercise = exercise,
                                serverUrl = serverUrl,
                                trainedDayCount = exerciseTrainingDayCount(dates),
                                tagPrefix = "add-exercise",
                                onOpen = { if (!busy) onConfirm(exercise) },
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
