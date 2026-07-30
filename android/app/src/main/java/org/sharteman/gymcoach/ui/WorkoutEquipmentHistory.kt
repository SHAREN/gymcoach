package org.sharteman.gymcoach.ui

import org.sharteman.gymcoach.data.local.LocalSetEntity
import org.sharteman.gymcoach.data.model.EquipmentReturnRecommendationDto
import org.sharteman.gymcoach.data.model.ExerciseHistorySessionDto
import org.sharteman.gymcoach.data.model.GymDto
import org.sharteman.gymcoach.data.model.LastPerformanceDto
import org.sharteman.gymcoach.data.model.PerformanceSetDto
import org.sharteman.gymcoach.data.model.ProgramExerciseDto
import org.sharteman.gymcoach.data.model.ReturnRecommendationDto
import org.sharteman.gymcoach.training.resolveExerciseInventory
import org.sharteman.gymcoach.training.selectedEquipment
import java.time.Instant

internal fun sameEquipmentIdentity(
    firstGymId: String?,
    firstEquipmentId: String?,
    secondGymId: String?,
    secondEquipmentId: String?,
): Boolean = firstGymId == secondGymId && firstEquipmentId == secondEquipmentId

internal fun selectLastPerformanceForEquipment(
    performances: List<LastPerformanceDto>?,
    fallback: LastPerformanceDto?,
    gymId: String?,
    gymEquipmentId: String?,
): LastPerformanceDto? = performances
    ?.firstOrNull { performance ->
        sameEquipmentIdentity(performance.gymId, performance.gymEquipmentId, gymId, gymEquipmentId)
    }
    ?: fallback?.takeIf { performance ->
        sameEquipmentIdentity(performance.gymId, performance.gymEquipmentId, gymId, gymEquipmentId)
    }

internal enum class PreviousPerformanceComparability {
    EXACT_EQUIPMENT,
    EQUIPMENT_NOT_RECORDED,
    DIFFERENT_EQUIPMENT,
}

internal data class PreviousPerformanceSelection(
    val performance: LastPerformanceDto,
    val comparability: PreviousPerformanceComparability,
    val equipmentNames: List<String>,
)

/**
 * Selects display-only exercise history. The selected equipment is deliberately
 * not part of candidate selection; it is used only to describe comparability.
 * Equipment-aware recommendations continue to use selectLastPerformanceForEquipment.
 */
