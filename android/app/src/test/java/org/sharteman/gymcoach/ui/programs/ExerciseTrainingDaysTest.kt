package org.sharteman.gymcoach.ui.programs

import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Test

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
}
