package org.sharteman.gymcoach.data.coach

import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json

private val adjustmentBlock = Regex(
    pattern = "<adjustments>([\\s\\S]*?)</adjustments>",
    option = RegexOption.IGNORE_CASE,
)

private val coachJson = Json { ignoreUnknownKeys = true }

fun parseCoachResponse(response: String): CoachResponseContent {
    val match = adjustmentBlock.find(response)
        ?: return CoachResponseContent(markdown = response.trim(), adjustments = emptyList())
    val cleaned = response.replace(adjustmentBlock, "").trim()
    val raw = match.groupValues.getOrNull(1)?.trim().orEmpty()
    if (raw.isEmpty()) {
        return CoachResponseContent(cleaned, emptyList(), "Empty adjustments block")
    }
    return runCatching { coachJson.decodeFromString<List<CoachAdjustment>>(raw) }
        .fold(
            onSuccess = { adjustments ->
                val invalid = adjustments.firstOrNull { !it.isValid() }
                if (invalid == null) CoachResponseContent(cleaned, adjustments)
                else CoachResponseContent(
                    cleaned,
                    emptyList(),
                    "Invalid adjustment for ${invalid.exerciseName}",
                )
            },
            onFailure = { CoachResponseContent(cleaned, emptyList(), it.message) },
        )
}

fun CoachAdjustment.withDefaults(defaults: ProgramExerciseDefaultsDto?): CoachAdjustment = copy(
    suggestedRepsMin = suggestedRepsMin ?: defaults?.targetRepsMin,
    suggestedRepsMax = suggestedRepsMax ?: defaults?.targetRepsMax,
    suggestedSets = suggestedSets ?: defaults?.targetSets,
    suggestedRIR = suggestedRIR ?: defaults?.targetRIR,
    suggestedRestSec = suggestedRestSec ?: defaults?.restSec,
)

fun firstCoachLine(response: String): String = parseCoachResponse(response).markdown
    .lineSequence()
    .map { it.replace(Regex("^[#>*-]+\\s*"), "").trim() }
    .firstOrNull { it.isNotEmpty() }
    ?: response.take(120)

private fun CoachAdjustment.isValid(): Boolean =
    exerciseName.trim().isNotEmpty() && exerciseName.length <= 120 &&
        summary.trim().isNotEmpty() && summary.length <= 300 &&
        (rationale?.length ?: 0) <= 800 &&
        suggestedRepsMin.inRangeOrNull(1, 50) &&
        suggestedRepsMax.inRangeOrNull(1, 50) &&
        suggestedSets.inRangeOrNull(1, 20) &&
        suggestedRIR.inRangeOrNull(0, 5) &&
        suggestedRestSec.inRangeOrNull(15, 600) &&
        currentLoad.inRangeOrNull(0.0, 1000.0) &&
        suggestedLoad.inRangeOrNull(0.0, 1000.0) &&
        (note?.length ?: 0) <= 500

private fun Int?.inRangeOrNull(min: Int, max: Int) = this == null || this in min..max
private fun Double?.inRangeOrNull(min: Double, max: Double) = this == null || this in min..max
