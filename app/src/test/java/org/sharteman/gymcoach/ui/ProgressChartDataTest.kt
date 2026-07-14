package org.sharteman.gymcoach.ui

import org.junit.Assert.assertEquals
import org.junit.Test
import org.sharteman.gymcoach.data.model.MobileProgressPointDto
import java.time.Instant

class ProgressChartDataTest {
    @Test
    fun `filters by range and maps selected metric`() {
        val now = Instant.parse("2026-07-13T12:00:00Z").toEpochMilli()
        val points = listOf(point("2026-05-01T12:00:00Z", 80.0), point("2026-07-10T12:00:00Z", 90.0))

        val result = buildProgressChartPoints(points, ProgressMetric.MAX_WEIGHT, ProgressRange.ONE_MONTH, now)

        assertEquals(1, result.size)
        assertEquals(90.0, result.single().value, 0.0)
    }

    @Test
    fun `compresses a long layoff to three ordinary gaps`() {
        val points = listOf(
            point("2026-01-01T12:00:00Z", 80.0),
            point("2026-01-08T12:00:00Z", 82.5),
            point("2026-04-08T12:00:00Z", 85.0),
        )

        val result = buildProgressChartPoints(points, ProgressMetric.MAX_WEIGHT, ProgressRange.ALL)

        assertEquals(0.0, result[0].chartX, 0.0)
        assertEquals(1.0, result[1].chartX, 0.001)
        assertEquals(4.0, result[2].chartX, 0.001)
    }

    private fun point(date: String, maxWeight: Double) = MobileProgressPointDto(
        sessionStartedAt = date,
        maxWeight = maxWeight,
        estimated1RM = maxWeight + 10,
        totalVolume = maxWeight * 30,
        topSetReps = 10,
        maxReps = 12,
        totalReps = 30,
    )
}
