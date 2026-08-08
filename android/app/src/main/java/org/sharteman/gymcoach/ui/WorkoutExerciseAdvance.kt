package org.sharteman.gymcoach.ui

import org.sharteman.gymcoach.data.local.LocalSetEntity
import org.sharteman.gymcoach.data.model.ProgramExerciseDto
import org.sharteman.gymcoach.data.model.ReturnRecommendationDto

internal data class WorkoutExerciseCompletion(
    val completedWorkingSets: Int,
    val completedDropSets: Int,
    val targetWorkingSets: Int,
    val targetDropSets: Int,
) {
    val completedRows: Int get() = completedWorkingSets + completedDropSets
    val plannedRows: Int get() = targetWorkingSets + targetDropSets
    val remainingRows: Int get() =
        (targetWorkingSets - completedWorkingSets).coerceAtLeast(0) +
            (targetDropSets - completedDropSets).coerceAtLeast(0)
    val isComplete: Boolean get() = remainingRows == 0
}

internal fun workoutExerciseCompletion(
    exercise: ProgramExerciseDto,
    sets: List<LocalSetEntity>,
    recommendation: ReturnRecommendationDto?,
    manualTargetSets: Int?,
): WorkoutExerciseCompletion {
    val exerciseSets = sets.asSequence()
        .filter { set ->
            set.exerciseId == exercise.exerciseId && !set.deleted && !set.isWarmup
        }
        .distinctBy { it.id }
        .toList()
    return WorkoutExerciseCompletion(
        completedWorkingSets = exerciseSets.count { !it.isDropSet },
        completedDropSets = exerciseSets.count { it.isDropSet },
        targetWorkingSets = effectiveWorkoutTargetSets(
            exercise,
            recommendation,
            manualTargetSets,
        ),
        targetDropSets = if (recommendation?.calibrationRequired == true) {
            0
        } else {
            exercise.targetDropSets
        },
    )
}

internal fun completedWorkoutExerciseIds(
    exercises: List<ProgramExerciseDto>,
    sets: List<LocalSetEntity>,
    returnRecommendations: Map<String, ReturnRecommendationDto>,
    manualTargetSets: Map<String, Int> = emptyMap(),
): Set<String> {
    return exercises.mapNotNullTo(mutableSetOf()) { exercise ->
        exercise.exerciseId.takeIf {
            workoutExerciseCompletion(
                exercise = exercise,
                sets = sets,
                recommendation = returnRecommendations[exercise.id],
                manualTargetSets = manualTargetSets[exercise.id],
            ).isComplete
        }
    }
}

internal fun nextIncompleteWorkoutExerciseIndex(
    exercises: List<ProgramExerciseDto>,
    sets: List<LocalSetEntity>,
    returnRecommendations: Map<String, ReturnRecommendationDto>,
    currentIndex: Int,
    submittedSet: LocalSetEntity,
    manualTargetSets: Map<String, Int> = emptyMap(),
): Int? {
    val current = exercises.getOrNull(currentIndex) ?: return null
    if (submittedSet.deleted || submittedSet.isWarmup) return null

    val completedSets = sets + submittedSet
    fun remaining(index: Int): Int {
        val exercise = exercises[index]
        return workoutExerciseCompletion(
            exercise = exercise,
            sets = completedSets,
            recommendation = returnRecommendations[exercise.id],
            manualTargetSets = manualTargetSets[exercise.id],
        ).remainingRows
    }
    fun firstIncomplete(indices: IntProgression): Int? =
        indices.firstOrNull { index -> remaining(index) > 0 }

    val group = current.supersetGroup
    if (group == null) {
        if (remaining(currentIndex) > 0) return null
        return firstIncomplete((currentIndex + 1)..exercises.lastIndex)
            ?: firstIncomplete(0 until currentIndex)
    }

    val groupIndices = exercises.indices.filter { index -> exercises[index].supersetGroup == group }
    val currentGroupPosition = groupIndices.indexOf(currentIndex)
    if (currentGroupPosition < 0) return null
    for (step in 1 until groupIndices.size) {
        val index = groupIndices[(currentGroupPosition + step) % groupIndices.size]
        if (remaining(index) > 0) return index
    }
    if (remaining(currentIndex) > 0) return null

    val groupStart = groupIndices.first()
    val groupEnd = groupIndices.last()
    return firstIncomplete((groupEnd + 1)..exercises.lastIndex)
        ?: firstIncomplete(0 until groupStart)
}

internal fun effectiveWorkoutTargetSets(
    exercise: ProgramExerciseDto,
    recommendation: ReturnRecommendationDto?,
    manualTargetSets: Int?,
): Int = manualTargetSets ?: recommendation?.targetSets ?: exercise.targetSets

internal fun minimumManualTargetSets(
    exercise: ProgramExerciseDto,
    sets: List<LocalSetEntity>,
): Int {
    val completed = sets.filter { set ->
        set.exerciseId == exercise.exerciseId && !set.deleted && !set.isWarmup
    }
    return maxOf(
        1,
        completed.count { !it.isDropSet },
        completed.size - exercise.targetDropSets,
    )
}
