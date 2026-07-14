package org.sharteman.gymcoach.training

import org.junit.Assert.assertEquals
import org.junit.Test

class WeightUnitsTest {
    @Test
    fun `kilograms pass through unchanged`() {
        assertEquals(82.5, toDisplayWeight(82.5, "KG"), 0.0)
        assertEquals(82.5, fromDisplayWeight(82.5, "KG"), 0.0)
    }

    @Test
    fun `pounds round trip back to stored kilograms`() {
        val pounds = toDisplayWeight(100.0, "LB")

        assertEquals(220.462, pounds, 0.001)
        assertEquals(100.0, fromDisplayWeight(pounds, "LB"), 0.000_001)
    }

    @Test
    fun `round weight removes conversion noise`() {
        assertEquals(220.5, roundWeight(toDisplayWeight(100.0, "LB"), 1), 0.0)
    }
}
