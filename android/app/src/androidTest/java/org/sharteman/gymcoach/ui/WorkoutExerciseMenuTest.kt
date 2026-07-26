package org.sharteman.gymcoach.ui

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
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
        ).forEach { composeRule.onNodeWithTag(it).assertIsDisplayed() }
        composeRule.onNodeWithText(composeRule.activity.getString(R.string.exercise_add_action))
            .assertDoesNotExist()
        composeRule.onNodeWithText(composeRule.activity.getString(R.string.cancel)).performClick()

        composeRule.onNodeWithContentDescription(
            composeRule.activity.getString(R.string.workout_controls),
        ).performClick()
        composeRule.onNodeWithTag("workout-replace-exercise").assertDoesNotExist()
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
        composeRule.onNodeWithText(composeRule.activity.getString(R.string.cancel)).performClick()

        openMenu()
        composeRule.onNodeWithTag("exercise-menu-drop-sets").performClick()
        composeRule.onNodeWithTag("exercise-drop-sets-2").performClick()
        openMenu()
        composeRule.onNodeWithTag("exercise-menu-drop-sets").assertTextContains("2")
        composeRule.onNodeWithText(composeRule.activity.getString(R.string.cancel)).performClick()

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
