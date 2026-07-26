package org.sharteman.gymcoach.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.sharteman.gymcoach.data.local.LocalSetEntity
import org.sharteman.gymcoach.data.model.ExerciseDto
import org.sharteman.gymcoach.data.model.ProgramExerciseDto
import org.sharteman.gymcoach.data.model.ReturnRecommendationDto

class WorkoutExerciseAdvanceTest {
    @Test
    fun alternatesToTheNextIncompleteSupersetMember() {
        val exercises = listOf(exercise("a", 1), exercise("b", 1), exercise("c", null))

        assertEquals(
            1,
            nextIncompleteWorkoutExerciseIndex(
                exercises,
                emptyList(),
                normalRecommendations(exercises),
                currentIndex = 0,
                submittedSet = set("a", "a-1"),
            ),
        )
    }

    @Test
    fun completedTwoMemberSupersetAdvancesPastTheGroup() {
        val exercises = listOf(exercise("a", 1), exercise("b", 1), exercise("c", null))

        assertEquals(
            2,
            nextIncompleteWorkoutExerciseIndex(
                exercises,
                listOf(set("a", "a-1")),
                normalRecommendations(exercises),
                currentIndex = 1,
                submittedSet = set("b", "b-1"),
            ),
        )
    }

    @Test
    fun threeMemberSupersetCyclesToTheNextIncompleteMemberInWorkoutOrder() {
        val exercises = listOf(exercise("a", 1), exercise("b", 1), exercise("c", 1))

        assertEquals(
            0,
            nextIncompleteWorkoutExerciseIndex(
                exercises,
                listOf(set("b", "b-1")),
                normalRecommendations(exercises),
                currentIndex = 2,
                submittedSet = set("c", "c-1"),
            ),
        )
    }

    @Test
    fun completedGroupSkipsCompletedExerciseAndEntersTheNextSuperset() {
        val exercises = listOf(
            exercise("a", 1),
            exercise("b", 1),
            exercise("c", null),
            exercise("d", 2),
            exercise("e", 2),
        )
        val sets = listOf(set("a", "a-1"), set("c", "c-1"))

        assertEquals(
            3,
            nextIncompleteWorkoutExerciseIndex(
                exercises,
                sets,
                normalRecommendations(exercises),
                currentIndex = 1,
                submittedSet = set("b", "b-1"),
            ),
        )
    }

    @Test
    fun outOfOrderCompletionWrapsOnlyToAGenuinelyIncompleteEarlierExercise() {
        val exercises = listOf(exercise("a", null), exercise("b", null), exercise("c", null))

        assertEquals(
            1,
            nextIncompleteWorkoutExerciseIndex(
                exercises,
                listOf(set("a", "a-1")),
                normalRecommendations(exercises),
                currentIndex = 2,
                submittedSet = set("c", "c-1"),
            ),
        )
    }

    @Test
    fun fullyCompleteWorkoutDoesNotCycleToACompletedExercise() {
        val exercises = listOf(exercise("a", 1), exercise("b", 1))

        assertNull(
            nextIncompleteWorkoutExerciseIndex(
                exercises,
                listOf(set("a", "a-1")),
                normalRecommendations(exercises),
                currentIndex = 1,
                submittedSet = set("b", "b-1"),
            ),
        )
    }

    @Test
    fun warmupsDropsDeletedRowsAndDuplicateLogicalSetsDoNotCompleteTheTarget() {
        val exercises = listOf(exercise("a", null, targetSets = 2), exercise("b", null))
        val first = set("a", "a-1")
        val ignored = listOf(
            first,
            first.copy(),
            set("a", "a-warmup", isWarmup = true),
            set("a", "a-drop", isDropSet = true),
            set("a", "a-deleted", deleted = true),
        )

        assertNull(
            nextIncompleteWorkoutExerciseIndex(
                exercises,
                ignored,
                normalRecommendations(exercises),
                currentIndex = 0,
                submittedSet = set("a", "a-warmup-2", isWarmup = true),
            ),
        )
        assertEquals(
            1,
            nextIncompleteWorkoutExerciseIndex(
                exercises,
                ignored,
                normalRecommendations(exercises),
                currentIndex = 0,
                submittedSet = set("a", "a-2"),
            ),
        )
    }

    @Test
    fun sessionOnlyReturnTargetControlsCompletion() {
        val exercises = listOf(exercise("a", null, targetSets = 3), exercise("b", null))
        val recommendations = normalRecommendations(exercises).toMutableMap()
        recommendations[exercises[0].id] = ReturnRecommendationDto(
            mode = "exercise-reintro",
            targetSets = 2,
            targetRIR = 3,
        )

        assertEquals(
            1,
            nextIncompleteWorkoutExerciseIndex(
                exercises,
                listOf(set("a", "a-1")),
                recommendations,
                currentIndex = 0,
                submittedSet = set("a", "a-2"),
            ),
        )
    }

    @Test
    fun completionProjectionIgnoresWarmupsDropsDeletedRowsAndDuplicates() {
        val exercises = listOf(exercise("a", null, targetSets = 2))
        val first = set("a", "a-1")
        val sets = listOf(
            first,
            first.copy(),
            set("a", "a-warmup", isWarmup = true),
            set("a", "a-drop", isDropSet = true),
            set("a", "a-deleted", deleted = true),
        )

        assertEquals(
            emptySet<String>(),
            completedWorkoutExerciseIds(exercises, sets, normalRecommendations(exercises)),
        )
        assertEquals(
            setOf("a"),
            completedWorkoutExerciseIds(
                exercises,
                sets + set("a", "a-2"),
                normalRecommendations(exercises),
            ),
        )
    }

    private fun normalRecommendations(
        exercises: List<ProgramExerciseDto>,
    ): Map<String, ReturnRecommendationDto> = exercises.associate { exercise ->
        exercise.id to ReturnRecommendationDto(
            mode = "normal",
            targetSets = exercise.targetSets,
            targetRIR = exercise.targetRIR,
        )
    }

    private fun exercise(
        id: String,
        group: Int?,
        targetSets: Int = 1,
    ) = ProgramExerciseDto(
        id = "program-$id",
        workoutId = "workout",
        exerciseId = id,
        order = id.first().code,
        targetSets = targetSets,
        targetRepsMin = 8,
        targetRepsMax = 12,
        targetRIR = 2,
        restSec = 120,
        supersetGroup = group,
        exercise = ExerciseDto(
            id = id,
            name = "Exercise $id",
            muscleGroup = "CHEST",
            category = "COMPOUND",
        ),
    )

    private fun set(
        exerciseId: String,
        id: String,
        isWarmup: Boolean = false,
        isDropSet: Boolean = false,
        deleted: Boolean = false,
    ) = LocalSetEntity(
        id = id,
        sessionId = "session",
        exerciseId = exerciseId,
        setNumber = 1,
        weight = 20.0,
        reps = 10,
        rir = 2,
        completedAt = "2026-07-27T10:00:00Z",
        isWarmup = isWarmup,
        isDropSet = isDropSet,
        deleted = deleted,
    )
}