internal fun selectPreviousExercisePerformance(
    exerciseId: String,
    historyByExerciseId: Map<String, List<ExerciseHistorySessionDto>>,
    fallback: LastPerformanceDto?,
    currentSessionId: String,
    gymId: String?,
    gymEquipmentId: String?,
): PreviousPerformanceSelection? {
    val historyCandidates = historyByExerciseId[exerciseId]
        .orEmpty()
        .asSequence()
        .filter { it.sessionId != currentSessionId && it.sets.isNotEmpty() }
        .distinctBy { it.sessionId }
        .map { session ->
            val sets = session.sets.map { set ->
                PerformanceSetDto(
                    weight = set.weight,
                    reps = set.reps,
                    rir = set.rir,
                    isDropSet = set.isDropSet,
                    gymEquipmentId = set.gymEquipmentId,
                )
            }
            val maxWeight = sets.maxOf { it.weight }
            PreviousPerformanceCandidate(
                performance = LastPerformanceDto(
                    exerciseId = exerciseId,
                    sessionId = session.sessionId,
                    sessionStartedAt = session.startedAt,
                    gymId = session.gymId,
                    gymEquipmentId = sets.mapNotNull { it.gymEquipmentId }.distinct()
                        .singleOrNull(),
                    equipmentName = session.sets.mapNotNull { it.equipmentName?.trim() }
                        .filter { it.isNotEmpty() }
                        .distinct()
                        .singleOrNull(),
                    sets = sets,
                    maxWeight = maxWeight,
                    repsAtMaxWeight = sets.filter { it.weight == maxWeight }.maxOf { it.reps },
                ),
                equipmentNames = session.sets.mapNotNull { it.equipmentName?.trim() }
                    .filter { it.isNotEmpty() }
                    .distinct(),
                sourcePriority = 1,
            )
        }
        .toList()

    val fallbackCandidate = fallback
        ?.takeIf {
            it.exerciseId == exerciseId &&
                it.sessionId != currentSessionId &&
                it.sets.isNotEmpty()
        }
        ?.let { performance ->
            PreviousPerformanceCandidate(
                performance = performance.copy(
                    sets = performance.sets.map { set ->
                        if (set.gymEquipmentId != null || performance.gymEquipmentId == null) {
                            set
                        } else {
                            set.copy(gymEquipmentId = performance.gymEquipmentId)
                        }
                    },
                ),
                equipmentNames = listOfNotNull(performance.equipmentName?.trim())
                    .filter { it.isNotEmpty() },
                sourcePriority = 0,
            )
        }
    val selected = (historyCandidates + listOfNotNull(fallbackCandidate))
        .maxWithOrNull(
            compareBy<PreviousPerformanceCandidate>(
                { performanceTimestamp(it.performance.sessionStartedAt) },
                { it.sourcePriority },
            ),
        )
        ?: return null

    val recordedEquipmentIds = selected.performance.sets
        .mapNotNull { it.gymEquipmentId }
        .distinct()
    val hasUnrecordedEquipment = selected.performance.sets.any { it.gymEquipmentId == null }
    val comparability = when {
        recordedEquipmentIds.isEmpty() || hasUnrecordedEquipment ->
            PreviousPerformanceComparability.EQUIPMENT_NOT_RECORDED
        selected.performance.gymId != gymId ||
            gymEquipmentId == null ||
            recordedEquipmentIds.any { it != gymEquipmentId } ->
            PreviousPerformanceComparability.DIFFERENT_EQUIPMENT
        else -> PreviousPerformanceComparability.EXACT_EQUIPMENT
    }
    return PreviousPerformanceSelection(
        performance = selected.performance,
        comparability = comparability,
        equipmentNames = selected.equipmentNames,
    )
}

private data class PreviousPerformanceCandidate(
    val performance: LastPerformanceDto,
    val equipmentNames: List<String>,
    val sourcePriority: Int,
)

private fun performanceTimestamp(value: String): Long =
    runCatching { Instant.parse(value).toEpochMilli() }.getOrDefault(Long.MIN_VALUE)

internal fun selectReturnRecommendationForEquipment(
    recommendations: List<EquipmentReturnRecommendationDto>?,
    fallback: ReturnRecommendationDto?,
    fallbackPerformance: LastPerformanceDto?,
    fallbackGymId: String?,
    gymId: String?,
    gymEquipmentId: String?,
): ReturnRecommendationDto? = recommendations
    ?.firstOrNull { item ->
        sameEquipmentIdentity(item.gymId, item.gymEquipmentId, gymId, gymEquipmentId)
    }
    ?.recommendation
    ?: fallback?.takeIf {
        fallbackGymId == gymId && (
            fallbackPerformance == null || sameEquipmentIdentity(
                fallbackPerformance.gymId,
                fallbackPerformance.gymEquipmentId,
                gymId,
                gymEquipmentId,
            )
        )
    }

internal data class ReturnCalibrationEvidence(
    val calibrationKind: String,
    val movementConfidence: String,
    val equipmentConfidence: String,
    val movementSessionCount: Int,
    val equipmentWorkingSetCount: Int,
    val historyBasis: String,
    val recentHistorySessionCount: Int,
    val longTermHistorySessionCount: Int,
    val nonComparableHistorySessionCount: Int,
    val returnGapDays: Int?,
    val followsPriorGap: Boolean,
)

internal fun returnCalibrationEvidence(
    recommendation: ReturnRecommendationDto?,
): ReturnCalibrationEvidence? = recommendation
    ?.takeIf { it.calibrationRequired }
    ?.let {
        ReturnCalibrationEvidence(
            calibrationKind = it.calibrationKind,
            movementConfidence = it.strengthSummary.movement.confidence,
            equipmentConfidence = it.strengthSummary.equipment.confidence,
            movementSessionCount = it.strengthSummary.movement.sessionCount,
            equipmentWorkingSetCount = it.strengthSummary.equipment.calibrationSetCount,
            historyBasis = it.historyBasis,
            recentHistorySessionCount = it.recentHistorySessionCount,
            longTermHistorySessionCount = it.longTermHistorySessionCount,
            nonComparableHistorySessionCount = it.nonComparableHistorySessionCount,
            returnGapDays = it.returnGapDays,
            followsPriorGap = it.returnGapDays != null &&
                it.exerciseGapDays != null &&
                it.returnGapDays > it.exerciseGapDays,
        )
    }

