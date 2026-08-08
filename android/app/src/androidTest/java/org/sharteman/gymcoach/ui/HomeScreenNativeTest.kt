package org.sharteman.gymcoach.ui

import android.content.res.Configuration
import android.graphics.Bitmap
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.io.FileOutputStream
import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.sharteman.gymcoach.data.local.LocalSessionEntity
import org.sharteman.gymcoach.data.errors.AppErrorContext
import org.sharteman.gymcoach.data.errors.AppErrorDataState
import org.sharteman.gymcoach.data.errors.AppErrorOperation
import org.sharteman.gymcoach.data.errors.classifyAppError
import org.sharteman.gymcoach.data.network.ApiException
import org.sharteman.gymcoach.data.repository.SyncIssue
import org.sharteman.gymcoach.data.repository.SyncIssueDiscardScope
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

    @Test
    fun longDashboardKeepsTheLastDestinationReachable() {
        var webOpened = false
        val workouts = List(16) { index ->
            workout().copy(
                id = "workout_$index",
                name = "Тренировка ${index + 1}",
                order = index,
            )
        }
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
                        bootstrap = bootstrap(workouts),
                        openSessions = emptyList(),
                        pendingCount = 0,
                        syncIssue = null,
                        online = true,
                        syncing = false,
                        onOpenSession = {},
                        onStartWorkout = { _, _ -> },
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
                        onWebPanel = { webOpened = true },
                        currentVersion = "test",
                        onDownloadUpdate = {},
                        onLogout = {},
                    )
                }
            }
        }

        composeRule.onNodeWithTag("home-dashboard-list")
            .performScrollToNode(hasText("Веб-панель"))
        composeRule.onNodeWithText("Веб-панель").assertIsDisplayed().performClick()

        assertTrue(webOpened)
    }

    @Test
    fun invalidDiscriminatorUsesFriendlyRussianCopyAndKeepsTechnicalDetailsSeparate() {
        var reportRequested = false
        val issue = incompatibleSyncIssue()
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
                        email = null,
                        bootstrap = bootstrap(emptyList()),
                        openSessions = emptyList(),
                        pendingCount = 2,
                        syncIssue = issue,
                        online = true,
                        syncing = false,
                        onOpenSession = {},
                        onStartWorkout = { _, _ -> },
                        onSync = {},
                        onRetrySyncIssue = {},
                        onDiscardSyncIssue = {},
                        onDownloadSyncErrorReport = { reportRequested = true },
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
                    )
                }
            }
        }

        composeRule.onNodeWithText(
            "Одно изменение несовместимо или некорректно. Остальные данные сохранены или " +
                "остаются в безопасной очереди. Обновите GymCoach, прежде чем удалять только это изменение.",
        ).assertIsDisplayed()
        composeRule.onAllNodesWithText("START_SESSION", substring = true).assertCountEquals(0)
        composeRule.onAllNodesWithText("UPSERT_SET", substring = true).assertCountEquals(0)
        composeRule.onAllNodes(hasTestTag("sync-retry")).assertCountEquals(0)
        saveScreenshot("home-sync-error-ru.png")

        composeRule.onNodeWithTag("sync-technical-details-open").performClick()
        composeRule.onAllNodesWithText("Технические подробности").assertCountEquals(2)
        composeRule.onNode(
            hasTestTag("sync-technical-details") and
                hasText("Invalid discriminator value", substring = true),
        ).assertIsDisplayed()
        composeRule.onNode(
            hasTestTag("sync-technical-details") and hasText("UPSERT_SET", substring = true),
        ).assertIsDisplayed()
        composeRule.onNodeWithTag("sync-technical-details-close").performClick()

        composeRule.onNodeWithTag("sync-download-report").performClick()
        assertTrue(reportRequested)
        composeRule.onNodeWithTag("sync-delete-problem-change").performClick()
        composeRule.onNodeWithTag("sync-delete-confirm").assertIsDisplayed()
        composeRule.onNodeWithTag("sync-delete-consequence")
            .performScrollTo()
            .assertIsDisplayed()
        composeRule.onNodeWithText(
            "Будет удалено только это отклонённое локальное изменение. Остальные " +
                "синхронизированные данные и изменения в очереди не удалятся.",
        ).assertIsDisplayed()
    }

    @Test
    fun sessionScopedDeletionUsesTheWholeWorkoutConsequence() {
        val base = InstrumentationRegistry.getInstrumentation().targetContext
        val configuration = Configuration(base.resources.configuration).apply {
            setLocale(Locale("ru"))
        }
        val context = base.createConfigurationContext(configuration)
        val issue = incompatibleSyncIssue().copy(
            discardScope = SyncIssueDiscardScope.SESSION_AND_RELATED_CHANGES,
        )

        assertEquals(
            "Несинхронизированная тренировка и её локальные подходы будут безвозвратно " +
                "удалены с этого устройства. Другие тренировки и синхронизированные данные не изменятся.",
            context.syncDiscardConsequence(issue),
        )
    }

    @Test
    fun friendlyEnglishSyncCardSupportsLargeFontWithoutRawEnums() {
        val issue = incompatibleSyncIssue()
        composeRule.setContent {
            val baseContext = LocalContext.current
            val baseConfiguration = LocalConfiguration.current
            val configuration = remember(baseConfiguration) {
                Configuration(baseConfiguration).apply {
                    setLocale(Locale.ENGLISH)
                    fontScale = 1.8f
                }
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
                        email = null,
                        bootstrap = bootstrap(emptyList()),
                        openSessions = emptyList(),
                        pendingCount = 1,
                        syncIssue = issue,
                        online = true,
                        syncing = false,
                        onOpenSession = {},
                        onStartWorkout = { _, _ -> },
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
                    )
                }
            }
        }

        composeRule.onNodeWithTag("sync-issue-friendly-summary").assertIsDisplayed()
        composeRule.onNodeWithTag("sync-delete-problem-change").assertIsDisplayed()
        composeRule.onAllNodesWithText("START_SESSION", substring = true).assertCountEquals(0)
        saveScreenshot("home-sync-error-en-large.png")
    }

    private fun incompatibleSyncIssue(): SyncIssue {
        val error = classifyAppError(
            ApiException(
                400,
                "Invalid discriminator value. Expected START_SESSION | UPSERT_SET",
            ),
            AppErrorContext(
                operation = AppErrorOperation.SYNC,
                dataState = AppErrorDataState.QUEUED_LOCALLY,
                operationType = "UPSERT_SET",
                queueItemId = "operation-1",
                attemptCount = 2,
            ),
        )
        return SyncIssue(
            operationId = "operation-1",
            type = "UPSERT_SET",
            attempts = 2,
            createdAtEpochMs = 1,
            lastRetryAtEpochMs = 0,
            userError = error,
        )
    }

    private fun saveScreenshot(name: String) {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val directory = requireNotNull(context.getExternalFilesDir("ui-evidence"))
        val output = File(directory, name)
        FileOutputStream(output).use { stream ->
            composeRule.onRoot().captureToImage().asAndroidBitmap()
                .compress(Bitmap.CompressFormat.PNG, 100, stream)
        }
    }

    private fun bootstrap(workout: WorkoutDto) = bootstrap(listOf(workout))

    private fun bootstrap(workouts: List<WorkoutDto>) = BootstrapResponse(
        schemaVersion = 1,
        calculationVersion = "test",
        serverTime = "2026-07-14T12:00:00Z",
        profile = ProfileDto(id = "user", email = "user@example.com"),
        activeProgram = ProgramDto(
            id = "program",
            name = "Силовая",
            phase = "ACTIVE",
            workouts = workouts,
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
