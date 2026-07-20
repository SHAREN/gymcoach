@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package org.sharteman.gymcoach.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.FitnessCenter
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.sharteman.gymcoach.R
import org.sharteman.gymcoach.data.model.ExerciseDto
import org.sharteman.gymcoach.data.settings.SettingsBarbellSystemProfileInput
import org.sharteman.gymcoach.data.settings.SettingsDumbbellsSystemProfileInput
import org.sharteman.gymcoach.data.settings.SettingsSnapshot
import org.sharteman.gymcoach.data.settings.resolveSettingsEquipmentType
import org.sharteman.gymcoach.ui.localization.exerciseDisplayName

@Composable
internal fun SystemEquipmentProfilesSection(
    snapshot: SettingsSnapshot?,
    gymId: String?,
    dumbbellsEditor: DumbbellsProfileDraft?,
    barbellEditor: BarbellProfileDraft?,
    busy: Boolean,
    error: String?,
    onEditDumbbells: (DumbbellsProfileDraft) -> Unit,
    onEditBarbell: (BarbellProfileDraft) -> Unit,
    onDumbbellsChange: (DumbbellsProfileDraft) -> Unit,
    onBarbellChange: (BarbellProfileDraft) -> Unit,
    onDismissEditor: () -> Unit,
    onSaveDumbbells: (SettingsDumbbellsSystemProfileInput) -> Unit,
    onSaveBarbell: (SettingsBarbellSystemProfileInput) -> Unit,
) {
    val inventory = gymId?.let { snapshot?.gymInventories?.get(it) }
    val profiles = inventory?.systemProfiles
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
            .testTag("settings-system-profiles-section"),
        shape = RoundedCornerShape(14.dp),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(
                stringResource(R.string.settings_system_profiles_title),
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                stringResource(R.string.settings_system_profiles_description),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            when {
                gymId == null -> Text(
                    stringResource(R.string.settings_system_profiles_save_gym_first),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                profiles == null -> Text(
                    stringResource(R.string.settings_system_profiles_unavailable),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
                else -> {
                    val largeFamily = profiles.barbell.families.first { it.family == "LARGE" }
                    val smallFamily = profiles.barbell.families.first { it.family == "SMALL" }
                    val barbellDetails = listOf(
                        stringResource(
                            R.string.settings_system_family_large_summary,
                            formatWeightList(largeFamily.bars.map { it.baseLoadKg }),
                            largeFamily.pool.plates.size,
                            largeFamily.loadingSides,
                        ),
                        stringResource(
                            R.string.settings_system_family_small_summary,
                            formatWeightList(smallFamily.bars.map { it.baseLoadKg }),
                            smallFamily.pool.plates.size,
                            smallFamily.loadingSides,
                        ),
                    ).joinToString("\n")
                    SystemProfileCard(
                        tag = "settings-system-profile-dumbbells",
                        title = stringResource(R.string.settings_system_dumbbells_title),
                        summary = stringResource(
                            R.string.settings_system_dumbbells_summary,
                            profiles.dumbbells.weightsKg.size,
                            profiles.dumbbells.exerciseLinks.size,
                        ),
                        details = profiles.dumbbells.weightsKg
                            .takeIf { it.isNotEmpty() }
                            ?.let(::formatWeightList)
                            ?: stringResource(R.string.settings_system_dumbbells_no_weights),
                        editDescription = stringResource(R.string.settings_system_dumbbells_edit),
                        busy = busy,
                        onEdit = { onEditDumbbells(profiles.dumbbells.toDraft()) },
                    )
                    SystemProfileCard(
                        tag = "settings-system-profile-barbell",
                        title = stringResource(R.string.settings_system_barbell_title),
                        summary = stringResource(
                            R.string.settings_system_barbell_summary,
                            profiles.barbell.exerciseLinks.size,
                        ),
                        details = barbellDetails,
                        editDescription = stringResource(R.string.settings_system_barbell_edit),
                        busy = busy,
                        onEdit = { onEditBarbell(profiles.barbell.toDraft()) },
                    )
                }
            }
        }
    }

    dumbbellsEditor?.let { draft ->
        DumbbellsProfileDialog(
            draft = draft,
            exercises = inventory?.exerciseCoverage.orEmpty().ifEmpty { snapshot?.exercises.orEmpty() },
            busy = busy,
            serverError = error,
            onChange = onDumbbellsChange,
            onSave = onSaveDumbbells,
            onDismiss = onDismissEditor,
        )
    }
    barbellEditor?.let { draft ->
        BarbellProfileDialog(
            draft = draft,
            exercises = inventory?.exerciseCoverage.orEmpty().ifEmpty { snapshot?.exercises.orEmpty() },
            busy = busy,
            serverError = error,
            onChange = onBarbellChange,
            onSave = onSaveBarbell,
            onDismiss = onDismissEditor,
        )
    }
}

@Composable
private fun SystemProfileCard(
    tag: String,
    title: String,
    summary: String,
    details: String,
    editDescription: String,
    busy: Boolean,
    onEdit: () -> Unit,
) {
    Card(modifier = Modifier.fillMaxWidth().testTag(tag)) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(Icons.Default.FitnessCenter, contentDescription = null)
                Column(Modifier.weight(1f)) {
                    Text(title, fontWeight = FontWeight.SemiBold)
                    Text(
                        summary,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                IconButton(
                    onClick = onEdit,
                    enabled = !busy,
                    modifier = Modifier.testTag("$tag-edit"),
                ) {
                    Icon(Icons.Default.Edit, contentDescription = editDescription)
                }
            }
            AssistChip(
                onClick = {},
                enabled = false,
                label = { Text(stringResource(R.string.settings_system_profile_badge)) },
            )
            Text(details, style = MaterialTheme.typography.bodySmall)
            Text(
                stringResource(R.string.settings_system_profile_non_removable),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun DumbbellsProfileDialog(
    draft: DumbbellsProfileDraft,
    exercises: List<ExerciseDto>,
    busy: Boolean,
    serverError: String?,
    onChange: (DumbbellsProfileDraft) -> Unit,
    onSave: (SettingsDumbbellsSystemProfileInput) -> Unit,
    onDismiss: () -> Unit,
) {
    var invalid by remember(draft) { mutableStateOf(false) }
    AlertDialog(
        modifier = Modifier.testTag("settings-dumbbells-profile-editor"),
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.settings_system_dumbbells_dialog_title)) },
        text = {
            Column(
                modifier = Modifier.heightIn(max = 600.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text(
                    stringResource(R.string.settings_system_dumbbells_dialog_description),
                    style = MaterialTheme.typography.bodySmall,
                )
                OutlinedTextField(
                    value = draft.weights,
                    onValueChange = { onChange(draft.copy(weights = it)) },
                    enabled = !busy,
                    label = { Text(stringResource(R.string.settings_system_dumbbells_weights)) },
                    supportingText = {
                        Text(stringResource(R.string.settings_system_dumbbells_weights_help))
                    },
                    modifier = Modifier.fillMaxWidth().testTag("settings-system-dumbbell-weights"),
                    singleLine = true,
                    isError = invalid,
                )
                ExerciseSupportPicker(
                    targetType = "DUMBBELL",
                    exercises = exercises,
                    selected = draft.exerciseIds,
                    busy = busy,
                    onChange = { onChange(draft.copy(exerciseIds = it)) },
                )
                ProfileDialogError(serverError ?: if (invalid) {
                    stringResource(R.string.settings_system_dumbbells_invalid)
                } else null)
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    val input = draft.toInputOrNull()
                    invalid = input == null
                    if (input != null) onSave(input)
                },
                enabled = !busy,
                modifier = Modifier.testTag("settings-save-dumbbells-profile"),
            ) { Text(stringResource(R.string.settings_native_save)) }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !busy) {
                Text(stringResource(R.string.settings_native_cancel))
            }
        },
    )
}

