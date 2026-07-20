package org.sharteman.gymcoach.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.sharteman.gymcoach.data.local.LocalSetEntity
import org.sharteman.gymcoach.training.SetRecommendation

class WorkoutSetEditingTest {
    @Test
    fun `completed set opens as an editable draft and saves all strength values`() {
        val set = completedSet(weight = 100.0, reps = 10, rir = 2)

        val openedDraft = draftFromSet(set, unit = "KG")
        assertEquals(EditableSetDraft("100", "10", "2"), openedDraft)

        val editedDraft = openedDraft.copy(weightText = "95", repsText = "9", rirText = "1")
        assertEquals(ParsedSet(weight = 95.0, reps = 9, rir = 1), editedDraft.parse(unit = "KG"))
    }

    @Test
    fun `completed set draft converts display pounds back to stored kilograms`() {
        val set = completedSet(weight = 45.36, reps = 8, rir = null)

        val openedDraft = draftFromSet(set, unit = "LB")
        assertEquals("100", openedDraft.weightText)
        assertEquals("", openedDraft.rirText)

        val saved = openedDraft.copy(weightText = "110.2", repsText = "7", rirText = "3")
            .parse(unit = "LB")
        assertEquals(49.99, saved?.weight ?: 0.0, 0.001)
        assertEquals(7, saved?.reps)
        assertEquals(3, saved?.rir)
    }

    @Test
    fun `invalid inline edits cannot be saved`() {
        assertNull(EditableSetDraft("", "10", "2").parse("KG"))
        assertNull(EditableSetDraft("100", "0", "2").parse("KG"))
        assertNull(EditableSetDraft("100", "10", "6").parse("KG"))
        assertNull(EditableSetDraft("501", "10", "2").parse("KG"))
    }

    @Test
    fun `recommendation draft applies weight reps and rir then disables its action`() {
        val recommendation = recommendation(weight = 92.5, reps = 9, rir = 1)
        val currentKey = recommendationKey(recommendation)

        assertTrue(recommendationCanApply(appliedKey = null, currentKey = currentKey))
        assertEquals(
            EditableSetDraft(weightText = "92.5", repsText = "9", rirText = "1"),
            recommendationDraft(recommendation, unit = "KG"),
        )

        val appliedKey = currentKey
        assertFalse(recommendationCanApply(appliedKey = appliedKey, currentKey = currentKey))
    }

    @Test
    fun `manual change or a new recommendation restores the action indicator`() {
        val firstKey = recommendationKey(recommendation(weight = 92.5, reps = 9, rir = 1))
        val nextKey = recommendationKey(recommendation(weight = 90.0, reps = 8, rir = 2))

        assertFalse(recommendationCanApply(appliedKey = firstKey, currentKey = firstKey))
        assertTrue(recommendationCanApply(appliedKey = null, currentKey = firstKey))
        assertTrue(recommendationCanApply(appliedKey = firstKey, currentKey = nextKey))
        assertFalse(recommendationCanApply(appliedKey = null, currentKey = null))
    }

    @Test
    fun `stored collisions render as stable contiguous working ordinals without rewriting rows`() {
        val storedNumbers = listOf(1, 2, 3, 3, 4, 1)
        val sets = storedNumbers.mapIndexed { index, storedNumber ->
            displaySet(
                id = "set-$index",
                setNumber = storedNumber,
                completedAt = "2026-07-15T10:0${index}:00Z",
            )
        }

        val displayed = displayedWorkoutSets(sets)

        assertEquals((1..6).toList(), displayed.map { it.workingNumber })
        assertEquals(storedNumbers, displayed.map { it.set.setNumber })
        assertEquals(sets.map { it.id }, displayed.map { it.set.id })
    }

    @Test
    fun `warmup drop and deleted rows preserve markers without creating working number gaps`() {
        val displayed = displayedWorkoutSets(
            listOf(
                displaySet("warmup", 9, "2026-07-15T10:00:00Z", isWarmup = true),
                displaySet("working-raw-4", 4, "2026-07-15T10:01:00Z"),
                displaySet("drop", 1, "2026-07-15T10:02:00Z", isDropSet = true),
                displaySet("working-raw-1", 1, "2026-07-15T10:03:00Z"),
                displaySet("deleted", 2, "2026-07-15T10:04:00Z", deleted = true),
            ),
        )

        assertEquals(listOf("warmup", "working-raw-4", "drop", "working-raw-1"), displayed.map { it.set.id })
        assertEquals(listOf(null, 1, null, 2), displayed.map { it.workingNumber })
        assertTrue(displayed.first().set.isWarmup)
        assertTrue(displayed[2].set.isDropSet)
    }

    @Test
    fun `equal completion timestamps use stored number then immutable id as deterministic tie breakers`() {
        val completedAt = "2026-07-15T10:00:00Z"
        val displayed = displayedWorkoutSets(
            listOf(
                displaySet("set-b", 2, completedAt),
                displaySet("set-c", 1, completedAt),
                displaySet("set-a", 2, completedAt),
            ),
        )

        assertEquals(listOf("set-c", "set-a", "set-b"), displayed.map { it.set.id })
        assertEquals(listOf(1, 2, 3), displayed.map { it.workingNumber })
    }

    @Test
    fun `completed drop marker cannot skip the next working ordinal or create another planned drop`() {
        val displayed = displayedWorkoutSets(
            listOf(displaySet("drop", 7, "2026-07-15T10:00:00Z", isDropSet = true)),
        )

        val upcoming = upcomingWorkoutSets(
            displayedSets = displayed,
            targetWorkingSets = 2,
            targetDropSets = 1,
            activeIsWarmup = false,
            activeIsDropSet = false,
        )

        assertEquals(
            listOf(UpcomingWorkoutSet(rowNumber = 2, performanceIndex = 1, isDropSet = false)),
            upcoming,
        )
    }

    @Test
    fun `active drop marker preserves all remaining contiguous working rows`() {
        val displayed = displayedWorkoutSets(
            listOf(displaySet("working", 9, "2026-07-15T10:00:00Z")),
        )

        val upcoming = upcomingWorkoutSets(
            displayedSets = displayed,
            targetWorkingSets = 3,
            targetDropSets = 1,
            activeIsWarmup = false,
            activeIsDropSet = true,
        )

        assertEquals(listOf(2, 3), upcoming.map { it.rowNumber })
        assertTrue(upcoming.none { it.isDropSet })
    }

    private fun completedSet(weight: Double, reps: Int, rir: Int?) = LocalSetEntity(
        id = "set-1",
        sessionId = "session-1",
        exerciseId = "exercise-1",
        setNumber = 1,
        weight = weight,
        reps = reps,
        rir = rir,
        completedAt = "2026-07-15T10:00:00Z",
    )

    private fun displaySet(
        id: String,
        setNumber: Int,
        completedAt: String,
        isWarmup: Boolean = false,
        isDropSet: Boolean = false,
        deleted: Boolean = false,
    ) = LocalSetEntity(
        id = id,
        sessionId = "session-1",
        exerciseId = "exercise-1",
        setNumber = setNumber,
        weight = 100.0,
        reps = 8,
        rir = 2,
        isWarmup = isWarmup,
        isDropSet = isDropSet,
        completedAt = completedAt,
        deleted = deleted,
    )

    private fun recommendation(weight: Double, reps: Int, rir: Int) = SetRecommendation(
        weight = weight,
        reps = reps,
        rir = rir,
        reason = "hold-load",
        predictedRepsAtSameLoad = reps,
        fatigueLoss = 0.5,
        confidence = "medium",
    )
}
