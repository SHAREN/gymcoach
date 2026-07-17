package org.sharteman.gymcoach.ui

import android.content.ContentValues
import android.content.res.Configuration
import android.graphics.Bitmap
import android.os.Environment
import android.provider.MediaStore
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.test.platform.app.InstrumentationRegistry
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.Locale
import org.junit.Rule
import org.junit.Test
import org.sharteman.gymcoach.data.model.MobileBodyMeasurementDto
import org.sharteman.gymcoach.data.model.MobileBodyweightEntryDto
import org.sharteman.gymcoach.data.model.MobileConditioningWeekDto
import org.sharteman.gymcoach.data.model.MobileConsistencyDto
import org.sharteman.gymcoach.data.model.MobileConsistencyWeekDto
import org.sharteman.gymcoach.data.model.MobileProgressExerciseDto
import org.sharteman.gymcoach.data.model.MobileProgressPointDto
import org.sharteman.gymcoach.data.model.MobileProgressSnapshot
import org.sharteman.gymcoach.data.model.MobileWeeklyVolumeDto
import org.sharteman.gymcoach.ui.theme.GymCoachTheme

class ProgressScreenVisualTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun rendersOverviewChartsAndWeeklyVolume() {
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
                GymCoachTheme(darkTheme = true) {
                    ProgressScreen(
                        snapshot = progressFixture(),
                        unit = "KG",
                        refreshing = false,
                        onRefresh = {},
                        onBack = {},
                    )
                }
            }
        }
        composeRule.waitForIdle()

        composeRule.onNodeWithText("Вес тела").assertIsDisplayed()
        composeRule.onNodeWithText("Замеры").assertIsDisplayed()
        saveScreenshot("progress-overview-top.png")

        composeRule.onNodeWithTag("progress-list").performScrollToNode(hasText("Регулярность тренировок"))
        composeRule.onNodeWithText("Регулярность тренировок").assertIsDisplayed()
        saveScreenshot("progress-overview-middle.png")

        composeRule.onNodeWithTag("progress-list")
            .performScrollToNode(hasTestTag("progress-metric-ESTIMATED_1RM"))
        composeRule.onNodeWithTag("progress-metric-ESTIMATED_1RM")
            .assertIsSelected()
        composeRule.onNodeWithTag("progress-range-ONE_MONTH")
            .performClick()
            .assertIsSelected()
        composeRule.onNodeWithTag("progress-list")
            .performScrollToNode(hasTestTag("progress-main-chart"))
        composeRule.onNodeWithTag("progress-main-chart").assertIsDisplayed()
        saveScreenshot("progress-main-chart.png")

        composeRule.onNodeWithTag("progress-list").performScrollToNode(hasText("Недельный объём по группам мышц"))
        composeRule.waitForIdle()
        composeRule.onNodeWithText("Недельный объём по группам мышц").assertIsDisplayed()
        saveScreenshot("progress-overview-volume.png")
    }

    @Test
    fun defaultsToEstimatedOneRmAndRestoresExplicitMetricSelection() {
        val restorationTester = StateRestorationTester(composeRule)
        restorationTester.setContent {
            GymCoachTheme {
                ProgressScreen(
                    snapshot = progressFixture(),
                    unit = "KG",
                    refreshing = false,
                    onRefresh = {},
                    onBack = {},
                )
            }
        }

        composeRule.onNodeWithTag("progress-list")
            .performScrollToNode(hasTestTag("progress-metric-ESTIMATED_1RM"))
        composeRule.onNodeWithTag("progress-metric-ESTIMATED_1RM")
            .assertIsSelected()
        composeRule.onNodeWithTag("progress-list")
            .performScrollToNode(hasTestTag("progress-main-chart"))
        composeRule.onNodeWithText("143 kg").assertIsDisplayed()

        composeRule.onNodeWithTag("progress-list")
            .performScrollToNode(hasTestTag("progress-metric-MAX_WEIGHT"))
        composeRule.onNodeWithTag("progress-metric-MAX_WEIGHT")
            .performClick()
            .assertIsSelected()

        restorationTester.emulateSavedInstanceStateRestore()

        composeRule.onNodeWithTag("progress-list")
            .performScrollToNode(hasTestTag("progress-metric-MAX_WEIGHT"))
        composeRule.onNodeWithTag("progress-metric-MAX_WEIGHT")
            .assertIsSelected()
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

private fun progressFixture() = MobileProgressSnapshot(
    schemaVersion = 2,
    generatedAt = "2026-07-13T14:00:00Z",
    bodyweightEntries = listOf(
        MobileBodyweightEntryDto("bw-3", 80.0, "2026-07-12T08:00:00Z"),
        MobileBodyweightEntryDto("bw-2", 80.7, "2026-06-28T08:00:00Z"),
        MobileBodyweightEntryDto("bw-1", 81.4, "2026-06-14T08:00:00Z"),
    ),
    bodyMeasurements = listOf(
        MobileBodyMeasurementDto("m-3", "WAIST", 83.5, "2026-07-12T08:00:00Z"),
        MobileBodyMeasurementDto("m-2", "WAIST", 84.2, "2026-06-28T08:00:00Z"),
        MobileBodyMeasurementDto("m-1", "WAIST", 85.0, "2026-06-14T08:00:00Z"),
    ),
    conditioningWeeks = (0 until 8).map { index ->
        MobileConditioningWeekDto(
            weekKey = "2026-W${(22 + index).toString().padStart(2, '0')}",
            weekStartIso = fixtureWeekStart("2026-05-25", index),
            minutes = listOf(80, 120, 95, 160, 140, 175, 110, 155)[index],
            distanceKm = listOf(8.0, 12.5, 9.0, 16.0, 14.2, 18.1, 11.0, 15.5)[index],
            sessions = listOf(2, 3, 2, 4, 3, 4, 3, 4)[index],
        )
    },
    consistency = MobileConsistencyDto(
        weeks = (0 until 12).map { index ->
            val days = listOf(3, 2, 3, 1, 3, 3, 2, 3, 0, 3, 2, 3)[index]
            MobileConsistencyWeekDto(
                weekKey = "2026-W${(18 + index).toString().padStart(2, '0')}",
                weekStartIso = fixtureWeekStart("2026-04-27", index),
                trainedDays = days,
                onStreak = days >= 3,
                isCurrent = index == 11,
            )
        },
        currentStreak = 1,
        weeklyFrequency = 3,
    ),
    exercises = listOf(
        MobileProgressExerciseDto(
            id = "squat",
            name = "Back Squat · Barbell",
            muscleGroup = "QUADS",
            points = listOf(
                progressPoint("2026-04-20T10:00:00Z", 90.0, 120.0, 2700.0),
                progressPoint("2026-05-18T10:00:00Z", 100.0, 130.0, 3000.0),
                progressPoint("2026-06-15T10:00:00Z", 105.0, 136.5, 3250.0),
                progressPoint("2026-07-12T10:00:00Z", 110.0, 143.0, 3480.0),
            ),
        ),
    ),
    weeklyVolume = (0 until 8).map { index ->
        val chest = 3500.0 + index * 220
        val back = 4200.0 + index * 180
        val quads = 3000.0 + index * 260
        MobileWeeklyVolumeDto(
            weekKey = "2026-W${(22 + index).toString().padStart(2, '0')}",
            weekStartIso = fixtureWeekStart("2026-05-25", index),
            byMuscleGroup = mapOf(
                "CHEST" to chest,
                "BACK_WIDTH" to back,
                "QUADS" to quads,
            ),
            total = chest + back + quads,
        )
    },
)

private fun progressPoint(
    date: String,
    maxWeight: Double,
    estimated1Rm: Double,
    volume: Double,
) = MobileProgressPointDto(
    sessionStartedAt = date,
    maxWeight = maxWeight,
    estimated1RM = estimated1Rm,
    totalVolume = volume,
    topSetReps = 8,
    maxReps = 10,
    totalReps = 30,
)

private fun fixtureWeekStart(base: String, offsetWeeks: Int): String =
    LocalDate.parse(base).plusWeeks(offsetWeeks.toLong())
        .atStartOfDay().toInstant(ZoneOffset.UTC).toString()
