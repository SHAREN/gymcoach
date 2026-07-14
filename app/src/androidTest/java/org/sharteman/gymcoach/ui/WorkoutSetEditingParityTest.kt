package org.sharteman.gymcoach.ui

import android.content.res.Configuration
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import java.util.Locale
import org.junit.Rule
import org.junit.Test
import org.sharteman.gymcoach.ui.theme.GymCoachTheme

class WorkoutSetEditingParityTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun editsCompletedSetInlineAndPersistsTheDraft() {
        setWorkoutContent()

        composeRule.onNodeWithTag("completed-set-1-edit").performClick()
        composeRule.onNodeWithTag("completed-set-1-weight-editor").assertIsDisplayed()
        composeRule.onNodeWithTag("completed-set-1-reps-editor").assertIsDisplayed()
        composeRule.onNodeWithTag("completed-set-1-rir-editor").assertIsDisplayed()

        composeRule.onNodeWithTag("completed-set-1-weight-editor").performClick()
        composeRule.onNodeWithTag("set-value-option-WEIGHT-102.5").performClick()
        composeRule.onNodeWithTag("set-value-apply").performClick()
        composeRule.waitUntil(5_000) {
            composeRule.onAllNodesWithTag("completed-set-1-weight-editor")
                .fetchSemanticsNodes().isEmpty()
        }
        composeRule.onNodeWithTag("completed-set-1-weight").assertTextContains("102.5")
    }

    @Test
    fun reappliesWeightRepsAndRirWithoutOpeningSetCount() {
        setWorkoutContent()

        chooseActiveValue("active-weight-picker", "set-value-option-WEIGHT-100")
        chooseActiveValue("active-reps-picker", "set-value-option-REPS-12")
        chooseActiveValue("active-rir-picker", "set-value-option-RIR-4")

        composeRule.onNodeWithTag("active-weight-picker").assertTextContains("100")
        composeRule.onNodeWithTag("active-reps-picker").assertTextContains("12")
        composeRule.onNodeWithTag("active-rir-picker").assertTextContains("4")
        composeRule.onNodeWithTag("apply-set-recommendation").performClick()

        composeRule.onNodeWithTag("active-weight-picker").assertTextContains("97.5")
        composeRule.onNodeWithTag("active-reps-picker").assertTextContains("10")
        composeRule.onNodeWithTag("active-rir-picker").assertTextContains("2")
        composeRule.onNodeWithTag("set-recommendation-dot").assertDoesNotExist()
        composeRule.onNodeWithTag("set-count-dialog").assertDoesNotExist()

        composeRule.onNodeWithTag("set-count-button").performClick()
        composeRule.onNodeWithTag("set-count-dialog").assertIsDisplayed()
    }

    private fun chooseActiveValue(fieldTag: String, optionTag: String) {
        composeRule.onNodeWithTag(fieldTag).performClick()
        composeRule.onNodeWithTag(optionTag).performClick()
        composeRule.onNodeWithTag("set-value-apply").performClick()
    }

    private fun setWorkoutContent() {
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
    }
}
