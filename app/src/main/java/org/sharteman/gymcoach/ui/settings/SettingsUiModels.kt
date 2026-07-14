package org.sharteman.gymcoach.ui.settings

import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.util.Locale
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import org.sharteman.gymcoach.data.settings.SettingsGymDto
import org.sharteman.gymcoach.data.settings.SettingsGymEquipmentDto
import org.sharteman.gymcoach.data.settings.SettingsGymEquipmentInput
import org.sharteman.gymcoach.data.settings.SettingsGymExerciseConfigDto
import org.sharteman.gymcoach.data.settings.SettingsGymInput
import org.sharteman.gymcoach.data.settings.SettingsProfileInput

data class ProfileDraft(
    val displayName: String = "",
    val bodyweight: String = "",
    val sex: String? = null,
    val heightCm: String = "",
    val goal: String? = null,
    val weeklyFrequency: String = "",
    val unit: String = "KG",
)

fun ProfileDraft.toInputOrNull(): SettingsProfileInput? {
    val bodyweightValue = bodyweight.toNullableDouble() ?: if (bodyweight.isBlank()) null else return null
    val heightValue = heightCm.toNullableInt() ?: if (heightCm.isBlank()) null else return null
    val frequencyValue = weeklyFrequency.toNullableInt()
        ?: if (weeklyFrequency.isBlank()) null else return null
    if (bodyweightValue != null && bodyweightValue !in 20.0..300.0) return null
    if (heightValue != null && heightValue !in 100..250) return null
    if (frequencyValue != null && frequencyValue !in 1..14) return null
    return SettingsProfileInput(
        displayName = displayName.trim().ifBlank { null },
        bodyweight = bodyweightValue,
        sex = sex,
        heightCm = heightValue,
        goal = goal,
        weeklyFrequency = frequencyValue,
        unit = unit,
    )
}

data class GymDraft(
    val id: String? = null,
    val name: String = "",
    val dumbbellWeights: String = "",
    val plateWeights: String = "",
    val barWeights: String = "",
    val configs: Map<String, SettingsGymExerciseConfigDto> = emptyMap(),
)

fun SettingsGymDto.toDraft(): GymDraft = GymDraft(
    id = id,
    name = name,
    dumbbellWeights = formatWeightList(dumbbellWeights),
    plateWeights = formatWeightList(plateWeights),
    barWeights = formatWeightList(barWeights),
    configs = exerciseConfigs.associateBy { it.exerciseId },
)

fun GymDraft.toInputOrNull(makeActive: Boolean = false): SettingsGymInput? {
    if (name.isBlank()) return null
    val dumbbells = parseWeightList(dumbbellWeights) ?: return null
    val plates = parseWeightList(plateWeights) ?: return null
    val bars = parseWeightList(barWeights) ?: return null
    return SettingsGymInput(
        name = name.trim(),
        dumbbellWeights = dumbbells,
        plateWeights = plates,
        barWeights = bars,
        exerciseConfigs = configs.values.sortedBy { it.exerciseId },
        makeActive = makeActive,
    )
}

val gymEquipmentTypes = listOf(
    "DUMBBELL",
    "BARBELL",
    "MACHINE",
    "CABLE",
    "BODYWEIGHT",
    "CARDIO",
    "OTHER",
)

data class GymEquipmentDraft(
    val id: String? = null,
    val name: String = "",
    val equipmentType: String = "OTHER",
    val description: String = "",
    val manufacturer: String = "",
    val modelName: String = "",
    val quantity: String = "1",
    val weightOptions: String = "",
    val exerciseIds: Set<String> = emptySet(),
    val imageUrl: String = "",
    val currentImageKind: String? = null,
)

fun SettingsGymEquipmentDto.toDraft(): GymEquipmentDraft = GymEquipmentDraft(
    id = id,
    name = name,
    equipmentType = equipmentType,
    description = description.orEmpty(),
    manufacturer = manufacturer.orEmpty(),
    modelName = modelName.orEmpty(),
    quantity = quantity.toString(),
    weightOptions = formatWeightList(weightOptions),
    exerciseIds = exerciseLinks.mapTo(linkedSetOf()) { it.id },
    imageUrl = imageUrl.orEmpty(),
    currentImageKind = image?.kind,
)

fun GymEquipmentDraft.toInputOrNull(): SettingsGymEquipmentInput? {
    if (name.isBlank() || name.trim().length > 120) return null
    if (equipmentType !in gymEquipmentTypes) return null
    if (description.length > 4000 || manufacturer.length > 120 || modelName.length > 120) return null
    val quantityValue = quantity.trim().toIntOrNull()?.takeIf { it in 1..100 } ?: return null
    val weights = parseWeightList(weightOptions) ?: return null
    if (exerciseIds.size > 100) return null
    return SettingsGymEquipmentInput(
        name = name.trim(),
        equipmentType = equipmentType,
        description = description.trim().ifBlank { null },
        manufacturer = manufacturer.trim().ifBlank { null },
        modelName = modelName.trim().ifBlank { null },
        quantity = quantityValue,
        weightOptions = weights,
        exerciseIds = exerciseIds.sorted(),
    )
}

fun validEquipmentImageUrl(value: String): String? {
    val trimmed = value.trim()
    if (trimmed.length !in 1..2048) return null
    return trimmed.takeIf {
        runCatching {
            val uri = java.net.URI(it)
            uri.scheme.equals("https", ignoreCase = true) && !uri.host.isNullOrBlank()
        }.getOrDefault(false)
    }
}

fun parseWeightList(value: String): List<Double>? {
    if (value.isBlank()) return emptyList()
    val values = value.trim()
        .split(Regex("[;,\\s]+"))
        .filter { it.isNotBlank() }
        .map { token -> token.replace(',', '.').toDoubleOrNull() ?: return null }
    if (values.size > 200 || values.any { !it.isFinite() || it !in 0.1..5000.0 }) return null
    return values.map { kotlin.math.round(it * 100.0) / 100.0 }.distinct().sorted()
}

fun formatWeightList(values: List<Double>): String {
    val format = DecimalFormat("0.##", DecimalFormatSymbols(Locale.US))
    return values.joinToString(", ") { format.format(it) }
}

data class ImportResultSummary(
    val sessions: Int? = null,
    val sets: Int? = null,
    val exercises: Int? = null,
    val sport: String? = null,
)

fun importResultSummary(response: JsonObject): ImportResultSummary {
    val sessions = response["createdSessions"]?.jsonPrimitive?.intOrNull
        ?: response["sessions"]?.jsonPrimitive?.intOrNull
    val sets = response["createdSets"]?.jsonPrimitive?.intOrNull
        ?: response["sets"]?.jsonPrimitive?.intOrNull
    val exercises = response["createdExercises"]?.jsonPrimitive?.intOrNull
        ?: response["newExercises"]?.let { element ->
            runCatching { element.jsonArray.size }.getOrNull()
        }
    val sport = response["sport"]?.jsonPrimitive?.contentOrNull
    return ImportResultSummary(sessions, sets, exercises, sport)
}

private fun String.toNullableDouble(): Double? = trim().replace(',', '.').toDoubleOrNull()
private fun String.toNullableInt(): Int? = trim().toIntOrNull()
