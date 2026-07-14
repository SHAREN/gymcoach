package org.sharteman.gymcoach.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.abs
import kotlin.math.max
import org.sharteman.gymcoach.R
import org.sharteman.gymcoach.data.model.MobileBodyMeasurementDto
import org.sharteman.gymcoach.data.model.MobileBodyweightEntryDto
import org.sharteman.gymcoach.data.model.MobileConditioningWeekDto
import org.sharteman.gymcoach.data.model.MobileConsistencyDto
import org.sharteman.gymcoach.data.model.MobileWeeklyVolumeDto

private const val CONDITIONING_TARGET_MINUTES = 150.0

private val muscleColors = mapOf(
    "CHEST" to Color(0xFFEF4444),
    "BACK_WIDTH" to Color(0xFF3B82F6),
    "BACK_THICKNESS" to Color(0xFF1D4ED8),
    "SHOULDERS_FRONT" to Color(0xFFF59E0B),
    "SHOULDERS_LATERAL" to Color(0xFFFBBF24),
    "SHOULDERS_REAR" to Color(0xFFD97706),
    "BICEPS" to Color(0xFFA855F7),
    "TRICEPS" to Color(0xFF9333EA),
    "FOREARMS" to Color(0xFF7C3AED),
    "QUADS" to Color(0xFF10B981),
    "HAMSTRINGS" to Color(0xFF059669),
    "GLUTES" to Color(0xFF34D399),
    "CALVES" to Color(0xFF14B8A6),
    "ABS" to Color(0xFF64748B),
    "LOWER_BACK" to Color(0xFF475569),
    "OTHER" to Color(0xFF94A3B8),
)

@Composable
internal fun BodyweightProgressCard(
    entries: List<MobileBodyweightEntryDto>,
    unit: String,
) {
    val chronological = remember(entries, unit) {
        entries.sortedBy { parseOverviewEpoch(it.measuredAt) }
    }
    val values = remember(chronological, unit) {
        chronological.map { displayBodyweight(it.weightKg, unit) }
    }
    var selectedIndex by rememberSaveable(values.size) { mutableIntStateOf(values.lastIndex.coerceAtLeast(0)) }

    OverviewCard {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(stringResource(R.string.progress_bodyweight_title), style = MaterialTheme.typography.titleMedium)
            chronological.lastOrNull()?.let {
                Text(
                    "${formatOverviewValue(displayBodyweight(it.weightKg, unit))} ${unit.lowercase(Locale.getDefault())}",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontWeight = FontWeight.Medium,
                )
            }
        }
        when {
            chronological.isEmpty() -> OverviewEmptyText(stringResource(R.string.progress_bodyweight_empty))
            chronological.size == 1 -> OverviewEmptyText(stringResource(R.string.progress_bodyweight_second))
            else -> {
                val selected = chronological[selectedIndex.coerceIn(chronological.indices)]
                OverviewSelectedValue(
                    label = formatOverviewDate(selected.measuredAt),
                    value = "${formatOverviewValue(displayBodyweight(selected.weightKg, unit))} ${unit.lowercase(Locale.getDefault())}",
                )
                InteractiveOverviewLineChart(
                    values = values,
                    selectedIndex = selectedIndex,
                    onSelect = { selectedIndex = it },
                    color = MaterialTheme.colorScheme.primary,
                    accessibilityLabel = stringResource(R.string.progress_bodyweight_chart_accessibility, values.size),
                )
                OverviewDateRange(chronological.first().measuredAt, chronological.last().measuredAt)
            }
        }
    }
}

