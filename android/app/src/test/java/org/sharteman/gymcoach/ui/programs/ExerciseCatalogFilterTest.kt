package org.sharteman.gymcoach.ui.programs

import org.junit.Assert.assertEquals
import org.junit.Test
import org.sharteman.gymcoach.data.model.ExerciseDto

class ExerciseCatalogFilterTest {
    private val exercises = listOf(
        ExerciseDto(
            id = "1",
            name = "Bench Press",
            muscleGroup = "CHEST",
            category = "COMPOUND",
            equipmentType = "BARBELL",
        ),
        ExerciseDto(
            id = "2",
            name = "Cable Fly",
            muscleGroup = "CHEST",
            category = "ISOLATION",
            equipmentType = "CABLE",
        ),
        ExerciseDto(
            id = "3",
            name = "Barbell Row",
            muscleGroup = "BACK_THICKNESS",
            category = "COMPOUND",
            equipmentType = "BARBELL",
        ),
    )

    @Test
    fun `combines case insensitive search muscle and equipment filters`() {
        val result = filterCatalogExercises(exercises, "PRESS", "CHEST", "BARBELL")
        assertEquals(listOf("1"), result.map { it.id })
    }

    @Test
    fun `blank optional filters return complete catalog`() {
        assertEquals(exercises, filterCatalogExercises(exercises, " ", null, null))
    }

    @Test
    fun `searches by localized Russian exercise name`() {
        val result = filterCatalogExercises(exercises, "жим лёжа", null, null, language = "ru")
        assertEquals(listOf("1"), result.map { it.id })
    }

    @Test
    fun `exclusion composes with search muscle and equipment`() {
        val result = filterCatalogExercises(
            exercises = exercises,
            query = "barbell",
            muscleGroup = "BACK_THICKNESS",
            equipmentType = "BARBELL",
            excludedExerciseIds = setOf("1"),
        )
        assertEquals(listOf("3"), result.map { it.id })
    }
}
