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
    val loadingSides: Int = 2,
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

fun computeEquipmentPlateLoad(
    targetWeight: Double,
    baseLoad: Double,
    availablePlates: List<PlateInventoryItem>,
    loadingSides: Int,
): PlateLoad {
    val sides = loadingSides.takeIf { it > 0 } ?: 2
    val base = cleanPlateValue(baseLoad.coerceAtLeast(0.0))
    if (!targetWeight.isFinite() || targetWeight <= base) {
        return PlateLoad(
            barWeight = base,
            perSide = emptyList(),
            achievedWeight = base,
            remainder = if (targetWeight.isFinite()) {
                cleanPlateValue((targetWeight - base).coerceAtLeast(0.0))
            } else {
                0.0
            },
            exact = cleanPlateValue(targetWeight) == base,
            loadingSides = sides,
        )
    }

    val normalized = availablePlates
        .filter { it.weightKg.isFinite() && it.weightKg > 0 }
        .associateBy { cleanPlateValue(it.weightKg) }
        .values
        .sortedByDescending { it.weightKg }
    val maxAddedUnits = toPlateUnits(targetWeight - base).coerceAtLeast(0)
    val reachable = BooleanArray(maxAddedUnits + 1)
    val previousAmount = IntArray(maxAddedUnits + 1) { -1 }
    val previousPlate = IntArray(maxAddedUnits + 1) { -1 }
    reachable[0] = true

    normalized.forEachIndexed { plateIndex, item ->
        val increment = toPlateUnits(item.weightKg * sides)
        if (increment <= 0) return@forEachIndexed
        val groups = item.quantity
            ?.coerceAtLeast(0)
            ?.div(sides)
            ?: (maxAddedUnits / increment)
        repeat(groups) {
            for (current in (maxAddedUnits - increment) downTo 0) {
                if (!reachable[current] || reachable[current + increment]) continue
                reachable[current + increment] = true
                previousAmount[current + increment] = current
                previousPlate[current + increment] = plateIndex
            }
        }
    }

    var bestAddedUnits = maxAddedUnits
    while (bestAddedUnits > 0 && !reachable[bestAddedUnits]) bestAddedUnits -= 1
    val countByPlate = linkedMapOf<Double, Int>()
    var current = bestAddedUnits
    while (current > 0) {
        val plateIndex = previousPlate[current]
        val previous = previousAmount[current]
        if (plateIndex < 0 || previous < 0) break
        val plate = cleanPlateValue(normalized[plateIndex].weightKg)
        countByPlate[plate] = (countByPlate[plate] ?: 0) + 1
        current = previous
    }
    val achievedWeight = cleanPlateValue(base + bestAddedUnits / 1000.0)
    val remainder = cleanPlateValue(targetWeight - achievedWeight)
    return PlateLoad(
        barWeight = base,
        perSide = countByPlate.entries
            .map { PlateGroup(plate = it.key, count = it.value) }
            .sortedByDescending { it.plate },
        achievedWeight = achievedWeight,
        remainder = remainder,
        exact = remainder == 0.0,
        loadingSides = sides,
    )
}

private fun plateCount(load: PlateLoad): Int = load.perSide.sumOf { it.count }

private fun cleanPlateValue(value: Double): Double = round(value * 1000) / 1000

private fun toPlateUnits(value: Double): Int = round(cleanPlateValue(value) * 1000).toInt()
