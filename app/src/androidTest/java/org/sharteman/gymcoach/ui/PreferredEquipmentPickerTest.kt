package org.sharteman.gymcoach.ui

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeDown
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.sharteman.gymcoach.R
import org.sharteman.gymcoach.data.model.ExerciseDto
import org.sharteman.gymcoach.data.model.GymDto
import org.sharteman.gymcoach.data.model.GymEquipmentDto
import org.sharteman.gymcoach.data.model.GymEquipmentExerciseDto
import org.sharteman.gymcoach.data.model.GymExerciseConfigDto
import org.sharteman.gymcoach.data.model.GymPlateInventoryItemDto
import org.sharteman.gymcoach.data.model.GymPlatePoolDto
import org.sharteman.gymcoach.data.model.ProgramExerciseDto
import org.sharteman.gymcoach.training.resolveExerciseInventory
import org.sharteman.gymcoach.training.selectedEquipment
import org.sharteman.gymcoach.ui.theme.GymCoachTheme

class PreferredEquipmentPickerTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun preferredTenKgEzBarDrivesAttainableOptionsAndPlateDiagram() {
        val exercise = ProgramExerciseDto(
            id = "pe_ez",
            workoutId = "workout_ez",
            exerciseId = "exercise_ez",
            order = 1,
            targetSets = 3,
            targetRepsMin = 8,
            targetRepsMax = 12,
            targetRIR = 2,
            restSec = 90,
            exercise = ExerciseDto(
                id = "exercise_ez",
                name = "EZ skull crusher",
                muscleGroup = "TRICEPS",
                category = "ISOLATION",
                equipmentType = "BARBELL",
            ),
        )
        val pool = GymPlatePoolDto(
            id = "pool_ez",
            gymId = "gym_ez",
            name = "EZ plates",
            compatibilityKey = "EZ_25MM",
            plates = listOf(
                GymPlateInventoryItemDto(weightKg = 10.0, quantity = 4),
                GymPlateInventoryItemDto(weightKg = 5.0, quantity = 8),
            ),
        )
        val gym = GymDto(
            id = "gym_ez",
            name = "Gym",
            inventoryMode = "EQUIPMENT_FIRST",
            exerciseConfigs = listOf(
                GymExerciseConfigDto(
                    gymId = "gym_ez",
                    exerciseId = exercise.exerciseId,
                    preferredEquipmentId = "ez_bar",
                ),
            ),
            platePools = listOf(pool),
            equipment = listOf(
                plateLoadedBar(
                    id = "standard_bar",
                    name = "20 kg standard bar",
                    exerciseId = exercise.exerciseId,
                    poolId = pool.id,
                    baseLoadKg = 20.0,
                    loadingSides = 2,
                ),
                plateLoadedBar(
                    id = "ez_bar",
                    name = "10 kg EZ bar",
                    exerciseId = exercise.exerciseId,
                    poolId = pool.id,
                    baseLoadKg = 10.0,
                    loadingSides = 4,
                ),
            ),
        )
        val inventory = resolveExerciseInventory(exercise, gym)
        val selected = requireNotNull(selectedEquipment(inventory))

        assertEquals("ez_bar", selected.equipmentId)
        assertEquals(10.0, selected.baseLoadKg, 0.001)
        assertEquals(4, selected.loadingSides)
        assertTrue(70.0 in inventory.weightOptions)

        composeRule.setContent {
            GymCoachTheme {
                SetValuePickerDialog(
                    kind = SetValuePickerKind.WEIGHT,
                    value = "70",
                    options = inventory.weightOptions,
                    unit = "KG",
                    loadConstraints = inventory.constraints,
                    onDismiss = {},
                    onConfirm = {},
                )
            }
        }

        val context = InstrumentationRegistry.getInstrumentation().targetContext
        composeRule.onNodeWithTag("set-value-option-WEIGHT-70").assertIsDisplayed()
        composeRule.onNodeWithTag("barbell-side-diagram").assertIsDisplayed()
        composeRule.onNodeWithText(context.getString(R.string.bar_weight_format, "10", "kg"))
            .assertIsDisplayed()

        val leading = composeRule.onNodeWithTag("set-value-leading-reserve")
            .fetchSemanticsNode().boundsInRoot
        val valueField = composeRule.onNodeWithTag("set-value-field")
            .fetchSemanticsNode().boundsInRoot
        val trailing = composeRule.onNodeWithTag("set-value-trailing-reserve")
            .fetchSemanticsNode().boundsInRoot
        assertEquals(leading.width, trailing.width, 1f)
        assertEquals((leading.center.x + trailing.center.x) / 2f, valueField.center.x, 1f)

        val initialPlatePreview = composeRule.onNodeWithTag("barbell-side-diagram")
            .fetchSemanticsNode().config[SemanticsProperties.StateDescription]
        composeRule.onNodeWithTag("weight-picker-list").performTouchInput { swipeDown() }
        composeRule.waitUntil(5_000) {
            composeRule.onNodeWithTag("weight-picker-pointer")
                .fetchSemanticsNode().config[SemanticsProperties.StateDescription] != "70"
        }
        val centeredWeight = composeRule.onNodeWithTag("weight-picker-pointer")
            .fetchSemanticsNode().config[SemanticsProperties.StateDescription]
        val updatedPlatePreview = composeRule.onNodeWithTag("barbell-side-diagram")
            .fetchSemanticsNode().config[SemanticsProperties.StateDescription]
        assertNotEquals(initialPlatePreview, updatedPlatePreview)
        assertEquals(centeredWeight, updatedPlatePreview)
    }

    private fun plateLoadedBar(
        id: String,
        name: String,
        exerciseId: String,
        poolId: String,
        baseLoadKg: Double,
        loadingSides: Int,
    ) = GymEquipmentDto(
        id = id,
        gymId = "gym_ez",
        name = name,
        equipmentType = "BARBELL",
        loadType = "PLATE_LOADED",
        baseLoadKg = baseLoadKg,
        platePoolId = poolId,
        loadingSides = loadingSides,
        exerciseLinks = listOf(GymEquipmentExerciseDto(exerciseId = exerciseId)),
    )
}
