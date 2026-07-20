package org.sharteman.gymcoach.ui

import android.content.res.Configuration
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import java.util.Locale
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.sharteman.gymcoach.data.model.ExerciseDto
import org.sharteman.gymcoach.data.programs.ExerciseInput
import org.sharteman.gymcoach.ui.theme.GymCoachTheme

class WorkoutObjectiveParityTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun verifiesThumbnailDetailsHistoryChartAndBarbellLayout() {
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
                GymCoachTheme(darkTheme = true) { WorkoutScreenPreview() }
            }
        }

        composeRule.onNodeWithTag("exercise-thumbnail-1").performClick()
        composeRule.onNodeWithTag("exercise-thumbnail-1").performClick()
        composeRule.onNodeWithTag("exercise-details-dialog").assertIsDisplayed()

        composeRule.onNodeWithTag("exercise-details-list")
            .performScrollToNode(hasTestTag("exercise-open-full-progress"))
        composeRule.onNodeWithTag("exercise-open-full-progress").assertIsDisplayed()

        composeRule.onNodeWithTag("exercise-details-list")
            .performScrollToNode(hasTestTag("exercise-history-previous-session"))
        composeRule.onNodeWithTag("exercise-history-previous-session").assertIsDisplayed()
        composeRule.onNodeWithText("Открыть тренировку").assertIsDisplayed()
        composeRule.onAllNodesWithText("1ПМ").onFirst().assertIsDisplayed()

        composeRule.onNodeWithContentDescription("Вернуться к тренировке").performClick()
        composeRule.onNodeWithTag("exercise-thumbnail-0").performClick()
        composeRule.onNodeWithTag("active-weight-picker").performClick()
        composeRule.onNodeWithTag("barbell-side-diagram").assertIsDisplayed()
    }

    @Test
    fun workoutUsesCanonicalEditorAndPreservesSelectedExerciseInputsAndCompletedSets() {
        val updateCalls = AtomicInteger()
        composeRule.setContent {
            GymCoachTheme(darkTheme = true) {
                WorkoutScreenPreview(
                    onUpdateExercise = { exercise: ExerciseDto, input: ExerciseInput ->
                        updateCalls.incrementAndGet()
                        ExerciseDto(
                            id = exercise.id,
                            userId = "preview-user",
                            name = input.name,
                            muscleGroup = input.muscleGroup,
                            category = input.category,
                            defaultRestSec = input.defaultRestSec,
                            notes = input.notes,
                            usesBodyweight = input.usesBodyweight,
                            equipmentType = input.equipmentType,
                        )
                    },
                )
            }
        }

        composeRule.onNodeWithTag("active-weight-picker").assertTextContains("97.5")
        composeRule.onNodeWithTag("active-reps-picker").assertTextContains("10")
        composeRule.onNodeWithTag("active-rir-picker").assertTextContains("2")
        composeRule.onNodeWithTag("completed-set-1").assertIsDisplayed()
        composeRule.onNodeWithTag("active-set-options").performClick()
        composeRule.onNodeWithTag("active-set-notes").performTextInput("Keep workout draft")

        composeRule.onNodeWithTag("exercise-thumbnail-0").performClick()
        composeRule.onNodeWithTag("exercise-detail-edit").assertIsDisplayed().performClick()
        composeRule.onNodeWithTag("exercise-detail-delete").assertDoesNotExist()
        composeRule.onNodeWithTag("exercise-editor-name").performTextClearance()
        composeRule.onNodeWithTag("exercise-editor-name").performTextInput("Renamed Romanian Deadlift")
        composeRule.onNodeWithTag("exercise-editor-equipment").performClick()
        composeRule.onNodeWithText("Cable").performClick()
        composeRule.onNodeWithTag("exercise-editor-save").performClick()

        composeRule.onNodeWithTag("exercise-editor").assertDoesNotExist()
        composeRule.onNodeWithTag("exercise-details-dialog").assertIsDisplayed()
        composeRule.onAllNodesWithText("Renamed Romanian Deadlift").onFirst().assertIsDisplayed()
        composeRule.runOnIdle { assertEquals(1, updateCalls.get()) }

        composeRule.onNodeWithContentDescription("Back to workout").performClick()
        composeRule.onNodeWithTag("exercise-details-dialog").assertDoesNotExist()
        composeRule.onNodeWithTag("active-weight-picker").assertTextContains("97.5")
        composeRule.onNodeWithTag("active-reps-picker").assertTextContains("10")
        composeRule.onNodeWithTag("active-rir-picker").assertTextContains("2")
        composeRule.onNodeWithTag("active-set-notes").assertTextContains("Keep workout draft")
        composeRule.onNodeWithTag("completed-set-1").assertIsDisplayed()
        composeRule.onAllNodesWithText("Renamed Romanian Deadlift").onFirst().assertIsDisplayed()
    }
}
