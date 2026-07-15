package org.sharteman.gymcoach.ui

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Test
import org.sharteman.gymcoach.data.local.LocalSetEntity
import org.sharteman.gymcoach.data.model.BootstrapResponse
import org.sharteman.gymcoach.data.model.EquipmentReturnRecommendationDto
import org.sharteman.gymcoach.data.model.ExerciseDto
import org.sharteman.gymcoach.data.model.GymDto
import org.sharteman.gymcoach.data.model.GymEquipmentDto
import org.sharteman.gymcoach.data.model.GymEquipmentExerciseDto
import org.sharteman.gymcoach.data.model.ProgramExerciseDto
import org.sharteman.gymcoach.data.model.ReturnRecommendationDto

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

    @Test
    fun `uses one equipment target for rows progress and summary`() {
        val exercise = ProgramExerciseDto(
            id = "program-exercise-1",
            workoutId = "workout-1",
            exerciseId = "pressdown",
            order = 0,
            targetSets = 4,
            targetRepsMin = 8,
            targetRepsMax = 12,
            targetRIR = 2,
            restSec = 90,
            exercise = ExerciseDto(
                id = "pressdown",
                name = "Cable pressdown",
                muscleGroup = "TRICEPS",
                category = "ISOLATION",
                equipmentType = "CABLE",
            ),
        )
        val gym = GymDto(
            id = "gym-1",
            name = "Gym",
            inventoryMode = "EQUIPMENT_FIRST",
            equipment = listOf(
                equipment("cable-a"),
                equipment("cable-b"),
            ),
        )
        val recordedSets = listOf(
            LocalSetEntity(
                id = "set-b-1",
                sessionId = "session-1",
                exerciseId = "pressdown",
                gymEquipmentId = "cable-b",
                setNumber = 1,
                weight = 60.0,
                reps = 8,
                rir = 2,
                completedAt = "2026-07-15T09:00:00.000Z",
            ),
        )
        val recommendations = listOf(
            equipmentRecommendation("cable-a", targetSets = 3, mode = "normal"),
            equipmentRecommendation("cable-b", targetSets = 2, mode = "exercise-reintro"),
        )

        val recordedEquipmentId = resolveWorkoutEquipmentId(
            exercise = exercise,
            gym = gym,
            sets = recordedSets,
            selectedEquipmentId = null,
        )
        val cableBRecommendation = selectReturnRecommendationForEquipment(
            recommendations = recommendations,
            fallback = null,
            fallbackPerformance = null,
            gymEquipmentId = recordedEquipmentId,
        )
        val cableBProgress = workoutExerciseSetProgress(
            exercises = listOf(exercise),
            sets = recordedSets,
            returnRecommendations = mapOf(exercise.id to requireNotNull(cableBRecommendation)),
        )

        val selectedEquipmentId = resolveWorkoutEquipmentId(
            exercise = exercise,
            gym = gym,
            sets = recordedSets,
            selectedEquipmentId = "cable-a",
        )
        val cableARecommendation = selectReturnRecommendationForEquipment(
            recommendations = recommendations,
            fallback = null,
            fallbackPerformance = null,
            gymEquipmentId = selectedEquipmentId,
        )
        val cableAProgress = workoutExerciseSetProgress(
            exercises = listOf(exercise),
            sets = recordedSets,
            returnRecommendations = mapOf(exercise.id to requireNotNull(cableARecommendation)),
        )

        assertEquals("cable-b", recordedEquipmentId)
        assertEquals(2, cableBProgress.single().plannedRows)
        assertEquals(2, cableBProgress.sumOf { progress -> progress.plannedRows })
        assertEquals("cable-a", selectedEquipmentId)
        assertEquals(3, cableAProgress.single().plannedRows)
        assertEquals(3, cableAProgress.sumOf { progress -> progress.plannedRows })
    }

    private fun equipment(id: String) = GymEquipmentDto(
        id = id,
        gymId = "gym-1",
        name = id,
        equipmentType = "CABLE",
        loadType = "SELECTORIZED",
        weightOptions = listOf(10.0, 20.0, 30.0),
        exerciseLinks = listOf(
            GymEquipmentExerciseDto(
                equipmentId = id,
                exerciseId = "pressdown",
            ),
        ),
    )

    private fun equipmentRecommendation(
        gymEquipmentId: String,
        targetSets: Int,
        mode: String,
    ) = EquipmentReturnRecommendationDto(
        gymEquipmentId = gymEquipmentId,
        recommendation = ReturnRecommendationDto(
            mode = mode,
            targetSets = targetSets,
            targetRIR = if (mode == "normal") 2 else 3,
        ),
    )
}
