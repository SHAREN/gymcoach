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
import org.sharteman.gymcoach.data.model.GymExerciseConfigDto
import org.sharteman.gymcoach.data.model.GymPlateInventoryItemDto
import org.sharteman.gymcoach.data.model.GymPlatePoolDto
import org.sharteman.gymcoach.data.model.ProgramExerciseDto
import org.sharteman.gymcoach.data.model.ReturnRecommendationDto

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
    fun returnCeilingPreventsAnEasyCalibrationSetFromIncreasingPastTheLimit() {
        val recommendation = recommendNextSet(
            programExercise = programExercise(mode = "PRESERVE_REPS", muscle = "BICEPS"),
            completedSets = listOf(set(weight = 20.0, reps = 12, rir = 5)),
            recoverySec = 120,
            maxWeight = 20.0,
            constraints = LoadConstraints(
                equipmentType = "DUMBBELL",
                dumbbellWeights = listOf(20.0, 22.0, 24.0),
            ),
        )

        requireNotNull(recommendation)
        assertEquals(20.0, recommendation.weight, 0.001)
    }

    @Test
    fun sharedGoldenReturnTargetMatchesWebForThirtyTwoPointFiveByTwelveAtRirTwo() {
        val recommendation = recommendNextSetFromSharedContract(
            programExercise = parityProgramExercise(),
            returnRecommendation = returnRecommendation(
                mode = "muscle-reintro",
                targetSets = 1,
                targetRir = 4,
                weightCeiling = 32.5,
            ),
            completedSets = listOf(set(weight = 32.5, reps = 12, rir = 2)),
            recoverySec = 120,
            constraints = parityLoadConstraints(),
        )

        requireNotNull(recommendation)
        assertEquals(32.5, recommendation.weight, 0.001)
        assertEquals(10, recommendation.reps)
        assertEquals(4, recommendation.rir)
        assertEquals("adjust-reps", recommendation.reason)
        assertEquals(10, recommendation.predictedRepsAtSameLoad)
        assertEquals(0.5, recommendation.fatigueLoss, 0.001)
        assertEquals("medium", recommendation.confidence)
    }

    @Test
    fun sharedGoldenMissingOrStaleStateFailsClosed() {
        val recommendation = recommendNextSetFromSharedContract(
            programExercise = parityProgramExercise(),
            returnRecommendation = null,
            completedSets = listOf(set(weight = 32.5, reps = 12, rir = 2)),
            recoverySec = 120,
            constraints = parityLoadConstraints(),
        )

        assertEquals(null, recommendation)
    }

    @Test
    fun sharedGoldenEquipmentStepCannotCrossReturnCeiling() {
        val recommendation = recommendNextSetFromSharedContract(
            programExercise = parityProgramExercise(),
            returnRecommendation = returnRecommendation(
                mode = "exercise-reintro",
                targetSets = 2,
                targetRir = 3,
                weightCeiling = 33.0,
            ),
            completedSets = listOf(set(weight = 32.5, reps = 12, rir = 5)),
            recoverySec = 120,
            constraints = parityLoadConstraints(),
        )

        requireNotNull(recommendation)
        assertEquals(32.5, recommendation.weight, 0.001)
        assertTrue(recommendation.weight <= 33.0)
        assertEquals(3, recommendation.rir)
    }

    @Test
    fun sharedGoldenNormalSessionKeepsOrdinaryProgression() {
        val recommendation = recommendNextSetFromSharedContract(
            programExercise = parityProgramExercise(),
            returnRecommendation = returnRecommendation(
                mode = "normal",
                targetSets = 3,
                targetRir = 2,
                weightCeiling = null,
            ),
            completedSets = listOf(set(weight = 32.5, reps = 12, rir = 2)),
            recoverySec = 120,
            constraints = parityLoadConstraints(),
        )

        requireNotNull(recommendation)
        assertEquals(35.0, recommendation.weight, 0.001)
        assertEquals(10, recommendation.reps)
        assertEquals(2, recommendation.rir)
        assertEquals("increase-load", recommendation.reason)
        assertEquals("medium", recommendation.confidence)
    }

    @Test
    fun plannedDeloadAppliesOneRoundedTenPercentReduction() {
        val recommendation = plannedDeloadWeight(
            referenceWeight = 80.0,
            constraints = LoadConstraints(
                equipmentType = "DUMBBELL",
                dumbbellWeights = listOf(70.0, 72.5, 75.0, 80.0),
            ),
        )

        assertEquals(72.5, recommendation, 0.001)
    }

    @Test
    fun plannedDeloadDoesNotCompoundWithOrdinaryFatigueAdjustment() {
        val rested = recommendNextSetFromSharedContract(
            programExercise = parityProgramExercise(),
            returnRecommendation = returnRecommendation("normal", 3, 2, null),
            completedSets = listOf(set(weight = 80.0, reps = 10, rir = 0)),
            recoverySec = 120,
            plannedDeloadCeiling = 72.0,
        )
        val fatigued = recommendNextSetFromSharedContract(
            programExercise = parityProgramExercise(),
            returnRecommendation = returnRecommendation("normal", 3, 2, null),
            completedSets = listOf(set(weight = 80.0, reps = 10, rir = 0)),
            recoverySec = 30,
            allowLoadIncrease = false,
            plannedDeloadCeiling = 72.0,
        )

        assertEquals(72.0, requireNotNull(rested).weight, 0.001)
        assertEquals(rested.weight, requireNotNull(fatigued).weight, 0.001)
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
    fun preferredEquipmentInitializesAWorkoutAndExplicitSelectionWins() {
        val exercise = programExercise(
            mode = "PRESERVE_RIR",
            muscle = "TRICEPS",
            equipmentType = "CABLE",
        )
        val gym = GymDto(
            id = "gym_1",
            name = "Olymp",
            exerciseConfigs = listOf(
                GymExerciseConfigDto(
                    gymId = "gym_1",
                    exerciseId = exercise.exerciseId,
                    preferredEquipmentId = "cable_b",
                ),
            ),
            equipment = listOf(
                selectorized("cable_a", exercise.exerciseId, listOf(40.0, 45.0, 50.0)),
                selectorized("cable_b", exercise.exerciseId, listOf(5.0, 10.0, 15.0)),
            ),
        )

        val preferred = resolveExerciseInventory(exercise, gym)
        val explicit = resolveExerciseInventory(exercise, gym, selectedEquipmentId = "cable_a")

        assertEquals("cable_b", selectedEquipment(preferred)?.equipmentId)
        assertEquals(listOf(5.0, 10.0, 15.0), preferred.weightOptions)
        assertEquals("cable_a", selectedEquipment(explicit)?.equipmentId)
        assertEquals(listOf(40.0, 45.0, 50.0), explicit.weightOptions)
    }

    @Test
    fun preferredTenKgEzBarInitializesItsFourSidedAttainableLoads() {
        val exercise = programExercise(
            mode = "PRESERVE_RIR",
            muscle = "TRICEPS",
            equipmentType = "BARBELL",
        )
        val pool = GymPlatePoolDto(
            id = "pool_ez",
            gymId = "gym_1",
            name = "EZ plates",
            compatibilityKey = "EZ_25MM",
            plates = listOf(
                GymPlateInventoryItemDto(weightKg = 10.0, quantity = 4),
                GymPlateInventoryItemDto(weightKg = 5.0, quantity = 8),
            ),
        )
        val gym = GymDto(
            id = "gym_1",
            name = "Olymp",
            inventoryMode = "EQUIPMENT_FIRST",
            exerciseConfigs = listOf(
                GymExerciseConfigDto(
                    gymId = "gym_1",
                    exerciseId = exercise.exerciseId,
                    preferredEquipmentId = "ez_bar",
                ),
            ),
            platePools = listOf(pool),
            equipment = listOf(
                GymEquipmentDto(
                    id = "standard_bar",
                    gymId = "gym_1",
                    name = "20 kg standard bar",
                    equipmentType = "BARBELL",
                    loadType = "PLATE_LOADED",
                    baseLoadKg = 20.0,
                    platePoolId = pool.id,
                    loadingSides = 2,
                    exerciseLinks = listOf(
                        GymEquipmentExerciseDto(exerciseId = exercise.exerciseId),
                    ),
                ),
                GymEquipmentDto(
                    id = "ez_bar",
                    gymId = "gym_1",
                    name = "10 kg EZ bar",
                    equipmentType = "BARBELL",
                    loadType = "PLATE_LOADED",
                    baseLoadKg = 10.0,
                    platePoolId = pool.id,
                    loadingSides = 4,
                    exerciseLinks = listOf(
                        GymEquipmentExerciseDto(exerciseId = exercise.exerciseId),
                    ),
                ),
            ),
        )

        val inventory = resolveExerciseInventory(exercise, gym)
        val selected = requireNotNull(selectedEquipment(inventory))

        assertEquals("ez_bar", selected.equipmentId)
        assertEquals(10.0, selected.baseLoadKg, 0.001)
        assertEquals(4, selected.loadingSides)
        assertEquals(listOf(10.0, 30.0, 50.0, 70.0, 90.0), inventory.weightOptions)
        assertTrue(20.0 !in inventory.weightOptions)
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
                exerciseConfigs = listOf(
                    GymExerciseConfigDto(
                        gymId = "gym_1",
                        exerciseId = exercise.exerciseId,
                        systemProfileSupported = true,
                    ),
                ),
            ),
        )

        assertTrue(inventory.isAvailable)
        assertEquals("shared-dumbbells", inventory.source)
        assertEquals(listOf(10.0, 12.5, 15.0), inventory.weightOptions)
    }

    @Test
    fun concreteFixedDumbbellUsesItsSortedDeduplicatedEquipmentOptions() {
        val exercise = programExercise(mode = "PRESERVE_REPS", muscle = "BICEPS")
        val inventory = resolveExerciseInventory(
            exercise,
            GymDto(
                id = "gym_1",
                name = "Olymp",
                equipment = listOf(
                    GymEquipmentDto(
                        id = "dumbbell-rack",
                        gymId = "gym_1",
                        name = "Dumbbell rack",
                        equipmentType = "DUMBBELL",
                        loadType = "FIXED",
                        weightOptions = listOf(22.5, 10.0, 22.5, 15.0),
                        exerciseLinks = listOf(
                            GymEquipmentExerciseDto(exerciseId = exercise.exerciseId),
                        ),
                    ),
                ),
            ),
        )

        assertEquals("dumbbell-rack", selectedEquipment(inventory)?.equipmentId)
        assertEquals(listOf(10.0, 15.0, 22.5), inventory.weightOptions)
    }

    @Test
    fun gymSwitchReplacesTheExactEquipmentScaleInsteadOfRetainingOldOptions() {
        val exercise = programExercise(
            mode = "PRESERVE_RIR",
            muscle = "TRICEPS",
            equipmentType = "CABLE",
        )
        val first = resolveExerciseInventory(
            exercise,
            GymDto(
                id = "gym_a",
                name = "Gym A",
                equipment = listOf(
                    selectorized(
                        "cable_a",
                        exercise.exerciseId,
                        listOf(10.0, 20.0, 30.0),
                        gymId = "gym_a",
                    ),
                ),
            ),
        )
        val second = resolveExerciseInventory(
            exercise,
            GymDto(
                id = "gym_b",
                name = "Gym B",
                equipment = listOf(
                    selectorized(
                        "cable_b",
                        exercise.exerciseId,
                        listOf(12.5, 17.5, 22.5),
                        gymId = "gym_b",
                    ),
                ),
            ),
        )

        assertEquals(listOf(10.0, 20.0, 30.0), first.weightOptions)
        assertEquals(listOf(12.5, 17.5, 22.5), second.weightOptions)
        assertTrue(first.weightOptions.intersect(second.weightOptions.toSet()).isEmpty())
    }

    @Test
    fun equipmentFirstDumbbellProfilePersistsAnExplicitRemoval() {
        val exercise = programExercise(mode = "PRESERVE_REPS", muscle = "BICEPS")
        val inventory = resolveExerciseInventory(
            exercise,
            GymDto(
                id = "gym_1",
                name = "Olymp",
                inventoryMode = "EQUIPMENT_FIRST",
                dumbbellWeights = listOf(10.0, 12.5, 15.0),
                exerciseConfigs = listOf(
                    GymExerciseConfigDto(
                        gymId = "gym_1",
                        exerciseId = exercise.exerciseId,
                        systemProfileSupported = false,
                    ),
                ),
            ),
        )

        assertFalse(inventory.isAvailable)
        assertEquals("none", inventory.source)
        assertTrue(inventory.weightOptions.isEmpty())
    }

    @Test
    fun olderBootstrapWithoutSystemMetadataKeepsSharedDumbbellCompatibility() {
        val exercise = programExercise(mode = "PRESERVE_REPS", muscle = "BICEPS")
        val inventory = resolveExerciseInventory(
            exercise,
            GymDto(
                id = "gym_1",
                name = "Olymp",
                inventoryMode = "EQUIPMENT_FIRST",
                dumbbellWeights = listOf(10.0, 12.5),
            ),
        )

        assertTrue(inventory.isAvailable)
        assertEquals(listOf(10.0, 12.5), inventory.weightOptions)
    }

    @Test
    fun largeAndSmallBarbellPoolsNeverMixAttainableLoads() {
        val exercise = programExercise(
            mode = "PRESERVE_RIR",
            muscle = "QUADS",
            equipmentType = "BARBELL",
        )
        val largePool = GymPlatePoolDto(
            id = "large_pool",
            gymId = "gym_1",
            name = "Large plates",
            compatibilityKey = "legacy-default",
            systemBarbellFamily = "LARGE",
            plates = listOf(GymPlateInventoryItemDto(weightKg = 10.0, quantity = 2)),
        )
        val smallPool = GymPlatePoolDto(
            id = "small_pool",
            gymId = "gym_1",
            name = "Small plates",
            compatibilityKey = "small_diameter",
            systemBarbellFamily = "SMALL",
            plates = listOf(GymPlateInventoryItemDto(weightKg = 3.5, quantity = 2)),
        )
        val gym = GymDto(
            id = "gym_1",
            name = "Olymp",
            inventoryMode = "EQUIPMENT_FIRST",
            platePools = listOf(largePool, smallPool),
            equipment = listOf(
                GymEquipmentDto(
                    id = "large_12",
                    gymId = "gym_1",
                    name = "Large 12 kg bar",
                    equipmentType = "BARBELL",
                    loadType = "PLATE_LOADED",
                    baseLoadKg = 12.0,
                    platePoolId = largePool.id,
                    loadingSides = 2,
                    systemBarbellFamily = "LARGE",
                    exerciseLinks = listOf(
                        GymEquipmentExerciseDto(exerciseId = exercise.exerciseId),
                    ),
                ),
                GymEquipmentDto(
                    id = "small_6",
                    gymId = "gym_1",
                    name = "Small 6 kg bar",
                    equipmentType = "BARBELL",
                    loadType = "PLATE_LOADED",
                    baseLoadKg = 6.0,
                    platePoolId = smallPool.id,
                    loadingSides = 2,
                    systemBarbellFamily = "SMALL",
                    exerciseLinks = listOf(
                        GymEquipmentExerciseDto(exerciseId = exercise.exerciseId),
                    ),
                ),
            ),
        )

        val large = resolveExerciseInventory(exercise, gym, selectedEquipmentId = "large_12")
        val small = resolveExerciseInventory(exercise, gym, selectedEquipmentId = "small_6")

        assertEquals(listOf(12.0, 32.0), large.weightOptions)
        assertEquals(listOf(6.0, 13.0), small.weightOptions)
        assertTrue(19.0 !in large.weightOptions)
        assertTrue(19.0 !in small.weightOptions)
    }

    @Test
    fun deletedEquipmentKeepsItsFrozenSelectorizedOptionsAndMultiplier() {
        val set = LocalSetEntity(
            id = "set-deleted-equipment",
            sessionId = "finished-session",
            exerciseId = "cable-exercise",
            gymEquipmentId = null,
            equipmentNameSnapshot = "Deleted cable",
            selectedLoadKg = 20.0,
            selectedLoadMultiplierSnapshot = 0.5,
            nominalResistanceKg = 10.0,
            equipmentLoadSnapshotJson = """
                {
                  "version": 2,
                  "revisionId": "revision-deleted-cable",
                  "gymEquipmentId": "deleted-cable",
                  "loadType": "SELECTORIZED",
                  "equipmentType": "CABLE",
                  "selectedLoadKg": 20.0,
                  "selectedLoadMultiplier": 0.5,
                  "nominalResistanceKg": 10.0,
                  "baseLoadKg": 0.0,
                  "loadingSides": 1,
                  "weightOptions": [10.0, 20.0, 30.0],
                  "platePool": null
                }
            """.trimIndent(),
            setNumber = 1,
            weight = 20.0,
            reps = 10,
            rir = 2,
            completedAt = "2026-08-08T10:00:00Z",
        )

        val supported = frozenEquipmentLoadState(set) as FrozenEquipmentLoadState.Supported
        val profile = supported.constraints.equipmentOptions.single()

        assertEquals("deleted-cable", supported.constraints.equipmentId)
        assertEquals(listOf(10.0, 20.0, 30.0), gymWeightOptions(supported.constraints, 20.0))
        assertEquals(10.0, nominalResistanceKg(profile, 20.0) ?: 0.0, 0.001)
        assertTrue(isAchievableLoad(supported.constraints, 30.0))
        assertFalse(isAchievableLoad(supported.constraints, 25.0))
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

    private fun parityProgramExercise() = ProgramExerciseDto(
        id = "pe_parity",
        workoutId = "workout_parity",
        exerciseId = "exercise_parity",
        order = 1,
        targetSets = 3,
        targetRepsMin = 10,
        targetRepsMax = 10,
        targetRIR = 2,
        restSec = 120,
        autoregulationMode = "PRESERVE_RIR",
        fatigueRate = 0.5,
        loadAdjustmentPct = 3.0,
        exercise = ExerciseDto(
            id = "exercise_parity",
            name = "Parity dumbbell curl",
            muscleGroup = "BICEPS",
            category = "ISOLATION",
            equipmentType = "DUMBBELL",
        ),
    )

    private fun parityLoadConstraints() = LoadConstraints(
        equipmentType = "DUMBBELL",
        dumbbellWeights = listOf(30.0, 32.5, 35.0),
    )

    private fun returnRecommendation(
        mode: String,
        targetSets: Int,
        targetRir: Int,
        weightCeiling: Double?,
    ) = ReturnRecommendationDto(
        mode = mode,
        exerciseGapDays = 60,
        returnGapDays = 60,
        muscleGapDays = 60,
        targetSets = targetSets,
        targetRIR = targetRir,
        suggestedWeight = weightCeiling,
        weightCeiling = weightCeiling,
        calibrationRequired = mode != "normal",
        historySessionCount = 3,
        recentHistorySessionCount = 1,
        longTermHistorySessionCount = 2,
        historyBasis = "recent-and-long-term",
        confidence = "medium",
    )

    private fun selectorized(
        id: String,
        exerciseId: String,
        loads: List<Double>,
        gymId: String = "gym_1",
    ) =
        GymEquipmentDto(
            id = id,
            gymId = gymId,
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
