package org.sharteman.gymcoach.ui.localization

import org.junit.Assert.assertEquals
import org.junit.Test

class ExerciseLocalizationTest {
    @Test
    fun `uses the same Russian exercise names as the web catalog`() {
        assertEquals("Жим штанги лёжа", exerciseDisplayName("Barbell bench press", "ru"))
        assertEquals("Жим лёжа", exerciseDisplayName("Bench Press", "ru"))
        assertEquals("Жим лёжа · Штанга", exerciseDisplayName("Bench Press · Barbell", "ru"))
        assertEquals("Жим лёжа · Гантели", exerciseDisplayName("Bench Press · Dumbbells", "ru"))
        assertEquals("Жим гантелей лёжа", exerciseDisplayName("Flat dumbbell bench press", "ru"))
        assertEquals(
            "Жим штанги на наклонной скамье",
            exerciseDisplayName("Incline Bench Press", "ru"),
        )
    }

    @Test
    fun `normalizes exercise lookup and preserves custom names`() {
        assertEquals("Жим лёжа", exerciseDisplayName("  BENCH PRESS  ", "ru"))
        assertEquals("Моё упражнение", exerciseDisplayName("Моё упражнение", "ru"))
        assertEquals("Bench Press", exerciseDisplayName("Bench Press", "en"))
    }

    @Test
    fun `localizes exercise attributes`() {
        assertEquals("Грудь", muscleGroupDisplayName("CHEST", "ru"))
        assertEquals("Базовое", exerciseCategoryDisplayName("COMPOUND", "ru"))
        assertEquals("Штанга", equipmentTypeDisplayName("BARBELL", "ru"))
        assertEquals("Собственный вес", equipmentTypeDisplayName("BODYWEIGHT", "ru"))
    }
}
