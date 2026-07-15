package org.sharteman.gymcoach.ui

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Test
import org.sharteman.gymcoach.data.model.BootstrapResponse

class WorkoutEquipmentHistoryTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `selects older equipment B history and recommendation when A is latest`() {
        val bootstrap = json.decodeFromString<BootstrapResponse>(
            """
            {
              "schemaVersion": 4,
              "calculationVersion": "2026-07-15-equipment-v1",
              "serverTime": "2026-07-15T10:00:00.000Z",
              "profile": {
                "id": "user-1",
                "email": "user@example.com"
              },
              "lastPerformances": {
                "pressdown": {
                  "exerciseId": "pressdown",
                  "sessionId": "session-a-latest",
                  "sessionStartedAt": "2026-07-14T10:00:00.000Z",
                  "gymEquipmentId": "cable-a",
                  "sets": [{"weight": 30.0, "reps": 10}],
                  "maxWeight": 30.0,
                  "repsAtMaxWeight": 10
                }
              },
              "lastPerformancesByEquipment": {
                "pressdown": [
                  {
                    "exerciseId": "pressdown",
                    "sessionId": "session-a-latest",
                    "sessionStartedAt": "2026-07-14T10:00:00.000Z",
                    "gymEquipmentId": "cable-a",
                    "sets": [{"weight": 30.0, "reps": 10}],
                    "maxWeight": 30.0,
                    "repsAtMaxWeight": 10
                  },
                  {
                    "exerciseId": "pressdown",
                    "sessionId": "session-b-older",
                    "sessionStartedAt": "2026-06-20T10:00:00.000Z",
                    "gymEquipmentId": "cable-b",
                    "sets": [{"weight": 60.0, "reps": 8}],
                    "maxWeight": 60.0,
                    "repsAtMaxWeight": 8
                  }
                ]
              },
              "returnRecommendationsByWorkout": {
                "workout-1": {
                  "program-exercise-1": {
                    "mode": "normal",
                    "targetSets": 3,
                    "targetRIR": 2,
                    "suggestedWeight": 30.0
                  }
                }
              },
              "returnRecommendationsByEquipmentByWorkout": {
                "workout-1": {
                  "program-exercise-1": [
                    {
                      "gymEquipmentId": "cable-a",
                      "recommendation": {
                        "mode": "normal",
                        "targetSets": 3,
                        "targetRIR": 2,
                        "suggestedWeight": 30.0
                      }
                    },
                    {
                      "gymEquipmentId": "cable-b",
                      "recommendation": {
                        "mode": "exercise-reintro",
                        "targetSets": 2,
                        "targetRIR": 3,
                        "suggestedWeight": 50.0
                      }
                    }
                  ]
                }
              }
            }
            """.trimIndent(),
        )

        val selectedPerformance = selectLastPerformanceForEquipment(
            performances = bootstrap.lastPerformancesByEquipment["pressdown"],
            fallback = bootstrap.lastPerformances["pressdown"],
            gymEquipmentId = "cable-b",
        )
        val selectedRecommendation = selectReturnRecommendationForEquipment(
            recommendations = bootstrap.returnRecommendationsByEquipmentByWorkout["workout-1"]
                ?.get("program-exercise-1"),
            fallback = bootstrap.returnRecommendationsByWorkout["workout-1"]
                ?.get("program-exercise-1"),
            fallbackPerformance = bootstrap.lastPerformances["pressdown"],
            gymEquipmentId = "cable-b",
        )

        assertEquals("session-b-older", selectedPerformance?.sessionId)
        assertEquals(60.0, selectedPerformance?.maxWeight ?: 0.0, 0.001)
        assertEquals("exercise-reintro", selectedRecommendation?.mode)
        assertEquals(50.0, selectedRecommendation?.suggestedWeight ?: 0.0, 0.001)
    }
}
