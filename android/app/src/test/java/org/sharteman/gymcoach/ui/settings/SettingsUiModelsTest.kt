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
