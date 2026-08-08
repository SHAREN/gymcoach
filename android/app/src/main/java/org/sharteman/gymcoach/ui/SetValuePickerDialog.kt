package org.sharteman.gymcoach.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.gestures.stopScroll
import androidx.compose.foundation.gestures.snapping.SnapPosition
import androidx.compose.foundation.gestures.snapping.rememberSnapFlingBehavior
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListLayoutInfo
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.ChevronLeft
import androidx.compose.material.icons.outlined.ChevronRight
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
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
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
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.roundToInt

enum class SetValuePickerKind {
    WEIGHT,
    REPS,
    RIR,
}

private val PickerOptionHeight = 74.dp

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
    var confirmationStarted by rememberSaveable(kind, value) { mutableStateOf(false) }
    val listState = rememberLazyListState()
    val pickerScope = rememberCoroutineScope()
    val normalizedOptions = options.filter { it.isFinite() }.distinct().sorted()
    val optionValues: List<Double?> = if (kind == SetValuePickerKind.RIR) {
        listOf(null) + normalizedOptions
    } else {
        normalizedOptions
    }
    val openingNumericValue = parsePickerNumber(normalizePickerInput(value))
    val numericValue = parsePickerNumber(manualValue)
    val openingMatchingIndex = optionValues.indexOfFirst { option ->
        if (option == null) value.isBlank() else openingNumericValue != null && nearlyEqual(option, openingNumericValue)
    }
    val initialSelectedIndex = if (openingMatchingIndex >= 0) {
        openingMatchingIndex
    } else if (openingNumericValue == null) {
        0
    } else {
        optionValues.indices.minByOrNull { index ->
            optionValues[index]?.let { abs(it - openingNumericValue) } ?: Double.MAX_VALUE
        } ?: 0
    }
    val manualEntryActive = rememberSaveable(kind, value) {
        mutableStateOf(
            kind == SetValuePickerKind.REPS &&
                normalizePickerInput(value).isNotBlank() &&
                openingMatchingIndex < 0,
        )
    }
    val suppressScrollPreviewUntilIdle = rememberSaveable(kind, value) { mutableStateOf(false) }
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

    fun confirmOnce(confirmed: String) {
        if (confirmationStarted) return
        confirmationStarted = true
        onConfirm(confirmed)
    }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(
            usePlatformDefaultWidth = false,
            decorFitsSystemWindows = false,
        ),
    ) {
        Surface(
            modifier = Modifier.fillMaxSize().testTag("set-value-picker"),
            color = MaterialTheme.colorScheme.background,
        ) {
            Column(modifier = Modifier.fillMaxSize().safeDrawingPadding()) {
                PickerHeader(
                    kind = kind,
                    unit = unit,
                    equipmentName = selectedEquipment?.equipmentName
                        ?.takeIf { kind == SetValuePickerKind.WEIGHT },
                    onDismiss = onDismiss,
                )
                HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.35f))
                SnapValuePickerOptions(
                    kind = kind,
                    options = optionValues,
                    initialSelectedIndex = initialSelectedIndex,
                    selectedValue = numericValue,
                    selectedBlank = manualValue.isBlank(),
                    unit = unit,
                    blankStateDescription = stringResource(R.string.not_specified),
                    listState = listState,
                    manualEntryActive = manualEntryActive,
                    suppressScrollPreviewUntilIdle = suppressScrollPreviewUntilIdle,
                    onScrollPreviewSuppressionEnded = {
                        suppressScrollPreviewUntilIdle.value = false
                    },
                    onScrollStarted = {
                        manualEntryActive.value = false
                    },
                    onPreviewChange = { option ->
                        manualEntryActive.value = false
                        suppressScrollPreviewUntilIdle.value = false
                        manualValue = option?.let(::formatPickerNumber).orEmpty()
                    },
                    onConfirm = { option ->
                        val formatted = option?.let(::formatPickerNumber).orEmpty()
                        manualEntryActive.value = false
                        suppressScrollPreviewUntilIdle.value = false
                        manualValue = formatted
                        val optionValid = when (kind) {
                            SetValuePickerKind.WEIGHT -> option != null &&
                                fromDisplayWeight(option, unit) in 0.0..500.0
                            SetValuePickerKind.REPS -> option?.roundToInt()?.let { it in 1..100 } == true
                            SetValuePickerKind.RIR -> option == null || option.roundToInt() in 0..5
                        }
                        if (optionValid) confirmOnce(formatted)
                    },
                    modifier = Modifier.fillMaxWidth().weight(1f),
                )
                HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.35f))
                Column(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    PickerConfirmationRow(
                        kind = kind,
                        value = manualValue,
                        valid = valid && !confirmationStarted,
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
                            if (confirmed != null) confirmOnce(confirmed)
                        },
                    )
                    if (kind != SetValuePickerKind.RIR) {
                        PickerKeypad(
                            decimal = kind == SetValuePickerKind.WEIGHT,
                            onKey = { key ->
                                if (kind != SetValuePickerKind.RIR) {
                                    manualEntryActive.value = true
                                    suppressScrollPreviewUntilIdle.value = listState.isScrollInProgress
                                    pickerScope.launch { listState.stopScroll() }
                                }
                                manualValue = appendPickerKey(manualValue, key, kind)
                            },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun PickerHeader(
    kind: SetValuePickerKind,
    unit: String,
    equipmentName: String?,
    onDismiss: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().height(if (equipmentName == null) 56.dp else 68.dp)
            .padding(horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        TextButton(
            onClick = onDismiss,
            modifier = Modifier.width(84.dp).testTag("set-value-cancel"),
        ) {
            Text(stringResource(R.string.cancel))
        }
        Column(
            modifier = Modifier.weight(1f),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                text = when (kind) {
                    SetValuePickerKind.WEIGHT -> stringResource(
                        R.string.choose_weight,
                        unit.lowercase(Locale.getDefault()),
                    )
                    SetValuePickerKind.REPS -> stringResource(R.string.choose_reps)
                    SetValuePickerKind.RIR -> stringResource(R.string.choose_rir)
                },
                textAlign = TextAlign.Center,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            equipmentName?.let { name ->
                Text(
                    text = stringResource(R.string.weight_picker_equipment, name),
                    textAlign = TextAlign.Center,
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                )
            }
        }
        Spacer(Modifier.width(84.dp))
    }
}

@Composable
private fun SnapValuePickerOptions(
    kind: SetValuePickerKind,
    options: List<Double?>,
    initialSelectedIndex: Int,
    selectedValue: Double?,
    selectedBlank: Boolean,
    unit: String,
    blankStateDescription: String,
    listState: LazyListState,
    manualEntryActive: State<Boolean>,
    suppressScrollPreviewUntilIdle: State<Boolean>,
    onScrollPreviewSuppressionEnded: () -> Unit,
    onScrollStarted: () -> Unit,
    onPreviewChange: (Double?) -> Unit,
    onConfirm: (Double?) -> Unit,
    modifier: Modifier = Modifier,
) {
    if (options.isEmpty()) {
        Box(
            modifier = modifier
                .testTag(pickerElementTag(kind, "viewport"))
                .padding(horizontal = 32.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = stringResource(R.string.weight_options_manual_fallback),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier.testTag(pickerElementTag(kind, "manual-fallback")),
            )
        }
        return
    }

    val targetIndex = initialSelectedIndex.coerceIn(options.indices)
    var initialized by rememberSaveable(options, targetIndex) { mutableStateOf(false) }
    var centeredIndex by rememberSaveable(options, targetIndex) { mutableIntStateOf(targetIndex) }
    val currentPreviewChange by rememberUpdatedState(onPreviewChange)
    val currentScrollPreviewSuppressionEnded by rememberUpdatedState(onScrollPreviewSuppressionEnded)
    val currentScrollStarted by rememberUpdatedState(onScrollStarted)
    val flingBehavior = rememberSnapFlingBehavior(
        lazyListState = listState,
        snapPosition = SnapPosition.Center,
    )

    LaunchedEffect(options, targetIndex) {
        initialized = false
        listState.scrollToItem(targetIndex)
        snapshotFlow {
            listState.layoutInfo.visibleItemsInfo.any { item -> item.index == targetIndex }
        }.first { it }
        centerPickerItem(listState.layoutInfo, targetIndex)?.let { delta ->
            listState.scrollBy(delta)
        }
        centeredIndex = centeredPickerOptionIndex(listState.layoutInfo) ?: targetIndex
        initialized = true
    }

    LaunchedEffect(listState, options) {
        var wasScrolling = false
        snapshotFlow {
            Triple(
                initialized,
                listState.isScrollInProgress,
                centeredPickerOptionIndex(listState.layoutInfo),
            )
        }.collect { (isInitialized, isScrolling, index) ->
            if (isInitialized && index != null) {
                centeredIndex = index
                when {
                    suppressScrollPreviewUntilIdle.value -> {
                        if (!isScrolling) currentScrollPreviewSuppressionEnded()
                    }
                    manualEntryActive.value -> {
                        if (isScrolling && !wasScrolling) {
                            currentScrollStarted()
                            currentPreviewChange(options[index])
                        }
                    }
                    else -> currentPreviewChange(options[index])
                }
            }
            wasScrolling = isScrolling
        }
    }

    BoxWithConstraints(modifier = modifier.testTag(pickerElementTag(kind, "viewport"))) {
        val centerPadding = ((maxHeight - PickerOptionHeight) / 2).coerceAtLeast(0.dp)
        LazyColumn(
            state = listState,
            modifier = Modifier.fillMaxSize().testTag(pickerElementTag(kind, "list")),
            contentPadding = PaddingValues(horizontal = 24.dp, vertical = centerPadding),
            verticalArrangement = Arrangement.spacedBy(10.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            flingBehavior = flingBehavior,
        ) {
            itemsIndexed(options, key = { _, option -> option?.toString() ?: "none" }) { _, option ->
                PickerOption(
                    label = pickerOptionLabel(option, kind, unit),
                    selected = if (option == null) {
                        selectedBlank
                    } else {
                        selectedValue != null && nearlyEqual(option, selectedValue)
                    },
                    tag = "set-value-option-${kind.name}-${option?.let(::formatPickerNumber) ?: "none"}",
                    onClick = { onConfirm(option) },
                )
            }
        }
        Row(
            modifier = Modifier
                .align(Alignment.Center)
                .fillMaxWidth()
                .height(PickerOptionHeight)
                .padding(horizontal = 10.dp)
                .testTag(pickerElementTag(kind, "pointer"))
                .semantics {
                    stateDescription = options[centeredIndex]
                        ?.let(::formatPickerNumber)
                        ?: blankStateDescription
                },
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                imageVector = Icons.Outlined.ChevronRight,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(38.dp).testTag(pickerElementTag(kind, "pointer-left")),
            )
            Icon(
                imageVector = Icons.Outlined.ChevronLeft,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(38.dp).testTag(pickerElementTag(kind, "pointer-right")),
            )
        }
    }
}

private fun centeredPickerOptionIndex(layoutInfo: LazyListLayoutInfo): Int? {
    val viewportCenter = (layoutInfo.viewportStartOffset + layoutInfo.viewportEndOffset) / 2
    return layoutInfo.visibleItemsInfo.minByOrNull { item ->
        abs(item.offset + item.size / 2 - viewportCenter)
    }?.index
}

private fun centerPickerItem(layoutInfo: LazyListLayoutInfo, index: Int): Float? {
    val item = layoutInfo.visibleItemsInfo.firstOrNull { visible -> visible.index == index } ?: return null
    val viewportCenter = (layoutInfo.viewportStartOffset + layoutInfo.viewportEndOffset) / 2
    return (item.offset + item.size / 2 - viewportCenter).toFloat()
}

@Composable
private fun PickerOption(label: String, selected: Boolean, tag: String, onClick: () -> Unit) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .widthIn(max = 250.dp)
            .height(PickerOptionHeight)
            .testTag(tag)
            .selectable(selected = selected, onClick = onClick),
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
    if (kind == SetValuePickerKind.WEIGHT) {
        Row(
            modifier = Modifier.fillMaxWidth().testTag("set-value-confirmation-row"),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier
                    .weight(1f)
                    .heightIn(min = 64.dp)
                    .testTag("set-value-leading-reserve"),
                contentAlignment = Alignment.Center,
            ) {
                if (plateLoad != null) {
                    BarbellSideDiagram(load = plateLoad, unit = unit)
                }
            }
            PickerValueSurface(
                kind = kind,
                value = value,
                modifier = Modifier.weight(1f),
            )
            Box(
                modifier = Modifier
                    .weight(1f)
                    .heightIn(min = 64.dp)
                    .testTag("set-value-trailing-reserve"),
                contentAlignment = Alignment.CenterEnd,
            ) {
                PickerApplyButton(valid = valid, onConfirm = onConfirm)
            }
        }
        return
    }

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
        PickerValueSurface(kind = kind, value = value, modifier = Modifier.weight(1f))
        PickerApplyButton(valid = valid, onConfirm = onConfirm)
    }
}

@Composable
private fun PickerValueSurface(kind: SetValuePickerKind, value: String, modifier: Modifier) {
    Surface(
        modifier = modifier.height(64.dp).testTag("set-value-field"),
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
                modifier = Modifier.testTag("set-value-field-text"),
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}

@Composable
private fun PickerApplyButton(valid: Boolean, onConfirm: () -> Unit) {
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
                            modifier = Modifier
                                .weight(1f)
                                .height(54.dp)
                                .testTag("set-value-key-${if (key == pickerDecimalSeparator()) "decimal" else key}"),
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
        modifier = Modifier
            .fillMaxWidth()
            .testTag("barbell-side-diagram")
            .semantics { stateDescription = formatPickerNumber(load.achievedWeight) },
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

private fun pickerElementTag(kind: SetValuePickerKind, element: String): String =
    "${kind.name.lowercase(Locale.ROOT)}-picker-$element"

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
