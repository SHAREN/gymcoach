package org.sharteman.gymcoach.ui

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assert
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import org.junit.Rule
import org.junit.Test
import org.sharteman.gymcoach.R
import org.sharteman.gymcoach.ui.theme.GymCoachTheme

class WorkoutExerciseMenuTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun activeCardOwnsTheFullExerciseMenuAndGlobalControlsDoNotContainReplace() {
        setContent()

        composeRule.onNodeWithTag("active-exercise-actions").assertIsDisplayed().performClick()
        listOf(
            "exercise-menu-target-sets",
            "exercise-menu-target-reps",
            "exercise-menu-drop-sets",
            "exercise-menu-superset",
            "exercise-menu-note",
            "exercise-menu-replace",
            "exercise-menu-remove",
            "exercise-menu-information",
        ).forEach { composeRule.onNodeWithTag(it).performScrollTo().assertIsDisplayed() }
        composeRule.onNodeWithTag("exercise-menu-parameters-section").assertIsDisplayed()
        composeRule.onNodeWithTag("exercise-menu-actions-section").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithTag("exercise-menu-destructive-section").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithText(composeRule.activity.getString(R.string.exercise_note_empty))
            .performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithText(composeRule.activity.getString(R.string.exercise_add_action))
            .assertDoesNotExist()
        composeRule.onNodeWithTag("exercise-menu-close").performClick()

