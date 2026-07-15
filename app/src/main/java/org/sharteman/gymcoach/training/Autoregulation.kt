package org.sharteman.gymcoach.training

import org.sharteman.gymcoach.data.local.LocalSetEntity
import org.sharteman.gymcoach.data.model.GymDto
import org.sharteman.gymcoach.data.model.GymEquipmentDto
import org.sharteman.gymcoach.data.model.ProgramExerciseDto
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.round

data class PlateInventoryItem(
    val weightKg: Double,
    val quantity: Int?,
)

data class ResolvedEquipmentLoadProfile(
    val equipmentId: String,
    val equipmentName: String,
    val equipmentType: String,
    val loadType: String,
    val weightOptions: List<Double>,
    val selectedLoadMultiplier: Double,
    val baseLoadKg: Double,
    val loadingSides: Int,
    val platePoolId: String?,
    val platePoolName: String?,
    val plates: List<PlateInventoryItem>,
    val attainableLoads: List<Double>,
    val inventoryPrecision: String,
)

data class LoadConstraints(
    val equipmentType: String,
    val isAvailable: Boolean = true,
    val dumbbellWeights: List<Double> = emptyList(),
    val plateWeights: List<Double> = emptyList(),
    val barWeights: List<Double> = emptyList(),
    val weightOptions: List<Double> = emptyList(),
    val equipmentId: String? = null,
    val equipmentOptions: List<ResolvedEquipmentLoadProfile> = emptyList(),
)

