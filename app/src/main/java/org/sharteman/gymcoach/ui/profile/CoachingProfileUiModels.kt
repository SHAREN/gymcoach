package org.sharteman.gymcoach.ui.profile

import java.util.Locale
import kotlinx.serialization.Serializable
import org.sharteman.gymcoach.data.model.CoachingActivityIntensity
import org.sharteman.gymcoach.data.model.CoachingFieldDto
import org.sharteman.gymcoach.data.model.CoachingFieldInput
import org.sharteman.gymcoach.data.model.CoachingFieldState
import org.sharteman.gymcoach.data.model.CoachingHealthStatus
import org.sharteman.gymcoach.data.model.CoachingLimitationInput
import org.sharteman.gymcoach.data.model.CoachingLimitationKind
import org.sharteman.gymcoach.data.model.CoachingLimitationsValueDto
import org.sharteman.gymcoach.data.model.CoachingLimitationsValueInput
import org.sharteman.gymcoach.data.model.CoachingMuscleGroup
import org.sharteman.gymcoach.data.model.CoachingOutsideActivityDto
import org.sharteman.gymcoach.data.model.CoachingOutsideActivityInput
import org.sharteman.gymcoach.data.model.CoachingOutsideActivityType
import org.sharteman.gymcoach.data.model.CoachingProfileDto
import org.sharteman.gymcoach.data.model.CoachingProfilePatchInput
import org.sharteman.gymcoach.data.model.CoachingTrainingLevel

enum class CoachingProfileSection {
    SAFETY,
    LIMITATIONS,
    PREFERENCES,
    RECOVERY,
}

@Serializable
data class CoachingFieldDraft<T>(
    val state: CoachingFieldState = CoachingFieldState.UNKNOWN,
    val value: T? = null,
    val omitOnSave: Boolean = false,
)

@Serializable
data class CoachingLimitationDraft(
    val kind: CoachingLimitationKind = CoachingLimitationKind.PAIN,
    val label: String = "",
    val affectedExerciseNames: List<String> = emptyList(),
    val details: String = "",
)

@Serializable
data class CoachingOutsideActivityDraft(
    val type: CoachingOutsideActivityType = CoachingOutsideActivityType.CARDIO,
    val name: String = "",
    val sessionsPerWeek: String = "",
    val minutesPerWeek: String = "",
    val intensity: CoachingActivityIntensity? = null,
    val details: String = "",
)

@Serializable
data class CoachingLimitationsDraftValue(
    val entries: List<CoachingLimitationDraft> = emptyList(),
    val note: String = "",
)

@Serializable
data class CoachingProfileDraft(
    val healthStatus: CoachingFieldDraft<CoachingHealthStatus> = CoachingFieldDraft(),
    val trainingLevel: CoachingFieldDraft<CoachingTrainingLevel> = CoachingFieldDraft(),
    val availableWeekdays: CoachingFieldDraft<Set<Int>> = CoachingFieldDraft(),
    val limitations: CoachingFieldDraft<CoachingLimitationsDraftValue> = CoachingFieldDraft(),
    val maximumSessionDurationMin: CoachingFieldDraft<String> = CoachingFieldDraft(),
    val priorityMuscles: CoachingFieldDraft<Set<CoachingMuscleGroup>> = CoachingFieldDraft(),
    val priorityStrengthMovements: CoachingFieldDraft<List<String>> = CoachingFieldDraft(),
    val outsideActivities: CoachingFieldDraft<List<CoachingOutsideActivityDraft>> = CoachingFieldDraft(),
    val likedExercises: CoachingFieldDraft<List<String>> = CoachingFieldDraft(),
    val dislikedExercises: CoachingFieldDraft<List<String>> = CoachingFieldDraft(),
    val averageSleepHours: CoachingFieldDraft<String> = CoachingFieldDraft(),
    val baselineStress: CoachingFieldDraft<Int> = CoachingFieldDraft(),
    val generalRecovery: CoachingFieldDraft<Int> = CoachingFieldDraft(),
)

data class CoachingSectionPatch(
    val patch: CoachingProfilePatchInput?,
    val invalidFields: Set<String> = emptySet(),
) {
    val isValid: Boolean get() = patch != null && invalidFields.isEmpty()
}

