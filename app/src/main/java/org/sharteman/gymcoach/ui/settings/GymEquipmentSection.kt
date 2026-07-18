@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package org.sharteman.gymcoach.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Upload
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import coil.request.ImageRequest
import org.sharteman.gymcoach.R
import org.sharteman.gymcoach.data.model.ExerciseDto
import org.sharteman.gymcoach.data.settings.SettingsGymEquipmentDto
import org.sharteman.gymcoach.data.settings.SettingsSnapshot
import org.sharteman.gymcoach.data.settings.customEquipment
import org.sharteman.gymcoach.ui.localization.exerciseDisplayName

@Composable
internal fun GymEquipmentSection(
    snapshot: SettingsSnapshot?,
    gymId: String?,
    editor: GymEquipmentDraft?,
    busy: Boolean,
    imageAuthorization: String?,
    onNew: () -> Unit,
    onEdit: (SettingsGymEquipmentDto) -> Unit,
    onEditorChange: (GymEquipmentDraft) -> Unit,
    onDismissEditor: () -> Unit,
    onSave: () -> Unit,
    onDelete: (SettingsGymEquipmentDto) -> Unit,
    onUploadImage: () -> Unit,
    onSetImageUrl: () -> Unit,
    onClearImage: () -> Unit,
) {
    val inventory = gymId?.let { snapshot?.gymInventories?.get(it) }
    val customEquipment = inventory?.customEquipment().orEmpty()
    Card(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).testTag("settings-equipment-section"),
        shape = RoundedCornerShape(14.dp),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(stringResource(R.string.settings_equipment_title), fontWeight = FontWeight.SemiBold)
                    Text(
                        stringResource(R.string.settings_equipment_description),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                IconButton(
                    onClick = onNew,
                    enabled = gymId != null && !busy,
                    modifier = Modifier.testTag("settings-add-equipment"),
                ) {
                    Icon(Icons.Default.Add, contentDescription = stringResource(R.string.settings_equipment_add))
                }
            }
            if (gymId == null) {
                Text(
                    stringResource(R.string.settings_equipment_save_gym_first),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else if (customEquipment.isEmpty()) {
                Text(
                    stringResource(R.string.settings_equipment_empty),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                customEquipment.forEach { item ->
                    EquipmentCard(
                        item = item,
                        imageAuthorization = imageAuthorization,
                        busy = busy,
                        onEdit = { onEdit(item) },
                        onDelete = { onDelete(item) },
                    )
                }
            }
        }
    }

    editor?.let { draft ->
        EquipmentEditorDialog(
            draft = draft,
            exercises = snapshot?.exercises.orEmpty(),
            busy = busy,
            onChange = onEditorChange,
            onSave = onSave,
            onDismiss = onDismissEditor,
            onUploadImage = onUploadImage,
            onSetImageUrl = onSetImageUrl,
            onClearImage = onClearImage,
        )
    }
}

@Composable
private fun EquipmentCard(
    item: SettingsGymEquipmentDto,
    imageAuthorization: String?,
    busy: Boolean,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
) {
    val context = LocalContext.current
    Card(modifier = Modifier.fillMaxWidth().testTag("settings-equipment-card-${item.id}")) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(10.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val image = item.image
            if (image != null) {
                val request = remember(image.url, image.kind, imageAuthorization) {
                    ImageRequest.Builder(context)
                        .data(image.url)
                        .crossfade(true)
                        .apply {
                            if (image.kind == "uploaded" && imageAuthorization != null) {
                                addHeader("Authorization", imageAuthorization)
                            }
                        }
                        .build()
                }
                AsyncImage(
                    model = request,
                    contentDescription = item.name,
                    modifier = Modifier.size(82.dp).clip(RoundedCornerShape(10.dp)),
                    contentScale = ContentScale.Crop,
                )
            } else {
                Box(
                    modifier = Modifier
                        .size(82.dp)
                        .clip(RoundedCornerShape(10.dp))
                        .background(MaterialTheme.colorScheme.surfaceVariant),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.Default.Image, contentDescription = null)
                }
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(item.name, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(
                    stringResource(
                        R.string.settings_equipment_card_type_quantity,
                        equipmentTypeLabel(item.equipmentType),
                        item.quantity,
                    ),
                    style = MaterialTheme.typography.bodySmall,
                )
                val maker = listOfNotNull(item.manufacturer, item.modelName).joinToString(" ")
                if (maker.isNotBlank()) {
                    Text(maker, style = MaterialTheme.typography.bodySmall, maxLines = 1)
                }
                item.description?.takeIf { it.isNotBlank() }?.let { description ->
                    Text(
                        description,
                        style = MaterialTheme.typography.bodySmall,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                if (item.weightOptions.isNotEmpty()) {
                    Text(
                        stringResource(
                            R.string.settings_equipment_card_weights,
                            formatWeightList(item.weightOptions),
                        ),
                        style = MaterialTheme.typography.bodySmall,
                        maxLines = 2,
                    )
                }
                Text(
                    stringResource(R.string.settings_equipment_card_exercises, item.exerciseLinks.size),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Column {
                IconButton(onClick = onEdit, enabled = !busy) {
                    Icon(Icons.Default.Edit, contentDescription = stringResource(R.string.settings_equipment_edit))
                }
                IconButton(onClick = onDelete, enabled = !busy) {
                    Icon(Icons.Default.Delete, contentDescription = stringResource(R.string.settings_equipment_delete))
                }
            }
        }
    }
}

@Composable
private fun EquipmentEditorDialog(
    draft: GymEquipmentDraft,
    exercises: List<ExerciseDto>,
    busy: Boolean,
    onChange: (GymEquipmentDraft) -> Unit,
    onSave: () -> Unit,
    onDismiss: () -> Unit,
    onUploadImage: () -> Unit,
    onSetImageUrl: () -> Unit,
    onClearImage: () -> Unit,
) {
    var exercisePickerOpen by remember { mutableStateOf(false) }
    AlertDialog(
        modifier = Modifier.testTag("settings-equipment-editor"),
        onDismissRequest = onDismiss,
        title = {
            Text(
                stringResource(
                    if (draft.id == null) R.string.settings_equipment_add
                    else R.string.settings_equipment_edit,
                ),
            )
        },
        text = {
            Column(
                modifier = Modifier.heightIn(max = 540.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(9.dp),
            ) {
                OutlinedTextField(
                    value = draft.name,
                    onValueChange = { onChange(draft.copy(name = it)) },
                    label = { Text(stringResource(R.string.settings_equipment_name)) },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                )
                EquipmentTypeDropdown(draft.equipmentType) { onChange(draft.copy(equipmentType = it)) }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = draft.quantity,
                        onValueChange = { onChange(draft.copy(quantity = it)) },
                        label = { Text(stringResource(R.string.settings_equipment_quantity)) },
                        modifier = Modifier.weight(0.35f),
                        singleLine = true,
                    )
                    OutlinedTextField(
                        value = draft.manufacturer,
                        onValueChange = { onChange(draft.copy(manufacturer = it)) },
                        label = { Text(stringResource(R.string.settings_equipment_manufacturer)) },
                        modifier = Modifier.weight(0.65f),
                        singleLine = true,
                    )
                }
                OutlinedTextField(
                    value = draft.modelName,
                    onValueChange = { onChange(draft.copy(modelName = it)) },
                    label = { Text(stringResource(R.string.settings_equipment_model)) },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                )
                OutlinedTextField(
                    value = draft.description,
                    onValueChange = { onChange(draft.copy(description = it)) },
                    label = { Text(stringResource(R.string.settings_equipment_item_description)) },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 2,
                    maxLines = 4,
                )
                OutlinedTextField(
                    value = draft.weightOptions,
                    onValueChange = { onChange(draft.copy(weightOptions = it)) },
                    label = { Text(stringResource(R.string.settings_equipment_weight_options)) },
                    supportingText = { Text(stringResource(R.string.settings_native_weight_hint)) },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                )
                Text(stringResource(R.string.settings_equipment_linked_exercises), fontWeight = FontWeight.Medium)
                Box {
                    OutlinedButton(
                        onClick = { exercisePickerOpen = true },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(stringResource(R.string.settings_equipment_add_exercise), Modifier.weight(1f))
                        Icon(Icons.Default.MoreVert, contentDescription = null)
                    }
                    DropdownMenu(
                        expanded = exercisePickerOpen,
                        onDismissRequest = { exercisePickerOpen = false },
                    ) {
                        exercises.filterNot { it.id in draft.exerciseIds }.forEach { exercise ->
                            DropdownMenuItem(
                                text = { Text(exerciseDisplayName(exercise.name)) },
                                onClick = {
                                    exercisePickerOpen = false
                                    onChange(draft.copy(exerciseIds = draft.exerciseIds + exercise.id))
                                },
                            )
                        }
                    }
                }
                if (draft.exerciseIds.isNotEmpty()) {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        draft.exerciseIds.forEach { id ->
                            val exercise = exercises.firstOrNull { it.id == id }
                            FilterChip(
                                selected = true,
                                onClick = { onChange(draft.copy(exerciseIds = draft.exerciseIds - id)) },
                                label = { Text(exercise?.name ?: id, maxLines = 1) },
                                trailingIcon = { Icon(Icons.Default.Delete, contentDescription = null) },
                            )
                        }
                    }
                }
                if (draft.id == null) {
                    Text(
                        stringResource(R.string.settings_equipment_save_before_photo),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                } else {
                    Text(stringResource(R.string.settings_equipment_photo), fontWeight = FontWeight.Medium)
                    OutlinedTextField(
                        value = draft.imageUrl,
                        onValueChange = { onChange(draft.copy(imageUrl = it)) },
                        label = { Text(stringResource(R.string.settings_equipment_image_url)) },
                        supportingText = { Text(stringResource(R.string.settings_equipment_https_only)) },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                    )
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = onSetImageUrl, enabled = !busy && draft.imageUrl.isNotBlank()) {
                            Icon(Icons.Default.Image, contentDescription = null)
                            Text(stringResource(R.string.settings_equipment_use_url), Modifier.padding(start = 6.dp))
                        }
                        OutlinedButton(
                            onClick = onUploadImage,
                            enabled = !busy,
                            modifier = Modifier.testTag("settings-upload-equipment-image"),
                        ) {
                            Icon(Icons.Default.Upload, contentDescription = null)
                            Text(stringResource(R.string.settings_equipment_upload), Modifier.padding(start = 6.dp))
                        }
                        if (draft.currentImageKind != null || draft.imageUrl.isNotBlank()) {
                            TextButton(onClick = onClearImage, enabled = !busy) {
                                Text(stringResource(R.string.settings_equipment_remove_photo))
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            Button(
                onClick = onSave,
                enabled = !busy,
                modifier = Modifier.testTag("settings-save-equipment"),
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
private fun EquipmentTypeDropdown(value: String, onSelect: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Column {
        Text(stringResource(R.string.settings_equipment_type), style = MaterialTheme.typography.labelMedium)
        OutlinedButton(onClick = { expanded = true }, modifier = Modifier.fillMaxWidth()) {
            Text(equipmentTypeLabel(value), Modifier.weight(1f))
            Icon(Icons.Default.MoreVert, contentDescription = null)
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            gymEquipmentTypes.forEach { type ->
                DropdownMenuItem(
                    text = { Text(equipmentTypeLabel(type)) },
                    onClick = {
                        expanded = false
                        onSelect(type)
                    },
                )
            }
        }
    }
}

@Composable
private fun equipmentTypeLabel(value: String): String = when (value) {
    "DUMBBELL" -> stringResource(R.string.settings_equipment_type_dumbbell)
    "BARBELL" -> stringResource(R.string.settings_equipment_type_barbell)
    "MACHINE" -> stringResource(R.string.settings_equipment_type_machine)
    "CABLE" -> stringResource(R.string.settings_equipment_type_cable)
    "BODYWEIGHT" -> stringResource(R.string.settings_equipment_type_bodyweight)
    "CARDIO" -> stringResource(R.string.settings_equipment_type_cardio)
    else -> stringResource(R.string.settings_equipment_type_other)
}
