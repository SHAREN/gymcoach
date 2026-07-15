package org.sharteman.gymcoach.ui

import android.content.res.Configuration
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToNode
import java.util.Locale
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.sharteman.gymcoach.data.local.LocalSessionEntity
import org.sharteman.gymcoach.data.model.BootstrapResponse
import org.sharteman.gymcoach.data.model.ExerciseDto
import org.sharteman.gymcoach.data.model.ProfileDto
import org.sharteman.gymcoach.data.model.ProgramDto
import org.sharteman.gymcoach.data.model.ProgramExerciseDto
import org.sharteman.gymcoach.data.model.ReadinessDto
import org.sharteman.gymcoach.data.model.WorkoutDto
import org.sharteman.gymcoach.ui.theme.GymCoachTheme

class HomeScreenNativeTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun showsActiveSessionReadinessAndNativeDestinations() {
        var sessionOpened = false
        var programsOpened = false
        val workout = workout()
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
                GymCoachTheme(darkTheme = true) {
                    HomeScreen(
                        email = "user@example.com",
                        bootstrap = bootstrap(workout),
                        openSessions = listOf(
                            LocalSessionEntity(
                                id = "session_1",
                                workoutId = workout.id,
                                gymId = null,
                                startedAt = "2026-07-14T10:00:00Z",
                            ),
                        ),
                        pendingCount = 0,
                        syncIssue = null,
                        online = true,
                        syncing = false,
                        onOpenSession = { sessionOpened = true },
                        onStartWorkout = { _, _ -> },
                        onSync = {},
                        onRetrySyncIssue = {},
                        onDiscardSyncIssue = {},
                        onSaveReadiness = { _, _, _ -> true },
                        onPrograms = { programsOpened = true },
                        onExerciseCatalog = {},
                        onHistory = {},
                        onProgress = {},
                        onCoach = {},
                        onChat = {},
                        onSettings = {},
                        onWebPanel = {},
                        currentVersion = "test",
                        onDownloadUpdate = {},
                        onLogout = {},
                    )
                }
            }
        }

        composeRule.onNodeWithText("Активная тренировка").assertIsDisplayed()
        composeRule.onNodeWithText("Готовность 4/5 · сон 3/5").assertIsDisplayed()
        composeRule.onNodeWithText("Продолжить").performClick()
        assertTrue(sessionOpened)

        composeRule.onNodeWithText("Программы").performScrollTo().performClick()
        assertTrue(programsOpened)
    }

    @Test
    fun workoutCardOpensDetailsBeforeStartingAndOffersProgramEditing() {
        var startedWorkoutId: String? = null
        var editedWorkout: Pair<String, String>? = null
        var openedProgramId: String? = null
        val workout = workout()
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
                GymCoachTheme(darkTheme = true) {
                    HomeScreen(
                        email = "user@example.com",
                        bootstrap = bootstrap(workout),
                        openSessions = emptyList(),
                        pendingCount = 0,
                        syncIssue = null,
                        online = true,
                        syncing = false,
                        onOpenSession = {},
                        onStartWorkout = { selected, _ -> startedWorkoutId = selected.id },
                        onSync = {},
                        onRetrySyncIssue = {},
                        onDiscardSyncIssue = {},
                        onSaveReadiness = { _, _, _ -> true },
                        onPrograms = {},
                        onExerciseCatalog = {},
                        onHistory = {},
                        onProgress = {},
                        onCoach = {},
                        onChat = {},
                        onSettings = {},
                        onWebPanel = {},
                        currentVersion = "test",
                        onDownloadUpdate = {},
                        onLogout = {},
                        onEditWorkout = { programId, workoutId ->
                            editedWorkout = programId to workoutId
                        },
                        onOpenProgram = { openedProgramId = it },
                    )
                }
            }
        }

        composeRule.onNodeWithTag("home-workout-${workout.id}").performClick()
        composeRule.onNodeWithTag("workout-day-details").assertIsDisplayed()
        composeRule.onNodeWithTag("workout-day-exercise-list")
            .performScrollToNode(hasTestTag("workout-day-exercise-${workout.exercises.single().exerciseId}"))
        composeRule.onNodeWithText("Жим лёжа").assertIsDisplayed()
        composeRule.onNodeWithTag("workout-day-target-${workout.exercises.single().id}")
            .performScrollTo()
            .assertIsDisplayed()
        assertTrue(startedWorkoutId == null)

        composeRule.onNodeWithTag("workout-day-exercise-list")
            .performScrollToNode(hasTestTag("workout-day-edit"))
        composeRule.onNodeWithTag("workout-day-edit").performClick()
        assertTrue(editedWorkout == (workout.programId to workout.id))

        composeRule.onNodeWithTag("home-workout-${workout.id}").performClick()
        composeRule.onNodeWithTag("workout-day-exercise-list")
            .performScrollToNode(hasTestTag("workout-day-open-program"))
        composeRule.onNodeWithTag("workout-day-open-program").performClick()
        assertTrue(openedProgramId == workout.programId)

        composeRule.onNodeWithTag("home-workout-${workout.id}").performClick()
        composeRule.onNodeWithTag("workout-day-start").performClick()
        assertTrue(startedWorkoutId == workout.id)
    }

    private fun bootstrap(workout: WorkoutDto) = BootstrapResponse(
        schemaVersion = 1,
        calculationVersion = "test",
        serverTime = "2026-07-14T12:00:00Z",
        profile = ProfileDto(id = "user", email = "user@example.com"),
        activeProgram = ProgramDto(
            id = "program",
            name = "Силовая",
            phase = "ACTIVE",
            workouts = listOf(workout),
        ),
        readiness = ReadinessDto(
            readiness = 4,
            sleepQuality = 3,
            createdAt = "2026-07-14T08:00:00Z",
            ageHours = 4.0,
        ),
    )

    private fun workout(): WorkoutDto {
        val exercise = ExerciseDto(
            id = "exercise",
            name = "Жим лёжа",
            muscleGroup = "CHEST",
            category = "STRENGTH",
        )
        return WorkoutDto(
            id = "workout",
            programId = "program",
            name = "Грудь",
            dayOfWeek = 1,
            order = 0,
            exercises = listOf(
                ProgramExerciseDto(
                    id = "program_exercise",
                    workoutId = "workout",
                    exerciseId = exercise.id,
                    order = 0,
                    targetSets = 3,
                    targetRepsMin = 8,
                    targetRepsMax = 12,
                    targetRIR = 2,
                    restSec = 120,
                    exercise = exercise,
                ),
            ),
        )
    }
}
