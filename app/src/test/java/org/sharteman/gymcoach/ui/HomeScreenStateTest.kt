package org.sharteman.gymcoach.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class HomeScreenStateTest {
    @Test
    fun replacedGymListNeverKeepsAStaleSelection() {
        assertEquals("gym_a", initialGymSelection("gym_a", listOf("gym_a", "gym_b")))
        assertEquals("gym_c", initialGymSelection("gym_a", listOf("gym_c", "gym_d")))
        assertEquals(null, initialGymSelection("gym_a", emptyList()))
    }
}
