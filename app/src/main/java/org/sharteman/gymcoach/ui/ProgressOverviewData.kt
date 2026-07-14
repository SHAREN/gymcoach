package org.sharteman.gymcoach.ui

import org.sharteman.gymcoach.data.model.MobileBodyMeasurementDto
import org.sharteman.gymcoach.data.model.MobileBodyweightEntryDto
import org.sharteman.gymcoach.data.model.MobileConditioningWeekDto
import org.sharteman.gymcoach.data.model.MobileWeeklyVolumeDto
import org.sharteman.gymcoach.training.toDisplayWeight
import java.util.Locale

private const val CM_PER_INCH = 2.54

fun displayWeeklyVolume(valueKgReps: Double, unit: String): Double =
    toDisplayWeight(valueKgReps, unit)

fun displayBodyweight(weightKg: Double, unit: String): Double =
    toDisplayWeight(weightKg, unit)

fun displayMeasurement(valueCm: Double, unit: String): Double =
    if (unit.equals("LB", ignoreCase = true)) valueCm / CM_PER_INCH else valueCm

fun measurementUnit(unit: String): String =
    if (unit.equals("LB", ignoreCase = true)) "in" else "cm"

fun measurementSites(measurements: List<MobileBodyMeasurementDto>): List<String> =
    measurements
        .map { it.site }
        .distinctBy { it.uppercase(Locale.ROOT) }
        .sortedBy { it.uppercase(Locale.ROOT) }

fun measurementsForSite(
    measurements: List<MobileBodyMeasurementDto>,
    site: String,
): List<MobileBodyMeasurementDto> = measurements
    .filter { it.site.equals(site, ignoreCase = true) }
    .sortedBy { it.measuredAt }

fun oldestFirstWeeklyVolume(points: List<MobileWeeklyVolumeDto>): List<MobileWeeklyVolumeDto> =
    points.sortedBy { it.weekStartIso }

fun oldestFirstBodyweight(entries: List<MobileBodyweightEntryDto>): List<MobileBodyweightEntryDto> =
    entries.sortedBy { it.measuredAt }

fun oldestFirstConditioning(
    weeks: List<MobileConditioningWeekDto>,
): List<MobileConditioningWeekDto> = weeks.sortedBy { it.weekStartIso }
