package org.sharteman.gymcoach.ui.programs

import org.junit.Assert.assertEquals
import org.junit.Test
import org.sharteman.gymcoach.data.model.ExerciseDto

class ExerciseCatalogFilterTest {
    private val exercises = listOf(
        ExerciseDto(id = "1", name = "Bench Press", muscleGroup = "CHEST", category = "COMPOUND"),
        ExerciseDto(id = "2", name = "Cable Fly", muscleGroup = "CHEST", category = "ISOLATION"),
        ExerciseDto(id = "3", name = "Barbell Row", muscleGroup = "BACK_THICKNESS", category = "COMPOUND"),
    )

    @Test
    fun `combines case insensitive search muscle and category filters`() {
        val result = filterCatalogExercises(exercises, "PRESS", "CHEST", "COMPOUND")
        assertEquals(listOf("1"), result.map { it.id })
    }

    @Test
    fun `blank optional filters return complete catalog`() {
        assertEquals(exercises, filterCatalogExercises(exercises, " ", null, null))
    }
}
