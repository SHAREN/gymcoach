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
import org.sharteman.gymcoach.data.model.GymExerciseConfigDto
import org.sharteman.gymcoach.data.model.LastPerformanceDto
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
              "calculationVersion": "2026-07-16-return-history-v2",
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
                  "gymId": "gym-1",
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
                    "gymId": "gym-1",
                    "gymEquipmentId": "cable-a",
                    "sets": [{"weight": 30.0, "reps": 10}],
                    "maxWeight": 30.0,
                    "repsAtMaxWeight": 10
                  },
                  {
                    "exerciseId": "pressdown",
                    "sessionId": "session-b-older",
                    "sessionStartedAt": "2026-06-20T10:00:00.000Z",
                    "gymId": "gym-1",
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
                      "gymId": "gym-1",
                      "gymEquipmentId": "cable-a",
                      "recommendation": {
                        "mode": "normal",
                        "targetSets": 3,
                        "targetRIR": 2,
                        "suggestedWeight": 30.0
                      }
                    },
                    {
                      "gymId": "gym-1",
                      "gymEquipmentId": "cable-b",
                      "recommendation": {
                        "mode": "exercise-reintro",
                        "exerciseGapDays": 3,
                        "returnGapDays": 87,
                        "targetSets": 2,
                        "targetRIR": 3,
                        "suggestedWeight": 50.0,
                        "weightCeiling": 60.0,
                        "startFraction": 0.8,
                        "calibrationRequired": true,
                        "historySessionCount": 4,
                        "recentHistorySessionCount": 1,
                        "longTermHistorySessionCount": 3,
                        "nonComparableHistorySessionCount": 2,
                        "historyBasis": "recent-and-long-term",
                        "confidence": "medium"
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
            gymId = "gym-1",
            gymEquipmentId = "cable-b",
        )
        val selectedRecommendation = selectReturnRecommendationForEquipment(
            recommendations = bootstrap.returnRecommendationsByEquipmentByWorkout["workout-1"]
                ?.get("program-exercise-1"),
            fallback = bootstrap.returnRecommendationsByWorkout["workout-1"]
                ?.get("program-exercise-1"),
            fallbackPerformance = bootstrap.lastPerformances["pressdown"],
            fallbackGymId = "gym-1",
            gymId = "gym-1",
            gymEquipmentId = "cable-b",
        )

        assertEquals("session-b-older", selectedPerformance?.sessionId)
        assertEquals(60.0, selectedPerformance?.maxWeight ?: 0.0, 0.001)
        assertEquals("exercise-reintro", selectedRecommendation?.mode)
        assertEquals(50.0, selectedRecommendation?.suggestedWeight ?: 0.0, 0.001)
        assertEquals(87, selectedRecommendation?.returnGapDays)
        assertEquals("recent-and-long-term", selectedRecommendation?.historyBasis)
        assertEquals("medium", selectedRecommendation?.confidence)
        assertEquals(2, selectedRecommendation?.nonComparableHistorySessionCount)
        val evidence = returnCalibrationEvidence(selectedRecommendation)
        assertEquals("recent-and-long-term", evidence?.historyBasis)
        assertEquals(1, evidence?.recentHistorySessionCount)
        assertEquals(3, evidence?.longTermHistorySessionCount)
        assertEquals(87, evidence?.returnGapDays)
        assertEquals(true, evidence?.followsPriorGap)
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
            exerciseConfigs = listOf(
                GymExerciseConfigDto(
                    gymId = "gym-1",
                    exerciseId = exercise.exerciseId,
                    preferredEquipmentId = "cable-a",
                ),
            ),
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
            fallbackGymId = "gym-1",
            gymId = "gym-1",
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
            fallbackGymId = "gym-1",
            gymId = "gym-1",
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

    @Test
    fun `does not use active gym null-equipment history in an open session at another gym`() {
        val performances = listOf(
            nullEquipmentPerformance("gym-a", "session-a", maxWeight = 30.0),
            nullEquipmentPerformance("gym-b", "session-b", maxWeight = 60.0),
        )
        val recommendations = listOf(
            EquipmentReturnRecommendationDto(
                gymId = "gym-a",
                gymEquipmentId = null,
                recommendation = ReturnRecommendationDto(
                    mode = "normal",
                    targetSets = 3,
                    targetRIR = 2,
                    suggestedWeight = 30.0,
                ),
            ),
            EquipmentReturnRecommendationDto(
                gymId = "gym-b",
                gymEquipmentId = null,
                recommendation = ReturnRecommendationDto(
                    mode = "exercise-reintro",
                    targetSets = 2,
                    targetRIR = 3,
                    suggestedWeight = 60.0,
                ),
            ),
        )

        val gymBPerformance = selectLastPerformanceForEquipment(
            performances = performances,
            fallback = performances.first(),
            gymId = "gym-b",
            gymEquipmentId = null,
        )
        val gymBRecommendation = selectReturnRecommendationForEquipment(
            recommendations = recommendations,
            fallback = recommendations.first().recommendation,
            fallbackPerformance = performances.first(),
            fallbackGymId = "gym-a",
            gymId = "gym-b",
            gymEquipmentId = null,
        )

        assertEquals("session-b", gymBPerformance?.sessionId)
        assertEquals(60.0, gymBPerformance?.maxWeight ?: 0.0, 0.001)
        assertEquals(2, gymBRecommendation?.targetSets)
        assertEquals(60.0, gymBRecommendation?.suggestedWeight ?: 0.0, 0.001)
    }

    @Test
    fun `uses no-gym scope and rejects active-gym legacy fallback for a no-gym session`() {
        val activeGymPerformance = nullEquipmentPerformance("gym-a", "session-a", maxWeight = 30.0)
        val noGymPerformance = nullEquipmentPerformance(null, "session-no-gym", maxWeight = 60.0)
        val activeGymRecommendation = EquipmentReturnRecommendationDto(
            gymId = "gym-a",
            gymEquipmentId = null,
            recommendation = ReturnRecommendationDto(
                mode = "normal",
                targetSets = 3,
                targetRIR = 2,
                suggestedWeight = 30.0,
            ),
        )
        val noGymRecommendation = EquipmentReturnRecommendationDto(
            gymId = null,
            gymEquipmentId = null,
            recommendation = ReturnRecommendationDto(
                mode = "exercise-reintro",
                targetSets = 2,
                targetRIR = 3,
                suggestedWeight = 60.0,
            ),
        )

        val selectedPerformance = selectLastPerformanceForEquipment(
            performances = listOf(activeGymPerformance, noGymPerformance),
            fallback = activeGymPerformance,
            gymId = null,
            gymEquipmentId = null,
        )
        val selectedRecommendation = selectReturnRecommendationForEquipment(
            recommendations = listOf(activeGymRecommendation, noGymRecommendation),
            fallback = activeGymRecommendation.recommendation,
            fallbackPerformance = activeGymPerformance,
            fallbackGymId = "gym-a",
            gymId = null,
            gymEquipmentId = null,
        )
        val rejectedLegacyFallback = selectReturnRecommendationForEquipment(
            recommendations = listOf(activeGymRecommendation),
            fallback = activeGymRecommendation.recommendation,
            fallbackPerformance = activeGymPerformance,
            fallbackGymId = "gym-a",
            gymId = null,
            gymEquipmentId = null,
        )

        assertEquals("session-no-gym", selectedPerformance?.sessionId)
        assertEquals(60.0, selectedPerformance?.maxWeight ?: 0.0, 0.001)
        assertEquals(2, selectedRecommendation?.targetSets)
        assertEquals(null, rejectedLegacyFallback)
    }

    @Test
    fun `equipment selections stay isolated by program target and replacement clears only that target`() {
        val sharedExercise = ExerciseDto(
            id = "shared-pressdown",
            name = "Shared pressdown",
            muscleGroup = "TRICEPS",
            category = "ISOLATION",
            equipmentType = "CABLE",
        )
        fun target(id: String, order: Int) = ProgramExerciseDto(
            id = id,
            workoutId = "workout-1",
            exerciseId = sharedExercise.id,
            order = order,
            targetSets = 3,
            targetRepsMin = 8,
            targetRepsMax = 12,
            targetRIR = 2,
            restSec = 90,
            exercise = sharedExercise,
        )
        val first = target("target-a", 1)
        val second = target("target-b", 2)
        val selections = mapOf(
            workoutEquipmentSelectionKey(first) to "cable-a",
            workoutEquipmentSelectionKey(second) to "cable-b",
        )

        assertEquals(2, selections.size)
        assertEquals("cable-a", selections[workoutEquipmentSelectionKey(first)])
        assertEquals("cable-b", selections[workoutEquipmentSelectionKey(second)])

        val replacement = sharedExercise.copy(id = "replacement-pressdown")
        val replacedFirst = first.copy(
            exerciseId = replacement.id,
            exercise = replacement,
        )
        val retained = retainWorkoutEquipmentSelections(
            selections = selections,
            targets = listOf(replacedFirst, second),
        )

        assertEquals(mapOf(workoutEquipmentSelectionKey(second) to "cable-b"), retained)
    }

    private fun nullEquipmentPerformance(
        gymId: String?,
        sessionId: String,
        maxWeight: Double,
    ) = LastPerformanceDto(
        exerciseId = "pressdown",
        sessionId = sessionId,
        sessionStartedAt = "2026-07-01T10:00:00.000Z",
        gymId = gymId,
        gymEquipmentId = null,
        maxWeight = maxWeight,
        repsAtMaxWeight = 10,
    )

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
        gymId = "gym-1",
        gymEquipmentId = gymEquipmentId,
        recommendation = ReturnRecommendationDto(
            mode = mode,
            targetSets = targetSets,
            targetRIR = if (mode == "normal") 2 else 3,
        ),
    )
}
