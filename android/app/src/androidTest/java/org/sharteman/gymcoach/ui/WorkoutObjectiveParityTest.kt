package org.sharteman.gymcoach.ui

import android.content.res.Configuration
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import java.util.Locale
import org.junit.Rule
import org.junit.Test
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
}
