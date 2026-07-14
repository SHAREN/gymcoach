package org.sharteman.gymcoach.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.BatteryChargingFull
import androidx.compose.material.icons.outlined.BatterySaver
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Flag
import androidx.compose.material.icons.outlined.EmojiEvents
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import org.sharteman.gymcoach.R
import org.sharteman.gymcoach.data.model.MobileDeloadStatusDto
import org.sharteman.gymcoach.data.model.MobileExerciseRecordDto
import org.sharteman.gymcoach.data.model.MobileProgressExerciseDto
import org.sharteman.gymcoach.data.model.MobileProgressSnapshot
import org.sharteman.gymcoach.data.model.MobileVolumeLandmarkRowDto
import org.sharteman.gymcoach.data.model.MobileVolumeLandmarksDto
import org.sharteman.gymcoach.training.fromDisplayWeight
import org.sharteman.gymcoach.training.roundWeight
import org.sharteman.gymcoach.training.toDisplayWeight
import org.sharteman.gymcoach.ui.localization.exerciseDisplayName
import org.sharteman.gymcoach.ui.localization.muscleGroupDisplayName
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

internal data class ProgressDashboardActions(
    val busy: Boolean,
    val onSaveGoal: (String, Double, Int) -> Unit,
    val onDeleteGoal: (String) -> Unit,
    val onSaveVolumeTarget: (String, Int, Int) -> Unit,
    val onClearVolumeTarget: (String) -> Unit,
    val onStartDeload: () -> Unit,
    val onEndDeload: () -> Unit,
)

@Composable
internal fun ProgressDeloadCard(
    deload: MobileDeloadStatusDto,
    actions: ProgressDashboardActions,
) {
    if (!deload.active && !deload.recommended) return
    val active = deload.active
    DashboardCard(modifier = Modifier.testTag("progress-deload-card")) {
        Row(modifier = Modifier.fillMaxWidth()) {
            Icon(
                if (active) Icons.Outlined.BatteryChargingFull else Icons.Outlined.BatterySaver,
                contentDescription = null,
                tint = if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.tertiary,
            )
            Spacer(Modifier.width(8.dp))
            Text(
                stringResource(
                    if (active) R.string.progress_deload_active_title
                    else R.string.progress_deload_due_title,
                ),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
        }
        if (active) {
            Text(
                stringResource(
                    R.string.progress_deload_active_until,
                    deload.until?.let(::formatDashboardDate) ?: "-",
                ),
            )
            OutlinedButton(onClick = actions.onEndDeload, enabled = !actions.busy) {
                Text(stringResource(R.string.progress_deload_end))
            }
        } else {
            if (deload.stalledExerciseNames.isNotEmpty()) {
                Text(
                    stringResource(
                        R.string.progress_deload_stalled_reason,
                        deload.stalledExerciseNames.joinToString(", ") { exerciseDisplayName(it) },
                    ),
                )
            }
            if (deload.averageReadiness != null && deload.readinessCheckins != null) {
                Text(
                    stringResource(
                        R.string.progress_deload_readiness_reason,
                        deload.averageReadiness,
                        deload.readinessCheckins,
                    ),
                )
            }
            OutlinedButton(onClick = actions.onStartDeload, enabled = !actions.busy) {
                Text(stringResource(R.string.progress_deload_start))
            }
        }
    }
}

@Composable
internal fun ProgressLoadingTableCard(exercise: MobileProgressExerciseDto, unit: String) {
    if (exercise.loadingTable.isEmpty()) return
    DashboardCard(modifier = Modifier.testTag("progress-loading-table")) {
        Text(
            stringResource(R.string.progress_loading_table),
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
        )
        Text(
            stringResource(
                R.string.progress_loading_table_description,
                dashboardWeight(exercise.bestEstimated1RM, unit),
            ),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Row(modifier = Modifier.fillMaxWidth()) {
            DashboardCell(stringResource(R.string.progress_percent), 1f, true)
            DashboardCell(stringResource(R.string.progress_load), 1f, true)
        }
        exercise.loadingTable.forEach { row ->
            HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.2f))
            Row(modifier = Modifier.fillMaxWidth()) {
                DashboardCell("${row.percent}%", 1f)
                DashboardCell(
                    "${formatDashboardNumber(row.weight)} ${unit.lowercase(Locale.getDefault())}",
                    1f,
                )
            }
        }
    }
}

