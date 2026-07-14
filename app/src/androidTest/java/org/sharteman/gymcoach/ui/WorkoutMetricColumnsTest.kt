package org.sharteman.gymcoach.ui

import android.content.ContentValues
import android.content.res.Configuration
import android.graphics.Bitmap
import android.os.Environment
import android.provider.MediaStore
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import java.util.Locale
import org.junit.Rule
import org.junit.Test
import org.sharteman.gymcoach.ui.theme.GymCoachTheme

class WorkoutMetricColumnsTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun selectsRepMaxAndVolumeColumnsLikeWeb() {
        composeRule.setContent {
            val baseContext = LocalContext.current
            val baseConfiguration = LocalConfiguration.current
            val configuration = remember(baseConfiguration) {
                Configuration(baseConfiguration).apply {
                    setLocale(Locale("ru"))
                }
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

        composeRule.onNodeWithTag("set-metric-header-ONE_RM").assertIsDisplayed()
        composeRule.onNodeWithTag("set-metric-selector").performClick()
        composeRule.onNodeWithTag("set-metric-option-VOLUME").performClick()
        composeRule.onNodeWithTag("set-metric-done").performClick()

        composeRule.onNodeWithTag("set-metric-header-ONE_RM").assertIsDisplayed()
        composeRule.onNodeWithTag("set-metric-header-VOLUME").assertIsDisplayed()
        composeRule.onAllNodesWithText("1000").onFirst().assertIsDisplayed()
        saveScreenshot("workout-set-metrics.png")

        composeRule.onNodeWithTag("set-metric-selector").performClick()
        composeRule.onNodeWithTag("set-metric-option-TEN_RM").performClick()
        composeRule.onNodeWithTag("set-metric-done").performClick()

        composeRule.onNodeWithTag("set-metric-header-TEN_RM").assertIsDisplayed()
        composeRule.onNodeWithTag("set-metric-header-VOLUME").assertIsDisplayed()
    }

    private fun saveScreenshot(name: String) {
        if (InstrumentationRegistry.getArguments().getString("captureScreenshots") != "true") return
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, name)
            put(MediaStore.Images.Media.MIME_TYPE, "image/png")
            put(MediaStore.Images.Media.RELATIVE_PATH, "${Environment.DIRECTORY_PICTURES}/GymCoachTests")
        }
        val uri = requireNotNull(
            context.contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values),
        )
        context.contentResolver.openOutputStream(uri).use { output ->
            requireNotNull(output)
            composeRule.onRoot().captureToImage().asAndroidBitmap()
                .compress(Bitmap.CompressFormat.PNG, 100, output)
        }
    }
}
