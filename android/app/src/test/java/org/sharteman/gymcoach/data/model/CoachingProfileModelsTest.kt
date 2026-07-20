package org.sharteman.gymcoach.data.model

import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.sharteman.gymcoach.data.settings.SettingsProfileDto

class CoachingProfileModelsTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `decodes additive structured coaching profile from bootstrap`() {
        val profile = json.decodeFromString<ProfileDto>(
            """
            {
              "id":"user-1",
              "email":"user@example.com",
              "coachingProfile":{
                "version":1,
                "updatedAt":"2026-07-18T10:00:00.000Z",
                "healthStatus":{"state":"KNOWN","value":"TRAIN_WITH_LIMITATIONS","updatedAt":"2026-07-18T10:00:00.000Z"},
                "trainingLevel":{"state":"KNOWN","value":"INTERMEDIATE","updatedAt":"2026-07-18T10:00:00.000Z"},
                "availableWeekdays":{"state":"KNOWN","value":[1,3,5],"updatedAt":"2026-07-18T10:00:00.000Z"},
                "limitations":{"state":"KNOWN","value":{"entries":[{"kind":"PAIN","label":"Pressing constraint","affectedExerciseNames":["Bench press"]}]},"updatedAt":"2026-07-18T10:00:00.000Z"},
                "maximumSessionDurationMin":{"state":"KNOWN","value":75,"updatedAt":"2026-07-18T10:00:00.000Z"},
                "priorityMuscles":{"state":"KNOWN","value":["BACK_WIDTH"],"updatedAt":"2026-07-18T10:00:00.000Z"},
                "outsideActivities":{"state":"KNOWN","value":[{"type":"CARDIO","name":"Cycling","minutesPerWeek":90}],"updatedAt":"2026-07-18T10:00:00.000Z"},
                "averageSleepHours":{"state":"KNOWN","value":7.5,"updatedAt":"2026-07-18T10:00:00.000Z"},
                "baselineStress":{"state":"KNOWN","value":3,"updatedAt":"2026-07-18T10:00:00.000Z"},
                "generalRecovery":{"state":"KNOWN","value":4,"updatedAt":"2026-07-18T10:00:00.000Z"}
              }
            }
            """.trimIndent(),
        )

        assertEquals("TRAIN_WITH_LIMITATIONS", profile.coachingProfile?.healthStatus?.value)
        assertEquals(listOf(1, 3, 5), profile.coachingProfile?.availableWeekdays?.value)
        assertEquals("Bench press", profile.coachingProfile?.limitations?.value?.entries?.single()?.affectedExerciseNames?.single())
        assertEquals(7.5, profile.coachingProfile?.averageSleepHours?.value)
    }

    @Test
    fun `keeps cached legacy bootstrap compatible when coaching profile is absent`() {
        val profile = json.decodeFromString<ProfileDto>(
            """{"id":"legacy","email":"legacy@example.com","displayName":"Legacy"}""",
        )

        assertEquals("Legacy", profile.displayName)
        assertNull(profile.coachingProfile)
    }

    @Test
    fun `decodes the same additive contract from the authenticated profile API`() {
        val profile = json.decodeFromString<SettingsProfileDto>(
            """
            {
              "email":"settings@example.com",
              "unit":"KG",
              "coachingProfile":{
                "version":1,
                "healthStatus":{"state":"KNOWN","value":"NO_SIGNIFICANT_ISSUES","updatedAt":"2026-07-18T10:00:00.000Z"}
              }
            }
            """.trimIndent(),
        )

        assertEquals("NO_SIGNIFICANT_ISSUES", profile.coachingProfile?.healthStatus?.value)
    }
}