@Composable
internal fun ProgressGoalCard(
    exercise: MobileProgressExerciseDto,
    unit: String,
    actions: ProgressDashboardActions,
) {
    var dialogOpen by rememberSaveable(exercise.id) { mutableStateOf(false) }
    var weightField by rememberSaveable(exercise.id, exercise.goal?.id) { mutableStateOf("") }
    var repsField by rememberSaveable(exercise.id, exercise.goal?.id) { mutableStateOf("") }
    var validationError by rememberSaveable(exercise.id) { mutableStateOf(false) }
    val goal = exercise.goal

    fun openDialog() {
        weightField = goal?.targetWeight?.let { formatDashboardNumber(toDisplayWeight(it, unit)) } ?: ""
        repsField = goal?.targetReps?.toString() ?: ""
        validationError = false
        dialogOpen = true
    }

    DashboardCard(modifier = Modifier.testTag("progress-goal-card")) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Row {
                Icon(Icons.Outlined.Flag, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text(
                    stringResource(R.string.progress_goal_title),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
            }
            TextButton(onClick = ::openDialog, enabled = !actions.busy) {
                Text(
                    stringResource(
                        if (goal == null) R.string.progress_goal_set else R.string.progress_goal_edit,
                    ),
                )
            }
        }
        if (goal == null) {
            Text(
                stringResource(R.string.progress_goal_empty),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(
                    stringResource(
                        R.string.progress_goal_target,
                        dashboardWeight(goal.targetWeight, unit),
                        goal.targetReps,
                    ),
                    fontWeight = FontWeight.Medium,
                )
                if (goal.achievedAt != null) DashboardPill(stringResource(R.string.progress_goal_achieved))
            }
            LinearProgressIndicator(
                progress = { goal.progress.toFloat().coerceIn(0f, 1f) },
                modifier = Modifier.fillMaxWidth(),
            )
            Text(
                stringResource(
                    R.string.progress_goal_status,
                    (goal.progress * 100).toInt(),
                    dashboardWeight(exercise.bestEstimated1RM, unit),
                    dashboardWeight(goal.targetEstimated1RM, unit),
                ),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            TextButton(onClick = { actions.onDeleteGoal(goal.id) }, enabled = !actions.busy) {
                Text(stringResource(R.string.progress_goal_remove))
            }
        }
    }

    if (dialogOpen) {
        AlertDialog(
            onDismissRequest = { dialogOpen = false },
            title = { Text(stringResource(R.string.progress_goal_dialog_title)) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedTextField(
                        value = weightField,
                        onValueChange = { weightField = it },
                        label = {
                            Text(
                                stringResource(
                                    R.string.progress_goal_weight,
                                    unit.lowercase(Locale.getDefault()),
                                ),
                            )
                        },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        singleLine = true,
                    )
                    OutlinedTextField(
                        value = repsField,
                        onValueChange = { repsField = it },
                        label = { Text(stringResource(R.string.progress_goal_reps)) },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        singleLine = true,
                    )
                    if (validationError) {
                        Text(
                            stringResource(R.string.progress_goal_invalid),
                            color = MaterialTheme.colorScheme.error,
                        )
                    }
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        val displayWeight = weightField.replace(',', '.').toDoubleOrNull()
                        val reps = repsField.toIntOrNull()
                        if (displayWeight == null || displayWeight <= 0 || reps == null || reps < 1) {
                            validationError = true
                        } else {
                            actions.onSaveGoal(exercise.id, fromDisplayWeight(displayWeight, unit), reps)
                            dialogOpen = false
                        }
                    },
                    enabled = !actions.busy,
                ) { Text(stringResource(R.string.progress_save)) }
            },
            dismissButton = {
                TextButton(onClick = { dialogOpen = false }) { Text(stringResource(R.string.cancel)) }
            },
        )
    }
}

