package org.sharteman.gymcoach.data.programs

import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProgramsCatalogModelsTest {
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true; explicitNulls = true }

    @Test
    fun `decodes program list counts and nested targets`() {
        val program = json.decodeFromString<ManagedProgramDto>(
            """
            {
              "id":"program-1","name":"Base","phase":"Build","isActive":true,
              "_count":{"workouts":1,"sessions":4},
              "workouts":[{
                "id":"workout-1","programId":"program-1","name":"Upper","order":1,
                "exercises":[{
                  "id":"target-1","workoutId":"workout-1","exerciseId":"exercise-1","order":1,
                  "targetSets":4,"targetDropSets":1,"targetRepsMin":8,"targetRepsMax":10,
                  "targetRIR":2,"restSec":120,
                  "exercise":{"id":"exercise-1","name":"Bench Press","muscleGroup":"CHEST","category":"COMPOUND"}
                }]
              }]
            }
            """.trimIndent(),
        )

        assertTrue(program.isActive)
        assertEquals(1, program.counts.workouts)
        assertEquals(4, program.counts.sessions)
        assertEquals(1, program.workouts.single().exercises.single().targetDropSets)
    }

    @Test
    fun `program exercise mutation preserves all web editor fields`() {
        val payload = ProgramExerciseInput(
            exerciseId = "exercise-1",
            targetSets = 5,
            targetDropSets = 2,
            targetRepsMin = 6,
            targetRepsMax = 8,
            targetRIR = 1,
            restSec = 180,
            tempo = "3-1-1-0",
            notes = "Controlled eccentric",
            supersetGroup = 3,
        )
        val encoded = json.encodeToString(payload)

        assertTrue(encoded.contains("\"targetDropSets\":2"))
        assertTrue(encoded.contains("\"tempo\":\"3-1-1-0\""))
        assertTrue(encoded.contains("\"supersetGroup\":3"))
    }

    @Test
    fun `exercise mutation serializes only client editable classification fields`() {
        val encoded = json.encodeToString(
            ExerciseInput(
                name = "Bench press",
                muscleGroup = "CHEST",
                category = "COMPOUND",
                equipmentType = "BARBELL",
            ),
        )

        assertTrue(encoded.contains("\"muscleGroup\":\"CHEST\""))
        assertFalse(encoded.contains("catalogOrigin"))
        assertFalse(encoded.contains("loadProfile"))
    }
}
