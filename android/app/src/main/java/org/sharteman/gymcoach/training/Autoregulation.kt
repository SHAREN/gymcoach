package org.sharteman.gymcoach.training

import org.sharteman.gymcoach.data.local.LocalSetEntity
import org.sharteman.gymcoach.data.model.GymDto
import org.sharteman.gymcoach.data.model.ProgramExerciseDto
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.round


data class LoadConstraints(
    val equipmentType: String,
    val isAvailable: Boolean = true,
    val dumbbellWeights: List<Double> = emptyList(),
    val plateWeights: List<Double> = emptyList(),
    val barWeights: List<Double> = emptyList(),
    val weightOptions: List<Double> = emptyList(),
)

data class SetRecommendation(
    val weight: Double,
    val reps: Int,
    val rir: Int,
    val reason: String,
    val predictedRepsAtSameLoad: Int,
    val fatigueLoss: Double,
    val confidence: String,
)

fun constraintsFor(programExercise: ProgramExerciseDto, gym: GymDto?): LoadConstraints {
    val equipmentType = resolveEquipmentType(
        programExercise.exercise.equipmentType,
        programExercise.exercise.name,
    )
    if (gym == null) return LoadConstraints(equipmentType)
    val config = gym.exerciseConfigs.firstOrNull { it.exerciseId == programExercise.exerciseId }
    return LoadConstraints(
        equipmentType = equipmentType,
        isAvailable = config?.isAvailable ?: true,
        dumbbellWeights = config?.dumbbellWeights?.takeIf { it.isNotEmpty() }
            ?: gym.dumbbellWeights,
        plateWeights = config?.plateWeights?.takeIf { it.isNotEmpty() } ?: gym.plateWeights,
        barWeights = config?.barWeights?.takeIf { it.isNotEmpty() } ?: gym.barWeights,
        weightOptions = config?.weightOptions ?: emptyList(),
    )
}

fun recommendNextSet(
    programExercise: ProgramExerciseDto,
    completedSets: List<LocalSetEntity>,
    recoverySec: Int?,
    sameMuscleSuperset: Boolean = false,
    allowLoadIncrease: Boolean = true,
    maxWeight: Double? = null,
    constraints: LoadConstraints? = null,
): SetRecommendation? {
    if (programExercise.exercise.category == "CARDIO") return null
    val workingSets = completedSets.filter { !it.isWarmup && !it.isDropSet && !it.deleted }
    val lastSet = workingSets.lastOrNull() ?: return null
    val fatigueRate = programExercise.fatigueRate ?: defaultFatigueRate(programExercise)
    val loadAdjustmentPct = (programExercise.loadAdjustmentPct ?: 2.5).coerceIn(1.0, 5.0)
    val actualRir = lastSet.rir ?: programExercise.targetRIR
    val lastCapacity = lastSet.reps + actualRir
    val restModifier = if (recoverySec == null || recoverySec <= 0) {
        1.0
    } else {
        (programExercise.restSec.toDouble() / recoverySec).coerceIn(0.75, 1.5)
    }
    val supersetModifier = if (sameMuscleSuperset) 1.25 else 1.0
    val fatigueLoss = roundTo(fatigueRate.coerceIn(0.25, 2.0) * restModifier * supersetModifier, 2)
    val nextCapacity = max(0.0, lastCapacity - fatigueLoss)
    val predictedRepsAtSameLoad = max(0, round(nextCapacity - programExercise.targetRIR).toInt())
    val preserveReps = programExercise.autoregulationMode == "PRESERVE_REPS"
    val desiredReps = if (preserveReps) {
        lastSet.reps.coerceIn(programExercise.targetRepsMin, programExercise.targetRepsMax)
    } else {
        predictedRepsAtSameLoad.coerceIn(
            programExercise.targetRepsMin,
            programExercise.targetRepsMax,
        )
    }

    var capacityGap = when {
        preserveReps -> desiredReps - predictedRepsAtSameLoad
        predictedRepsAtSameLoad < programExercise.targetRepsMin ->
            programExercise.targetRepsMin - predictedRepsAtSameLoad
        predictedRepsAtSameLoad > programExercise.targetRepsMax ->
            programExercise.targetRepsMax - predictedRepsAtSameLoad
        else -> 0
    }
    if (!allowLoadIncrease && capacityGap < 0) capacityGap = 0
    val adjustmentPct = (capacityGap * loadAdjustmentPct).coerceIn(-5.0, 10.0)
    val increment = if (programExercise.exercise.category == "COMPOUND") 2.5 else 1.0
    val calculatedWeight = adjustWeight(lastSet.weight, adjustmentPct, increment)
    val inventoryWeight = constrainGymWeight(calculatedWeight, lastSet.weight, constraints)
    val adjustedWeight = if (maxWeight != null && inventoryWeight > maxWeight) {
        constrainGymWeightAtOrBelow(maxWeight, constraints)
    } else {
        inventoryWeight
    }
    val reason = when {
        lastSet.weight == 0.0 && capacityGap > 0 -> "bodyweight-adjust-reps"
        adjustedWeight < lastSet.weight -> "reduce-load"
        adjustedWeight > lastSet.weight -> "increase-load"
        predictedRepsAtSameLoad != lastSet.reps -> "adjust-reps"
        else -> "hold-load"
    }
    return SetRecommendation(
        weight = adjustedWeight,
        reps = if (reason == "bodyweight-adjust-reps") max(1, predictedRepsAtSameLoad) else desiredReps,
        rir = programExercise.targetRIR,
        reason = reason,
        predictedRepsAtSameLoad = predictedRepsAtSameLoad,
        fatigueLoss = fatigueLoss,
        confidence = if (lastSet.rir == null) "low" else if (workingSets.size >= 3) "high" else "medium",
    )
}

