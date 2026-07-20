package org.sharteman.gymcoach.data.model

import kotlinx.serialization.Serializable

@Serializable
enum class CoachingFieldState {
    UNKNOWN,
    KNOWN,
    NOT_APPLICABLE,
}

@Serializable
enum class CoachingHealthStatus {
    NO_SIGNIFICANT_ISSUES,
    TRAIN_WITH_LIMITATIONS,
    MEDICAL_CLEARANCE_REQUIRED,
}

@Serializable
enum class CoachingTrainingLevel {
    BEGINNER,
    INTERMEDIATE,
    ADVANCED,
}

@Serializable
enum class CoachingLimitationKind {
    PAIN,
    INJURY,
    FORBIDDEN_MOVEMENT,
    DISCOURAGED_MOVEMENT,
    FORBIDDEN_EXERCISE,
    DISCOURAGED_EXERCISE,
}

@Serializable
enum class CoachingOutsideActivityType {
    CARDIO,
    SPORT,
    PHYSICAL_WORK,
}

@Serializable
enum class CoachingActivityIntensity {
    LOW,
    MODERATE,
    HIGH,
}

@Serializable
enum class CoachingMuscleGroup {
    CHEST,
    BACK_WIDTH,
    BACK_THICKNESS,
    SHOULDERS_FRONT,
    SHOULDERS_LATERAL,
    SHOULDERS_REAR,
    BICEPS,
    TRICEPS,
    FOREARMS,
    QUADS,
    HAMSTRINGS,
    GLUTES,
    CALVES,
    ABS,
    LOWER_BACK,
    OTHER,
}

@Serializable
data class CoachingFieldDto<T>(
    val state: String = "UNKNOWN",
    val value: T? = null,
    val updatedAt: String? = null,
)

@Serializable
data class CoachingLimitationDto(
    val kind: String,
    val label: String,
    val affectedExerciseNames: List<String> = emptyList(),
    val details: String? = null,
)

@Serializable
data class CoachingLimitationsValueDto(
    val entries: List<CoachingLimitationDto> = emptyList(),
    val note: String? = null,
)

@Serializable
data class CoachingOutsideActivityDto(
    val type: String,
    val name: String,
    val sessionsPerWeek: Int? = null,
    val minutesPerWeek: Int? = null,
    val intensity: String? = null,
    val details: String? = null,
)

@Serializable
data class CoachingProfileDto(
    val version: Int = 1,
    val updatedAt: String? = null,
    val healthStatus: CoachingFieldDto<String> = CoachingFieldDto(),
    val trainingLevel: CoachingFieldDto<String> = CoachingFieldDto(),
    val availableWeekdays: CoachingFieldDto<List<Int>> = CoachingFieldDto(),
    val limitations: CoachingFieldDto<CoachingLimitationsValueDto> = CoachingFieldDto(),
    val maximumSessionDurationMin: CoachingFieldDto<Int> = CoachingFieldDto(),
    val priorityMuscles: CoachingFieldDto<List<String>> = CoachingFieldDto(),
    val priorityStrengthMovements: CoachingFieldDto<List<String>> = CoachingFieldDto(),
    val outsideActivities: CoachingFieldDto<List<CoachingOutsideActivityDto>> = CoachingFieldDto(),
    val likedExercises: CoachingFieldDto<List<String>> = CoachingFieldDto(),
    val dislikedExercises: CoachingFieldDto<List<String>> = CoachingFieldDto(),
    val averageSleepHours: CoachingFieldDto<Double> = CoachingFieldDto(),
    val baselineStress: CoachingFieldDto<Int> = CoachingFieldDto(),
    val generalRecovery: CoachingFieldDto<Int> = CoachingFieldDto(),
)

@Serializable
data class CoachingFieldInput<T>(
    val state: CoachingFieldState,
    val value: T? = null,
)

@Serializable
data class CoachingLimitationInput(
    val kind: CoachingLimitationKind,
    val label: String,
    val affectedExerciseNames: List<String>,
    val details: String? = null,
)

