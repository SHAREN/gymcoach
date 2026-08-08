package org.sharteman.gymcoach.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import org.sharteman.gymcoach.R
import org.sharteman.gymcoach.data.model.ProgramExerciseDto
import org.sharteman.gymcoach.data.model.WorkoutStructureDraft
import org.sharteman.gymcoach.ui.localization.exerciseDisplayName

internal enum class WorkoutStructureChangeKind {
    ADDED,
    REMOVED,
    REPLACED,
    ORDER,
    TARGET_SETS,
    TARGET_DROP_SETS,
    TARGET_REPS,
    TARGET_RIR,
    REST,
    TEMPO,
    NOTES,
    SUPERSET,
    AUTOREGULATION,
    FATIGUE_RATE,
    LOAD_ADJUSTMENT,
}

internal data class WorkoutStructureChange(
    val programExerciseId: String,
    val exerciseName: String,
    val kind: WorkoutStructureChangeKind,
    val before: String?,
    val after: String?,
)

internal fun workoutStructureChanges(draft: WorkoutStructureDraft): List<WorkoutStructureChange> {
    val baseline = draft.baseline.exercises.associateBy { it.id }
    val current = draft.current.exercises.associateBy { it.id }
    val changes = mutableListOf<WorkoutStructureChange>()

    draft.baseline.exercises.forEach { old ->
        if (old.id !in current) {
            changes += WorkoutStructureChange(
                programExerciseId = old.id,
                exerciseName = old.exercise.name,
                kind = WorkoutStructureChangeKind.REMOVED,
                before = old.exercise.name,
                after = null,
            )
        }
    }
    draft.current.exercises.forEach { next ->
        val old = baseline[next.id]
        if (old == null) {
            changes += WorkoutStructureChange(
                programExerciseId = next.id,
                exerciseName = next.exercise.name,
                kind = WorkoutStructureChangeKind.ADDED,
                before = null,
                after = next.exercise.name,
            )
        } else {
            changes += exerciseStructureChanges(old, next)
        }
    }

    return changes
}

private fun exerciseStructureChanges(
    old: ProgramExerciseDto,
    next: ProgramExerciseDto,
): List<WorkoutStructureChange> = buildList {
    fun record(kind: WorkoutStructureChangeKind, before: Any?, after: Any?) {
        if (before == after) return
        this@buildList.add(
            WorkoutStructureChange(
                programExerciseId = next.id,
                exerciseName = next.exercise.name,
                kind = kind,
                before = before?.toString(),
                after = after?.toString(),
            ),
        )
    }
    record(
        WorkoutStructureChangeKind.REPLACED,
        old.exercise.name.takeIf { old.exerciseId != next.exerciseId },
        next.exercise.name.takeIf { old.exerciseId != next.exerciseId },
    )
    record(WorkoutStructureChangeKind.ORDER, old.order + 1, next.order + 1)
    record(WorkoutStructureChangeKind.TARGET_SETS, old.targetSets, next.targetSets)
    record(WorkoutStructureChangeKind.TARGET_DROP_SETS, old.targetDropSets, next.targetDropSets)
    record(
        WorkoutStructureChangeKind.TARGET_REPS,
        "${old.targetRepsMin}-${old.targetRepsMax}",
        "${next.targetRepsMin}-${next.targetRepsMax}",
    )
    record(WorkoutStructureChangeKind.TARGET_RIR, old.targetRIR, next.targetRIR)
    record(WorkoutStructureChangeKind.REST, old.restSec, next.restSec)
    record(WorkoutStructureChangeKind.TEMPO, old.tempo, next.tempo)
    record(WorkoutStructureChangeKind.NOTES, old.notes, next.notes)
    record(WorkoutStructureChangeKind.SUPERSET, old.supersetGroup, next.supersetGroup)
    record(WorkoutStructureChangeKind.AUTOREGULATION, old.autoregulationMode, next.autoregulationMode)
    record(WorkoutStructureChangeKind.FATIGUE_RATE, old.fatigueRate, next.fatigueRate)
    record(WorkoutStructureChangeKind.LOAD_ADJUSTMENT, old.loadAdjustmentPct, next.loadAdjustmentPct)
}

