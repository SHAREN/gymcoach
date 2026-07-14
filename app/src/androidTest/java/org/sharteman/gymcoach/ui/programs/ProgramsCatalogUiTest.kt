package org.sharteman.gymcoach.ui.programs

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import java.util.Locale
import org.junit.Rule
import org.junit.Test
import org.sharteman.gymcoach.data.model.ExerciseDto
import org.sharteman.gymcoach.data.model.ProgramExerciseDto
import org.sharteman.gymcoach.data.model.WorkoutDto
import org.sharteman.gymcoach.data.programs.ExerciseInput
import org.sharteman.gymcoach.data.programs.ManagedProgramDto
import org.sharteman.gymcoach.data.programs.ProgramCountsDto
import org.sharteman.gymcoach.data.programs.ProgramExerciseInput
import org.sharteman.gymcoach.data.programs.ProgramInput
import org.sharteman.gymcoach.data.programs.ProgramsCatalogDataSource
import org.sharteman.gymcoach.data.programs.WorkoutInput
import org.sharteman.gymcoach.ui.theme.GymCoachTheme

class ProgramsCatalogUiTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun opensNativeProgramDetailsAndTargets() {
        composeRule.setContent {
            GymCoachTheme {
                ProgramsScreen(FakeProgramsCatalogDataSource(), onBack = {})
            }
        }

        composeRule.onNodeWithText("Native program").assertIsDisplayed().performClick()
        composeRule.onNodeWithTag("program-detail").assertIsDisplayed()
        composeRule.onNodeWithText("Upper A").assertIsDisplayed()
        composeRule.onNodeWithText("Bench Press").assertIsDisplayed()
        composeRule.onNodeWithTag("program-target-target-1").assertIsDisplayed()
    }

    @Test
    fun searchesNativeExerciseCatalog() {
        composeRule.setContent {
            GymCoachTheme {
                ExerciseCatalogScreen(
                    dataSource = FakeProgramsCatalogDataSource(),
                    serverUrl = "https://example.test",
                    onBack = {},
                )
            }
        }

        composeRule.onNodeWithTag("exercise-search").performTextInput("row")
        composeRule.onNodeWithText("Barbell Row").assertIsDisplayed()
        composeRule.onNodeWithText("Bench Press").assertDoesNotExist()
    }

    @Test
    fun rendersRussianExerciseNamesAndAttributes() {
        val previousLocale = Locale.getDefault()
        try {
            Locale.setDefault(Locale.forLanguageTag("ru"))
            composeRule.setContent {
                GymCoachTheme {
                    ExerciseCatalogScreen(
                        dataSource = FakeProgramsCatalogDataSource(),
                        serverUrl = "https://example.test",
                        onBack = {},
                    )
                }
            }

            composeRule.onNodeWithText("Жим лёжа").assertIsDisplayed()
            composeRule.onNodeWithText("Грудь").assertIsDisplayed()
            composeRule.onAllNodesWithText("Базовое • Штанга").onFirst().assertIsDisplayed()
        } finally {
            Locale.setDefault(previousLocale)
        }
    }
}

private class FakeProgramsCatalogDataSource : ProgramsCatalogDataSource {
    private val bench = ExerciseDto(
        id = "bench",
        name = "Bench Press",
        muscleGroup = "CHEST",
        category = "COMPOUND",
        equipmentType = "BARBELL",
        defaultRestSec = 120,
    )
    private val row = ExerciseDto(
        id = "row",
        name = "Barbell Row",
        muscleGroup = "BACK_THICKNESS",
        category = "COMPOUND",
        equipmentType = "BARBELL",
        defaultRestSec = 120,
    )
    private val workout = WorkoutDto(
        id = "upper-a",
        programId = "program-1",
        name = "Upper A",
        order = 1,
        exercises = listOf(
            ProgramExerciseDto(
                id = "target-1",
                workoutId = "upper-a",
                exerciseId = bench.id,
                order = 1,
                targetSets = 4,
                targetRepsMin = 8,
                targetRepsMax = 10,
                targetRIR = 2,
                restSec = 120,
                exercise = bench,
            ),
        ),
    )
    private val program = ManagedProgramDto(
        id = "program-1",
        name = "Native program",
        phase = "Base",
        isActive = true,
        workouts = listOf(workout),
        counts = ProgramCountsDto(workouts = 1, sessions = 3),
    )

    override suspend fun listPrograms() = listOf(program)
    override suspend fun getProgram(id: String) = program
    override suspend fun listExercises() = listOf(bench, row)
    override suspend fun getExercise(id: String) = listExercises().first { it.id == id }
    override suspend fun createProgram(input: ProgramInput) = error("unused")
    override suspend fun updateProgram(id: String, input: ProgramInput) = error("unused")
    override suspend fun deleteProgram(id: String) = Unit
    override suspend fun setProgramActive(id: String, active: Boolean) = program.copy(isActive = active)
    override suspend fun createWorkout(programId: String, input: WorkoutInput) = error("unused")
    override suspend fun updateWorkout(id: String, input: WorkoutInput) = error("unused")
    override suspend fun deleteWorkout(id: String) = Unit
    override suspend fun createProgramExercise(workoutId: String, input: ProgramExerciseInput) = error("unused")
    override suspend fun updateProgramExercise(id: String, input: ProgramExerciseInput) = error("unused")
    override suspend fun deleteProgramExercise(id: String) = Unit
    override suspend fun createExercise(input: ExerciseInput) = error("unused")
    override suspend fun updateExercise(id: String, input: ExerciseInput) = error("unused")
    override suspend fun deleteExercise(id: String) = Unit
}
