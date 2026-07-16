package org.sharteman.gymcoach.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import org.sharteman.gymcoach.R
import org.sharteman.gymcoach.training.LoadConstraints
import org.sharteman.gymcoach.training.PlateLoad
import org.sharteman.gymcoach.training.computeBestPlateLoad
import org.sharteman.gymcoach.training.computeEquipmentPlateLoad
import org.sharteman.gymcoach.training.fromDisplayWeight
import org.sharteman.gymcoach.training.roundWeight
import org.sharteman.gymcoach.training.toDisplayWeight
import java.util.Locale
import kotlin.math.roundToInt

enum class SetValuePickerKind {
    WEIGHT,
    REPS,
    RIR,
}

@Composable
fun SetValuePickerDialog(
    kind: SetValuePickerKind,
    value: String,
    options: List<Double>,
    unit: String,
    loadConstraints: LoadConstraints?,
    onDismiss: () -> Unit,
    onConfirm: (String) -> Unit,
) {
    var manualValue by rememberSaveable(kind, value) { mutableStateOf(normalizePickerInput(value)) }
    val listState = rememberLazyListState()
    val normalizedOptions = options.filter { it.isFinite() }.distinct().sorted()
    val optionValues: List<Double?> = if (kind == SetValuePickerKind.RIR) {
        listOf(null) + normalizedOptions
    } else {
        normalizedOptions
    }
    val numericValue = parsePickerNumber(manualValue)
    val selectedIndex = optionValues.indexOfFirst { option ->
        if (option == null) manualValue.isBlank() else numericValue != null && nearlyEqual(option, numericValue)
    }.coerceAtLeast(0)
    val valid = when (kind) {
        SetValuePickerKind.WEIGHT -> numericValue != null &&
            fromDisplayWeight(numericValue, unit) in 0.0..500.0
        SetValuePickerKind.REPS -> numericValue != null && numericValue.roundToInt() in 1..100
        SetValuePickerKind.RIR -> manualValue.isBlank() ||
            numericValue?.roundToInt()?.let { it in 0..5 } == true
    }
    val selectedEquipment = loadConstraints?.equipmentId?.let { equipmentId ->
        loadConstraints.equipmentOptions.firstOrNull { it.equipmentId == equipmentId }
    }
    val plateLoad = if (
        kind == SetValuePickerKind.WEIGHT &&
        selectedEquipment?.loadType == "PLATE_LOADED" &&
        numericValue != null && numericValue > 0
    ) {
        computeEquipmentPlateLoad(
            targetWeight = numericValue,
            baseLoad = roundWeight(toDisplayWeight(selectedEquipment.baseLoadKg, unit), 2),
            availablePlates = selectedEquipment.plates.map { plate ->
                plate.copy(weightKg = roundWeight(toDisplayWeight(plate.weightKg, unit), 2))
            },
            loadingSides = selectedEquipment.loadingSides,
        )
    } else if (
        kind == SetValuePickerKind.WEIGHT &&
        loadConstraints?.equipmentType == "BARBELL" &&
        numericValue != null && numericValue > 0
    ) {
        val fallbackBar = if (unit.equals("LB", ignoreCase = true)) 45.0 else 20.0
        val fallbackPlates = if (unit.equals("LB", ignoreCase = true)) {
            listOf(45.0, 35.0, 25.0, 10.0, 5.0, 2.5)
        } else {
            listOf(25.0, 20.0, 15.0, 10.0, 5.0, 2.5, 1.25)
        }
        val bars = loadConstraints.barWeights.takeIf { it.isNotEmpty() }
            ?.map { roundWeight(toDisplayWeight(it, unit), 2) }
            ?: listOf(fallbackBar)
        val plates = loadConstraints.plateWeights.takeIf { it.isNotEmpty() }
            ?.map { roundWeight(toDisplayWeight(it, unit), 2) }
            ?: fallbackPlates
        computeBestPlateLoad(numericValue, bars, plates, fallbackBar)
    } else {
        null
    }

    LaunchedEffect(kind, value, normalizedOptions) {
        if (optionValues.isNotEmpty()) {
            listState.scrollToItem((selectedIndex - 2).coerceAtLeast(0))
        }
    }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(
            usePlatformDefaultWidth = false,
            decorFitsSystemWindows = false,
        ),
    ) {
        Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            Column(modifier = Modifier.fillMaxSize().safeDrawingPadding()) {
                PickerHeader(kind = kind, unit = unit, onDismiss = onDismiss)
                HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.35f))
                LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxWidth().weight(1f),
                    contentPadding = PaddingValues(horizontal = 24.dp, vertical = 14.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    items(optionValues, key = { it?.toString() ?: "none" }) { option ->
                        val selected = if (option == null) {
                            manualValue.isBlank()
                        } else {
                            numericValue != null && nearlyEqual(option, numericValue)
                        }
                        PickerOption(
                            label = pickerOptionLabel(option, kind, unit),
                            selected = selected,
                            tag = "set-value-option-${kind.name}-${option?.let(::formatPickerNumber) ?: "none"}",
                            onClick = {
                                manualValue = option?.let(::formatPickerNumber).orEmpty()
                            },
                        )
                    }
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.35f))
                Column(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    PickerConfirmationRow(
                        kind = kind,
                        value = manualValue,
                        valid = valid,
                        plateLoad = plateLoad,
                        unit = unit,
                        onConfirm = {
                            val confirmed = when (kind) {
                                SetValuePickerKind.WEIGHT -> numericValue?.let(::formatPickerNumber)
                                SetValuePickerKind.REPS -> numericValue?.roundToInt()?.toString()
                                SetValuePickerKind.RIR -> if (manualValue.isBlank()) {
                                    ""
                                } else {
                                    numericValue?.roundToInt()?.toString()
                                }
                            }
                            if (confirmed != null) onConfirm(confirmed)
                        },
                    )
                    if (kind != SetValuePickerKind.RIR) {
                        PickerKeypad(
                            decimal = kind == SetValuePickerKind.WEIGHT,
                            onKey = { key -> manualValue = appendPickerKey(manualValue, key, kind) },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun PickerHeader(kind: SetValuePickerKind, unit: String, onDismiss: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        TextButton(onClick = onDismiss, modifier = Modifier.width(84.dp)) {
            Text(stringResource(R.string.cancel))
        }
        Text(
            text = when (kind) {
                SetValuePickerKind.WEIGHT -> stringResource(
                    R.string.choose_weight,
                    unit.lowercase(Locale.getDefault()),
                )
                SetValuePickerKind.REPS -> stringResource(R.string.choose_reps)
                SetValuePickerKind.RIR -> stringResource(R.string.choose_rir)
            },
            modifier = Modifier.weight(1f),
            textAlign = TextAlign.Center,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
        )
        Spacer(Modifier.width(84.dp))
    }
}

@Composable
private fun PickerOption(label: String, selected: Boolean, tag: String, onClick: () -> Unit) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .widthIn(max = 250.dp)
            .height(74.dp)
            .testTag(tag)
            .clickable(onClick = onClick),
        shape = RoundedCornerShape(8.dp),
        border = BorderStroke(
            if (selected) 2.dp else 1.dp,
            if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline,
        ),
        colors = CardDefaults.cardColors(
            containerColor = if (selected) {
                MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.55f)
            } else {
                MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f)
            },
        ),
    ) {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text(label, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
private fun PickerConfirmationRow(
    kind: SetValuePickerKind,
    value: String,
    valid: Boolean,
    plateLoad: PlateLoad?,
    unit: String,
    onConfirm: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (plateLoad != null) {
            Box(modifier = Modifier.weight(1.15f)) {
                BarbellSideDiagram(load = plateLoad, unit = unit)
            }
        }
        Surface(
            modifier = Modifier.weight(1f).height(64.dp),
            shape = RoundedCornerShape(8.dp),
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.32f),
        ) {
            Box(contentAlignment = Alignment.Center) {
                Text(
                    text = if (kind == SetValuePickerKind.RIR && value.isBlank()) {
                        stringResource(R.string.not_specified)
                    } else {
                        value.replace(".", pickerDecimalSeparator())
                    },
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.SemiBold,
                )
            }
        }
        Button(
            onClick = onConfirm,
            enabled = valid,
            modifier = Modifier.size(64.dp).testTag("set-value-apply"),
            shape = RoundedCornerShape(8.dp),
            contentPadding = PaddingValues(0.dp),
        ) {
            Icon(
                Icons.Outlined.Check,
                contentDescription = stringResource(R.string.apply_value),
                modifier = Modifier.size(32.dp),
            )
        }
    }
}

