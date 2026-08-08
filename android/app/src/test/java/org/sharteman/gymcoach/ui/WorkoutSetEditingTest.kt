package org.sharteman.gymcoach.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.sharteman.gymcoach.data.local.LocalSetEntity
import org.sharteman.gymcoach.training.LoadConstraints
import org.sharteman.gymcoach.training.ResolvedEquipmentLoadProfile
import org.sharteman.gymcoach.training.SetRecommendation
import org.sharteman.gymcoach.training.isAchievableLoad

class WorkoutSetEditingTest {
    @Test
    fun `weight picker follows only the exact selected equipment options`() {
        val cableA = equipmentProfile("cable-a", listOf(10.0, 20.0, 30.0))
        val cableB = equipmentProfile("cable-b", listOf(12.5, 17.5, 22.5))
        val base = LoadConstraints(
            equipmentType = "CABLE",
            equipmentOptions = listOf(cableA, cableB),
        )

        val first = workoutWeightPickerModel(
            constraints = base.copy(equipmentId = cableA.equipmentId),
            referenceWeightKg = 20.0,
            unit = "KG",
        )
        val switched = workoutWeightPickerModel(
            constraints = base.copy(equipmentId = cableB.equipmentId),
            referenceWeightKg = 20.0,
            unit = "KG",
        )

        assertEquals(listOf(10.0, 20.0, 30.0), first.options)
        assertEquals(listOf(12.5, 17.5, 22.5), switched.options)
        assertTrue(first.options.intersect(switched.options.toSet()).isEmpty())
        assertFalse(first.manualEntryOnly)
        assertFalse(switched.manualEntryOnly)
    }

    @Test
    fun `missing equipment options use manual entry without inventing a load tape`() {
        val model = workoutWeightPickerModel(
            constraints = LoadConstraints(equipmentType = "MACHINE"),
            referenceWeightKg = 47.5,
            unit = "KG",
        )

        assertTrue(model.options.isEmpty())
        assertTrue(model.manualEntryOnly)
    }

    @Test
    fun `finished history without current equipment remains manually editable`() {
        val constraints = finishedEditLoadConstraints(
            LoadConstraints(
                equipmentType = "BARBELL",
                isAvailable = false,
                weightOptions = listOf(5.0, 10.0),
            ),
        )

        assertTrue(constraints.isAvailable)
        assertTrue(constraints.weightOptions.isEmpty())
        assertTrue(isAchievableLoad(constraints, 72.5))
        assertTrue(
            workoutWeightPickerModel(constraints, referenceWeightKg = 72.5, unit = "KG")
                .manualEntryOnly,
        )
    }

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
    fun `restored workout drafts suppress the same initial autofill key`() {
        val key = workoutInputAutofillKey(
            exerciseId = "exercise-1",
            comparableSetCount = 2,
            recommendation = recommendation(weight = 92.5, reps = 9, rir = 1),
            equipmentId = "equipment-1",
            returnSuggestedWeight = null,
            lastPerformanceSessionId = "session-1",
        )

        assertFalse(
            shouldApplyWorkoutInputAutofill(
                lastAppliedKey = key,
                currentKey = key,
                weightText = "87.5",
                repsText = "11",
                rirText = "3",
            ),
        )
        assertFalse(
            shouldApplyWorkoutInputAutofill(
                lastAppliedKey = key,
                currentKey = key,
                weightText = "",
                repsText = "",
                rirText = "1",
            ),
        )
    }

    @Test
    fun `restored workout drafts suppress first autofill even when recommendation key drifted`() {
        assertTrue(
            shouldPreserveRestoredWorkoutInputs(
                hasAppliedAutofill = true,
                observedAutofillKey = null,
                weightText = "87.5",
                repsText = "11",
                rirText = "3",
            ),
        )
        assertFalse(
            shouldPreserveRestoredWorkoutInputs(
                hasAppliedAutofill = true,
                observedAutofillKey = "observed-in-this-composition",
                weightText = "87.5",
                repsText = "11",
                rirText = "3",
            ),
        )
    }

    @Test
    fun `new set autofill key can initialize the next workout draft`() {
        val recommendation = recommendation(weight = 92.5, reps = 9, rir = 1)
        val previousKey = workoutInputAutofillKey(
            exerciseId = "exercise-1",
            comparableSetCount = 2,
            recommendation = recommendation,
            equipmentId = "equipment-1",
            returnSuggestedWeight = null,
            lastPerformanceSessionId = "session-1",
        )
        val nextKey = workoutInputAutofillKey(
            exerciseId = "exercise-1",
            comparableSetCount = 3,
            recommendation = recommendation,
            equipmentId = "equipment-1",
            returnSuggestedWeight = null,
            lastPerformanceSessionId = "session-1",
        )

        assertTrue(
            shouldApplyWorkoutInputAutofill(
                lastAppliedKey = previousKey,
                currentKey = nextKey,
                weightText = "87.5",
                repsText = "11",
                rirText = "3",
            ),
        )
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

    private fun equipmentProfile(
        id: String,
        loads: List<Double>,
    ) = ResolvedEquipmentLoadProfile(
        equipmentId = id,
        equipmentName = id,
        equipmentType = "CABLE",
        loadType = "SELECTORIZED",
        weightOptions = loads,
        selectedLoadMultiplier = 0.5,
        baseLoadKg = 0.0,
        loadingSides = 1,
        platePoolId = null,
        platePoolName = null,
        plates = emptyList(),
        attainableLoads = loads,
        inventoryPrecision = "NOT_APPLICABLE",
    )
}