        composeRule.onNodeWithContentDescription(
            composeRule.activity.getString(R.string.workout_controls),
        ).performClick()
        composeRule.onNodeWithTag("workout-replace-exercise").assertDoesNotExist()
    }

    @Test
    fun longTitleEquipmentSubtitleAndCompactSheetRemainScrollable() {
        val longName = "Single-arm cable triceps extension with rope and controlled eccentric"
        composeRule.setContent {
            GymCoachTheme(darkTheme = true) {
                WorkoutScreenPreview(
                    firstExerciseName = longName,
                    firstEquipmentName = "Selectorized cable crossover × ½",
                )
            }
        }

        openMenu()
        composeRule.onNodeWithTag("exercise-menu-title").assertTextContains(longName)
        composeRule.onNodeWithTag("exercise-menu-equipment")
            .assertTextContains("Selectorized cable crossover × ½")
        composeRule.onNodeWithTag("exercise-menu-scroll").assert(
            SemanticsMatcher.keyIsDefined(SemanticsProperties.VerticalScrollAxisRange),
        )
        composeRule.onNodeWithTag("exercise-menu-destructive-section")
            .performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithTag("exercise-menu-remove").performClick()
        composeRule.onNodeWithTag("exercise-menu-destructive-confirmation").assertIsDisplayed()
        composeRule.onNodeWithTag("exercise-menu-back").performClick()
        composeRule.onNodeWithTag("exercise-menu-parameters-section").assertIsDisplayed()
    }

    @Test
    fun systemBackDismissesTheBottomSheet() {
        setContent()
        openMenu()

        composeRule.activityRule.scenario.onActivity { activity ->
            activity.onBackPressedDispatcher.onBackPressed()
        }

        composeRule.onNodeWithTag("active-exercise-menu").assertDoesNotExist()
    }

    @Test
    fun thumbnailEmphasisTransfersImmediatelyWithoutChangingExerciseIndexes() {
        setContent()
        val activeLabel = composeRule.activity.getString(R.string.exercise_thumbnail_active)
        val inactiveLabel = composeRule.activity.getString(R.string.exercise_thumbnail_inactive)

        composeRule.onNodeWithTag("exercise-thumbnail-item-romanian-deadlift").assert(
            SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, activeLabel),
        )
        composeRule.onNodeWithTag("exercise-thumbnail-item-incline-bench").assert(
            SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, inactiveLabel),
        )

        composeRule.onNodeWithTag("exercise-thumbnail-1").performClick()

        composeRule.onNodeWithTag("exercise-thumbnail-item-romanian-deadlift").assert(
            SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, inactiveLabel),
        )
        composeRule.onNodeWithTag("exercise-thumbnail-item-incline-bench").assert(
            SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, activeLabel),
        )
        composeRule.onNodeWithText("2 / 3").assertIsDisplayed()
    }

    @Test
    fun targetSetsRepsDropSetsNoteAndSupersetMutateTheSelectedExercise() {
        setContent()
        openMenu()
        composeRule.onNodeWithTag("exercise-menu-target-sets").performClick()
        composeRule.onNodeWithTag("exercise-target-sets-6").performClick()
        composeRule.onNodeWithText("6 × 10-10", substring = true).assertIsDisplayed()

        openMenu()
        composeRule.onNodeWithTag("exercise-menu-target-reps").performClick()
        composeRule.onNodeWithTag("exercise-reps-min").performTextClearance()
        composeRule.onNodeWithTag("exercise-reps-min").performTextInput("8")
        composeRule.onNodeWithTag("exercise-reps-max").performTextClearance()
        composeRule.onNodeWithTag("exercise-reps-max").performTextInput("12")
        composeRule.onNodeWithTag("exercise-reps-save").performClick()
        openMenu()
        composeRule.onNodeWithTag("exercise-menu-target-reps").assertTextContains("8-12")
        composeRule.onNodeWithTag("exercise-menu-close").performClick()

        openMenu()
        composeRule.onNodeWithTag("exercise-menu-drop-sets").performClick()
        composeRule.onNodeWithTag("exercise-drop-sets-2").performClick()
        openMenu()
        composeRule.onNodeWithTag("exercise-menu-drop-sets").assertTextContains("2")
        composeRule.onNodeWithTag("exercise-menu-close").performClick()

        openMenu()
        composeRule.onNodeWithTag("exercise-menu-note").performClick()
        composeRule.onNodeWithTag("exercise-note-input").performTextInput("Slow eccentric")
        composeRule.onNodeWithTag("exercise-note-save").performClick()
        composeRule.onNodeWithText("Slow eccentric").assertIsDisplayed()

        openMenu()
        composeRule.onNodeWithTag("exercise-menu-superset").performClick()
        composeRule.onNodeWithTag("exercise-superset-dissolve").performClick()
        openMenu()
        composeRule.onNodeWithTag("exercise-menu-superset").performClick()
        composeRule.onNodeWithTag("exercise-superset-next").assertIsDisplayed().performClick()
    }

    @Test
    fun informationRemoveAndTerminalAddTileTargetTheCurrentWorkout() {
        setContent()
        openMenu()
        composeRule.onNodeWithTag("exercise-menu-information").performClick()
        composeRule.onNodeWithTag("exercise-details-dialog").assertIsDisplayed()

        composeRule.onNodeWithContentDescription(
            composeRule.activity.getString(R.string.back_to_workout),
        ).performClick()
        composeRule.onAllNodesWithContentDescription(
            composeRule.activity.getString(R.string.exercise_add_action),
        ).assertCountEquals(1)
        composeRule.onNodeWithTag("exercise-add-tile").performScrollTo().assertIsDisplayed().performClick()
        composeRule.onNodeWithTag("exercise-add-picker").assertIsDisplayed()
        composeRule.onNodeWithTag("add-exercise-lying-leg-curl").performClick()
        composeRule.onNodeWithText("Lying Leg Curl").assertIsDisplayed()

        openMenu()
        composeRule.onNodeWithTag("exercise-menu-remove").performClick()
        composeRule.onNodeWithTag("exercise-remove-confirm").performClick()
        composeRule.onNodeWithText("Lying Leg Curl").assertDoesNotExist()
    }

    @Test
    fun menuSubflowStateSurvivesSavedInstanceRestoration() {
        val restoration = StateRestorationTester(composeRule)
        restoration.setContent {
            GymCoachTheme(darkTheme = true) { WorkoutScreenPreview(initialSets = emptyList()) }
        }
        openMenu()
        composeRule.onNodeWithTag("exercise-menu-note").performClick()
        composeRule.onNodeWithTag("exercise-note-input").performTextInput("Keep ribs down")

        restoration.emulateSavedInstanceStateRestore()

        composeRule.onNodeWithTag("active-exercise-menu").assertIsDisplayed()
        composeRule.onNodeWithTag("exercise-note-input").assertTextContains("Keep ribs down")
    }

    private fun setContent() {
        composeRule.setContent {
            GymCoachTheme(darkTheme = true) { WorkoutScreenPreview() }
        }
    }

    private fun openMenu() {
        composeRule.onNodeWithTag("active-exercise-actions").performScrollTo().performClick()
        composeRule.onNodeWithTag("active-exercise-menu").assertIsDisplayed()
    }

}