@Serializable
data class CoachingLimitationsValueInput(
    val entries: List<CoachingLimitationInput>,
    val note: String? = null,
)

@Serializable
data class CoachingOutsideActivityInput(
    val type: CoachingOutsideActivityType,
    val name: String,
    val sessionsPerWeek: Int? = null,
    val minutesPerWeek: Int? = null,
    val intensity: CoachingActivityIntensity? = null,
    val details: String? = null,
)

@Serializable
data class CoachingProfilePatchInput(
    val healthStatus: CoachingFieldInput<CoachingHealthStatus>? = null,
    val trainingLevel: CoachingFieldInput<CoachingTrainingLevel>? = null,
    val availableWeekdays: CoachingFieldInput<List<Int>>? = null,
    val limitations: CoachingFieldInput<CoachingLimitationsValueInput>? = null,
    val maximumSessionDurationMin: CoachingFieldInput<Int>? = null,
    val priorityMuscles: CoachingFieldInput<List<CoachingMuscleGroup>>? = null,
    val priorityStrengthMovements: CoachingFieldInput<List<String>>? = null,
    val outsideActivities: CoachingFieldInput<List<CoachingOutsideActivityInput>>? = null,
    val likedExercises: CoachingFieldInput<List<String>>? = null,
    val dislikedExercises: CoachingFieldInput<List<String>>? = null,
    val averageSleepHours: CoachingFieldInput<Double>? = null,
    val baselineStress: CoachingFieldInput<Int>? = null,
    val generalRecovery: CoachingFieldInput<Int>? = null,
)

@Serializable
data class CoachingProfilePatchRequest(
    val coachingProfile: CoachingProfilePatchInput,
)

fun emptyCoachingProfileDto(): CoachingProfileDto = CoachingProfileDto()

fun mergeCoachingProfilesByTimestamp(
    first: CoachingProfileDto?,
    second: CoachingProfileDto?,
): CoachingProfileDto? {
    if (first == null) return second
    if (second == null) return first
    return CoachingProfileDto(
        version = maxOf(first.version, second.version),
        updatedAt = newerTimestamp(first.updatedAt, second.updatedAt),
        healthStatus = newerField(first.healthStatus, second.healthStatus),
        trainingLevel = newerField(first.trainingLevel, second.trainingLevel),
        availableWeekdays = newerField(first.availableWeekdays, second.availableWeekdays),
        limitations = newerField(first.limitations, second.limitations),
        maximumSessionDurationMin = newerField(
            first.maximumSessionDurationMin,
            second.maximumSessionDurationMin,
        ),
        priorityMuscles = newerField(first.priorityMuscles, second.priorityMuscles),
        priorityStrengthMovements = newerField(
            first.priorityStrengthMovements,
            second.priorityStrengthMovements,
        ),
        outsideActivities = newerField(first.outsideActivities, second.outsideActivities),
        likedExercises = newerField(first.likedExercises, second.likedExercises),
        dislikedExercises = newerField(first.dislikedExercises, second.dislikedExercises),
        averageSleepHours = newerField(first.averageSleepHours, second.averageSleepHours),
        baselineStress = newerField(first.baselineStress, second.baselineStress),
        generalRecovery = newerField(first.generalRecovery, second.generalRecovery),
    )
}

private fun <T> newerField(first: CoachingFieldDto<T>, second: CoachingFieldDto<T>): CoachingFieldDto<T> =
    if (compareTimestamps(first.updatedAt, second.updatedAt) > 0) first else second

private fun newerTimestamp(first: String?, second: String?): String? =
    if (compareTimestamps(first, second) > 0) first else second

private fun compareTimestamps(first: String?, second: String?): Int {
    if (first == second) return 0
    if (first == null) return -1
    if (second == null) return 1
    val firstInstant = runCatching { java.time.OffsetDateTime.parse(first).toInstant() }.getOrNull()
    val secondInstant = runCatching { java.time.OffsetDateTime.parse(second).toInstant() }.getOrNull()
    return if (firstInstant != null && secondInstant != null) {
        firstInstant.compareTo(secondInstant)
    } else {
        first.compareTo(second)
    }
}