internal fun resolveEquipmentCalibrationProgress(
    exercise: ProgramExerciseDto,
    recommendation: ReturnRecommendationDto?,
    sets: List<LocalSetEntity>,
    gymEquipmentId: String?,
): ReturnRecommendationDto? {
    if (
        recommendation == null ||
        recommendation.calibrationKind != "equipment" ||
        !recommendation.calibrationRequired ||
        gymEquipmentId == null
    ) {
        return recommendation
    }
    val currentValidSets = sets.count { set ->
        set.exerciseId == exercise.exerciseId &&
            set.gymEquipmentId == gymEquipmentId &&
            !set.deleted &&
            !set.isWarmup &&
            !set.isDropSet &&
            set.reps > 0 &&
            set.weight >= 0 &&
            set.rir != null
    }
    val confirmedSets = recommendation.strengthSummary.equipment.calibrationSetCount + currentValidSets
    if (confirmedSets < 2) {
        return recommendation.copy(
            strengthSummary = recommendation.strengthSummary.copy(
                equipment = recommendation.strengthSummary.equipment.copy(
                    calibrationSetCount = confirmedSets,
                    confidence = if (confirmedSets == 1) "medium" else "low",
                ),
            ),
        )
    }
    return recommendation.copy(
        mode = "normal",
        targetSets = exercise.targetSets,
        targetRIR = exercise.targetRIR,
        suggestedWeight = null,
        weightCeiling = null,
        startFraction = null,
        calibrationRequired = false,
        calibrationKind = "none",
    )
}

internal fun resolveWorkoutEquipmentId(
    exercise: ProgramExerciseDto,
    gym: GymDto?,
    sets: List<LocalSetEntity>,
    selectedEquipmentId: String?,
): String? {
    if (selectedEquipmentId != null) return selectedEquipmentId

    val inventory = resolveExerciseInventory(exercise, gym)
    selectedEquipment(inventory)?.equipmentId?.let { preferred ->
        return preferred
    }

    val lastRecordedSet = sets
        .asSequence()
        .filter { set ->
            set.exerciseId == exercise.exerciseId && !set.deleted
        }
        .maxWithOrNull(compareBy<LocalSetEntity> { it.completedAt }.thenBy { it.setNumber })
    if (
        lastRecordedSet?.gymEquipmentId != null &&
        inventory.equipment.any { it.equipmentId == lastRecordedSet.gymEquipmentId }
    ) {
        return lastRecordedSet.gymEquipmentId
    }

    return null
}

internal data class WorkoutExerciseSetProgress(
    val programExerciseId: String,
    val exerciseId: String,
    val completedRows: Int,
    val plannedRows: Int,
)

internal fun workoutExerciseSetProgress(
    exercises: List<ProgramExerciseDto>,
    sets: List<LocalSetEntity>,
    returnRecommendations: Map<String, ReturnRecommendationDto>,
    manualTargetSets: Map<String, Int> = emptyMap(),
): List<WorkoutExerciseSetProgress> = exercises.map { exercise ->
    val recommendation = returnRecommendations[exercise.id]
    val plannedRows = effectiveWorkoutTargetSets(
        exercise,
        recommendation,
        manualTargetSets[exercise.id],
    ) +
        if (recommendation?.calibrationRequired == true) {
            0
        } else {
            exercise.targetDropSets
        }
    WorkoutExerciseSetProgress(
        programExerciseId = exercise.id,
        exerciseId = exercise.exerciseId,
        completedRows = sets.count { set ->
            set.exerciseId == exercise.exerciseId && !set.deleted && !set.isWarmup
        },
        plannedRows = plannedRows,
    )
}
