package org.sharteman.gymcoach.ui

import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.sharteman.gymcoach.data.model.MobileBodyMeasurementDto
import org.sharteman.gymcoach.data.model.MobileBodyweightEntryDto
import org.sharteman.gymcoach.data.model.MobileConditioningWeekDto
import org.sharteman.gymcoach.data.model.MobileProgressSnapshot
import org.sharteman.gymcoach.data.model.MobileWeeklyVolumeDto

class ProgressOverviewDataTest {
    @Test
    fun `converts volume bodyweight and measurements for imperial display`() {
        assertEquals(2_204.622_621_848_775_7, displayWeeklyVolume(1_000.0, "LB"), 0.000_001)
        assertEquals(176.369_809_747_902_08, displayBodyweight(80.0, "lb"), 0.000_001)
        assertEquals(70.866_141_732_283_47, displayMeasurement(180.0, "LB"), 0.000_001)
        assertEquals("in", measurementUnit("LB"))
    }

    @Test
    fun `keeps metric display values and units unchanged`() {
        assertEquals(1_000.0, displayWeeklyVolume(1_000.0, "KG"), 0.0)
        assertEquals(80.0, displayBodyweight(80.0, "KG"), 0.0)
        assertEquals(180.0, displayMeasurement(180.0, "KG"), 0.0)
        assertEquals("cm", measurementUnit("KG"))
    }

    @Test
    fun `lists measurement sites and selects one site oldest first`() {
        val measurements = listOf(
            measurement("m3", "WAIST", 84.0, "2026-07-13T08:00:00Z"),
            measurement("m1", "CHEST", 102.0, "2026-06-01T08:00:00Z"),
            measurement("m2", "waist", 85.0, "2026-06-15T08:00:00Z"),
        )

        assertEquals(listOf("CHEST", "WAIST"), measurementSites(measurements))
        assertEquals(listOf("m2", "m3"), measurementsForSite(measurements, "WAIST").map { it.id })
    }

    @Test
    fun `sorts overview series oldest first`() {
        val weekly = listOf(
            weeklyVolume("2026-W28", "2026-07-06T00:00:00Z"),
            weeklyVolume("2026-W27", "2026-06-29T00:00:00Z"),
        )
        val bodyweight = listOf(
            MobileBodyweightEntryDto("b2", 80.0, "2026-07-13T08:00:00Z"),
            MobileBodyweightEntryDto("b1", 81.0, "2026-06-13T08:00:00Z"),
        )
        val conditioning = listOf(
            conditioning("2026-W28", "2026-07-06T00:00:00Z"),
            conditioning("2026-W27", "2026-06-29T00:00:00Z"),
        )

        assertEquals(listOf("2026-W27", "2026-W28"), oldestFirstWeeklyVolume(weekly).map { it.weekKey })
        assertEquals(listOf("b1", "b2"), oldestFirstBodyweight(bodyweight).map { it.id })
        assertEquals(
            listOf("2026-W27", "2026-W28"),
            oldestFirstConditioning(conditioning).map { it.weekKey },
        )
    }

    @Test
    fun `decodes schema version one snapshot without overview fields`() {
        val snapshot = Json.decodeFromString<MobileProgressSnapshot>(
            """
            {
              "schemaVersion": 1,
              "generatedAt": "2026-07-13T12:00:00Z",
              "exercises": []
            }
            """.trimIndent(),
        )

        assertEquals(1, snapshot.schemaVersion)
        assertEquals(emptyList<Any>(), snapshot.exercises)
        assertNull(snapshot.weeklyVolume)
        assertNull(snapshot.consistency)
        assertNull(snapshot.bodyweightEntries)
        assertNull(snapshot.bodyMeasurements)
        assertNull(snapshot.conditioningWeeks)
    }

    @Test
    fun `decodes schema version two overview payload`() {
        val snapshot = Json.decodeFromString<MobileProgressSnapshot>(
            """
            {
              "schemaVersion": 2,
              "generatedAt": "2026-07-13T12:00:00Z",
              "exercises": [],
              "weeklyVolume": [{
                "weekKey": "2026-W28",
                "weekStartIso": "2026-07-06T00:00:00Z",
                "byMuscleGroup": {"CHEST": 3200.5},
                "total": 3200.5
              }],
              "consistency": {
                "weeks": [{
                  "weekKey": "2026-W28",
                  "weekStartIso": "2026-07-06T00:00:00Z",
                  "trainedDays": 3,
                  "onStreak": true,
                  "isCurrent": true
                }],
                "currentStreak": 4,
                "weeklyFrequency": 3
              },
              "bodyweightEntries": [{
                "id": "bw-1",
                "weightKg": 80.5,
                "measuredAt": "2026-07-13T08:00:00Z"
              }],
              "bodyMeasurements": [{
                "id": "bm-1",
                "site": "WAIST",
                "valueCm": 84.5,
                "measuredAt": "2026-07-13T08:00:00Z"
              }],
              "conditioningWeeks": [{
                "weekKey": "2026-W28",
                "weekStartIso": "2026-07-06T00:00:00Z",
                "minutes": 90,
                "distanceKm": 12.4,
                "sessions": 2
              }]
            }
            """.trimIndent(),
        )

        assertEquals(3_200.5, snapshot.weeklyVolume?.single()?.total ?: 0.0, 0.0)
        assertEquals(4, snapshot.consistency?.currentStreak)
        assertEquals(80.5, snapshot.bodyweightEntries?.single()?.weightKg ?: 0.0, 0.0)
        assertEquals("WAIST", snapshot.bodyMeasurements?.single()?.site)
        assertEquals(90, snapshot.conditioningWeeks?.single()?.minutes)
    }

    private fun measurement(
        id: String,
        site: String,
        valueCm: Double,
        measuredAt: String,
    ) = MobileBodyMeasurementDto(id, site, valueCm, measuredAt)

    private fun weeklyVolume(weekKey: String, weekStartIso: String) = MobileWeeklyVolumeDto(
        weekKey = weekKey,
        weekStartIso = weekStartIso,
        byMuscleGroup = mapOf("CHEST" to 1_000.0),
        total = 1_000.0,
    )

    private fun conditioning(weekKey: String, weekStartIso: String) = MobileConditioningWeekDto(
        weekKey = weekKey,
        weekStartIso = weekStartIso,
        minutes = 60,
        distanceKm = 10.0,
        sessions = 2,
    )
}
