package org.sharteman.gymcoach.ui.settings

import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class SettingsUiModelsTest {
    @Test
    fun `parses and normalizes equipment weights`() {
        assertEquals(listOf(1.25, 2.5, 20.0), parseWeightList("20; 2.5 1.25 2.50"))
        assertEquals(emptyList<Double>(), parseWeightList(""))
        assertNull(parseWeightList("20 broken"))
        assertNull(parseWeightList("0"))
    }

    @Test
    fun `validates native profile ranges`() {
        assertNotNull(
            ProfileDraft(
                displayName = "Renat",
                bodyweight = "82.5",
                heightCm = "180",
                weeklyFrequency = "4",
                unit = "KG",
            ).toInputOrNull(),
        )
        assertNull(ProfileDraft(bodyweight = "10").toInputOrNull())
        assertNull(ProfileDraft(heightCm = "300").toInputOrNull())
        assertNull(ProfileDraft(weeklyFrequency = "0").toInputOrNull())
    }

    @Test
    fun `validates and normalizes physical equipment`() {
        val input = GymEquipmentDraft(
            name = " Cable station ",
            equipmentType = "CABLE",
            quantity = "2",
            weightOptions = "20; 10; 20",
            exerciseIds = setOf("exercise-2", "exercise-1"),
        ).toInputOrNull()

        assertNotNull(input)
        assertEquals("Cable station", input?.name)
        assertEquals(listOf(10.0, 20.0), input?.weightOptions)
        assertEquals(listOf("exercise-1", "exercise-2"), input?.exerciseIds)
        assertNull(GymEquipmentDraft(name = "Machine", quantity = "0").toInputOrNull())
        assertNull(GymEquipmentDraft(name = "Machine", equipmentType = "INVALID").toInputOrNull())
    }

    @Test
    fun `accepts only https equipment image URLs`() {
        assertEquals(
            "https://images.example.test/machine.jpg",
            validEquipmentImageUrl(" https://images.example.test/machine.jpg "),
        )
        assertNull(validEquipmentImageUrl("http://images.example.test/machine.jpg"))
        assertNull(validEquipmentImageUrl("not a url"))
    }

    @Test
    fun `extracts import preview counts without language specific labels`() {
        val summary = importResultSummary(
            buildJsonObject {
                put("sessions", 2)
                put("sets", 12)
                putJsonArray("newExercises") {
                    add(kotlinx.serialization.json.JsonPrimitive("Row"))
                    add(kotlinx.serialization.json.JsonPrimitive("Bike"))
                }
            },
        )
        assertEquals(ImportResultSummary(sessions = 2, sets = 12, exercises = 2), summary)
    }
}