@Composable
private fun BarbellProfileDialog(
    draft: BarbellProfileDraft,
    exercises: List<ExerciseDto>,
    busy: Boolean,
    serverError: String?,
    onChange: (BarbellProfileDraft) -> Unit,
    onSave: (SettingsBarbellSystemProfileInput) -> Unit,
    onDismiss: () -> Unit,
) {
    var invalid by remember(draft) { mutableStateOf(false) }
    AlertDialog(
        modifier = Modifier.testTag("settings-barbell-profile-editor"),
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.settings_system_barbell_dialog_title)) },
        text = {
            Column(
                modifier = Modifier.heightIn(max = 650.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(
                    stringResource(R.string.settings_system_barbell_dialog_description),
                    style = MaterialTheme.typography.bodySmall,
                )
                draft.families.forEach { family ->
                    BarbellFamilyEditor(
                        family = family,
                        busy = busy,
                        onChange = { next ->
                            onChange(
                                draft.copy(
                                    families = draft.families.map {
                                        if (it.family == next.family) next else it
                                    },
                                ),
                            )
                        },
                    )
                }
                ExerciseSupportPicker(
                    targetType = "BARBELL",
                    exercises = exercises,
                    selected = draft.exerciseIds,
                    busy = busy,
                    onChange = { onChange(draft.copy(exerciseIds = it)) },
                )
                ProfileDialogError(serverError ?: if (invalid) {
                    stringResource(R.string.settings_system_barbell_invalid)
                } else null)
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    val input = draft.toInputOrNull()
                    invalid = input == null
                    if (input != null) onSave(input)
                },
                enabled = !busy,
                modifier = Modifier.testTag("settings-save-barbell-profile"),
            ) { Text(stringResource(R.string.settings_native_save)) }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !busy) {
                Text(stringResource(R.string.settings_native_cancel))
            }
        },
    )
}