data class ExerciseInventory(
    val isAvailable: Boolean,
    val source: String,
    val equipment: List<ResolvedEquipmentLoadProfile>,
    val requiresEquipmentSelection: Boolean,
    val weightOptions: List<Double>,
    val constraints: LoadConstraints,
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

fun resolveExerciseInventory(
    programExercise: ProgramExerciseDto,
    gym: GymDto?,
    selectedEquipmentId: String? = null,
): ExerciseInventory {
    val equipmentType = resolveEquipmentType(
        programExercise.exercise.equipmentType,
        programExercise.exercise.name,
    )
    if (gym == null) {
        val constraints = LoadConstraints(equipmentType = equipmentType)
        return ExerciseInventory(true, "no-gym", emptyList(), false, emptyList(), constraints)
    }

    val linkedEquipment = gym.equipment
        .filter { equipment ->
            equipment.exerciseLinks.any { link -> link.exerciseId == programExercise.exerciseId }
        }
        .map { equipment -> resolveEquipmentLoadProfile(equipment, gym) }
    if (linkedEquipment.isNotEmpty()) {
        val requiresSelection = linkedEquipment.size > 1
        val resolvedEquipmentId = selectedEquipmentId
            ?.takeIf { id -> linkedEquipment.any { it.equipmentId == id } }
            ?: linkedEquipment.singleOrNull()?.equipmentId
        val selected = linkedEquipment.firstOrNull { it.equipmentId == resolvedEquipmentId }
        val constraints = LoadConstraints(
            equipmentType = equipmentType,
            isAvailable = true,
            equipmentId = resolvedEquipmentId,
            equipmentOptions = linkedEquipment,
        )
        return ExerciseInventory(
            isAvailable = true,
            source = "equipment",
            equipment = linkedEquipment,
            requiresEquipmentSelection = requiresSelection,
            weightOptions = selected?.attainableLoads ?: emptyList(),
            constraints = constraints,
        )
    }

    if (equipmentType == "DUMBBELL" && gym.dumbbellWeights.isNotEmpty()) {
        val weights = uniquePositive(gym.dumbbellWeights)
        val constraints = LoadConstraints(
            equipmentType = equipmentType,
            isAvailable = true,
            dumbbellWeights = weights,
        )
        return ExerciseInventory(true, "shared-dumbbells", emptyList(), false, weights, constraints)
    }

    val legacyConfig = gym.exerciseConfigs.firstOrNull {
        it.exerciseId == programExercise.exerciseId
    }
    if (legacyConfig != null) {
        val constraints = LoadConstraints(
            equipmentType = equipmentType,
            isAvailable = legacyConfig.isAvailable,
            weightOptions = legacyConfig.weightOptions,
            dumbbellWeights = legacyConfig.dumbbellWeights.takeIf { it.isNotEmpty() }
                ?: gym.dumbbellWeights,
            plateWeights = legacyConfig.plateWeights.takeIf { it.isNotEmpty() }
                ?: gym.plateWeights,
            barWeights = legacyConfig.barWeights.takeIf { it.isNotEmpty() }
                ?: gym.barWeights,
        )
        return ExerciseInventory(
            isAvailable = legacyConfig.isAvailable,
            source = "legacy-config",
            equipment = emptyList(),
            requiresEquipmentSelection = false,
            weightOptions = gymWeightOptions(constraints, 200.0),
            constraints = constraints,
        )
    }

    if (equipmentType == "BODYWEIGHT" || equipmentType == "CARDIO") {
        val constraints = LoadConstraints(equipmentType = equipmentType, isAvailable = true)
        return ExerciseInventory(true, "implicit", emptyList(), false, emptyList(), constraints)
    }

    if (gym.inventoryMode == "LEGACY") {
        val constraints = LoadConstraints(
            equipmentType = equipmentType,
            isAvailable = true,
            dumbbellWeights = gym.dumbbellWeights,
            plateWeights = gym.plateWeights,
            barWeights = gym.barWeights,
        )
        return ExerciseInventory(
            isAvailable = true,
            source = "legacy-gym",
            equipment = emptyList(),
            requiresEquipmentSelection = false,
            weightOptions = gymWeightOptions(constraints, 200.0),
            constraints = constraints,
        )
    }

    val constraints = LoadConstraints(equipmentType = equipmentType, isAvailable = false)
    return ExerciseInventory(false, "none", emptyList(), false, emptyList(), constraints)
}

fun constraintsFor(
    programExercise: ProgramExerciseDto,
    gym: GymDto?,
    selectedEquipmentId: String? = null,
): LoadConstraints = resolveExerciseInventory(programExercise, gym, selectedEquipmentId).constraints

fun selectedEquipment(
    inventory: ExerciseInventory,
): ResolvedEquipmentLoadProfile? = inventory.constraints.equipmentId?.let { selectedId ->
    inventory.equipment.firstOrNull { it.equipmentId == selectedId }
}

fun nominalResistanceKg(
    profile: ResolvedEquipmentLoadProfile?,
    selectedLoadKg: Double,
): Double? = profile
    ?.takeIf { it.loadType == "SELECTORIZED" }
    ?.let { roundTo(selectedLoadKg * it.selectedLoadMultiplier) }

fun isAchievableLoad(constraints: LoadConstraints?, weight: Double): Boolean {
    if (constraints == null || !constraints.isAvailable) return false
    val options = gymWeightOptions(constraints, weight)
    return options.isEmpty() || roundTo(weight) in options
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
    if (constraints.equipmentOptions.isNotEmpty()) {
        val selected = constraints.equipmentId
            ?.let { id -> constraints.equipmentOptions.firstOrNull { it.equipmentId == id } }
            ?: constraints.equipmentOptions.singleOrNull()
        return selected?.attainableLoads ?: emptyList()
    }
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
    if (constraints.equipmentOptions.isNotEmpty()) {
        val options = uniquePositive(gymWeightOptions(constraints, max(targetWeight, referenceWeight)))
        if (options.isEmpty()) return roundTo(targetWeight)
        return selectDirectionalWeight(options, targetWeight, referenceWeight)
    }
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
    return selectDirectionalWeight(options, targetWeight, referenceWeight)
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

fun resolveEquipmentLoadProfile(
    equipment: GymEquipmentDto,
    gym: GymDto,
    targetCeiling: Double = 500.0,
): ResolvedEquipmentLoadProfile {
    val pool = equipment.platePool
        ?: equipment.platePoolId?.let { id -> gym.platePools.firstOrNull { it.id == id } }
    val plates = pool?.plates.orEmpty().map { PlateInventoryItem(it.weightKg, it.quantity) }
    val resolved = if (equipment.loadType == "PLATE_LOADED") {
        constructiblePlateLoadedWeights(
            baseLoadKg = equipment.baseLoadKg,
            loadingSides = equipment.loadingSides,
            plates = plates,
            targetCeiling = targetCeiling,
        )
    } else {
        val loads = if (equipment.loadType == "FIXED" || equipment.loadType == "SELECTORIZED") {
            uniquePositive(equipment.weightOptions)
        } else {
            emptyList()
        }
        loads to "NOT_APPLICABLE"
    }
    return ResolvedEquipmentLoadProfile(
        equipmentId = equipment.id,
        equipmentName = equipment.name,
        equipmentType = equipment.equipmentType,
        loadType = equipment.loadType,
        weightOptions = equipment.weightOptions,
        selectedLoadMultiplier = equipment.selectedLoadMultiplier,
        baseLoadKg = equipment.baseLoadKg,
        loadingSides = equipment.loadingSides,
        platePoolId = equipment.platePoolId,
        platePoolName = pool?.name,
        plates = plates,
        attainableLoads = resolved.first,
        inventoryPrecision = resolved.second,
    )
}

fun constructiblePlateLoadedWeights(
    baseLoadKg: Double,
    loadingSides: Int,
    plates: List<PlateInventoryItem>,
    targetCeiling: Double,
): Pair<List<Double>, String> {
    val base = roundTo(max(0.0, baseLoadKg))
    val sides = loadingSides.takeIf { it > 0 } ?: 2
    val normalized = plates
        .filter { it.weightKg.isFinite() && it.weightKg > 0 }
        .associateBy { roundTo(it.weightKg) }
        .map { (weight, item) -> PlateInventoryItem(weight, item.quantity) }
        .sortedBy { it.weightKg }
    if (normalized.isEmpty()) {
        return (if (base > 0) listOf(base) else emptyList()) to "KNOWN"
    }

    val hasUnknownQuantity = normalized.any { it.quantity == null }
    val maxPlate = normalized.lastOrNull()?.weightKg ?: 0.0
    val maxTotal = min(5000.0, max(base, targetCeiling + maxPlate * sides * 4 + 50))
    val maxAddedUnits = max(0, toUnits(maxTotal - base))
    val reachable = BooleanArray(maxAddedUnits + 1)
    reachable[0] = true

    for (item in normalized) {
        val increment = toUnits(item.weightKg * sides)
        if (increment <= 0) continue
        if (increment > maxAddedUnits) continue
        if (item.quantity == null) {
            for (current in 0..(maxAddedUnits - increment)) {
                if (reachable[current]) reachable[current + increment] = true
            }
            continue
        }
        val usableGroups = floor(max(0, item.quantity).toDouble() / sides).toInt()
        repeat(usableGroups) {
            for (current in (maxAddedUnits - increment) downTo 0) {
                if (reachable[current]) reachable[current + increment] = true
            }
        }
    }

    val attainable = buildList {
        for (added in 0..maxAddedUnits) {
            if (reachable[added]) add(roundTo(base + added / 100.0))
        }
    }
    return attainable to if (hasUnknownQuantity) "UNKNOWN_QUANTITIES" else "KNOWN"
}

private fun selectDirectionalWeight(options: List<Double>, target: Double, reference: Double): Double {
    val directional = when {
        target < reference -> options.filter { it < reference }
        target > reference -> options.filter { it > reference }
        else -> options
    }
    if (directional.isEmpty()) return roundTo(reference)
    return roundTo(nearest(directional, target))
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
