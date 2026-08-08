package org.sharteman.gymcoach.data.model

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SyncOperationProgramDecisionTest {
    private val json = Json {
        encodeDefaults = true
        explicitNulls = true
        classDiscriminator = "type"
    }

    @Test
    fun legacyActiveMutationOmitsTheNewMarkerWhileFinishedDecisionIncludesIt() {
        val exercise = MobileWorkoutExerciseMutationDto(
            id = "program_exercise_1",
            exerciseId = "exercise_1",
            order = 0,
            targetSets = 3,
            targetRepsMin = 8,
            targetRepsMax = 12,
            targetRIR = 2,
            restSec = 90,
        )
        val active = operation(exercise, programDecision = false)
        val decision = operation(exercise, programDecision = true)

        assertFalse(json.encodeToString<SyncOperation>(active).contains("programDecision"))
        assertTrue(json.encodeToString<SyncOperation>(decision).contains("\"programDecision\":true"))
    }

    private fun operation(
        exercise: MobileWorkoutExerciseMutationDto,
        programDecision: Boolean,
    ) = MutateWorkoutExercisesOperation(
        operationId = "operation_1",
        sessionId = "session_1",
        workoutId = "workout_1",
        previousExercises = listOf(exercise),
        exercises = listOf(exercise.copy(targetSets = 4)),
        previousActiveExerciseId = exercise.exerciseId,
        nextActiveExerciseId = exercise.exerciseId,
        programDecision = programDecision,
    )
}
