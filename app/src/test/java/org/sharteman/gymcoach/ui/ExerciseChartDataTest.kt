package org.sharteman.gymcoach.ui

import org.junit.Assert.assertEquals
import org.junit.Test
import org.sharteman.gymcoach.data.model.ExerciseHistorySessionDto
import org.sharteman.gymcoach.data.model.ExerciseHistorySetDto
import org.sharteman.gymcoach.data.model.MobileProgressPointDto

class ExerciseChartDataTest {
    @Test
    fun mergesNewLocalHistoryWithCachedProgressAndDeduplicatesByInstant() {
        val progress = MobileProgressPointDto(
            sessionStartedAt = "2026-07-10T08:00:00Z",
            maxWeight = 80.0,
            estimated1RM = 100.0,
            totalVolume = 800.0,
            topSetReps = 10,
            maxReps = 10,
            totalReps = 10,
        )
        val history = listOf(
            ExerciseHistorySessionDto(
                sessionId = "same",
                startedAt = "2026-07-10T08:00:00.000Z",
                sets = listOf(ExerciseHistorySetDto(1, 82.5, 8)),
            ),
            ExerciseHistorySessionDto(
                sessionId = "local",
                startedAt = "2026-07-15T08:00:00Z",
                sets = listOf(ExerciseHistorySetDto(1, 85.0, 6)),
            ),
        )

        val points = buildExerciseChartPoints(history, listOf(progress), "KG", false, null)

        assertEquals(2, points.size)
        assertEquals(82.5, points[0].value, 0.0)
        assertEquals(85.0, points[1].value, 0.0)
    }

    @Test
    fun appliesConfiguredBodyweightToLocalHistory() {
        val history = listOf(
            ExerciseHistorySessionDto(
                sessionId = "pullup",
                startedAt = "2026-07-15T08:00:00Z",
                sets = listOf(ExerciseHistorySetDto(1, 10.0, 6)),
            ),
        )

        val points = buildExerciseChartPoints(history, emptyList(), "KG", true, 75.0)

        assertEquals(85.0, points.single().value, 0.0)
    }
}
