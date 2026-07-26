package org.sharteman.gymcoach.ui

import androidx.activity.ComponentActivity
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import org.junit.Rule
import org.junit.Test
import org.sharteman.gymcoach.R
import org.sharteman.gymcoach.ui.theme.GymCoachTheme

class WorkoutExerciseReplacementTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun reachablePickerUsesSharedFiltersExcludesCurrentExerciseAndResetsOnReopen() {
        setWorkoutContent(initialSets = emptyList())
        openReplacementPicker()

        composeRule.onNodeWithTag("exercise-replacement-picker").assertIsDisplayed()
        composeRule.onNodeWithTag("replacement-exercise-romanian-deadlift").assertDoesNotExist()
        composeRule.onNodeWithTag("exercise-filter-muscle")
            .assertTextContains("Muscle: Hamstrings")
        composeRule.onNodeWithTag("exercise-filter-equipment")
            .assertTextContains("Equipment: All equipment")
        composeRule.onNodeWithTag("replacement-exercise-lying-leg-curl").assertIsDisplayed()
        composeRule.onNodeWithTag("replacement-exercise-seated-cable-row").assertDoesNotExist()

        composeRule.onNodeWithTag("exercise-filter-reset").performClick()
        composeRule.onNodeWithTag("exercise-filter-muscle")
            .assertTextContains("Muscle: All muscles")
        composeRule.onNodeWithTag("exercise-filter-equipment")
            .assertTextContains("Equipment: All equipment")
        composeRule.onNodeWithTag("replacement-exercise-seated-cable-row").assertIsDisplayed()
        composeRule.onNodeWithTag(
            "replacement-exercise-seated-cable-row-trained-days",
            useUnmergedTree = true,
        ).assert(
            SemanticsMatcher.expectValue(
                SemanticsProperties.ContentDescription,
                listOf("Training days: 0"),
            ),
        )
        composeRule.onNodeWithTag(
            "replacement-exercise-seated-cable-row-trained-days",
            useUnmergedTree = true,
        ).assertTextEquals("0")

        composeRule.onNodeWithTag("exercise-replacement-search").performTextInput("row")
        composeRule.onNodeWithTag("exercise-filter-muscle").performClick()
        composeRule.onNodeWithTag("exercise-filter-muscle-BACK_THICKNESS").performClick()
        composeRule.onNodeWithTag("exercise-filter-equipment").performClick()
        composeRule.onNodeWithTag("exercise-filter-equipment-CABLE").performClick()
        composeRule.onNodeWithTag("replacement-exercise-seated-cable-row").assertIsDisplayed()
        composeRule.onNodeWithTag("replacement-exercise-incline-bench").assertDoesNotExist()

        composeRule.onNodeWithText(composeRule.activity.getString(R.string.cancel)).performClick()
        composeRule.onNodeWithTag("exercise-replacement-picker").assertDoesNotExist()
        openReplacementPicker()

        composeRule.onNodeWithTag("exercise-filter-muscle")
            .assertTextContains("Muscle: Hamstrings")
        composeRule.onNodeWithTag("exercise-filter-equipment")
            .assertTextContains("Equipment: All equipment")
        composeRule.onNodeWithTag("replacement-exercise-lying-leg-curl").assertIsDisplayed()
    }

    @Test
    fun pickerStateSurvivesSavedInstanceStateRestoration() {
        val restoration = StateRestorationTester(composeRule)
        restoration.setContent {
            GymCoachTheme(darkTheme = true) {
                WorkoutScreenPreview(initialSets = emptyList())
            }
        }
        openReplacementPicker()
        composeRule.onNodeWithTag("exercise-filter-equipment").performClick()
        composeRule.onNodeWithTag("exercise-filter-equipment-MACHINE").performClick()
        composeRule.onNodeWithTag("exercise-replacement-search").performTextInput("leg")

        restoration.emulateSavedInstanceStateRestore()

        composeRule.onNodeWithTag("exercise-replacement-picker").assertIsDisplayed()
        composeRule.onNodeWithTag("exercise-filter-muscle")
            .assertTextContains("Muscle: Hamstrings")
        composeRule.onNodeWithTag("exercise-filter-equipment")
            .assertTextContains("Equipment: Machine")
        composeRule.onNodeWithTag("exercise-replacement-search").assertTextContains("leg")
        composeRule.onNodeWithTag("replacement-exercise-lying-leg-curl").assertIsDisplayed()
    }

    @Test
    fun loggedSetsRequireConfirmationBeforeTheReplacementIsSelected() {
        setWorkoutContent()
        openReplacementPicker()

        composeRule.onNodeWithTag("replacement-exercise-lying-leg-curl").performClick()

        composeRule.onNodeWithTag("exercise-replacement-confirmation").assertIsDisplayed()
        composeRule.onNodeWithText("Recorded sets will stay", substring = true).assertIsDisplayed()
        composeRule.onNodeWithTag("exercise-replacement-confirm").performClick()

        composeRule.onNodeWithTag("exercise-replacement-confirmation").assertDoesNotExist()
        composeRule.onNodeWithTag("exercise-replacement-picker").assertDoesNotExist()
        composeRule.onNodeWithText("Lying Leg Curl").assertIsDisplayed()
    }

    private fun setWorkoutContent(initialSets: List<org.sharteman.gymcoach.data.local.LocalSetEntity>? = null) {
        composeRule.setContent {
            GymCoachTheme(darkTheme = true) {
                WorkoutScreenPreview(initialSets = initialSets)
            }
        }
    }

    private fun openReplacementPicker() {
        composeRule.onNodeWithTag("active-exercise-actions").performScrollTo().performClick()
        composeRule.onNodeWithTag("exercise-menu-replace").performClick()
    }
}
