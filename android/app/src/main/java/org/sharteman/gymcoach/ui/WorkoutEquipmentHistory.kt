package org.sharteman.gymcoach.ui

import org.sharteman.gymcoach.data.local.LocalSetEntity
import org.sharteman.gymcoach.data.model.EquipmentReturnRecommendationDto
import org.sharteman.gymcoach.data.model.GymDto
import org.sharteman.gymcoach.data.model.LastPerformanceDto
import org.sharteman.gymcoach.data.model.ProgramExerciseDto
import org.sharteman.gymcoach.data.model.ReturnRecommendationDto
import org.sharteman.gymcoach.training.resolveExerciseInventory
import org.sharteman.gymcoach.training.selectedEquipment

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
): List<WorkoutExerciseSetProgress> = exercises.map { exercise ->
    val recommendation = returnRecommendations[exercise.id]
    val plannedRows = (recommendation?.targetSets ?: exercise.targetSets) +
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
