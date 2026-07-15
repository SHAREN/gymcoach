package org.sharteman.gymcoach.ui

import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.Locale

class HistoryFormattingTest {
    @Test
    fun formatsDurationsWithHoursWhenNeeded() {
        assertEquals("30:00", formatHistoryDuration(1_800))
        assertEquals("1:05:07", formatHistoryDuration(3_907))
    }

    @Test
    fun formatsLocalizedDistanceUnits() {
        val previousLocale = Locale.getDefault()
        try {
            Locale.setDefault(Locale.US)
            assertEquals("5.00 км", formatHistoryDistance(5_000.0, "км", "м"))
            assertEquals("750 м", formatHistoryDistance(750.0, "км", "м"))
        } finally {
            Locale.setDefault(previousLocale)
        }
    }
}