fun CoachingProfileDto.toDraft(): CoachingProfileDraft = CoachingProfileDraft(
    healthStatus = enumDraft(healthStatus, allowNotApplicable = false),
    trainingLevel = enumDraft(trainingLevel, allowNotApplicable = false),
    availableWeekdays = draftField(availableWeekdays, allowNotApplicable = false) { values ->
        values.takeIf {
            it.isNotEmpty() && it.size <= 7 && it.toSet().size == it.size &&
                it.all { day -> day in 1..7 }
        }
            ?.toSortedSet()
    },
    limitations = draftField(limitations, allowNotApplicable = true) { value ->
        value.toDraftOrNull()
    },
    maximumSessionDurationMin = draftField(
        maximumSessionDurationMin,
        allowNotApplicable = false,
    ) { value -> value.takeIf { it in 20..240 }?.toString() },
    priorityMuscles = draftField(priorityMuscles, allowNotApplicable = true) { values ->
        values.mapNotNullTo(linkedSetOf()) { value -> enumValueOrNull<CoachingMuscleGroup>(value) }
            .takeIf { it.size == values.size && it.size in 1..15 }
    },
    priorityStrengthMovements = draftStringList(priorityStrengthMovements, maxItems = 20),
    outsideActivities = draftField(outsideActivities, allowNotApplicable = true) { values ->
        values.map { it.toDraftOrNull() }.takeIf { drafts ->
            drafts.size in 1..20 && drafts.none { it == null }
        }?.filterNotNull()
    },
    likedExercises = draftStringList(likedExercises, maxItems = 50),
    dislikedExercises = draftStringList(dislikedExercises, maxItems = 50),
    averageSleepHours = draftField(averageSleepHours, allowNotApplicable = true) { value ->
        value.takeIf { it.isFinite() && it in 0.0..24.0 }?.toString()
    },
    baselineStress = draftField(baselineStress, allowNotApplicable = true) { it.takeIf { value -> value in 1..5 } },
    generalRecovery = draftField(generalRecovery, allowNotApplicable = true) { it.takeIf { value -> value in 1..5 } },
)

fun CoachingProfileDraft.sectionPatch(section: CoachingProfileSection): CoachingSectionPatch = when (section) {
    CoachingProfileSection.SAFETY -> safetyPatch()
    CoachingProfileSection.LIMITATIONS -> limitationsPatch()
    CoachingProfileSection.PREFERENCES -> preferencesPatch()
    CoachingProfileSection.RECOVERY -> recoveryPatch()
}

private fun CoachingProfileDraft.safetyPatch(): CoachingSectionPatch {
    val invalid = linkedSetOf<String>()
    val health = healthStatus.enumInput("healthStatus", false, invalid)
    val level = trainingLevel.enumInput("trainingLevel", false, invalid)
    val weekdays = availableWeekdays.input("availableWeekdays", false, invalid) { values ->
        values?.takeIf { it.isNotEmpty() && it.size <= 7 && it.all { day -> day in 1..7 } }
            ?.sorted()
    }
    val duration = maximumSessionDurationMin.input(
        "maximumSessionDurationMin",
        false,
        invalid,
    ) { value -> value?.trim()?.toIntOrNull()?.takeIf { it in 20..240 } }
    return CoachingSectionPatch(
        patch = CoachingProfilePatchInput(
            healthStatus = health,
            trainingLevel = level,
            availableWeekdays = weekdays,
            maximumSessionDurationMin = duration,
        ).takeIf { invalid.isEmpty() && it.hasFields() },
        invalidFields = invalid,
    )
}

private fun CoachingProfileDraft.limitationsPatch(): CoachingSectionPatch {
    val invalid = linkedSetOf<String>()
    val value = limitations.input("limitations", true, invalid) { draft ->
        val current = draft ?: return@input null
        if (current.entries.size !in 1..20 || current.note.trim().length > 1000) return@input null
        val entries = current.entries.mapIndexed { index, entry ->
            val names = normalizeUniqueList(entry.affectedExerciseNames, 30, 120)
            val label = entry.label.trim()
            val details = entry.details.trim()
            if (label.isEmpty() || label.length > 120 || names == null || details.length > 500) {
                invalid += "limitations.$index"
                null
            } else {
                CoachingLimitationInput(
                    kind = entry.kind,
                    label = label,
                    affectedExerciseNames = names,
                    details = details.ifBlank { null },
                )
            }
        }
        if (entries.any { it == null }) null else CoachingLimitationsValueInput(
            entries = entries.filterNotNull(),
            note = current.note.trim().ifBlank { null },
        )
    }
    return CoachingSectionPatch(
        patch = CoachingProfilePatchInput(limitations = value)
            .takeIf { invalid.isEmpty() && it.hasFields() },
        invalidFields = invalid,
    )
}

