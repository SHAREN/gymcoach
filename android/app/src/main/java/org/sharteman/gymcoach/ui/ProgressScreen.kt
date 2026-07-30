package org.sharteman.gymcoach.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.TrendingUp
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.sharteman.gymcoach.R
import org.sharteman.gymcoach.data.model.MobileProgressExerciseDto
import org.sharteman.gymcoach.data.model.MobileProgressSnapshot
import org.sharteman.gymcoach.data.repository.HistoryProgressRepository
import org.sharteman.gymcoach.training.roundWeight
import org.sharteman.gymcoach.training.toDisplayWeight
import org.sharteman.gymcoach.ui.localization.exerciseDisplayName
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProgressScreen(
    snapshot: MobileProgressSnapshot?,
    unit: String,
    initialExerciseId: String? = null,
    refreshing: Boolean,
    onRefresh: () -> Unit,
    onBack: () -> Unit,
) {
    val context = LocalContext.current
    val dashboardRepository = remember(context) { HistoryProgressRepository(context) }
    val dashboardScope = rememberCoroutineScope()
    var dashboardBusy by remember { mutableStateOf(false) }
    var dashboardError by remember { mutableStateOf<String?>(null) }
    fun runDashboardAction(action: suspend () -> Unit) {
        dashboardScope.launch {
            dashboardBusy = true
            dashboardError = null
            runCatching { action() }
                .onSuccess { onRefresh() }
                .onFailure {
                    dashboardError = it.message ?: context.getString(R.string.progress_action_failed)
                }
            dashboardBusy = false
        }
    }
    val dashboardActions = ProgressDashboardActions(
        busy = dashboardBusy,
        onSaveGoal = { exerciseId, weightKg, reps ->
            runDashboardAction { dashboardRepository.saveGoal(exerciseId, weightKg, reps) }
        },
        onDeleteGoal = { goalId ->
            runDashboardAction { dashboardRepository.deleteGoal(goalId) }
        },
        onSaveVolumeTarget = { muscleGroup, mev, mrv ->
            runDashboardAction { dashboardRepository.saveVolumeTarget(muscleGroup, mev, mrv) }
        },
        onClearVolumeTarget = { muscleGroup ->
            runDashboardAction { dashboardRepository.clearVolumeTarget(muscleGroup) }
        },
        onStartDeload = { runDashboardAction { dashboardRepository.startDeload() } },
        onEndDeload = { runDashboardAction { dashboardRepository.endDeload() } },
    )
    var selectedExerciseId by rememberSaveable(initialExerciseId) {
        mutableStateOf(initialExerciseId)
    }
    var metricName by rememberSaveable { mutableStateOf(ProgressMetric.ESTIMATED_1RM.name) }
    var rangeName by rememberSaveable { mutableStateOf(ProgressRange.ALL.name) }
    var chooserOpen by rememberSaveable { mutableStateOf(false) }
    val exercises = snapshot?.exercises.orEmpty()
    LaunchedEffect(exercises, initialExerciseId) {
        val exerciseIds = exercises.mapTo(mutableSetOf()) { it.id }
        if (initialExerciseId != null) {
            selectedExerciseId = initialExerciseId
        } else if (selectedExerciseId !in exerciseIds) {
            selectedExerciseId = exercises.firstOrNull()?.id
        }
    }
    val selectedExercise = exercises.firstOrNull { it.id == selectedExerciseId }
    val metric = ProgressMetric.valueOf(metricName)
    val range = ProgressRange.valueOf(rangeName)
    val rawPoints = remember(selectedExercise, metric, range, snapshot?.generatedAt) {
        buildProgressChartPoints(selectedExercise?.points.orEmpty(), metric, range)
    }
    val points = remember(rawPoints, metric, unit) {
        rawPoints.map { point ->
            point.copy(
                value = if (metric.weightMetric) {
                    roundWeight(toDisplayWeight(point.value, unit), 1)
                } else {
                    point.value
                },
            )
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.progress_title)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = stringResource(R.string.previous))
                    }
                },
                actions = {
                    IconButton(onClick = onRefresh, enabled = !refreshing) {
                        Icon(Icons.Outlined.Refresh, contentDescription = stringResource(R.string.sync_now))
                    }
                },
            )
        },
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding).testTag("progress-list"),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            if (refreshing) item { LinearProgressIndicator(modifier = Modifier.fillMaxWidth()) }
            if (dashboardBusy) item { LinearProgressIndicator(modifier = Modifier.fillMaxWidth()) }
            dashboardError?.let { message ->
                item {
                    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer)) {
                        Text(message, modifier = Modifier.fillMaxWidth().padding(12.dp))
                    }
                }
            }
            snapshot?.let { progress ->
                progress.bodyweightEntries?.let { entries ->
                    item { BodyweightProgressCard(entries = entries, unit = unit) }
                }
                progress.bodyMeasurements?.let { entries ->
                    item { MeasurementsProgressCard(entries = entries, unit = unit) }
                }
                progress.conditioningWeeks?.let { weeks ->
                    item { ConditioningProgressCard(weeks) }
                }
                progress.consistency?.let { consistency ->
                    item { ConsistencyProgressCard(consistency) }
                }
                if (
                    progress.deload.active ||
                    progress.deload.recommended ||
                    progress.deload.state != "none"
                ) {
                    item { ProgressDeloadCard(progress.deload, dashboardActions) }
                }
            }
            item {
                OutlinedButton(
                    onClick = { chooserOpen = true },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(8.dp),
                ) {
                    Icon(
                        Icons.AutoMirrored.Outlined.TrendingUp,
                        contentDescription = null,
                        modifier = Modifier.size(18.dp),
                    )
                    Spacer(Modifier.size(8.dp))
                    Text(
                        selectedExercise?.let { exerciseDisplayName(it.name) }
                            ?: stringResource(R.string.choose_exercise),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            item {
                Text(stringResource(R.string.progress_metric), style = MaterialTheme.typography.labelLarge)
                LazyRow(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                    items(ProgressMetric.entries) { option ->
                        FilterChip(
                            selected = option == metric,
                            onClick = { metricName = option.name },
                            modifier = Modifier.testTag("progress-metric-${option.name}"),
                            label = { Text(progressMetricLabel(option)) },
                        )
                    }
                }
            }
            item {
                Text(stringResource(R.string.progress_period), style = MaterialTheme.typography.labelLarge)
                LazyRow(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                    items(ProgressRange.entries) { option ->
                        FilterChip(
                            selected = option == range,
                            onClick = { rangeName = option.name },
                            modifier = Modifier.testTag("progress-range-${option.name}"),
                            label = { Text(progressRangeLabel(option)) },
                        )
                    }
                }
            }
            item {
                ProgressChartCard(
                    exercise = selectedExercise,
                    points = points,
                    metric = metric,
                    unit = unit,
                )
            }
            item {
                if (selectedExercise != null && selectedExercise.points.isNotEmpty()) {
                    ProgressSummaryCard(selectedExercise, unit)
                }
            }
            selectedExercise?.let { exercise ->
                if (exercise.loadingTable.isNotEmpty()) {
                    item { ProgressLoadingTableCard(exercise, unit) }
                }
                item { ProgressGoalCard(exercise, unit, dashboardActions) }
            }
            snapshot?.let { progress ->
                progress.weeklyVolume?.let { weeks ->
                    item { WeeklyVolumeProgressCard(weeks = weeks, unit = unit) }
                }
                if (progress.exercises.any { it.recap.stalled }) {
                    item { ProgressStalledCard(progress.exercises) }
                }
                progress.volumeLandmarks?.let { landmarks ->
                    if (landmarks.rows.isNotEmpty()) {
                        item { ProgressVolumeLandmarksCard(landmarks, dashboardActions) }
                    }
                }
                if (progress.exercises.any { it.recap.sessions > 0 }) {
                    item { ProgressRecapCard(progress.exercises, unit) }
                }
                if (progress.records.isNotEmpty()) {
                    item { ProgressRecordsCard(progress.records, unit) }
                }
            }
        }
    }

    if (chooserOpen) {
        AlertDialog(
            onDismissRequest = { chooserOpen = false },
            title = { Text(stringResource(R.string.choose_exercise)) },
            text = {
                LazyColumn(
                    modifier = Modifier.fillMaxWidth().height(420.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    items(exercises, key = { it.id }) { exercise ->
                        TextButton(
                            onClick = {
                                selectedExerciseId = exercise.id
                                chooserOpen = false
                            },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Column(modifier = Modifier.fillMaxWidth()) {
                                Text(exerciseDisplayName(exercise.name), fontWeight = FontWeight.Medium)
                                Text(
                                    muscleGroupLabel(exercise.muscleGroup),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
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
private fun ProgressChartCard(
    exercise: MobileProgressExerciseDto?,
    points: List<ProgressChartPoint>,
    metric: ProgressMetric,
    unit: String,
) {
    var selectedIndex by rememberSaveable(exercise?.id, metric.name, points.size) {
        mutableIntStateOf(points.lastIndex.coerceAtLeast(0))
    }
    val metricColor = progressMetricColor(metric)
    Card(
        modifier = Modifier.testTag("progress-main-chart"),
        shape = RoundedCornerShape(9.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.45f)),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                stringResource(R.string.exercise_progress),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            exercise?.let {
                Text(
                    muscleGroupLabel(it.muscleGroup),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (points.isEmpty()) {
                Text(
                    stringResource(R.string.no_chart_data),
                    modifier = Modifier.fillMaxWidth().padding(vertical = 60.dp),
                    textAlign = TextAlign.Center,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                val selected = points.getOrNull(selectedIndex) ?: points.last()
                val suffix = if (metric.weightMetric) " ${unit.lowercase(Locale.getDefault())}" else ""
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(formatProgressDate(selected.source.sessionStartedAt), style = MaterialTheme.typography.labelLarge)
                    Text(
                        "${formatProgressValue(selected.value)}$suffix",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = metricColor,
                    )
                }
                ProgressLineChart(
                    points = points,
                    selectedIndex = selectedIndex,
                    onSelect = { selectedIndex = it },
                    lineColor = metricColor,
                    accessibilityLabel = stringResource(
                        R.string.progress_chart_accessibility,
                        progressMetricLabel(metric),
                        points.size,
                    ),
                )
                ProgressDateTicks(points)
            }
        }
    }
}

@Composable
private fun ProgressLineChart(
    points: List<ProgressChartPoint>,
    selectedIndex: Int,
    onSelect: (Int) -> Unit,
    lineColor: Color,
    accessibilityLabel: String,
) {
    val gridColor = MaterialTheme.colorScheme.outline.copy(alpha = 0.25f)
    val selectedColor = MaterialTheme.colorScheme.tertiary
    val minValue = points.minOf { it.value }
    val maxValue = points.maxOf { it.value }
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(230.dp)
            .semantics { contentDescription = accessibilityLabel },
    ) {
        Canvas(
            modifier = Modifier
                .fillMaxSize()
                .pointerInput(points) {
                    detectTapGestures { offset ->
                        if (points.isEmpty()) return@detectTapGestures
                        val left = 12.dp.toPx()
                        val right = size.width - 46.dp.toPx()
                        val firstX = points.first().chartX
                        val lastX = points.last().chartX
                        val target = if (lastX == firstX) {
                            firstX
                        } else {
                            firstX + ((offset.x - left) / (right - left)).coerceIn(0f, 1f) * (lastX - firstX)
                        }
                        nearestProgressPointIndex(points, target)?.let(onSelect)
                    }
                },
        ) {
            val left = 12.dp.toPx()
            val right = size.width - 46.dp.toPx()
            val top = 14.dp.toPx()
            val bottom = size.height - 14.dp.toPx()
            repeat(5) { index ->
                val y = top + (bottom - top) * index / 4f
                drawLine(gridColor, Offset(left, y), Offset(right, y), strokeWidth = 1.dp.toPx())
            }
            val valueRange = (maxValue - minValue).takeIf { it > 0 } ?: 1.0
            val firstX = points.first().chartX
            val lastX = points.last().chartX
            val xRange = (lastX - firstX).takeIf { it > 0 } ?: 1.0
            val coordinates = points.map { point ->
                val x = if (points.size == 1) {
                    (left + right) / 2f
                } else {
                    left + ((point.chartX - firstX) / xRange).toFloat() * (right - left)
                }
                val y = bottom - ((point.value - minValue) / valueRange).toFloat() * (bottom - top)
                Offset(x, y)
            }
            if (coordinates.size > 1) {
                val path = Path().apply {
                    moveTo(coordinates.first().x, coordinates.first().y)
                    coordinates.zipWithNext().forEach { (previous, current) ->
                        val middle = (previous.x + current.x) / 2f
                        cubicTo(middle, previous.y, middle, current.y, current.x, current.y)
                    }
                }
                drawPath(path, lineColor, style = Stroke(width = 3.dp.toPx(), cap = StrokeCap.Round))
            }
            coordinates.forEachIndexed { index, point ->
                drawCircle(if (index == selectedIndex) selectedColor else lineColor, 5.dp.toPx(), point)
                drawCircle(Color.White, 2.dp.toPx(), point)
            }
        }
        Column(
            modifier = Modifier.align(Alignment.CenterEnd).height(220.dp),
            verticalArrangement = Arrangement.SpaceBetween,
            horizontalAlignment = Alignment.End,
        ) {
            Text(formatProgressValue(maxValue), style = MaterialTheme.typography.labelSmall)
            Text(formatProgressValue(minValue), style = MaterialTheme.typography.labelSmall)
        }
    }
}

@Composable
private fun ProgressDateTicks(points: List<ProgressChartPoint>) {
    val indices = remember(points.size) {
        if (points.size <= 5) points.indices.toList()
        else (0..4).map { step -> (step * points.lastIndex / 4.0).toInt() }.distinct()
    }
    Row(modifier = Modifier.fillMaxWidth()) {
        indices.forEach { index ->
            Text(
                formatProgressShortDate(points[index].source.sessionStartedAt),
                modifier = Modifier.weight(1f),
                textAlign = TextAlign.Center,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun ProgressSummaryCard(exercise: MobileProgressExerciseDto, unit: String) {
    val first = exercise.points.first()
    val last = exercise.points.last()
    val firstWeight = roundWeight(toDisplayWeight(first.maxWeight, unit), 1)
    val lastWeight = roundWeight(toDisplayWeight(last.maxWeight, unit), 1)
    val delta = roundWeight(lastWeight - firstWeight, 1)
    Card(
        shape = RoundedCornerShape(9.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.45f)),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(modifier = Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(stringResource(R.string.progress_summary), style = MaterialTheme.typography.titleMedium)
            DetailSummaryRow(stringResource(R.string.sessions), exercise.points.size.toString())
            DetailSummaryRow(
                stringResource(R.string.load_range),
                "${formatProgressValue(firstWeight)} → ${formatProgressValue(lastWeight)} ${unit.lowercase(Locale.getDefault())}",
            )
            DetailSummaryRow(
                stringResource(R.string.load_change),
                "${if (delta > 0) "+" else ""}${formatProgressValue(delta)} ${unit.lowercase(Locale.getDefault())}",
            )
        }
    }
}

@Composable
private fun DetailSummaryRow(label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, fontWeight = FontWeight.Medium, textAlign = TextAlign.End)
    }
}

@Composable
private fun progressMetricLabel(metric: ProgressMetric): String = stringResource(
    when (metric) {
        ProgressMetric.MAX_WEIGHT -> R.string.metric_max_weight
        ProgressMetric.ESTIMATED_1RM -> R.string.metric_estimated_1rm
        ProgressMetric.TOTAL_VOLUME -> R.string.metric_total_volume
        ProgressMetric.TOP_SET_REPS -> R.string.metric_top_set_reps
        ProgressMetric.MAX_REPS -> R.string.metric_max_reps
        ProgressMetric.TOTAL_REPS -> R.string.metric_total_reps
    },
)

@Composable
private fun progressMetricColor(metric: ProgressMetric): Color = when (metric) {
    ProgressMetric.MAX_WEIGHT -> MaterialTheme.colorScheme.primary
    ProgressMetric.ESTIMATED_1RM -> Color(0xFFA855F7)
    ProgressMetric.TOTAL_VOLUME -> Color(0xFF10B981)
    ProgressMetric.TOP_SET_REPS -> Color(0xFFF59E0B)
    ProgressMetric.MAX_REPS -> Color(0xFF0EA5E9)
    ProgressMetric.TOTAL_REPS -> Color(0xFFF43F5E)
}

@Composable
private fun progressRangeLabel(range: ProgressRange): String = stringResource(
    when (range) {
        ProgressRange.ONE_WEEK -> R.string.range_one_week
        ProgressRange.ONE_MONTH -> R.string.range_one_month
        ProgressRange.TWO_MONTHS -> R.string.range_two_months
        ProgressRange.FOUR_MONTHS -> R.string.range_four_months
        ProgressRange.SIX_MONTHS -> R.string.range_six_months
        ProgressRange.ONE_YEAR -> R.string.range_one_year
        ProgressRange.ALL -> R.string.range_all
    },
)

private fun formatProgressValue(value: Double): String = if (value % 1.0 == 0.0) {
    value.toInt().toString()
} else {
    String.format(Locale.ROOT, "%.1f", value).trimEnd('0').trimEnd('.')
}

private fun formatProgressDate(value: String): String = runCatching {
    Instant.parse(value).atZone(ZoneId.systemDefault())
        .format(DateTimeFormatter.ofPattern("dd MMM yyyy", Locale.getDefault()))
}.getOrElse { value.take(10) }

private fun formatProgressShortDate(value: String): String = runCatching {
    Instant.parse(value).atZone(ZoneId.systemDefault())
        .format(DateTimeFormatter.ofPattern("dd.MM", Locale.getDefault()))
}.getOrElse { value.take(10) }