@Composable
private fun PickerKeypad(decimal: Boolean, onKey: (String) -> Unit) {
    val rows = listOf(
        listOf("1", "2", "3"),
        listOf("4", "5", "6"),
        listOf("7", "8", "9"),
        listOf(if (decimal) pickerDecimalSeparator() else "", "0", "backspace"),
    )
    Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
        rows.forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                row.forEach { key ->
                    if (key.isBlank()) {
                        Spacer(Modifier.weight(1f).height(54.dp))
                    } else {
                        Button(
                            onClick = { onKey(if (key == pickerDecimalSeparator()) "decimal" else key) },
                            modifier = Modifier.weight(1f).height(54.dp),
                            shape = RoundedCornerShape(8.dp),
                        ) {
                            Text(
                                text = if (key == "backspace") "⌫" else key,
                                fontSize = 24.sp,
                                fontWeight = FontWeight.SemiBold,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun BarbellSideDiagram(load: PlateLoad, unit: String) {
    val plates = load.perSide.flatMap { group -> List(group.count) { group.plate } }
    val maxPlate = plates.maxOrNull()?.coerceAtLeast(1.0) ?: 1.0
    Column(
        modifier = Modifier.fillMaxWidth().testTag("barbell-side-diagram"),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Box(modifier = Modifier.fillMaxWidth().height(48.dp), contentAlignment = Alignment.Center) {
            Box(
                modifier = Modifier.fillMaxWidth(0.92f).height(6.dp)
                    .clip(RoundedCornerShape(99.dp))
                    .background(Color(0xFF71717A)),
            )
            Row(
                modifier = Modifier.fillMaxWidth(0.82f).fillMaxHeight(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.Center,
            ) {
                plates.forEach { plate ->
                    val ratio = plate / maxPlate
                    Surface(
                        modifier = Modifier.width(14.dp).height((22 + ratio * 23).dp).padding(horizontal = 1.dp),
                        shape = RoundedCornerShape(3.dp),
                        color = Color(0xFF3F3F46),
                        border = BorderStroke(1.dp, Color(0xFFD4D4D8)),
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Text(
                                text = formatPickerNumber(plate),
                                color = Color.White,
                                fontSize = 7.sp,
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier.graphicsLayer { rotationZ = -90f },
                                maxLines = 1,
                            )
                        }
                    }
                }
            }
        }
        Text(
            stringResource(
                R.string.bar_weight_format,
                formatPickerNumber(load.barWeight),
                unit.lowercase(Locale.getDefault()),
            ),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (!load.exact) {
            Text(
                stringResource(
                    R.string.plate_achieved_format,
                    formatPickerNumber(load.achievedWeight),
                    unit.lowercase(Locale.getDefault()),
                ),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.tertiary,
            )
        }
    }
}

private fun pickerOptionLabel(value: Double?, kind: SetValuePickerKind, unit: String): String {
    if (value == null) return "—"
    val suffix = when (kind) {
        SetValuePickerKind.WEIGHT -> " ${unit.lowercase(Locale.getDefault())}"
        SetValuePickerKind.REPS -> ""
        SetValuePickerKind.RIR -> ""
    }
    return formatPickerNumber(value) + suffix
}

private fun appendPickerKey(current: String, key: String, kind: SetValuePickerKind): String {
    if (key == "backspace") return current.dropLast(1)
    if (key == "decimal") {
        if (kind != SetValuePickerKind.WEIGHT || current.contains('.')) return current
        return if (current.isBlank()) "0." else "$current."
    }
    if (current.length >= 7) return current
    if (current == "0") return key
    return current + key
}

private fun normalizePickerInput(value: String): String = value.trim().replace(',', '.')

private fun parsePickerNumber(value: String): Double? = value.takeIf { it.isNotBlank() && it != "." }
    ?.replace(',', '.')
    ?.toDoubleOrNull()

private fun formatPickerNumber(value: Double): String = if (value % 1.0 == 0.0) {
    value.toInt().toString()
} else {
    String.format(Locale.ROOT, "%.2f", value).trimEnd('0').trimEnd('.')
}

private fun nearlyEqual(left: Double, right: Double): Boolean = kotlin.math.abs(left - right) < 0.001

private fun pickerDecimalSeparator(): String =
    if (Locale.getDefault().language.equals("ru", ignoreCase = true)) "," else "."