private fun CoachingProfileDraft.preferencesPatch(): CoachingSectionPatch {
    val invalid = linkedSetOf<String>()
    val muscles = priorityMuscles.input("priorityMuscles", true, invalid) { values ->
        values?.takeIf { it.size in 1..15 }?.toList()
    }
    val movements = priorityStrengthMovements.stringListInput(
        "priorityStrengthMovements",
        20,
        invalid,
    )
    val liked = likedExercises.stringListInput("likedExercises", 50, invalid)
    val disliked = dislikedExercises.stringListInput("dislikedExercises", 50, invalid)
    val activities = outsideActivities.input("outsideActivities", true, invalid) { values ->
        val current = values ?: return@input null
        if (current.size !in 1..20) return@input null
        val parsed = current.mapIndexed { index, activity ->
            val name = activity.name.trim()
            val sessions = optionalInt(activity.sessionsPerWeek, 0..14)
            val minutes = optionalInt(activity.minutesPerWeek, 0..3000)
            val details = activity.details.trim()
            if (
                name.isEmpty() || name.length > 120 || sessions == Int.MIN_VALUE ||
                minutes == Int.MIN_VALUE || details.length > 500
            ) {
                invalid += "outsideActivities.$index"
                null
            } else {
                CoachingOutsideActivityInput(
                    type = activity.type,
                    name = name,
                    sessionsPerWeek = sessions.takeUnless { it == OPTIONAL_INT_EMPTY },
                    minutesPerWeek = minutes.takeUnless { it == OPTIONAL_INT_EMPTY },
                    intensity = activity.intensity,
                    details = details.ifBlank { null },
                )
            }
        }
        if (parsed.any { it == null }) null else parsed.filterNotNull()
    }
    return CoachingSectionPatch(
        patch = CoachingProfilePatchInput(
            priorityMuscles = muscles,
            priorityStrengthMovements = movements,
            outsideActivities = activities,
            likedExercises = liked,
            dislikedExercises = disliked,
        ).takeIf { invalid.isEmpty() && it.hasFields() },
        invalidFields = invalid,
    )
}

private fun CoachingProfileDraft.recoveryPatch(): CoachingSectionPatch {
    val invalid = linkedSetOf<String>()
    val sleep = averageSleepHours.input("averageSleepHours", true, invalid) { value ->
        value?.trim()?.replace(',', '.')?.toDoubleOrNull()
            ?.takeIf { it.isFinite() && it in 0.0..24.0 }
    }
    val stress = baselineStress.input("baselineStress", true, invalid) { it?.takeIf { value -> value in 1..5 } }
    val recovery = generalRecovery.input("generalRecovery", true, invalid) { it?.takeIf { value -> value in 1..5 } }
    return CoachingSectionPatch(
        patch = CoachingProfilePatchInput(
            averageSleepHours = sleep,
            baselineStress = stress,
            generalRecovery = recovery,
        ).takeIf { invalid.isEmpty() && it.hasFields() },
        invalidFields = invalid,
    )
}

private inline fun <reified E : Enum<E>> enumDraft(
    field: CoachingFieldDto<String>,
    allowNotApplicable: Boolean,
): CoachingFieldDraft<E> = draftField(field, allowNotApplicable) { enumValueOrNull<E>(it) }

private inline fun <reified E : Enum<E>> CoachingFieldDraft<E>.enumInput(
    name: String,
    allowNotApplicable: Boolean,
    invalid: MutableSet<String>,
): CoachingFieldInput<E>? = input(name, allowNotApplicable, invalid) { it }

private fun draftStringList(
    field: CoachingFieldDto<List<String>>,
    maxItems: Int,
): CoachingFieldDraft<List<String>> =
    draftField(field, allowNotApplicable = true) { values ->
        normalizeUniqueList(values, maxItems, 120).takeIf { it == values }
    }

private fun CoachingFieldDraft<List<String>>.stringListInput(
    name: String,
    maxItems: Int,
    invalid: MutableSet<String>,
): CoachingFieldInput<List<String>>? = input(name, true, invalid) { value ->
    value?.let { normalizeUniqueList(it, maxItems, 120) }
}