@Composable
internal fun WorkoutProgramDecisionDialog(
    draft: WorkoutStructureDraft,
    busy: Boolean,
    onApply: () -> Unit,
    onKeepForSession: () -> Unit,
    onLater: () -> Unit,
) {
    val changes = workoutStructureChanges(draft)
    val grouped = changes.groupBy { it.exerciseName }
    AlertDialog(
        modifier = Modifier.testTag("workout-program-decision-dialog"),
        onDismissRequest = { if (!busy) onLater() },
        title = { Text(stringResource(R.string.workout_program_decision_title)) },
        text = {
            Column(
                modifier = Modifier
                    .heightIn(max = 460.dp)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(stringResource(R.string.workout_program_decision_intro))
                grouped.forEach { (exerciseName, exerciseChanges) ->
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        colors = CardDefaults.cardColors(
                            containerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
                        ),
                    ) {
                        Column(
                            modifier = Modifier.padding(12.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Text(
                                exerciseDisplayName(exerciseName),
                                style = MaterialTheme.typography.titleSmall,
                            )
                            exerciseChanges.forEach { change ->
                                WorkoutStructureChangeRow(change)
                            }
                        }
                    }
                }
                Text(
                    stringResource(R.string.workout_program_decision_history_saved),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        },
        confirmButton = {
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Button(
                    onClick = onApply,
                    enabled = !busy,
                    modifier = Modifier.fillMaxWidth().testTag("save-structure-to-program"),
                ) {
                    Text(stringResource(R.string.workout_program_decision_apply))
                }
                OutlinedButton(
                    onClick = onKeepForSession,
                    enabled = !busy,
                    modifier = Modifier.fillMaxWidth().testTag("keep-structure-for-session"),
                ) {
                    Text(stringResource(R.string.workout_program_decision_keep))
                }
                TextButton(
                    onClick = onLater,
                    enabled = !busy,
                    modifier = Modifier.align(Alignment.End),
                ) {
                    Text(stringResource(R.string.workout_program_decision_later))
                }
            }
        },
        dismissButton = {},
    )
}

@Composable
private fun WorkoutStructureChangeRow(change: WorkoutStructureChange) {
    val label = workoutStructureChangeLabel(change.kind)
    val missing = stringResource(R.string.workout_program_change_not_set)
    val description = when (change.kind) {
        WorkoutStructureChangeKind.ADDED -> stringResource(
            R.string.workout_program_change_added,
            exerciseDisplayName(change.after.orEmpty()),
        )
        WorkoutStructureChangeKind.REMOVED -> stringResource(
            R.string.workout_program_change_removed,
            exerciseDisplayName(change.before.orEmpty()),
        )
        else -> stringResource(
            R.string.workout_program_change_before_after,
            label,
            change.before?.takeIf { it.isNotBlank() } ?: missing,
            change.after?.takeIf { it.isNotBlank() } ?: missing,
        )
    }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .semantics { contentDescription = description },
        verticalAlignment = Alignment.Top,
    ) {
        Icon(
            Icons.Outlined.Info,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.primary,
        )
        Spacer(Modifier.width(8.dp))
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(description, style = MaterialTheme.typography.bodyMedium)
        }
    }
}

@Composable
private fun workoutStructureChangeLabel(kind: WorkoutStructureChangeKind): String = stringResource(
    when (kind) {
        WorkoutStructureChangeKind.ADDED -> R.string.workout_program_change_label_added
        WorkoutStructureChangeKind.REMOVED -> R.string.workout_program_change_label_removed
        WorkoutStructureChangeKind.REPLACED -> R.string.workout_program_change_label_replaced
        WorkoutStructureChangeKind.ORDER -> R.string.workout_program_change_label_order
        WorkoutStructureChangeKind.TARGET_SETS -> R.string.workout_program_change_label_sets
        WorkoutStructureChangeKind.TARGET_DROP_SETS -> R.string.workout_program_change_label_drop_sets
        WorkoutStructureChangeKind.TARGET_REPS -> R.string.workout_program_change_label_reps
        WorkoutStructureChangeKind.TARGET_RIR -> R.string.workout_program_change_label_rir
        WorkoutStructureChangeKind.REST -> R.string.workout_program_change_label_rest
        WorkoutStructureChangeKind.TEMPO -> R.string.workout_program_change_label_tempo
        WorkoutStructureChangeKind.NOTES -> R.string.workout_program_change_label_notes
        WorkoutStructureChangeKind.SUPERSET -> R.string.workout_program_change_label_superset
        WorkoutStructureChangeKind.AUTOREGULATION -> R.string.workout_program_change_label_autoregulation
        WorkoutStructureChangeKind.FATIGUE_RATE -> R.string.workout_program_change_label_fatigue
        WorkoutStructureChangeKind.LOAD_ADJUSTMENT -> R.string.workout_program_change_label_adjustment
    },
)
