package org.sharteman.gymcoach.data.model

import kotlinx.serialization.Serializable

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
