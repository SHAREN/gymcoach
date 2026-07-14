package org.sharteman.gymcoach.data.model

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class HistoryProgressModelsTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `progress schema three decodes dashboard additions without breaking base chart`() {
        val snapshot = json.decodeFromString<MobileProgressSnapshot>(
            """
            {
              "schemaVersion": 3,
              "generatedAt": "2026-07-14T10:00:00.000Z",
              "unit": "KG",
              "exercises": [{
                "id": "bench",
                "name": "Bench Press",
                "muscleGroup": "CHEST",
                "points": [],
                "bestEstimated1RM": 120,
                "loadingTable": [{"percent": 80, "weight": 95}],
                "recap": {"sessions": 3, "stalled": true}
              }],
              "records": [{
                "exerciseName": "Bench Press",
                "maxWeight": 100,
                "maxWeightReps": 5,
                "maxWeightDate": "2026-07-01",
                "bestEstimated1RM": 120,
                "bestEstimated1RMDate": "2026-07-08"
              }],
              "deload": {"recommended": true, "stalledExerciseNames": ["Bench Press"]}
            }
            """.trimIndent(),
        )

        assertEquals(120.0, snapshot.exercises.single().bestEstimated1RM, 0.0)
        assertTrue(snapshot.exercises.single().recap.stalled)
        assertEquals(80, snapshot.exercises.single().loadingTable.single().percent)
        assertTrue(snapshot.deload.recommended)
        assertEquals("Bench Press", snapshot.records.single().exerciseName)
    }

    @Test
    fun `history snapshot preserves strength and cardio set fields`() {
        val snapshot = json.decodeFromString<MobileHistorySnapshot>(
            """
            {
              "schemaVersion": 1,
              "generatedAt": "2026-07-14T10:00:00.000Z",
              "month": "2026-07",
              "sessions": [{
                "id": "session",
                "startedAt": "2026-07-10T10:00:00.000Z",
                "finishedAt": "2026-07-10T11:00:00.000Z",
                "durationMin": 60,
                "workingSets": 2,
                "volume": 480,
                "exercises": [{
                  "id": "pullup",
                  "name": "Pull-up",
                  "muscleGroup": "BACK_WIDTH",
                  "category": "COMPOUND",
                  "volume": 480,
                  "estimated1RM": 96,
                  "sets": [{
                    "id": "set",
                    "setNumber": 1,
                    "weight": 10,
                    "effectiveWeight": 80,
                    "reps": 6,
                    "rir": 2,
                    "completedAt": "2026-07-10T10:10:00.000Z"
                  }]
                }]
              }]
            }
            """.trimIndent(),
        )

        val set = snapshot.sessions.single().exercises.single().sets.single()
        assertEquals(80.0, set.effectiveWeight, 0.0)
        assertEquals(2, set.rir)
    }
}
