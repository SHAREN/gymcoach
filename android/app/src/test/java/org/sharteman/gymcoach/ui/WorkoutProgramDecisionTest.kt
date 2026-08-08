package org.sharteman.gymcoach.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.sharteman.gymcoach.data.model.ExerciseDto
import org.sharteman.gymcoach.data.model.ProgramExerciseDto
import org.sharteman.gymcoach.data.model.WorkoutStructureDraft
import org.sharteman.gymcoach.data.model.WorkoutStructureSnapshotDto

class WorkoutProgramDecisionTest {
    @Test
    fun diffGroupsEveryEligiblePrescriptionChangeWithoutPerformedSetFacts() {
        val first = exercise("program_1", "exercise_1", "Bench press", 0)
        val second = exercise("program_2", "exercise_2", "Row", 1)
        val added = exercise("program_3", "exercise_3", "Pulldown", 2)
        val draft = draft(
            baseline = listOf(first, second),
            current = listOf(
                first.copy(
                    order = 1,
                    targetSets = 5,
                    targetDropSets = 1,
                    targetRepsMin = 6,
                    targetRepsMax = 9,
                    targetRIR = 3,
                    restSec = 150,
                    tempo = "3-1-1",
                    notes = "Pause",
                    supersetGroup = 1,
                    autoregulationMode = "PRESERVE_REPS",
                    fatigueRate = 1.1,
                    loadAdjustmentPct = 2.5,
                ),
                added,
            ),
        )

        val changes = workoutStructureChanges(draft)

        assertTrue(changes.any { it.kind == WorkoutStructureChangeKind.REMOVED && it.exerciseName == "Row" })
        assertTrue(changes.any { it.kind == WorkoutStructureChangeKind.ADDED && it.exerciseName == "Pulldown" })
        assertEquals(
            setOf(
                WorkoutStructureChangeKind.ORDER,
                WorkoutStructureChangeKind.TARGET_SETS,
                WorkoutStructureChangeKind.TARGET_DROP_SETS,
                WorkoutStructureChangeKind.TARGET_REPS,
                WorkoutStructureChangeKind.TARGET_RIR,
                WorkoutStructureChangeKind.REST,
                WorkoutStructureChangeKind.TEMPO,
                WorkoutStructureChangeKind.NOTES,
                WorkoutStructureChangeKind.SUPERSET,
                WorkoutStructureChangeKind.AUTOREGULATION,
                WorkoutStructureChangeKind.FATIGUE_RATE,
                WorkoutStructureChangeKind.LOAD_ADJUSTMENT,
            ),
            changes.filter { it.programExerciseId == first.id }.mapTo(mutableSetOf()) { it.kind },
        )
        assertTrue(changes.none { it.before?.contains("80") == true || it.after?.contains("80") == true })
    }

    @Test
    fun replacementIsShownAsAProgramChange() {
        val old = exercise("program_1", "exercise_1", "Bench press", 0)
        val replacement = exercise("program_1", "exercise_2", "Dumbbell press", 0)
        val draft = draft(
            baseline = listOf(old),
            current = listOf(replacement),
        )

        val changes = workoutStructureChanges(draft)

        assertTrue(changes.any {
            it.kind == WorkoutStructureChangeKind.REPLACED &&
                it.before == "Bench press" && it.after == "Dumbbell press"
        })
    }

    @Test
    fun identicalSnapshotsHaveNoMisleadingDiff() {
        val exercise = exercise("program_1", "exercise_1", "Bench press", 0)
        assertTrue(workoutStructureChanges(draft(listOf(exercise), listOf(exercise))).isEmpty())
    }

    private fun draft(
        baseline: List<ProgramExerciseDto>,
        current: List<ProgramExerciseDto>,
    ) = WorkoutStructureDraft(
        sessionId = "session_1",
        status = "PENDING",
        baseline = WorkoutStructureSnapshotDto(
            workoutId = "workout_1",
            workoutName = "Workout",
            exercises = baseline,
        ),
        current = WorkoutStructureSnapshotDto(
            workoutId = "workout_1",
            workoutName = "Workout",
            exercises = current,
        ),
        updatedAtEpochMs = 1,
    )

    private fun exercise(
        programExerciseId: String,
        exerciseId: String,
        name: String,
        order: Int,
    ) = ProgramExerciseDto(
        id = programExerciseId,
        workoutId = "workout_1",
        exerciseId = exerciseId,
        order = order,
        targetSets = 3,
        targetRepsMin = 8,
        targetRepsMax = 12,
        targetRIR = 2,
        restSec = 90,
        exercise = ExerciseDto(
            id = exerciseId,
            name = name,
            muscleGroup = "CHEST",
            category = "STRENGTH",
        ),
    )
}
