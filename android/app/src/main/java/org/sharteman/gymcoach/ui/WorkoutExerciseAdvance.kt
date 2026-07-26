package org.sharteman.gymcoach.ui

import org.sharteman.gymcoach.data.local.LocalSetEntity
import org.sharteman.gymcoach.data.model.ProgramExerciseDto
import org.sharteman.gymcoach.data.model.ReturnRecommendationDto

internal fun completedWorkoutExerciseIds(
    exercises: List<ProgramExerciseDto>,
    sets: List<LocalSetEntity>,
    returnRecommendations: Map<String, ReturnRecommendationDto>,
): Set<String> {
    val completedByExerciseId = completedRegularSetCounts(sets)
    return exercises.mapNotNullTo(mutableSetOf()) { exercise ->
        val targetSets = returnRecommendations[exercise.id]?.targetSets ?: exercise.targetSets
        exercise.exerciseId.takeIf {
            (completedByExerciseId[exercise.exerciseId] ?: 0) >= targetSets
        }
    }
}

internal fun nextIncompleteWorkoutExerciseIndex(
    exercises: List<ProgramExerciseDto>,
    sets: List<LocalSetEntity>,
    returnRecommendations: Map<String, ReturnRecommendationDto>,
    currentIndex: Int,
    submittedSet: LocalSetEntity,
): Int? {
    val current = exercises.getOrNull(currentIndex) ?: return null
    if (submittedSet.deleted || submittedSet.isWarmup || submittedSet.isDropSet) return null

    val completedByExerciseId = completedRegularSetCounts(sets + submittedSet)
    fun remaining(index: Int): Int {
        val exercise = exercises[index]
        val targetSets = returnRecommendations[exercise.id]?.targetSets ?: exercise.targetSets
        return (targetSets - (completedByExerciseId[exercise.exerciseId] ?: 0)).coerceAtLeast(0)
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

private fun completedRegularSetCounts(
    sets: List<LocalSetEntity>,
): Map<String, Int> = sets
    .asSequence()
    .filter { !it.deleted && !it.isWarmup && !it.isDropSet }
    .distinctBy { it.id }
    .groupingBy { it.exerciseId }
    .eachCount()
