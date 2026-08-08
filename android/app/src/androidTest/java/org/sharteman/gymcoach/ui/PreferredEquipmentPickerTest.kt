package org.sharteman.gymcoach.ui

import android.content.ContentValues
import android.graphics.Bitmap
import android.os.Environment
import android.provider.MediaStore
import androidx.compose.foundation.layout.Column
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeDown
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.sharteman.gymcoach.R
import org.sharteman.gymcoach.data.local.LocalSetEntity
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
import java.util.concurrent.atomic.AtomicInteger

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

    @Test
    fun exerciseLevelSelectorUpdatesItsExplicitPreferenceCallback() {
        val exercise = ProgramExerciseDto(
            id = "pe_selector",
            workoutId = "workout_selector",
            exerciseId = "exercise_selector",
            order = 1,
            targetSets = 3,
            targetRepsMin = 8,
            targetRepsMax = 12,
            targetRIR = 2,
            restSec = 90,
            exercise = ExerciseDto(
                id = "exercise_selector",
                name = "Cable pressdown",
                muscleGroup = "TRICEPS",
                category = "ISOLATION",
                equipmentType = "CABLE",
            ),
        )
        val gym = GymDto(
            id = "gym_selector",
            name = "Selector gym",
            inventoryMode = "EQUIPMENT_FIRST",
            equipment = listOf(
                GymEquipmentDto(
                    id = "cable_a",
                    gymId = "gym_selector",
                    name = "Cable A",
                    equipmentType = "CABLE",
                    loadType = "SELECTORIZED",
                    weightOptions = listOf(5.0, 10.0),
                    exerciseLinks = listOf(
                        GymEquipmentExerciseDto(exerciseId = exercise.exerciseId),
                    ),
                ),
                GymEquipmentDto(
                    id = "cable_b",
                    gymId = "gym_selector",
                    name = "Cable B",
                    equipmentType = "CABLE",
                    loadType = "SELECTORIZED",
                    weightOptions = listOf(5.0, 10.0),
                    exerciseLinks = listOf(
                        GymEquipmentExerciseDto(exerciseId = exercise.exerciseId),
                    ),
                ),
            ),
        )
        val equipment = resolveExerciseInventory(exercise, gym).equipment
        val preferenceWrites = AtomicInteger(0)

        composeRule.setContent {
            var selected by remember { mutableStateOf("cable_a") }
            GymCoachTheme {
                EquipmentSelectorCard(
                    inventoryAvailable = true,
                    equipment = equipment,
                    selectedEquipmentId = selected,
                    selectionRequired = false,
                    onSelect = { equipmentId ->
                        selected = equipmentId
                        preferenceWrites.incrementAndGet()
                    },
                )
            }
        }

        composeRule.onNodeWithTag("equipment-option-cable_b").performClick()
        composeRule.onNodeWithTag("equipment-option-cable_b").assertIsSelected()
        assertEquals(1, preferenceWrites.get())
    }

    @Test
    fun activeSharedEditorSwitchesExactMachineOptionsWithoutLeakingThePreviousScale() {
        val exercise = selectorExercise()
        val gym = selectorGym(exercise.exerciseId)
        val context = InstrumentationRegistry.getInstrumentation().targetContext

        composeRule.setContent {
            var selectedId by remember { mutableStateOf("cable_a") }
            var weight by remember { mutableStateOf("10") }
            var reps by remember { mutableStateOf("10") }
            var rir by remember { mutableStateOf("2") }
            val inventory = resolveExerciseInventory(exercise, gym, selectedId)
            GymCoachTheme {
                Column {
                    EquipmentSelectorCard(
                        inventoryAvailable = true,
                        equipment = inventory.equipment,
                        selectedEquipmentId = selectedId,
                        selectionRequired = false,
                        onSelect = { selectedId = it },
                    )
                    StrengthSetEditor(
                        mode = StrengthSetEditorMode.ACTIVE,
                        sets = emptyList(),
                        target = exercise,
                        lastPerformance = null,
                        unit = "KG",
                        metrics = emptyList(),
                        onMetricToggle = { _, _ -> },
                        loadConstraints = inventory.constraints,
                        selectedEquipment = selectedEquipment(inventory),
                        submissionEnabled = true,
                        recommendation = null,
                        weightText = weight,
                        repsText = reps,
                        rirText = rir,
                        notesText = "",
                        isWarmup = false,
                        isDropSet = false,
                        onWeightChange = { weight = it },
                        onRepsChange = { reps = it },
                        onRirChange = { rir = it },
                        onNotesChange = {},
                        onWarmupChange = {},
                        onDropSetChange = {},
                        onUpdateSet = { _, _, _, _, _ -> true },
                        onDelete = { true },
                        onTargetSetsChange = {},
                        onConfirm = { false },
                    )
                }
            }
        }

        composeRule.onNodeWithTag("active-weight-picker").performClick()
        composeRule.onNodeWithText(context.getString(R.string.weight_picker_equipment, "Cable A"))
            .assertIsDisplayed()
        composeRule.onNodeWithTag("set-value-option-WEIGHT-10").assertIsDisplayed()
        composeRule.onNodeWithTag("set-value-option-WEIGHT-12.5").assertDoesNotExist()
        saveScreenshot("y3n-active-cable-a-options-labeled.png")
        composeRule.onNodeWithTag("set-value-cancel").performClick()

        composeRule.onNodeWithTag("equipment-option-cable_b").performClick()
        composeRule.onNodeWithTag("equipment-option-cable_b").assertIsSelected()
        composeRule.onNodeWithTag("active-weight-picker").performClick()
        composeRule.onNodeWithText(context.getString(R.string.weight_picker_equipment, "Cable B"))
            .assertIsDisplayed()
        composeRule.onNodeWithTag("set-value-option-WEIGHT-12.5").assertIsDisplayed()
        composeRule.onNodeWithTag("set-value-option-WEIGHT-10").assertDoesNotExist()
        saveScreenshot("y3n-active-cable-b-options-labeled.png")
    }

    @Test
    fun finishedSharedEditorKeepsTheSetEquipmentOptionsInsteadOfTheCurrentSelection() {
        val exercise = selectorExercise()
        val gym = selectorGym(exercise.exerciseId)
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val currentInventory = resolveExerciseInventory(exercise, gym, selectedEquipmentId = "cable_b")
        val set = LocalSetEntity(
            id = "set-a",
            sessionId = "finished-session",
            exerciseId = exercise.exerciseId,
            gymEquipmentId = "cable_a",
            equipmentNameSnapshot = "Cable A",
            selectedLoadKg = 9.0,
            selectedLoadMultiplierSnapshot = 1.0,
            nominalResistanceKg = 9.0,
            equipmentLoadSnapshotJson = """
                {
                  "version": 2,
                  "revisionId": "frozen-cable-a",
                  "gymEquipmentId": "cable_a",
                  "loadType": "SELECTORIZED",
                  "equipmentType": "CABLE",
                  "selectedLoadKg": 9.0,
                  "selectedLoadMultiplier": 1.0,
                  "nominalResistanceKg": 9.0,
                  "baseLoadKg": 0.0,
                  "loadingSides": 1,
                  "weightOptions": [9.0, 19.0, 29.0],
                  "platePool": null
                }
            """.trimIndent(),
            setNumber = 1,
            weight = 9.0,
            reps = 10,
            rir = 2,
            completedAt = "2026-08-08T10:00:00Z",
        )

        composeRule.setContent {
            var weight by remember { mutableStateOf("12.5") }
            GymCoachTheme {
                StrengthSetEditor(
                    mode = StrengthSetEditorMode.FINISHED_EDIT,
                    sets = listOf(set),
                    target = exercise,
                    lastPerformance = null,
                    unit = "KG",
                    metrics = emptyList(),
                    onMetricToggle = { _, _ -> },
                    loadConstraints = currentInventory.constraints,
                    selectedEquipment = selectedEquipment(currentInventory),
                    submissionEnabled = true,
                    recommendation = null,
                    weightText = weight,
                    repsText = "10",
                    rirText = "2",
                    notesText = "",
                    isWarmup = false,
                    isDropSet = false,
                    onWeightChange = { weight = it },
                    onRepsChange = {},
                    onRirChange = {},
                    onNotesChange = {},
                    onWarmupChange = {},
                    onDropSetChange = {},
                    onUpdateSet = { _, _, _, _, _ -> true },
                    onDelete = { true },
                    onTargetSetsChange = {},
                    onConfirm = { false },
                )
            }
        }

        composeRule.onNodeWithTag("completed-set-1-weight").performClick()
        composeRule.onNodeWithText(context.getString(R.string.weight_picker_equipment, "Cable A"))
            .assertIsDisplayed()
        composeRule.onNodeWithTag("set-value-option-WEIGHT-9").assertIsDisplayed()
        composeRule.onNodeWithTag("set-value-option-WEIGHT-10").assertDoesNotExist()
        composeRule.onNodeWithTag("set-value-option-WEIGHT-12.5").assertDoesNotExist()
        saveScreenshot("y3n-finished-frozen-v2-equipment-options-labeled.png")
    }

    private fun saveScreenshot(name: String) {
        if (InstrumentationRegistry.getArguments().getString("captureScreenshots") != "true") return
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, name)
            put(MediaStore.Images.Media.MIME_TYPE, "image/png")
            put(MediaStore.Images.Media.RELATIVE_PATH, "${Environment.DIRECTORY_PICTURES}/GymCoachTests")
        }
        val uri = requireNotNull(
            context.contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values),
        )
        context.contentResolver.openOutputStream(uri).use { output ->
            requireNotNull(output)
            InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
                .compress(Bitmap.CompressFormat.PNG, 100, output)
        }
    }

    private fun selectorExercise() = ProgramExerciseDto(
        id = "pe-selector-options",
        workoutId = "workout-selector-options",
        exerciseId = "exercise-selector-options",
        order = 0,
        targetSets = 1,
        targetRepsMin = 8,
        targetRepsMax = 12,
        targetRIR = 2,
        restSec = 90,
        exercise = ExerciseDto(
            id = "exercise-selector-options",
            name = "Cable pressdown",
            muscleGroup = "TRICEPS",
            category = "ISOLATION",
            equipmentType = "CABLE",
        ),
    )

    private fun selectorGym(exerciseId: String) = GymDto(
        id = "gym-selector-options",
        name = "Selector gym",
        inventoryMode = "EQUIPMENT_FIRST",
        equipment = listOf(
            GymEquipmentDto(
                id = "cable_a",
                gymId = "gym-selector-options",
                name = "Cable A",
                equipmentType = "CABLE",
                loadType = "SELECTORIZED",
                weightOptions = listOf(10.0, 20.0, 30.0),
                exerciseLinks = listOf(GymEquipmentExerciseDto(exerciseId = exerciseId)),
            ),
            GymEquipmentDto(
                id = "cable_b",
                gymId = "gym-selector-options",
                name = "Cable B",
                equipmentType = "CABLE",
                loadType = "SELECTORIZED",
                weightOptions = listOf(12.5, 17.5, 22.5),
                exerciseLinks = listOf(GymEquipmentExerciseDto(exerciseId = exerciseId)),
            ),
        ),
    )

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