private fun <T, R> draftField(
    field: CoachingFieldDto<T>,
    allowNotApplicable: Boolean,
    convert: (T) -> R?,
): CoachingFieldDraft<R> {
    val state = enumValueOrNull<CoachingFieldState>(field.state)
        ?: return CoachingFieldDraft(omitOnSave = true)
    if (state == CoachingFieldState.NOT_APPLICABLE && !allowNotApplicable) {
        return CoachingFieldDraft(omitOnSave = true)
    }
    if (state != CoachingFieldState.KNOWN) return CoachingFieldDraft(state, null)
    val value = field.value?.let(convert) ?: return CoachingFieldDraft(omitOnSave = true)
    return CoachingFieldDraft(CoachingFieldState.KNOWN, value)
}

private fun <T, R> CoachingFieldDraft<T>.input(
    name: String,
    allowNotApplicable: Boolean,
    invalid: MutableSet<String>,
    convert: (T?) -> R?,
): CoachingFieldInput<R>? {
    if (omitOnSave) return null
    if (state == CoachingFieldState.NOT_APPLICABLE && !allowNotApplicable) {
        invalid += name
        return null
    }
    if (state != CoachingFieldState.KNOWN) return CoachingFieldInput(state, null)
    val converted = convert(value)
    if (converted == null) {
        invalid += name
        return null
    }
    return CoachingFieldInput(CoachingFieldState.KNOWN, converted)
}

private fun CoachingLimitationsValueDto.toDraftOrNull(): CoachingLimitationsDraftValue? {
    if (entries.size !in 1..20 || note.orEmpty().length > 1000) return null
    val drafts = entries.map { entry ->
        val kind = enumValueOrNull<CoachingLimitationKind>(entry.kind) ?: return null
        val affectedExerciseNames = normalizeUniqueList(entry.affectedExerciseNames, 30, 120)
            ?.takeIf { it == entry.affectedExerciseNames }
            ?: return null
        if (
            entry.label.isBlank() || entry.label.length > 120 || entry.details.orEmpty().length > 500
        ) return null
        CoachingLimitationDraft(
            kind = kind,
            label = entry.label,
            affectedExerciseNames = affectedExerciseNames,
            details = entry.details.orEmpty(),
        )
    }
    return CoachingLimitationsDraftValue(drafts, note.orEmpty())
}

private fun CoachingOutsideActivityDto.toDraftOrNull(): CoachingOutsideActivityDraft? {
    val type = enumValueOrNull<CoachingOutsideActivityType>(type) ?: return null
    val parsedIntensity = intensity?.let { enumValueOrNull<CoachingActivityIntensity>(it) }
    if (
        name.isBlank() || name.length > 120 || sessionsPerWeek?.let { it !in 0..14 } == true ||
        minutesPerWeek?.let { it !in 0..3000 } == true ||
        (intensity != null && parsedIntensity == null) || details.orEmpty().length > 500
    ) return null
    return CoachingOutsideActivityDraft(
        type = type,
        name = name,
        sessionsPerWeek = sessionsPerWeek?.toString().orEmpty(),
        minutesPerWeek = minutesPerWeek?.toString().orEmpty(),
        intensity = parsedIntensity,
        details = details.orEmpty(),
    )
}

fun normalizeUniqueList(values: List<String>, maxItems: Int, maxLength: Int): List<String>? {
    if (values.size !in 1..maxItems) return null
    val trimmed = values.map(String::trim)
    if (trimmed.any { it.isEmpty() || it.length > maxLength }) return null
    val seen = linkedSetOf<String>()
    val result = trimmed
        .filter { seen.add(it.lowercase(Locale.ROOT)) }
    return result.takeIf { it.isNotEmpty() }
}

private fun optionalInt(value: String, range: IntRange): Int {
    if (value.isBlank()) return OPTIONAL_INT_EMPTY
    return value.trim().toIntOrNull()?.takeIf { it in range } ?: Int.MIN_VALUE
}

private inline fun <reified E : Enum<E>> enumValueOrNull(value: String): E? =
    enumValues<E>().firstOrNull { it.name == value }

private const val OPTIONAL_INT_EMPTY = Int.MAX_VALUE

private fun CoachingProfilePatchInput.hasFields(): Boolean =
    healthStatus != null || trainingLevel != null || availableWeekdays != null ||
        limitations != null || maximumSessionDurationMin != null || priorityMuscles != null ||
        priorityStrengthMovements != null || outsideActivities != null || likedExercises != null ||
        dislikedExercises != null || averageSleepHours != null || baselineStress != null ||
        generalRecovery != null