@Composable
internal fun MeasurementsProgressCard(
    entries: List<MobileBodyMeasurementDto>,
    unit: String,
) {
    val sites = remember(entries) { entries.map { it.site }.distinct().sorted() }
    var selectedSite by rememberSaveable { mutableStateOf("WAIST") }
    var chooserOpen by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(sites) {
        if (selectedSite !in sites && sites.isNotEmpty()) selectedSite = sites.first()
    }
    val siteEntries = remember(entries, selectedSite) {
        entries.filter { it.site == selectedSite }.sortedBy { parseOverviewEpoch(it.measuredAt) }
    }
    val values = remember(siteEntries, unit) {
        siteEntries.map { displayMeasurement(it.valueCm, unit) }
    }
    var selectedIndex by rememberSaveable(selectedSite, values.size) {
        mutableIntStateOf(values.lastIndex.coerceAtLeast(0))
    }

    OverviewCard {
        Text(stringResource(R.string.progress_measurements_title), style = MaterialTheme.typography.titleMedium)
        OutlinedButton(
            onClick = { chooserOpen = true },
            modifier = Modifier.fillMaxWidth(),
            enabled = sites.isNotEmpty(),
            shape = RoundedCornerShape(7.dp),
        ) {
            Text(
                if (sites.isEmpty()) stringResource(R.string.progress_measurements_no_sites)
                else measurementSiteLabel(selectedSite),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        when {
            siteEntries.isEmpty() -> OverviewEmptyText(stringResource(R.string.progress_measurements_empty))
            siteEntries.size == 1 -> OverviewEmptyText(stringResource(R.string.progress_measurements_second))
            else -> {
                val selected = siteEntries[selectedIndex.coerceIn(siteEntries.indices)]
                OverviewSelectedValue(
                    label = formatOverviewDate(selected.measuredAt),
                    value = "${formatOverviewValue(displayMeasurement(selected.valueCm, unit))} ${measurementUnit(unit)}",
                )
                InteractiveOverviewLineChart(
                    values = values,
                    selectedIndex = selectedIndex,
                    onSelect = { selectedIndex = it },
                    color = MaterialTheme.colorScheme.tertiary,
                    accessibilityLabel = stringResource(
                        R.string.progress_measurements_chart_accessibility,
                        measurementSiteLabel(selectedSite),
                        values.size,
                    ),
                )
                OverviewDateRange(siteEntries.first().measuredAt, siteEntries.last().measuredAt)
            }
        }
    }

    if (chooserOpen) {
        AlertDialog(
            onDismissRequest = { chooserOpen = false },
            title = { Text(stringResource(R.string.progress_measurements_choose_site)) },
            text = {
                LazyColumn(modifier = Modifier.fillMaxWidth().height(420.dp)) {
                    items(sites, key = { it }) { site ->
                        TextButton(
                            onClick = {
                                selectedSite = site
                                chooserOpen = false
                            },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text(measurementSiteLabel(site), modifier = Modifier.fillMaxWidth())
                        }
                    }
                }
            },
            confirmButton = {},
            dismissButton = {
                TextButton(onClick = { chooserOpen = false }) { Text(stringResource(R.string.cancel)) }
            },
        )
    }
}

@Composable
internal fun ConsistencyProgressCard(consistency: MobileConsistencyDto) {
    val weeks = consistency.weeks
    val maxDays = max(1, weeks.maxOfOrNull { it.trainedDays } ?: 1)
    OverviewCard {
        Text(stringResource(R.string.progress_consistency_title), style = MaterialTheme.typography.titleMedium)
        Text(
            if (consistency.weeklyFrequency != null) {
                stringResource(
                    R.string.progress_consistency_description_target,
                    weeks.size,
                    consistency.weeklyFrequency,
                )
            } else {
                stringResource(R.string.progress_consistency_description, weeks.size)
            },
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            stringResource(R.string.progress_consistency_streak, consistency.currentStreak),
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Bold,
            color = if (consistency.currentStreak > 0) Color(0xFFF97316) else MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Row(
            modifier = Modifier.fillMaxWidth().height(92.dp),
            horizontalArrangement = Arrangement.spacedBy(2.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            weeks.forEach { week ->
                Column(
                    modifier = Modifier.weight(1f).fillMaxHeight(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Bottom,
                ) {
                    Box(modifier = Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.BottomCenter) {
                        val fraction = if (week.trainedDays > 0) {
                            (week.trainedDays.toFloat() / maxDays).coerceIn(0.08f, 1f)
                        } else {
                            0.04f
                        }
                        Box(
                            modifier = Modifier
                                .fillMaxWidth(0.72f)
                                .fillMaxHeight(fraction)
                                .background(
                                    if (week.onStreak) MaterialTheme.colorScheme.primary
                                    else MaterialTheme.colorScheme.surfaceVariant,
                                    RoundedCornerShape(2.dp),
                                )
                                .then(
                                    if (week.isCurrent) {
                                        Modifier.border(
                                            1.dp,
                                            MaterialTheme.colorScheme.primary,
                                            RoundedCornerShape(2.dp),
                                        )
                                    } else Modifier
                                ),
                        )
                    }
                    Text(
                        week.trainedDays.toString(),
                        fontSize = 9.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

@Composable
internal fun ConditioningProgressCard(weeks: List<MobileConditioningWeekDto>) {
    if (weeks.isEmpty()) return
    var selectedIndex by rememberSaveable(weeks.size) { mutableIntStateOf(weeks.lastIndex) }
    val selected = weeks[selectedIndex.coerceIn(weeks.indices)]
    val totalMinutes = weeks.sumOf { it.minutes }
    val totalDistance = weeks.sumOf { it.distanceKm }
    OverviewCard {
        Text(stringResource(R.string.progress_conditioning_title), style = MaterialTheme.typography.titleMedium)
        Text(
            stringResource(R.string.progress_conditioning_description, CONDITIONING_TARGET_MINUTES.toInt()),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        OverviewSelectedValue(
            label = formatOverviewWeek(selected.weekStartIso),
            value = stringResource(
                R.string.progress_conditioning_selected,
                selected.minutes,
                formatOverviewValue(selected.distanceKm),
                selected.sessions,
            ),
        )
        InteractiveBarChart(
            values = weeks.map { it.minutes.toDouble() },
            selectedIndex = selectedIndex,
            onSelect = { selectedIndex = it },
            color = Color(0xFF10B981),
            referenceValue = CONDITIONING_TARGET_MINUTES,
            accessibilityLabel = stringResource(R.string.progress_conditioning_chart_accessibility, weeks.size),
        )
        OverviewWeekLabels(weeks.map { it.weekKey })
        Text(
            stringResource(
                R.string.progress_conditioning_total,
                weeks.size,
                totalMinutes,
                formatOverviewValue(totalDistance),
            ),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
internal fun WeeklyVolumeProgressCard(
    weeks: List<MobileWeeklyVolumeDto>,
    unit: String,
) {
    val groups = remember(weeks) {
        weeks.flatMap { it.byMuscleGroup.keys }.distinct().sorted()
    }
    var selectedIndex by rememberSaveable(weeks.size) { mutableIntStateOf(weeks.lastIndex.coerceAtLeast(0)) }
    OverviewCard {
        Text(stringResource(R.string.progress_weekly_volume_title), style = MaterialTheme.typography.titleMedium)
        Text(
            stringResource(R.string.progress_weekly_volume_description),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (weeks.isEmpty()) {
            OverviewEmptyText(stringResource(R.string.progress_weekly_volume_empty))
        } else {
            val selected = weeks[selectedIndex.coerceIn(weeks.indices)]
            OverviewSelectedValue(
                label = formatOverviewWeek(selected.weekStartIso),
                value = stringResource(
                    R.string.progress_weekly_volume_total,
                    formatOverviewValue(displayWeeklyVolume(selected.total, unit)),
                    unit.lowercase(Locale.getDefault()),
                ),
            )
            StackedWeeklyVolumeChart(
                weeks = weeks,
                groups = groups,
                unit = unit,
                selectedIndex = selectedIndex,
                onSelect = { selectedIndex = it },
            )
            OverviewWeekLabels(weeks.map { it.weekKey })
            LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                items(groups, key = { it }) { group ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            modifier = Modifier
                                .size(9.dp)
                                .background(muscleColors[group] ?: Color(0xFF94A3B8), RoundedCornerShape(2.dp)),
                        )
                        Spacer(Modifier.width(4.dp))
                        Text(
                            muscleGroupLabel(group),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
            selected.byMuscleGroup.entries
                .sortedByDescending { it.value }
                .forEach { (group, value) ->
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text(
                            muscleGroupLabel(group),
                            modifier = Modifier.weight(1f),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            "${formatOverviewValue(displayWeeklyVolume(value, unit))} ${unit.lowercase(Locale.getDefault())}",
                            fontWeight = FontWeight.Medium,
                        )
                    }
                }
        }
    }
}

@Composable
private fun OverviewCard(content: @Composable ColumnScope.() -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(9.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.45f)),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(9.dp),
            content = content,
        )
    }
}

@Composable
private fun OverviewEmptyText(value: String) {
    Text(
        value,
        modifier = Modifier.fillMaxWidth().padding(vertical = 20.dp),
        textAlign = TextAlign.Center,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

@Composable
private fun OverviewSelectedValue(label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, style = MaterialTheme.typography.labelLarge)
        Text(value, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
    }
}

@Composable
private fun OverviewDateRange(first: String, last: String) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(formatOverviewShortDate(first), style = MaterialTheme.typography.labelSmall)
        Text(formatOverviewShortDate(last), style = MaterialTheme.typography.labelSmall)
    }
}

@Composable
private fun OverviewWeekLabels(keys: List<String>) {
    if (keys.isEmpty()) return
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        keys.forEach { key ->
            Text(
                shortWeekLabel(key),
                modifier = Modifier.weight(1f),
                textAlign = TextAlign.Center,
                fontSize = 8.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
            )
        }
    }
}

@Composable
private fun InteractiveOverviewLineChart(
    values: List<Double>,
    selectedIndex: Int,
    onSelect: (Int) -> Unit,
    color: Color,
    accessibilityLabel: String,
) {
    val gridColor = MaterialTheme.colorScheme.outline.copy(alpha = 0.22f)
    val selectedColor = MaterialTheme.colorScheme.tertiary
    Canvas(
        modifier = Modifier
            .fillMaxWidth()
            .height(180.dp)
            .semantics { contentDescription = accessibilityLabel }
            .pointerInput(values) {
                detectTapGestures { offset ->
                    if (values.isEmpty()) return@detectTapGestures
                    val left = 10.dp.toPx()
                    val right = size.width - 10.dp.toPx()
                    val nearest = values.indices.minByOrNull { index ->
                        val x = if (values.size == 1) {
                            (left + right) / 2f
                        } else {
                            left + index.toFloat() / values.lastIndex * (right - left)
                        }
                        abs(offset.x - x)
                    }
                    nearest?.let(onSelect)
                }
            },
    ) {
        val left = 10.dp.toPx()
        val right = size.width - 10.dp.toPx()
        val top = 12.dp.toPx()
        val bottom = size.height - 12.dp.toPx()
        repeat(5) { index ->
            val y = top + (bottom - top) * index / 4f
            drawLine(gridColor, Offset(left, y), Offset(right, y), strokeWidth = 1.dp.toPx())
        }
        val minValue = values.minOrNull() ?: 0.0
        val maxValue = values.maxOrNull() ?: 0.0
        val range = (maxValue - minValue).takeIf { it > 0.0 } ?: 1.0
        val coordinates = values.mapIndexed { index, value ->
            val x = if (values.size == 1) (left + right) / 2f
            else left + index.toFloat() / values.lastIndex * (right - left)
            val y = bottom - ((value - minValue) / range).toFloat() * (bottom - top)
            Offset(x, y)
        }
        if (coordinates.size > 1) {
            val path = Path().apply {
                coordinates.forEachIndexed { index, point ->
                    if (index == 0) moveTo(point.x, point.y) else lineTo(point.x, point.y)
                }
            }
            drawPath(path, color, style = Stroke(width = 2.5.dp.toPx(), cap = StrokeCap.Round))
        }
        coordinates.forEachIndexed { index, point ->
            drawCircle(if (index == selectedIndex) selectedColor else color, 4.5.dp.toPx(), point)
            drawCircle(Color.White, 1.8.dp.toPx(), point)
        }
    }
}

@Composable
private fun InteractiveBarChart(
    values: List<Double>,
    selectedIndex: Int,
    onSelect: (Int) -> Unit,
    color: Color,
    referenceValue: Double?,
    accessibilityLabel: String,
) {
    val gridColor = MaterialTheme.colorScheme.outline.copy(alpha = 0.22f)
    val referenceColor = MaterialTheme.colorScheme.primary
    Canvas(
        modifier = Modifier
            .fillMaxWidth()
            .height(190.dp)
            .semantics { contentDescription = accessibilityLabel }
            .pointerInput(values) {
                detectTapGestures { offset ->
                    if (values.isEmpty()) return@detectTapGestures
                    val index = ((offset.x / size.width) * values.size).toInt().coerceIn(values.indices)
                    onSelect(index)
                }
            },
    ) {
        val left = 8.dp.toPx()
        val right = size.width - 8.dp.toPx()
        val top = 10.dp.toPx()
        val bottom = size.height - 8.dp.toPx()
        val maxValue = max(values.maxOrNull() ?: 0.0, referenceValue ?: 0.0).coerceAtLeast(1.0)
        repeat(5) { index ->
            val y = top + (bottom - top) * index / 4f
            drawLine(gridColor, Offset(left, y), Offset(right, y), strokeWidth = 1.dp.toPx())
        }
        referenceValue?.let { reference ->
            val y = bottom - (reference / maxValue).toFloat() * (bottom - top)
            drawLine(
                referenceColor,
                Offset(left, y),
                Offset(right, y),
                strokeWidth = 1.5.dp.toPx(),
                pathEffect = androidx.compose.ui.graphics.PathEffect.dashPathEffect(floatArrayOf(8f, 8f)),
            )
        }
        val slot = (right - left) / values.size
        val barWidth = slot * 0.62f
        values.forEachIndexed { index, value ->
            val height = (value / maxValue).toFloat() * (bottom - top)
            val x = left + slot * index + (slot - barWidth) / 2f
            drawRoundRect(
                color = if (index == selectedIndex) referenceColor else color,
                topLeft = Offset(x, bottom - height),
                size = Size(barWidth, max(height, 2.dp.toPx())),
                cornerRadius = androidx.compose.ui.geometry.CornerRadius(3.dp.toPx()),
            )
        }
    }
}

@Composable
private fun StackedWeeklyVolumeChart(
    weeks: List<MobileWeeklyVolumeDto>,
    groups: List<String>,
    unit: String,
    selectedIndex: Int,
    onSelect: (Int) -> Unit,
) {
    val gridColor = MaterialTheme.colorScheme.outline.copy(alpha = 0.22f)
    val selectedColor = MaterialTheme.colorScheme.primary
    val accessibilityLabel = stringResource(R.string.progress_weekly_volume_chart_accessibility, weeks.size)
    Canvas(
        modifier = Modifier
            .fillMaxWidth()
            .height(220.dp)
            .semantics { contentDescription = accessibilityLabel }
            .pointerInput(weeks) {
                detectTapGestures { offset ->
                    if (weeks.isEmpty()) return@detectTapGestures
                    val index = ((offset.x / size.width) * weeks.size).toInt().coerceIn(weeks.indices)
                    onSelect(index)
                }
            },
    ) {
        val left = 8.dp.toPx()
        val right = size.width - 8.dp.toPx()
        val top = 10.dp.toPx()
        val bottom = size.height - 8.dp.toPx()
        val totals = weeks.map { displayWeeklyVolume(it.total, unit) }
        val maxTotal = (totals.maxOrNull() ?: 0.0).coerceAtLeast(1.0)
        repeat(5) { index ->
            val y = top + (bottom - top) * index / 4f
            drawLine(gridColor, Offset(left, y), Offset(right, y), strokeWidth = 1.dp.toPx())
        }
        val slot = (right - left) / weeks.size
        val barWidth = slot * 0.64f
        weeks.forEachIndexed { index, week ->
            val x = left + slot * index + (slot - barWidth) / 2f
            var stackBottom = bottom
            groups.forEach { group ->
                val value = displayWeeklyVolume(week.byMuscleGroup[group] ?: 0.0, unit)
                if (value <= 0.0) return@forEach
                val height = (value / maxTotal).toFloat() * (bottom - top)
                drawRect(
                    color = muscleColors[group] ?: Color(0xFF94A3B8),
                    topLeft = Offset(x, stackBottom - height),
                    size = Size(barWidth, height),
                )
                stackBottom -= height
            }
            if (index == selectedIndex) {
                drawRoundRect(
                    color = selectedColor,
                    topLeft = Offset(x - 2.dp.toPx(), top),
                    size = Size(barWidth + 4.dp.toPx(), bottom - top),
                    cornerRadius = androidx.compose.ui.geometry.CornerRadius(3.dp.toPx()),
                    style = Stroke(width = 1.5.dp.toPx()),
                )
            }
        }
    }
}

@Composable
private fun measurementSiteLabel(site: String): String = stringResource(
    when (site) {
        "NECK" -> R.string.measurement_site_neck
        "SHOULDERS" -> R.string.measurement_site_shoulders
        "CHEST" -> R.string.measurement_site_chest
        "WAIST" -> R.string.measurement_site_waist
        "HIPS" -> R.string.measurement_site_hips
        "ARM_LEFT" -> R.string.measurement_site_arm_left
        "ARM_RIGHT" -> R.string.measurement_site_arm_right
        "FOREARM_LEFT" -> R.string.measurement_site_forearm_left
        "FOREARM_RIGHT" -> R.string.measurement_site_forearm_right
        "THIGH_LEFT" -> R.string.measurement_site_thigh_left
        "THIGH_RIGHT" -> R.string.measurement_site_thigh_right
        "CALF_LEFT" -> R.string.measurement_site_calf_left
        "CALF_RIGHT" -> R.string.measurement_site_calf_right
        else -> R.string.measurement_site_other
    },
)

@Composable
internal fun muscleGroupLabel(group: String): String = stringResource(
    when (group) {
        "CHEST" -> R.string.muscle_chest
        "BACK_WIDTH" -> R.string.muscle_back_width
        "BACK_THICKNESS" -> R.string.muscle_back_thickness
        "SHOULDERS_FRONT" -> R.string.muscle_shoulders_front
        "SHOULDERS_LATERAL" -> R.string.muscle_shoulders_lateral
        "SHOULDERS_REAR" -> R.string.muscle_shoulders_rear
        "BICEPS" -> R.string.muscle_biceps
        "TRICEPS" -> R.string.muscle_triceps
        "FOREARMS" -> R.string.muscle_forearms
        "QUADS" -> R.string.muscle_quads
        "HAMSTRINGS" -> R.string.muscle_hamstrings
        "GLUTES" -> R.string.muscle_glutes
        "CALVES" -> R.string.muscle_calves
        "ABS" -> R.string.muscle_abs
        "LOWER_BACK" -> R.string.muscle_lower_back
        else -> R.string.muscle_other
    },
)

private fun parseOverviewEpoch(value: String): Long =
    runCatching { Instant.parse(value).toEpochMilli() }.getOrDefault(0L)

private fun formatOverviewValue(value: Double): String = if (value % 1.0 == 0.0) {
    value.toInt().toString()
} else {
    String.format(Locale.getDefault(), "%.1f", value).trimEnd('0').trimEnd('.', ',')
}

private fun formatOverviewDate(value: String): String = runCatching {
    Instant.parse(value).atZone(ZoneId.systemDefault())
        .format(DateTimeFormatter.ofPattern("dd MMM yyyy", Locale.getDefault()))
}.getOrElse { value.take(10) }

private fun formatOverviewShortDate(value: String): String = runCatching {
    Instant.parse(value).atZone(ZoneId.systemDefault())
        .format(DateTimeFormatter.ofPattern("dd.MM", Locale.getDefault()))
}.getOrElse { value.take(10) }

private fun formatOverviewWeek(value: String): String = runCatching {
    Instant.parse(value).atZone(ZoneId.systemDefault())
        .format(DateTimeFormatter.ofPattern("dd.MM.yyyy", Locale.getDefault()))
}.getOrElse { value.take(10) }

private fun shortWeekLabel(value: String): String = value.substringAfter("-W", value).takeLast(2)