fun gymWeightOptions(constraints: LoadConstraints?, referenceWeight: Double): List<Double> {
    if (constraints == null || !constraints.isAvailable) return emptyList()
    return when (constraints.equipmentType) {
        "DUMBBELL" -> uniquePositive(constraints.dumbbellWeights)
        "BARBELL" -> constructibleBarbellWeights(
            constraints.barWeights,
            constraints.plateWeights,
            max(200.0, referenceWeight + 100.0),
        )
        else -> uniquePositive(constraints.weightOptions)
    }
}

fun constrainGymWeight(
    targetWeight: Double,
    referenceWeight: Double,
    constraints: LoadConstraints?,
): Double {
    if (constraints == null || !constraints.isAvailable || targetWeight <= 0) return roundTo(targetWeight)
    val options = when (constraints.equipmentType) {
        "DUMBBELL" -> constraints.dumbbellWeights
        "BARBELL" -> constructibleBarbellWeights(
            constraints.barWeights,
            constraints.plateWeights,
            max(targetWeight, referenceWeight),
        )
        "CARDIO" -> return roundTo(targetWeight)
        else -> constraints.weightOptions
    }.let(::uniquePositive)
    if (options.isEmpty()) return roundTo(targetWeight)
    val directional = when {
        targetWeight < referenceWeight -> options.filter { it < referenceWeight }
        targetWeight > referenceWeight -> options.filter { it > referenceWeight }
        else -> options
    }
    if (directional.isEmpty()) return roundTo(referenceWeight)
    return roundTo(nearest(directional, targetWeight))
}

fun constrainGymWeightAtOrBelow(targetWeight: Double, constraints: LoadConstraints?): Double {
    if (constraints != null && !constraints.isAvailable) return 0.0
    if (constraints == null || targetWeight <= 0) return roundTo(max(0.0, targetWeight))
    return gymWeightOptions(constraints, targetWeight).filter { it <= targetWeight }.lastOrNull()
        ?: 0.0
}

fun constructibleBarbellWeights(
    barWeights: List<Double>,
    plateWeights: List<Double>,
    targetCeiling: Double,
): List<Double> {
    val bars = uniquePositive(barWeights)
    val plates = uniquePositive(plateWeights)
    if (bars.isEmpty() || plates.isEmpty()) return bars
    val maxPlate = plates.lastOrNull() ?: 0.0
    val maxTotal = min(5000.0, max(bars.max(), targetCeiling + maxPlate * 4 + 50))
    val plateUnits = plates.map(::toUnits)
    val divisor = plateUnits.reduce(::gcd)
    val scaledPlates = plateUnits.map { it / divisor }.distinct()
    val totals = bars.toMutableSet()
    for (bar in bars) {
        val maxPerSide = max(0, toUnits((maxTotal - bar) / 2) / divisor)
        val reachable = BooleanArray(maxPerSide + 1)
        reachable[0] = true
        for (current in 0..maxPerSide) {
            if (!reachable[current]) continue
            for (plate in scaledPlates) {
                val next = current + plate
                if (next <= maxPerSide) reachable[next] = true
            }
        }
        for (perSide in 0..maxPerSide) {
            if (reachable[perSide]) totals += roundTo(bar + (perSide * divisor * 2) / 100.0)
        }
    }
    return totals.sorted()
}

private fun defaultFatigueRate(programExercise: ProgramExerciseDto): Double {
    if (programExercise.exercise.category == "ISOLATION") return 0.5
    return if (
        programExercise.exercise.muscleGroup in setOf("QUADS", "HAMSTRINGS", "GLUTES", "LOWER_BACK")
    ) 1.0 else 0.75
}

private fun adjustWeight(weight: Double, adjustmentPct: Double, increment: Double): Double {
    if (adjustmentPct == 0.0 || weight <= 0) return weight
    val raw = max(0.0, weight * (1 - adjustmentPct / 100))
    var rounded = round(raw / increment) * increment
    if (adjustmentPct > 0 && rounded >= weight) rounded = max(0.0, weight - increment)
    if (adjustmentPct < 0 && rounded <= weight) rounded = weight + increment
    return roundTo(rounded)
}

private fun resolveEquipmentType(type: String, name: String): String {
    if (type != "OTHER") return type
    val lower = name.lowercase()
    return when {
        Regex("barbell|ez[- ]?bar|штанг|ez[- ]?гриф|сз[- ]?гриф").containsMatchIn(lower) -> "BARBELL"
        Regex("dumbbells?|гантел").containsMatchIn(lower) -> "DUMBBELL"
        Regex("cable|трос|кроссовер").containsMatchIn(lower) -> "CABLE"
        Regex("machine|тренаж[её]р").containsMatchIn(lower) -> "MACHINE"
        else -> type
    }
}

private fun nearest(options: List<Double>, target: Double): Double = options.reduce { best, value ->
    val distance = abs(value - target)
    val bestDistance = abs(best - target)
    if (distance < bestDistance || (distance == bestDistance && value < best)) value else best
}

private fun uniquePositive(values: List<Double>): List<Double> = values
    .filter { it.isFinite() && it > 0 }
    .map(::roundTo)
    .distinct()
    .sorted()

private fun toUnits(value: Double) = round(value * 100).toInt()
private fun gcd(leftValue: Int, rightValue: Int): Int {
    var left = abs(leftValue)
    var right = abs(rightValue)
    while (right != 0) {
        val next = left % right
        left = right
        right = next
    }
    return if (left == 0) 1 else left
}
private fun roundTo(value: Double, decimals: Int = 2): Double {
    val factor = Math.pow(10.0, decimals.toDouble())
    return round(value * factor) / factor
}
