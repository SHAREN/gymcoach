package org.sharteman.gymcoach.training

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.sharteman.gymcoach.data.local.LocalSetEntity
import org.sharteman.gymcoach.data.model.ExerciseDto
import org.sharteman.gymcoach.data.model.GymDto
import org.sharteman.gymcoach.data.model.GymEquipmentDto
import org.sharteman.gymcoach.data.model.GymEquipmentExerciseDto
import org.sharteman.gymcoach.data.model.GymPlateInventoryItemDto
import org.sharteman.gymcoach.data.model.GymPlatePoolDto
import org.sharteman.gymcoach.data.model.ProgramExerciseDto

class AutoregulationTest {
    @Test
    fun preserveRirLowersTheRepTargetAsFatigueAccumulates() {
        val recommendation = recommendNextSet(
            programExercise = programExercise(mode = "PRESERVE_RIR", muscle = "QUADS"),
            completedSets = listOf(set(weight = 100.0, reps = 12, rir = 2)),
            recoverySec = 120,
        )
        requireNotNull(recommendation)
        assertEquals(100.0, recommendation.weight, 0.001)
        assertEquals(11, recommendation.reps)
        assertEquals("adjust-reps", recommendation.reason)
    }

    @Test
    fun shortRestProducesMoreFatigueThanProgrammedRest() {
        val exercise = programExercise(mode = "PRESERVE_RIR", muscle = "QUADS")
        val sets = listOf(set(weight = 100.0, reps = 12, rir = 2))
        val shortRest = requireNotNull(recommendNextSet(exercise, sets, recoverySec = 60))
        val fullRest = requireNotNull(recommendNextSet(exercise, sets, recoverySec = 120))

        assertTrue(shortRest.fatigueLoss > fullRest.fatigueLoss)
        assertTrue(shortRest.reps < fullRest.reps)
    }

    @Test
    fun preserveRepsReducesToAvailableDumbbell() {
        val recommendation = recommendNextSet(
            programExercise = programExercise(mode = "PRESERVE_REPS", muscle = "BICEPS"),
            completedSets = listOf(set(weight = 19.0, reps = 12, rir = 0)),
            recoverySec = 60,
            constraints = LoadConstraints(
                equipmentType = "DUMBBELL",
                dumbbellWeights = listOf(10.0, 12.0, 14.0, 15.5, 19.0),
            ),
        )
        requireNotNull(recommendation)
        assertEquals(15.5, recommendation.weight, 0.001)
        assertEquals("reduce-load", recommendation.reason)
    }

    @Test
    fun barbellOptionsContainConstructibleSixtyFiveKg() {
        val weights = constructibleBarbellWeights(
            barWeights = listOf(20.0),
            plateWeights = listOf(1.25, 2.5, 5.0, 10.0, 20.0),
            targetCeiling = 100.0,
        )
        assertTrue(65.0 in weights)
    }

    @Test
    fun selectorizedEquipmentKeepsDisplayedLoadsAndCalculatesNominalResistance() {
        val exercise = programExercise(
            mode = "PRESERVE_RIR",
            muscle = "BACK_WIDTH",
            equipmentType = "CABLE",
        )
        val equipment = GymEquipmentDto(
            id = "equipment_cable_1",
            gymId = "gym_1",
            name = "Lat pulldown",
            equipmentType = "CABLE",
            loadType = "SELECTORIZED",
            weightOptions = listOf(40.0, 45.0, 50.0),
            selectedLoadMultiplier = 0.5,
            exerciseLinks = listOf(
                GymEquipmentExerciseDto(exerciseId = exercise.exerciseId),
            ),
        )

        val inventory = resolveExerciseInventory(
            exercise,
            GymDto(id = "gym_1", name = "Olymp", equipment = listOf(equipment)),
        )

        assertEquals(listOf(40.0, 45.0, 50.0), inventory.weightOptions)
        assertEquals(25.0, nominalResistanceKg(selectedEquipment(inventory), 50.0) ?: 0.0, 0.001)
    }

