package org.sharteman.gymcoach.ui

import org.junit.Assert.assertEquals
import org.junit.Test
import org.sharteman.gymcoach.data.local.LocalSetEntity
import org.sharteman.gymcoach.data.model.ExerciseDto
import org.sharteman.gymcoach.data.model.ProgramExerciseDto

class WorkoutSummaryStatsTest {
    @Test
    fun excludesWarmupsDeletedRowsAndCardioRepetitionsFromSummary() {
        val sets = listOf(
            set("warmup", weight = 20.0, reps = 10, warmup = true),
            set("working", exerciseId = "barbell", weight = 100.0, reps = 8),
            set("drop", exerciseId = "barbell", weight = 80.0, reps = 10, dropSet = true),
            set("deleted", weight = 200.0, reps = 5, deleted = true),
            set("bodyweight", exerciseId = "pullup", weight = 10.0, reps = 5),
            set("cardio", exerciseId = "cardio", weight = 25.0, reps = 1, durationSec = 1_800),
        )
        val exercises = listOf(
            exercise("barbell"),
            exercise("pullup", usesBodyweight = true),
            exercise("cardio", category = "CARDIO"),
        )

        val summary = workoutSummaryStats(sets, exercises, bodyweightKg = 80.0)

        assertEquals(4, summary.workingSets)
        assertEquals(23, summary.totalReps)
        assertEquals(2_050.0, summary.volumeKg, 0.0)
    }

    private fun set(
        id: String,
        exerciseId: String = "barbell",
        weight: Double,
        reps: Int,
        warmup: Boolean = false,
        dropSet: Boolean = false,
        deleted: Boolean = false,
        durationSec: Int? = null,
    ) = LocalSetEntity(
        id = id,
        sessionId = "session",
        exerciseId = exerciseId,
        setNumber = 1,
        weight = weight,
        reps = reps,
        rir = 2,
        durationSec = durationSec,
        isWarmup = warmup,
        isDropSet = dropSet,
        completedAt = "2026-07-14T10:00:00Z",
        deleted = deleted,
    )

    private fun exercise(
        exerciseId: String,
        category: String = "STRENGTH",
        usesBodyweight: Boolean = false,
    ) = ProgramExerciseDto(
        id = "program_$exerciseId",
        workoutId = "workout",
        exerciseId = exerciseId,
        order = 0,
        targetSets = 3,
        targetRepsMin = 5,
        targetRepsMax = 10,
        targetRIR = 2,
        restSec = 120,
        exercise = ExerciseDto(
            id = exerciseId,
            name = exerciseId,
            muscleGroup = "OTHER",
            category = category,
            usesBodyweight = usesBodyweight,
        ),
    )
}
