package org.sharteman.gymcoach.ui.programs

import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Test
import org.sharteman.gymcoach.data.model.ExerciseDto

class ExerciseTrainingDaysTest {
    @Test
    fun `counts distinct local calendar days like the web catalog`() {
        val dates = listOf(
            "2026-07-01T20:30:00Z",
            "2026-07-02T00:30:00Z",
            "2026-07-02T00:30:00Z",
        )

        assertEquals(2, exerciseTrainingDayCount(dates, ZoneId.of("UTC")))
        assertEquals(1, exerciseTrainingDayCount(dates, ZoneId.of("Asia/Yekaterinburg")))
    }

    @Test
    fun `ignores malformed timestamps`() {
        assertEquals(
            1,
            exerciseTrainingDayCount(
                listOf("not-a-date", "2026-07-02T00:30:00Z"),
                ZoneId.of("UTC"),
            ),
        )
    }

    @Test
    fun `catalog groups trained exercises before zero-day exercises stably`() {
        val exercises = listOf(
            ExerciseDto(id = "zero-a", name = "Zero A", muscleGroup = "OTHER", category = "COMPOUND"),
            ExerciseDto(
                id = "trained-a",
                name = "Trained A",
                muscleGroup = "OTHER",
                category = "COMPOUND",
                trainingDates = listOf("2026-07-01T08:00:00Z"),
            ),
            ExerciseDto(
                id = "trained-b",
                name = "Trained B",
                muscleGroup = "OTHER",
                category = "COMPOUND",
                trainingDates = listOf("2026-07-02T08:00:00Z"),
            ),
            ExerciseDto(id = "zero-b", name = "Zero B", muscleGroup = "OTHER", category = "COMPOUND"),
        )

        assertEquals(
            listOf("trained-a", "trained-b", "zero-a", "zero-b"),
            sortCatalogExercisesByTrainingDays(exercises).map { it.id },
        )
    }
}
