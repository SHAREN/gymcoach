package org.sharteman.gymcoach.training

import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Test

class SetTableMetricTest {
    @Test
    fun `matches web calculations for one rm ten rm and volume`() {
        assertEquals(133.333333, calculateSetTableMetric(SetTableMetric.ONE_RM, 100.0, 10), 0.000001)
        assertEquals(100.0, calculateSetTableMetric(SetTableMetric.TEN_RM, 100.0, 10), 0.000001)
        assertEquals(1000.0, calculateSetTableMetric(SetTableMetric.VOLUME, 100.0, 10), 0.000001)
    }

    @Test
    fun `formats in the selected display unit with one decimal`() {
        assertEquals("133.3", formatSetTableMetric(SetTableMetric.ONE_RM, 100.0, 10, "KG", Locale.US))
        assertEquals("293.9", formatSetTableMetric(SetTableMetric.ONE_RM, 100.0, 10, "LB", Locale.US))
        assertEquals("2204.6", formatSetTableMetric(SetTableMetric.VOLUME, 100.0, 10, "LB", Locale.US))
        assertEquals("100", formatSetTableMetric(SetTableMetric.TEN_RM, 100.0, 10, "KG", Locale.US))
        assertEquals("1000", formatSetTableMetric(SetTableMetric.VOLUME, 100.0, 10, "KG", Locale.US))
    }

    @Test
    fun `uses locale decimal separator and dash for invalid values`() {
        assertEquals("133,3", formatSetTableMetric(SetTableMetric.ONE_RM, 100.0, 10, "KG", Locale.GERMANY))
        assertEquals("–", formatSetTableMetric(SetTableMetric.ONE_RM, 0.0, 10, "KG", Locale.US))
        assertEquals("–", formatSetTableMetric(SetTableMetric.VOLUME, 100.0, 0, "KG", Locale.US))
    }

    @Test
    fun `stored preference falls back to one rm`() {
        assertEquals(SetTableMetric.TEN_RM, SetTableMetric.fromStoredValue("TEN_RM"))
        assertEquals(SetTableMetric.ONE_RM, SetTableMetric.fromStoredValue("unknown"))
        assertEquals(SetTableMetric.ONE_RM, SetTableMetric.fromStoredValue(null))
    }

    @Test
    fun `normalizes selections using the same constraints as web`() {
        assertEquals(
            listOf(SetTableMetric.ONE_RM),
            normalizeSetTableMetrics(emptyList()),
        )
        assertEquals(
            listOf(SetTableMetric.TEN_RM),
            normalizeSetTableMetrics(emptyList(), fallbackRm = SetTableMetric.TEN_RM),
        )
        assertEquals(
            listOf(SetTableMetric.TEN_RM, SetTableMetric.VOLUME),
            normalizeSetTableMetrics(SetTableMetric.entries),
        )
        assertEquals(
            listOf(SetTableMetric.VOLUME),
            normalizeSetTableMetrics(listOf(SetTableMetric.VOLUME, SetTableMetric.VOLUME)),
        )
    }

    @Test
    fun `keeps rep max metrics mutually exclusive while preserving volume`() {
        var selected = listOf(SetTableMetric.ONE_RM)

        selected = setTableMetricEnabled(selected, SetTableMetric.VOLUME, enabled = true)
        assertEquals(listOf(SetTableMetric.ONE_RM, SetTableMetric.VOLUME), selected)

        selected = setTableMetricEnabled(selected, SetTableMetric.TEN_RM, enabled = true)
        assertEquals(listOf(SetTableMetric.TEN_RM, SetTableMetric.VOLUME), selected)

        selected = setTableMetricEnabled(selected, SetTableMetric.ONE_RM, enabled = true)
        assertEquals(listOf(SetTableMetric.ONE_RM, SetTableMetric.VOLUME), selected)
    }

    @Test
    fun `always keeps at least one metric and never more than two`() {
        assertEquals(
            listOf(SetTableMetric.ONE_RM),
            setTableMetricEnabled(listOf(SetTableMetric.ONE_RM), SetTableMetric.ONE_RM, enabled = false),
        )
        assertEquals(
            listOf(SetTableMetric.VOLUME),
            setTableMetricEnabled(
                listOf(SetTableMetric.ONE_RM, SetTableMetric.VOLUME),
                SetTableMetric.ONE_RM,
                enabled = false,
            ),
        )
        assertEquals(
            listOf(SetTableMetric.TEN_RM),
            setTableMetricEnabled(
                listOf(SetTableMetric.TEN_RM, SetTableMetric.VOLUME),
                SetTableMetric.VOLUME,
                enabled = false,
            ),
        )
        assertEquals(
            listOf(SetTableMetric.TEN_RM, SetTableMetric.VOLUME),
            setTableMetricEnabled(SetTableMetric.entries, SetTableMetric.VOLUME, enabled = true),
        )
    }
}
