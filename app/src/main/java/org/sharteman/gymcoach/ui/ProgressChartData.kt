package org.sharteman.gymcoach.ui

import org.sharteman.gymcoach.data.model.MobileProgressPointDto
import java.time.Instant
import kotlin.math.abs

private const val DAY_MS = 24L * 60 * 60 * 1000
private const val MAX_GAP_RATIO = 3.0

enum class ProgressMetric(val weightMetric: Boolean) {
    MAX_WEIGHT(true),
    ESTIMATED_1RM(true),
    TOTAL_VOLUME(true),
    TOP_SET_REPS(false),
    MAX_REPS(false),
    TOTAL_REPS(false),
}

enum class ProgressRange(val days: Int?) {
    ONE_WEEK(7),
    ONE_MONTH(30),
    TWO_MONTHS(60),
    FOUR_MONTHS(120),
    SIX_MONTHS(180),
    ONE_YEAR(365),
    ALL(null),
}

data class ProgressChartPoint(
    val source: MobileProgressPointDto,
    val chartX: Double,
    val value: Double,
)

fun buildProgressChartPoints(
    points: List<MobileProgressPointDto>,
    metric: ProgressMetric,
    range: ProgressRange,
    nowEpochMs: Long = System.currentTimeMillis(),
): List<ProgressChartPoint> {
    val cutoff = range.days?.let { nowEpochMs - it * DAY_MS }
    val sorted = points.filter { point ->
        cutoff == null || parseEpoch(point.sessionStartedAt) >= cutoff
    }.sortedBy { parseEpoch(it.sessionStartedAt) }
    if (sorted.isEmpty()) return emptyList()

    val gaps = sorted.zipWithNext { left, right ->
        (parseEpoch(right.sessionStartedAt) - parseEpoch(left.sessionStartedAt)).coerceAtLeast(0)
    }.filter { it > 0 }.sorted()
    val baseline = gaps.getOrNull((gaps.size - 1) / 2) ?: DAY_MS
    var chartX = 0.0
    return sorted.mapIndexed { index, point ->
        if (index > 0) {
            val previous = sorted[index - 1]
            val gap = (parseEpoch(point.sessionStartedAt) - parseEpoch(previous.sessionStartedAt))
                .coerceAtLeast(0)
            chartX += (gap.toDouble() / baseline).coerceAtMost(MAX_GAP_RATIO)
        }
        ProgressChartPoint(point, chartX, metricValue(point, metric))
    }
}

fun nearestProgressPointIndex(points: List<ProgressChartPoint>, chartX: Double): Int? =
    points.indices.minByOrNull { index -> abs(points[index].chartX - chartX) }

private fun metricValue(point: MobileProgressPointDto, metric: ProgressMetric): Double = when (metric) {
    ProgressMetric.MAX_WEIGHT -> point.maxWeight
    ProgressMetric.ESTIMATED_1RM -> point.estimated1RM
    ProgressMetric.TOTAL_VOLUME -> point.totalVolume
    ProgressMetric.TOP_SET_REPS -> point.topSetReps.toDouble()
    ProgressMetric.MAX_REPS -> point.maxReps.toDouble()
    ProgressMetric.TOTAL_REPS -> point.totalReps.toDouble()
}

private fun parseEpoch(value: String): Long = runCatching { Instant.parse(value).toEpochMilli() }.getOrDefault(0)