@Composable
internal fun ProgressStalledCard(exercises: List<MobileProgressExerciseDto>) {
    val stalled = exercises.filter { it.recap.stalled }
    if (stalled.isEmpty()) return
    DashboardCard(modifier = Modifier.testTag("progress-stalled-card")) {
        Text(
            stringResource(R.string.progress_stalled_title),
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
        )
        Text(
            stringResource(R.string.progress_stalled_description),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        stalled.forEach { DashboardPill(exerciseDisplayName(it.name)) }
    }
}

@Composable
internal fun ProgressVolumeLandmarksCard(
    landmarks: MobileVolumeLandmarksDto,
    actions: ProgressDashboardActions,
) {
    if (landmarks.rows.isEmpty()) return
    var editing by rememberSaveable { mutableStateOf<String?>(null) }
    val selected = landmarks.rows.firstOrNull { it.muscleGroup == editing }
    DashboardCard(modifier = Modifier.testTag("progress-volume-landmarks")) {
        Text(
            stringResource(R.string.progress_landmarks_title),
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
        )
        Text(
            stringResource(
                R.string.progress_landmarks_description,
                landmarks.weekKey,
                landmarks.defaultMev,
                landmarks.defaultMrv,
            ),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        landmarks.rows.forEach { row ->
            HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.2f))
            Column(modifier = Modifier.fillMaxWidth().padding(vertical = 5.dp)) {
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(muscleGroupDisplayName(row.muscleGroup), fontWeight = FontWeight.Medium)
                    DashboardPill(volumeZoneLabel(row.zone))
                }
                Text(
                    stringResource(
                        R.string.progress_landmark_row,
                        row.sets,
                        row.frequency,
                        row.mev,
                        row.mrv,
                    ),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                TextButton(onClick = { editing = row.muscleGroup }, enabled = !actions.busy) {
                    Icon(Icons.Outlined.Edit, contentDescription = null)
                    Spacer(Modifier.width(5.dp))
                    Text(stringResource(R.string.progress_edit_target))
                }
            }
        }
    }
    if (selected != null) {
        VolumeTargetDialog(
            row = selected,
            busy = actions.busy,
            onDismiss = { editing = null },
            onSave = { mev, mrv ->
                actions.onSaveVolumeTarget(selected.muscleGroup, mev, mrv)
                editing = null
            },
            onReset = {
                actions.onClearVolumeTarget(selected.muscleGroup)
                editing = null
            },
        )
    }
}

@Composable
private fun VolumeTargetDialog(
    row: MobileVolumeLandmarkRowDto,
    busy: Boolean,
    onDismiss: () -> Unit,
    onSave: (Int, Int) -> Unit,
    onReset: () -> Unit,
) {
    var mev by rememberSaveable(row.muscleGroup) { mutableStateOf(row.mev.toString()) }
    var mrv by rememberSaveable(row.muscleGroup) { mutableStateOf(row.mrv.toString()) }
    var invalid by rememberSaveable(row.muscleGroup) { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text(
                stringResource(
                    R.string.progress_volume_target_title,
                    muscleGroupDisplayName(row.muscleGroup),
                ),
            )
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedTextField(
                        value = mev,
                        onValueChange = { mev = it },
                        label = { Text(stringResource(R.string.progress_mev)) },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier.weight(1f),
                    )
                    OutlinedTextField(
                        value = mrv,
                        onValueChange = { mrv = it },
                        label = { Text(stringResource(R.string.progress_mrv)) },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier.weight(1f),
                    )
                }
                if (invalid) Text(
                    stringResource(R.string.progress_volume_target_invalid),
                    color = MaterialTheme.colorScheme.error,
                )
                if (row.custom) {
                    TextButton(onClick = onReset, enabled = !busy) {
                        Text(stringResource(R.string.progress_reset_default))
                    }
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    val min = mev.toIntOrNull()
                    val max = mrv.toIntOrNull()
                    if (min == null || max == null || min !in 1..40 || max !in 1..40 || max <= min) {
                        invalid = true
                    } else onSave(min, max)
                },
                enabled = !busy,
            ) { Text(stringResource(R.string.progress_save)) }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) }
        },
    )
}