@Composable
private fun BarbellFamilyEditor(
    family: BarbellFamilyDraft,
    busy: Boolean,
    onChange: (BarbellFamilyDraft) -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth().testTag("settings-barbell-family-${family.family}"),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(9.dp),
        ) {
            Text(
                stringResource(
                    if (family.family == "LARGE") R.string.settings_system_family_large_title
                    else R.string.settings_system_family_small_title,
                ),
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                stringResource(
                    if (family.family == "LARGE") R.string.settings_system_family_large_description
                    else R.string.settings_system_family_small_description,
                ),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            OutlinedTextField(
                value = family.loadingSides,
                onValueChange = { onChange(family.copy(loadingSides = it)) },
                enabled = !busy,
                label = { Text(stringResource(R.string.settings_system_loading_sides)) },
                supportingText = { Text(stringResource(R.string.settings_system_loading_sides_help)) },
                modifier = Modifier.fillMaxWidth().testTag("settings-loading-sides-${family.family}"),
                singleLine = true,
            )
            Text(stringResource(R.string.settings_system_bar_weights), fontWeight = FontWeight.Medium)
            family.bars.forEach { bar ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    OutlinedTextField(
                        value = bar.weight,
                        onValueChange = { value ->
                            onChange(
                                family.copy(
                                    bars = family.bars.map {
                                        if (it.key == bar.key) it.copy(weight = value) else it
                                    },
                                ),
                            )
                        },
                        enabled = !busy,
                        label = { Text(stringResource(R.string.settings_system_weight_kg)) },
                        modifier = Modifier.weight(1f)
                            .testTag("settings-bar-${family.family}-${bar.key}-weight"),
                        singleLine = true,
                    )
                    IconButton(
                        onClick = {
                            onChange(family.copy(bars = family.bars.filterNot { it.key == bar.key }))
                        },
                        enabled = !busy,
                    ) {
                        Icon(
                            Icons.Default.Delete,
                            contentDescription = stringResource(R.string.settings_system_remove_bar),
                        )
                    }
                }
            }
            OutlinedButton(
                onClick = {
                    val key = nextSystemProfileKey(family.bars.map { it.key })
                    onChange(family.copy(bars = family.bars + SystemBarDraft(key = key)))
                },
                enabled = !busy,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Icon(Icons.Default.Add, contentDescription = null)
                Text(stringResource(R.string.settings_system_add_bar), Modifier.padding(start = 6.dp))
            }
            HorizontalDivider()
            Text(stringResource(R.string.settings_system_plates), fontWeight = FontWeight.Medium)
            family.plates.forEach { plate ->
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(
                        modifier = Modifier.fillMaxWidth().padding(8.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        OutlinedTextField(
                            value = plate.weight,
                            onValueChange = { value ->
                                onChange(
                                    family.copy(
                                        plates = family.plates.map {
                                            if (it.key == plate.key) it.copy(weight = value) else it
                                        },
                                    ),
                                )
                            },
                            enabled = !busy,
                            label = { Text(stringResource(R.string.settings_system_plate_weight)) },
                            modifier = Modifier.fillMaxWidth()
                                .testTag("settings-plate-${family.family}-${plate.key}-weight"),
                            singleLine = true,
                        )
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            OutlinedTextField(
                                value = plate.quantity,
                                onValueChange = { value ->
                                    onChange(
                                        family.copy(
                                            plates = family.plates.map {
                                                if (it.key == plate.key) it.copy(quantity = value) else it
                                            },
                                        ),
                                    )
                                },
                                enabled = !busy,
                                label = { Text(stringResource(R.string.settings_system_plate_quantity)) },
                                supportingText = {
                                    Text(stringResource(R.string.settings_system_unknown_quantity))
                                },
                                modifier = Modifier.weight(1f)
                                    .testTag("settings-plate-${family.family}-${plate.key}-quantity"),
                                singleLine = true,
                            )
                            IconButton(
                                onClick = {
                                    onChange(
                                        family.copy(
                                            plates = family.plates.filterNot { it.key == plate.key },
                                        ),
                                    )
                                },
                                enabled = !busy,
                            ) {
                                Icon(
                                    Icons.Default.Delete,
                                    contentDescription = stringResource(R.string.settings_system_remove_plate),
                                )
                            }
                        }
                    }
                }
            }
            OutlinedButton(
                onClick = {
                    val key = nextSystemProfileKey(family.plates.map { it.key })
                    onChange(family.copy(plates = family.plates + SystemPlateDraft(key = key)))
                },
                enabled = !busy,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Icon(Icons.Default.Add, contentDescription = null)
                Text(stringResource(R.string.settings_system_add_plate), Modifier.padding(start = 6.dp))
            }
        }
    }
}

