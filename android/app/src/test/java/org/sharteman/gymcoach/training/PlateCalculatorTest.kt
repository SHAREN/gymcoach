package org.sharteman.gymcoach.training

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PlateCalculatorTest {
    @Test
    fun decomposesAnExactTargetHeaviestPlateFirst() {
        val load = computePlateLoad(
            targetWeight = 107.5,
            barWeight = 20.0,
            availablePlates = listOf(1.25, 20.0, 2.5, 10.0, 5.0),
        )

        assertEquals(
            listOf(
                PlateGroup(plate = 20.0, count = 2),
                PlateGroup(plate = 2.5, count = 1),
                PlateGroup(plate = 1.25, count = 1),
            ),
            load.perSide,
        )
        assertEquals(107.5, load.achievedWeight, 0.001)
        assertEquals(0.0, load.remainder, 0.001)
        assertTrue(load.exact)
    }

    @Test
    fun reportsUnmatchedWeightAsRemainder() {
        val load = computePlateLoad(
            targetWeight = 101.0,
            barWeight = 20.0,
            availablePlates = listOf(20.0, 10.0, 5.0, 2.5, 1.25),
        )

        assertEquals(listOf(PlateGroup(plate = 20.0, count = 2)), load.perSide)
        assertEquals(100.0, load.achievedWeight, 0.001)
        assertEquals(1.0, load.remainder, 0.001)
        assertFalse(load.exact)
    }

    @Test
    fun barOnlyTargetIsExactButSubBarTargetIsNot() {
        val barOnly = computePlateLoad(20.0, 20.0, listOf(5.0, 2.5))
        val subBar = computePlateLoad(15.0, 20.0, listOf(5.0, 2.5))

        assertTrue(barOnly.exact)
        assertEquals(20.0, barOnly.achievedWeight, 0.001)
        assertTrue(barOnly.perSide.isEmpty())
        assertFalse(subBar.exact)
        assertEquals(20.0, subBar.achievedWeight, 0.001)
        assertEquals(0.0, subBar.remainder, 0.001)
    }

    @Test
    fun bestLoadPrefersAnExactBarAndPlateCombination() {
        val load = computeBestPlateLoad(
            targetWeight = 65.0,
            availableBars = listOf(20.0, 15.0),
            availablePlates = listOf(10.0, 5.0),
            fallbackBarWeight = 20.0,
        )

        assertEquals(15.0, load.barWeight, 0.001)
        assertEquals(
            listOf(
                PlateGroup(plate = 10.0, count = 2),
                PlateGroup(plate = 5.0, count = 1),
            ),
            load.perSide,
        )
        assertTrue(load.exact)
    }

    @Test
    fun bestLoadUsesFallbackWhenAvailableBarsAreInvalid() {
        val load = computeBestPlateLoad(
            targetWeight = 60.0,
            availableBars = listOf(Double.NaN, Double.POSITIVE_INFINITY, 0.0, -10.0),
            availablePlates = listOf(20.0, 10.0, 5.0),
            fallbackBarWeight = 20.0,
        )

        assertEquals(20.0, load.barWeight, 0.001)
        assertEquals(listOf(PlateGroup(plate = 20.0, count = 1)), load.perSide)
        assertTrue(load.exact)
    }

    @Test
    fun ignoresInvalidPlateDenominations() {
        val load = computePlateLoad(
            targetWeight = 60.0,
            barWeight = 20.0,
            availablePlates = listOf(Double.NaN, Double.POSITIVE_INFINITY, -5.0, 0.0, 20.0),
        )

        assertEquals(listOf(PlateGroup(plate = 20.0, count = 1)), load.perSide)
        assertTrue(load.exact)
    }

    @Test
    fun concreteSmallBarUsesItsBaseLoadQuantitiesAndLoadingSides() {
        val load = computeEquipmentPlateLoad(
            targetWeight = 40.0,
            baseLoad = 10.0,
            availablePlates = listOf(
                PlateInventoryItem(weightKg = 10.0, quantity = 2),
                PlateInventoryItem(weightKg = 5.0, quantity = 4),
            ),
            loadingSides = 2,
        )

        assertEquals(10.0, load.barWeight, 0.001)
        assertEquals(2, load.loadingSides)
        assertEquals(40.0, load.achievedWeight, 0.001)
        assertEquals(
            listOf(
                PlateGroup(plate = 10.0, count = 1),
                PlateGroup(plate = 5.0, count = 1),
            ),
            load.perSide,
        )
        assertTrue(load.exact)

        val finiteInventory = computeEquipmentPlateLoad(
            targetWeight = 50.0,
            baseLoad = 10.0,
            availablePlates = listOf(PlateInventoryItem(weightKg = 10.0, quantity = 2)),
            loadingSides = 2,
        )
        assertEquals(30.0, finiteInventory.achievedWeight, 0.001)
        assertEquals(20.0, finiteInventory.remainder, 0.001)
        assertFalse(finiteInventory.exact)
    }
}