    @Test
    fun compatiblePlatePoolIsSharedWithoutInventingMissingPlatePairs() {
        val pool = GymPlatePoolDto(
            id = "pool_olympic",
            gymId = "gym_1",
            name = "Olympic plates",
            compatibilityKey = "OLYMPIC_50MM",
            plates = listOf(
                GymPlateInventoryItemDto(weightKg = 5.0, quantity = 2),
                GymPlateInventoryItemDto(weightKg = 20.0, quantity = 4),
            ),
        )
        val exercise = programExercise(
            mode = "PRESERVE_RIR",
            muscle = "QUADS",
            equipmentType = "MACHINE",
        )
        val linked = listOf(
            GymEquipmentDto(
                id = "smith_1",
                gymId = "gym_1",
                name = "Smith",
                equipmentType = "MACHINE",
                loadType = "PLATE_LOADED",
                baseLoadKg = 20.0,
                platePoolId = pool.id,
                loadingSides = 2,
                exerciseLinks = listOf(GymEquipmentExerciseDto(exerciseId = exercise.exerciseId)),
            ),
            GymEquipmentDto(
                id = "leg_press_1",
                gymId = "gym_1",
                name = "Leg press",
                equipmentType = "MACHINE",
                loadType = "PLATE_LOADED",
                baseLoadKg = 20.0,
                platePoolId = pool.id,
                loadingSides = 2,
                exerciseLinks = listOf(GymEquipmentExerciseDto(exerciseId = exercise.exerciseId)),
            ),
        )
        val gym = GymDto(
            id = "gym_1",
            name = "Olymp",
            inventoryMode = "EQUIPMENT_FIRST",
            equipment = linked,
            platePools = listOf(pool),
        )

        val smith = resolveExerciseInventory(exercise, gym, selectedEquipmentId = "smith_1")
        val legPress = resolveExerciseInventory(exercise, gym, selectedEquipmentId = "leg_press_1")

        assertTrue(60.0 in smith.weightOptions)
        assertTrue(60.0 in legPress.weightOptions)
        assertTrue(50.0 !in smith.weightOptions)
    }

    @Test
    fun multipleMachinesNeverMergeTheirLoadScales() {
        val exercise = programExercise(
            mode = "PRESERVE_RIR",
            muscle = "TRICEPS",
            equipmentType = "CABLE",
        )
        val gym = GymDto(
            id = "gym_1",
            name = "Olymp",
            equipment = listOf(
                selectorized("cable_a", exercise.exerciseId, listOf(40.0, 45.0, 50.0)),
                selectorized("cable_b", exercise.exerciseId, listOf(5.0, 10.0, 15.0)),
            ),
        )

        val unresolved = resolveExerciseInventory(exercise, gym)
        val selected = resolveExerciseInventory(exercise, gym, selectedEquipmentId = "cable_b")

        assertTrue(unresolved.requiresEquipmentSelection)
        assertTrue(unresolved.weightOptions.isEmpty())
        assertEquals(listOf(5.0, 10.0, 15.0), selected.weightOptions)
    }

    @Test
    fun equipmentFirstGymWithoutLinksOrLegacyConfigIsUnavailable() {
        val exercise = programExercise(
            mode = "PRESERVE_RIR",
            muscle = "TRICEPS",
            equipmentType = "CABLE",
        )
        val inventory = resolveExerciseInventory(
            exercise,
            GymDto(
                id = "gym_1",
                name = "Olymp",
                inventoryMode = "EQUIPMENT_FIRST",
                equipment = emptyList(),
                exerciseConfigs = emptyList(),
            ),
        )

        assertFalse(inventory.isAvailable)
        assertEquals("none", inventory.source)
        assertTrue(inventory.weightOptions.isEmpty())
    }

    @Test
    fun equipmentFirstGymStillUsesItsSharedDumbbellSet() {
        val exercise = programExercise(mode = "PRESERVE_REPS", muscle = "BICEPS")
        val inventory = resolveExerciseInventory(
            exercise,
            GymDto(
                id = "gym_1",
                name = "Olymp",
                inventoryMode = "EQUIPMENT_FIRST",
                dumbbellWeights = listOf(10.0, 12.5, 15.0),
            ),
        )

        assertTrue(inventory.isAvailable)
        assertEquals("shared-dumbbells", inventory.source)
        assertEquals(listOf(10.0, 12.5, 15.0), inventory.weightOptions)
    }

    private fun programExercise(
        mode: String,
        muscle: String,
        equipmentType: String = if (muscle == "BICEPS") "DUMBBELL" else "BARBELL",
    ) = ProgramExerciseDto(
        id = "pe_00000001",
        workoutId = "workout_0001",
        exerciseId = "exercise_001",
        order = 1,
        targetSets = 4,
        targetRepsMin = 8,
        targetRepsMax = 12,
        targetRIR = 2,
        restSec = 120,
        autoregulationMode = mode,
        fatigueRate = if (muscle == "QUADS") 1.0 else 0.5,
        loadAdjustmentPct = 3.0,
        exercise = ExerciseDto(
            id = "exercise_001",
            name = "Test exercise",
            muscleGroup = muscle,
            category = if (muscle == "BICEPS") "ISOLATION" else "COMPOUND",
            equipmentType = equipmentType,
        ),
    )

    private fun selectorized(id: String, exerciseId: String, loads: List<Double>) =
        GymEquipmentDto(
            id = id,
            gymId = "gym_1",
            name = id,
            equipmentType = "CABLE",
            loadType = "SELECTORIZED",
            weightOptions = loads,
            exerciseLinks = listOf(GymEquipmentExerciseDto(exerciseId = exerciseId)),
        )

    private fun set(weight: Double, reps: Int, rir: Int?) = LocalSetEntity(
        id = "set_00000001",
        sessionId = "session_0001",
        exerciseId = "exercise_001",
        setNumber = 1,
        weight = weight,
        reps = reps,
        rir = rir,
        completedAt = "2026-07-13T10:00:00Z",
    )
}
