package org.sharteman.gymcoach.training

import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.round

data class PlateGroup(
    val plate: Double,
    val count: Int,
)

data class PlateLoad(
    val barWeight: Double,
    val perSide: List<PlateGroup>,
    val achievedWeight: Double,
    val remainder: Double,
    val exact: Boolean,
)

fun computeBestPlateLoad(
    targetWeight: Double,
    availableBars: List<Double>,
    availablePlates: List<Double>,
    fallbackBarWeight: Double,
): PlateLoad {
    val bars = availableBars
        .filter { it.isFinite() && it > 0 }
        .map(::cleanPlateValue)
        .distinct()
    val candidates = (bars.ifEmpty { listOf(fallbackBarWeight) }).map { barWeight ->
        computePlateLoad(targetWeight, barWeight, availablePlates)
    }
    return candidates.sortedWith(
        compareByDescending<PlateLoad> { it.exact }
            .thenBy { it.remainder }
            .thenByDescending { it.achievedWeight }
            .thenBy(::plateCount)
            .thenBy { abs(it.barWeight - fallbackBarWeight) }
            .thenBy { it.barWeight },
    ).first()
}

fun computePlateLoad(
    targetWeight: Double,
    barWeight: Double,
    availablePlates: List<Double>,
): PlateLoad {
    val plates = availablePlates
        .filter { it.isFinite() && it > 0 }
        .sortedDescending()

    if (!targetWeight.isFinite() || targetWeight <= barWeight) {
        val remainder = if (targetWeight.isFinite()) {
            cleanPlateValue((targetWeight - barWeight).coerceAtLeast(0.0))
        } else {
            0.0
        }
        return PlateLoad(
            barWeight = barWeight,
            perSide = emptyList(),
            achievedWeight = barWeight,
            remainder = remainder,
            exact = cleanPlateValue(targetWeight) == cleanPlateValue(barWeight),
        )
    }

    var perSideRemaining = cleanPlateValue((targetWeight - barWeight) / 2)
    val perSide = buildList {
        for (plate in plates) {
            if (perSideRemaining < plate) continue
            val count = floor(cleanPlateValue(perSideRemaining / plate)).toInt()
            if (count > 0) {
                add(PlateGroup(plate = plate, count = count))
                perSideRemaining = cleanPlateValue(perSideRemaining - plate * count)
            }
        }
    }
    val loadedPerSide = perSide.fold(0.0) { total, group ->
        cleanPlateValue(total + group.plate * group.count)
    }
    val achievedWeight = cleanPlateValue(barWeight + loadedPerSide * 2)
    val remainder = cleanPlateValue(targetWeight - achievedWeight)

    return PlateLoad(
        barWeight = barWeight,
        perSide = perSide,
        achievedWeight = achievedWeight,
        remainder = remainder,
        exact = remainder == 0.0,
    )
}

private fun plateCount(load: PlateLoad): Int = load.perSide.sumOf { it.count }

private fun cleanPlateValue(value: Double): Double = round(value * 1000) / 1000