@Composable
private fun ExerciseSupportPicker(
    targetType: String,
    exercises: List<ExerciseDto>,
    selected: Set<String>,
    busy: Boolean,
    onChange: (Set<String>) -> Unit,
) {
    var search by remember(targetType) { mutableStateOf("") }
    val matching = remember(exercises, targetType) {
        exercises.filter { resolveSettingsEquipmentType(it.equipmentType, it.name) == targetType }
    }
    val filtered = remember(matching, search) {
        val query = search.trim().lowercase()
        if (query.isEmpty()) matching else matching.filter {
            exerciseDisplayName(it.name).lowercase().contains(query)
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        HorizontalDivider()
        Text(stringResource(R.string.settings_system_supported_exercises), fontWeight = FontWeight.Medium)
        Text(
            stringResource(R.string.settings_system_supported_exercises_help),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(
                onClick = { onChange(matching.mapTo(linkedSetOf()) { it.id }) },
                enabled = !busy,
            ) { Text(stringResource(R.string.settings_system_select_matching)) }
            OutlinedButton(onClick = { onChange(emptySet()) }, enabled = !busy) {
                Text(stringResource(R.string.settings_system_clear_exercises))
            }
        }
        OutlinedTextField(
            value = search,
            onValueChange = { search = it },
            enabled = !busy,
            leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
            label = { Text(stringResource(R.string.settings_system_search_exercises)) },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )
        filtered.forEach { exercise ->
            val name = exerciseDisplayName(exercise.name)
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(name, Modifier.weight(1f), maxLines = 2, overflow = TextOverflow.Ellipsis)
                val description = stringResource(R.string.settings_system_exercise_supported, name)
                Switch(
                    checked = exercise.id in selected,
                    onCheckedChange = { checked ->
                        val next = selected.toMutableSet()
                        if (checked) next.add(exercise.id) else next.remove(exercise.id)
                        onChange(next)
                    },
                    enabled = !busy,
                    modifier = Modifier
                        .testTag("settings-system-exercise-${exercise.id}")
                        .semantics { contentDescription = description },
                )
            }
        }
    }
}

@Composable
private fun ProfileDialogError(message: String?) {
    message?.let {
        Text(
            it,
            color = MaterialTheme.colorScheme.error,
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.testTag("settings-system-profile-error"),
        )
    }
}
