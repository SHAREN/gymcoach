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
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performScrollToNode
import java.util.Locale
import org.junit.Rule
import org.junit.Test
import org.sharteman.gymcoach.ui.theme.GymCoachTheme

class PreviousPerformanceHistoryUiTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun activeWorkoutShowsExerciseHistoryFromDifferentEquipmentWithProvenance() {
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

        composeRule.onNodeWithTag("workout-content")
            .performScrollToNode(hasTestTag("previous-performance-card"))
        composeRule.onNodeWithTag("previous-performance-card").assertIsDisplayed()
        composeRule.onNodeWithTag("previous-performance-equipment")
            .assertTextContains("Olympic bar", substring = true)
        composeRule.onNodeWithTag("previous-performance-provenance")
            .assertTextContains("Выполнено на другом оборудовании")
    }
}
