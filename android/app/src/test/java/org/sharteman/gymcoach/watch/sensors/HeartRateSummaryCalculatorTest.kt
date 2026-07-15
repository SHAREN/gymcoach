package org.sharteman.gymcoach.watch.sensors

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class HeartRateSummaryCalculatorTest {
    @Test
    fun `rest summary filters invalid values and picks earlier sample on nearest tie`() {
        val summary = HeartRateSummaryCalculator.restSummary(
            samples = listOf(
                sample("start", 1_000L, 150.0),
                sample("zero", 2_000L, 0.0),
                sample("off-wrist", 3_000L, null, valid = false),
                sample("before-30", 30_000L, 140.0),
                sample("after-30", 32_000L, 130.0),
                sample("at-60", 61_000L, 120.0),
                sample("outside", 62_000L, 90.0),
                sample("accelerometer", 20_000L, 999.0, sensorType = "ACCELEROMETER"),
            ),
            startedAtEpochMs = 1_000L,
            finishedAtEpochMs = 61_000L,
        )

        assertEquals(150.0, summary.start ?: Double.NaN, 0.0)
        assertEquals(120.0, summary.min ?: Double.NaN, 0.0)
        assertEquals(135.0, summary.average ?: Double.NaN, 0.0)
        assertEquals(140.0, summary.at30Seconds ?: Double.NaN, 0.0)
        assertEquals(120.0, summary.at60Seconds ?: Double.NaN, 0.0)
        assertEquals(10.0, summary.drop30Seconds ?: Double.NaN, 0.0)
        assertEquals(30.0, summary.drop60Seconds ?: Double.NaN, 0.0)
        assertEquals(4, summary.sampleCount)
    }

    @Test
    fun `set summary never converts invalid heart rate to zero`() {
        val summary = HeartRateSummaryCalculator.setSummary(
            samples = listOf(
                sample("invalid-null", 1_000L, null, valid = false),
                sample("invalid-zero", 2_000L, 0.0),
            ),
            startedAtEpochMs = 1_000L,
            finishedAtEpochMs = 2_000L,
        )

        assertNull(summary.start)
        assertNull(summary.end)
        assertNull(summary.min)
        assertNull(summary.max)
        assertNull(summary.average)
        assertEquals(0, summary.sampleCount)
    }

    private fun sample(
        id: String,
        timestamp: Long,
        value: Double?,
        valid: Boolean = true,
        sensorType: String = "HEART_RATE",
    ) = HeartRateObservation(
        sampleId = id,
        timestampEpochMs = timestamp,
        sensorType = sensorType,
        value = value,
        valid = valid,
    )
}
