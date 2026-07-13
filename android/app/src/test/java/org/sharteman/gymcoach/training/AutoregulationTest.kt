package org.sharteman.gymcoach.training

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.sharteman.gymcoach.data.local.LocalSetEntity
import org.sharteman.gymcoach.data.model.ExerciseDto
import org.sharteman.gymcoach.data.model.ProgramExerciseDto

class AutoregulationTest {
    @Test
    fun preserveRirLowersTheRepTargetAsFatigueAccumulates() {
        val recommendation = recommendNextSet(
            programExercise = programExercise(mode = "PRESERVE_RIR", muscle = "QUADS"),
            completedSets = listOf(set(weight = 100.0, reps = 12, rir = 2)),
            recoverySec = 120,
        )
        requireNotNull(recommendation)
        assertEquals(100.0, recommendation.weight, 0.001)
        assertEquals(11, recommendation.reps)
        assertEquals("adjust-reps", recommendation.reason)
    }

    @Test
    fun shortRestProducesMoreFatigueThanProgrammedRest() {
        val exercise = programExercise(mode = "PRESERVE_RIR", muscle = "QUADS")
        val sets = listOf(set(weight = 100.0, reps = 12, rir = 2))
        val shortRest = requireNotNull(recommendNextSet(exercise, sets, recoverySec = 60))
        val fullRest = requireNotNull(recommendNextSet(exercise, sets, recoverySec = 120))

        assertTrue(shortRest.fatigueLoss > fullRest.fatigueLoss)
        assertTrue(shortRest.reps < fullRest.reps)
    }

    @Test
    fun preserveRepsReducesToAvailableDumbbell() {
        val recommendation = recommendNextSet(
            programExercise = programExercise(mode = "PRESERVE_REPS", muscle = "BICEPS"),
            completedSets = listOf(set(weight = 19.0, reps = 12, rir = 0)),
            recoverySec = 60,
            constraints = LoadConstraints(
                equipmentType = "DUMBBELL",
                dumbbellWeights = listOf(10.0, 12.0, 14.0, 15.5, 19.0),
            ),
        )
        requireNotNull(recommendation)
        assertEquals(15.5, recommendation.weight, 0.001)
        assertEquals("reduce-load", recommendation.reason)
    }

    @Test
    fun barbellOptionsContainConstructibleSixtyFiveKg() {
        val weights = constructibleBarbellWeights(
            barWeights = listOf(20.0),
            plateWeights = listOf(1.25, 2.5, 5.0, 10.0, 20.0),
            targetCeiling = 100.0,
        )
        assertTrue(65.0 in weights)
    }

    private fun programExercise(mode: String, muscle: String) = ProgramExerciseDto(
        id = "pe_00000001",
        workoutId = "workout_0001",
        exerciseId = "exercise_001",
        order = 1,
        targetSets = 4,
        targetRepsMin = 8,
        targetRepsMax = 12,
        targetRIR = 2,
        restSec = 120,
        autoregulationMode = mode,
        fatigueRate = if (muscle == "QUADS") 1.0 else 0.5,
        loadAdjustmentPct = 3.0,
        exercise = ExerciseDto(
            id = "exercise_001",
            name = "Test exercise",
            muscleGroup = muscle,
            category = if (muscle == "BICEPS") "ISOLATION" else "COMPOUND",
            equipmentType = if (muscle == "BICEPS") "DUMBBELL" else "BARBELL",
        ),
    )

    private fun set(weight: Double, reps: Int, rir: Int?) = LocalSetEntity(
        id = "set_00000001",
        sessionId = "session_0001",
        exerciseId = "exercise_001",
        setNumber = 1,
        weight = weight,
        reps = reps,
        rir = rir,
        completedAt = "2026-07-13T10:00:00Z",
    )
}
