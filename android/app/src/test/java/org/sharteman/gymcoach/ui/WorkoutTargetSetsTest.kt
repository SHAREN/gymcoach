package org.sharteman.gymcoach.ui

import org.junit.Assert.assertEquals
import org.junit.Test
import org.sharteman.gymcoach.data.local.LocalSetEntity
import org.sharteman.gymcoach.data.model.ExerciseDto
import org.sharteman.gymcoach.data.model.ProgramExerciseDto
import org.sharteman.gymcoach.data.model.ReturnRecommendationDto
import org.sharteman.gymcoach.training.resolveSharedNextSetTarget

class WorkoutTargetSetsTest {
    @Test
    fun `manual set count overrides recommendation without weakening rir or calibration`() {
        val exercise = exercise(targetSets = 4, targetDropSets = 1)
        val recommendation = ReturnRecommendationDto(
            mode = "equipment-calibration",
            targetSets = 2,
            targetRIR = 4,
            suggestedWeight = 30.0,
            weightCeiling = 32.5,
            calibrationRequired = true,
            confidence = "low",
        )

        val target = requireNotNull(
            resolveSharedNextSetTarget(
                exercise,
                recommendation,
                manualTargetSets = 4,
            ),
        )

        assertEquals(4, target.targetSets)
        assertEquals(0, target.targetDropSets)
        assertEquals(4, target.targetRIR)
        assertEquals(32.5, recommendation.weightCeiling!!, 0.0)
        assertEquals(true, recommendation.calibrationRequired)
        assertEquals("low", recommendation.confidence)
    }

    @Test
    fun `recommendation seeds set count until a manual override exists`() {
        val exercise = exercise(targetSets = 4)
        val recommendation = ReturnRecommendationDto(
            mode = "exercise-reintro",
            targetSets = 2,
            targetRIR = 3,
        )

        assertEquals(2, resolveSharedNextSetTarget(exercise, recommendation)?.targetSets)
        assertEquals(
            4,
            resolveSharedNextSetTarget(exercise, recommendation, manualTargetSets = 4)?.targetSets,
        )
    }

    @Test
    fun `minimum manual count preserves completed regular and drop rows`() {
        val exercise = exercise(targetSets = 4, targetDropSets = 1)
        val sets = listOf(
            set("regular-1"),
            set("regular-2"),
            set("regular-3"),
            set("drop", isDropSet = true),
            set("warmup", isWarmup = true),
            set("deleted", deleted = true),
        )

        assertEquals(3, minimumManualTargetSets(exercise, sets))
    }

    private fun exercise(
        targetSets: Int,
        targetDropSets: Int = 0,
    ) = ProgramExerciseDto(
        id = "program-exercise",
        workoutId = "workout",
        exerciseId = "exercise",
        order = 0,
        targetSets = targetSets,
        targetDropSets = targetDropSets,
        targetRepsMin = 8,
        targetRepsMax = 12,
        targetRIR = 2,
        restSec = 120,
        exercise = ExerciseDto(
            id = "exercise",
            name = "Exercise",
            muscleGroup = "CHEST",
            category = "COMPOUND",
        ),
    )

    private fun set(
        id: String,
        isDropSet: Boolean = false,
        isWarmup: Boolean = false,
        deleted: Boolean = false,
    ) = LocalSetEntity(
        id = id,
        sessionId = "session",
        exerciseId = "exercise",
        setNumber = 1,
        weight = 20.0,
        reps = 10,
        rir = 2,
        completedAt = "2026-07-30T10:00:00Z",
        isDropSet = isDropSet,
        isWarmup = isWarmup,
        deleted = deleted,
    )
}
