package org.sharteman.gymcoach.data.settings

import kotlin.math.round
import org.sharteman.gymcoach.data.model.ExerciseDto

private val familyOrder = listOf("LARGE", "SMALL")

internal fun SettingsGymInventoryDto.normalizeSystemProfiles(
    legacyGym: SettingsGymDto? = null,
    exercises: List<ExerciseDto> = emptyList(),
): SettingsGymInventoryDto {
    val coverage = exerciseCoverage.ifEmpty { exercises }
    val configByExercise = legacyGym?.exerciseConfigs.orEmpty().associateBy { it.exerciseId }
    val existing = systemProfiles
    val dumbbellWeights = normalizeWeights(
        existing?.dumbbells?.weightsKg
            ?: sharedFreeWeights.dumbbellWeightsKg.takeIf { it.isNotEmpty() }
            ?: legacyGym?.dumbbellWeights.orEmpty(),
        maximum = 5000.0,
    )
    val dumbbellExercises = normalizeExerciseLinks(
        explicit = existing?.dumbbells?.exerciseLinks,
        fallback = coverage,
        targetType = "DUMBBELL",
        configByExercise = configByExercise,
    )
    val barbellExercises = normalizeExerciseLinks(
        explicit = existing?.barbell?.exerciseLinks,
        fallback = coverage,
        targetType = "BARBELL",
        configByExercise = configByExercise,
    )
    val families = familyOrder.map { family ->
        normalizeFamily(existing?.barbell?.families.orEmpty(), family)
    }

    return copy(
        sharedFreeWeights = sharedFreeWeights.copy(dumbbellWeightsKg = dumbbellWeights),
        systemProfiles = SettingsSystemProfilesDto(
            dumbbells = SettingsDumbbellsSystemProfileDto(
                id = existing?.dumbbells?.id?.takeIf { it.isNotBlank() }
                    ?: "system-profile-dumbbells-$id",
                kind = "DUMBBELLS",
                weightsKg = dumbbellWeights,
                exerciseLinks = dumbbellExercises,
            ),
            barbell = SettingsBarbellSystemProfileDto(
                id = existing?.barbell?.id?.takeIf { it.isNotBlank() }
                    ?: "system-profile-barbell-$id",
                kind = "BARBELL",
                exerciseLinks = barbellExercises,
                families = families,
            ),
        ),
        exerciseCoverage = coverage,
    )
}

internal fun SettingsGymInventoryDto.customEquipment(): List<SettingsGymEquipmentDto> =
    equipment.filter { it.systemBarbellFamily == null }

internal fun resolveSettingsEquipmentType(type: String, name: String): String {
    if (type != "OTHER") return type
    val lower = name.lowercase()
    return when {
        Regex("barbell|ez[- ]?bar|штанг|ez[- ]?гриф|сз[- ]?гриф").containsMatchIn(lower) ->
            "BARBELL"
        Regex("dumbbells?|гантел").containsMatchIn(lower) -> "DUMBBELL"
        Regex("cable|трос|кроссовер").containsMatchIn(lower) -> "CABLE"
        Regex("machine|тренаж[её]р").containsMatchIn(lower) -> "MACHINE"
        else -> type
    }
}

private fun SettingsGymInventoryDto.normalizeFamily(
    sourceFamilies: List<SettingsBarbellFamilyDto>,
    family: String,
): SettingsBarbellFamilyDto {
    val source = sourceFamilies.firstOrNull { it.family == family }
    val sourcePool = source?.pool?.takeIf {
        it.id.isNotBlank() && (it.systemBarbellFamily == null || it.systemBarbellFamily == family)
    }
    val pool = sourcePool
        ?: platePools.firstOrNull { it.systemBarbellFamily == family }
        ?: SettingsGymPlatePoolDto(
            id = "system-profile-pool-${family.lowercase()}-$id",
            name = family,
            compatibilityKey = "system_barbell_${family.lowercase()}",
            systemBarbellFamily = family,
        )
    val sourceBars = source?.bars
        ?: equipment.filter { it.systemBarbellFamily == family }
    val bars = normalizeBars(sourceBars, family, pool.id)
    val loadingSides = source?.loadingSides?.takeIf { it in 1..8 }
        ?: bars.firstOrNull()?.loadingSides?.takeIf { it in 1..8 }
        ?: 2

    return SettingsBarbellFamilyDto(
        family = family,
        pool = pool.copy(
            systemBarbellFamily = family,
            plates = normalizePlates(pool.plates),
        ),
        bars = bars.map { it.copy(loadingSides = loadingSides) },
        loadingSides = loadingSides,
    )
}

private fun normalizeBars(
    bars: List<SettingsGymEquipmentDto>,
    family: String,
    poolId: String,
): List<SettingsGymEquipmentDto> {
    val seenIds = mutableSetOf<String>()
    val seenWeights = mutableSetOf<Double>()
    return bars.asSequence()
        .filter { it.systemBarbellFamily == null || it.systemBarbellFamily == family }
        .mapNotNull { bar ->
            val weight = normalizeWeight(bar.baseLoadKg, 5000.0) ?: return@mapNotNull null
            if (!seenIds.add(bar.id) || !seenWeights.add(weight)) return@mapNotNull null
            bar.copy(
                equipmentType = "BARBELL",
                loadType = "PLATE_LOADED",
                baseLoadKg = weight,
                platePoolId = poolId,
                systemBarbellFamily = family,
            )
        }
        .sortedBy { it.baseLoadKg }
        .toList()
}

private fun normalizePlates(
    plates: List<SettingsGymPlateInventoryItemDto>,
): List<SettingsGymPlateInventoryItemDto> {
    val seenWeights = mutableSetOf<Double>()
    return plates.asSequence()
        .mapNotNull { plate ->
            val weight = normalizeWeight(plate.weightKg, 500.0) ?: return@mapNotNull null
            if (!seenWeights.add(weight)) return@mapNotNull null
            plate.copy(
                weightKg = weight,
                quantity = plate.quantity?.takeIf { it in 0..1000 },
            )
        }
        .sortedBy { it.weightKg }
        .toList()
}

private fun normalizeExerciseLinks(
    explicit: List<ExerciseDto>?,
    fallback: List<ExerciseDto>,
    targetType: String,
    configByExercise: Map<String, SettingsGymExerciseConfigDto>,
): List<ExerciseDto> {
    val source = explicit ?: fallback.filter { exercise ->
        configByExercise[exercise.id]?.systemProfileSupported != false
    }
    return source.asSequence()
        .filter { resolveSettingsEquipmentType(it.equipmentType, it.name) == targetType }
        .distinctBy { it.id }
        .sortedBy { it.name.lowercase() }
        .toList()
}

private fun normalizeWeights(values: List<Double>, maximum: Double): List<Double> = values
    .asSequence()
    .mapNotNull { normalizeWeight(it, maximum) }
    .distinct()
    .sorted()
    .take(200)
    .toList()

private fun normalizeWeight(value: Double, maximum: Double): Double? {
    if (!value.isFinite() || value !in 0.1..maximum) return null
    return round(value * 100.0) / 100.0
}
