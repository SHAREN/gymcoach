package org.sharteman.gymcoach.ui

import java.util.Locale
import org.sharteman.gymcoach.data.local.LocalSetEntity
import org.sharteman.gymcoach.training.SetRecommendation
import org.sharteman.gymcoach.training.fromDisplayWeight
import org.sharteman.gymcoach.training.roundWeight
import org.sharteman.gymcoach.training.toDisplayWeight

internal data class EditableSetDraft(
    val weightText: String,
    val repsText: String,
    val rirText: String,
)

internal data class ParsedSet(
    val weight: Double,
    val reps: Int,
    val rir: Int?,
)

internal fun draftFromSet(set: LocalSetEntity, unit: String): EditableSetDraft = EditableSetDraft(
    weightText = formatDraftWeight(set.weight, unit),
    repsText = set.reps.toString(),
    rirText = set.rir?.toString().orEmpty(),
)

internal fun recommendationDraft(
    recommendation: SetRecommendation,
    unit: String,
): EditableSetDraft = EditableSetDraft(
    weightText = formatDraftWeight(recommendation.weight, unit),
    repsText = recommendation.reps.toString(),
    rirText = recommendation.rir.toString(),
)

internal fun EditableSetDraft.parse(unit: String): ParsedSet? {
    val displayWeight = weightText.replace(',', '.').toDoubleOrNull() ?: return null
    val weight = roundWeight(fromDisplayWeight(displayWeight, unit), 2)
    val reps = repsText.toIntOrNull() ?: return null
    val rir = if (rirText.isBlank()) null else rirText.toIntOrNull() ?: return null
    if (!weight.isFinite() || weight !in 0.0..500.0) return null
    if (reps !in 1..100) return null
    if (rir != null && rir !in 0..5) return null
    return ParsedSet(weight = weight, reps = reps, rir = rir)
}

internal fun recommendationKey(recommendation: SetRecommendation?): String? = recommendation?.let {
    "${it.weight}:${it.reps}:${it.rir}"
}

internal fun recommendationCanApply(appliedKey: String?, currentKey: String?): Boolean =
    currentKey != null && appliedKey != currentKey

private fun formatDraftWeight(weightKg: Double, unit: String): String {
    val displayWeight = roundWeight(toDisplayWeight(weightKg, unit), 2)
    return if (displayWeight % 1.0 == 0.0) {
        displayWeight.toInt().toString()
    } else {
        String.format(Locale.ROOT, "%.2f", displayWeight).trimEnd('0').trimEnd('.')
    }
}