@Composable
internal fun ProgressRecordsCard(records: List<MobileExerciseRecordDto>, unit: String) {
    if (records.isEmpty()) return
    DashboardCard(modifier = Modifier.testTag("progress-records-card")) {
        Row {
            Icon(Icons.Outlined.EmojiEvents, contentDescription = null)
            Spacer(Modifier.width(8.dp))
            Text(
                stringResource(R.string.progress_records_title),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
        }
        records.forEach { record ->
            HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.2f))
            Column(modifier = Modifier.padding(vertical = 5.dp)) {
                Text(exerciseDisplayName(record.exerciseName), fontWeight = FontWeight.Medium)
                Text(
                    stringResource(
                        R.string.progress_record_heaviest,
                        dashboardWeight(record.maxWeight, unit),
                        record.maxWeightReps,
                        formatDashboardDay(record.maxWeightDate),
                    ),
                    style = MaterialTheme.typography.bodySmall,
                )
                Text(
                    stringResource(
                        R.string.progress_record_one_rm,
                        dashboardWeight(record.bestEstimated1RM, unit),
                        formatDashboardDay(record.bestEstimated1RMDate),
                    ),
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
    }
}

@Composable
internal fun ProgressRecapCard(exercises: List<MobileProgressExerciseDto>, unit: String) {
    val rows = exercises.filter { it.recap.sessions > 0 }
    if (rows.isEmpty()) return
    DashboardCard(modifier = Modifier.testTag("progress-recap-card")) {
        Text(
            stringResource(R.string.progress_recap_title),
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
        )
        rows.forEach { exercise ->
            HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.2f))
            Column(modifier = Modifier.padding(vertical = 5.dp)) {
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(exerciseDisplayName(exercise.name), fontWeight = FontWeight.Medium)
                    if (exercise.recap.stalled) DashboardPill(stringResource(R.string.progress_stalled_badge))
                }
                Text(
                    stringResource(
                        R.string.progress_recap_row,
                        exercise.recap.sessions,
                        dashboardWeight(exercise.recap.firstWeight, unit),
                        dashboardWeight(exercise.recap.lastWeight, unit),
                        signedDashboardWeight(exercise.recap.estimated1RMDelta, unit),
                    ),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun DashboardCard(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(9.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.45f)),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            content = content,
        )
    }
}

@Composable
private fun DashboardPill(value: String) {
    Surface(shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.secondaryContainer) {
        Text(value, modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp), style = MaterialTheme.typography.labelSmall)
    }
}

@Composable
private fun RowScope.DashboardCell(value: String, weight: Float, header: Boolean = false) {
    Text(
        value,
        modifier = Modifier.weight(weight).padding(vertical = 3.dp),
        style = if (header) MaterialTheme.typography.labelSmall else MaterialTheme.typography.bodySmall,
        fontWeight = if (header) FontWeight.SemiBold else FontWeight.Normal,
        textAlign = TextAlign.Start,
    )
}

@Composable
private fun volumeZoneLabel(zone: String): String = stringResource(
    when (zone) {
        "BELOW_MEV" -> R.string.progress_zone_below
        "ABOVE_MRV" -> R.string.progress_zone_above
        else -> R.string.progress_zone_within
    },
)

private fun dashboardWeight(valueKg: Double, unit: String): String =
    "${formatDashboardNumber(roundWeight(toDisplayWeight(valueKg, unit), 1))} ${unit.lowercase(Locale.getDefault())}"

private fun signedDashboardWeight(valueKg: Double, unit: String): String {
    val value = roundWeight(toDisplayWeight(valueKg, unit), 1)
    return "${if (value > 0) "+" else ""}${formatDashboardNumber(value)} ${unit.lowercase(Locale.getDefault())}"
}

private fun formatDashboardNumber(value: Double): String = if (value % 1.0 == 0.0) {
    value.toInt().toString()
} else {
    String.format(Locale.getDefault(), "%.1f", value).trimEnd('0').trimEnd('.', ',')
}

private fun formatDashboardDate(value: String): String = runCatching {
    Instant.parse(value).atZone(ZoneId.systemDefault())
        .format(DateTimeFormatter.ofPattern("dd MMM yyyy", Locale.getDefault()))
}.getOrElse { value.take(10) }

private fun formatDashboardDay(value: String): String = runCatching {
    LocalDate.parse(value).format(DateTimeFormatter.ofPattern("dd.MM.yyyy", Locale.getDefault()))
}.getOrElse { value }
