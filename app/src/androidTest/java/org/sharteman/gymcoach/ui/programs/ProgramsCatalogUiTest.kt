package org.sharteman.gymcoach.ui.programs

import android.content.res.Configuration
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextInput
import androidx.test.platform.app.InstrumentationRegistry
import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.sharteman.gymcoach.data.model.ExerciseDto
import org.sharteman.gymcoach.data.model.ExerciseHistorySessionDto
import org.sharteman.gymcoach.data.model.ExerciseHistorySetDto
import org.sharteman.gymcoach.data.model.MobileProgressPointDto
import org.sharteman.gymcoach.data.model.ProgramExerciseDto
import org.sharteman.gymcoach.data.model.WorkoutDto
import org.sharteman.gymcoach.data.programs.ExerciseInput
import org.sharteman.gymcoach.data.programs.ManagedProgramDto
import org.sharteman.gymcoach.data.programs.ProgramCountsDto
import org.sharteman.gymcoach.data.programs.ProgramExerciseInput
import org.sharteman.gymcoach.data.programs.ProgramInput
import org.sharteman.gymcoach.data.programs.ProgramsCatalogDataSource
import org.sharteman.gymcoach.data.programs.WorkoutInput
import org.sharteman.gymcoach.R
import org.sharteman.gymcoach.ui.formatHistoryDistance
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
    fun directWorkoutEditOpensExactDayWithLocalizedWeekdaySelector() {
        val previousLocale = Locale.getDefault()
        try {
            Locale.setDefault(Locale.forLanguageTag("ru"))
            composeRule.setContent {
                val baseContext = LocalContext.current
                val baseConfiguration = LocalConfiguration.current
                val configuration = remember(baseConfiguration) {
                    Configuration(baseConfiguration).apply { setLocale(Locale("ru")) }
                }
                val localizedContext = remember(baseContext, configuration) {
                    baseContext.createConfigurationContext(configuration)
                }
                CompositionLocalProvider(
                    LocalContext provides localizedContext,
                    LocalConfiguration provides configuration,
                ) {
                    GymCoachTheme {
                        ProgramsScreen(
                            dataSource = FakeProgramsCatalogDataSource(),
                            onBack = {},
                            initialProgramId = "program-1",
                            initialWorkoutId = "upper-a",
                        )
                    }
                }
            }

            composeRule.onNodeWithText("Изменить тренировочный день").assertIsDisplayed()
            composeRule.onAllNodesWithText("Upper A").onFirst().assertIsDisplayed()
            composeRule.onNodeWithTag("program-workout-day").assertIsDisplayed()
            composeRule.onNodeWithText("понедельник").assertIsDisplayed()
        } finally {
            Locale.setDefault(previousLocale)
        }
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
    fun opensFullProgressForStrengthExerciseWithoutCachedProgressPoints() {
        var openedProgressId: String? = null
        composeRule.setContent {
            GymCoachTheme {
                ExerciseCatalogScreen(
                    dataSource = FakeProgramsCatalogDataSource(),
                    serverUrl = "https://example.test",
                    onBack = {},
                    onOpenProgress = { exerciseId -> openedProgressId = exerciseId },
                )
            }
        }

        composeRule.onNodeWithTag("exercise-row").performScrollTo().performClick()
        composeRule.onNodeWithTag("exercise-details-list")
            .performScrollToNode(hasTestTag("exercise-open-full-progress"))
        composeRule.onNodeWithTag("exercise-open-full-progress").performClick()
        composeRule.runOnIdle { assertEquals("row", openedProgressId) }
    }

    @Test
    fun hidesUncachedFullProgressWhileOffline() {
        composeRule.setContent {
            GymCoachTheme {
                ExerciseCatalogScreen(
                    dataSource = FakeProgramsCatalogDataSource(),
                    serverUrl = "https://example.test",
                    onBack = {},
                    canFetchProgress = false,
                    onOpenProgress = {},
                )
            }
        }

        composeRule.onNodeWithTag("exercise-row").performScrollTo().performClick()
        composeRule.onNodeWithTag("exercise-open-full-progress").assertDoesNotExist()
    }

    @Test
    fun opensFullExerciseDetailsHistoryAndEditor() {
        var openedProgressId: String? = null
        var openedHistory: Pair<String, String>? = null
        val history = ExerciseHistorySessionDto(
            sessionId = "session-1",
            startedAt = "2026-07-03T08:00:00Z",
            sets = listOf(
                ExerciseHistorySetDto(setNumber = 1, weight = 100.0, reps = 8, rir = 2),
                ExerciseHistorySetDto(setNumber = 2, weight = 100.0, reps = 7, rir = 1),
            ),
        )
        val progressPoint = MobileProgressPointDto(
            sessionStartedAt = history.startedAt,
            maxWeight = 100.0,
            estimated1RM = 126.7,
            totalVolume = 1_500.0,
            topSetReps = 8,
            maxReps = 8,
            totalReps = 15,
        )
        composeRule.setContent {
            GymCoachTheme {
                ExerciseCatalogScreen(
                    dataSource = FakeProgramsCatalogDataSource(),
                    serverUrl = "https://example.test",
                    onBack = {},
                    historyByExerciseId = mapOf("bench" to listOf(history)),
                    progressPointsByExerciseId = mapOf("bench" to listOf(progressPoint)),
                    unit = "KG",
                    onOpenProgress = { exerciseId -> openedProgressId = exerciseId },
                    onOpenHistory = { sessionId, startedAt ->
                        openedHistory = sessionId to startedAt
                    },
                )
            }
        }

        composeRule.onNodeWithTag("exercise-bench").performClick()
        composeRule.onNodeWithTag("exercise-details-dialog").assertIsDisplayed()
        composeRule.onNodeWithText("Exercise information").assertIsDisplayed()
        composeRule.onNodeWithTag("exercise-details-list")
            .performScrollToNode(hasTestTag("exercise-open-full-progress"))
        composeRule.onNodeWithTag("exercise-open-full-progress").assertIsDisplayed().performClick()
        composeRule.runOnIdle { assertEquals("bench", openedProgressId) }

        composeRule.onNodeWithTag("exercise-bench").performClick()
        composeRule.onNodeWithTag("exercise-details-list")
            .performScrollToNode(hasTestTag("exercise-history-session-1"))
        composeRule.onNodeWithTag("exercise-history-session-1").assertIsDisplayed()
        composeRule.onNodeWithText("1RM").assertExists()
        composeRule.onNodeWithTag("exercise-open-history-session-1").performScrollTo().performClick()
        composeRule.runOnIdle {
            assertEquals("session-1" to "2026-07-03T08:00:00Z", openedHistory)
        }

        composeRule.onNodeWithTag("exercise-bench").performClick()
        composeRule.onNodeWithTag("exercise-detail-edit").performClick()
        composeRule.onNodeWithTag("exercise-editor").assertIsDisplayed()
        composeRule.onNodeWithTag("exercise-editor-name").assertTextContains("Bench Press")
    }

    @Test
    fun rendersRussianCardioHistoryWithoutStrengthProgress() {
        val previousLocale = Locale.getDefault()
        val history = ExerciseHistorySessionDto(
            sessionId = "cardio-session-1",
            startedAt = "2026-07-04T08:00:00Z",
            sets = listOf(
                ExerciseHistorySetDto(
                    setNumber = 1,
                    weight = 0.0,
                    reps = 1,
                    durationSec = 1_800,
                    distanceM = 5_000.0,
                    avgHr = 142,
                    maxHr = 166,
                ),
            ),
        )
        try {
            Locale.setDefault(Locale.forLanguageTag("ru"))
            val expectedContext = InstrumentationRegistry.getInstrumentation().targetContext
                .createConfigurationContext(
                    Configuration().apply { setLocale(Locale("ru")) },
                )
            val expectedDistance = formatHistoryDistance(
                5_000.0,
                expectedContext.getString(R.string.history_kilometer_unit),
                expectedContext.getString(R.string.history_meter_unit),
            )
            composeRule.setContent {
                val baseContext = LocalContext.current
                val baseConfiguration = LocalConfiguration.current
                val configuration = remember(baseConfiguration) {
                    Configuration(baseConfiguration).apply { setLocale(Locale("ru")) }
                }
                val localizedContext = remember(baseContext, configuration) {
                    baseContext.createConfigurationContext(configuration)
                }
                CompositionLocalProvider(
                    LocalContext provides localizedContext,
                    LocalConfiguration provides configuration,
                ) {
                    GymCoachTheme {
                        ExerciseCatalogScreen(
                            dataSource = FakeProgramsCatalogDataSource(),
                            serverUrl = "https://example.test",
                            onBack = {},
                            historyByExerciseId = mapOf("cardio" to listOf(history)),
                        )
                    }
                }
            }

            composeRule.onNodeWithTag("exercise-cardio").performScrollTo().performClick()
            composeRule.onNodeWithTag("exercise-details-dialog").assertIsDisplayed()
            composeRule.onNodeWithTag("exercise-details-list")
                .performScrollToNode(hasTestTag("exercise-history-cardio-session-1"))
            composeRule.onNodeWithText("30:00").assertIsDisplayed()
            composeRule.onNodeWithTag("exercise-history-cardio-cardio-session-1-1-distance")
                .assertTextEquals(expectedDistance)
            composeRule.onNodeWithTag("exercise-open-full-progress").assertDoesNotExist()
        } finally {
            Locale.setDefault(previousLocale)
        }
    }

    @Test
    fun rendersRussianExerciseNamesAndAttributes() {
        val previousLocale = Locale.getDefault()
        try {
            Locale.setDefault(Locale.forLanguageTag("ru"))
            composeRule.setContent {
                val baseContext = LocalContext.current
                val baseConfiguration = LocalConfiguration.current
                val configuration = remember(baseConfiguration) {
                    Configuration(baseConfiguration).apply { setLocale(Locale("ru")) }
                }
                val localizedContext = remember(baseContext, configuration) {
                    baseContext.createConfigurationContext(configuration)
                }
                CompositionLocalProvider(
                    LocalContext provides localizedContext,
                    LocalConfiguration provides configuration,
                ) {
                    GymCoachTheme {
                        ExerciseCatalogScreen(
                            dataSource = FakeProgramsCatalogDataSource(),
                            serverUrl = "https://example.test",
                            onBack = {},
                        )
                    }
                }
            }

            composeRule.onNodeWithText("Жим лёжа").assertIsDisplayed()
            composeRule.onNodeWithTag("exercise-bench-trained-days", useUnmergedTree = true)
                .performScrollTo()
                .assertIsDisplayed()
            composeRule.onNodeWithText("Тренировочных дней: 2", useUnmergedTree = true).assertExists()
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
        trainingDates = listOf("2026-07-01T08:00:00Z", "2026-07-03T08:00:00Z"),
    )
    private val row = ExerciseDto(
        id = "row",
        name = "Barbell Row",
        muscleGroup = "BACK_THICKNESS",
        category = "COMPOUND",
        equipmentType = "BARBELL",
        defaultRestSec = 120,
    )
    private val cardio = ExerciseDto(
        id = "cardio",
        name = "Running",
        muscleGroup = "OTHER",
        category = "CARDIO",
        equipmentType = "CARDIO",
        defaultRestSec = 60,
    )
    private val workout = WorkoutDto(
        id = "upper-a",
        programId = "program-1",
        name = "Upper A",
        dayOfWeek = 1,
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
    override suspend fun listExercises() = listOf(bench, row, cardio)
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
