package org.sharteman.gymcoach.ui

import org.junit.Assert.assertEquals
import org.junit.Test
import org.sharteman.gymcoach.data.model.MobileHistorySessionDto
import java.time.LocalDate
import java.time.ZoneId
import java.util.Locale

class HistoryCalendarDataTest {
    @Test
    fun `russian month grid starts on Monday and has six complete weeks`() {
        val grid = buildNativeHistoryMonthGrid("2026-07", Locale("ru"))

        assertEquals(42, grid.size)
        assertEquals(LocalDate.of(2026, 6, 29), grid.first().date)
        assertEquals(false, grid.first().inMonth)
        assertEquals(LocalDate.of(2026, 7, 1), grid[2].date)
        assertEquals(true, grid[2].inMonth)
    }

    @Test
    fun `sessions are grouped in device timezone and default to latest day for old month`() {
        val sessions = listOf(
            session("one", "2026-07-01T22:30:00.000Z"),
            session("two", "2026-07-15T10:00:00.000Z"),
        )
        val zone = ZoneId.of("Asia/Yekaterinburg")

        val grouped = nativeHistorySessionsByDay(sessions, "2026-07", zone)

        assertEquals(listOf("one"), grouped.getValue("2026-07-02").map { it.id })
        assertEquals(
            "2026-07-15",
            defaultNativeHistoryDay("2026-07", grouped, LocalDate.of(2026, 8, 1)),
        )
    }

    private fun session(id: String, startedAt: String) = MobileHistorySessionDto(
        id = id,
        startedAt = startedAt,
        finishedAt = startedAt,
        durationMin = 0,
        workingSets = 0,
        volume = 0.0,
    )
}
