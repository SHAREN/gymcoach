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

internal data class DisplayWorkoutSet(
    val set: LocalSetEntity,
    val workingNumber: Int?,
)

internal data class UpcomingWorkoutSet(
    val rowNumber: Int,
    val performanceIndex: Int,
    val isDropSet: Boolean,
)

internal fun displayedWorkoutSets(sets: List<LocalSetEntity>): List<DisplayWorkoutSet> {
    var workingNumber = 0
    return sets
        .filterNot { it.deleted }
        .sortedWith(
            compareBy<LocalSetEntity> { it.completedAt }
                .thenBy { it.setNumber }
                .thenBy { it.id },
        )
        .map { set ->
            DisplayWorkoutSet(
                set = set,
                workingNumber = if (set.isWarmup || set.isDropSet) {
                    null
                } else {
                    ++workingNumber
                },
            )
        }
}

internal fun upcomingWorkoutSets(
    displayedSets: List<DisplayWorkoutSet>,
    targetWorkingSets: Int,
    targetDropSets: Int,
    activeIsWarmup: Boolean,
    activeIsDropSet: Boolean,
): List<UpcomingWorkoutSet> {
    val completedWorkingSets = displayedSets.count { it.workingNumber != null }
    val completedDropSets = displayedSets.count { it.set.isDropSet }
    val activeWorkingSets = if (!activeIsWarmup && !activeIsDropSet) 1 else 0
    val activeDropSets = if (activeIsDropSet) 1 else 0
    val remainingWorkingSets = (targetWorkingSets - completedWorkingSets - activeWorkingSets).coerceAtLeast(0)
    val remainingDropSets = (targetDropSets - completedDropSets - activeDropSets).coerceAtLeast(0)
    val upcomingWorkingSets = List(remainingWorkingSets) { offset ->
        val workingNumber = completedWorkingSets + activeWorkingSets + offset + 1
        UpcomingWorkoutSet(
            rowNumber = workingNumber,
            performanceIndex = workingNumber - 1,
            isDropSet = false,
        )
    }
    val upcomingDropSets = List(remainingDropSets) { offset ->
        val dropNumber = completedDropSets + activeDropSets + offset + 1
        val performanceIndex = targetWorkingSets + dropNumber - 1
        UpcomingWorkoutSet(
            rowNumber = performanceIndex + 1,
            performanceIndex = performanceIndex,
            isDropSet = true,
        )
    }
    return upcomingWorkingSets + upcomingDropSets
}

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
