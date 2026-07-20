package org.sharteman.gymcoach.ui.settings

import kotlin.math.round
import org.sharteman.gymcoach.data.settings.SettingsBarbellFamilyDto
import org.sharteman.gymcoach.data.settings.SettingsBarbellFamilyInput
import org.sharteman.gymcoach.data.settings.SettingsBarbellSystemProfileDto
import org.sharteman.gymcoach.data.settings.SettingsBarbellSystemProfileInput
import org.sharteman.gymcoach.data.settings.SettingsDumbbellsSystemProfileDto
import org.sharteman.gymcoach.data.settings.SettingsDumbbellsSystemProfileInput
import org.sharteman.gymcoach.data.settings.SettingsSystemBarInput
import org.sharteman.gymcoach.data.settings.SettingsSystemPlateInput

internal data class DumbbellsProfileDraft(
    val weights: String,
    val exerciseIds: Set<String>,
)

internal fun SettingsDumbbellsSystemProfileDto.toDraft(): DumbbellsProfileDraft =
    DumbbellsProfileDraft(
        weights = formatWeightList(weightsKg),
        exerciseIds = exerciseLinks.mapTo(linkedSetOf()) { it.id },
    )

internal fun DumbbellsProfileDraft.toInputOrNull(): SettingsDumbbellsSystemProfileInput? {
    val normalizedWeights = parseStrictWeightList(weights, maximum = 5000.0) ?: return null
    if (exerciseIds.size > 500) return null
    return SettingsDumbbellsSystemProfileInput(
        weightsKg = normalizedWeights,
        exerciseIds = exerciseIds.sorted(),
    )
}

internal data class SystemBarDraft(
    val key: Int,
    val equipmentId: String? = null,
    val weight: String = "",
)

internal data class SystemPlateDraft(
    val key: Int,
    val weight: String = "",
    val quantity: String = "",
)

internal data class BarbellFamilyDraft(
    val family: String,
    val loadingSides: String,
    val bars: List<SystemBarDraft>,
    val plates: List<SystemPlateDraft>,
)

internal data class BarbellProfileDraft(
    val exerciseIds: Set<String>,
    val families: List<BarbellFamilyDraft>,
    val originalFamilyByEquipmentId: Map<String, String>,
)

internal fun SettingsBarbellSystemProfileDto.toDraft(): BarbellProfileDraft =
    BarbellProfileDraft(
        exerciseIds = exerciseLinks.mapTo(linkedSetOf()) { it.id },
        families = listOf("LARGE", "SMALL").map { family ->
            families.first { it.family == family }.toDraft()
        },
        originalFamilyByEquipmentId = families.flatMap { family ->
            family.bars.map { bar -> bar.id to family.family }
        }.toMap(),
    )

internal fun BarbellProfileDraft.toInputOrNull(): SettingsBarbellSystemProfileInput? {
    if (exerciseIds.size > 500) return null
    if (families.map { it.family }.toSet() != setOf("LARGE", "SMALL") || families.size != 2) {
        return null
    }
    val seenEquipmentIds = mutableSetOf<String>()
    val normalizedFamilies = families.map { family ->
        family.toInputOrNull(originalFamilyByEquipmentId, seenEquipmentIds) ?: return null
    }
    return SettingsBarbellSystemProfileInput(
        exerciseIds = exerciseIds.sorted(),
        families = normalizedFamilies.sortedBy { if (it.family == "LARGE") 0 else 1 },
    )
}

internal fun nextSystemProfileKey(items: List<Int>): Int = (items.maxOrNull() ?: 0) + 1

private fun SettingsBarbellFamilyDto.toDraft(): BarbellFamilyDraft = BarbellFamilyDraft(
    family = family,
    loadingSides = loadingSides.toString(),
    bars = bars.mapIndexed { index, bar ->
        SystemBarDraft(
            key = index + 1,
            equipmentId = bar.id,
            weight = formatWeight(bar.baseLoadKg),
        )
    },
    plates = pool.plates.mapIndexed { index, plate ->
        SystemPlateDraft(
            key = index + 1,
            weight = formatWeight(plate.weightKg),
            quantity = plate.quantity?.toString().orEmpty(),
        )
    },
)

private fun BarbellFamilyDraft.toInputOrNull(
    originalFamilyByEquipmentId: Map<String, String>,
    seenEquipmentIds: MutableSet<String>,
): SettingsBarbellFamilyInput? {
    if (family !in setOf("LARGE", "SMALL")) return null
    val sides = loadingSides.trim().toIntOrNull()?.takeIf { it in 1..8 } ?: return null
    if (bars.size !in 1..50 || plates.size > 200) return null
    val seenBarWeights = mutableSetOf<Double>()
    val normalizedBars = bars.map { bar ->
        val weight = parseSingleWeight(bar.weight, maximum = 5000.0) ?: return null
        if (!seenBarWeights.add(weight)) return null
        val equipmentId = bar.equipmentId
        if (equipmentId != null) {
            if (originalFamilyByEquipmentId[equipmentId] != family) return null
            if (!seenEquipmentIds.add(equipmentId)) return null
        }
        SettingsSystemBarInput(equipmentId = equipmentId, weightKg = weight)
    }.sortedBy { it.weightKg }

    val seenPlateWeights = mutableSetOf<Double>()
    val normalizedPlates = plates.map { plate ->
        val weight = parseSingleWeight(plate.weight, maximum = 500.0) ?: return null
        if (!seenPlateWeights.add(weight)) return null
        val quantity = if (plate.quantity.isBlank()) {
            null
        } else {
            plate.quantity.trim().toIntOrNull()?.takeIf { it in 0..1000 } ?: return null
        }
        SettingsSystemPlateInput(weightKg = weight, quantity = quantity)
    }.sortedBy { it.weightKg }

    return SettingsBarbellFamilyInput(
        family = family,
        loadingSides = sides,
        bars = normalizedBars,
        plates = normalizedPlates,
    )
}

private fun parseStrictWeightList(raw: String, maximum: Double): List<Double>? {
    if (raw.isBlank()) return emptyList()
    val tokens = raw.trim().split(Regex("[;,\\s]+")).filter { it.isNotBlank() }
    if (tokens.size > 200) return null
    val weights = tokens.map { token -> parseSingleWeight(token, maximum) ?: return null }
    return weights.distinct().takeIf { it.size == weights.size }?.sorted()
}

private fun parseSingleWeight(raw: String, maximum: Double): Double? {
    val value = raw.trim().replace(',', '.').toDoubleOrNull() ?: return null
    if (!value.isFinite() || value !in 0.1..maximum) return null
    return round(value * 100.0) / 100.0
}

private fun formatWeight(value: Double): String = formatWeightList(listOf(value))
