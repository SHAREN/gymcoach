package org.sharteman.gymcoach.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.List
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.FitnessCenter
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import coil.compose.AsyncImage
import org.sharteman.gymcoach.R
import org.sharteman.gymcoach.data.media.ExerciseMediaCatalog
import org.sharteman.gymcoach.data.model.ProgramExerciseDto
import org.sharteman.gymcoach.data.model.WorkoutDto
import org.sharteman.gymcoach.ui.localization.equipmentTypeDisplayName
import org.sharteman.gymcoach.ui.localization.exerciseCategoryDisplayName
import org.sharteman.gymcoach.ui.localization.exerciseDisplayName
import org.sharteman.gymcoach.ui.localization.muscleGroupDisplayName
import java.time.DayOfWeek
import java.time.format.TextStyle
import java.util.Locale

@Composable
internal fun WorkoutDayDetailsDialog(
    programName: String,
    workout: WorkoutDto,
    serverUrl: String?,
    onStart: () -> Unit,
    onEditDay: () -> Unit,
    onOpenProgram: () -> Unit,
    onDismiss: () -> Unit,
) {
    val totalSets = workout.exercises.sumOf { it.targetSets + it.targetDropSets }
    val dayName = workoutDayName(workout.dayOfWeek)
    val context = LocalContext.current
    val mediaCatalog = remember(context) {
        runCatching { ExerciseMediaCatalog.load(context) }.getOrNull()
    }
    val sortedExercises = remember(workout.exercises) { workout.exercises.sortedBy { it.order } }
    val supersetLabels = remember(sortedExercises) { buildSupersetLabels(sortedExercises) }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        Surface(
            modifier = Modifier.fillMaxSize().testTag("workout-day-details"),
            color = MaterialTheme.colorScheme.background,
        ) {
            Column(modifier = Modifier.fillMaxSize().safeDrawingPadding()) {
                Row(
                    modifier = Modifier.fillMaxWidth().height(58.dp).padding(horizontal = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconButton(onClick = onDismiss, modifier = Modifier.testTag("workout-day-close")) {
                        Icon(
                            Icons.AutoMirrored.Outlined.ArrowBack,
                            contentDescription = stringResource(R.string.close),
                        )
                    }
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            workout.name,
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            programName,
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    IconButton(
                        onClick = onEditDay,
                        modifier = Modifier.testTag("workout-day-edit-icon"),
                    ) {
                        Icon(
                            Icons.Outlined.Edit,
                            contentDescription = stringResource(R.string.program_workout_edit),
                        )
                    }
                }
                HorizontalDivider()
                LazyColumn(
                    modifier = Modifier.weight(1f).testTag("workout-day-exercise-list"),
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    item {
                        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            Text(
                                workout.name,
                                style = MaterialTheme.typography.headlineMedium,
                                fontWeight = FontWeight.Bold,
                            )
                            Text(
                                stringResource(R.string.workout_day_program, programName),
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                dayName?.let {
                                    WorkoutDaySummaryCard(
                                        icon = { Icon(Icons.Outlined.CalendarMonth, contentDescription = null) },
                                        value = it,
                                        modifier = Modifier.weight(1f),
                                    )
                                }
                                WorkoutDaySummaryCard(
                                    icon = { Icon(Icons.Outlined.FitnessCenter, contentDescription = null) },
                                    value = pluralStringResource(
                                        R.plurals.exercise_count,
                                        workout.exercises.size,
                                        workout.exercises.size,
                                    ),
                                    modifier = Modifier.weight(1f),
                                )
                            }
                            WorkoutDaySummaryCard(
                                icon = { Icon(Icons.AutoMirrored.Outlined.List, contentDescription = null) },
                                value = stringResource(R.string.workout_day_sets_count, totalSets),
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                    }

                    item {
                        Text(
                            stringResource(R.string.workout_day_exercises),
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.SemiBold,
                        )
                    }

                    if (workout.exercises.isEmpty()) {
                        item {
                            Text(
                                stringResource(R.string.workout_day_no_exercises),
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    } else {
                        items(sortedExercises, key = { it.id }) { target ->
                            val thumbnailUrl = serverUrl
                                ?.takeIf { it.isNotBlank() }
                                ?.let { mediaCatalog?.resolve(target.exercise.name)?.frameUrl(it) }
                            WorkoutDayExerciseCard(
                                target = target,
                                thumbnailUrl = thumbnailUrl,
                                supersetLabel = supersetLabels[target.id],
                            )
                        }
                    }

                    item {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(
                                onClick = onEditDay,
                                modifier = Modifier.fillMaxWidth().testTag("workout-day-edit"),
                            ) {
                                Icon(Icons.Outlined.Edit, contentDescription = null)
                                Spacer(Modifier.width(8.dp))
                                Text(stringResource(R.string.program_workout_edit))
                            }
                            OutlinedButton(
                                onClick = onOpenProgram,
                                modifier = Modifier.fillMaxWidth().testTag("workout-day-open-program"),
                            ) {
                                Icon(Icons.AutoMirrored.Outlined.List, contentDescription = null)
                                Spacer(Modifier.width(8.dp))
                                Text(stringResource(R.string.workout_day_open_program))
                            }
                        }
                    }
                }
                Surface(shadowElevation = 8.dp) {
                    Button(
                        onClick = onStart,
                        enabled = workout.exercises.isNotEmpty(),
                        modifier = Modifier.fillMaxWidth().padding(16.dp).testTag("workout-day-start"),
                    ) {
                        Icon(Icons.Outlined.PlayArrow, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text(stringResource(R.string.workout_day_start))
                    }
                }
            }
        }
    }
}

@Composable
private fun WorkoutDaySummaryCard(
    icon: @Composable () -> Unit,
    value: String,
    modifier: Modifier,
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.58f),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            icon()
            Text(value, style = MaterialTheme.typography.labelLarge)
        }
    }
}

