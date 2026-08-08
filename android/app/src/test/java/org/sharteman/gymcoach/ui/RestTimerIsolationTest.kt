package org.sharteman.gymcoach.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class RestTimerIsolationTest {
    @Test
    fun `remaining seconds are derived inside timer content`() {
        assertEquals(10, restSecondsRemaining(restEndsAtEpochMs = 10_000L, nowEpochMs = 1L))
        assertEquals(1, restSecondsRemaining(restEndsAtEpochMs = 10_000L, nowEpochMs = 9_999L))
        assertEquals(0, restSecondsRemaining(restEndsAtEpochMs = 10_000L, nowEpochMs = 10_000L))
    }
}
