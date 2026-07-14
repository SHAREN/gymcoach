package org.sharteman.gymcoach.training

import java.text.NumberFormat
import java.util.Locale
import kotlin.math.floor

enum class SetTableMetric {
    ONE_RM,
    TEN_RM,
    VOLUME,
    ;

    companion object {
        fun fromStoredValue(value: String?): SetTableMetric =
            entries.firstOrNull { it.name == value } ?: ONE_RM
    }
}

fun normalizeSetTableMetrics(
    values: Iterable<SetTableMetric>?,
    fallbackRm: SetTableMetric = SetTableMetric.ONE_RM,
): List<SetTableMetric> {
    val selected = values?.toSet() ?: emptySet()
    val hasVolume = SetTableMetric.VOLUME in selected
    val rm = when {
        SetTableMetric.TEN_RM in selected -> SetTableMetric.TEN_RM
        SetTableMetric.ONE_RM in selected -> SetTableMetric.ONE_RM
        else -> null
    }

    if (rm != null) {
        return if (hasVolume) listOf(rm, SetTableMetric.VOLUME) else listOf(rm)
    }
    if (hasVolume) return listOf(SetTableMetric.VOLUME)
    return listOf(
        fallbackRm.takeIf {
            it == SetTableMetric.ONE_RM || it == SetTableMetric.TEN_RM
        } ?: SetTableMetric.ONE_RM,
    )
}

fun setTableMetricEnabled(
    current: Iterable<SetTableMetric>?,
    metric: SetTableMetric,
    enabled: Boolean,
): List<SetTableMetric> {
    val normalized = normalizeSetTableMetrics(current)
    if (!enabled) {
        if (normalized.size == 1 && normalized.single() == metric) return normalized
        return normalized.filterNot { it == metric }
    }

    return when (metric) {
        SetTableMetric.ONE_RM -> if (SetTableMetric.VOLUME in normalized) {
            listOf(SetTableMetric.ONE_RM, SetTableMetric.VOLUME)
        } else {
            listOf(SetTableMetric.ONE_RM)
        }
        SetTableMetric.TEN_RM -> if (SetTableMetric.VOLUME in normalized) {
            listOf(SetTableMetric.TEN_RM, SetTableMetric.VOLUME)
        } else {
            listOf(SetTableMetric.TEN_RM)
        }
        SetTableMetric.VOLUME -> {
            val rm = normalized.firstOrNull {
                it == SetTableMetric.ONE_RM || it == SetTableMetric.TEN_RM
            }
            if (rm != null) listOf(rm, SetTableMetric.VOLUME) else listOf(SetTableMetric.VOLUME)
        }
    }
}

fun calculateSetTableMetric(
    metric: SetTableMetric,
    weightKg: Double,
    reps: Int,
): Double {
    if (!weightKg.isFinite() || weightKg <= 0.0 || reps <= 0) return 0.0
    return when (metric) {
        SetTableMetric.ONE_RM -> weightKg * (1.0 + reps / 30.0)
        SetTableMetric.TEN_RM -> {
            val oneRm = weightKg * (1.0 + reps / 30.0)
            oneRm / (1.0 + 10.0 / 30.0)
        }
        SetTableMetric.VOLUME -> weightKg * reps
    }
}

fun formatSetTableMetric(
    metric: SetTableMetric,
    weightKg: Double,
    reps: Int,
    unit: String,
    locale: Locale = Locale.getDefault(),
): String {
    val valueKg = calculateSetTableMetric(metric, weightKg, reps)
    if (valueKg <= 0.0) return "–"
    val rounded = floor(toDisplayWeight(valueKg, unit) * 10.0 + 0.5) / 10.0
    return NumberFormat.getNumberInstance(locale).apply {
        minimumFractionDigits = 0
        maximumFractionDigits = 1
        isGroupingUsed = false
    }.format(rounded)
}