@Composable
private fun WorkoutDayExerciseCard(
    target: ProgramExerciseDto,
    thumbnailUrl: String?,
    supersetLabel: String?,
) {
    val displayName = exerciseDisplayName(target.exercise.name)
    Card(
        modifier = Modifier.fillMaxWidth().testTag("workout-day-exercise-${target.exerciseId}"),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.48f),
        ),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(14.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            thumbnailUrl?.let {
                Surface(
                    modifier = Modifier.size(74.dp).clip(RoundedCornerShape(12.dp)),
                    color = MaterialTheme.colorScheme.surface,
                ) {
                    AsyncImage(
                        model = it,
                        contentDescription = displayName,
                        modifier = Modifier.fillMaxSize(),
                        contentScale = ContentScale.Crop,
                    )
                }
            }
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text(displayName, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                if (displayName != target.exercise.name) {
                    Text(
                        target.exercise.name,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Text(
                    listOf(
                        muscleGroupDisplayName(target.exercise.muscleGroup),
                        exerciseCategoryDisplayName(target.exercise.category),
                        equipmentTypeDisplayName(target.exercise.equipmentType),
                    ).joinToString(" · "),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
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
                    modifier = Modifier.testTag("workout-day-target-${target.id}"),
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Medium,
                )
                if (target.targetDropSets > 0) {
                    Text(
                        stringResource(R.string.workout_day_drop_sets, target.targetDropSets),
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
                supersetLabel?.let {
                    Text(
                        stringResource(R.string.workout_day_superset, it),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
                target.tempo?.takeIf(String::isNotBlank)?.let {
                    Text(
                        stringResource(R.string.workout_day_tempo, it),
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
                target.notes?.takeIf(String::isNotBlank)?.let {
                    Text(
                        it,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

private fun buildSupersetLabels(exercises: List<ProgramExerciseDto>): Map<String, String> =
    exercises
        .filter { it.supersetGroup != null }
        .groupBy { it.supersetGroup!! }
        .toSortedMap()
        .entries
        .flatMapIndexed { groupIndex, (_, targets) ->
            val groupName = if (groupIndex < 26) ('A'.code + groupIndex).toChar().toString()
            else "S${groupIndex + 1}"
            targets.sortedBy { it.order }.mapIndexed { position, target ->
                target.id to "$groupName${position + 1}"
            }
        }
        .toMap()

internal fun workoutDayName(dayOfWeek: Int?, locale: Locale = Locale.getDefault()): String? =
    dayOfWeek?.takeIf { it in 1..7 }?.let {
        DayOfWeek.of(it).getDisplayName(TextStyle.FULL, locale)
    }
