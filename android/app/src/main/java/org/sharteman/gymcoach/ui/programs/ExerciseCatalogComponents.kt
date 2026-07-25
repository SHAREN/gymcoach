package org.sharteman.gymcoach.ui.programs

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.EventAvailable
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.RestartAlt
import androidx.compose.material3.Card
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.text
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import org.sharteman.gymcoach.R
import org.sharteman.gymcoach.data.media.ExerciseMediaCatalog
import org.sharteman.gymcoach.data.model.ExerciseDto
import org.sharteman.gymcoach.ui.localization.equipmentTypeDisplayName
import org.sharteman.gymcoach.ui.localization.exerciseCategoryDisplayName
import org.sharteman.gymcoach.ui.localization.exerciseDisplayName
import org.sharteman.gymcoach.ui.localization.muscleGroupDisplayName

internal val exerciseMuscleGroups = listOf(
    "CHEST", "BACK_WIDTH", "BACK_THICKNESS", "SHOULDERS_FRONT", "SHOULDERS_LATERAL",
    "SHOULDERS_REAR", "BICEPS", "TRICEPS", "FOREARMS", "QUADS", "HAMSTRINGS",
    "GLUTES", "CALVES", "ABS", "LOWER_BACK", "OTHER",
)

internal val exerciseEquipmentTypes = listOf(
    "DUMBBELL", "BARBELL", "MACHINE", "CABLE", "BODYWEIGHT", "CARDIO", "OTHER",
)

@Composable
internal fun ExerciseFilterControls(
    muscleGroup: String?,
    equipmentType: String?,
    onMuscleGroupChange: (String?) -> Unit,
    onEquipmentTypeChange: (String?) -> Unit,
    onReset: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            EnumFilterButton(
                label = stringResource(
                    R.string.filter_muscle,
                    muscleGroup?.let(::muscleGroupDisplayName)
                        ?: stringResource(R.string.filter_all_muscles),
                ),
                value = muscleGroup,
                values = exerciseMuscleGroups,
                displayValue = ::muscleGroupDisplayName,
                allLabel = stringResource(R.string.filter_all_muscles),
                testTag = "exercise-filter-muscle",
                onValue = onMuscleGroupChange,
                modifier = Modifier.weight(1f),
            )
            EnumFilterButton(
                label = stringResource(
                    R.string.filter_equipment,
                    equipmentType?.let(::equipmentTypeDisplayName)
                        ?: stringResource(R.string.filter_all_equipment),
                ),
                value = equipmentType,
                values = exerciseEquipmentTypes,
                displayValue = ::equipmentTypeDisplayName,
                allLabel = stringResource(R.string.filter_all_equipment),
                testTag = "exercise-filter-equipment",
                onValue = onEquipmentTypeChange,
                modifier = Modifier.weight(1f),
            )
        }
        if (muscleGroup != null || equipmentType != null) {
            TextButton(
                onClick = onReset,
                modifier = Modifier.align(Alignment.End).testTag("exercise-filter-reset"),
            ) {
                Icon(Icons.Outlined.RestartAlt, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text(stringResource(R.string.filter_reset))
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
    allLabel: String,
    testTag: String,
    onValue: (String?) -> Unit,
    modifier: Modifier = Modifier,
) {
    var open by remember { mutableStateOf(false) }
    Column(modifier) {
        OutlinedButton(
            onClick = { open = true },
            modifier = Modifier.fillMaxWidth().testTag(testTag),
        ) {
            Text(label, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(
                text = { Text(allLabel) },
                modifier = Modifier.testTag("$testTag-all"),
                onClick = { open = false; onValue(null) },
            )
            values.forEach { option ->
                DropdownMenuItem(
                    text = { Text(displayValue(option)) },
                    modifier = Modifier.testTag("$testTag-$option"),
                    onClick = { open = false; onValue(option) },
                )
            }
        }
    }
}

@Composable
internal fun ExerciseCatalogCard(
    exercise: ExerciseDto,
    serverUrl: String,
    trainedDayCount: Int,
    onOpen: () -> Unit,
    tagPrefix: String = "exercise",
) {
    val context = LocalContext.current
    val media = remember(exercise.name) {
        runCatching { ExerciseMediaCatalog.load(context).resolve(exercise.name) }.getOrNull()
    }
    Card(
        onClick = onOpen,
        modifier = Modifier.fillMaxWidth().testTag("$tagPrefix-${exercise.id}"),
    ) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Surface(
                modifier = Modifier.size(72.dp),
                shape = RoundedCornerShape(10.dp),
                color = androidx.compose.material3.MaterialTheme.colorScheme.surfaceVariant,
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
                    style = androidx.compose.material3.MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                )
                CompactExerciseTrainingDays(
                    count = trainedDayCount,
                    modifier = Modifier.testTag("$tagPrefix-${exercise.id}-trained-days"),
                )
                Text(
                    muscleGroupDisplayName(exercise.muscleGroup),
                    color = androidx.compose.material3.MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    "${exerciseCategoryDisplayName(exercise.category)} • " +
                        equipmentTypeDisplayName(exercise.equipmentType),
                    style = androidx.compose.material3.MaterialTheme.typography.labelMedium,
                )
            }
        }
    }
}

@Composable
internal fun CompactExerciseTrainingDays(count: Int, modifier: Modifier = Modifier) {
    val description = stringResource(R.string.exercise_trained_days, count)
    val countText = count.toString()
    Row(
        modifier = modifier.clearAndSetSemantics {
            contentDescription = description
            text = AnnotatedString(countText)
        },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Icon(
            Icons.Outlined.EventAvailable,
            contentDescription = null,
            modifier = Modifier.size(15.dp),
            tint = androidx.compose.material3.MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            countText,
            style = androidx.compose.material3.MaterialTheme.typography.labelMedium,
            color = androidx.compose.material3.MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

internal fun filterCatalogExercises(
    exercises: List<ExerciseDto>,
    query: String,
    muscleGroup: String?,
    equipmentType: String?,
    excludedExerciseIds: Set<String> = emptySet(),
    language: String = java.util.Locale.getDefault().language,
): List<ExerciseDto> {
    val normalizedQuery = query.trim()
    return exercises.filter { exercise ->
        exercise.id !in excludedExerciseIds &&
            (normalizedQuery.isBlank() ||
                exercise.name.contains(normalizedQuery, ignoreCase = true) ||
                exerciseDisplayName(exercise.name, language)
                    .contains(normalizedQuery, ignoreCase = true)) &&
            (muscleGroup == null || exercise.muscleGroup == muscleGroup) &&
            (equipmentType == null || exercise.equipmentType == equipmentType)
    }
}

internal fun sortCatalogExercisesByTrainingDays(exercises: List<ExerciseDto>): List<ExerciseDto> =
    exercises.withIndex()
        .sortedWith(
            compareBy<IndexedValue<ExerciseDto>> {
                exerciseTrainingDayCount(it.value.trainingDates) == 0
            }.thenBy { it.index },
        )
        .map { it.value }
